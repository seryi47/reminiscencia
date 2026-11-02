# Reminiscencia · app Android

App Flutter que escucha la biblioteca publicada en https://reminiscencia.vercel.app.

- Lee el catálogo de la web y guarda una copia para usarla sin conexión. Se sincroniza al abrir la app, al refrescar y al volver a primer plano si pasaron 10 minutos.
- Sube audio desde el teléfono (WAV, MP3, M4A, FLAC, OGG): se convierte a Opus con FFmpeg y se guarda solo en el dispositivo (ADR-0013).
- Reproducción en segundo plano, con notificación y controles de auriculares (`audio_service`).
- Decisiones y pruebas: ver [ADR-0004](../docs/decisions/ADR-0004-app-android-flutter.md) y [ADR-0013](../docs/decisions/ADR-0013-audio-subido-local-apk.md).

## Compilar

Requisitos: Flutter 3.44.9 (la misma versión que usa la CI), JDK 17 y el SDK de Android.

```
cd mobile
flutter pub get
flutter analyze
flutter test
```

### APK de depuración

```
flutter build apk --debug
```

Resultado: `build/app/outputs/flutter-apk/app-debug.apk`. Va firmado con la clave de depuración: sirve para probar, no para distribuir.

### APK de producción

```
flutter build apk --release
```

Resultado: `build/app/outputs/flutter-apk/app-arm64-v8a-release.apk`, `app-armeabi-v7a-release.apk` y `app-x86_64-release.apk` (`--split-per-abi`, uno por arquitectura). Necesita dos ficheros locales que nunca se versionan: `android/key.properties` y `android/app/upload.jks`. Si faltan, Gradle firma con la clave de depuración y el APK no sirve para distribuir.

Comprueba la firma antes de publicar:

```
../scripts/android/verify_apk.sh build/app/outputs/flutter-apk/app-arm64-v8a-release.apk <huella-de-produccion>
```

La huella de producción y el resto del procedimiento de publicación (versión, etiqueta, secretos y copia de la clave) están en [docs/android/RELEASE.md](../docs/android/RELEASE.md).
