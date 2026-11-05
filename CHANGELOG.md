## Sin publicar: el audio público solo en R2 y reintento del streaming en la APK (2026-11-05, rama `feature/audio-solo-r2`)

- Fase 3 de [ADR-0020](docs/decisions/ADR-0020-audio-en-r2.md): la web ya no lleva audio. Se borra `frontend/web/audio/` (205 canciones, unos 347 MB, ya comprobadas en R2 con el mismo tamaño) y `publish.py` deja de copiarlo; cada canción ocupa ahora una sola copia en el repositorio (`audio-library/audio/`).
- `buzon.yml` y `biblioteca.yml`: el job `publicar` ejecuta `sync_r2.py --aplicar --borrar-sobrantes` antes de subir a main, así una canción nunca aparece en la web sin su audio y una despublicada se borra del bucket. Si R2 falla, no se sube nada. Nunca vacía el bucket.
- `sync_r2.py` toma las canciones públicas de `data/songs.json` y su audio de `audio-library/audio/`, y usa un cliente S3 propio con firma SigV4 (sin boto3): ningún paso con credenciales instala paquetes. Firma comprobada con el ejemplo oficial de AWS y, en local, idéntica a botocore.
- `vercel.json`: redirección temporal de `/audio/:file` a R2 (primera visita sin service worker, respaldo del service worker y de la APK); se quita la cabecera del tipo del audio, que ya no sirve Vercel.
- APK: si una canción en streaming falla desde R2, se reintenta una vez desde la web antes de pasar a la siguiente (`shouldRetryFromFallback`, `_retryFromFallback`).
- Pruebas: backend 756, web 458 unitarias y 148 de extremo a extremo (los audios de prueba salen de `audio-library/audio/`), Flutter 260 y `flutter analyze` sin avisos.

## Sin publicar: «Escuchar» por Dart y apt con reintentos (2026-11-05)

- APK: el audio de YouTube lo descarga Dart por rangos y se lo sirve al reproductor en local (`YoutubeAudioSource`).
- APK, causa real del «Source error» al pulsar «Escuchar»: para algunos vídeos (p. ej. con `gcr` en la URL) YouTube solo sirve el primer ~1 MiB sin PO token y responde 403 después; no era la IP. Ahora el resolvedor comprueba que el audio se pueda leer hasta el final y, si no, «Escuchar» abre el reproductor incrustado de YouTube en un `WebView` (`youtube_embed.dart`, `ui/youtube_embed_dock.dart`), igual que la web. La descarga empieza a la vez y no bloquea la escucha. Probado en emulador Android 15: suena y sigue sonando al cambiar de pestaña.
- Workflows `buzon` y `biblioteca`: «Instalar ffmpeg» con tres intentos y límite de tiempo; un `apt` colgado ya no bloquea la cola de publicación.

# CHANGELOG

## Sin publicar: buscar en YouTube desde el buscador (2026-11-05)

- Si la canción no está en la biblioteca, Buscar la busca en YouTube y ofrece **Escuchar** (suena al momento y empieza la descarga) y **Descargar** (mismo flujo que pegar la URL en Homeostasia). Si hay coincidencias en la biblioteca, solo aparece el botón «Buscar en YouTube» ([ADR-0021](docs/decisions/ADR-0021-buscar-en-youtube.md)).
- Servidor: `GET /api/youtube/search` (HTML de YouTube y, de respaldo, `yt-dlp`). Web: `js/youtube-search.js`, `js/views/youtube-search.js` y `importYoutubeVideo`; la CSP añade `frame-src` de `youtube-nocookie.com`; `SHELL_VERSION = 21`. APK: `YoutubeImporter.search`, `lib/youtube_stream.dart` (`youtube_explode_dart`), `PlaybackPort.playStream` y `lib/ui/youtube_results.dart`. Escuchar en la APK está pendiente de probar en un móvil real.
- Búsqueda tolerante a erratas («kid keo» encuentra «Kidd Keo») y campo «Buscar en esta colección» en «Todas las canciones», álbumes y listas con 6 canciones o más, igual en web (`fuzzyScore`, `filterSongs` en `js/catalog.js`) y APK (`lib/fuzzy_search.dart`).
- Las descargas de YouTube sin artista en los metadatos usan el canal del resultado (web `fallbackArtist`, APK `result.artist`).
- Causa probable de las canciones que se cortaban: el arreglo del panel `.yt-dock` no subió `SHELL_VERSION`, así que el navegador siguió sirviendo el JS viejo una carga más. Ahora `SHELL_VERSION = 22` y, cuando llega una versión nueva, `pwa.js` espera a que no suene nada (audio ni vídeo de «Escuchar») antes de recargar. Pruebas nuevas: el iframe es el mismo tras abrirse la hoja y publicarse (e2e) y una sincronización con canción nueva no corta un stream de YouTube (APK).
- Icono nuevo (chica anime con cascos escuchando música) para la APK y la PWA. `scripts/android/make_icon.py` y `scripts/web/make_icons.py` ahora reducen el maestro `scripts/android/icon_1024.png` con Pillow; `SHELL_VERSION = 23`.
- Descargas de YouTube: un registro «en cola» de otra sesión ya no hace que el buscador diga «ya se había descargado» sin que la canción esté en la biblioteca; se vuelve a descargar y el servidor reconoce lo ya publicado.
- APK: «Escuchar» de YouTube prueba los clientes `android`, `androidVr` y `mweb` (YouTube pedía «confirma que no eres un bot» al único que se usaba) y envía a la URL el User-Agent del cliente que la generó (sin él, `Source error`). La tarjeta de descarga ya no marca «En cola» si la subida falla y enseña el motivo. `SharedUploader.upload` serializa las subidas: varias descargas a la vez ya no lanzan FFmpeg en paralelo («No se pudo convertir este archivo a Opus»). Pendiente de confirmar en el móvil.
- APK: la sincronización con «Guardar para escuchar sin conexión» descarga también con datos móviles (antes solo Wi-Fi); se retira `NetworkInfo`.
- APK, causa raíz de «No se pudo convertir este archivo a Opus»: el paquete `ffmpeg_kit_flutter_new_min` no incluye libopus (solo el codificador experimental `opus`), así que `-c:a libopus` fallaba siempre en el teléfono. Ahora se usa `ffmpeg_kit_flutter_new_audio` (`--enable-libopus`). Probado de extremo a extremo en un emulador Android 15: buscar → Escuchar (suena) → descarga → conversión a Opus → subida → «Publicándose…».
- APK: «Editar detalles», «Añadir a un álbum», «Crear álbum» y «Cambiar portada» se guardan con `POST /api/editar` (ADR-0022), sin abrir GitHub; la portada se recorta a 640 px en el teléfono.
- Web: las mismas ediciones y la portada se guardan desde la hoja con «Guardar» (`js/edit-remote.js`, `api/editar.js`), `SHELL_VERSION` 24.
- Pruebas: web unitarias 457, e2e 147, Flutter 252.
- Web: el reproductor de YouTube de «Escuchar» vive en un panel fijo (`.yt-dock`) fuera de los resultados; ya no se corta cuando se repinta el buscador (p. ej. al abrirse «Subir canciones» al empezar la descarga).
- `buzon.yml` y `biblioteca.yml`: ffmpeg se instala sin `apt-get update` ni paquetes recomendados (con reintento si falla), unos 20 s menos por publicación.

## Sin publicar: cierre de la música y CSP (2026-11-05)

- Web: `media-src` de la CSP admite el bucket de R2 (solo estaba en `connect-src` y el navegador bloqueaba el audio).
- APK: al quitar la app de recientes, `SonidosAudioHandler.onTaskRemoved` para la música y cierra el servicio y la notificación (antes seguía sonando). Pruebas Flutter: 233.

## Sin publicar: buzón más rápido y R2 preparado (2026-11-05)

- Causa de las subidas atascadas: GitHub Actions dejó de arrancar jobs por el límite de minutos de un repositorio privado; el repositorio pasó a público y se relanzó `buzon` (188 canciones).
- `buzon.yml`: el job `autorizar` mira si queda algo en el buzón de `main` (archivos y manifiestos de partes). Los runs que llegan con el buzón ya vacío (cada subida lanza uno, pero el primero procesa todo) omiten `procesar` y `publicar`. Si no puede leer `main`, procesa.
- R2 activo en parte ([ADR-0020](docs/decisions/ADR-0020-audio-en-r2.md)): bucket público con CORS y las 188 canciones subidas con `scripts/sync_r2.py`; el workflow `r2.yml` copia el audio nuevo cuando terminan `buzon` o `biblioteca`; la APK descarga el audio de R2 con Vercel de respaldo (pruebas Flutter: 232). La web también: su service worker pide `/audio/<id>.opus` a R2 y, si falla, al propio origen (`SHELL_VERSION = 20`; la CSP añade solo el bucket a `connect-src`). El audio sigue en Vercel como respaldo.

## Sin publicar: descarga automática en Wi-Fi (2026-11-05)

- APK: «Sin conexión» viene activado por defecto (`biblioteca.sinConexion`, desactivable): con Wi-Fi o cable se descargan todas las canciones y las nuevas en cada sincronización; con datos no se descarga nada, pero lo guardado suena siempre, sin red.
- La descarga escribe a disco en streaming (sin cargar la canción en memoria), usa `.part` que se renombra al terminar (nunca quedan ficheros a medias), reintenta 3 veces y una canción rota ya no aborta las demás. Se guarda el Opus tal cual está publicado, sin copias ni duplicados, para ocupar lo mínimo. Pruebas Flutter: 231.

## Sin publicar: seguimiento de subidas pendientes (2026-11-04)

- «Tus subidas» ya no deja de comprobar una canción tras los primeros diez minutos: cambia a «Aún no aparece en la biblioteca; seguiremos comprobando» y revisa el catálogo cada minuto hasta encontrarla.
- Si se vuelve a importar una pista ya publicada desde la misma playlist, se reconoce por el ID estable del álbum, el título y el artista, y se indica «Ya estaba en la biblioteca» en vez de dejarla publicándose indefinidamente.
- Las lecturas de `songs.json` tienen un límite de 15 segundos para que una petición de red atascada no congele el seguimiento.
- La caché del shell de la web pasa a `SHELL_VERSION = 18`; las subidas antiguas guardadas en el navegador se conservan y vuelven a revisarse.
- Añadidas pruebas de publicación tardía, cancelación por timeout y detección de duplicados sin aceptar coincidencias de otro álbum o artista.
- Recibo por contenido: el id de una canción es `S` + los 16 primeros hexadecimales del SHA-256 de su Opus, así que web y APK calculan el id esperado y lo buscan en `songs.json`. Reconoce con exactitud lo que el buzón ya tenía (aunque el título sea otro) y lo que llegó aunque la respuesta se perdiera. Al abrir la app, una subida con error cuya canción ya está publicada (caso de «[HDLR LIVE] … Sudores Frios») se da por resuelta («Ya estaba en la biblioteca») y su copia local se sustituye por la pública. `SHELL_VERSION = 19`.
- APK: el mismo comportamiento (`upload_tracker.dart`): las pendientes siguen comprobándose pasados diez minutos con la app en primer plano y las pistas de playlist ya publicadas se reconocen por álbum, título y artista. Nueva dependencia directa `crypto` (ya era transitiva). Pruebas Flutter: 229 en verde; sin probar en dispositivo.

## Sin publicar: APK 1.2.4+8 (2026-11-04; web desplegada)

- La lectura de playlists completa el artista de cada vídeo desde las columnas de YouTube Music, también cuando `yt-dlp` devuelve correctamente los títulos.
- La web y la APK conservan álbum y artista por pista hasta el manifiesto de `/api/subir`; el buzón asigna el artista a cada canción, deriva el artista del álbum cuando todas las pistas coinciden y reutiliza el álbum estable por ID de playlist.
- `organize_youtube_playlist` repara en una única petición playlists ya publicadas, sin volver a convertir ni subir el audio.
- Los vídeos individuales y las subidas manuales siguen sin álbum. El flujo conserva la declaración de derechos y la publicación pública habituales.
- Añadidas pruebas de extracción y propagación de artistas, manifiesto, reparación del catálogo y compatibilidad web/Android. El workflow de reparación terminó correctamente y las siete canciones de «Nuestro desacato» aparecen en producción con el artista Desakato; el álbum también muestra ese artista. La APK está en `main`; no se ha publicado una release.

## 1.2.3 (2026-11-03)

- Recompilación de la APK con el importador de YouTube para vídeos individuales y playlists.

## Sin publicar: APK 1.2.4 (2026-11-03; web desplegada)

- Los vídeos individuales obtienen el título original de oEmbed; si no está disponible, prueban los metadatos de la página y `yt-dlp`. Si ninguna fuente lo devuelve, la API falla explícitamente en vez de convertir el ID en un título incorrecto. Desplegado en producción y verificado con «DESAKATO - Cada Vez (Videoclip Oficial)»; la entrada ya publicada se corrigió por la incidencia #28.
- Homeostasia queda dedicada a YouTube en la web y la APK; la subida manual continúa en «Subir canciones».
- Rediseñadas la tarjeta de Homeostasia y su formulario para dar más claridad a la importación.
- La caché de la web pasa a `SHELL_VERSION = 16`; la APK pasa a 1.2.4+7.
- Añadidas pruebas para extracción del título y para mantener separada la subida manual.

## 1.2.2 (2026-11-03)

- Homeostasia: acepta una URL individual de YouTube o una playlist; las playlists se convierten de cuatro en cuatro y también se procesa el último lote incompleto.
- Homeostasia: simplifica la hoja y elimina el texto informativo redundante.
- PWA: actualiza la versión de caché para que los navegadores existentes reciban estos cambios.

## 1.2.1 (2026-11-03)

- APK: espera a guardar el estado final de una subida antes de considerarla terminada, para que las subidas pendientes se recuperen correctamente al volver a abrir la app.

## Sin publicar: web y APK, botón «Homeostasia» (2026-11-03)

Pedido del propietario: un botón nuevo en «Crear», conectado con GitHub, con toda su lógica en un solo archivo.

### Añadido
- `js/views/homeostasia.js`: hoja «Homeostasia» que importa vídeos y playlists de YouTube. Los WAV entran en la misma cola que «Subir canciones» (`ctx.addUploads`): Opus en el navegador, trozos a `/api/subir` y el workflow `buzon` los publica. Muestra el resumen y «Ver el progreso» abre «Subir canciones».
- El importador usa `/api/youtube/playlist` y proxies del mismo origen para yttowav, limita a cuatro conversiones simultáneas, valida WAVs y permite reintentar fallos. Guarda `jobId`/traza por vídeo en `localStorage` y reanuda el mismo trabajo al volver a importar; una respuesta 404 limpia el identificador para un intento nuevo. «Detener seguimiento» o cerrar la hoja detiene las consultas del cliente, no la conversión externa. Para playlists se prefiere `yt-dlp` mediante `YTDLP_PATH` o `PATH`; si no está disponible, se prueban los respaldos de YouTube Music y HTML.
- Diagnóstico en producción: las consultas repetidas eran sondeos del mismo estado, no nuevas conversiones. Una prueba posterior completó conversión, descarga y publicación; el WAV pasó FFmpeg y el Opus se reprodujo en Chrome de escritorio. La reproducción en un Android físico sigue pendiente.
- Menú «Crear»: cuarta opción «Homeostasia». `SHELL_VERSION` pasa a 12.
- PWA: `SHELL_VERSION` pasa a 15 para que los navegadores sustituyan el módulo Homeostasia guardado en la caché.
- Prueba de extremo a extremo: un WAV elegido en «Homeostasia» llega a `/api/subir` en Ogg Opus y se publica.
- APK: botón «Homeostasia» rediseñado como tarjeta en «Tu biblioteca», junto a «Subir canciones», y hoja reorganizada para archivos y YouTube. Mantiene la cola compartida (`uploadShared`) y muestra el resumen.
- APK: Android persiste `jobId`/traza por vídeo en `SharedPreferences`, reanuda el trabajo tras cerrar la hoja o la app y permite detener el sondeo local. Un 404 descarta el trabajo vencido para que el siguiente intento cree otro; no se ha encontrado una ruta pública para cancelar conversiones en yttowav.

## Sin publicar: web, «Subir canciones» acepta archivos ZIP (2026-11-03)

Pedido del propietario: subir un álbum entero en un ZIP, o varios, mezclados con canciones sueltas.

### Cambiado
- «Elegir archivos» admite también `.zip`. El navegador lee cada ZIP y saca todas sus canciones de audio (WAV, MP3, M4A, FLAC, OGG y OPUS), también las de subcarpetas, y cada una sube con el flujo de siempre (conversión a Opus, trozos a `/api/subir` y pasos hasta «Publicada»). El título es el nombre del archivo dentro del ZIP, sin la ruta ni la extensión. Se ignoran las carpetas, `__MACOSX/`, lo oculto (empieza por «.») y lo que no es audio, y la hoja dice cuántos archivos se ignoraron.
- El ZIP no se sube nunca: solo se lee su directorio central y cada canción se descomprime cuando le toca, de una en una; el ZIP se suelta en cuanto cada canción está en GitHub. Sin límites de tamaño (orden del propietario). Las rutas del ZIP solo sirven para sacar el nombre base.
- En la hoja, cada ZIP es un grupo: «Álbum.zip: 12 canciones», lo ignorado y una fila por canción; el resumen general cuenta todas. Un ZIP dañado, en varias partes o sin canciones da un error claro en su fila (sin «Reintentar») y el resto sigue; una canción cifrada dentro del ZIP falla en su fila y las demás suben.
- `SHELL_VERSION` pasa a 11 (módulos nuevos en `SHELL_ASSETS`).

### Añadido
- `js/cuidador/zip.js`: lector mínimo de ZIP sin dependencias (directorio central, ZIP64, entradas «stored» y «deflate» con `DecompressionStream('deflate-raw')`, CRC-32, nombres en UTF-8, Info-ZIP Unicode o página de códigos 437). `js/cuidador/subida-zip.js`: la selección mezclada convertida en subidas con su grupo, y los textos y el agrupado de la hoja. En `subida-estado.js`, `addSources` y el grupo de cada subida (también en `localStorage`).
- Pruebas: `tests/web-unit/zip.test.mjs` (ZIP generados en la prueba: stored, deflate, subcarpetas, `__MACOSX`, ocultos, no-audio, ZIP64, página de códigos 437, cifrado y dañado) y `tests/web-unit/subida-zip.test.mjs` (selección mezclada, textos, agrupado y el gestor de una en una); de extremo a extremo, un ZIP con subcarpetas y `__MACOSX` junto a una canción suelta y un ZIP dañado, con la función y `songs.json` simulados, hasta «Publicada» (con axe-core).

## Sin publicar: APK, «Subir canciones» acepta archivos ZIP (2026-11-03)

Pedido del propietario. Sin probar en dispositivo.

### Añadido
- «Subir canciones» acepta también `.zip`, uno o varios y mezclados con canciones sueltas. El ZIP no se sube: la app lee su índice y saca cada canción de audio (WAV, MP3, M4A, FLAC, OGG u OPUS, también en subcarpetas), de una en una y justo antes de convertirla, que sigue el flujo de siempre (Opus, trozos a `/api/subir` y estados hasta «Publicada»). El título es el nombre del archivo dentro del ZIP, sin ruta ni extensión.
- Se descomprime a trozos, sin cargar el ZIP en memoria (probado con una entrada de 286 MB: unos 25 MB más de memoria), a `subida/zip/` en la carpeta temporal, con un nombre propio por canción: las rutas del ZIP nunca se usan para escribir (zip-slip). Cada copia se borra en cuanto se convierte, y la carpeta al terminar. Se comprueba el CRC de cada canción. Sin límites de tamaño; todo con la app abierta (un isolate de corta vida para no congelar la interfaz), sin trabajos en segundo plano.
- Se ignoran carpetas, `__MACOSX/`, ocultos y lo que no es audio, y se dice cuántos («Se ignoraron 3 archivos que no son canciones.»). Un ZIP dañado o con contraseña muestra su error y los demás siguen; una canción dañada dentro del ZIP queda con «Error» y las demás siguen.
- En «Tu biblioteca» cada ZIP es un grupo («Álbum.zip: 12 canciones») con una fila por canción, debajo del resumen general («0 de 12 publicadas»). El grupo se recuerda al volver a abrir la app.
- `lib/zip_audio.dart` y la dependencia directa `archive` (Dart puro, ya estaba como transitiva). Pruebas con ZIP generados en la prueba: subcarpetas, `__MACOSX`, ocultos, no-audio, dañado, cifrado, nombres con acentos y zip-slip (`test/zip_audio_test.dart`, `test/zip_upload_test.dart` y una prueba de interfaz en `test/app_structure_test.dart`).

## Sin publicar: el buzón acepta ZIP con canciones (2026-11-03)

Pedido del propietario: subir un álbum entero por la página de GitHub en un solo `.zip`.

### Añadido
- `sonidos.buzon`: un `.zip` del buzón se descomprime con `zipfile`, entrada a entrada, en un directorio temporal fuera del repositorio; cada canción (WAV, MP3, M4A, FLAC, OGG u Opus, también en subcarpetas) se convierte, se cataloga y se publica con la licencia del commit, y el ZIP se borra del buzón. El título es el nombre de su archivo sin ruta ni extensión.
- Seguridad: solo se usa el nombre base de cada entrada, copiada a un nombre fijo (protección zip-slip, rutas absolutas y `..`); se ignoran y se cuentan carpetas, `__MACOSX/`, ocultos, enlaces simbólicos, lo que no es un archivo y lo que no es audio. Un ZIP cifrado o dañado se rechaza entero con su motivo y se borra. Sin límite de tamaño (orden del propietario).
- Resultado y resumen del job: lista `zips` con las canciones de cada ZIP y lo ignorado.
- Pruebas: ZIP generados en la prueba (stored y deflate, subcarpetas, `__MACOSX`, no audio, zip-slip, dañado, cifrado, nombres raros y UTF-8 sin marca) con tonos sintéticos de ffmpeg, y el ciclo procesar, empaquetar y publicar. Suite de `backend/`: 715 pruebas en verde.

## Sin publicar: «Subir canciones» muestra cada paso hasta «Publicada» (2026-11-03; en `main`)

Pedido del propietario: la hoja se quedaba en «Subida: llegará a todos en un par de minutos» sin decir si la canción se había subido o publicado.

### Cambiado
- La hoja «Subir canciones» tiene una fila por archivo con icono, nombre (con elipsis; entero en `title`), el paso en texto y una barra: «En cola» → «Convirtiendo a Opus…» → «Subiendo… 45 %» (por trozos) → «Guardada en GitHub» → «Publicándose… (suele tardar 2–3 minutos)» → «Publicada» con «Reproducir», o «Error: <motivo>» con «Reintentar». Arriba, el resumen «2 de 3 publicadas». Se pueden elegir más archivos mientras se suben otros.
- «Publicada» es de verdad: tras guardarse en GitHub, la web lee `data/songs.json` cada 15 s (`cache: 'no-store'`) hasta que aparece una canción con un id que no estaba antes de subir y con ese título (o el que dio el buzón). Si pasan 10 minutos, queda pendiente de aparecer y se consulta cada minuto; una pista ya existente de una playlist se reconoce solo por el ID estable del álbum, el título y el artista.
- La canción sale en la biblioteca en cuanto termina la conversión: su Opus se guarda en este navegador, sale en «Tus subidas» (`#/subidas`), «Añadidas recientemente» y «Todas las canciones» con la etiqueta «Publicándose…» y se puede escuchar ya (`audio/L….opus`). Al publicarse se sustituye por la pública sin recargar ni cortar lo que suena (también en «Me gusta», las listas y la cola) y la copia se borra al dejar de sonar.
- Al cerrar la hoja, las subidas siguen: indicador «Publicándose 1 canción» al pie de «Tu biblioteca», aviso «“<título>” ya está en la biblioteca» y biblioteca al día sola. Las pendientes se guardan en `localStorage` (`reminiscencia.subidas`, con try/catch) y se siguen comprobando al volver; las cortadas a medias quedan con «Reintentar» (reenvía la copia local).
- Accesibilidad: región `aria-live` con cada cambio de paso, el paso siempre en texto (no solo color), foco a la fila al pulsar «Reintentar».
- El service worker pide `data/songs.json`, `folders.json` y `catalog.json` siempre a la red primero y sin caché HTTP (`cache: 'no-store'`); la copia guardada solo responde sin conexión. El arranque de la web los pide con `cache: 'no-cache'`.
- `SHELL_VERSION` pasa a 10 (9 en el commit del service worker; módulo nuevo `js/cuidador/subida-estado.js` en `SHELL_ASSETS`).

### Añadido
- `js/cuidador/subida-estado.js`: máquina de estados, textos, detección de la canción publicada, persistencia y gestor de subidas con dependencias inyectadas. `player.replaceTrack`, `library.replaceSong` y, en `subida-local.js`, `saveUploadCopy`, `readLocalBytes` y `markLocalPublished`.
- Pruebas: `tests/web-unit/subida-estado.test.mjs` (máquina de estados y `songs.json` simulado, también con un título que ya existía), el service worker sin copia vieja de los datos, `replaceTrack` y `replaceSong`; de extremo a extremo, el flujo con la función y `songs.json` simulados: publicada, error y reintento, cerrar la hoja con una subida en curso, la canción que suena desde la copia local y una captura con varios estados (con axe-core).

## Sin publicar: APK, estado de cada subida hasta que se publica (2026-11-03; en `main`)

Sin probar en dispositivo.

### Cambiado
- «Subir canciones» muestra en «Tu biblioteca» una fila por archivo con el nombre (truncado), el estado y una barra de progreso: «Convirtiendo a Opus…», «Subiendo… 45 %» (por trozos), «Guardada en GitHub», «Publicándose… (suele tardar 2–3 minutos)» y «Publicada» con «Reproducir», o «Error: <motivo>» con «Reintentar». Arriba, el resumen («2 de 3 publicadas»). Sustituye al diálogo de resultados.
- En cuanto termina la conversión, la canción aparece en «Todas las canciones» y en «Añadidas recientemente» con el título del archivo sin extensión y «Publicándose…», y suena desde su copia Opus local. Si la subida falla, queda con «Error» y «Reintentar», que reenvía el mismo Opus sin convertir de nuevo.
- Publicada de verdad: tras guardarse en GitHub, la app lee `data/songs.json` cada 20 s hasta que aparece una canción nueva (un id que no estaba antes de subir) con ese título, como mucho 10 minutos y solo con la app en primer plano (sin temporizadores ni peticiones en segundo plano; al volver se comprueba enseguida). Si se pasa, «Sigue procesándose; aparecerá en la biblioteca cuando termine», y la reconoce la siguiente sincronización normal. Al publicarse, la biblioteca se sincroniza sola, sale un aviso en cualquier pestaña y la canción pública sustituye a la provisional sin cortar la reproducción; la copia local se borra cuando ya no suena ni está en la cola.
- Lo que queda por publicar se guarda en `biblioteca-local/subidas/` (fuera de la copia de seguridad) y se sigue comprobando al volver.
- Accesibilidad: cada fila y el resumen son regiones vivas con el estado; botones de 48 dp.

### Añadido
- `lib/upload_tracker.dart`, `lib/ui/uploads_panel.dart` y `test/upload_tracker_test.dart` (estados, detección con `songs.json` simulado, error y reintento, primer plano y segundo plano, recuperación y sustitución en la biblioteca), más pruebas de interfaz en `test/app_structure_test.dart`.

## Sin publicar: «Subir canciones» sube para todos, directo a GitHub (2026-11-03; en `main`)

Decisión del propietario en [ADR-0017](docs/decisions/ADR-0017-subida-directa-github-web-publica.md), que sustituye en ADR-0008 «ni token ni funciones de Vercel en la web». Sin probar en Vercel ni en GitHub.

### Cambiado
- La hoja «Subir canciones» tiene una sola opción: eliges uno o varios archivos (WAV, MP3, M4A, FLAC, OGG u OPUS), se convierten a Opus en el navegador y se suben, de uno en uno y en orden, para todos. Progreso por archivo y resultado («Subida: llegará a todos en un par de minutos» o el error). Texto fijo, sin casilla: «Al subir, declaras que tienes derecho a publicar estos archivos». El título es el nombre del archivo sin extensión.
- Ya no se elige «Solo en este navegador» ni «Para todos». Las canciones locales que ya existan siguen sonando y se borran desde la hoja («Guardadas solo en este navegador», solo si hay alguna). «Desde Internet Archive» pasa a «Importar desde Internet Archive», dentro de la misma hoja.
- `convertToOpus` (`js/cuidador/subida-local.js`) admite `limits: false` y `checkStorage: false`: la subida para todos no tiene límite de tamaño ni de duración.
- Buzón (`backend/sonidos/buzon.py`): une las subidas por trozos de `audio-library/buzon/.partes/<UUID>/` cuando llega su `manifiesto.json` (sin sobrescribir: sufijo si el nombre existe), borra las partes y procesa el archivo con la licencia del commit del manifiesto. Ignora las carpetas sin manifiesto; rechaza y borra las de manifiesto no válido; deja para revisar ids que no son UUID, partes que faltan y elementos que no son partes. `sonidos.paquete` admite borrar esas partes con la acción `buzon`.
- `SHELL_VERSION` pasa a 8 (módulo nuevo `js/cuidador/subida-publica.js` en `SHELL_ASSETS`).

### Añadido
- Función de Vercel `frontend/web/api/subir.js` (Node, sin dependencias): `POST /api/subir` con el trozo en el cuerpo (hasta 4 MiB) y las cabeceras `X-Nombre-Archivo`, `X-Subida-Id`, `X-Parte` y `X-Partes`. Cada trozo es un commit en `main` (API de git de GitHub, con reintento si `main` cambia) en `audio-library/buzon/.partes/<id>/<índice>.part`; el último añade el manifiesto y la línea «Licencia: Subida desde la web pública; quien la sube declara tener derecho a publicarla», que lanza el workflow `buzon`. Valida Ogg Opus en el primer trozo, el nombre y la ruta, nunca sobrescribe y responde en JSON en español. El token sale solo de la variable de entorno `GITHUB_TOKEN` de Vercel y nunca va a registros ni respuestas. Sin límite por hora ni de tamaño de archivo (hasta 1000 trozos).
- Cliente `frontend/web/js/cuidador/subida-publica.js`: trozos de 4 MiB, un UUID por archivo, reintentos ante fallos de red y errores temporales.
- Pruebas: `tests/web-unit/api-subir.test.mjs` (GitHub simulado), `tests/web-unit/subida-publica.test.mjs`, pruebas de extremo a extremo de la subida con la función simulada en el servidor de pruebas (`helpers/servidor.mjs` admite funciones) y pruebas del buzón con partes reales de un Opus sintético (`backend/tests/test_buzon.py`).

### Retirado
- La subida nueva «Solo en este navegador» (ADR-0012) y el enlace «Para todos» a la página de subida de GitHub en la web. La subida desde GitHub sigue disponible para quien tiene permiso de escritura (README).

## Sin publicar: APK, «Subir canciones» directo a la biblioteca común (2026-11-03; en `main`)

Orden del propietario. Necesita la función `frontend/web/api/subir.js` desplegada en Vercel; sin probar en dispositivo.

### Cambiado
- «Subir canciones» sube siempre a la biblioteca común, para todos, sin hojas ni confirmación: se eligen uno o varios archivos, cada uno se convierte a Opus en el teléfono (`ffmpeg_kit_flutter_new_audio`) y se envía de uno en uno a `POST https://reminiscencia.vercel.app/api/subir`, en trozos de hasta 4 MB (`X-Nombre-Archivo` con el nombre original codificado como `encodeURIComponent`, `X-Subida-Id`, `X-Parte`, `X-Partes`, `Content-Type: audio/ogg`). La función guarda el audio en el buzón con el token del servidor; la APK no guarda tokens. El título es el nombre del archivo sin extensión. Sin tamaño máximo por archivo.
- Progreso por archivo y por trozo, y resultado de cada archivo al terminar («Subida: llegará a todos en un par de minutos» o el error de la web). Texto fijo debajo del botón: «Al subir, declaras que tienes derecho a publicar estos archivos».
- Sin red avisa y no intenta nada. Batería: un reintento como máximo por trozo (fallo de red o 5xx; un 4xx no se reintenta); si se pierde la conexión, lo que falta queda pendiente; al salir de la app se para la conversión.
- Se quitan «Solo en este teléfono» y «Para todos» (la página de subida de GitHub). Las canciones ya subidas solo en el teléfono se siguen oyendo y se pueden borrar.

### Añadido
- `lib/shared_upload.dart` y `test/shared_upload_test.dart` (cliente HTTP simulado: éxito, trozos, errores 4xx y 5xx, sin red, varios archivos y nombres con acentos), más pruebas de interfaz en `test/app_structure_test.dart`.

## Sin publicar: artista y año al importar desde Internet Archive (2026-11-03; en `main`)

### Corregido
- Las canciones importadas desde Internet Archive entraban sin artista («Artista desconocido»). Ahora la importación (`backend/sonidos/sources.py` y `pipeline.py`) toma el artista de `creator` en los metadatos del ítem (una lista se une con «, », sin nombres vacíos, repetidos ni con caracteres de control o de formato) y el año de `date` o, si no sirve, de `year` (solo cuatro cifras al principio, como `1925-00-00 00:00:00`). Lo que no cumple los límites del catálogo se recorta (artista de más de 200 caracteres) o se descarta (año fuera de 1000 a 2100, «1920s», «c. 1925»), sin que la importación falle. Solo afecta a las canciones nuevas: una canción ya catalogada no cambia.
- Los límites del artista y del año de una canción están ahora en `backend/sonidos/catalog.py` (`SONG_ARTIST_MAX_CHARS`, `YEAR_MIN`, `YEAR_MAX`), y `issue_request.py` los usa en lugar de tener su copia.
- Pruebas con metadatos simulados, sin red, en `backend/tests/test_sources.py` y `test_pipeline.py`.

## Sin publicar: web con la distribución de Spotify de 2025, portadas y edición de álbumes (2026-11-03; en `main`)

Especificación en `docs/user-experience/DESIGN.md` 3.0.

### Cambiado
- Distribución del reproductor web de Spotify de 2025: barra superior de 64 px («Reminiscencia» en texto, botón Inicio de 48 px y buscador en pastilla de 48 × 480 px con «Explorar»), tres paneles de radio 8 separados 8 px («Tu biblioteca» de 280 a 420 px con separador ajustable, el contenido y el panel «Reproduciendo» de 300 px) y el reproductor de 72 px a todo el ancho. En el teléfono, barra inferior, minirreproductor con el color de la portada y pantalla completa, como la app.
- Colores exactos de Spotify (`#000`, `#121212`, `#1f1f1f`, `#2a2a2a`, `#181818`/`#282828`, `#b3b3b3`, acento `#1ed760` con texto negro y separadores `#3e3e3e`).
- «Tu biblioteca»: «+ Crear» (Lista, Álbum y Subir canciones), chips «Listas» y «Álbumes», buscador pequeño, orden «Recientes», «Orden alfabético» o «Creador», y elementos de 64 px con «Lista • Reminiscencia» o «Álbum • <artista>».
- Inicio: chips «Todo» y «Música», accesos rápidos de 48 px en 4 columnas, «Escuchado recientemente» y tarjetas sin fondo hasta el hover con el botón verde que sube. Ya no hay saludo visible.
- Las carpetas se llaman «Álbumes» en toda la interfaz; la ruta pasa a `#/album/<id>` (`#/carpeta/<id>` sigue valiendo). Página de álbum o lista con degradado del color dominante de la portada, metadatos «artista • año • n canciones, duración», «Me gusta» de toda la colección y tabla con cabecera fija (#, Título, Álbum y reloj).
- Reproductor: «Reproduciendo», letra (desactivado), cola, dispositivo (oculto), volumen y pantalla completa; la cola se abre en el panel derecho en escritorio.
- `js/cuidador/incidencias.js` e `intake.js` aceptan los dos formatos de álbum del backend (F + 16 hexadecimales y 10 hexadecimales); los mensajes y los títulos de las incidencias dicen «álbum».
- `SHELL_VERSION` pasa a 7; el service worker guarda las portadas en su propia caché (`reminiscencia-portadas-v1`).

### Añadido
- Portadas publicadas: `"cover": "covers/<id>.jpg"` en canciones y álbumes, y `"artist"` en los álbumes (`js/catalog.js`); sin portada, la generada. Color dominante en `js/cover-color.js`.
- Hojas de edición (`js/views/edit.js`) que abren una incidencia de GitHub con la etiqueta `biblioteca`: «Editar detalles» de una canción (`edit_song` con título y artista) y de un álbum (`edit_folder` con nombre y artista), «Añadir a un álbum» (`edit_song` con `folder_id`), «Crear álbum» (`create_folder` con artista opcional) y «Cambiar portada» (buzón `audio-library/buzon/portadas`, con el ID como nombre del archivo; solo canciones y álbumes F). Validadas con las reglas del backend y con pruebas de paridad.
- Listas propias con descripción y foto del dispositivo, recortada y reducida a 640 px en el navegador (`js/cover-image.js`) y guardada en IndexedDB.
- Pruebas: unitarias de portadas, color dominante, recorte, detalles de lista, edición y paridad de álbumes; de extremo a extremo, funcionales de la barra superior, el panel «Reproduciendo», las portadas, Tu biblioteca, las hojas de edición y la foto de una lista; axe a 390, 820, 1024 y 1440 px en las pantallas y hojas nuevas; medidas de DESIGN 3.0.

## Sin publicar: APK con portadas, álbumes y edición por GitHub (2026-11-03; en `main`)

### Añadido
- Portadas de canciones y álbumes (`cover: "covers/<id>.jpg"` en `data/songs.json` y `data/folders.json`) en tarjetas, filas, minirreproductor, reproductor completo y notificación. Caché en disco (`lib/covers.dart`) que se ve sin red; cada portada se descarga una vez, sin sondeos; «Guardar para escuchar sin conexión» también las baja (después, solo en Wi-Fi), y solo al refrescar a mano se pregunta si cambiaron (`If-None-Match`). Sin portada, el degradado de siempre.
- Edición de la biblioteca común en el menú de canción y de álbum: «Editar detalles», «Añadir a un álbum», «Crear álbum» y «Cambiar portada». Las tres primeras abren una incidencia nueva con la etiqueta `biblioteca` (`action: organize`, `payload` con `edit_song`, `create_folder` o `edit_folder`), validada antes (nombre de 1 a 80 caracteres, artista de 0 a 80, una línea; álbumes `F` + 16 o 10 hexadecimales). «Cambiar portada» abre la subida de GitHub en `audio-library/buzon/portadas` y muestra el ID para el nombre del archivo, con botón de copiar (solo canciones `S` y álbumes `F`). Hace falta permiso de escritura.
- Listas propias con descripción y portada elegida del teléfono, recortada y reducida a 640 px y guardada solo en él (`listas-portadas/`, excluida de la copia de Android). Dependencia nueva: `image` (pura Dart).
- Pruebas: `covers_test.dart`, `library_requests_test.dart`, `library_ui_test.dart` y `playlist_details_test.dart` (164 pruebas Flutter en verde). Sin probar en dispositivo.

### Cambiado
- «Carpetas» pasa a llamarse «Álbumes» en toda la APK, con el artista como subtítulo; Buscar encuentra álbumes también por artista. «Renombrar lista» pasa a «Editar detalles» (nombre y descripción).

## Sin publicar: portadas y álbumes con artista (2026-11-03; en `main`)

Decisión en [ADR-0016](docs/decisions/ADR-0016-portadas-y-albumes.md). Sin probar en GitHub.

### Añadido
- Portadas de canciones y de carpetas (álbumes) por el buzón: `audio-library/buzon/portadas/<ID>.<jpg|jpeg|png|webp>` (hasta 10 MiB, sin línea de licencia). El workflow `buzon` las convierte con ffmpeg a JPEG de 640×640 (recorte centrado, sin metadatos) en `audio-library/covers/<ID>.jpg` y el catálogo apunta a ellas con `"cover": "covers/<ID>.jpg"`. Un id que no existe o una imagen no válida se rechaza y se borra, con el motivo en el resumen. Código en `backend/sonidos/portadas.py` y `buzon.py`.
- Parte pública: `songs.json` y `catalog.json` llevan `cover` en las canciones públicas que lo tienen; `folders.json` y `catalog.json`, `artist` y `cover` en las carpetas. `sync_public` copia las portadas a `frontend/web/covers/` y borra las que sobran.
- Incidencias: operación `edit_folder` (`folder_id`, `name` y `artist` opcional) y `artist` opcional en `create_folder`. Borrar una carpeta borra su portada.
- Paquete: rutas `audio-library/covers/<ID>.jpg` y `frontend/web/covers/<ID>.jpg` (regenerada en la publicación), y borrado de `audio-library/buzon/portadas/` con la acción `buzon`.
- Pruebas: `backend/tests/test_portadas.py` (conversión real con ffmpeg de imágenes sintéticas, buzón, parte pública y paquete con git real) y casos nuevos en `test_issue_request.py` y `test_ci_library.py`.

### Cambiado
- Las carpetas nuevas tienen id `F` seguida de 16 hexadecimales; las de 10 hexadecimales siguen siendo válidas (ADR-0008, nota del 2026-11-03).

## Sin publicar: interfaz sin usuarios con el aspecto de Spotify (2026-11-03; en `main` con `2ff6694`)

Decisión del propietario ([ADR-0015](docs/decisions/ADR-0015-interfaz-sin-usuarios-aspecto-spotify.md)); especificación en `docs/user-experience/DESIGN.md` 2.0.

### Cambiado
- La web abre directamente en Inicio con la música: una sola biblioteca pública (`data/songs.json` y `data/folders.json`) para todos, sin perfiles ni modos.
- Estructura y aspecto del reproductor web de Spotify con iconos SVG y portadas propios: barra lateral de 280 px con «Inicio», «Buscar» y «Tu biblioteca»; Inicio con saludo según la hora, accesos rápidos y estantes; páginas de carpeta, lista y «Me gusta» con cabecera en degradado y tabla de canciones; Buscar con «Resultado principal» y «Explorar todo»; reproductor de 72 px; en el teléfono, barra inferior, minirreproductor y pantalla completa.
- Tipografía Figtree (SIL OFL 1.1, Fontsource 5.3.0) en 400, 600, 700 y 800, en lugar de Atkinson Hyperlegible Next.
- Reproductor (`js/player.js`) reescrito: cola con «Añadir a la cola», aleatorio, repetir (no, toda la cola, una canción) y volumen; sin reglas clínicas (arranque al 60 %, fundido, límite de volumen, temporizador, bloqueo de pantalla ni eventos del estudio).
- Las canciones subidas a este navegador suenan en `audio/L….opus`, servidas por `sw.js` desde IndexedDB, porque la CSP (`media-src 'self'`) no admite `blob:`. `SHELL_VERSION` pasa a 5.
- `js/cuidador/incidencias.js` pierde la hoja «Gestionar la biblioteca» y sus formularios de publicar, editar y carpetas; conserva la validación del contrato.
- El servidor de las pruebas de extremo a extremo aplica la CSP de `vercel.json` y atiende rangos.

### Añadido
- Listas propias y «Me gusta» guardados solo en este navegador (`js/local-library.js`, IndexedDB `reminiscencia-biblioteca` v1).
- Hoja «Subir canciones»: «Solo en este navegador» (conversión a Opus de ADR-0012, con borrado, que ahora quita también la canción de las listas y de «Me gusta»), «Para todos» (subida de GitHub al buzón `audio-library/buzon`, con las condiciones de licencia) y «Desde Internet Archive» (incidencia validada por `incidencias.js` e `intake.js`).
- Descarga por carpeta o lista para escuchar sin conexión, con aviso y canciones no descargadas marcadas.
- Pruebas: unitarias de catálogo, biblioteca local, reproductor y subida; de extremo a extremo `funcional`, `a11y` (axe a 390, 820, 1024 y 1440 px) y `medidas`.

### Retirado
- Perfiles, asistente de primer perfil, modos paciente y cuidador, PIN, sesiones y registro del estudio, recuerdos, fotografías, observaciones, ajustes de pantalla y copia cifrada `.rmc`: `js/paciente/`, los módulos de `js/cuidador/` salvo `incidencias.js` y `subida-local.js`, `js/store.js`, `js/schema.js`, `js/crypto.js`, `js/backup.js`, `js/prefs.js`, las hojas de estilo anteriores, las fuentes Atkinson y sus pruebas. La base `reminiscencia` de la versión anterior no se abre ni se borra (ADR-0015, decisión 3).

## Sin publicar (2026-11-02)

### Añadido
- Buzón de canciones (ADR-0014): quien tiene permiso de escritura sube audio (WAV, MP3, M4A, FLAC u OGG) a `audio-library/buzon/` desde la página de subida de GitHub, y el workflow nuevo `buzon.yml` lo convierte a Opus, lo añade al catálogo con el nombre del archivo como título, regenera la parte pública y lo borra del buzón. Una línea `Licencia: <texto>` en el commit hace la canción pública con fuente «Subida por <cuenta>»; sin ella entra privada, con la licencia «Sin declarar», que no se puede publicar. Mismos tres jobs y misma cola que `biblioteca.yml`; el paquete admite la acción `buzon`, la única que puede borrar del buzón. Código en `backend/sonidos/buzon.py` y `scripts/buzon.py`; pruebas en `backend/tests/test_buzon.py` y `test_buzon_workflow.py`. Probado en GitHub el 2026-11-03 por la vía privada: la ejecución por push no procesó nada porque el evento no traía las listas de archivos; `34a1f06` procesa lo que hay en el buzón cuando el evento no nombra archivos y añade el lanzamiento manual, que dio de alta la prueba como privada (`4f6c73d`). Sin probar: una subida con «Licencia: …».
- APK: subida de audio desde el teléfono (WAV, MP3, M4A, FLAC, OGG) convertida a Opus con FFmpeg, solo en el dispositivo y sin publicar (ADR-0013). Sincronización al abrir, al volver a primer plano y al refrescar; descarga sin conexión solo en Wi-Fi; las canciones retiradas dejan su audio cuando ya no están en uso.
- Datos locales del cuidador (almacén IndexedDB, copia cifrada y validación) y PWA con service worker, manifiesto e iconos para escuchar sin conexión (`8a19a09`).
- Integración continua de la web en `.github/workflows/web.yml`: sintaxis y pruebas con `node:test` (`7f93756`).
- Investigación verificada (`4b79df2`): bibliografía maestra en `BIBLIOGRAPHY.md`, `RESEARCH.md`, `ALZHEIMER_RESEARCH.md`, `METHODOLOGY.md` y `SECURITY.md`.
- Documentación técnica (`43034bc`): ADR-0009 de interfaz única y datos locales, `docs/audio-processing/AUDIO_ENGINE.md`, `docs/datos/DATABASE.md` y `docs/user-experience/PLAYER.md`.
- Backend de la biblioteca por incidencias y paquete de cambios (`b6c986b`; ADR-0008): el procesado deja un paquete de cambios y la publicación lo valida y lo aplica por separado. El paquete solo admite rutas de audio con identificador y de los tres JSON públicos, y solo puede borrar audio; el catálogo y los datos públicos se reescriben. El workflow `library` pasa a `biblioteca`.
- Web con gestión por incidencias y la misma lista de bloqueo que el backend (42 entradas), con rechazo de caracteres de formato (`14dbe82`).
- Prueba real de importar, publicar y despublicar «Tell me pretty maiden» con las incidencias #1, #2 y #3, todas cerradas. La pista queda en el catálogo con `public: false`.
- Prueba real de importación privada por incidencia (#5, 2026-11-02): la ejecución 41490773271 pasa por `autorizar`, `procesar` y `publicar` en success. El commit `e988292` del bot («biblioteca: import») añade el audio y el catálogo de la canción (+16 líneas en `catalog.json`), y la parte pública no cambia. Sin probar: publicar una canción (la parte pública cambia) y la concurrencia `queue: max`.
- Interfaz única (ADR-0009): modo paciente (escucha, listas, carpetas, búsqueda y salida con PIN) y modo cuidador (inicio, biblioteca, perfiles, recuerdos, observaciones, copia cifrada, PIN local y ajustes) en una sola página (`frontend/web/index.html`, `js/app.js`, `js/paciente/`, `js/cuidador/` y `css/`). Los datos del cuidador están en IndexedDB (versión 3), con copia cifrada `.rmc` y uso sin conexión.
- Pruebas de extremo a extremo y de accesibilidad en `tests/web-e2e/` (puppeteer-core y axe-core) y workflow `web-e2e.yml`. Resultado de la última ejecución (2026-11-02, `npm test` en `tests/web-e2e/`, Chrome local): 148 casos, 147 en verde y 1 fallo. El fallo es «Biblioteca a 1440 px: se ven 11 filas completas de la lista» (`cuidador.e2e.mjs`, línea 81): la página muestra 10 filas completas, no 11. Esa ejecución era sobre `c663e5c`. En `main` (`8638a86`) la prueba ya espera 10 filas (commit `1923a55`); la suite completa no se ha repetido sobre `8638a86`. Incluye la prueba P6 de 15 minutos con el temporizador real, que pasa. Pruebas unitarias de la web (`node --test`) en `8638a86`: 650 de 650 en verde.

### Cambiado
- APK rediseñada con la estructura y el aspecto de la app de Spotify, sin su marca (decisión del propietario, 2026-11-03; en `main` con `93a4d53`, versión 1.2.0+3 en `2117e04`). Barra inferior «Inicio», «Buscar» y «Tu biblioteca»; minirreproductor de 56 dp con progreso; reproductor a pantalla completa con aleatorio y repetir; páginas de carpeta y lista con cabecera en degradado; tipografía Figtree (OFL) incluida. «Subir canciones» ofrece «Solo en este teléfono» o «Para todos» (abre la subida de GitHub en `audio-library/buzon`). Se quita el modo paciente: la app no tiene usuarios ni modos y abre en Inicio; «Favoritos» pasa a llamarse «Me gusta». Pruebas Flutter: 109 en verde. Sin probar en dispositivo.
- Rediseño de la interfaz con la estructura de la web de Apple Music (barra lateral, riel, barra de pestañas y reproductor; decisión del propietario, 2026-11-02): commits `8bf94a6`, `c9deb31` y `3b5d75b`, fusionados en `main` con `0629371`.
- La sesión de escucha se abre solo desde la entrada en C4; arrancar o reabrir la app no abre sesión (`a82bece`, `97f07e5`).
- «Gestionar la biblioteca» pasa de la página de escucha a Biblioteca del modo cuidador (`js/cuidador/incidencias.js`). La petición sigue siendo una incidencia de GitHub con la etiqueta `biblioteca` (ADR-0008).
- Publicar regenera la parte pública desde el catálogo (`ba1825e`; ADR-0011). El paquete del procesado ya no lleva `frontend/web/data/*.json` ni el audio publicado: `publicar` los regenera con `sonidos.publish.sync_public` después de aplicar el paquete, compara el audio por contenido, valida el identificador de cada canción pública y avisa, sin fallar, de lo que la regeneración cambia fuera del paquete o sustituye.
- Revisión de la bibliografía, consulta del 2026-11-02 (`61eb229`): quedan resueltos 17 de los 35 pendientes de `BIBLIOGRAPHY.md`, con Crossref y PubMed (y, según el caso, Europe PMC, la página de la revista en Cambridge Core y el manuscrito aceptado en PMC). Quedan 18 abiertos. Corregido: el resumen de Garrido et al. 2018 no comunica resultados sobre la ansiedad, y se retira esa atribución de `RESEARCH.md` y `METHODOLOGY.md`.
- DESIGN corregido según el código: el bloqueo del PIN es de 60 s también en P-16 (antes decía 45 s), y la identidad visual replica la estructura de Apple Music web por decisión del propietario.

- Política de contenido (CSP) en `frontend/web/vercel.json`, en `main`.
- Colaboradores con permiso de escritura e Internet Archive `/download/` (`8d29978`, fusionados en `main` con `5c060c1`).

### Retirado
- Página de escucha anterior (`app.js`, `styles.css` y `listen.css` de la raíz de `frontend/web/`) y la sección «Gestionar» de esa página (`js/gestion.js` y `tests/web-unit/gestion.test.mjs`), sustituidas por la interfaz única (ADR-0009). `js/intake.js` y `tests/web-unit/intake.test.mjs` siguen en `main`: la app no los usa, pero `js/offline-core.js` los lista en `SHELL_ASSETS`. Pendiente de retirar (ver ROADMAP).
- Administración de la web pública (`0fa6ed3`): se borran `frontend/web/admin/`, las funciones `api/` (catálogo, despacho y ejecuciones) y `lib/` (autenticación, GitHub y validación).


## Integrado: app Android y entrega de APK (2026-10-31)

### Añadido
- App Android: listas de reproducción locales (crear, renombrar, borrar, añadir y quitar canciones), favoritos, ajustes persistentes (tamaño de texto de 1.0 a 1.6, modo paciente, alto contraste, reducir animaciones), diseño de tableta a partir de 720 dp con navegación lateral, gestión de errores con reintento e icono propio generado con `scripts/android/make_icon.py`.
- 48 pruebas Flutter en verde; análisis estático sin avisos.
- Workflow `android.yml`: compilación de depuración y de producción por etiquetas `android-v*`, verificación de la firma con la huella del certificado de producción y publicación en GitHub Releases.
- Carpetas `releases/android/debug/` y `releases/android/production/` (los APK no se versionan) y `docs/android/RELEASE.md` con el procedimiento para una versión nueva.
- `scripts/android/verify_apk.sh` para comprobar paquete, versión y firma de un APK.

### Pendiente de comprobar
- El workflow `android.yml` todavía no se ha ejecutado en GitHub Actions: se probará con la primera etiqueta.
- Los secretos de firma (`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`) hay que crearlos en el repositorio; no están configurados.

## En curso (plan v2)

- Auditoría del brief: hecha. Resultado estricto: 0 requisitos completamente cumplidos, 40 parciales, 8 pendientes y 1 descartado (plataformas de vídeo, por motivos legales).
- Gestión pública sin administración: peticiones como incidencias de GitHub, solo del propietario (backend y web en ramas separadas, con revisión de seguridad).
- Investigación, metodología del piloto, seguridad y RGPD, y experimento reproducible de compresión (ramas con verificación independiente de las referencias).
- Datos locales del cuidador (perfiles, fotos, recuerdos, listas, observaciones, historial, copia cifrada y PIN local) y uso sin conexión (service worker, manifiesto e iconos).
- Diseño de la interfaz: panel de tres propuestas, jurado y síntesis.
- La administración en Vercel queda sin uso; se retira junto con `ADMIN_PASSWORD` y `GITHUB_TOKEN`, que ya no hacen falta.

## Administración en Vercel, catálogo versionado y app 1.1.0

### Añadido
- Catálogo `audio-library/indexes/catalog.json` como fuente de verdad (ADR-0007): carpetas, metadatos, licencia, hash y estado público.
- Workflow `library` en GitHub Actions: importar por URL, publicar/despublicar, crear/renombrar/borrar carpetas y editar metadatos. Probado en GitHub con ítems reales de Internet Archive.
- Administración en `/admin/` de la web de Vercel, con contraseña (`ADMIN_PASSWORD`) y falla cerrada. Funciones `api/catalog`, `api/dispatch` y `api/runs`, con validación de entradas y permisos mínimos.
- Web de escucha rediseñada: lista densa, carpetas, búsqueda, reproductor fijo y vista a pantalla completa en el teléfono.
- App Android 1.1.0: biblioteca desde Vercel, copia para escuchar sin conexión y reproducción probada con la red apagada.
- ADR-0005 (entrada por URL con licencia), ADR-0006 (audio publicado en el repositorio), ADR-0007 (catálogo y flujo desde Vercel).

### Corregido
- La web daba 404 en el audio porque estaba fuera de Git (ADR-0006).
- Reproducción bloqueada en la APK de publicación: caché de audio en 127.0.0.1 con HTTP sin cifrar (solo se permite ese destino).
- La app se bloqueaba al arrancar el servicio de audio: faltaba el permiso `WAKE_LOCK`.
- La biblioteca no cargaba si fallaba el audio: ahora la lista se muestra aunque el reproductor falle.
- El directorio raíz de Vercel estaba vacío: cada despliegue habría publicado el repositorio entero. Fijado a `frontend/web`.

### Retirado
- Panel local (`python -m sonidos serve`), API de FastAPI, cola en memoria y `frontend/admin` local.
- Base de datos SQLite como fuente de verdad (migrada al catálogo y eliminada en local).
- Audio empaquetado dentro de la APK.

### Pendiente
- Configurar `ADMIN_PASSWORD` en Vercel (Production) y probar el panel de extremo a extremo.
- Pruebas de la app en dispositivo físico (llamadas, Bluetooth, TalkBack).
- Copia de seguridad de la clave de firma de Android fuera de este equipo.

## [Sin publicar]

### Añadido (audio subido desde este dispositivo, ADR-0012)
- Biblioteca del cuidador: «Añadir audio desde este dispositivo». Los archivos (WAV, MP3, M4A, OGG, FLAC) se convierten a Opus en el navegador con AudioEncoder (mono 32 kbps, estéreo 48 kbps) y se guardan solo en IndexedDB de ese navegador (base `reminiscencia-audio-local`, versión 1).
- Límites de 60 MB y 20 minutos por archivo; comprobación de espacio con `navigator.storage.estimate()`. Sin AudioEncoder con Opus, aviso en la interfaz.
- Las canciones aparecen en la biblioteca y en el modo paciente como las del catálogo. No se suben a ningún servidor, no van a GitHub ni a la web pública y no entran en la copia cifrada.
- Módulo `frontend/web/js/cuidador/subida-local.js`; `SHELL_VERSION` 3 con el módulo en `SHELL_ASSETS`.
- Pruebas: `tests/web-unit/subida-local.test.mjs`. Conversión real probada en Chrome con WAV, MP3, FLAC y M4A.
- Borrado de canciones subidas desde este navegador: «Borrar de este navegador» en el menú de la fila, con confirmación explícita. Solo para las locales; quita el registro de IndexedDB y el catálogo en memoria.
- `SHELL_VERSION` 4 (la caché del shell cambia porque cambian `asistente.js`, `biblioteca.js` y `subida-local.js`).
- Asistente de primer perfil: el título «Nuevo perfil» deja de repetirse a la vista (el marco ya lo muestra); el H2 sigue en el árbol de accesibilidad.

### Pendiente de confirmar
- Si la copia cifrada debe llevar los metadatos de estas canciones (el encargo decía «solo metadatos»). Ahora no los lleva.

### Añadido
- Estructura inicial del proyecto y control de versiones.
- Núcleo de backend en Python: lectura de metadatos con ffprobe, huella SHA-256, perfiles de transcodificación (Opus, AAC, MP3), biblioteca SQLite con detección de duplicados y licencia obligatoria, índice JSON sin rutas locales, CLI.
- 11 pruebas automatizadas con audio sintético generado por ffmpeg; todas pasan en local.
- Flujo de integración continua en GitHub Actions (Python 3.12 y 3.13).
- Documentación: CLAUDE.md, PROJECT_MASTER.md, RESEARCH.md, BIBLIOGRAPHY.md, ROADMAP.md, ADR-0001 a ADR-0003, COMPRESSION.md.

### Añadido (límites y publicación)
- `sonidos/limits.py`: constantes de los límites verificados de GitHub; rechaza assets de release de 2 GiB o más; reparte en lotes de hasta 999 assets más manifiesto; audita los ficheros versionados (aviso > 50 MiB, bloqueo > 100 MiB, repositorio > 1 GiB ideal y > 5 GiB máximo).
- `sonidos/release.py`: manifiesto SHA256SUMS y comandos `gh release create/upload`. Sólo simula salvo que se pida ejecutar.
- `scripts/check_repo_limits.py` y job de GitHub Actions que falla si el repositorio incumple los límites.
- 11 pruebas nuevas (22 en total).

### Añadido (biblioteca, web y Android)
- Ocho grabaciones de dominio público de Internet Archive (declaradas en el ítem original), importadas con su licencia y con variante Opus 64 kbps. Verificadas por SHA-256 tras descargarlas de la release.
- Publicación del lote de audio como release privada `audio-2026-10-31-01` en GitHub, con manifiesto SHA-256. Corregido un fallo: las variantes tenían el mismo nombre y se pisaban.
- Web de reproducción en HTML estático, desplegada en Vercel. Probada en Chrome: carga, reproducción, siguiente y pausa.
- App Flutter (`mobile/`) con reproducción en segundo plano, controles multimedia y auriculares. Probada en emulador Android 15.
- `sonidos build-web` y `scripts/sync_mobile_assets.sh`.
- APK firmada para producción (release `apk-2026-10-31-produccion`), verificada con apksigner y probada otra vez en emulador tras reinstalar.
- Job de Flutter en GitHub Actions (versión 3.44.9): análisis y pruebas.
- Web pública en https://reminiscencia.vercel.app, con `vercel.json` que sirve los `.opus` como `audio/ogg; codecs=opus`.

### Añadido (entrada por URL y panel)
- ADR-0005: entrada por URL restringida. Internet Archive con licencia en los metadatos y ficheros directos con licencia declarada. Plataformas de vídeo y streaming bloqueadas por código.
- `sonidos/sources.py`, `sonidos/intake.py`, `sonidos/api.py`: resolución, descarga con límite de 200 MB e importación.
- Panel local `frontend/admin` (importar, buscar, estadísticas, preparar la web) servido por `python -m sonidos serve`.
- Pista nueva importada y publicada: Christmas Bells (Internet Archive, dominio público declarado). Web pública con 9 pistas.
- Corregido: las rutas guardadas en la base de datos apuntaban a la carpeta antigua tras renombrar el proyecto.

### Añadido (procesado en segundo plano)
- `sonidos/jobs.py`: cola de importaciones con un único hilo trabajador. `POST /api/intake` responde 202 al instante y `GET /api/jobs/{id}` da el estado. Una URL no admitida se rechaza antes de encolar.
- El panel muestra el progreso de cada importación.
- Pruebas en vivo: respuesta en 39 ms; importación de `DvorakSymphonyNo.9fromTheNewWorld` (dominio público declarado) completada en segundo plano, con audio Opus de 8 min 26 s.
- Limitación: el estado de los trabajos vive en memoria.

### Decidido
- Sin descarga desde YouTube ni otras plataformas (ADR-0002).
- Audio de reproducción en GitHub Releases; el repositorio contiene índice, código y documentación (ADR-0003).
