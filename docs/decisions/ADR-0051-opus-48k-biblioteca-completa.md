# ADR-0051 — Opus-48k para toda la biblioteca publicada

Fecha: 2026-11-18
Estado: Aceptado.

## Contexto

El catálogo público se sirve en Ogg Opus. Hasta hoy conviven dos perfiles:
- **Subidas desde web y APK (ADR-0012)**: mono 32 kbps, estéreo 48 kbps (VBR).
- **Importaciones del pipeline** (Internet Archive, URL directa, YouTube vía `homeostasia`): `PLAYBACK_PROFILE = "opus-64k"` en `backend/sonidos/pipeline.py`.

Medición real del 2026-11-18 sobre las canciones de `audio-library/audio/`: la mediana está en **~60 kbps VBR**, un ~25 % por encima del contrato de subidas locales. Las ~498 canciones que están solo en R2 (el 85 % del catálogo) vienen todas por la vía del pipeline a 64k.

Para una biblioteca offline típica (50 canciones en el móvil) el exceso son ~17 MiB; para la librería completa (515 canciones), ~175 MiB. Los usuarios usan el móvil con límites reales de almacenamiento y datos.

## Decisión

1. **El perfil del pipeline baja a `opus-48k`**. Nuevas importaciones a 48 kbps VBR estéreo. Toca solo `backend/sonidos/pipeline.py`.
2. **Las canciones ya publicadas se re-encodan a 48 kbps VBR**. Herramienta: `scripts/migrar_audio_48k.py` (sobre ficheros locales) y `scripts/migrar_audio_48k_r2.py` (descarga de R2, re-encoda, delega la publicación a `scripts/sync_r2.py --aplicar`). Workflow para ejecutarlo contra producción: `.github/workflows/migrar-audio-48k.yml`, a mano.
3. **El id de canción no cambia**. Es `S{sha256[:16]}` del fichero del catálogo, que no se recalcula. El `sha256` del catálogo también se queda igual: representa el contenido como se publicó la primera vez (clave de deduplicación de pipeline, no verificación en el cliente).
4. **Umbral de migración**: solo se re-encodan las que están por encima de 52 kbps. Así las canciones subidas desde dispositivo (ya a 48k) no pagan una segunda pasada con pérdida.
5. **Copia de seguridad opcional**: el script local deja el fichero original en `audio-library/audio-pre-adr-0051/<id>.opus`. El de R2 no hace copia (los IDs no cambian, puedes volver a correr la migración con otros parámetros).
6. **Nada del dispositivo del usuario se borra**. Las canciones descargadas para escuchar sin conexión en el móvil se **reemplazan** al re-descargar: el proceso de sincronización baja la versión nueva y sobreescribe la vieja. No hay evicción, no hay borrado sin interacción del usuario.

## Alternativas descartadas

- **Opus-32k o menor**: pérdida audible en orquestas y voces graves; fuera del margen que el experimento del repo considera «parecido al original».
- **Tope de almacenamiento del offline + LRU**: el usuario pidió explícitamente que no, y cambiaría la semántica de «canciones guardadas».
- **Transcodificación on-the-fly por el Worker**: Workers de Cloudflare no incluyen ffmpeg ni admiten `child_process`. La única vía con ancho de banda razonable es pre-encodar.
- **Cambiar el ID al reencoder**: rompería «Me gusta», listas y todas las descargas offline (el fichero `<id>.opus` cacheado quedaría huérfano). No vale el intercambio.

## Consecuencias

- Pérdida de calidad medida: SNR −2.6 dB vs opus-64k; LSD casi idéntico. Imperceptible para la inmensa mayoría de música, puede notarse en pasajes complejos. Decisión asumida por el propietario.
- Ahorro medido en una muestra de 17 canciones: **22.9 MiB → 17.4 MiB (-23.8 %)**.
- Un reencoder Opus → Opus es una segunda pasada con pérdida. Es menos destructivo que MP3 → MP3, pero sigue sumando error acumulado si se repite varias veces. Solo se migra una vez.
- El `sha256` del catálogo queda estale respecto al fichero servido. Como no se verifica en el cliente, no hay impacto. Pipeline usa `sha256` para dedup de importaciones (compara con el hash de la fuente, no con el del publicado).
- Los dispositivos con la canción guardada para sin conexión re-descargarán la versión nueva la próxima vez que el motor de sincronización revise el catálogo: su tamaño cambia y el fichero local queda obsoleto. Las listas, «Me gusta» y la posición de reproducción no se tocan.
- APK y web: ningún cambio de código necesario (el `audio/<id>.opus` sigue siendo la URL).
- Workflow nuevo: `migrar-audio-48k.yml`, que solo se ejecuta a mano desde `main`.
