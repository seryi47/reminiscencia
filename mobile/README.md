# Reminiscencia · app Android

App Flutter que escucha la biblioteca publicada en https://reminiscencia.vercel.app.

- Lee el catálogo de la web y guarda una copia para usarla sin conexión. Se sincroniza al abrir la app, al refrescar y al volver a primer plano si pasaron 10 minutos.
- «Subir canciones» sube a la biblioteca común, para todos (WAV, MP3, M4A, FLAC, OGG): cada archivo se convierte a Opus con FFmpeg en el teléfono y se envía a la función de la web `https://reminiscencia.vercel.app/api/subir`, que lo guarda en el buzón del repositorio con el token del servidor. La app no guarda ningún token. Las canciones subidas antes «Solo en este teléfono» (ADR-0013) se siguen oyendo y se pueden borrar, pero ya no se añaden nuevas.
- Reproducción en segundo plano, con notificación y controles de auriculares (`audio_service`). Aleatorio y repetir también desde la notificación.
- Sin usuarios, perfiles ni modos: la app abre en Inicio y todos ven el mismo catálogo. Las listas y «Me gusta» se guardan solo en el teléfono.

## Interfaz

Tiene la estructura y el aspecto de la app de Spotify, sin su logotipo, iconos de marca ni imágenes (decisión del propietario, 2026-11-03). Los colores están en `lib/theme.dart`: fondo `#121212` y negro `#000`, tarjetas `#181818` (pulsadas `#282828`), superficies elevadas `#242424`, texto `#fff` y secundario `#b3b3b3`, acento `#1fdf64` con texto negro encima. Tipografía Figtree (pesos 400 a 800) incluida en `assets/fonts/` con su licencia OFL, que también aparece en Ajustes › Licencias.

- Barra inferior con «Inicio», «Buscar» y «Tu biblioteca» (`lib/ui/home_shell.dart`); cada pestaña tiene su propia pila de páginas. A partir de 720 dp la barra pasa a ser una navegación lateral.
- Minirreproductor de 56 dp redondeado encima de la barra, con una línea fina de progreso y «Me gusta». Al tocarlo se abre el reproductor a pantalla completa: portada, título, artista, «Me gusta», barra de progreso, aleatorio, anterior, reproducir, siguiente y repetir (`lib/ui/player.dart`).
- Inicio: saludo según la hora, accesos rápidos en cuadrícula y estantes (álbumes, añadidas recientemente y tus listas). Buscar: campo redondeado y «Explorar todo» (busca también álbumes por su artista). Tu biblioteca: «Canciones que te gustan», listas, álbumes, lo subido antes solo en el teléfono (si hay algo) y el botón «Subir canciones». En los datos los álbumes siguen siendo carpetas (`data/folders.json`); en la interfaz se llaman «Álbumes» y llevan el artista como subtítulo.
- Páginas de álbum o lista con cabecera en degradado, botón verde de reproducir y filas de canción (portada de 40 dp, título, artista y menú).
- Portadas (`lib/covers.dart`): las canciones y los álbumes pueden traer `"cover": "covers/<id>.jpg"` en `data/songs.json` y `data/folders.json`; la imagen está en `https://reminiscencia.vercel.app/<cover>`. Se ven en tarjetas, filas, minirreproductor, reproductor completo y notificación (como fichero local). Sin portada, un degradado estable calculado a partir del identificador. Se guardan en disco (`biblioteca/portadas/`, con un índice) y se ven sin red una vez descargadas. Sin sondeos: cada portada se descarga una vez, al mostrarse; «Guardar para escuchar sin conexión» las descarga también todas, y después las sincronizaciones bajan las nuevas solo en Wi-Fi, como el audio; tras sincronizar con la web se borran las que el catálogo ya no usa, y solo al deslizar para refrescar se pregunta a la web si cambiaron las guardadas (petición condicional con `If-None-Match`).
- Edición de la biblioteca común (`lib/library_requests.dart` y `lib/ui/library_edit.dart`), igual que la web: el menú de canción y el de álbum ofrecen «Editar detalles», «Añadir a un álbum» (en el álbum, «Añadir canciones a este álbum»), «Crear álbum» y «Cambiar portada». Las tres primeras abren en el navegador una incidencia nueva de GitHub con la etiqueta `biblioteca`, con `action: organize` y `payload: <JSON en una línea>` (`edit_song`, `create_folder` o `edit_folder`), validada antes: nombre de 1 a 80 caracteres y artista de 0 a 80, en una línea. «Cambiar portada» abre la subida de GitHub en `audio-library/buzon/portadas` y muestra el ID que debe llevar el archivo, con un botón para copiarlo; solo para canciones (`S` + 16) y álbumes `F` + 16. Hace falta permiso de escritura en el repositorio. La app no llama a la API de GitHub ni guarda ninguna sesión.
- Listas propias: nombre, descripción (hasta 300 caracteres) y portada elegida del teléfono, recortada en cuadrado y reducida a 640 px (`lib/playlist_covers.dart`). La imagen se guarda solo en el teléfono (`listas-portadas/`, fuera de la copia de seguridad del sistema).
- «Subir canciones» (`lib/shared_upload.dart`): una sola opción, sin hojas ni confirmación. Comprueba que hay red (sin red avisa y no intenta nada), abre el selector para elegir uno o varios archivos y los sube de uno en uno: convierte cada uno a Opus (`ffmpeg_kit_flutter_new_min`, sin el límite de 60 MB y 20 minutos de la subida local) y lo envía en trozos de hasta 4 MB (Vercel acepta 4,5 MB por petición) con `POST /api/subir`, `Content-Type: audio/ogg` y las cabeceras `X-Nombre-Archivo` (nombre original, codificado como `encodeURIComponent`), `X-Subida-Id` (UUID por archivo), `X-Parte` (desde 0) y `X-Partes`. El título de la canción es el nombre del archivo sin extensión. Muestra el progreso por archivo y por trozo y, al terminar, el resultado de cada archivo («Subida: llegará a todos en un par de minutos» o el error de la web). Debajo del botón, el texto fijo «Al subir, declaras que tienes derecho a publicar estos archivos». Batería: cada trozo se reintenta una vez como máximo (fallo de red o 5xx; un 4xx no se reintenta); si se pierde la conexión, el resto queda pendiente sin más intentos, y al salir de la app se para la conversión.
- Accesibilidad: objetivos táctiles de 48 dp, etiquetas para lectores de pantalla y contraste AA; las pruebas lo comprueban con las pautas de `flutter_test`. Ajustes conserva el tamaño de texto (hasta 160 %), alto contraste y reducir animaciones.
- Batería: la barra de progreso solo se redibuja mientras suena, la app está en primer plano y el reproductor está a la vista; no hay sondeos ni bloqueos fuera de la reproducción.
- Decisiones y pruebas: ver [ADR-0004](../docs/decisions/ADR-0004-app-android-flutter.md), [ADR-0013](../docs/decisions/ADR-0013-audio-subido-local-apk.md) (subida local de antes), [ADR-0016](../docs/decisions/ADR-0016-portadas-y-albumes.md) (portadas y álbumes) y [ADR-0017](../docs/decisions/ADR-0017-subida-directa-github-web-publica.md) (subida para todos por `/api/subir`, probada en producción desde la web el 2026-11-03).

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
