# PROJECT_MASTER

Documento central de estado. Se actualiza cuando cambia una decisión o el estado de un módulo.

Última actualización: 2026-10-31.

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
| [ADR-0005](docs/decisions/ADR-0005-entrada-por-url.md) | Entrada por URL: Internet Archive con licencia y ficheros directos con licencia | Aceptada |
| [ADR-0006](docs/decisions/ADR-0006-audio-publicado-en-la-web.md) | Audio publicado dentro del repositorio para la web | Aceptada |
| [ADR-0007](docs/decisions/ADR-0007-catalogo-y-flujo-desde-vercel.md) | Catálogo JSON versionado y flujo desde Vercel + GitHub Actions | Aceptada |

## Estado de módulos

| Módulo | Estado | Pruebas |
|---|---|---|
| Catálogo versionado (`backend/sonidos/catalog.py`) | Implementado; fuente de verdad | 8 pruebas |
| Importación por URL (`pipeline.py`, `intake.py`, `sources.py`) | Implementado; corre en GitHub Actions; cada redirección de una descarga se revisa (corrección de 2026-11-02) | 94 pruebas de fuentes, 11 de descargas y 5 de importación; 2 importaciones reales en CI con `library.yml` |
| Publicación y sincronización con la web (`publish.py`) | Implementado; `catalog.json` solo lista las canciones públicas | 4 pruebas |
| Workflow `biblioteca.yml` (importar, publicar, organizar desde incidencias; ADR-0008) | Implementado; sustituye a `library.yml` (4 ejecuciones reales en CI de la versión anterior); sin ejecutar todavía con una incidencia real | 11 guardas del workflow y 96 casos del contrato de peticiones |
| Administración en Vercel (`/admin/`) | **Retirada** en esta rama (ADR-0008): no hay panel ni `ADMIN_PASSWORD` | Guarda: `test_web_has_no_administration_code` |
| Funciones de Vercel (`api/`) | **Retiradas** en esta rama (ADR-0008) | Guarda: `test_web_has_no_administration_code` |
| Web pública de escucha (`frontend/web`) | **Pública** en https://reminiscencia.vercel.app; 9 pistas | Probada en escritorio y teléfono contra la URL pública |
| App Android (`mobile/`) | Versión 1.1.0: biblioteca desde Vercel, copia para escuchar sin conexión | Probada en emulador Android 15: en línea, streaming, descarga y sin conexión |
| Límites de GitHub (`limits.py`, `check_repo_limits.py`) | Implementado y comprobado en CI | 6 pruebas + CI |
| Preparación de publicación en Releases (`release.py`) | Implementado en modo simulación | 4 pruebas |
| Biblioteca publicada | 9 pistas de dominio público, todas con licencia declarada en su ítem | Verificada en la web |
| Experimento de compresión perceptual | **No iniciado** | — |
| Perfiles de pacientes y datos personales | **No iniciado** | — |
| Integración continua (GitHub Actions) | Verde: pruebas Python, app Flutter y límites del repositorio | backend.yml; biblioteca.yml sin ejecutar todavía en GitHub |

## Presupuesto

Sin gasto todavía. Las cifras de planes de pago se revisarán antes de contratar cualquier servicio, con su fuente oficial.
