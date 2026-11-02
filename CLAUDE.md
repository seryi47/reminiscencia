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
- **Todo corre en GitHub y Vercel.** No hay panel de administración ni base de datos en el servidor: la fuente de verdad es `audio-library/indexes/catalog.json` (ADR-0007). El procesado pesado (descarga, ffmpeg) va en GitHub Actions, nunca en Vercel. Los datos del cuidador viven solo en el navegador (IndexedDB, ADR-0009), y lo mismo el audio subido desde el dispositivo, en una base aparte (ADR-0012).
- **Audio.** El audio de la biblioteca se versiona en `audio-library/audio/` (ADR-0007). Solo se publica al público lo que está en `frontend/web/audio/` (ADR-0006). Vigilar los límites de GitHub con `scripts/check_repo_limits.py`.
- **Sin datos personales de pacientes en el repositorio.** Nombres, fotografías y recuerdos reales nunca se versionan. Las personas se identifican con alias o identificadores.
- **Sin filtros destructivos** sobre el audio por defecto. Cualquier normalización o limpieza debe medirse antes de activarse.
- **Sin prometer resultados clínicos.** Toda afirmación sobre efectos de la música se presenta como hipótesis o como evidencia con su nivel.
- **Secretos fuera del repositorio.** No hay administración ni secretos en la web (ADR-0008). La sección «Gestionar la biblioteca» (Biblioteca del modo cuidador) solo abre en GitHub una incidencia nueva con el texto escrito; no llama a la API ni guarda ningún token. El workflow `biblioteca` tiene tres jobs: `autorizar` (comprueba el permiso del autor; sin checkout), `procesar` no recibe token, y `publicar` usa el `GITHUB_TOKEN` solo en los pasos que suben a `main` y responden. Los checkouts de `biblioteca.yml`, `backend.yml` y `web.yml` declaran `persist-credentials: false`, así que no dejan el token en `.git/config`; `android.yml` (línea 39) y `web-e2e.yml` no lo declaran. Las claves de firma de Android están en `~/.android-keys/`.

## Arquitectura (resumen)
Estado de `main` a 2026-11-02, con la interfaz única (ADR-0009).

- `backend/sonidos/`: `catalog` (catálogo JSON, fuente de verdad), `pipeline` (importar una URL), `intake` y `sources` (fuentes con licencia y lista de bloqueo), `issue_request` (contrato de las peticiones, ADR-0008), `paquete` (paquete de cambios entre `procesar` y `publicar`, ADR-0010), `publish` (regenera la parte pública: audio y `data/`), `probe`, `hashing`, `compression` (perfiles de ffmpeg), `limits` (límites de GitHub) y `release` (preparación de publicaciones en Releases, en modo simulación).
- `scripts/`: `ci_library.py` (punto de entrada del workflow; lee sus entradas de variables de entorno, nunca de la línea de comandos), `issue_request.py` y `responder_incidencia.py` (validan la petición y responden en la incidencia), `empaquetar_cambios.py` y `aplicar_paquete.py` (paquete entre `procesar` y `publicar`), `check_repo_limits.py` (límites de GitHub) y `smoke_produccion.mjs` (comprueba la web pública; ver Comandos). Además, `compression/` (experimento objetivo de compresión), `android/` (icono y verificación del APK) y `web/` (iconos de la PWA).
- `.github/workflows/`:
  - `biblioteca.yml`: escrituras al catálogo desde incidencias con la etiqueta `biblioteca` de cuentas con permiso de escritura, o a mano. Concurrencia única. Tres jobs: `autorizar` (comprueba el permiso del autor), `procesar` (sin token) y `publicar` (valida el paquete, lo aplica, hace commit y push, y responde; ADR-0008 y ADR-0010).
  - `backend.yml`: pruebas de Python en 3.12 y 3.13, app Flutter y límites del repositorio. No ejecuta pruebas web.
  - `web.yml`: sintaxis (`node --check`) y pruebas unitarias de la web (`node --test`), con cambios en `frontend/web/**` o `tests/web-unit/**`.
  - `web-e2e.yml`: pruebas de extremo a extremo y de accesibilidad con Chrome (`tests/web-e2e/`, Node 22), con cambios en `frontend/web/**` o `tests/web-e2e/**`.
  - `android.yml`: análisis, pruebas, APK de depuración y de producción, y release por etiqueta `android-vX.Y.Z`.
- `frontend/web/`: la carpeta que sirve Vercel (Root Directory). No tiene administración ni funciones de Vercel (ADR-0008).
  - `index.html` (una sola página), `js/app.js` (arranque, modo y sesión), `js/paciente/` (escucha, listas, carpetas, búsqueda y salida), `js/cuidador/` (inicio, biblioteca, perfiles, ajustes, asistente, sesión e incidencias), `js/player.js` (reproductor), `css/` (tokens y estilos de cada modo), `fonts/` e `icons/` (ADR-0009).
  - Datos locales y PWA: `js/store.js` (IndexedDB, base `reminiscencia`, versión 3), `js/schema.js`, `js/crypto.js` y `js/backup.js` (copia cifrada `.rmc`), `js/prefs.js` (preferencias de pantalla), `js/pwa.js`, `js/offline-core.js`, `sw.js` y `manifest.webmanifest`. El audio subido desde el dispositivo se convierte en `js/cuidador/subida-local.js` (ADR-0012).
  - Datos publicados: `data/` (`songs.json`, `folders.json` y `catalog.json`, generados por `publish`) y `audio/` (solo canciones públicas). `vercel.json` define cabeceras: política de contenido (CSP) y tipo del audio.
  - La lista de bloqueo de la web está en `js/cuidador/incidencias.js` (`BLOCKED_HOSTS`, 42 entradas, las mismas que `backend/sonidos/sources.py`; ADR-0008).
- `mobile/`: app Flutter 1.1.0. Lee `data/songs.json` y `data/folders.json` de la web y guarda una copia para escuchar sin conexión. Permite subir audio local desde el teléfono, convertido a Opus y solo en el dispositivo (ADR-0013).
- `audio-library/`: catálogo (`indexes/catalog.json`) y audio (`audio/`), también el de las canciones privadas.
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

Flujo de la biblioteca (ADR-0008): una incidencia con la etiqueta `biblioteca` pasa por tres jobs separados: `autorizar` (comprueba que el autor tiene permiso de escritura), `procesar` y `publicar`. El disparo manual del workflow empieza en `procesar`. `procesar` aplica la petición en su copia de trabajo, sin token, y deja un paquete de cambios. `publicar` valida ese paquete, lo aplica sobre `main`, confirma, sube y responde en la incidencia. Solo las cuentas con permiso de escritura (job `autorizar`) procesan las peticiones. El formato de la petición está en el [README](README.md) y en [ADR-0008](docs/decisions/ADR-0008-entrada-por-incidencias.md).
