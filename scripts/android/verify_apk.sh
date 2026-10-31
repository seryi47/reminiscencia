#!/usr/bin/env bash
# Verifica un APK de Reminiscencia: SHA-256 del fichero, paquete, versión, firma y huella del certificado.
#
# Uso: scripts/android/verify_apk.sh APK [HUELLA_SHA256_ESPERADA]
#
#   APK                     Ruta al fichero .apk.
#   HUELLA_SHA256_ESPERADA  SHA-256 del certificado de firma (64 caracteres hexadecimales). Se acepta
#                           con dos puntos, como la imprime keytool. Si se indica y ningún firmante
#                           del APK coincide, el script falla.
#
# Herramientas: aapt2 (o apkanalyzer) y apksigner. Se buscan en el PATH y, si no están, en los
# build-tools de ANDROID_HOME, ANDROID_SDK_ROOT y en las rutas habituales del SDK (gana la versión
# más alta instalada). apksigner necesita un Java en el PATH o en JAVA_HOME.
#
# Códigos de salida: 0 correcto; 1 firma o huella no válidas; 2 uso incorrecto o faltan herramientas.
set -euo pipefail

uso() {
  echo "Uso: $0 APK [HUELLA_SHA256_ESPERADA]" >&2
  exit 2
}

[ "$#" -ge 1 ] && [ "$#" -le 2 ] || uso
apk="$1"
esperada="${2:-}"
[ -f "$apk" ] || { echo "No existe el APK: $apk" >&2; exit 2; }

if [ -n "$esperada" ]; then
  esperada="$(printf '%s' "$esperada" | tr -d ': ' | tr 'A-F' 'a-f')"
  if ! [[ "$esperada" =~ ^[0-9a-f]{64}$ ]]; then
    echo "La huella esperada debe tener 64 caracteres hexadecimales (SHA-256)." >&2
    exit 2
  fi
fi

# Busca una herramienta del SDK: primero en el PATH y después en build-tools.
buscar_herramienta() {
  local nombre="$1" raiz encontrada
  if encontrada="$(command -v "$nombre" 2>/dev/null)"; then
    printf '%s\n' "$encontrada"
    return 0
  fi
  for raiz in "${ANDROID_HOME:-}" "${ANDROID_SDK_ROOT:-}" \
              /opt/homebrew/share/android-commandlinetools \
              "$HOME/Library/Android/sdk" /usr/local/lib/android/sdk; do
    [ -n "$raiz" ] && [ -d "$raiz/build-tools" ] || continue
    encontrada="$(find "$raiz/build-tools" -mindepth 2 -maxdepth 2 -name "$nombre" 2>/dev/null | sort -V | tail -n 1)" || true
    if [ -n "$encontrada" ]; then
      printf '%s\n' "$encontrada"
      return 0
    fi
  done
  return 1
}

sha256_de() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d ' ' -f 1
  else
    shasum -a 256 "$1" | cut -d ' ' -f 1
  fi
}

echo "APK: $apk"
echo "SHA-256 del fichero: $(sha256_de "$apk")"

# Paquete y versiones.
if aapt2="$(buscar_herramienta aapt2)"; then
  salida="$("$aapt2" dump badging "$apk")" || { echo "aapt2 no puede leer el APK." >&2; exit 1; }
  paquete="$(printf '%s\n' "$salida" | sed -n "s/^package: name='\([^']*\)'.*/\1/p")"
  version_code="$(printf '%s\n' "$salida" | sed -n "s/^package:.*versionCode='\([^']*\)'.*/\1/p")"
  version_name="$(printf '%s\n' "$salida" | sed -n "s/^package:.*versionName='\([^']*\)'.*/\1/p")"
elif apkanalyzer="$(buscar_herramienta apkanalyzer)"; then
  paquete="$("$apkanalyzer" manifest application-id "$apk")"
  version_code="$("$apkanalyzer" manifest version-code "$apk")"
  version_name="$("$apkanalyzer" manifest version-name "$apk")"
else
  echo "Falta aapt2 o apkanalyzer (build-tools del SDK de Android)." >&2
  exit 2
fi
echo "Paquete: ${paquete:-desconocido}"
echo "versionCode: ${version_code:-desconocido}"
echo "versionName: ${version_name:-desconocido}"

# Firma.
apksigner="$(buscar_herramienta apksigner)" || { echo "Falta apksigner (build-tools del SDK de Android)." >&2; exit 2; }
if ! firma="$("$apksigner" verify --verbose --print-certs "$apk" 2>&1)"; then
  printf '%s\n' "$firma"
  echo "FIRMA NO VÁLIDA: apksigner no ha podido verificar el APK (revisa el mensaje anterior y JAVA_HOME)." >&2
  exit 1
fi
printf '%s\n' "$firma" | sed -n \
  -e 's/^Verified using \(.*\): true$/Firma válida con \1/p' \
  -e 's/^Signer #\([0-9]*\) certificate DN: /Firmante \1: /p' \
  -e 's/^Signer #\([0-9]*\) certificate SHA-256 digest: /Huella SHA-256 del firmante \1: /p' \
  | sed 's/^/  /'
if [[ "$firma" == *"CN=Android Debug"* ]]; then
  echo "  Aviso: firmado con la clave de depuración de Android; no sirve para distribuir."
fi

# Huella del certificado frente a la esperada.
huellas="$(printf '%s\n' "$firma" | sed -n 's/^Signer #[0-9]* certificate SHA-256 digest: //p' | tr 'A-F' 'a-f')"
if [ -n "$esperada" ]; then
  coincide=no
  while IFS= read -r huella; do
    if [ "$huella" = "$esperada" ]; then
      coincide=si
    fi
  done <<< "$huellas"
  if [ "$coincide" != si ]; then
    echo "ERROR: ningún firmante del APK tiene la huella esperada ($esperada)." >&2
    exit 1
  fi
  echo "OK: la huella del certificado coincide con la esperada."
fi

echo "Verificación correcta."
