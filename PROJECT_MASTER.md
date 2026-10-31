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
| Experimento de compresión perceptual | **No iniciado** | — |
| Publicación de audio en GitHub Releases | **No implementado** (ADR-0003) | — |
| API web (FastAPI) | **No iniciado** | — |
| Web de paciente y cuidador (Next.js, Vercel) | **No iniciado** | — |
| App Android (APK) | **No iniciado** | — |
| Perfiles de pacientes y datos personales | **No iniciado** | — |
| Integración continua (GitHub Actions) | Escrito, verificación remota pendiente | — |

## Problemas pendientes

- **Legal:** dictamen sobre copia privada y uso de archivos familiares; fuente concreta de música para el piloto.
- **Almacenamiento:** confirmar que Releases admite audio y revisar las políticas de uso aceptable de GitHub.
- **Vercel:** el plan Hobby es sólo para uso no comercial. Válido mientras el proyecto sea académico; si se convierte en producto o se desarrolla para un cliente, hace falta Pro.
- **Datos de salud:** antes de tratar datos de pacientes, RGPD (artículo 9), LOPDGDD y aprobación ética.
- **Vercel y APK:** requieren que conectes tus cuentas; no están desplegados ni probados.

## Presupuesto

Sin gasto todavía. Las cifras de planes de pago se revisarán antes de contratar cualquier servicio, con su fuente oficial.
