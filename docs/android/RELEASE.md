# Publicar una versión de la app Android

Procedimiento para publicar una versión nueva de la app Android (`mobile/`, paquete `es.orbitalabs.reminiscencia`). La compilación, la firma y la release de GitHub las hace el workflow [android](../../.github/workflows/android.yml).

> **Estado a 2026-11-04: versión en `main` 1.2.4+8 (1.2.5+9 en la rama `feature/web-en-cloudflare`, ADR-0034); no hay release de producción nueva.** El workflow [android](../../.github/workflows/android.yml) pasó análisis, pruebas y APK de depuración en la ejecución [41801316025](https://github.com/seryi47/reminiscencia/actions/runs/41801316025); producción se omitió porque los cuatro secretos de firma no están en GitHub. La clave no se sube al repositorio, por decisión del propietario. Una etiqueta `android-v*` no puede publicar el APK de producción sin la firma original.

## Antes de empezar

- Flutter 3.44.9 (la misma versión que usa la CI), JDK 17 y el SDK de Android con sus build-tools.
- Acceso a la copia de seguridad de la clave de firma (ver [Clave de firma](#clave-de-firma)). Sin esa clave no se puede publicar una actualización que los usuarios instalen encima de la versión anterior.

## 1. Subir la versión

En `mobile/pubspec.yaml`, la línea `version:` tiene la forma `X.Y.Z+B`:

- `X.Y.Z` es el nombre de versión (versionName) que ve el usuario.
- `B` es el número de compilación (versionCode). Es un entero que debe ser mayor que el de la versión publicada antes.

Versión preparada: `version: 1.2.5+9` (ADR-0034: lee la web y el API de https://reminiscencia.cometia.es). La etiqueta de la release debe ser `android-v1.2.5`.

## 2. Comprobar el código

```
cd mobile
flutter pub get
flutter analyze
flutter test
```

Todo debe terminar sin errores antes de seguir.

## 3. Compilar y verificar en local

```
flutter build apk --debug
../scripts/android/verify_apk.sh build/app/outputs/flutter-apk/app-debug.apk

flutter build apk --release --split-per-abi
../scripts/android/verify_apk.sh build/app/outputs/flutter-apk/app-arm64-v8a-release.apk 8f305105155f87056d858948614bfc4e114d9dc67a6e3e57dbb4679de46b657c
../scripts/android/verify_apk.sh build/app/outputs/flutter-apk/app-armeabi-v7a-release.apk 8f305105155f87056d858948614bfc4e114d9dc67a6e3e57dbb4679de46b657c
../scripts/android/verify_apk.sh build/app/outputs/flutter-apk/app-x86_64-release.apk 8f305105155f87056d858948614bfc4e114d9dc67a6e3e57dbb4679de46b657c
```

La compilación de producción necesita las dos copias locales de la firma (no versionadas): `mobile/android/key.properties` y `mobile/android/app/upload.jks`. Si faltan, Gradle firma con la clave de depuración; el segundo `verify_apk.sh` lo detecta y falla. No uses ese APK.

`--split-per-abi` genera un APK por arquitectura: `app-arm64-v8a-release.apk` (la mayoría de teléfonos), `app-armeabi-v7a-release.apk` y `app-x86_64-release.apk`. Los tres van firmados con la misma clave.

El contenido de `key.properties` tiene este formato (los valores reales están en la copia de seguridad):

```
storePassword=<contraseña del almacén>
keyPassword=<contraseña de la clave>
keyAlias=<alias de la clave>
storeFile=upload.jks
```

Para la verificación completa de la firma de producción, ver [Verificar la firma](#verificar-la-firma).

## 4. Actualizar el CHANGELOG

Añade la entrada de la versión en `CHANGELOG.md`, con la fecha, los cambios visibles para el usuario y los cambios técnicos relevantes. Incluye en el mismo commit `mobile/pubspec.yaml` y el CHANGELOG.

## 5. Fusionar en main y etiquetar

La versión debe estar en `main`. Después etiqueta ese commit:

```
git checkout main && git pull
git tag -a android-v1.2.4 -m "App Android 1.2.4"
git push origin android-v1.2.4
```

## 6. Qué hace la CI

Al subir una etiqueta `android-v*`, el workflow `android`:

1. Comprueba que la etiqueta coincide con la versión de `mobile/pubspec.yaml`.
2. Ejecuta `flutter analyze` y `flutter test`, compila el APK de depuración y lo verifica.
3. Compila el APK de producción con la clave de los secretos y comprueba que su huella coincide con la de referencia. Si no coincide, no publica nada. Hoy la CI omite este paso porque los secretos de firma no están cargados en GitHub (ver el estado al principio).
4. Crea la release `android-v1.2.4` con `reminiscencia-1.2.4-arm64-v8a.apk`, `reminiscencia-1.2.4-armeabi-v7a.apk`, `reminiscencia-1.2.4-x86_64.apk`, `reminiscencia-1.2.4-debug.apk` y `SHA256SUMS.txt`. Cada teléfono descarga solo el suyo.

Cada push a `main` y cada pull request que toque `mobile/`, `scripts/android/` o el workflow ya analiza, prueba y compila el APK de depuración (sin APK de producción). Para probar también el de producción sin publicar, lanza el workflow a mano desde la pestaña Actions de GitHub (botón Run workflow). Compila y verifica, pero no crea ninguna release. Sin secretos de firma, esa ejecución solo avisa y omite el APK de producción.

## 7. Comprobar la release

- La release tiene tres ficheros: el APK de producción, el APK de depuración y `SHA256SUMS.txt`.
- Tras descargarlos, comprueba la integridad desde la carpeta de descarga: `shasum -a 256 -c SHA256SUMS.txt`.

## Si algo falla

- **Faltan secretos de firma.** Es el estado actual: la clave no está en GitHub. Una ejecución manual omite el APK de producción y una etiqueta no puede completar la release. No subas la clave al repositorio; recupera la copia de seguridad y firma localmente o decide explícitamente otro procedimiento.
- **La etiqueta no coincide con la versión.** Corrige la etiqueta o `mobile/pubspec.yaml`. Si ya se creó la release de una etiqueta equivocada, bórrala con su etiqueta antes de volver a empezar:

  ```
  gh release delete android-v1.2.4 --cleanup-tag --yes
  git tag -d android-v1.2.4
  ```

- **El almacén no se abre.** El paso «Comprobar el almacén de firma» falla si `ANDROID_KEYSTORE_PASSWORD` o `ANDROID_KEY_ALIAS` no son correctos. Revisa esos dos secretos antes de volver a lanzar el workflow.
- **La huella del certificado no coincide.** El almacén de los secretos no es la clave de producción. No publiques. Revisa qué almacén se subió (sección siguiente) y compáralo con la copia de seguridad.

## Verificar la firma

Hay dos vías. Mientras la clave no esté en GitHub, solo sirve la primera.

### A. En local, con la clave de la copia de seguridad

1. Tener las dos copias locales de la firma, fuera del repositorio: `mobile/android/key.properties` y `mobile/android/app/upload.jks`. Según `CLAUDE.md`, las claves de firma de Android están en `~/.android-keys/`.
2. Compilar la versión de producción:

   ```
   cd mobile
   flutter build apk --release
   ```

3. Verificar el APK contra la huella de referencia:

   ```
   ../scripts/android/verify_apk.sh build/app/outputs/flutter-apk/app-arm64-v8a-release.apk 8f305105155f87056d858948614bfc4e114d9dc67a6e3e57dbb4679de46b657c
   ```

4. Es correcto si termina con «Verificación correcta» y con «OK: la huella del certificado coincide con la esperada». Si el APK sale firmado con la clave de depuración, el script avisa y falla: ese APK no sirve.

Esta vía comprueba que el APK sale firmado con la clave de producción. No ejecuta el job de GitHub.

### B. En GitHub Actions, cuando se cargue la clave

1. Cargar los cuatro secretos de la sección [Secretos del repositorio](#secretos-del-repositorio). Requiere la decisión de subir la clave a GitHub, que hoy no está tomada.
2. Lanzar el workflow `android` a mano desde `main` (pestaña Actions, Run workflow). Esa ejecución analiza, prueba y compila la depuración y, con secretos, compila y verifica el APK de producción. No crea ninguna release.
3. Es correcto si el job **Producción** termina en verde, en particular el paso «Verificar firma de cada APK de producción», y hay tres artefactos (`apk-produccion-arm64-v8a`, `apk-produccion-armeabi-v7a` y `apk-produccion-x86_64`), cada uno con su APK y su `SHA256SUMS.txt`.
4. Solo después, una etiqueta `android-v*` crea la release, con sus cuatro APK (tres de producción y uno de depuración) y `SHA256SUMS.txt`.

## Clave de firma

### Generar un almacén

Genera un almacén nuevo solo si no existe la clave de producción. Cambiar de clave impide que los usuarios actualicen la app que ya tienen instalada: Android exige la misma firma en todas las versiones.

```
keytool -genkeypair -v -keystore upload.jks -alias <alias> -keyalg RSA -keysize 2048 -validity 10000
```

- Elige un alias sin espacios y una contraseña sin barras invertidas (`\`). `key.properties` se lee como fichero de propiedades de Java, donde `\` es carácter de escape.
- Si cambias de clave, actualiza la huella en tres sitios en el mismo cambio: la variable `HUELLA_CERTIFICADO_PRODUCCION` de `.github/workflows/android.yml`, `releases/android/production/README.md` y este documento. Recuerda que los usuarios con la versión anterior no podrán actualizar a la nueva.

### Copia de seguridad

- Guarda fuera del repositorio `upload.jks`, el alias y las dos contraseñas: en un gestor de contraseñas y en una copia cifrada en un soporte externo.
- Nunca en Git, en mensajes, en correo ni en una nube sin cifrar.
- Si pierdes la clave, no podrás publicar actualizaciones de la app ya instalada.

### Huella de referencia

`8f305105155f87056d858948614bfc4e114d9dc67a6e3e57dbb4679de46b657c`

Es la huella SHA-256 del certificado de firma de producción, la misma que muestra `verify_apk.sh` sobre el APK 1.1.0. Es un dato público: viaja en cada APK firmado con esa clave.

## Secretos del repositorio

> **Estado: sin configurar.** La clave de firma no se sube a GitHub por decisión del propietario. Lo que sigue describe cómo cargar los secretos si esa decisión cambia.

Configúralos en GitHub: Ajustes del repositorio → Secrets and variables → Actions → New repository secret. Los nombres son exactos:

| Nombre | Contenido |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | `upload.jks` codificado en base64, en una sola línea |
| `ANDROID_KEYSTORE_PASSWORD` | contraseña del almacén |
| `ANDROID_KEY_ALIAS` | alias de la clave |
| `ANDROID_KEY_PASSWORD` | contraseña de la clave |

Con la CLI de GitHub, sin que el valor quede escrito en el historial de la terminal:

```
base64 < upload.jks | tr -d '\n' | gh secret set ANDROID_KEYSTORE_BASE64
gh secret set ANDROID_KEYSTORE_PASSWORD
gh secret set ANDROID_KEY_ALIAS
gh secret set ANDROID_KEY_PASSWORD
```

Sin `--body`, `gh secret set` lee el valor de la entrada estándar y no lo muestra.
