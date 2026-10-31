# ADR-0001: Stack inicial y orden de construcción

- Estado: aceptada
- Fecha: 2026-10-31

## Contexto

Hay que empezar a construir sin cerrar antes toda la investigación. Las decisiones deben ser reversibles y estar justificadas.

## Decisión

1. **Backend y motor de audio: Python 3.11 o superior.**
   - Justificación: el procesado de audio y el análisis de señales tienen su ecosistema en Python (ffmpeg mediante subprocess, librosa, soundfile). Para la primera fase se usa sólo la biblioteca estándar más ffmpeg, sin dependencias de runtime, para que el núcleo sea fácil de probar.
   - Pendiente: FastAPI para la API, cuando empiece la fase de servicio web.
2. **Base de datos: SQLite** en la fase inicial.
   - Justificación: un único fichero, sin servidor, suficiente para un piloto. El esquema es SQL estándar y se migrará a PostgreSQL si el uso lo exige.
   - Importante: el fichero `.sqlite` no se versiona. El índice JSON sí.
3. **Procesado de audio: ffmpeg/ffprobe como procesos externos**, invocados con listas de argumentos (sin shell).
   - Justificación: estándar de facto, cubre todos los códecs que se quieren comparar, y evita dependencias de Python con mantenimiento incierto.
4. **Pruebas: pytest** con audio sintético generado por ffmpeg. No se usa música real en las pruebas.
5. **Frontend web: Next.js desplegado en Vercel.** Pendiente; no se ha implementado.
6. **Android: Flutter** (propuesta), por reutilizar la toolchain ya instalada. Pendiente de ADR propio antes de empezar.
7. **Integración continua: GitHub Actions** con ffmpeg en el runner y pytest en Python 3.12 y 3.13.

## Alternativas descartadas por ahora

- **Descarga desde plataformas con yt-dlp:** descartada por ADR-0002.
- **PostgreSQL desde el principio:** exceso de infraestructura para una fase sin servicio web.
- **librosa en la primera fase:** no es necesaria para importar, probar y transcodificar; se añadirá al módulo de análisis.
