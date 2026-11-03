# Reminiscencia · app Android

App Flutter que escucha la biblioteca publicada en https://reminiscencia.vercel.app.

- Lee el catálogo de la web y guarda una copia para usarla sin conexión. Se sincroniza al abrir la app, al refrescar y al volver a primer plano si pasaron 10 minutos.
- Sube audio desde el teléfono (WAV, MP3, M4A, FLAC, OGG): se convierte a Opus con FFmpeg y se guarda solo en el dispositivo (ADR-0013).
- Reproducción en segundo plano, con notificación y controles de auriculares (`audio_service`). Aleatorio y repetir también desde la notificación.
- Sin usuarios, perfiles ni modos: la app abre en Inicio y todos ven el mismo catálogo. Las listas y «Me gusta» se guardan solo en el teléfono.

## Interfaz

Tiene la estructura y el aspecto de la app de Spotify, sin su logotipo, iconos de marca ni imágenes (decisión del propietario, 2026-11-03). Los colores están en `lib/theme.dart`: fondo `#121212` y negro `#000`, tarjetas `#181818` (pulsadas `#282828`), superficies elevadas `#242424`, texto `#fff` y secundario `#b3b3b3`, acento `#1fdf64` con texto negro encima. Tipografía Figtree (pesos 400 a 800) incluida en `assets/fonts/` con su licencia OFL, que también aparece en Ajustes › Licencias.

- Barra inferior con «Inicio», «Buscar» y «Tu biblioteca» (`lib/ui/home_shell.dart`); cada pestaña tiene su propia pila de páginas. A partir de 720 dp la barra pasa a ser una navegación lateral.
- Minirreproductor de 56 dp redondeado encima de la barra, con una línea fina de progreso y «Me gusta». Al tocarlo se abre el reproductor a pantalla completa: portada, título, artista, «Me gusta», barra de progreso, aleatorio, anterior, reproducir, siguiente y repetir (`lib/ui/player.dart`).
- Inicio: saludo según la hora, accesos rápidos en cuadrícula y estantes (carpetas, añadidas recientemente y tus listas). Buscar: campo redondeado y «Explorar todo». Tu biblioteca: «Canciones que te gustan», listas, carpetas, lo subido en el teléfono y el botón «Subir canciones».
- Páginas de carpeta o lista con cabecera en degradado, botón verde de reproducir y filas de canción (portada de 40 dp, título, artista y menú).
- Las canciones no traen imagen: la portada es un degradado estable calculado a partir del identificador.
- «Subir canciones» ofrece «Solo en este teléfono» (la subida local de ADR-0013) y «Para todos», que abre en el navegador la página de subida de GitHub (`audio-library/buzon`). Hace falta permiso de escritura en el repositorio y el mensaje del commit debe llevar «Licencia: …»; sin ella, las canciones quedan privadas.
- Accesibilidad: objetivos táctiles de 48 dp, etiquetas para lectores de pantalla y contraste AA; las pruebas lo comprueban con las pautas de `flutter_test`. Ajustes conserva el tamaño de texto (hasta 160 %), alto contraste y reducir animaciones.
- Batería: la barra de progreso solo se redibuja mientras suena, la app está en primer plano y el reproductor está a la vista; no hay sondeos ni bloqueos fuera de la reproducción.
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
