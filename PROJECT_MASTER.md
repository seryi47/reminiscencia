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
| [ADR-0001](docs/decisions/ADR-0001-stack.md) | Python + SQLite + ffmpeg; pytest; GitHub Actions | Aceptada |
| [ADR-0002](docs/decisions/ADR-0002-fuentes-de-audio.md) | Sin descarga desde plataformas; importación sólo con licencia | Aceptada |
| [ADR-0003](docs/decisions/ADR-0003-almacenamiento-audio-github.md) | Audio como assets de GitHub Releases; índice JSON versionado | Aceptada, sin implementar |

## Estado de módulos

| Módulo | Estado | Pruebas |
|---|---|---|
| Lectura de metadatos (probe) | Implementado | 2 pruebas |
| Huella SHA-256 | Implementado | Cubierto por pruebas de biblioteca |
| Perfiles de transcodificación | Implementado | Prueba de variante Opus |
| Biblioteca SQLite con duplicados y licencia obligatoria | Implementado | 5 pruebas |
| Importación de archivo local | Implementado | Cubierto |
| CLI (`import`, `list`, `stats`, `export-index`) | Implementado | 3 pruebas |
| Índice JSON sin rutas locales | Implementado | 1 prueba |
| Biblioteca publicada: 8 pistas de dominio público, release `audio-2026-10-31-01` | Implementado; SHA-256 verificado tras descarga | — |
| Experimento de compresión perceptual | **No iniciado** | — |
| Límites de GitHub (asset < 2 GiB, 1000 assets, Git 100 MiB) | Implementado y comprobado en CI (`scripts/check_repo_limits.py`) | 6 pruebas |
| Preparación de publicación en Releases (lotes, manifiesto SHA-256, comandos gh) | Implementado en modo simulación; **subida real no ejecutada** | 4 pruebas |
| API web (FastAPI) | **No iniciado** | — |
| Web de paciente (HTML estático, Vercel `sonidos-alzheimer`) | Desplegada; **privada por SSO de Vercel** hasta que se desactive la protección | Probada en Chrome |
| Web de cuidador | **No iniciado** | — |
| App Android (Flutter, `mobile/`) | APK de publicación probada en emulador Android 15; firma de producción pendiente | 2 pruebas unitarias + prueba en emulador |
| Perfiles de pacientes y datos personales | **No iniciado** | — |
| Integración continua (GitHub Actions) | Verificada: verde en Python 3.12 y 3.13 (commit 891149c) | 11 pruebas |

## Problemas pendientes

- **Legal:** dictamen sobre copia privada y uso de archivos familiares; fuente concreta de música para el piloto.
- **Almacenamiento:** confirmar que Releases admite audio y revisar las políticas de uso aceptable de GitHub.
- **Vercel:** el plan Hobby es sólo para uso no comercial. Válido mientras el proyecto sea académico; si se convierte en producto o se desarrolla para un cliente, hace falta Pro.
- **Datos de salud:** antes de tratar datos de pacientes, RGPD (artículo 9), LOPDGDD y aprobación ética.
- **Vercel público:** la web está desplegada, pero la protección SSO bloquea el acceso externo. Desactivarla debilita una protección de tu cuenta; lo decides tú. Hasta entonces, la URL responde con redirección a inicio de sesión.
- **Firma de la APK:** la APK de publicación está firmada con la clave de depuración. Para distribuirla hace falta una clave de producción propia.
- **Licencias de las pistas:** las grabaciones son de dominio público según la declaración del depositante en Internet Archive. Esto no lo ha verificado un abogado. Las pistas de 1920 son repertorio de jazz, poco representativo de la memoria de las personas que van a usar la app.

## Presupuesto

Sin gasto todavía. Las cifras de planes de pago se revisarán antes de contratar cualquier servicio, con su fuente oficial.
