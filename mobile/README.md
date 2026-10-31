# Reminiscencia · app Android

App Flutter que escucha la biblioteca publicada en https://reminiscencia.vercel.app.

- Lee el catálogo de la web y guarda una copia para usarla sin conexión.
- Reproducción en segundo plano, con notificación y controles de auriculares (`audio_service`).
- Decisiones y pruebas: ver [ADR-0004](../docs/decisions/ADR-0004-app-android-flutter.md).

## Compilar

```
cd mobile
flutter pub get
flutter analyze
flutter test
flutter build apk --release
```

La firma de publicación usa `android/key.properties` (no versionado). Sin ese fichero, la compilación usa la clave de depuración y no sirve para distribuir.
