# APK de producción

Aquí van los APK firmados con la clave de publicación de la app Android (`es.orbitalabs.reminiscencia`). Son los que instalan los usuarios.

## Qué contiene

- `reminiscencia-<versión>-<arquitectura>.apk`: resultado de `flutter build apk --release --split-per-abi`, uno por arquitectura (`arm64-v8a`, `armeabi-v7a`, `x86_64`), firmados con la clave de producción.

## Reglas

- Todas las versiones van firmadas con la misma clave. Android solo instala una actualización si su firma coincide con la de la versión ya instalada.
- Huella SHA-256 del certificado de producción (referencia): `8f305105155f87056d858948614bfc4e114d9dc67a6e3e57dbb4679de46b657c`.
- Los APK no se versionan en Git (`.gitignore` excluye `releases/**/*.apk`). Se publican en la release `android-vX.Y.Z` y como artefactos `apk-produccion-<arquitectura>` del workflow [android](../../../.github/workflows/android.yml).

## Comprobar la firma

Desde la raíz del repositorio:

```
scripts/android/verify_apk.sh releases/android/production/reminiscencia-<versión>-arm64-v8a.apk 8f305105155f87056d858948614bfc4e114d9dc67a6e3e57dbb4679de46b657c
```

El script falla si la huella del certificado no es esa. Un APK firmado con la clave de depuración tampoco la cumple.

## De dónde sale el SHA-256

- **SHA-256 del fichero**: el que aparece en `SHA256SUMS.txt`, junto al APK. Para comprobar una descarga: `shasum -a 256 -c SHA256SUMS.txt` desde la carpeta donde están ambos ficheros.
- **Huella del certificado**: la muestra `apksigner` (la usa el script). Es la que hay que comparar con la huella de referencia de arriba.

La versión 1.1.0 está en `releases/android/` directamente, de antes de crear esta carpeta. Al moverla aquí, regenera su `SHA256SUMS.txt` desde esta carpeta para que liste solo el nombre del fichero.
