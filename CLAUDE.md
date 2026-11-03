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

## Restricciones (no negociables)
- **Sin descarga de plataformas.** Nunca descargar desde YouTube, servicios de streaming ni de vídeo (ADR-0002, reafirmado en ADR-0005). La entrada por URL solo acepta Internet Archive con licencia en los metadatos o ficheros directos con licencia declarada. La lista de bloqueo está en `backend/sonidos/sources.py`; la web tiene su propia copia en `frontend/web/js/cuidador/incidencias.js`, con las mismas 42 entradas (la paridad la comprueba `tests/web-unit/cuidador-incidencias-paridad.test.mjs`). Se compara con el host canónico (sin punto final, en ancho completo ni con separadores ideográficos) y se revisa en cada redirección de una descarga; cada conexión solo va a direcciones públicas, validadas al conectar (ADR-0005). La web no puede aceptar más de lo que acepta el backend (ADR-0008).
- **Todo corre en GitHub y Vercel.** No hay panel de administración ni base de datos en el servidor: la fuente de verdad es `audio-library/indexes/catalog.json` (ADR-0007). El procesado pesado (descarga, ffmpeg) va en GitHub Actions, nunca en Vercel. No hay usuarios ni datos personales en la web (ADR-0015): los perfiles, el PIN, el registro del estudio y la copia cifrada `.rmc` de ADR-0009 están retirados. Las listas y los «Me gusta» viven solo en el navegador (IndexedDB `reminiscencia-biblioteca`) o en el teléfono, y lo mismo el audio subido «Solo en este navegador», en su propia base (ADR-0012), o «Solo en este teléfono» (ADR-0013).
- **Audio.** El audio de la biblioteca se versiona en `audio-library/audio/` (ADR-0007). Solo se publica al público lo que está en `frontend/web/audio/` (ADR-0006). Vigilar los límites de GitHub con `scripts/check_repo_limits.py`.
- **Sin datos personales de pacientes en el repositorio.** Nombres, fotografías y recuerdos reales nunca se versionan. Las personas se identifican con alias o identificadores.
- **Sin filtros destructivos** sobre el audio por defecto. Cualquier normalización o limpieza debe medirse antes de activarse.
- **Sin prometer resultados clínicos.** Toda afirmación sobre efectos de la música se presenta como hipótesis o como evidencia con su nivel.
- **Secretos fuera del repositorio.** No hay administración ni secretos en la web ni en la APK (ADR-0008). La hoja «Subir canciones» solo abre páginas de GitHub en otra pestaña: la subida al buzón («Para todos») o una incidencia nueva con el texto escrito («Desde Internet Archive»); no llama a la API ni guarda ningún token. Hay dos workflows que escriben en `main`, los dos con tres jobs: `biblioteca` y `buzon`. En ambos, `autorizar` comprueba el permiso de escritura de quien lo lanza (sin checkout), `procesar` no recibe token y `publicar` usa el `GITHUB_TOKEN` solo en los pasos que suben a `main` (y, en `biblioteca`, responden en la incidencia). Los checkouts de `biblioteca.yml`, `buzon.yml`, `backend.yml` y `web.yml`, y el del job de producción de `android.yml`, declaran `persist-credentials: false`, así que no dejan el token en `.git/config`; el primer checkout de `android.yml` (línea 41) y el de `web-e2e.yml` no lo declaran. Las claves de firma de Android están en `~/.android-keys/`.

## Arquitectura (resumen)
Estado de `main` a 2026-11-03: web y APK sin usuarios, con el aspecto de Spotify (ADR-0015).

- `backend/sonidos/`: `catalog` (catálogo JSON, fuente de verdad), `pipeline` (importar una URL), `buzon` (canciones subidas al buzón, ADR-0014), `intake` y `sources` (fuentes con licencia y lista de bloqueo), `issue_request` (contrato de las peticiones, ADR-0008), `paquete` (paquete de cambios entre `procesar` y `publicar`, ADR-0010), `publish` (regenera la parte pública: audio y `data/`), `probe`, `hashing`, `compression` (perfiles de ffmpeg), `limits` (límites de GitHub) y `release` (preparación de publicaciones en Releases, en modo simulación).
- `scripts/`: `ci_library.py` (punto de entrada de `biblioteca.yml`; lee sus entradas de variables de entorno, nunca de la línea de comandos), `buzon.py` (punto de entrada de `buzon.yml`; lee los archivos y los mensajes de commit del evento de GitHub), `issue_request.py` y `responder_incidencia.py` (validan la petición y responden en la incidencia), `empaquetar_cambios.py` y `aplicar_paquete.py` (paquete entre `procesar` y `publicar`), `check_repo_limits.py` (límites de GitHub) y `smoke_produccion.mjs` (comprueba la web pública; ver Comandos). Además, `compression/` (experimento objetivo de compresión), `android/` (icono y verificación del APK) y `web/` (iconos de la PWA).
- `.github/workflows/`:
  - `biblioteca.yml`: escrituras al catálogo desde incidencias con la etiqueta `biblioteca` de cuentas con permiso de escritura, o a mano. Concurrencia única. Tres jobs: `autorizar` (comprueba el permiso del autor), `procesar` (sin token) y `publicar` (valida el paquete, lo aplica, hace commit y push, y responde; ADR-0008 y ADR-0010).
  - `buzon.yml`: canciones subidas a `audio-library/buzon/` desde la página de subida de GitHub (push a `main` que toca el buzón) o a mano. Mismos tres jobs y misma cola (`library-catalog`) que `biblioteca.yml`. Con una línea `Licencia: …` en el mensaje del commit, la canción entra pública; sin ella, privada. A mano (`workflow_dispatch`) no hay mensaje de commit, así que todo lo pendiente entra privado (ADR-0014).
  - `backend.yml`: pruebas de Python en 3.12 y 3.13, app Flutter y límites del repositorio. No ejecuta pruebas web.
  - `web.yml`: sintaxis (`node --check`) y pruebas unitarias de la web (`node --test`), con cambios en `frontend/web/**` o `tests/web-unit/**`.
  - `web-e2e.yml`: pruebas de extremo a extremo y de accesibilidad con Chrome (`tests/web-e2e/`, Node 22), con cambios en `frontend/web/**` o `tests/web-e2e/**`.
  - `android.yml`: análisis, pruebas, APK de depuración y de producción, y release por etiqueta `android-vX.Y.Z`.
- `frontend/web/`: la carpeta que sirve Vercel (Root Directory). No tiene administración ni funciones de Vercel (ADR-0008).
  - `index.html` (una sola página, sin usuarios: abre en Inicio), `js/app.js` (arranque, rutas y estado), `js/views/` (Inicio, Buscar, Tu biblioteca, colección, reproductor y hoja «Subir canciones»), `js/ui/` (DOM e iconos SVG propios), `js/catalog.js` (catálogo en memoria), `js/player.js` (reproductor: cola, aleatorio, repetir y volumen), `css/` (`tokens.css` y `app.css`), `fonts/` (Figtree, OFL) e `icons/`. Especificación en `docs/user-experience/DESIGN.md` 2.0 (ADR-0015).
  - Datos locales y PWA: `js/local-library.js` (listas y «Me gusta» en IndexedDB, base `reminiscencia-biblioteca`, versión 1), `js/pwa.js`, `js/offline-core.js`, `sw.js` y `manifest.webmanifest`. El audio subido «Solo en este navegador» se convierte en `js/cuidador/subida-local.js` (IndexedDB `reminiscencia-audio-local`, ADR-0012) y `sw.js` lo sirve en `audio/L….opus`. La carpeta `js/cuidador/` conserva el nombre, aunque ya no hay modo cuidador: solo contiene `incidencias.js` y `subida-local.js`. Retirados por ADR-0015: `js/paciente/`, `js/store.js`, `js/schema.js`, `js/crypto.js`, `js/backup.js` (copia `.rmc`) y `js/prefs.js`.
  - Datos publicados: `data/` (`songs.json`, `folders.json` y `catalog.json`, generados por `publish`) y `audio/` (solo canciones públicas). `vercel.json` define cabeceras: política de contenido (CSP) y tipo del audio.
  - La lista de bloqueo de la web está en `js/cuidador/incidencias.js` (`BLOCKED_HOSTS`, 42 entradas, las mismas que `backend/sonidos/sources.py`; ADR-0008). La importación desde Internet Archive pasa además por `js/intake.js`.
- `mobile/`: app Flutter 1.2.0+3, sin usuarios ni modo paciente y con el aspecto de la app de Spotify. Lee `data/songs.json` y `data/folders.json` de la web y guarda una copia para escuchar sin conexión. Las listas y «Me gusta» se guardan solo en el teléfono (`colecciones.json`). Sube audio «Solo en este teléfono», convertido a Opus (ADR-0013), o abre la subida de GitHub al buzón («Para todos»). La release de producción lleva un APK por arquitectura (`arm64-v8a`, `armeabi-v7a` y `x86_64`; `android.yml`).
- `audio-library/`: catálogo (`indexes/catalog.json`), audio (`audio/`, también el de las canciones privadas) y buzón (`buzon/`, carpeta de paso del workflow `buzon`; ADR-0014).
- `tests/`: `web-unit/` (pruebas de la web con `node:test`, sin dependencias; `index.mjs` carga todos los ficheros) y `web-e2e/` (pruebas de extremo a extremo y de accesibilidad con puppeteer-core, axe-core y Chrome).
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

Buzón (ADR-0014): quien tiene permiso de escritura sube audio a `audio-library/buzon/` desde https://github.com/seryi47/reminiscencia/upload/main/audio-library/buzon, con una línea `Licencia: …` en la descripción del commit. `buzon.yml` comprueba el permiso (`autorizar`), convierte a Opus sin token (`procesar`) y `publicar` valida el paquete, regenera la parte pública, confirma y sube a `main`. Para reprocesar lo que quede en el buzón se lanza a mano desde Actions; así entra privado.
