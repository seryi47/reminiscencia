# ADR-0045: la APK convierte en yttowav directamente (su propia IP, su propio cupo)

- Estado: **implementada en la APK** (2026-11-12), a falta de la verificación en vivo en dispositivo (la hace el usuario: una tanda real que pase de 40 conversiones acumuladas por el Worker sin que la APK se bloquee). Código en `main` con pruebas; el comportamiento contra yttowav real no se puede ejecutar desde el entorno de desarrollo. La **web no cambia** (ver «Consecuencias»).
- Fecha: 2026-11-12.
- Relacionadas: [ADR-0021](ADR-0021-buscar-en-youtube.md) (resolver a candidatos de YouTube), [ADR-0018](ADR-0018-seguimiento-trabajos-youtube.md) (seguimiento de trabajos del conversor), [ADR-0038](ADR-0038-youtube-en-netlify-con-failover.md) (dónde viven `search`/`playlist` y los proxies `convert`/`status`/`download`), [ADR-0044](ADR-0044-transferir-musica-desde-spotify.md) (transferir desde Spotify, que usa este mismo conversor), [ADR-0039](ADR-0039-descarga-youtube-persistente.md) (persistir la importación), [ADR-0029](ADR-0029-worker-cloudflare.md) (el Worker).

## Contexto

La importación de YouTube (vídeos sueltos, playlists y «Transferir música» de Spotify, ADR-0044) convierte cada pista a WAV con el servicio gratuito **yttowav** (`api.yttowav.org`): `POST /api/convert` → `GET /api/status?jobId=…` → descarga del WAV. Hasta ahora **tanto la web como la APK** llamaban a esos tres endpoints a través del **Worker de Cloudflare** (que hacía de proxy; los navegadores no pueden llamar a yttowav directamente por CORS, y el proxy guardaba las cabeceras y la URL del conversor en el servidor).

En noviembre de 2026 empezó a aparecer de forma recurrente el error de yttowav:

> You've reached the daily conversion limit (40 per day). Please come back tomorrow!

**Raíz del problema** (reconciliando la contradicción «la web de yttowav no tiene límite» con el 429 que nos daba):

1. La **web de yttowav** no tiene límite *por visitante*, porque cada persona la usa desde **su propia IP** y casi nadie hace 40 conversiones en un día.
2. La **API de yttowav** sí tiene un tope anti-abuso de **40/día POR IP**.
3. Reminiscencia mandaba **todas** las conversiones (toda la web + la APK + pruebas) por **una sola IP, la del Worker**. Para yttowav eso es «un visitante» haciendo cientos → agota el cupo por-IP enseguida. **No se bloqueaba la IP personal del usuario; se agotaba la IP compartida del Worker.** Verificado: desde otra IP la misma API respondía con cupo fresco mientras la del Worker daba 429.

## Decisión

**La APK habla con yttowav DIRECTAMENTE** en `convert`, `status` y `download`, sin pasar por el Worker. Al ser una app nativa no tiene la limitación de CORS del navegador, así que **cada teléfono usa su propia IP, con su propio cupo de 40/día** — exactamente el uso «un visitante = una IP» para el que la web de yttowav «no tiene límite». No es un truco ni una elusión del tope: cada dispositivo sigue contando como una IP con su 40/día; solo deja de compartir la única IP del Worker.

Detalles (en `mobile/lib/youtube_importer.dart`):

- Nueva base `converterBase` (por defecto `https://api.yttowav.org`, inyectable en pruebas) separada de `base` (el Worker). **`listPlaylist` y `search` siguen yendo por el Worker**, porque necesitan `yt-dlp` y no se pueden hacer desde el teléfono.
- `convert`: `POST converterBase/api/convert` con el cuerpo real de yttowav (`{url, title, format: 'wav', quality: 'original'}`, URL canónica `watch?v=…`) y las cabeceras con las que la app se identifica como el cliente web de yttowav (`Origin`/`Referer`/`User-Agent`, igual que hacía el Worker). El id de trabajo se lee de `jobId`/`id`/`job.id`.
- `status`: `GET converterBase/api/status?jobId=…`. Se normaliza igual que el proxy: `error`/`failed` → error (mensaje de `error`/`errorText`/`message`); si llega una URL de descarga (`downloadUrl`/`downloadPath`/`url`) se da por terminado aunque no diga `completed`.
- `download`: se usa la URL de descarga que dé el estado, o `api/download/?jobId=…` si no la da; **se exige que quede en el mismo origen** que el conversor (no se sigue una redirección a otro host) y se valida la cabecera WAV (`RIFF`/`WAVE`), como antes.
- El tope diario (429 con el texto del límite) se sigue detectando y corta la tanda limpio, avisando una vez (`YoutubeDailyLimitException`, ADR-0044); al venir ahora directo de yttowav, el mensaje es el mismo.

## Consecuencias

- **La web NO se puede arreglar igual:** el navegador no puede llamar a `api.yttowav.org` directamente (CORS), así que la web **tiene** que seguir pasando por el Worker y, por tanto, seguirá topando con el cupo de la IP compartida. La web ya degrada de forma limpia cuando llega el tope (avisa y para, ADR-0044). Para convertir muchas canciones sin tope, **la vía es la APK**.
- Se le enseña a yttowav la IP del teléfono (antes solo veía la del Worker). Es lo que ve de cualquier visitante de su web; no se envía ningún dato personal (el `User-Agent` es un nombre genérico del cliente).
- Si en algún momento yttowav rechazara las peticiones directas del teléfono (p. ej. exigiera un token de sesión de su web), habría que volver a enrutar por el Worker o resolver el reto; no se implementa nada que eluda el cupo por-IP ni las protecciones de YouTube.

## Alternativas descartadas

- **Montar nuestro propio conversor (yt-dlp) en un VPS o desde cero:** lo pidió el usuario, pero descargar audio de YouTube a escala salta sus protecciones y sus Términos; además el usuario puso como condición «ningún VPS». Descartado.
- **Convertir en lotes desde la IP del desarrollador:** vuelve a concentrar tráfico en una IP y elude el tope por-IP. Descartado.
- **Un proxy con rotación de IPs:** es exactamente eludir el tope anti-abuso. Descartado.
