# ADR-0031: Audio público por el Worker, con r2.dev de respaldo

- Estado: aceptada (2026-11-06), en la rama `feature/audio-por-worker`. **Sin desplegar**: hay que desplegar primero el Worker y después la web (ver «Despliegue»).
- Fecha: 2026-11-06
- Modifica: [ADR-0020](ADR-0020-audio-en-r2.md), fase 3 (el audio ya no se pide primero a `r2.dev` ni la redirección de `vercel.json` va al bucket).
- Amplía: [ADR-0029](ADR-0029-worker-cloudflare-y-portadas.md) (el Worker sirve también el audio, con el *binding* `PUBLIC_BUCKET` que ya tenía).
- Relacionadas: [ADR-0024](ADR-0024-audio-privado-en-r2.md) (solo el audio de las canciones públicas está en el bucket público).

## Contexto

- Todo el audio público se sirve desde el bucket público de R2 por su dirección `https://pub-8a005187082e401abad47cdee4ec88ab.r2.dev`: el service worker de la web lo pide allí (`AUDIO_ORIGIN` de `js/offline-core.js`), `vercel.json` redirige `/audio/:file` allí y la APK lo descarga y transmite desde allí (`kAudioBase` de `lib/library_store.dart`), con la web de respaldo.
- Cloudflare presenta `r2.dev` como una dirección para desarrollo, con límite de velocidad. El comprobador de producción (`scripts/smoke_produccion.mjs`), que pedía todos los audios a la vez, daba cortes `UND_ERR_CONNECT_TIMEOUT` en ráfagas.
- La alternativa habitual, un dominio propio conectado al bucket, exige tener un dominio en Cloudflare. No lo hay (ni se quiere comprar ahora).
- El Worker `reminiscencia-api` (ADR-0029) ya tiene el bucket público por *binding* y su dirección `workers.dev` ya está en la web y en la APK.

## Decisión

### 1. El Worker sirve `/audio/<id>.opus`

`worker/src/audio.js`, enlazado desde `worker/src/index.js` antes del resto de rutas:

- `GET` y `HEAD /audio/<id>.opus`, con `id` = `S` + 16 hexadecimales en minúsculas (las canciones de la biblioteca). Cualquier otra forma (las `L…` de un navegador, mayúsculas, otra extensión, subcarpetas, `..`) da 404 **sin tocar el bucket**: el Worker solo lee claves `audio/S….opus`, nunca las portadas ni el índice por esta ruta. Otro método: 405 con `Allow: GET, HEAD`.
- Rangos de un solo tramo (`bytes=a-b`, `bytes=a-`, `bytes=-n`), interpretados con `parseRange` de `js/offline-core.js` (la misma función que usa el service worker con el audio guardado): 206 con `Content-Range`, o 416 con `Content-Range: bytes */<tamaño>` si queda fuera. Una cabecera mal formada, invertida o de varios tramos se ignora y se sirve entero (200), como permite RFC 9110. `If-Range` con otra etiqueta también sirve entero.
- El tramo lo lee R2 (`get(clave, { range: { offset, length } })`): el Worker nunca carga una canción en memoria, devuelve el flujo del *binding*. Para validar el rango hace falta el tamaño, así que con `Range` (y en `HEAD`) se pide antes `head()`; la lectura lleva `onlyIf: { etagMatches }` con la etiqueta de ese `head()` y, si el objeto cambió entre medias, responde 503 con `Retry-After: 1` (nunca un tramo de otro fichero).
- Sin `Range`, por `GET`: una sola lectura, con `onlyIf` = las cabeceras `If-None-Match` de la petición; si R2 devuelve el objeto sin cuerpo, 304. Con `Range` o en `HEAD`, el 304 se decide con la etiqueta de `head()` (lista, `W/` y `*` admitidos).
- Cabeceras: `Content-Type: audio/ogg; codecs=opus`, `Accept-Ranges: bytes`, `Cache-Control: public, max-age=31536000, immutable` (el audio de un id no cambia), `ETag`, `Content-Length` y, en 206, `Content-Range`. 404 y 416 van con `Cache-Control: no-store` (una canción que se publica después debe verse).
- CORS como el resto del Worker: solo la web (y `ALLOWED_ORIGINS`; localhost solo con `ALLOW_LOCALHOST="1"`); otro `Origin` da 403 sin leer nada; **sin `Origin` se atiende** (la APK, curl y el elemento `<audio>` tras la redirección de Vercel). A la web se le exponen `X-Reminiscencia-Api`, `Content-Range`, `Content-Length`, `Accept-Ranges` y `ETag`. El *preflight* admite ahora `HEAD` y las cabeceras `Range`, `If-None-Match` e `If-Range`. Todas las respuestas llevan `X-Reminiscencia-Api`.
- Sin el *binding* `PUBLIC_BUCKET`: 503. Un fallo de R2: 502.

### 2. Web: Worker, después `r2.dev`, después el propio origen

- **Una sola dirección.** `js/offline-core.js` importa `WORKER_API_BASE` de `js/api-config.js` (la del API, ADR-0029) y deriva `WORKER_AUDIO_ORIGIN = normalizeApiBase(WORKER_API_BASE)`; `sw.js` la toma de `offline-core.js`. No hay una segunda copia en JavaScript (una prueba lo comprueba). `api-config.js` ya estaba en el *shell* y no tiene dependencias ni toca el DOM al cargarse, así que el service worker (módulo) lo importa sin problema.
- **Service worker.** `remoteAudioUrls(url)` da `[Worker, r2.dev]` (sin Worker, solo `r2.dev`). `fetchAudio` prueba cada una con el `Range` de la petición, en modo CORS y sin credenciales; pasa a la siguiente si la respuesta no es `ok`, si hay error de red o si no empieza a responder en `AUDIO_HEADERS_TIMEOUT_MS` (10 s; una vez empezada, la descarga no tiene límite). Si las dos fallan, pide al propio origen (que Vercel redirige al Worker). Las canciones de este navegador (`L…`) y el audio descargado no cambian.
- **`vercel.json`.** `/audio/:file` redirige (307) a `https://reminiscencia-api.reminiscencia-app.workers.dev/audio/:file`. `vercel.json` no puede importar JavaScript: `tests/web-unit/cabeceras.test.mjs` y `mobile/test/api_config_test.dart` comprueban que el destino es `WORKER_API_BASE` + `/audio/:file` (o `r2.dev` si la constante está vacía).
- **CSP.** `media-src 'self' <r2.dev> <Worker exacto>` (el `<audio>` sin service worker sigue la redirección) y `connect-src` ya admitía `https://*.workers.dev` (el service worker). `r2.dev` sigue admitido en `media-src`, `connect-src` e `img-src` (respaldo del audio y portadas).
- `SHELL_VERSION` pasa de 29 a 30 (cambian `sw.js` y `offline-core.js`).
- Si `WORKER_API_BASE` está vacía, todo como antes: el service worker empieza en `r2.dev`. La redirección de `vercel.json`, en cambio, hay que devolverla a mano a `r2.dev` (la prueba lo exige).

### 3. APK: Worker, después `r2.dev`, después la web

- `kAudioBase` desaparece. `kR2AudioBase` (`lib/library_store.dart`) es el bucket por `r2.dev` (respaldo del audio y portadas; `kCoverBucketBase` sigue siendo igual). La base del audio por el Worker es `ApiRoutes.audioBase` (`lib/api_config.dart`): `'<base>/'` derivado de `kWorkerApiBase`, o `''` si no hay Worker o está marcado como caído. Así las pruebas, que cambian `apiRoutes` por unas rutas sin Worker (`test/flutter_test_config.dart`), tampoco usan el Worker real para el audio.
- `LibraryStore.audioUris(song)` da el orden: Worker (si hay), `r2.dev` y la web (Vercel lo redirige al Worker). `audioUri` es la primera.
- **Descarga** (`_downloadOne`, 3 intentos): con Worker, Worker → `r2.dev` → web; sin Worker, `r2.dev` → web → `r2.dev` (como antes). Las direcciones se fijan al empezar cada canción. Si el Worker no responde (red, tiempo agotado o una respuesta sin `X-Reminiscencia-Api`), `ApiRoutes.reportWorkerFailure()` lo marca caído 5 minutos (`kRetryWorkerAfter`, el mismo plazo que el API): las canciones siguientes empiezan en `r2.dev`. Un 404 suyo no lo marca.
- **Transmisión** (`SonidosAudioHandler`): se empieza por la primera dirección; si falla la canción que suena, `nextFallbackUri` (`lib/playback_plan.dart`, sustituye a `shouldRetryFromFallback`) da la siguiente que no se ha probado en esta cola, y `_retryFromFallback` la carga. Con Worker son hasta dos reintentos (`r2.dev` y la web); sin Worker, uno (la web), como antes. Después se salta la canción.

### 4. Comprobador de producción

`scripts/smoke_produccion.mjs` acepta `--concurrencia=N` (1–64; 6 por defecto; antes iban todos los audios a la vez) y `--catalogo=ruta` (para las pruebas), reintenta una vez un fallo de red por audio, comprueba un rango (206 con `Content-Range`) e informa (sin contar como comprobación) de cuántos audios ha servido el Worker. Las privadas deben seguir dando 404 (no están en el bucket público). Se prueba contra una «producción» local en `tests/web-unit/smoke-produccion.test.mjs`.

## Alternativas descartadas

- **Dominio propio en el bucket.** Quita el límite de `r2.dev` y permite la caché de Cloudflare, pero exige un dominio en Cloudflare. Si algún día lo hay, basta con cambiar la base del audio; el Worker puede seguir de respaldo.
- **Redirigir del Worker a `r2.dev`.** No quita el límite.
- **Copiar la dirección del Worker en `offline-core.js` o en `kAudioBase`.** Dos sitios que mantener a la vez; con la dirección derivada, cambiar `WORKER_API_BASE` / `kWorkerApiBase` basta (más `vercel.json`, que una prueba vigila).
- **Leer siempre con `head()` + `get()`.** Una operación de R2 más por cada reproducción entera; sin `Range` basta una lectura condicional.

## Consecuencias

- Cada petición de audio cuenta como una petición del Worker y una lectura de R2 (dos con `Range` o `HEAD`). Un reproductor hace varias peticiones de rango por canción. Según la documentación de Cloudflare, el plan gratuito de Workers admite 100 000 peticiones al día y R2 incluye 10 millones de lecturas (clase B) al mes; **no se ha comprobado con el uso real**. Si se acercara al límite, la web seguiría funcionando (el service worker pasa a `r2.dev` cuando el Worker devuelve error) y la APK también (pasa a `r2.dev` y lo marca caído 5 minutos).
- Las respuestas de `workers.dev` no pasan por la caché de Cloudflare; el navegador y la APK sí guardan el audio (caché HTTP de un año, la caché de audio de la PWA y el fichero de la APK).
- Si el Worker cae, el `<audio>` sin service worker (primera visita) no tiene respaldo: la redirección de Vercel va al Worker. Con el service worker activo, sí (Worker → `r2.dev` → origen).
- Desplegar la web antes que el Worker rompería el audio de la primera visita y el respaldo de la APK (la redirección iría a un Worker sin la ruta, que da 404 con su cabecera). Por eso el orden es **Worker primero**.

## Despliegue (pasos del propietario)

1. **Worker** (desde `worker/`, con la rama fusionada en `main`): `npx --yes wrangler@4.151.3 deploy`. No hace falta ningún secreto ni *binding* nuevo (`PUBLIC_BUCKET` ya está).
2. Comprobar con curl (con el id de una canción pública de `frontend/web/data/songs.json` y el de una privada de `audio-library/indexes/catalog.json`):
   - `curl -sI https://reminiscencia-api.reminiscencia-app.workers.dev/audio/<pública>.opus` → `200`, `content-type: audio/ogg; codecs=opus`, `accept-ranges: bytes`, `cache-control: public, max-age=31536000, immutable`, `etag`, `x-reminiscencia-api: 1`.
   - `curl -s -D - -o /dev/null -H 'Range: bytes=0-1' https://…/audio/<pública>.opus` → `206` y `content-range: bytes 0-1/<tamaño>`.
   - `curl -sI https://…/audio/<privada>.opus` → `404`.
   - `curl -sI -H 'Origin: https://reminiscencia.vercel.app' https://…/audio/<pública>.opus` → `access-control-allow-origin` y `access-control-expose-headers` con `Content-Range`.
3. **Web**: fusionar en `main` (Vercel despliega solo). Comprobar `curl -sI https://reminiscencia.vercel.app/audio/<pública>.opus` → `307` con `location: https://reminiscencia-api…/audio/…`, y `node scripts/smoke_produccion.mjs --concurrencia=4` → sin FALLO e `INFO audio servido por el Worker: N de N`.
4. **APK**: publicar una versión nueva (la que está instalada sigue usando `r2.dev` y la web, que ahora redirige al Worker).

Para volver atrás: vaciar `WORKER_API_BASE` (o solo devolver la redirección de `vercel.json` a `r2.dev`): el service worker vuelve a empezar en `r2.dev`.

## Cómo se prueba

- `tests/web-unit/worker.test.mjs` (12 pruebas nuevas, «audio público por el Worker»): 200 entero con sus cabeceras y una sola lectura; CORS y *preflight*; otro origen 403 sin leer; rangos (cerrado, abierto, sufijo, acotado, sufijo mayor que el fichero) leídos por R2 con `range` y `etagMatches`; 416; rangos inválidos o múltiples → 200; `If-Range`; `HEAD` (entero y tramo, sin leer el audio); 304 (`GET`, débil, lista, `*`, `HEAD`, con `Range`); 404 de lo que no está; ids y rutas no válidas sin tocar el bucket; 405, 503 sin bucket, 502 con R2 que falla; 503 si el audio cambia entre `head()` y `get()`. `tests/web-unit/r2-falso.mjs` simula ahora `head()`, `get()` con `range` y `onlyIf` (objeto sin cuerpo si no se cumple) y etiquetas en lista o `W/`.
- `tests/web-unit/offline-core.test.mjs`: `remoteAudioUrls` (orden, sin Worker, dirección no válida, canciones locales); la dirección sale de `api-config.js` y no se repite en `offline-core.js` ni en `sw.js`; el service worker pide primero al Worker con `Range`, CORS y tiempo máximo, y pasa a `r2.dev` (error, fallo de red) y al origen.
- `tests/web-unit/cabeceras.test.mjs`: CSP (`media-src` con el Worker exacto y `r2.dev`) y redirección al Worker.
- `tests/web-unit/smoke-produccion.test.mjs`: el comprobador contra Vercel y Worker locales (todo bien, privada publicada, pública sin audio, opciones no válidas y límite de concurrencia).
- E2E `tests/web-e2e/worker.e2e.mjs`: el audio suena por el Worker simulado (el service worker pide `/audio/S….opus` al Worker); sin el audio en el bucket o con el Worker caído, suena igual desde el propio origen. Chrome de las E2E no resuelve `*.r2.dev` ni `*.workers.dev` (`--host-resolver-rules`), y el servidor de pruebas sirve `api-config.js` sin Worker salvo en `worker.e2e.mjs` (Worker simulado en 127.0.0.1).
- APK: `test/offline_sync_test.dart` (orden de direcciones, descarga por el Worker, 404 sin darlo por caído, Worker que no responde → `r2.dev` y las siguientes ya sin Worker, página ajena, `nextFallbackUri`) y `test/api_config_test.dart` (`audioBase` derivada de `kWorkerApiBase`, vacía en las pruebas, caída de 5 minutos, redirección de `vercel.json`).

## Qué no se ha verificado en vivo

- Nada se ha desplegado: ni el Worker con la ruta nueva ni la web ni la APK.
- Que el *binding* real acepte `onlyIf` como `Headers` con `If-None-Match` de la petición en `get()` y devuelva el objeto sin `body` (así lo describe la documentación; el bucket simulado lo imita).
- Que el entorno de Workers conserve el `Content-Length` puesto a mano en las respuestas a `HEAD` (sin cuerpo).
- La reproducción y la búsqueda dentro del tema en Chrome, Safari (iOS) y la APK contra el Worker real, y el rendimiento frente a `r2.dev`.
- El consumo real frente a los límites del plan gratuito de Workers y R2.
