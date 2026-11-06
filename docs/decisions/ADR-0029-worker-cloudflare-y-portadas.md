# ADR-0029: Worker de Cloudflare para el API y portadas al instante en R2

- Estado: aceptada (2026-11-06), en la rama `feature/worker-portadas`. **Sin desplegar**: el Worker no existe todavía en Cloudflare y la constante de su dirección está vacía, así que la web y la APK siguen usando Vercel como hasta ahora.
- Fecha: 2026-11-06
- Amplía: [ADR-0017](ADR-0017-subida-directa-github-web-publica.md) y [ADR-0024](ADR-0024-audio-privado-en-r2.md) (`/api/subir`, ahora también en un Worker), [ADR-0022](ADR-0022-editar-sin-github.md) (`/api/editar`, también en el Worker) y [ADR-0027](ADR-0027-ediciones-pendientes.md) (portadas confirmadas por el índice).
- Modifica: [ADR-0016](ADR-0016-portadas-y-albumes.md), decisión 4: el campo `cover` del catálogo deja de ser la única fuente; el índice de portadas de R2 manda sobre él.
- Relacionadas: [ADR-0020](ADR-0020-audio-en-r2.md) (bucket público) y [ADR-0028](ADR-0028-contrato-comun-y-busqueda.md) (contrato común).

## Contexto

- Las funciones de Vercel admiten como mucho 4,5 MB por petición: `/api/subir` trocea en 4 MB. Una canción de 60 MB son 15 peticiones, cada una con su lista y sus lecturas en R2.
- `/api/subir` habla con R2 por la API S3 con una firma SigV4 propia y claves de R2 en Vercel.
- Cambiar una portada pasa por GitHub: `/api/editar` guarda el JPEG en `audio-library/buzon/portadas/` con un commit, `buzon.yml` la convierte y la copia a `frontend/web/covers/`, y Vercel vuelve a desplegar. Son minutos, y una portada que sustituye a otra ni siquiera se ve cambiar en el catálogo (la ruta `covers/<id>.jpg` es la misma), así que ADR-0027 la da por guardada a los 10 minutos sin comprobarlo.
- Un Worker de Cloudflare tiene los buckets de R2 por *binding* (sin claves ni firma) y admite cuerpos de 100 MB en los planes Free y Pro (200 MB en Business y 500 MB en Enterprise), con 128 MB de memoria por petición (límites de Workers de la documentación de Cloudflare; la del *binding* de R2, «Workers API reference», se consultó el 2026-11-06).

## Decisión

1. **Worker `reminiscencia-api`** en `worker/` (JavaScript con módulos ES, sin dependencias en tiempo de ejecución; `wrangler` solo para desplegar, con versión fijada `4.151.3` vía `npx`). `worker/wrangler.toml`: *bindings* `PRIVATE_BUCKET` (`reminiscencia-audio-privado`) y `PUBLIC_BUCKET` (`reminiscencia-audio`), variable `ALLOWED_ORIGINS` y el secreto `GITHUB_TOKEN` (mismo tipo de token que el de Vercel: grano fino, Contents e Issues en escritura). Rutas:
   - `GET /api/salud` → `{ ok, servicio, trozoMaximo }`.
   - `POST /api/subir`: el mismo contrato que Vercel (cabeceras, respuesta, orden, sin sobrescribir, manifiesto, `repository_dispatch` `subida-web`, reintento del último trozo si falla el aviso), con trozos de hasta **32 MB**. Los trozos se escriben con `onlyIf: If-None-Match: *`.
   - `POST /api/editar` y `GET /api/editar?incidencia=N`: el mismo contrato que Vercel; las portadas (`image/jpeg`) van a R2 (punto 3), no a GitHub, y no necesitan el token.
   - `POST /api/portada`: solo portadas (lo mismo que la portada de `/api/editar`); la usa la migración.
   - `GET /api/portadas`: el índice leído del bucket, sin caché.
   - CORS solo para `https://reminiscencia.vercel.app`, los orígenes de `ALLOWED_ORIGINS` y `http://localhost` y `http://127.0.0.1` en cualquier puerto (pruebas). Una petición con otro `Origin` recibe 403 sin hacer nada; sin `Origin` (la APK, curl) se atiende. Todas las respuestas llevan `X-Reminiscencia-Api: 1` (expuesta por CORS).
2. **Código compartido, no copiado.** La lógica de `/api/subir` está en `frontend/web/server/upload-core.js` y la de `/api/editar` en `frontend/web/server/edit-core.js` (que usa la validación de `js/cuidador/incidencias.js`). Solo JavaScript estándar (sin `node:` ni `Buffer`): lo usan las funciones de Vercel (`api/subir.js` pone la firma SigV4 y el cliente S3; `api/editar.js` guarda la portada en el buzón de GitHub) y el Worker (`worker/src/r2-storage.js` adapta el *binding* a la misma interfaz de almacenamiento). Wrangler empaqueta las importaciones relativas (comprobado con `wrangler deploy --dry-run`: 59 KB). **Las funciones de Vercel siguen funcionando igual**: las APK antiguas y el respaldo las usan.
3. **Portadas al instante, sin GitHub.** El Worker valida el JPEG como Vercel (firma JPEG, 1 MB como mucho, id `S` o `F` + 16 hexadecimales), lo guarda en el bucket **público** como `portadas/<id>-<hash>.jpg` (hash: 16 primeros hexadecimales del SHA-256 del contenido; `Cache-Control: public, max-age=31536000, immutable`) y actualiza `portadas/indice.json` (`{ "<id>": "portadas/<id>-<hash>.jpg" }`, claves ordenadas; `Cache-Control: no-cache`) con **escritura condicional**: `onlyIf: { etagMatches }` con el ETag leído o `If-None-Match: *` si aún no existe; si otra petición lo cambió entre medias (`put` devuelve `null`), vuelve a leer y lo intenta otra vez (6 intentos con espera corta creciente; después, 503). Nunca borra: una portada sustituida sale del índice pero su fichero se queda. Respuesta: `{ ok, mensaje: "Portada guardada: ya la ven todos.", portada, url }`.
4. **La web y la APK superponen el índice al catálogo** (`js/cover-index.js`, `lib/cover_index.dart`): lo leen sin caché (por el Worker, `GET /api/portadas`, y si no está o no responde, del bucket público, que ya tiene CORS para la web desde ADR-0020) y el índice manda sobre el `cover` de `data/*.json`. En la web el `cover` pasa a ser la dirección completa del bucket (`catalog.js` la admite junto a `covers/<id>.jpg`); en la APK, la clave `portadas/…`, que `CoverCache` pide al bucket y guarda como las demás; la APK guarda también el índice (`portadas.json`) para verse sin conexión. Las portadas de Git (`covers/<id>.jpg`) siguen valiendo para lo que no está en el índice. CSP de `vercel.json`: `img-src` y `connect-src` incluyen el bucket; `connect-src` incluye `https://*.workers.dev` (prueba en `tests/web-unit/cabeceras.test.mjs`, que también comprueba que la dirección configurada está permitida).
5. **Ediciones pendientes.** Una portada enviada por el Worker guarda su fichero (`coverKey`) en la edición pendiente. Se da por reflejada cuando el `cover` del catálogo con el índice encima es ese fichero (solo, o con la dirección del bucket delante) y se revisa a los **3 s** en lugar de a los 20; con `coverKey` ya no se supone guardada a los 10 minutos: si en 30 minutos no aparece, falla como las demás. Casos nuevos en `tests/contrato/ediciones-pendientes.json` (seis de «reflejada» y tres de «revisar»), que pasan la web y la APK. Por Vercel (sin `coverKey`) todo sigue como en ADR-0027.
6. **Una sola constante por plataforma** con la dirección del Worker: `WORKER_API_BASE` en `frontend/web/js/api-config.js` y `kWorkerApiBase` en `mobile/lib/api_config.dart`. Vacía (como queda en este cambio) = todo por Vercel, exactamente como antes. Con dirección:
   - Las peticiones van al Worker; si no responde (error de red o de CORS, tiempo agotado o una respuesta sin `X-Reminiscencia-Api`, como una página de error de Cloudflare), se repiten en Vercel y durante 5 minutos se va directamente a Vercel. Un error del propio Worker (con su cabecera, por ejemplo un 400) se respeta y no se repite.
   - La subida decide **por archivo** (web) o **por tanda** (APK, `UploadTracker`) preguntando a `/api/salud` (4 s): Worker con trozos de 32 MB o Vercel con trozos de 4 MB. Nunca cambia a mitad de un archivo (un trozo de 32 MB no cabe en Vercel). `js/cuidador/subida-publica.js` y `lib/shared_upload.dart` solo cambian sus constantes (y en la APK, el destino `route`): el bucle de envío no se toca.
7. **Backend:** `sonidos.entrada.MAX_PART_BYTES` pasa de 4 a 32 MiB (el mayor trozo que admite `/api/subir`; una prueba lo compara con `api-config.js`). El límite de 100 MiB por subida no cambia.
8. **Migración de las portadas existentes:** `scripts/migrar_portadas_r2.mjs` (y el workflow manual `migrar-portadas.yml`, solo desde `main`, sin secretos) sube por el Worker (`POST /api/portada`) las portadas que ya publica la web (canciones públicas y álbumes de `frontend/web/data/`), con el JPEG de `audio-library/covers/` o, si falta, de `frontend/web/covers/`. Nunca las de canciones privadas (el bucket es público), nunca pisa una entrada que ya esté en el índice y no borra nada de Git. Sin `--aplicar` solo simula; después comprueba que el índice apunta a cada fichero subido. Es idempotente.

## Alternativas descartadas

- **Firma SigV4 también en el Worker.** El *binding* de R2 da el acceso sin claves; menos secretos y menos código.
- **Portadas en el bucket con nombre fijo (`portadas/<id>.jpg`).** La caché del navegador, de Cloudflare y de la APK serviría la vieja; el nombre con hash es inmutable y el índice es lo único que cambia.
- **Escribir el índice sin condición.** Dos portadas a la vez perderían una. Con ETag y reintentos no se pierde ninguna.
- **Que la web lea el índice solo del bucket.** El bucket público (`r2.dev`) puede guardar en caché la respuesta; el Worker lee el *binding* al momento. Se usan los dos (Worker primero).
- **Copiar la portada a Git después.** Volvería a traer los minutos y los choques con `main`; el índice ya es la fuente de verdad de las portadas nuevas. Las de Git quedan como estaban hasta que se decida retirarlas.
- **CSP con la dirección exacta del Worker.** No se conoce hasta desplegar y obligaría a cambiar dos sitios; `https://*.workers.dev` en `connect-src` es suficiente con `script-src 'self'`. Se puede afinar después del despliegue.

## Consecuencias

- Subir una canción grande son muchas menos peticiones (un archivo de 60 MB: 2 en vez de 15) y sin claves de R2 en el camino del Worker.
- Una portada nueva la ven todos en segundos, también la que sustituye a otra, y la edición pendiente se confirma comprobándolo de verdad.
- Las portadas cambiadas por el Worker no están en Git: la copia completa de la biblioteca es el repositorio **más** los dos buckets (como el audio desde ADR-0024).
- Cualquiera con la web puede cambiar portadas al momento (como ya podía por Vercel en minutos, ADR-0022). Sigue pendiente un límite de uso por origen. Una portada sustituida sigue en el bucket.
- Hay dos sitios que hacen lo mismo (Vercel y el Worker) hasta que se decida retirar Vercel; el código común y las pruebas compartidas evitan que se separen.

## Despliegue (pasos del propietario)

Todo con `wrangler` fijado y sin instalar nada global (necesita Node 20 o superior). Desde `worker/`:

1. `npx --yes wrangler@4.151.3 login` (abre el navegador; cuenta de Cloudflare dueña de los buckets).
2. Comprobar que existen los dos buckets: `npx --yes wrangler@4.151.3 r2 bucket list` (deben salir `reminiscencia-audio` y `reminiscencia-audio-privado`).
3. `npx --yes wrangler@4.151.3 secret put GITHUB_TOKEN` y pegar un token de grano fino de `seryi47/reminiscencia` con **Contents** e **Issues** en escritura (puede ser el mismo que tiene Vercel o uno nuevo).
4. `npx --yes wrangler@4.151.3 deploy`. Al terminar escribe la dirección: `https://reminiscencia-api.<subdominio>.workers.dev` (también en el panel de Cloudflare › Workers & Pages › reminiscencia-api).
5. Comprobar con curl:
   - `curl -i https://reminiscencia-api.<subdominio>.workers.dev/api/salud` → `200`, `{"ok":true,"servicio":"reminiscencia-api","trozoMaximo":33554432}` y la cabecera `x-reminiscencia-api: 1`.
   - `curl -i -X OPTIONS -H 'Origin: https://reminiscencia.vercel.app' -H 'Access-Control-Request-Method: POST' https://…/api/subir` → `204` con `access-control-allow-origin: https://reminiscencia.vercel.app`.
   - `curl -i -H 'Origin: https://otra.example' https://…/api/salud` → `403`.
   - `curl -s https://…/api/portadas` → `{}` (o el índice).
   - `curl -s 'https://…/api/editar?incidencia=<número de una edición ya hecha>'` → `{"ok":true,…,"estado":"cerrada"}` (comprueba el token).
6. Poner la dirección (sin barra final) en `WORKER_API_BASE` de `frontend/web/js/api-config.js` y en `kWorkerApiBase` de `mobile/lib/api_config.dart`; subir `SHELL_VERSION` en `js/offline-core.js`; ejecutar las pruebas (la de la CSP comprueba que la dirección está permitida) y desplegar la web; publicar una APK nueva.
7. Migrar las portadas: Actions › `migrar-portadas` › *Run workflow* con la dirección del Worker, primero sin marcar «aplicar» (simulación) y después marcándolo. O en local: `node scripts/migrar_portadas_r2.mjs --worker https://… [--aplicar]`. Comprobar `curl -s https://pub-8a005187082e401abad47cdee4ec88ab.r2.dev/portadas/indice.json`.
8. Probar en la web: «Cambiar portada» de un álbum → la nueva se ve con «Pendiente» y en unos segundos «Ya está guardado»; subir una canción de más de 4 MB y ver en el registro del Worker (`npx --yes wrangler@4.151.3 tail`) las peticiones a `/api/subir`.

Para volver atrás basta con vaciar las dos constantes: todo vuelve a Vercel. Las portadas ya subidas siguen en el índice y se siguen viendo (el índice se lee del bucket).

## Cómo se prueba

- `tests/web-unit/worker.test.mjs` (21 pruebas): el Worker con los dos buckets simulados (`tests/web-unit/r2-falso.mjs`, con ETag, condiciones, `put` que devuelve `null`, listado con cursor y un gancho para simular carreras) y GitHub simulado: salud, CORS (preflight, orígenes rechazados sin tocar nada, localhost), subida completa con trozos de 5 y 6 MB, idempotencia, carrera entre la lista y la escritura, aviso que falla y se reintenta, rechazos (32 MB, no Opus, método, configuración), ediciones y estado, portadas (imagen inmutable, índice con `If-None-Match` y después `If-Match`, sustitución, carrera con reintento que conserva las dos, 503 tras los reintentos, sin token por `/api/editar`, rechazos) e índice.
- `tests/web-unit/api-config.test.mjs` y `cover-index.test.mjs`: respaldo en Vercel (red, CORS, página de error ajena, error propio respetado, 5 minutos), destino de subida con `/api/salud` y su tiempo, índice tolerante, superposición e idempotencia, regla de reflejada.
- `tests/web-unit/migrar-portadas.test.mjs`: la migración con el Worker real y R2 simulado (solo publicadas, nunca la privada, simulación, idempotencia, no pisa la más nueva).
- `api-subir.test.mjs`, `api-editar.test.mjs` y demás siguen pasando sin cambios sobre las funciones de Vercel, ahora sobre el código común.
- Contrato común `ediciones-pendientes.json` (web y APK) y `backend/tests/test_entrada.py` (límite de 32 MiB igual que la web).
- E2E `tests/web-e2e/worker.e2e.mjs`: la web con `WORKER_API_BASE` apuntando al Worker simulado (su código real en otro origen, `helpers/worker.mjs`), con el bucket público servido interceptando `pub-….r2.dev`: índice al abrir, «Cambiar portada» al bucket con confirmación en segundos, subida por el Worker y respaldo en Vercel con el Worker caído. Chrome de las E2E ya no llega al bucket real (`--host-resolver-rules`).
- APK: `test/api_config_test.dart`, `test/cover_index_test.dart` y `test/pending_edits_test.dart`.

## Qué no se ha verificado en vivo

- Nada se ha desplegado: ni el Worker en Cloudflare ni la web ni la APK con la constante puesta.
- Que el *binding* de R2 acepte `onlyIf` con `Headers({'If-None-Match': '*'})` como «solo si no existe» (la documentación dice que `onlyIf` admite cabeceras condicionales, pero no menciona `*` en `etagDoesNotMatch`). Si no lo admitiera, se vería en la primera subida o en la primera portada (fallarían con 502); el remedio sería crear el índice vacío a mano (`npx --yes wrangler@4.151.3 r2 object put reminiscencia-audio/portadas/indice.json --remote --file vacio.json --content-type application/json`) y comprobar la escritura de trozos.
- El tamaño real que admite el plan de la cuenta (32 MB cabe en todos según la documentación) y el tiempo de una subida de 32 MB por trozo con mala cobertura (la APK espera 90 s por petición).
- La caché de `r2.dev` con `Cache-Control: no-cache` en el índice (la web y la APK lo leen además por el Worker).
- El empaquetado de wrangler sí se comprobó en local (`wrangler deploy --dry-run`, 59 KB, sin `node:` ni `Buffer`).
