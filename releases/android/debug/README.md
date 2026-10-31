# APK de depuración

Aquí van los APK de depuración de la app Android (`es.orbitalabs.reminiscencia`) que se compilan para probar. No son para distribuir.

## Qué contiene

- `reminiscencia-<versión>-debug.apk`: resultado de `flutter build apk --debug`. Va firmado con la clave de depuración de Android, que es distinta en cada equipo. Sirve para instalar y probar, no para publicar.

## Versionado

Los APK no se versionan en Git: superan el límite práctico del repositorio y `.gitignore` los excluye (`releases/**/*.apk`). Se publican como adjuntos de la release de GitHub `android-vX.Y.Z` y como artefacto `apk-depuracion` del workflow [android](../../../.github/workflows/android.yml). Esta carpeta solo guarda este README y `.gitkeep`.

## Comprobar un APK

Desde la raíz del repositorio:

```
scripts/android/verify_apk.sh releases/android/debug/reminiscencia-<versión>-debug.apk
```

El script muestra el paquete, el versionCode, el versionName, la firma y las huellas SHA-256 descritas abajo.

## De dónde sale el SHA-256

- **SHA-256 del fichero**: es el que aparece en `SHA256SUMS.txt`, y el script lo imprime en su primera línea. Para comprobar una descarga, sitúate en la carpeta donde están el APK y `SHA256SUMS.txt` y ejecuta `shasum -a 256 -c SHA256SUMS.txt`.
- **Huella del certificado de firma**: la muestra `apksigner` (la usa el script). Identifica quién firmó el APK. En depuración cambia de un equipo a otro, por eso no se fija en ningún sitio.

Para generar `SHA256SUMS.txt` a mano, hazlo dentro de esta carpeta, para que liste solo nombres de fichero:

```
cd releases/android/debug && shasum -a 256 reminiscencia-<versión>-debug.apk > SHA256SUMS.txt
```
