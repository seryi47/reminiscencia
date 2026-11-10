# ADR-0040: Publicación — sin recodificar el Opus ya subido, y por qué hay un suelo de tiempo

- Estado: aceptada (2026-11-10). Pruebas backend reales (ffmpeg). El tiempo de extremo a extremo depende de GitHub Actions y se explica abajo.
- Fecha: 2026-11-10.
- Relacionadas: [ADR-0030](ADR-0030-subida-rapida.md) (subida rápida y caché de ffmpeg), [ADR-0017](ADR-0017-subida-directa-github-web-publica.md) (subida por `/api/subir`), [ADR-0024](ADR-0024-audio-privado-en-r2.md) (jobs aislados por seguridad), [ADR-0020](ADR-0020-audio-por-r2.md).

## Contexto

Al subir una canción, aparece en «Tu biblioteca» como «Publicándose…» y tarda **más de 3 minutos** en publicarse. Se pidió analizar el cuello de botella y reducirlo sin perjudicar la calidad ni la estabilidad.

El pipeline (`buzon.yml`) son **cuatro jobs secuenciales**, cada uno en un runner nuevo:
1. `autorizar` (permiso de quien sube).
2. `recoger` (baja del bucket privado de R2 las subidas de la web/APK; credenciales de R2, sin token de GitHub).
3. `procesar` (convierte a Opus y arma el paquete; **sin ningún secreto**, porque ejecuta código sobre subidas ajenas).
4. `publicar` (valida, aplica, sube el audio a R2 y hace push a main; token de GitHub + credenciales de R2).

## Análisis del tiempo

El tiempo lo domina el **overhead de GitHub Actions**, no el trabajo en sí:
- **4 arranques de runner** (aprovisionamiento + arranque de la máquina), + checkout en cada uno, + `setup-python` en tres, + instalación de ffmpeg (con caché de `.deb`), + **dos traspasos de artefactos** (`recoger`→`procesar`→`publicar`).
- Si hay otra publicación en curso, la cola (`concurrency: library-catalog`, `queue: max`) hace esperar a la siguiente.
- La conversión de audio de una canción es de segundos; no es el cuello de botella.

**El suelo que no se puede bajar** sin cambiar el modelo: los cuatro jobs están separados **a propósito, por seguridad** (ADR-0024)… — **CORRECCIÓN (ADR-0042, 2026-11-10): este análisis era erróneo.** Al medir los tiempos reales (`gh run view`), el 97 % del tiempo era un único paso, «Instalar ffmpeg» (419 s de 431 en `procesar`), por una **caché de `.deb` rota** que re-descargaba ffmpeg cada vez de un mirror lento. No era la arquitectura ni la seguridad. Ver [ADR-0042](ADR-0042-publicacion-rapida-sin-ffmpeg-para-opus.md): las subidas de la app (Opus) ya no instalan ffmpeg, y la publicación baja de ~8 min a ~1 min.

## Decisión

No tocar la separación de jobs (es la garantía de seguridad). La mejora real y segura: **no recodificar lo que ya llega en Opus.**

- La web y la APK **convierten a Ogg Opus en el propio dispositivo** antes de subir (48 kbps estéreo / 32 kbps mono; `subida-local.js`, `local_audio_convert.dart`). El buzón, en cambio, **recodificaba siempre** a `opus-64k` (`transcode(..., PLAYBACK_PROFILE)`): una **segunda pasada con pérdida** que empeora la calidad y agranda el archivo, además de gastar tiempo de ffmpeg.
- Ahora, si el original ya es Opus, se **copia el flujo tal cual** (remux a Ogg con `-c:a copy`, sin recodificar): sin pérdida de calidad, sin recomprimir y más rápido. Para cualquier otro formato (WAV, MP3, FLAC… subidos por la página de GitHub o importados de Internet Archive) se sigue transcodificando al perfil de reproducción. Lógica común en `sonidos.compression.produce_opus`, usada por `buzon.py` y `pipeline.py` (DRY).
- El `sha256` (y con él el id `S…` y la deduplicación) se calcula sobre el archivo **subido**, así que no cambia. Además, al copiar, el `.opus` publicado coincide con lo que reproduce la app en local.

## Consecuencias

- **Mejor calidad**: se acabó la doble codificación de lo que sube la app. (Era justo lo que pedía «sin perjudicar la calidad»: antes sí la perjudicaba.)
- **Algo más rápido** en `procesar` para subidas de la app (no transcodifica), aunque el suelo de ~3 min lo marca el overhead de Actions, no esto.
- Sin cambios en el modelo de seguridad ni en los ids/dedup.
- **Pruebas:** `backend/tests/test_buzon.py::test_una_subida_ya_en_opus_se_copia_sin_recodificar` comprueba con ffmpeg real que el flujo de audio publicado es **idéntico** al subido (md5 del stream), y que los demás formatos se siguen convirtiendo. Suite backend entera verde (1427).

## Micro-optimizaciones consideradas y descartadas (por ahora)

- Quitar `setup-python` (usar el Python 3.12 preinstalado): ahorra pocos segundos por job y arriesga a romperse si cambia la imagen del runner. No merece el riesgo.
- Juntar jobs: rompería el aislamiento de secretos (ADR-0024).
- Saltar la instalación de ffmpeg cuando todo el lote ya es Opus: aún hace falta `ffprobe` (del mismo paquete) para validar y medir la duración.
