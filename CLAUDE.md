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
- **Sin descarga de plataformas.** Nunca descargar desde YouTube, servicios de streaming ni de vídeo (ADR-0002, reafirmado en ADR-0005). La entrada por URL solo acepta Internet Archive con licencia en los metadatos o ficheros directos con licencia declarada. La lista de bloqueo está en `backend/sonidos/sources.py`, y la web tiene una copia idéntica en `frontend/web/js/intake.js`. Se compara con el host canónico (sin punto final, en ancho completo ni con separadores ideográficos) y se revisa en cada redirección de una descarga; cada conexión solo va a direcciones públicas, validadas al conectar (ADR-0005). La web no puede aceptar más de lo que acepta el backend (ADR-0008).
- **Todo corre en GitHub y Vercel.** No hay panel de administración ni base de datos en el servidor: la fuente de verdad es `audio-library/indexes/catalog.json` (ADR-0007). El procesado pesado (descarga, ffmpeg) va en GitHub Actions, nunca en Vercel. Los datos del cuidador viven solo en el navegador (IndexedDB, ADR-0010).
- **Audio.** El audio de la biblioteca se versiona en `audio-library/audio/` (ADR-0007). Solo se publica al público lo que está en `frontend/web/audio/` (ADR-0006). Vigilar los límites de GitHub con `scripts/check_repo_limits.py`.
- **Sin datos personales de pacientes en el repositorio.** Nombres, fotografías y recuerdos reales nunca se versionan. Las personas se identifican con alias o identificadores.
- **Sin filtros destructivos** sobre el audio por defecto. Cualquier normalización o limpieza debe medirse antes de activarse.
- **Sin prometer resultados clínicos.** Toda afirmación sobre efectos de la música se presenta como hipótesis o como evidencia con su nivel.
- **Secretos fuera del repositorio.** No hay administración ni secretos en la web (ADR-0008). La sección «Gestionar» solo abre en GitHub una incidencia nueva con el texto escrito; no llama a la API ni guarda ningún token. El workflow `biblioteca` tiene dos jobs: `procesar` no recibe token, y `publicar` usa el `GITHUB_TOKEN` solo en los pasos que suben a `main` y responden. Ningún checkout deja el token en `.git/config` (`persist-credentials: false`). Las claves de firma de Android están en `~/.android-keys/`.

## Arquitectura (resumen)
Estado de `main` a 2026-11-02. Lo que solo existe en una rama aparece como «en curso».

- `backend/sonidos/`: `catalog` (catálogo JSON, fuente de verdad), `pipeline` (importar una URL), `intake` y `sources` (fuentes con licencia y lista de bloqueo), `issue_request` (contrato de las peticiones, ADR-0008), `paquete` (paquete de cambios entre `procesar` y `publicar`, ADR-0010), `publish` (regenera la parte pública: audio y `data/`), `probe`, `hashing`, `compression` (perfiles de ffmpeg), `limits` (límites de GitHub) y `release` (preparación de publicaciones en Releases, en modo simulación).
- `scripts/`: `ci_library.py` (punto de entrada del workflow; lee sus entradas de variables de entorno, nunca de la línea de comandos), `issue_request.py` y `responder_incidencia.py` (validan la petición y responden en la incidencia), `empaquetar_cambios.py` y `aplicar_paquete.py` (paquete entre `procesar` y `publicar`), `check_repo_limits.py` (límites de GitHub). Además, `compression/` (experimento objetivo de compresión), `android/` (icono y verificación del APK) y `web/` (iconos de la PWA).
- `.github/workflows/`:
  - `biblioteca.yml`: escrituras al catálogo desde incidencias del propietario con la etiqueta `biblioteca`, o a mano. Concurrencia única. `procesar` no tiene token; `publicar` valida el paquete, lo aplica, hace commit y push, y responde (ADR-0008 y ADR-0010).
  - `backend.yml`: pruebas de Python en 3.12 y 3.13, app Flutter, límites del repositorio y pruebas web. Esta última parte está duplicada en `web.yml`.
  - `web.yml`: sintaxis y pruebas de la web.
  - `android.yml`: análisis, pruebas, APK de depuración y de producción, y release por etiqueta `android-vX.Y.Z`.
- `frontend/web/`: la carpeta que sirve Vercel (Root Directory). No tiene administración ni funciones de Vercel (ADR-0008).
  - En main: `index.html` y `app.js` (escucha; lee `data/songs.json` y `data/folders.json`), `styles.css` y `listen.css`, `js/gestion.js` (sección «Gestionar») y `js/intake.js` (contrato de las peticiones en el navegador), `js/store.js`, `js/schema.js`, `js/crypto.js` y `js/backup.js` (datos locales del cuidador), `js/pwa.js`, `js/offline-core.js`, `sw.js`, `manifest.webmanifest` e `icons/`. Los módulos de datos locales y de la PWA están en main, pero la página todavía no los carga.
  - Datos publicados: `data/` (`songs.json`, `folders.json` y `catalog.json`, generados por `publish`) y `audio/` (solo canciones públicas). `vercel.json` solo define cabeceras: política de contenido y tipo del audio.
  - En curso, en la rama `feat/ui-publica` (sin fusionar): interfaz única con `index.html`, `js/app.js`, `js/paciente/`, `js/cuidador/` y `css/` (ADR-0009). El número ADR-0009 está repetido en otra decisión; ver [ROADMAP](ROADMAP.md).
- `mobile/`: app Flutter 1.1.0. Lee `data/songs.json` y `data/folders.json` de la web y guarda una copia para escuchar sin conexión.
- `audio-library/`: catálogo (`indexes/catalog.json`) y audio (`audio/`), también el de las canciones privadas.
- `tests/`: `web-unit/` (pruebas de la web con `node --test`). `web-e2e/` existe solo en la rama `feat/ui-publica`.
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

Pruebas de extremo a extremo (solo en la rama `feat/ui-publica`; todavía no están en main):
```
cd tests/web-e2e && npm ci && npm test
```

Flujo de la biblioteca (ADR-0008): una incidencia con la etiqueta `biblioteca`, o el disparo manual del workflow, pasa por dos jobs separados. `procesar` aplica la petición en su copia de trabajo, sin token, y deja un paquete de cambios. `publicar` valida ese paquete, lo aplica sobre `main`, confirma, sube y responde en la incidencia. Solo el propietario procesa las peticiones. El formato de la petición está en el [README](README.md) y en [ADR-0008](docs/decisions/ADR-0008-entrada-por-incidencias.md).
