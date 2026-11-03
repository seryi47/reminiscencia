# PROJECT_MASTER

Documento central de estado. Se actualiza cuando cambia una decisión o el estado de un módulo.

Última actualización: 2026-11-03.

## Estado general

- **Biblioteca:** 14 canciones en el catálogo, 10 públicas y 4 privadas, sin carpetas. Probados en GitHub: importar, publicar y despublicar por incidencias («Tell me pretty maiden», incidencias #1 a #3; «Nomyn Fragments», publicada por incidencia el 2026-11-02, commit del bot `7b73d19`) y el buzón por la vía privada (2026-11-03: la ejecución por push terminó sin procesar nada porque el evento no traía las listas de archivos; tras la corrección `34a1f06`, la ejecución manual dio de alta «tono-de-prueba-buzon» como privada, commit del bot `4f6c73d`).
- **Web pública:** sin usuarios y con el aspecto de Spotify (ADR-0015), desplegada desde `main`. No tiene administración, perfiles, modos, PIN ni registro del estudio. Listas y «Me gusta» solo en el navegador.
- **App Android:** 1.2.0+3 (`mobile/pubspec.yaml`), también sin usuarios ni modo paciente y con el aspecto de la app de Spotify. Sin etiqueta `android-v1.2.0` ni release en GitHub todavía.
- **Subida de audio:** «Solo en este navegador» (ADR-0012) y «Solo en este teléfono» (ADR-0013), convertida a Opus y sin salir del dispositivo; «Para todos» por el buzón y `buzon.yml` (ADR-0014).
- **Pruebas (2026-11-03, `main` `b058a0c`):** web unitarias 274 de 274 (`node --test "tests/web-unit/*.test.mjs"`); backend 566 de 566 (`pytest`, local). En GitHub, `web.yml`, `web-e2e.yml` y `backend.yml` en verde sobre `ae22479`.
- **Pendiente, con motivo:** decidir cómo se estudian las hipótesis sin el registro del estudio (ADR-0015); probar el buzón con una línea `Licencia:` (vía pública) y la cola compartida con `biblioteca.yml`; 18 referencias abiertas de BIBLIOGRAPHY.md (no verificadas o parciales).
- **Integración continua:** `backend.yml`, `web.yml`, `web-e2e.yml`, `biblioteca.yml` y `buzon.yml` en verde. `android.yml` no se ha ejecutado todavía.
- **Repositorio:** privado (comprobado en GitHub el 2026-11-03).

## Visión

Plataforma que permita reproducir música personalizada para personas con Alzheimer y sus familias, y que al mismo tiempo sirva para estudiar, con método, la relación entre música, memoria autobiográfica y emociones.

## Objetivos

1. Investigación doctoral documentada y verificable.
2. Biblioteca musical con identificadores estables, sin duplicados y con licencia registrada.
3. Reproductor accesible, sin cuentas (el panel para cuidadores de ADR-0009 está retirado por ADR-0015).
4. Infraestructura en GitHub como centro de control.
5. Aplicación web desplegada en Vercel y APK Android instalable.

## Hipótesis (estado: propuestas, no demostradas)

- H1: la música elegida por el paciente produce mayor respuesta emocional que una lista genérica.
- H2: la música asociada a un recuerdo facilita la evocación autobiográfica frente a silencio o música desconocida.
- H3: la familiaridad modula la respuesta emocional (se solapa con H1; pendiente de separarla).
- H4: la asociación de fotografías aumenta el recuerdo frente a la música sola. Sin evidencia directa.
- H5: una interfaz adaptada reduce dificultades de uso. Es un estudio de usabilidad, separado del clínico.

Detalle en [RESEARCH.md](RESEARCH.md). La web ya no tiene el registro del estudio ni las presentaciones C0 a C2 con recuerdos y fotografías (ADR-0015): H2, H3 y H4 necesitan otro instrumento o una decisión nueva antes del piloto.

## Decisiones clave

| ADR | Decisión | Estado |
|---|---|---|
| [ADR-0001](docs/decisions/ADR-0001-stack.md) | Python + ffmpeg, pytest, GitHub Actions; web estática en Vercel; Flutter para Android | Aceptada (parcialmente sustituida por 0006 y 0007 en la fuente de verdad) |
| [ADR-0002](docs/decisions/ADR-0002-fuentes-de-audio.md) | Sin descarga desde plataformas; importación sólo con licencia | Aceptada (ampliada por 0005) |
| [ADR-0003](docs/decisions/ADR-0003-almacenamiento-audio-github.md) | Almacenamiento del audio dentro del ecosistema GitHub | Aceptada; sustituida para el audio de la biblioteca por 0007 |
| [ADR-0004](docs/decisions/ADR-0004-app-android-flutter.md) | App Android con Flutter, que lee la biblioteca de la web | Aceptada |
| [ADR-0005](docs/decisions/ADR-0005-entrada-por-url.md) | Entrada por URL: Internet Archive con licencia y ficheros directos con licencia | Aceptada; su entrada por `/admin/` queda sustituida por ADR-0008 |
| [ADR-0006](docs/decisions/ADR-0006-audio-publicado-en-la-web.md) | Audio publicado dentro del repositorio para la web | Aceptada |
| [ADR-0007](docs/decisions/ADR-0007-catalogo-y-flujo-desde-vercel.md) | Catálogo JSON versionado y flujo desde Vercel + GitHub Actions | Aceptada; sus puntos 4 y 5 (administración en Vercel) quedan sustituidos por ADR-0008 |
| [ADR-0008](docs/decisions/ADR-0008-entrada-por-incidencias.md) | Entrada de la biblioteca por incidencias de GitHub; sin administración en la web | Aceptada (2026-10-31); en `main` |
| [ADR-0009 (interfaz)](docs/decisions/ADR-0009-interfaz-unica-y-datos-locales.md) | Interfaz única para paciente y cuidador, y datos locales en el navegador | Aceptada; sustituida en parte por ADR-0015 (perfiles, modos, PIN, registro del estudio y copia `.rmc`). Siguen vigentes sus decisiones 1, 5 y 7 |
| [ADR-0010 (procesado)](docs/decisions/ADR-0010-procesado-y-publicacion-separados.md) | Procesado y publicación separados, con paquete de cambios validado antes de publicar | Aceptada; en `main` |
| [ADR-0011 (parte pública)](docs/decisions/ADR-0011-publicar-regenera-parte-publica.md) | Publicar regenera la parte pública desde el catálogo | Aceptada; en `main` |
| [ADR-0012 (audio local)](docs/decisions/ADR-0012-audio-subido-local-solo-navegador.md) | Audio subido desde el dispositivo, convertido a Opus y guardado solo en el navegador | Aceptada; en `main`. Sus puntos sobre la copia cifrada y el reproductor quedan sustituidos por ADR-0015 |
| [ADR-0013 (audio local en la APK)](docs/decisions/ADR-0013-audio-subido-local-apk.md) | Audio subido desde el teléfono, convertido a Opus y guardado solo en la APK | Aceptada; en `main` |
| [ADR-0014 (buzón)](docs/decisions/ADR-0014-buzon-de-canciones.md) | Canciones subidas a `audio-library/buzon/` desde GitHub, procesadas por `buzon.yml`; pública con «Licencia: …», privada sin ella | Aceptada; en `main`. Vía privada probada en GitHub (2026-11-03); vía pública sin probar |
| [ADR-0015 (sin usuarios)](docs/decisions/ADR-0015-interfaz-sin-usuarios-aspecto-spotify.md) | Web y APK sin usuarios, con el aspecto de Spotify; listas y «Me gusta» solo en el dispositivo; se retira la copia `.rmc` | Aceptada; en `main` (2026-11-03) |

Numeración: `ADR-0009` es la interfaz única y `ADR-0010` el procesado y la publicación separados (renumerado el 2026-11-02). `ADR-0014` es el buzón y `ADR-0015` la interfaz sin usuarios (renumerado el 2026-11-03; algunos comentarios del código citan aún ADR-0014 para la interfaz).

## Estado de módulos

| Módulo | Estado | Pruebas |
|---|---|---|
| Catálogo versionado (`backend/sonidos/catalog.py`) | Implementado; fuente de verdad. 14 canciones: 10 públicas y 4 privadas | 14 (`test_catalog.py`) |
| Importación por URL (`pipeline.py`, `intake.py`, `sources.py`) | Implementado; corre en el job `procesar` de `biblioteca.yml`. Cada redirección y cada conexión validan la dirección. Acepta `archive.org/details/<id>` y `archive.org/download/<id>` | 123 de fuentes (`test_sources.py`), 25 de descargas (`test_intake.py`) y 8 de importación (`test_pipeline.py`) |
| Contrato de las peticiones (`issue_request.py`, `scripts/issue_request.py`) | Implementado; valida el texto de la incidencia antes de tocar nada | 98 casos (`test_issue_request.py`) |
| Publicación y sincronización con la web (`publish.py`) | Implementado; la web solo recibe canciones públicas | 7 (`test_publish.py`) |
| Paquete entre `procesar` y `publicar` (`paquete.py`, `empaquetar_cambios.py`, `aplicar_paquete.py`) | Implementado y ejecutado en GitHub con la prueba real, antes de la corrección de 2026-11-02. Desde entonces el paquete lleva solo el catálogo y el audio, y `publicar` regenera la parte pública desde el catálogo (ADR-0010). Pendiente: probar esta versión en GitHub | 63 (`test_paquete.py`), 3 del script (`test_aplicar_paquete.py`) y 20 de seguridad (`test_paquete_seguridad.py`) |
| Workflow `buzon.yml` (canciones subidas a `audio-library/buzon/`; ADR-0014) | Implementado en tres jobs, con la misma cola que `biblioteca.yml`. Vía privada probada en GitHub el 2026-11-03 (ejecución manual); también se lanza a mano para reprocesar lo pendiente. Sin probar: una subida con «Licencia: …» y la cola compartida | `test_buzon.py` y `test_buzon_workflow.py` |
| Workflow `biblioteca.yml` (importar, publicar, despublicar desde incidencias; ADR-0008 y ADR-0010) | Implementado en tres jobs (`autorizar`, `procesar` y `publicar`). Probado con las incidencias reales #1 (importar), #2 y #3 (publicar y despublicar), las tres cerradas con respuesta automática. Sustituye al workflow anterior, ya retirado | 27 guardas (`test_biblioteca_workflow.py`); 8 de `ci_library` (`test_ci_library.py`) y 8 de la respuesta a la incidencia (`test_responder_incidencia.py`) |
| Administración en Vercel (`/admin/`, funciones `api/`) | **Retirada** (ADR-0008): no hay panel, `ADMIN_PASSWORD` ni funciones de Vercel en el código | Guarda: `test_web_has_no_administration_code` (`test_biblioteca_workflow.py`) |
| Interfaz web (`frontend/web`: `index.html`, `js/app.js`, `js/views/`, `js/ui/`, `js/catalog.js`, `js/player.js`) | **Pública** en https://reminiscencia.vercel.app, con 10 pistas. Sin usuarios, con el aspecto de Spotify (ADR-0015; DESIGN 2.0). `web-e2e.yml` en verde sobre `ae22479` | Unitarias (`tests/web-unit/`, 274) y de extremo a extremo (`tests/web-e2e/`: `funcional`, `a11y` y `medidas`) |
| Importar desde Internet Archive (`js/cuidador/incidencias.js` y `js/intake.js`, hoja «Subir canciones») | Valida la petición y abre la incidencia en GitHub. Su lista de bloqueo tiene 42 entradas, las mismas que la del backend. La hoja «Gestionar la biblioteca» (publicar, editar, carpetas) está retirada (ADR-0015): esas operaciones se escriben a mano en la incidencia | `cuidador-incidencias.test.mjs` y `cuidador-incidencias-paridad.test.mjs` |
| Listas, «Me gusta» y PWA (`js/local-library.js`, `js/pwa.js`, `js/offline-core.js`, `sw.js`) | IndexedDB `reminiscencia-biblioteca` (versión 1), solo en este navegador; descarga por carpeta o lista para escuchar sin conexión (`SHELL_VERSION` 5). **Retirados** (ADR-0015): `js/store.js`, `js/schema.js`, `js/crypto.js`, `js/backup.js` (copia `.rmc`), `js/prefs.js` y el PIN | `local-library`, `offline-core` y `player` en `tests/web-unit/` |
| Audio subido desde el dispositivo (`js/cuidador/subida-local.js`, IndexedDB `reminiscencia-audio-local`; ADR-0012) | Implementado en `main`: convierte a Opus en el navegador y no sale de él. Se borra desde el menú de su fila, y al borrarla sale también de las listas y de «Me gusta». `sw.js` la sirve en `audio/L….opus` | `subida-local.test.mjs` y `upload.test.mjs` |
| Interfaz única con modos paciente y cuidador (ADR-0009) | **Retirada** por ADR-0015 el 2026-11-03. La base `reminiscencia` de los navegadores que la usaron no se abre ni se borra | — |
| App Android (`mobile/`) | Versión 1.2.0+3 (`pubspec.yaml`): sin usuarios ni modo paciente, aspecto de la app de Spotify, biblioteca desde la web, listas y «Me gusta» en el teléfono, copia para escuchar sin conexión, subida «Solo en este teléfono» (ADR-0013) y «Para todos» (abre la subida de GitHub al buzón) | Pruebas Flutter (109 en verde según CHANGELOG); la 1.1.0 se probó en emulador Android 15. Pendiente en dispositivo físico |
| Compilación y firma de Android (`.github/workflows/android.yml`) | Implementado en `main`, **sin ninguna ejecución en GitHub**. La release por etiqueta `android-vX.Y.Z` lleva un APK de producción por arquitectura (`arm64-v8a`, `armeabi-v7a` y `x86_64`) y `SHA256SUMS.txt`. El APK de producción requiere cuatro secretos de firma, que hoy no existen en el repositorio | Análisis, pruebas y verificación del APK dentro del workflow |
| Límites de GitHub (`limits.py`, `check_repo_limits.py`) | Implementado y comprobado en CI | 7 (`test_limits.py`) y el job `limites-repositorio` de `backend.yml` |
| Preparación de publicación en Releases (`release.py`) | Implementado en modo simulación | 5 (`test_release.py`) |
| Biblioteca publicada | 10 pistas públicas, con la licencia declarada en su ítem de Internet Archive: 9 de dominio público y «Nomyn Fragments» con CC BY 4.0 (`frontend/web/data/songs.json`) | `node scripts/smoke_produccion.mjs` comprueba páginas, datos, tipos, audio y que no se sirva nada privado |
| Experimento de compresión objetivo (`scripts/compression/`, `research-data/compression/`) | Hecho el 2026-10-31 con cinco grabaciones de dominio público: tamaño, tasa, tiempos, SNR y LSD. Sin pruebas perceptuales | `scripts/compression/test_metrics.py`; no lo ejecuta el CI de `backend.yml` |
| Prueba perceptual de compresión (MUSHRA) | **No iniciada** | — |
| Perfiles de pacientes y datos personales | **Retirado** (ADR-0015): la web y la APK no guardan perfiles, recuerdos, fotografías, observaciones ni registro del estudio | — |
| Integración continua (GitHub Actions) | En verde en `main`: `backend.yml` (Python 3.12 y 3.13, Flutter y límites; sin pruebas web), `web.yml`, `web-e2e.yml`, `biblioteca.yml` y `buzon.yml`. `android.yml` sin ejecutar | Ver los workflows |

## Presupuesto

Sin gasto todavía. Las cifras de planes de pago se revisarán antes de contratar cualquier servicio, con su fuente oficial.
