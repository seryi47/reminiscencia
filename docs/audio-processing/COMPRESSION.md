# Compresión y perfiles de reproducción

Estado: **perfiles implementados; experimento perceptual pendiente.** No hay resultados de calidad todavía.

## Perfiles disponibles

Definidos en `backend/sonidos/compression.py`:

| Perfil | Códec | Contenedor | Tasa |
|---|---|---|---|
| opus-48k | Opus (libopus) | .opus | 48 kbps VBR |
| opus-64k | Opus (libopus) | .opus | 64 kbps VBR |
| aac-64k | AAC | .m4a | 64 kbps |
| aac-128k | AAC | .m4a | 128 kbps |
| mp3-128k | MP3 (libmp3lame) | .mp3 | 128 kbps |

Son puntos de partida para experimentar, no configuraciones definitivas. Ninguno aplica filtros destructivos: sólo se descarta el vídeo (`-vn`) y se selecciona la primera pista de audio.

## Qué medir antes de elegir un perfil por defecto

- Tamaño original frente a comprimido y porcentaje de reducción (ya se calcula en `library.stats()`).
- Calidad perceptual con pruebas de escucha según ITU-R BS.1534 (MUSHRA), con oyentes y entorno controlados.
- Velocidad de codificación y consumo de CPU.
- Compatibilidad de reproducción en Android e iOS.
- Comportamiento por tipo de música: clásica, voz, pop, instrumental y grabaciones antiguas.

## Estado de la evidencia

Ninguna cifra de calidad de este documento está medida todavía. Las afirmaciones sobre qué códec es más eficiente a bajas tasas son de la literatura técnica general y deben confirmarse con las pruebas del propio proyecto.

## Próximo paso

Un script de experimento que reciba un conjunto de audios con licencia abierta y genere una tabla con los perfiles. Los resultados irán a este documento con la fecha y el material usado.
