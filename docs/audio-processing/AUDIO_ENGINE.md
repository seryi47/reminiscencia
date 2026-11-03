# Motor de audio de Reminiscencia

> **Nota de estado (2026-11-03).** La parte 2 describe el reproductor de la interfaz única (ADR-0009), **retirado** por [ADR-0015](../decisions/ADR-0015-interfaz-sin-usuarios-aspecto-spotify.md) (decisión 9): ya no hay modos paciente y cuidador, límite de volumen por perfil, arranque al 60 % con fundido, temporizador, bloqueo de pantalla ni eventos del estudio. El reproductor actual (cola, aleatorio, repetir y volumen) está en [PLAYER.md](../user-experience/PLAYER.md). La parte 1 no describe el buzón (`buzon.yml` y `backend/sonidos/buzon.py`, ADR-0014), que convierte con el mismo perfil `opus-64k`.

Estado: la parte 1 describe `main` (8a19a09), ya fusionado (`main` está ahora en 7f93756, que solo añade `web.yml`, no descrito aquí). La parte 2 describe `frontend/web/js/player.js` de la interfaz única (feat/ui-publica, commit 9d4ae8f; ADR-0009). Las frases de la parte 2 que dicen que el reproductor no está conectado a la interfaz son anteriores a la integración y están pendientes de revisión (ver ROADMAP). La rama feat/gestion-backend (cabeza 22b444a, que incluye 679b11c) cambia el workflow y varios módulos de la parte 1; esos cambios no se describen aquí (ver Pendiente).

Revisado con el código el 2026-11-02. Las constantes se toman del código. Lo que no se ha podido comprobar, o lo que sigue sin fusionar, está en [Pendiente](#pendiente).

Este documento cubre dos piezas:

1. **Procesado en GitHub Actions** (`main`): de una URL con licencia a `audio-library/audio/<id>.opus`, y la publicación de las canciones públicas en `frontend/web/audio/`.
2. **Motor de reproducción en la web** (feat/ui-publica): cola, volumen con GainNode, temporizador de apagado, Media Session y Screen Wake Lock.

Las reglas de producto están en [DESIGN.md](../user-experience/DESIGN.md), secciones 8.1 y 8.2. La elección del perfil de compresión está en [COMPRESSION.md](COMPRESSION.md). Las decisiones de arquitectura están en `docs/decisions/` (ADR-0002, ADR-0003, ADR-0005, ADR-0006 y ADR-0007). ADR-0008 solo existe en feat/gestion-backend. El contrato del reproductor, caso por caso, está en `docs/user-experience/PLAYER.md`, y el modelo de datos en `docs/datos/DATABASE.md`. Este documento describe el código.

| Pieza | Fichero | Rama |
|---|---|---|
| Workflow de la biblioteca (`autorizar`, `procesar` y `publicar`; ADR-0008 y ADR-0010) | `.github/workflows/biblioteca.yml` | main |
| Punto de entrada del workflow | `scripts/ci_library.py` | main |
| Pipeline de importación | `backend/sonidos/pipeline.py` | main |
| Fuentes, descarga, sondeo, perfiles, catálogo, límites y publicación | `backend/sonidos/{sources,intake,probe,compression,catalog,limits,publish}.py` | main |
| Reproductor | `frontend/web/js/player.js` | feat/ui-publica |
| Pruebas del reproductor | `tests/web-unit/player.test.mjs` | feat/ui-publica |
| Paquete entre jobs | `backend/sonidos/paquete.py`, `scripts/empaquetar_cambios.py` y `scripts/aplicar_paquete.py` | main |

## 1. Procesado en GitHub Actions (main)

### 1.1 Disparo y flujo

`biblioteca.yml` se lanza al abrir una incidencia con la etiqueta `biblioteca` (el job `autorizar` comprueba que el autor tiene permiso de escritura) o a mano (`workflow_dispatch`, que no pasa por `autorizar`). Entradas del disparo manual: `action` (`import` u `organize`), `url`, `license`, `title` y `payload` (JSON de una operación en una sola línea; vacío por defecto). `library.yml` está retirado con la administración web; lo sustituye `biblioteca.yml` (ADR-0008).

- Concurrencia: grupo `library-catalog` con `cancel-in-progress: false`. Permisos: `contents: write`. Tiempo máximo: 30 minutos.
- Pasos: checkout, Python 3.12, ffmpeg (apt), `pip install -q -e backend` y `python scripts/ci_library.py`. Las entradas llegan como variables de entorno (`ACTION`, `URL`, `LICENSE`, `TITLE`, `SONG_ID`, `PUBLIC`, `PAYLOAD`), nunca como argumentos. El resultado JSON se copia al resumen del trabajo.
- Guardado: `git add -A audio-library frontend/web`. Si no hay cambios, termina. Si los hay, ejecuta `scripts/check_repo_limits.py` (1.7), hace commit como `github-actions[bot]` con el mensaje `library: <acción> <ID o URL>` y empuja `HEAD` a `main`.
- Si el paso de aplicación falla, el de guardado no se ejecuta (condición por defecto `success()`), así que no llega nada a `main`.

Acciones de `ci_library.py`:

- `import`: pipeline completo (flujo abajo). Devuelve `song_id`, `created`, `source` y `license`.
- `publish`: fija `public` de la canción `SONG_ID` con el valor de `PUBLIC`.
- `organize`: `create_folder`, `rename_folder`, `delete_folder` o `edit_song`, según el campo `op` de `PAYLOAD`.
- Todas las acciones terminan regenerando la parte pública (1.8).

Flujo de una importación (`backend/sonidos/pipeline.py`; la publicación la lanza después `ci_library.py`, no este flujo):

```
URL
 -> intake.resolve_url          fuente y licencia (1.2)
 -> intake.download             staging, máximo 200 MiB (1.3)
 -> hashing.sha256_file         huella SHA-256 del original
 -> probe.probe                 ffprobe (1.4)
 -> catalog.add_song            si el SHA-256 ya existe: created = false y no se transcodifica
 -> compression.transcode       perfil opus-64k (1.5)
 -> shutil.move                 audio-library/audio/<id>.opus
 -> catalog.save                audio-library/indexes/catalog.json
```

### 1.2 Fuentes admitidas (`backend/sonidos/sources.py`)

Solo se aceptan dos tipos de fuente (ADR-0002 y ADR-0005):

- **Internet Archive**: `archive.org/details/<id>` o `archive.org/download/<id>`, con una licencia reconocida en `licenseurl` de los metadatos. La licencia sale de los metadatos; el campo `license` se ignora en este caso.
- **Fichero de audio directo**: la URL termina en `.mp3`, `.flac`, `.ogg`, `.opus`, `.m4a` o `.wav`. La licencia es obligatoria y la escribe quien importa.

Licencias de Internet Archive reconocidas (`IA_LICENSE_NAMES`): Public Domain Mark 1.0, CC0 1.0, dominio público de Creative Commons, CC BY 4.0, CC BY-SA 4.0, CC BY-NC 4.0 y CC BY-NC-SA 4.0.

Dentro de un ítem de Internet Archive se elige un único fichero, según este orden de preferencia (`IA_FORMAT_PREFERENCE`): Flac, VBR MP3, 128Kbps MP3, Ogg Vorbis y 64Kbps MP3.

Se rechazan antes de descargar, junto con sus subdominios: YouTube (`youtube.com`, `youtu.be`), Spotify, Apple Music, SoundCloud, Vimeo, TikTok, Instagram, Facebook y Bandcamp. Una URL que no empiece por `http://` o `https://` se rechaza con «La URL debe empezar por http:// o https://». Una URL http(s) que no sea de Internet Archive ni apunte a un fichero de audio se rechaza como «Fuente no soportada». La lista de `sources.py` incluye además `open.spotify.com`; la copia de esta lista en `frontend/web/lib/validate.js` ya no está en `main` (ver Pendiente).

### 1.3 Descarga (`backend/sonidos/intake.py`)

- Límite: `MAX_DOWNLOAD_BYTES = 200 * 1024 * 1024` (200 MiB). Se mide sobre los bytes recibidos, no sobre `Content-Length`. Al superarlo se borra el fichero parcial y se lanza `SourceError` con el mensaje «El fichero supera el límite de 200 MB».
- Lectura en bloques de 1 MiB. Tiempo de espera de 120 s por operación de red en la descarga, y de 30 s en la consulta de metadatos de Internet Archive. No es un tiempo total.
- Cabecera `User-Agent`: `reminiscencia-backend/0.2 (importacion con licencia)`.
- Destino: `audio-library/staging/<identificador>/<fichero>`, con `/` sustituido por `_` en el identificador. `import_url` borra esa carpeta en un bloque `finally` que cubre el procesado posterior a la descarga, haya éxito o error; si la descarga falla, la carpeta no se borra (solo se borra el fichero parcial cuando supera el límite). `audio-library/staging/` está en `.gitignore`.

### 1.4 Sondeo con ffprobe (`backend/sonidos/probe.py`)

Comando: `ffprobe -v error -select_streams a:0 -show_entries stream=codec_name,sample_rate,channels,bit_rate:format=duration -of json <fichero>`.

Devuelve `AudioInfo`: `codec`, `sample_rate`, `channels`, `duration_s`, `bitrate` (`None` si no hay `bit_rate`) y `size_bytes` (tamaño del original en disco). El pipeline solo guarda en el catálogo `codec`, `duration_s` y `size_bytes`; `sample_rate`, `channels` y `bitrate` se leen pero no se guardan.

Si ffprobe falla o el fichero no tiene pista de audio, lanza `ProbeError` (subclase de `RuntimeError`).

### 1.5 Perfiles de compresión (`backend/sonidos/compression.py`)

| Perfil | Extensión | Argumentos del codificador |
|---|---|---|
| `opus-48k` | `.opus` | `-c:a libopus -b:a 48k -vbr on` |
| `opus-64k` | `.opus` | `-c:a libopus -b:a 64k -vbr on` |
| `aac-64k` | `.m4a` | `-c:a aac -b:a 64k` |
| `aac-128k` | `.m4a` | `-c:a aac -b:a 128k` |
| `mp3-128k` | `.mp3` | `-c:a libmp3lame -b:a 128k` |

El pipeline usa `PLAYBACK_PROFILE = "opus-64k"`, el único perfil cuyo resultado llega a `audio-library/audio/`.

Conversión: `ffmpeg -y -v error -i <origen> -map 0:a:0 -vn <argumentos> <destino>`. Toma la primera pista de audio y descarta el vídeo. El docstring del módulo indica que no aplica ningún filtro destructivo. El destino es `<carpeta>/<perfil><extensión>`. Un perfil desconocido o un código de salida distinto de cero lanza `TranscodeError` (subclase de `RuntimeError`).

Por qué se eligió `opus-64k` y qué falta por medir: [COMPRESSION.md](COMPRESSION.md). Sus tablas de resultados añaden el sufijo `-vbr` (por ejemplo, `opus-64k-vbr`); el código no lo usa.

### 1.6 Catálogo (`backend/sonidos/catalog.py`)

- Fichero: `audio-library/indexes/catalog.json` (versión 1, con `folders` y `songs`).
- Identificador: `S` más los 16 primeros caracteres hexadecimales del SHA-256 del original (`song_id_for`).
- Duplicados: si el SHA-256 ya existe, se devuelve la canción existente con `created: false`.
- Canciones nuevas: `public: false`.
- Campos: `id`, `title`, `artist`, `year`, `tags`, `folder_id`, `license`, `source`, `sha256`, `duration_s`, `codec`, `size_bytes`, `added_at` y `public`. `size_bytes` es el del original descargado, no el del `.opus`.
- Licencia obligatoria: `CatalogError` si está vacía.
- Campos editables (`update_song`): `title` (no vacío), `artist`, `year`, `tags` (en minúsculas y sin repetidos), `folder_id` (debe existir) y `public`. Cualquier otro campo se rechaza.
- Carpetas: `create_folder`, `rename_folder` y `delete_folder`. Al borrar una carpeta, sus canciones y subcarpetas pasan al nivel superior.
- Escritura atómica: se escribe un fichero temporal y después se reemplaza con `os.replace`.

### 1.7 Límites de GitHub (`backend/sonidos/limits.py`)

Los valores son los que declara `limits.py`, que indica haberlos verificado en docs.github.com el 2026-10-31. Este documento no los ha vuelto a comprobar.

| Límite | Valor | Efecto |
|---|---|---|
| Aviso por fichero versionado | 50 MiB | Aviso; no bloquea |
| Bloqueo de fichero en git | 100 MiB | Bloquea |
| Tamaño ideal del repositorio | 1 GiB | Aviso |
| Máximo recomendado del repositorio | 5 GiB | Bloquea |
| Asset de release | menor de 2 GiB | `check_release_asset` lanza `LimitError` |
| Assets por release | 1000 | `RELEASE_DATA_ASSETS_PER_BATCH = 999`; el restante es `SHA256SUMS.txt` |

- `audit_repository` mira solo los ficheros de `git ls-files`. Como el workflow ejecuta `git add -A` antes, incluye los ficheros nuevos.
- `scripts/check_repo_limits.py` imprime `AVISO/ERROR:` por cada problema. Sale con código 1 si algún problema contiene «bloquea» o «máximo»; si no, imprime «Límites de GitHub: correcto» y sale con 0. Lo usan `biblioteca.yml` (job `publicar`, antes del commit) y el job `limites-repositorio` de `backend.yml`.
- `backend/sonidos/release.py` prepara lotes para GitHub Releases (ADR-0003): tags `<prefijo>-NN`, nombres de asset `<id>_<fichero>` y un manifiesto `SHA256SUMS.txt`. `publish(repo, batches, *, execute)` solo devuelve los comandos `gh`; ejecutarlos exige `execute=True`, y ese argumento no tiene valor por defecto. Ningún workflow de `main` lo invoca; solo lo usan sus pruebas.

### 1.8 Publicación pública (`backend/sonidos/publish.py`)

`sync_public` se ejecuta al final de cada acción de `ci_library.py`, también cuando el catálogo no cambia.

- Copia a `frontend/web/audio/<id>.opus` solo las canciones con `public: true`. Copia si el destino no existe o si su tamaño es distinto (compara tamaños, no contenido).
- Borra de `frontend/web/audio/` los `.opus` que ya no son públicos.
- Si falta el `.opus` de una canción pública en `audio-library/audio/`, lanza `FileNotFoundError`.
- `frontend/web/data/songs.json`: solo las públicas, ordenadas por título sin distinguir mayúsculas. Campos: `id`, `title`, `artist`, `year`, `tags`, `folder_id`, `duration_s`, `license` y `audio` (`audio/<id>.opus`).
- `frontend/web/data/folders.json`: todas las carpetas (`id`, `name`, `parent_id`).
- Según el docstring, Vercel sirve solo `frontend/web`. Los `.opus` privados sí quedan versionados en `audio-library/audio/` (ver `.gitignore`), pero no se copian a la web.

### 1.9 Errores y estado del repositorio al fallar

- `ci_library.main` captura `CatalogError`, `ValueError` (incluido `SourceError`), `KeyError` y `FileNotFoundError`. Imprime `{"error": "..."}` y sale con código 1.
- No se capturan `ProbeError`, `TranscodeError` ni los errores de red de `urllib` (`OSError`). Salen como traza de Python, sin JSON, y el paso falla.
- Si el paso falla, no hay commit (1.1).
- En la importación, primero se mueve el `.opus` y después se guarda el catálogo. Si el guardado falla, el `.opus` queda en el runner, pero no se versiona.

### 1.10 Pruebas (backend)

- `backend/tests/`: `conftest.py`, `test_catalog.py`, `test_limits.py`, `test_pipeline.py`, `test_probe.py`, `test_publish.py`, `test_release.py` y `test_sources.py`.
- El job `test` de `backend.yml` instala ffmpeg, instala el paquete con `[dev]` y ejecuta `python -m pytest -q`.
- Ejecutadas en esta revisión sobre el código de `main` (8a19a09): `python3 -m pytest -q` en `backend/`, con Python 3.14.6, pytest 9.0.3 y ffmpeg/ffprobe en el PATH. Resultado: 42 pruebas aprobadas, código de salida 0.

## 2. Motor de reproducción en la web (feat/ui-publica; retirado por ADR-0015)

> Retirado. Esta parte se conserva como registro del reproductor de ADR-0009. El actual está en `docs/user-experience/PLAYER.md`.

Estado: describe la rama feat/ui-publica pendiente de fusión (commit cc8ef01). Código: `frontend/web/js/player.js`. Pruebas: `tests/web-unit/player.test.mjs`.

El módulo es ES, no tiene dependencias y no toca el DOM. Recibe el elemento de audio y, opcionalmente, los servicios del navegador, de modo que se prueba en Node con dobles.

### 2.1 Contrato

`createPlayer(options)` devuelve la API. Opciones:

- `audio` (obligatorio): elemento de audio con `play()`.
- `profile` (`null` por defecto), `mode` (`'cuidador'` por defecto; el otro valor válido es `'paciente'`), `wakeLockEnabled` (activo salvo que sea `false`) e `isAvailable(pista)` (por defecto, todo disponible; si devuelve falso o lanza un error, la pista se trata como «sin conexión»).
- Avisos: `onChange`, `onStudyEvent`, `onNotice`, `onSleepWarning(segundos)` y `onSleep`.
- `env` (opcional): `now`, `setTimeout`, `clearTimeout`, `setInterval`, `clearInterval`, `AudioContext`, `navigator`, `document` y `MediaMetadata`. Lo que no se pasa se toma del global del navegador.

API: `load(pistas, inicio, origen, presentación)`, `restoreLast(pista, segundos)`, `play`, `pause`, `toggle`, `next`, `previous`, `jumpTo(índice)`, `seekBy(segundos)`, `seekTo(segundos)`, `setVolumeStep(paso)`, `setProfileLimit(porcentaje)`, `setSleepTimer(minutos | null)`, `extendSleepTimer(minutos)`, `setProfile(perfil)`, `setMode(modo)`, `getState()` y `destroy()`. `setMode` no detiene la reproducción, y un modo inválido se ignora.

`getState()` devuelve `track`, `index`, `queueLength`, `playing`, `position` y `duration` (redondeados a 0,1 s), `volumeStep`, `volumeLimitStep`, `notice`, `sleepMinutesLeft` (`null` sin temporizador) y `volumeMode` (`'gain'` o `'element'`).

Una pista es `{ id, title, artist, year, coverUrl, audioUrl, folderId }`. Sin `audioUrl` no se puede reproducir.

### 2.2 Constantes

Valores de `frontend/web/js/player.js`. Las marcadas como «no exportada» son internas.

| Constante | Valor | Significado |
|---|---|---|
| `VOLUME_STEP_MAX` | 10 | Pasos de volumen; cada paso son 10 puntos |
| `ARRIVAL_STEP` | 6 | Volumen de arranque de sesión: 60 % |
| `FADE_IN_MS` | 1500 | Duración del fundido de entrada de la sesión |
| `FADE_TICK_MS` | 50 (no exportada) | Paso del fundido cuando no hay GainNode |
| `skipDelayAfterError` | 6 (s) | Espera antes de saltar tras un error de audio |
| `PREVIOUS_RESTART_SECONDS` | 3 | En cuidador, «Anterior» vuelve al inicio si la posición supera 3 s |
| `sleepWarningAt` | 30 (s) | Aviso del temporizador de apagado |
| `extendSleepMinutes` | 15 | Minutos de extensión del temporizador (valor de referencia) |
| `SESSION_IDLE_MS` | 10 800 000 (3 h) | Tras 3 horas desde la última parada, la siguiente reproducción abre una sesión nueva |
| `SEEK_STEP_SECONDS` | 5 | Paso de salto (la interfaz lo importa); `seekBy` recibe los segundos como argumento |
| `SLEEP_TICK_MS` | 1000 (no exportada) | Precisión del temporizador |
| `MINUTE_MS` | 60 000 (no exportada) | Conversión de minutos a milisegundos |
| `MODES` | `['paciente', 'cuidador']` | Modos válidos |

Textos de aviso (`NOTICES`):

- `unavailable`: «No disponible sin internet»
- `noneAvailable`: «No hay canciones disponibles sin internet.»
- `error`: «No se puede reproducir esta canción. Pasamos a la siguiente.»
- `endOfList`: «Fin de la lista»

### 2.3 Cola, siguiente, anterior y repetición

- `load` sustituye la cola (solo entran elementos con `id`) y no reproduce. Empieza en `inicio`; si esa pista no está disponible, busca hacia delante y luego hacia atrás. Si ninguna lo está, avisa con `noneAvailable` y no carga audio.
- `restoreLast` deja la pista en pausa, en la posición indicada, sin reproducir. Si no está en la cola actual, la cola pasa a tener solo esa pista, con origen `'continua'`.
- `play()`: si la pista actual no está disponible, pasa a la siguiente disponible (o a la anterior) con el aviso `unavailable`. Si no hay ninguna, avisa con `noneAvailable`.
- `next()`: pasa a la siguiente disponible y sigue sonando si ya sonaba. Si no hay siguiente, cierra la pista, detiene la reproducción y avisa «Fin de la lista».
- `previous()`: en cuidador, si la posición supera 3 s, vuelve al inicio de la pista. En paciente siempre va a la anterior. Si no hay anterior, vuelve al inicio.
- `jumpTo(índice)`: salta a ese índice y conserva el estado de reproducción.
- `seekTo` y `seekBy`: la posición no baja de 0 y, si la duración es conocida, no supera la duración.
- Fin natural de una pista: `track-end` con `completed: true`; sigue con la siguiente disponible si sonaba. Si no hay más, avisa «Fin de la lista».
- Repetición: `repeatList` del perfil. Solo `false` la desactiva; sin perfil, o sin ese campo, está activa. Con repetición, la última pista lleva a la primera, y la primera lleva a la última si hay más de una.
- Las pistas no disponibles se saltan en el sentido del movimiento, respetando la repetición. Como mucho se recorre la cola una vez.

### 2.4 Error de audio

- Si el elemento emite `error` con una pista cargada, el reproductor marca la pista con error, registra un evento `error`, detiene la reproducción y muestra el aviso `error`.
- Si la pista sonaba, salta a la siguiente disponible a los 6 s (`skipDelayAfterError`), con la repetición aplicada y reproducción automática. Si no sonaba, no salta: el aviso se queda.
- Mientras espera el salto, pausar, reproducir, cambiar de pista o cargar otra cola lo cancela. Reproducir reintenta la misma pista.
- Una pista con error no emite `track-end`.
- Rechazos de `play()`: `AbortError` y `NotSupportedError` se ignoran (el evento `error` del elemento los gestiona). Cualquier otro, por ejemplo `NotAllowedError`, detiene la reproducción y se refleja en el estado.
- Una pausa del sistema (interrupción) se registra como `pause` y se refleja en el estado. El reproductor no reanuda por sí solo.

### 2.5 Volumen con GainNode

Escala: paso entero de 0 a 10. `volumeFromStep(paso)` = paso / 10.

**Cómo se aplica.**

- Con Web Audio, el grafo se crea en el primer `pointerdown`, `keydown` o `touchend` del documento (captura y pasivo): `AudioContext` → `MediaElementAudioSourceNode` → `GainNode` → destino. El elemento pasa a volumen 1 y el GainNode regula el volumen. Hay un grafo por elemento (`WeakMap`). Si el contexto queda suspendido, se intenta reanudar.
- El contexto no se crea antes de ese gesto porque, según el comentario del código, un contexto creado antes queda suspendido y silencia el audio.
- Si la creación falla, no se reintenta y el volumen va en `audio.volume` (`volumeMode: 'element'`). Lo mismo ocurre antes del primer gesto. El código indica que en iOS no siempre se puede fijar `audio.volume`, y por eso el GainNode es el mecanismo previsto. Pendiente de verificar en iOS.

**Arranque y fundido.**

- Al crear el reproductor, el paso inicial es `min(ARRIVAL_STEP, límite)`: 60 %, salvo que el perfil limite antes.
- La sesión existe solo en modo paciente. La primera reproducción de cada sesión (`play()`) fija el paso en `min(6, límite)` y sube hasta ese volumen en 1,5 s. Con GainNode es una rampa lineal; sin él, son pasos de 50 ms sobre `audio.volume`.
- Se abre una sesión nueva al cambiar de modo, al cambiar de perfil (distinto `id`) o cuando han pasado 3 horas desde la última parada de la reproducción. Pausar, reanudar, cambiar de lista o pasar de pista dentro de la sesión no repite el fundido.
- En cuidador no hay arranque ni fundido: el volumen se mantiene.
- Cualquier parada cancela un fundido en curso y fija el volumen objetivo.

**Límite por perfil.**

- `setProfileLimit(porcentaje)`, o `setProfile(perfil)` con `perfil.volumeLimit`, convierten el porcentaje en pasos de 5 a 10 redondeando hacia abajo (55 % equivale a 50 %). Los valores fuera de 50–100 se acotan; los no numéricos se ignoran.
- Si el volumen actual supera el límite, baja hasta él.
- `setProfile` con el mismo perfil y el mismo límite no vuelve a aplicarlo, así que no pisa un `setProfileLimit` posterior.
- `setVolumeStep(paso)` redondea a entero, acota a 0–10 y al límite, y cancela el fundido en curso.
- Sin perfil, el límite es 10 (100 %).

### 2.6 Temporizador de apagado

- `setSleepTimer(minutos)` lo fija; `null` o cero lo quita. `extendSleepTimer(minutos)` suma minutos, o lo inicia si no hay ninguno, y vuelve a armar el aviso.
- Cuenta solo mientras suena, con un tick cada 1000 ms.
- Aviso: una vez, cuando quedan 30 s o menos. `onSleepWarning` recibe los segundos restantes redondeados hacia arriba.
- Al llegar a cero: se quita el temporizador, se pausa si sonaba (registra `pause`) y se llama a `onSleep`. La aplicación no se cierra.
- `sleepMinutesLeft` redondea hacia arriba los minutos restantes.
- El ajuste del cuidador solo admite No, 15, 30 o 60 minutos (`SLEEP_TIMER_MINUTES` en `frontend/web/js/schema.js`). El reproductor acepta cualquier cantidad positiva.

### 2.7 Media Session

- Acciones registradas al crear el reproductor: `play`, `pause`, `previoustrack` (llama a `previous()`) y `nexttrack` (llama a `next()`). No se registran acciones de salto.
- Metadatos (si existe `MediaMetadata`): `title`, `artist` y `artwork` con la portada a `512x512` si hay `coverUrl`.
- `playbackState`: `playing`, `paused` o `none` (sin pista).
- `destroy()` quita los manejadores y los metadatos, y deja `playbackState` en `none`.

### 2.8 Pantalla (Screen Wake Lock)

- Se pide `navigator.wakeLock.request('screen')` solo si el modo es paciente, `wakeLockEnabled` no es `false` y la pista está sonando.
- Se libera al pausar o parar, al cambiar a cuidador y en `destroy()`.
- Al volver a ser visible la pestaña (`visibilitychange`), se vuelve a pedir si sigue sonando.
- Sin permiso o sin soporte, la reproducción sigue sin bloqueo y sin error.

### 2.9 Registro del estudio (`onStudyEvent`)

Cada evento incluye `type`, `at` (ISO 8601), `songId`, `position` (segundos, 0,1 s), `origin` y `presentation`. `track-end` incluye además `completed`.

- `start`: pista nueva.
- `resume`: se reanuda la misma pista.
- `pause`: pausa pedida o del sistema.
- `track-end`: `completed: true` al terminar; `completed: false` al cambiar de pista con `next`, `previous`, `jumpTo`, `load` o `restoreLast`.
- `error`: error de audio. Después no se emite `track-end` para esa pista.

`session-start` y `session-end` están en `STUDY_EVENT_TYPES` (`frontend/web/js/schema.js`), pero el reproductor no los emite.

`presentation` puede ser un valor o una función que recibe la pista; si la función lanza un error, se usa `null`. El reproductor emite en cualquier modo; quien llama decide si registra (por ejemplo, en una vista previa).

### 2.10 Perfil y conexión con la interfaz

- El reproductor lee del perfil, en el primer nivel, `id` (para detectar cambios de perfil), `volumeLimit` (porcentaje) y `repeatList` (booleano).
- El almacén (`frontend/web/js/store.js`, método `createProfile`) guarda esas opciones en `profile.options`, con los valores por defecto `volumeLimit: 100`, `repeatList: true`, `resumeOnOpen: false` y `seekOnTap: false`. El código que conecte ambos tiene que pasar `{ id, volumeLimit, repeatList }`.
- Estado de la integración en feat/ui-publica (commit cc8ef01): ningún fichero versionado importa `player.js`, salvo sus pruebas. En el worktree local de la rama hay código sin versionar que sí lo usa: `frontend/web/js/cuidador/shell.js` importa `VOLUME_STEP_MAX` y `SEEK_STEP_SECONDS`, y `frontend/web/js/paciente/escuchar.js` recibe el reproductor como `services.player`. Pero ningún fichero de ese worktree llama a `createPlayer` ni a `setProfile`; la pantalla de paciente solo llama a `setProfileLimit(options.volumeLimit)`. Por eso `repeatList` no llega al reproductor y queda el valor por defecto (activa).
- El ajuste `wakeLock` de `DEFAULT_SETTINGS` (`store.js`, por defecto `true`) corresponde por nombre a la opción `wakeLockEnabled`. Su conexión no está verificada.

### 2.11 Pruebas

- `tests/web-unit/player.test.mjs` usa `node:test` y `node:assert`, sin dependencias.
- No está en `tests/web-unit/index.mjs`, que agrupa cinco suites. Hay que nombrarlo de forma explícita: `node --test tests/web-unit/player.test.mjs`.
- Ejecutadas en esta revisión con el módulo y las pruebas de cc8ef01, en Node v26.4.0: 65 pruebas, 65 aprobadas, 0 fallos.

## Pendiente

**Procesado (parte 1)**

- **main ha avanzado.** `main` está en `7f93756`, que añade `.github/workflows/web.yml` (integración continua de la web); no se describe aquí.
- **feat/gestion-backend, incorporada en `main` (ADR-0008; cabeza 22b444a, que incluye 679b11c y dos correcciones posteriores).** Sustituye `library.yml` por `.github/workflows/biblioteca.yml`, que se dispara al abrir una incidencia (el job `autorizar` exige permiso de escritura en el autor y la etiqueta `biblioteca`) y también se lanza a mano. Añade `scripts/issue_request.py`, `scripts/responder_incidencia.py` y `backend/sonidos/issue_request.py`. Cambia lo que describe la parte 1: `ci_library.py` deja de tener la acción `publish` (la publicación pasa a `edit_song` con `public`) y cualquier error sale como JSON con código 1; `sources.py` valida el identificador de Internet Archive (`ia_identifier`) y `intake.py` lo usa; `publish.py` genera además `frontend/web/data/catalog.json` con las canciones públicas y todas las carpetas, sin rutas de audio ni huellas SHA-256. En 679b11c incluía también las no publicadas; la cabeza lo corrige, y ADR-0008 deja esa decisión para confirmar por el investigador. El workflow añade `queue: max` (según su comentario, una petición en espera no se cancela cuando llega otra) y un paso que aborta si la ejecución no es desde `main`. `library.yml`, ya retirado, no tenía ninguna de las dos cosas: su paso de guardado empuja `HEAD` a `main` desde cualquier rama.
- **Comentario obsoleto y documentos desfasados (corregido el 2-nov-2026).** El comentario de `library.yml` hablaba de `/api/dispatch`, funciones retiradas de `main` con `0fa6ed3`; `library.yml` ya no existe. `CLAUDE.md`, `PROJECT_MASTER.md`, `ADR-0005` y `ADR-0007` describen hoy la administración como retirada. `CHANGELOG.md` conserva las entradas de la administración como historial.
- **Paridad de la lista de bloqueo.** `CLAUDE.md` y `ADR-0005` piden que la lista de `backend/sonidos/sources.py` coincida con la copia de la web en `frontend/web/js/intake.js` (antes, `frontend/web/lib/validate.js`). Ese fichero ya no está en `main` ni en ninguna rama local (se retiró en `0fa6ed3`). En su última versión (`0fa6ed3^`), la lista tenía `spotify.com` y no tenía `open.spotify.com` como entrada; `sources.py` sí lo tiene. El efecto es el mismo, porque ambas comparan subdominios, pero las listas no son idénticas.
- **Importación desde Internet Archive.** Si el FLAC preferido supera 200 MiB, la importación falla y no prueba el siguiente formato de la lista.
- **Perfil `opus-64k`.** Está fijado en el código, pero COMPRESSION.md indica que la calidad percibida no se ha medido; la prueba MUSHRA está pendiente.
- **Errores sin JSON.** `ProbeError`, `TranscodeError` y los errores de red salen como traza (1.9).
- **Límites de GitHub.** Valores de `limits.py`, no comprobados de nuevo en este documento.
- **Ejecución de extremo a extremo.** En esta revisión no se ha ejecutado el pipeline con una descarga real, ni de Internet Archive ni de un fichero directo. Las pruebas de backend sí se han ejecutado (1.10).
- **`release.py`.** No está conectado a ningún workflow.

**Reproductor (parte 2; retirado por ADR-0015, sin seguimiento)**

- **iOS e iPadOS (DESIGN.md, sección 16).** Verificar GainNode, Wake Lock, Media Session y la persistencia de almacenamiento. No se puede hacer desde este repositorio.
- **Conexión con la interfaz.** Ningún fichero versionado crea el reproductor. En el worktree local, nadie llama a `createPlayer` ni a `setProfile`: hay que pasar `{ id, volumeLimit, repeatList }` del perfil, o `repeatList` no llega al reproductor. `docs/user-experience/PLAYER.md` recoge lo mismo: en feat/ui-publica ningún módulo importa `createPlayer`.
- **Ajuste `wakeLock`.** Comprobar que llega como `wakeLockEnabled`.
- **Constantes duplicadas en la interfaz sin versionar.** `VOLUME_STEPS = 10` y `EXTEND_MINUTES = 15` en `paciente/escuchar.js` repiten `VOLUME_STEP_MAX` y `extendSleepMinutes`. Conviene importar las de `player.js`.
- **Índice de pruebas.** `player.test.mjs` no está en `tests/web-unit/index.mjs`.
- **Fusión.** `feat/ui-publica` no está en `main`; `feat/gestion-backend` sí (ADR-0008). Hasta que se fusione `feat/ui-publica`, la parte 2 describe código sin integrar.
