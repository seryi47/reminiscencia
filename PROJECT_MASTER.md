# PROJECT_MASTER

Documento central de estado. Se actualiza cuando cambia una decisión o el estado de un módulo.

Última actualización: 2026-11-02.

## Estado general

- **Biblioteca:** 12 canciones en el catálogo, 9 públicas y 3 privadas. La importación, la publicación y la despublicación por incidencias se probaron en GitHub con «Tell me pretty maiden» (incidencias #1 a #3, cerradas con respuesta automática del workflow).
- **Web pública:** interfaz única (modo paciente y modo cuidador) desplegada desde `main`. No tiene administración.
- **Interfaz única** (paciente y cuidador): implementada (ADR-0009). Pendiente de rediseño visual (decisión del propietario, 2026-11-02).
- **Pruebas:** 400 de 400 en el backend (`pytest`), según la última ejecución registrada. Las pruebas web (`node --test`) y las e2e (`tests/web-e2e/`) hay que recalcularlas tras la fusión de la interfaz; el resultado e2e figura en CHANGELOG.
- **Integración continua:** `backend.yml`, `web.yml` y `biblioteca.yml` en verde. `web-e2e.yml` es nuevo (resultado en CHANGELOG). `android.yml` no se ha ejecutado todavía.
- **Repositorio:** privado (comprobado en GitHub el 2026-11-02).

## Visión

Plataforma que permita reproducir música personalizada para personas con Alzheimer y sus familias, y que al mismo tiempo sirva para estudiar, con método, la relación entre música, memoria autobiográfica y emociones.

## Objetivos

1. Investigación doctoral documentada y verificable.
2. Biblioteca musical con identificadores estables, sin duplicados y con licencia registrada.
3. Reproductor accesible para pacientes y panel para cuidadores.
4. Infraestructura en GitHub como centro de control.
5. Aplicación web desplegada en Vercel y APK Android instalable.

## Hipótesis (estado: propuestas, no demostradas)

- H1: la música elegida por el paciente produce mayor respuesta emocional que una lista genérica.
- H2: la música asociada a un recuerdo facilita la evocación autobiográfica frente a silencio o música desconocida.
- H3: la familiaridad modula la respuesta emocional (se solapa con H1; pendiente de separarla).
- H4: la asociación de fotografías aumenta el recuerdo frente a la música sola. Sin evidencia directa.
- H5: una interfaz adaptada reduce dificultades de uso. Es un estudio de usabilidad, separado del clínico.

Detalle en [RESEARCH.md](RESEARCH.md).

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
| [ADR-0009 (interfaz)](docs/decisions/ADR-0009-interfaz-unica-y-datos-locales.md) | Interfaz única para paciente y cuidador, y datos locales en el navegador | Aceptada e implementada (código en `feat/ui-publica`, commit 9d4ae8f) |
| [ADR-0010 (procesado)](docs/decisions/ADR-0010-procesado-y-publicacion-separados.md) | Procesado y publicación separados, con paquete de cambios validado antes de publicar | Aceptada; en `main` |

Numeración: `ADR-0009` es la interfaz única y `ADR-0010` el procesado y la publicación separados (renumerado el 2026-11-02).

## Estado de módulos

| Módulo | Estado | Pruebas |
|---|---|---|
| Catálogo versionado (`backend/sonidos/catalog.py`) | Implementado; fuente de verdad. 12 canciones: 9 públicas y 3 privadas | 14 (`test_catalog.py`) |
| Importación por URL (`pipeline.py`, `intake.py`, `sources.py`) | Implementado; corre en el job `procesar` de `biblioteca.yml`. Cada redirección y cada conexión validan la dirección. Acepta `archive.org/details/<id>` y `archive.org/download/<id>` | 123 de fuentes (`test_sources.py`), 25 de descargas (`test_intake.py`) y 8 de importación (`test_pipeline.py`) |
| Contrato de las peticiones (`issue_request.py`, `scripts/issue_request.py`) | Implementado; valida el texto de la incidencia antes de tocar nada | 98 casos (`test_issue_request.py`) |
| Publicación y sincronización con la web (`publish.py`) | Implementado; la web solo recibe canciones públicas | 7 (`test_publish.py`) |
| Paquete entre `procesar` y `publicar` (`paquete.py`, `empaquetar_cambios.py`, `aplicar_paquete.py`) | Implementado y ejecutado en GitHub con la prueba real, antes de la corrección de 2026-11-02. Desde entonces el paquete lleva solo el catálogo y el audio, y `publicar` regenera la parte pública desde el catálogo (ADR-0010). Pendiente: probar esta versión en GitHub | 63 (`test_paquete.py`), 3 del script (`test_aplicar_paquete.py`) y 20 de seguridad (`test_paquete_seguridad.py`) |
| Workflow `biblioteca.yml` (importar, publicar, despublicar desde incidencias; ADR-0008 y ADR-0010) | Implementado en tres jobs (`autorizar`, `procesar` y `publicar`). Probado con las incidencias reales #1 (importar), #2 y #3 (publicar y despublicar), las tres cerradas con respuesta automática. Sustituye al workflow anterior, ya retirado | 27 guardas (`test_biblioteca_workflow.py`); 8 de `ci_library` (`test_ci_library.py`) y 8 de la respuesta a la incidencia (`test_responder_incidencia.py`) |
| Administración en Vercel (`/admin/`, funciones `api/`) | **Retirada** (ADR-0008): no hay panel, `ADMIN_PASSWORD` ni funciones de Vercel en el código | Guarda: `test_web_has_no_administration_code` (`test_biblioteca_workflow.py`) |
| Interfaz web (`frontend/web`: `index.html`, `js/app.js`, `js/paciente/`, `js/cuidador/`) | **Pública** en https://reminiscencia.vercel.app, con 9 pistas. Modo paciente y modo cuidador en una página (ADR-0009). Probada en escritorio y teléfono en una versión anterior; pendiente de repetirla | Pruebas unitarias (`tests/web-unit/`) y de extremo a extremo (`tests/web-e2e/`) |
| Gestionar la biblioteca (`js/cuidador/incidencias.js`, en Biblioteca) | Valida la petición y abre la incidencia en GitHub. Su lista de bloqueo tiene 11 dominios; la del backend tiene más (pendiente de igualar, ver ROADMAP) | `cuidador-incidencias.test.mjs` |
| Datos locales, copia cifrada y PWA (`js/store.js` versión 3, `js/schema.js`, `js/crypto.js`, `js/backup.js`, `js/pwa.js`, `js/offline-core.js`, `sw.js`) | Conectados a la interfaz: IndexedDB, copia `.rmc`, PIN local y uso sin conexión | `store-*`, `backup`, `crypto`, `offline-core`, `schema` y `player` en `tests/web-unit/` |
| Interfaz única (ADR-0009) | Implementada: pantallas de paciente y cuidador en una sola página. Pendiente de rediseño visual y de las discrepancias de DESIGN §17 | Suite e2e `tests/web-e2e/` (resultado en CHANGELOG) |
| App Android (`mobile/`) | Versión 1.1.0 (`pubspec.yaml`): biblioteca desde la web, listas, favoritos, modo paciente y copia para escuchar sin conexión | Probada en emulador Android 15 según la fase 5 del ROADMAP; pendiente en dispositivo físico |
| Compilación y firma de Android (`.github/workflows/android.yml`) | Implementado en `main`, **sin ninguna ejecución en GitHub**. El APK de producción requiere cuatro secretos de firma, que hoy no existen en el repositorio | Análisis, pruebas y verificación del APK dentro del workflow |
| Límites de GitHub (`limits.py`, `check_repo_limits.py`) | Implementado y comprobado en CI | 7 (`test_limits.py`) y el job `limites-repositorio` de `backend.yml` |
| Preparación de publicación en Releases (`release.py`) | Implementado en modo simulación | 5 (`test_release.py`) |
| Biblioteca publicada | 9 pistas públicas de dominio público, según la licencia declarada en su ítem de Internet Archive (`frontend/web/data/songs.json`) | Pendiente: repetir la comprobación en la web tras el despliegue de `main` |
| Experimento de compresión objetivo (`scripts/compression/`, `research-data/compression/`) | Hecho el 2026-10-31 con cinco grabaciones de dominio público: tamaño, tasa, tiempos, SNR y LSD. Sin pruebas perceptuales | `scripts/compression/test_metrics.py`; no lo ejecuta el CI de `backend.yml` |
| Prueba perceptual de compresión (MUSHRA) | **No iniciada** | — |
| Perfiles de pacientes y datos personales | Implementado en la interfaz del cuidador (IndexedDB, ADR-0009). Sin sincronización entre dispositivos | `store-*` y `cuidador-perfil` en `tests/web-unit/` |
| Integración continua (GitHub Actions) | En verde en `main`: `backend.yml` (Python 3.12 y 3.13, Flutter y límites; sin pruebas web), `web.yml` y `biblioteca.yml`. `web-e2e.yml` (nuevo) y `android.yml` sin ejecutar | Ver los workflows |

## Presupuesto

Sin gasto todavía. Las cifras de planes de pago se revisarán antes de contratar cualquier servicio, con su fuente oficial.
