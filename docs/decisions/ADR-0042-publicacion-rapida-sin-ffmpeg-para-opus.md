# ADR-0042: Publicación rápida — las subidas en Opus no necesitan ffmpeg (corrige el diagnóstico de ADR-0040)

- Estado: aceptada (2026-11-10). Lógica probada en backend (ffmpeg real y un caso que PROHÍBE todo subproceso). El tiempo de extremo a extremo se confirma en la siguiente subida real (lo ve el usuario).
- Fecha: 2026-11-10.
- Relacionadas: corrige [ADR-0040](ADR-0040-publicacion-mas-rapida-y-sin-recodificar.md) (su análisis del «suelo estructural» era erróneo), [ADR-0030](ADR-0030-subida-rapida.md) (la caché de ffmpeg, que resultó estar rota), [ADR-0017](ADR-0017-subida-directa-github-web-publica.md), [ADR-0024](ADR-0024-audio-privado-en-r2.md).

## Contexto y diagnóstico real (con datos)

En ADR-0040 dije que los «+3 min» de publicación eran un **suelo estructural** por los 4 jobs aislados por seguridad. **Era falso.** Mirando los tiempos reales de una ejecución (`gh run view`):

- `autorizar` 5 s · `recoger` 12 s · `publicar` 18 s (subir audio a R2: 5 s) · **`procesar` 431 s, de los cuales «Instalar ffmpeg» = 419 s.**
- El log del paso: `Cache hit … / Paquetes de ffmpeg en la caché: 0 comprobados, 87 descartados` y luego `Get:…` descargando los 87 paquetes de un mirror lento de Azure.

O sea: la caché de `.deb` de ADR-0030 **acierta la clave pero sus paquetes se descartan todos** (y, como solo re-guarda en fallo de caché, nunca se corrige), así que apt **re-descarga ffmpeg entero cada vez** → ~7 minutos. La arquitectura y la seguridad **no tenían nada que ver**, y mover el audio tampoco (ya está en R2, y subirlo tarda 5 s).

## Decisión

Las subidas de la web y la APK (`/api/subir` → `repository_dispatch`) ya llegan en **Ogg Opus** (se convierten en el dispositivo) y, desde ADR-0040, no se transcodifican. Hacer que su publicación **no necesite ffmpeg en absoluto**:

1. **Metadatos en Python puro** para Ogg Opus (`sonidos.probe`): codec, canales, tasa de entrada y **duración** (de la posición de grano de la última página Ogg a 48 kHz, menos el pre-skip de OpusHead), sin `ffprobe`. Para cualquier otro formato, `ffprobe` como siempre.
2. **Copia del fichero** en vez de remuxear (`sonidos.compression.produce_opus`): si el original ya es Opus, se copia tal cual (byte a byte), sin ffmpeg. (ADR-0040 lo hacía con `ffmpeg -c:a copy`; ahora ni eso.)
3. **El workflow salta la instalación de ffmpeg** cuando el evento es `repository_dispatch` (`buzon.yml`): esas subidas son siempre Opus y no lo necesitan. La página de GitHub (`push`) y el reproceso manual (`workflow_dispatch`) pueden traer otros formatos y ahí sí se instala.

## Consecuencias

- **La publicación de lo que sube la app pasa de ~8 min a ~1 min** (solo los tiempos de arranque de los 4 jobs + el trabajo real, que son segundos): se elimina el paso de 419 s. Sin tocar seguridad, sin mover audio, sin recodificar.
- **Mejor calidad** (ya desde ADR-0040): cero recodificación; además ahora el `.opus` publicado es **byte a byte idéntico** al subido.
- **El id/dedup no cambian** (salen del `sha256` del fichero subido).
- **La ruta por `push`/`workflow_dispatch`** (subidas por la página de GitHub, formatos variados) y las **importaciones por incidencia** (`biblioteca.yml`, Internet Archive) ya **no usan apt**: instalan un **ffmpeg estático de BtbN/FFmpeg-Builds (GitHub), fijado por tag y verificado por SHA256, cacheado** (`~/ffmpeg-bin`, clave estable `ffmpeg-static-btbn-…`). Una sola descarga (~145 MB) la primera vez; en caliente, restauración de la caché en segundos. Sustituye la caché de `.deb` rota de ADR-0030. Para subir la versión de ffmpeg se cambian URL + SHA256 + la clave de caché.
- **Pruebas:** `backend/tests/test_buzon.py`: el `.opus` publicado es idéntico al subido (md5 del flujo), y procesar una subida Opus **no llama a ningún subproceso** (ffmpeg/ffprobe prohibidos con monkeypatch). Lector Opus comprobado contra ffprobe (±6 ms). Suite backend verde (1431).

## Lección

No afirmar un «suelo» sin medir. Un `gh run view` con los tiempos por paso bastó para ver que el 97 % del tiempo era un `apt-get install` por una caché rota, no la arquitectura. Gracias al usuario por no aceptar el «100% irreducible».
