# CLAUDE.md: instrucciones permanentes

## Objetivo
Proyecto doctoral sobre música, memoria y Alzheimer, con una plataforma que sirve para estudiar las hipótesis. La investigación y el desarrollo avanzan en paralelo. Ver [PROJECT_MASTER.md](PROJECT_MASTER.md).

## Reglas de desarrollo
- Idioma de la documentación y de los mensajes al usuario: español. Identificadores de código: inglés.
- Cada cambio de funcionalidad va con pruebas. Nada se marca como terminado sin haberlo ejecutado.
- Antes de dar algo por hecho, ejecutar las pruebas de backend y de web (ver [Comandos](#comandos)).
- Al cerrar una tarea, revisar con grep los `.md` del repositorio y corregir lo que quede obsoleto.
- Las decisiones importantes van en un ADR nuevo en `docs/decisions/` (arquitectura, legalidad, presupuesto, viabilidad científica).
- Verificar cada referencia científica antes de citarla. Lo no verificado va como pendiente en [BIBLIOGRAPHY.md](BIBLIOGRAPHY.md).

## Arquitectura (resumen)
Estado de `main` a 2026-11-03: web y APK sin usuarios, con el aspecto de Spotify (ADR-0015); portadas y álbumes (ADR-0016); el importador lee el artista y el año de Internet Archive; «Subir canciones» sube para todos por `/api/subir` (ADR-0017), probado en producción el 2026-11-03 («Prueba subida directa.mp3», publicada como «Prueba subida directa» y despublicada después con la incidencia #21).

- `backend/sonidos/`: `catalog` (catálogo JSON, fuente de verdad), `pipeline` (importar una URL), `buzon` (canciones subidas al buzón, ADR-0014), `intake` y `sources` (fuentes con licencia y lista de bloqueo), `issue_request` (contrato de las peticiones, ADR-0008), `paquete` (paquete de cambios entre `procesar` y `publicar`, ADR-0010), `publish` (regenera la parte pública: audio y `data/`), `probe`, `hashing`, `compression` (perfiles de ffmpeg), `limits` (límites de GitHub) y `release` (preparación de publicaciones en Releases, en modo simulación).
- `scripts/`: `ci_library.py` (punto de entrada de `biblioteca.yml`; lee sus entradas de variables de entorno, nunca de la línea de comandos), `buzon.py` (punto de entrada de `buzon.yml`; lee los archivos y los mensajes de commit del evento de GitHub), `issue_request.py` y `responder_incidencia.py` (validan la petición y responden en la incidencia), `empaquetar_cambios.py` y `aplicar_paquete.py` (paquete entre `procesar` y `publicar`), `check_repo_limits.py` (límites de GitHub), `sync_r2.py` (copia el audio a R2; ADR-0020; lo ejecuta `r2.yml`) y `smoke_produccion.mjs` (comprueba la web pública; ver Comandos). Además, `compression/` (experimento objetivo de compresión), `android/` (icono y verificación del APK) y `web/` (iconos de la PWA).
- `.github/workflows/`:
  - `biblioteca.yml`: escrituras al catálogo desde incidencias con la etiqueta `biblioteca` de cuentas con permiso de escritura, o a mano. Concurrencia única. Tres jobs: `autorizar` (comprueba el permiso del autor), `procesar` (sin token) y `publicar` (valida el paquete, lo aplica, hace commit y push, y responde; ADR-0008 y ADR-0010).
  - `buzon.yml`: canciones subidas a `audio-library/buzon/` desde la web o la APK por `/api/subir` (trozos en `audio-library/buzon/.partes/<UUID>/`, que se unen cuando llega su `manifiesto.json`; ADR-0017), desde la página de subida de GitHub (push a `main` que toca el buzón) o a mano. Mismos tres jobs y misma cola (`library-catalog`) que `biblioteca.yml`. Con una línea `Licencia: …` en el mensaje del commit, la canción entra pública; sin ella, privada. A mano (`workflow_dispatch`) no hay mensaje de commit, así que todo lo pendiente entra privado (ADR-0014).
  - `backend.yml`: pruebas de Python en 3.12 y 3.13, app Flutter y límites del repositorio. No ejecuta pruebas web.
  - `web.yml`: sintaxis (`node --check`) y pruebas unitarias de la web (`node --test`), con cambios en `frontend/web/**` o `tests/web-unit/**`.
  - `web-e2e.yml`: pruebas de extremo a extremo y de accesibilidad con Chrome (`tests/web-e2e/`, Node 22), con cambios en `frontend/web/**` o `tests/web-e2e/**`.
  - `android.yml`: análisis, pruebas, APK de depuración y de producción, y release por etiqueta `android-vX.Y.Z`.
- `frontend/web/`: la carpeta que sirve Vercel (Root Directory). No tiene administración (ADR-0008). Sus funciones de Vercel son `api/subir.js` (`POST /api/subir`, Node sin dependencias; sube los trozos al buzón con la API de GitHub; las playlists pasan álbum y artista por canción en el manifiesto; ADR-0017 y ADR-0019) y `api/youtube/` (metadatos de vídeos y playlists, más proxy del conversor, lógica compartida en `server/`; las playlists usan primero `yt-dlp` y respaldos de YouTube Music/HTML; se recomienda configurar `YTDLP_PATH` en el runtime). Ninguna va en el shell del service worker.
  - `index.html` (una sola página, sin usuarios: abre en Inicio), `js/app.js` (arranque, rutas y estado), `js/views/` (Inicio, Buscar, Tu biblioteca, colección, reproductor, hoja «Subir canciones» y hoja «Homeostasia» en `homeostasia.js`, que importa vídeos y playlists de YouTube y envía sus WAV por la cola de publicación; las playlists propagan título de álbum y artista de cada pista hasta el buzón, ADR-0019), `js/ui/` (DOM e iconos SVG propios), `js/catalog.js` (catálogo en memoria), `js/player.js` (reproductor: cola, aleatorio, repetir y volumen), `css/` (`tokens.css` y `app.css`), `fonts/` (Figtree, OFL) e `icons/`. Especificación en `docs/user-experience/DESIGN.md` 3.0 (ADR-0015).
  - Datos locales y PWA: `js/local-library.js` (listas y «Me gusta» en IndexedDB, base `reminiscencia-biblioteca`, versión 1), `js/pwa.js`, `js/offline-core.js`, `sw.js` y `manifest.webmanifest`. La conversión a Opus está en `js/cuidador/subida-local.js`, que también guarda y lee las canciones locales de antes (IndexedDB `reminiscencia-audio-local`, ADR-0012); `sw.js` las sirve en `audio/L….opus`. La subida para todos (trozos a `/api/subir`) está en `js/cuidador/subida-publica.js` (ADR-0017), y el estado de cada subida hasta «Publicada» en `js/cuidador/subida-estado.js`. Los `.zip` se leen en el navegador con `js/cuidador/zip.js` (lector propio: stored, deflate-raw y ZIP64) y `js/cuidador/subida-zip.js` (grupos por ZIP): el ZIP nunca se sube, solo cada canción que contiene. La APK hace lo mismo con `lib/zip_audio.dart`, y el buzón descomprime los `.zip` subidos por la página de GitHub y los borra (`sonidos.buzon`). La carpeta `js/cuidador/` conserva el nombre, aunque ya no hay modo cuidador: contiene `incidencias.js`, `subida-local.js`, `subida-publica.js`, `subida-estado.js`, `zip.js` y `subida-zip.js`. Retirados por ADR-0015: `js/paciente/`, `js/store.js`, `js/schema.js`, `js/crypto.js`, `js/backup.js` (copia `.rmc`) y `js/prefs.js`.
  - Datos publicados: `data/` (`songs.json`, `folders.json` y `catalog.json`, generados por `publish`) y `audio/` (solo canciones públicas). `vercel.json` define cabeceras: política de contenido (CSP) y tipo del audio.
  - La lista de bloqueo de la web está en `js/cuidador/incidencias.js` (`BLOCKED_HOSTS`, 42 entradas, las mismas que `backend/sonidos/sources.py`; ADR-0008). La importación desde Internet Archive pasa además por `js/intake.js`.
- `mobile/`: app Flutter 1.2.4+8, sin usuarios ni modo paciente y con el aspecto de la app de Spotify. Lee `data/songs.json` y `data/folders.json` de la web y guarda una copia para escuchar sin conexión. Las listas y «Me gusta» se guardan solo en el teléfono (`colecciones.json`). «Subir canciones» sube siempre para todos, como la web (ADR-0017): convierte cada archivo a Opus con FFmpeg en el teléfono y lo envía por trozos a `https://reminiscencia.vercel.app/api/subir` (`lib/shared_upload.dart`); la app no guarda ningún token. «Homeostasia» (`lib/ui/homeostasia.dart`) importa vídeos y playlists por el proxy común; las playlists conservan álbum y artista en las pistas, y el álbum muestra el artista común (ADR-0019). La release de producción lleva un APK por arquitectura (`arm64-v8a`, `armeabi-v7a` y `x86_64`; `android.yml`); la versión 1.2.4+8 está validada en CI, pero aún no se publica sin la firma de producción.
- `audio-library/`: catálogo (`indexes/catalog.json`), audio (`audio/`, también el de las canciones privadas) y buzón (`buzon/`, carpeta de paso del workflow `buzon`, con `buzon/.partes/` para las subidas por trozos; ADR-0014 y ADR-0017).
- `tests/`: `web-unit/` (pruebas de la web con `node:test`, sin dependencias; `index.mjs` carga todos los ficheros; `api-subir.test.mjs` prueba la función con GitHub simulado) y `web-e2e/` (pruebas de extremo a extremo y de accesibilidad con puppeteer-core, axe-core y Chrome; `helpers/servidor.mjs` simula `/api/subir`).
- `docs/`: decisiones (`decisions/`), interfaz (`user-experience/`), procesado de audio (`audio-processing/`), datos (`datos/`) y Android (`android/`). `research-data/` guarda los datos del experimento de compresión.

## Comandos

Backend (Python 3.12 o 3.13; requiere ffmpeg y ffprobe en el PATH, que ya se instalan en GitHub Actions):
```
cd backend
python3 -m venv .venv && ./.venv/bin/pip install -e ".[dev]"
./.venv/bin/python -m pytest -q
```

Pruebas de la web, desde la raíz (es el mismo comando que `web.yml`):
```
node --test "tests/web-unit/*.test.mjs"
```

Pruebas de extremo a extremo y de accesibilidad (necesitan Chrome; si no está en una ruta habitual, indicarla en `CHROME_PATH`; Node 22.12 o superior):
```
cd tests/web-e2e && npm ci && npm test
```

Comprobador de la web pública tras cada cambio en `main` (por defecto, https://reminiscencia.vercel.app; sale con código 1 si alguna comprobación falla; antes, poner `main` al día con `origin/main`):
```
node scripts/smoke_produccion.mjs [url]
```

Flujo de la biblioteca por incidencias (ADR-0008): una incidencia con la etiqueta `biblioteca` pasa por tres jobs separados: `autorizar` (comprueba que el autor tiene permiso de escritura), `procesar` y `publicar`. El disparo manual del workflow empieza en `procesar`. `procesar` aplica la petición en su copia de trabajo, sin token, y deja un paquete de cambios. `publicar` valida ese paquete, lo aplica sobre `main`, confirma, sube y responde en la incidencia. Solo las cuentas con permiso de escritura (job `autorizar`) procesan las peticiones. El formato de la petición está en el [README](README.md) y en [ADR-0008](docs/decisions/ADR-0008-entrada-por-incidencias.md).

Buzón (ADR-0014 y ADR-0017): desde la web y la APK, cualquiera sube por `/api/subir` y entra público con la licencia de la web; además, quien tiene permiso de escritura sube audio a `audio-library/buzon/` desde https://github.com/seryi47/reminiscencia/upload/main/audio-library/buzon, con una línea `Licencia: …` en la descripción del commit. `buzon.yml` comprueba el permiso (`autorizar`), convierte a Opus sin token (`procesar`) y `publicar` valida el paquete, regenera la parte pública, confirma y sube a `main`. Para reprocesar lo que quede en el buzón se lanza a mano desde Actions; así entra privado.
