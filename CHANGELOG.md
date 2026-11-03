# CHANGELOG

## Sin publicar: artista y año al importar desde Internet Archive (2026-11-03)

### Corregido
- Las canciones importadas desde Internet Archive entraban sin artista («Artista desconocido»). Ahora la importación (`backend/sonidos/sources.py` y `pipeline.py`) toma el artista de `creator` en los metadatos del ítem (una lista se une con «, », sin nombres vacíos, repetidos ni con caracteres de control o de formato) y el año de `date` o, si no sirve, de `year` (solo cuatro cifras al principio, como `1925-00-00 00:00:00`). Lo que no cumple los límites del catálogo se recorta (artista de más de 200 caracteres) o se descarta (año fuera de 1000 a 2100, «1920s», «c. 1925»), sin que la importación falle. Solo afecta a las canciones nuevas: una canción ya catalogada no cambia.
- Los límites del artista y del año de una canción están ahora en `backend/sonidos/catalog.py` (`SONG_ARTIST_MAX_CHARS`, `YEAR_MIN`, `YEAR_MAX`), y `issue_request.py` los usa en lugar de tener su copia.
- Pruebas con metadatos simulados, sin red, en `backend/tests/test_sources.py` y `test_pipeline.py`.

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
