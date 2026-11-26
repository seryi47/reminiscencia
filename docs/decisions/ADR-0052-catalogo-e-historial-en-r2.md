# ADR-0052: Catálogo e historial en R2, con el Worker como único escritor

- Estado: aceptada (2026-11-26). Diseño fijado y migración one-shot preparada (`scripts/migrar_catalogo_a_r2.py` + `backend/tests/test_migrar_catalogo_a_r2.py`). Los endpoints del Worker (lectura y escritura), la adaptación de la web y de la APK, y la retirada de los workflows `biblioteca.yml`, `buzon.yml` y `r2.yml` se abordan en las siguientes fases, bajo este mismo ADR.
- Fecha: 2026-11-26.
- Relacionadas: cierra la arquitectura de catálogo que venía de [ADR-0003](ADR-0003-almacenamiento-audio-github.md) (los primeros audios y metadatos viajaban por GitHub) y de [ADR-0011](ADR-0011-publicar-regenera-parte-publica.md) (regeneración del índice público desde el catálogo en cada publicación). Hereda las garantías de [ADR-0024](ADR-0024-audio-privado-en-r2.md) (R2 como almacén de audio), extiende el Worker descrito en [ADR-0029](ADR-0029-worker-cloudflare-y-portadas.md) con responsabilidades de escritura, y sustituye el camino por GitHub Actions optimizado en [ADR-0043](ADR-0043-buzon-dos-jobs-secretos-por-paso.md). Deja intacto [ADR-0044](ADR-0044-transferir-musica-desde-spotify.md) (la importación desde Spotify sigue cayendo en el buzón, solo cambia su cola de publicación).

## Contexto

Tras ADR-0042 la publicación del buzón bajó de ~8 min a ~1 min, y ADR-0043 quitó otro traspaso de artefactos. Aun así, **toda** edición o subida en Reminiscencia (añadir una canción, renombrar un álbum, cambiar una portada, editar un título) termina en un *commit* a `main` y un despliegue de la web estática. La latencia real que ve el usuario sigue siendo de uno a varios minutos, dominada por: arranque del runner, checkout, regeneración de `frontend/web/data/*.json`, rebase, push y despliegue de Cloudflare Workers Builds.

El audio ya vive fuera de GitHub desde ADR-0020/0024 (los dos buckets de R2). Lo que queda viajando por `main` son **metadatos**: `audio-library/indexes/catalog.json` (fuente de verdad) y los tres índices servidos `frontend/web/data/{catalog,songs,folders}.json` (regenerados por `backend/sonidos/publish.py`). El usuario quiere que una edición se vea en segundos, no en minutos, **sin perder el historial** (hoy lo da `git log`): mover el catálogo a R2 y guardar en R2 también un historial append-only y snapshots diarios.

El Worker de Cloudflare (ADR-0029/0034) ya tiene los dos buckets como *bindings* (`PUBLIC_BUCKET` → `reminiscencia-audio`, `PRIVATE_BUCKET` → `reminiscencia-audio-privado`) y abstrae el acceso en `worker/src/r2-storage.js`. Hoy solo se usa para audio y portadas.

## Decisión

1. **Fuente de verdad del catálogo en R2, en el bucket público.** La clave es `catalog/catalog.json` dentro del bucket `reminiscencia-audio` (el mismo que ya sirve el audio público; no se crea bucket nuevo). El objeto lleva en su *metadata* personalizada dos campos: `version` (entero monotónico que empieza en 1) y `updated_at` (ISO 8601 UTC). Junto a él, `catalog/VERSION.txt` (cuerpo `"<n>"`, cache corta) sirve de sonda rápida y de salvaguarda contra lecturas inconsistentes de metadata. La fuente de verdad **local** (`audio-library/indexes/catalog.json`) se congela: sigue en el repositorio como contrato de tests y punto de partida de la migración, pero deja de aceptar escrituras desde los workflows (`biblioteca.yml`, `buzon.yml`).

2. **Historial append-only en R2.** Cada escritura exitosa del catálogo escribe también **dos** objetos:
   - `history/<YYYY>/<MM>/<ulid>.json` con el evento completo `{id, ts, actor, action, target, changes, prev_version, new_version}` (uno por fichero: dura para siempre, auditable, ordenable por ULID).
   - `history/latest.jsonl` rotativo con los últimos 1000 eventos (una línea JSON por evento, el más reciente al final). La UI usa este fichero para pintar «últimos cambios» sin tener que listar prefijos en R2.

   Campos del evento:
   - `id`: ULID (26 chars, lexicográficamente ordenable).
   - `ts`: ISO 8601 UTC.
   - `actor`: `"migration"` para el *bootstrap*, usuario autenticado para las demás (ver punto 4).
   - `action`: etiqueta corta (`migration_initial`, `song_add`, `song_update`, `song_delete`, `folder_add`, `folder_rename`, `folder_move`, `song_cover`, `folder_cover`, `bulk_import`, …).
   - `target`: `{type: "song"|"folder"|"catalog", id: "..."}` o `null` para acciones globales.
   - `changes`: diff mínimo aplicable al revés (`{"before": {...}, "after": {...}}` con solo los campos que cambiaron); para `add` es `{"before": null, "after": {...}}`; para `delete` es `{"before": {...}, "after": null}`.
   - `prev_version`, `new_version`: enteros.

3. **Snapshot diario en R2.** La primera escritura de cada día escribe `snapshots/<YYYY-MM-DD>.json` con el catálogo **anterior** a la escritura (el estado al cierre del día previo). Si ya existe, no se sobrescribe. Un *job* opcional del Worker (cron) puede garantizar un snapshot aunque no haya habido cambios ese día; no es imprescindible mientras haya actividad. Retención: indefinida (son ~200 KiB por día, 73 MiB al año, barato en R2).

4. **Autorización en el Worker.** Todos los endpoints de escritura exigen la cabecera `X-Auth`, cuyo valor se compara **en tiempo constante** con el secreto `AUTH_PASSWORD` del Worker (ya subido; su copia maestra vive en el llavero de la Mac como `reminiscencia-worker-auth`). La web y la APK leen la contraseña de su propio almacén (`localStorage['reminiscencia.auth']` / `SharedPreferences['reminiscenciaAuthPassword']`) y la inyectan en cada petición; el usuario no la escribe: se provisiona una vez al preparar el dispositivo. Rechazos: `401` si falta, `403` si no coincide, **sin** revelar cuál de los dos. Un `429` devuelto por el Worker ante 5 fallos en 60 s (clave de rate limit = IP, en memoria del *isolate*).

5. **Concurrencia optimista.** El cliente lee el catálogo con `GET /api/catalogo/latest`, recibe `{version, folders, songs, updated_at}` y, cuando quiere escribir, manda su POST con `If-Match: <version>`. El Worker:
   - Toma un **candado blando** en R2: `catalog/LOCK.json` con cuerpo `{owner, acquired_at, ttl_s: 15}`. Si existe y no ha vencido, responde `409 Locked` y el cliente reintenta tras 200-500 ms.
   - Relee `catalog/catalog.json` dentro del candado; si su `version` ya no coincide con `If-Match`, responde `412 Precondition Failed` con el `version` actual en `ETag` y libera el candado. El cliente vuelve a leer y reintenta.
   - Aplica el cambio en memoria, incrementa `version`, escribe (en este orden): (a) el snapshot del día si aún no existe; (b) `history/<YYYY>/<MM>/<ulid>.json`; (c) `history/latest.jsonl` (lectura + append + escritura del rotativo, truncado a 1000 líneas); (d) `catalog/catalog.json` con la nueva metadata; (e) `catalog/VERSION.txt`. El candado se libera al final o por TTL si el *isolate* muere.

   Elegimos candado blando en R2 (no *Durable Objects*) para mantener el Worker *stateless* y el ADR implementable sin depender de otro producto; el TTL corto evita bloqueos permanentes. La latencia extra por operación es de dos *round-trips* a R2 (candado y re-lectura), aceptable.

6. **Lecturas.** `GET /api/catalogo/latest` devuelve el JSON completo con cabeceras `Cache-Control: no-store`, `ETag: W/"v<version>"` y `X-Catalog-Version: <version>`. **No** usa caché de *edge* (`cf.cacheTtl=0`); el Worker va siempre a R2. `GET /api/catalogo/version` devuelve solo `{version}` (vector rápido para poller). La web y la APK piden `latest` al abrir y al volver de segundo plano, y `version` cada 30 s cuando la pestaña está activa (actualizan si subió).

7. **Formato de los POST.** El Worker expone:
   - `POST /api/catalogo/song` — crear o actualizar una canción (body `{action: "add"|"update"|"delete", song: {...}}`).
   - `POST /api/catalogo/folder` — crear, renombrar, mover o borrar una carpeta.
   - `POST /api/catalogo/cover` — cambiar la portada (ya existente para carpetas en ADR-0029, se amplía a canciones).
   - `POST /api/catalogo/bulk` — lote (p. ej. una publicación del buzón con N canciones y M portadas en una sola transacción lógica).

   Cada endpoint exige `X-Auth` y `If-Match`, devuelve el nuevo `{version, updated_at}` y los campos cambiados. El cuerpo del evento del historial se construye en el Worker, no lo manda el cliente (así el `actor` y el `prev_version/new_version` son fiables).

8. **Modelo de rollback.** Dos vías:
   - **Punto a punto** (`POST /api/catalogo/revertir`, body `{event_id}`): el Worker lee el evento del historial, aplica `changes.before` sobre el estado actual (si es *add* lo borra; si es *delete* lo recrea; si es *update* restaura los campos de `before`), y registra un nuevo evento `action: "revert", target: {type, id}` con `changes.before = cambios.after, changes.after = cambios.before`. Si el objeto ha cambiado desde entonces en los mismos campos, responde `409 Conflict` y el usuario decide.
   - **Desde snapshot** (`POST /api/catalogo/restaurar`, body `{date: "YYYY-MM-DD"}`): sustituye el catálogo entero por el de ese snapshot, con evento `action: "restore_from_snapshot", target: null`. Peligroso; exige confirmación (doble POST) y escribe un snapshot del estado actual antes de reemplazarlo.

9. **Qué sale de GitHub, qué se queda.** Se **eliminan** los workflows `.github/workflows/biblioteca.yml`, `.github/workflows/buzon.yml` y `.github/workflows/r2.yml` (y sus scripts auxiliares `scripts/sync_r2.py` cuando el Worker ya sincronice R2 por su cuenta en el flujo de subida; la retirada se hace en una fase posterior con *revert* reversible). Se **mantienen**: `android.yml` (release firmada de la APK, requiere *keystore* y `tag` → sigue en Actions), `web.yml` (CI de la web, *linter* y tests), `backend.yml` (suite Python), `web-e2e.yml` (end-to-end con *playwright*), y los *one-shot* de migración batch (`migrar-audio-48k.yml`, `migrar-portadas.yml`, `regenerar-huellas.yml`) por si hay que volver a correrlos.

10. **Migración one-shot.** `scripts/migrar_catalogo_a_r2.py` sube el `audio-library/indexes/catalog.json` actual a R2 como `catalog/catalog.json` con `version=1`, escribe `catalog/VERSION.txt`, crea el evento inicial `action: "migration_initial"` en `history/latest.jsonl` (y en `history/<YYYY>/<MM>/<ulid>.json`), y deja un snapshot del día `snapshots/<YYYY-MM-DD>.json`. Es **idempotente**: si ya existe `catalog/catalog.json` con `version >= 1` aborta con código 2 (`--force` deja re-ejecutarla tras un borrado deliberado). `--dry-run` imprime qué subiría sin tocar nada.

## Consecuencias

- **Latencia visible.** Una edición pasa de ~1-3 min (cola de Actions + checkout + publish + deploy) a ~1-3 s (POST al Worker + dos round-trips a R2). La subida del buzón, cuando el cliente haga el *upload* directo al bucket privado y notifique al Worker, acaba en segundos tras completarse la transferencia.
- **Resiliencia.** Antes, un fallo de R2 solo cortaba audio; ahora corta también catálogo. Mitigación aceptada: el Worker sirve la última versión que tenga en caché (fallback a `catalog/VERSION.txt` y a *ETag* del cliente) y `AUTH_PASSWORD` + candado blando bloquean escrituras mientras R2 esté degradado. El usuario lo acepta como coste razonable.
- **Seguridad.** El vector cambia: ya no es «quien tenga *push* al repo»; es «quien tenga `AUTH_PASSWORD`». La contraseña no la escribe nunca el usuario (vive en el llavero de la Mac y se provisiona en la web/APK la primera vez). El Worker compara en tiempo constante (sin fugas por *timing*), limita a 5 intentos por minuto y por IP, y nunca escribe la contraseña en el log. La rotación es un `wrangler secret put AUTH_PASSWORD` + actualizar `localStorage`/`SharedPreferences`.
- **Historial completo.** No se pierde el `git log`. El bootstrap sella un evento que referencia la *commit sha* y el `updated_at` del catálogo actual; a partir de ahí todas las ediciones escriben evento en R2. La UI expone «últimos cambios» sin tocar GitHub.
- **Tests.** La suite `backend/tests/` cambia menos de lo que parece: `audio-library/indexes/catalog.json` sigue existiendo como fixture y contrato (23 referencias en tests). Lo que se tocará en fases posteriores son los tests de los workflows (los que se eliminen) y los nuevos tests del Worker (contrato de endpoints, concurrencia 412, rollback, rate limit). En esta fase se añade `backend/tests/test_migrar_catalogo_a_r2.py`.
- **R2 obliga a compensación manual si falla a mitad.** Si el Worker escribe el evento del historial pero el PUT del catálogo falla, el historial tendrá un evento sin efecto en el catálogo. La reparación es correr `scripts/migrar_catalogo_a_r2.py --force` desde un catálogo local más reciente, o `POST /api/catalogo/revertir` con el `event_id` huérfano. Se detecta comparando `catalog.version` con el `new_version` del último evento de `history/latest.jsonl`; el Worker lo hará al arrancar (una lectura, sin bloquear) y expondrá el estado en `GET /api/catalogo/health`.

## Pitfalls (trampas)

- **Metadata de R2.** La *metadata* personalizada de un objeto solo se actualiza con un PUT completo. No se puede «tocar» `version` sin reescribir el cuerpo. Esto refuerza el modelo: el objeto `catalog.json` se reescribe entero en cada edición (es pequeño, ~200 KiB; no es problema).
- **Cache-Control del bucket público.** El bucket `reminiscencia-audio` tiene cache «inmutable» para `audio/` (ADR-0020). Las nuevas claves (`catalog/`, `history/`, `snapshots/`) necesitan cache corto o nulo: se fija en el `put_object` del Worker (`Cache-Control: no-store` para `catalog/` y `history/latest.jsonl`; `public, max-age=3600` para los eventos del historial inmutables y los snapshots). La abstracción actual (`r2.py` en Python, `r2-storage.js` en el Worker) asume audio inmutable: hay que parametrizar el `Cache-Control` por clave.
- **Candado huérfano.** Si un *isolate* del Worker muere a la mitad, el `catalog/LOCK.json` sobrevive su TTL de 15 s. El Worker lo considera caducado por su campo `acquired_at`, no por metadata. El usuario puede verse un `409 Locked` momentáneo tras un fallo; el cliente reintenta tres veces con *backoff* y lo cuenta como vencido si tiene más de 15 s.
- **Orden de escritura en una edición.** Si se escribe primero `catalog/VERSION.txt` y luego `catalog/catalog.json` falla, las lecturas que usan VERSION caerán en un `catalog.json` viejo y pensarán que es actual. El orden correcto es: evento → rotativo → snapshot (si procede) → catálogo → VERSION. Los tests del Worker lo bloquean.
- **Tamaño del `history/latest.jsonl`.** 1000 eventos a ~500 B son ~500 KiB. Pequeño, pero conviene leer-append-escribir con `If-Match` propio (no reescribir desde una lectura vieja y perder eventos de otro escritor en carrera). Como el candado del catálogo ya serializa escrituras, no hay carrera en la práctica, pero el test de concurrencia lo cubre.
- **ULID vs reloj del Worker.** El ULID necesita un reloj monotónico. En los *isolates* de Cloudflare, `Date.now()` es correcto para ordenar. Se incluye un *tie-breaker* aleatorio de 10 bytes en el sufijo del ULID.
- **Backups.** R2 no versiona por defecto. Los snapshots diarios + el historial son el versionado. Hay que documentar que `scripts/restaurar_desde_snapshot.py` (no entra en esta fase) es la vía para recuperar un catálogo completo.
- **Tests Python importan catálogo local.** Mientras no migremos los workflows, la fuente de verdad local (`audio-library/indexes/catalog.json`) sigue siendo el fixture; cuando migremos los flujos de buzón y biblioteca al Worker, sus tests cambiarán y el fichero local pasará a ser «la última foto conocida antes de la migración».
- **`AUTH_PASSWORD` en el Worker local.** En desarrollo, `wrangler dev` lee los secretos de un `.dev.vars` local, **no** del secreto en Cloudflare. Hay que documentar en el README del Worker cómo poner la contraseña local sin commitearla.

## Pruebas

Esta fase (diseño + migración) añade un único fichero de pruebas, `backend/tests/test_migrar_catalogo_a_r2.py`, con los casos:

- `test_dry_run_no_escribe`: `--dry-run` no sube ningún objeto al bucket y describe qué subiría.
- `test_primera_ejecucion_sube_catalogo_historial_y_snapshot`: sube `catalog/catalog.json` (con metadata `version=1` y `updated_at`), `catalog/VERSION.txt`, `history/latest.jsonl` con el evento `migration_initial`, el evento por ULID en `history/YYYY/MM/`, y `snapshots/<YYYY-MM-DD>.json` con el mismo contenido que el catálogo.
- `test_segunda_ejecucion_sin_force_aborta`: si ya hay `catalog/catalog.json` con `version>=1`, el script devuelve 2 y no escribe nada.
- `test_segunda_ejecucion_con_force_sobrescribe`: con `--force`, reescribe el catálogo y añade un segundo evento `migration_initial` al historial (no rota la cuenta de versión: deja `version=1` si es el bootstrap, el *versioning* real lo lleva el Worker).

Las fases posteriores añadirán:

- Contrato del endpoint (web unit test): `GET /api/catalogo/latest` devuelve `version`, `ETag` y `Cache-Control: no-store`; `POST /api/catalogo/song` con `X-Auth` correcto y `If-Match` correcto suma versión; sin `X-Auth` → 401; con `If-Match` viejo → 412.
- Concurrencia: dos POST con el mismo `If-Match` → uno gana, otro 412; el que gana ve `new_version = prev_version + 1`.
- Rollback: `POST /api/catalogo/revertir` con un evento válido restaura `changes.before`; con un evento cuyo objeto cambió entre medias → 409.
- Snapshot diario: una primera escritura del día deja `snapshots/<YYYY-MM-DD>.json` con el catálogo **anterior**; una segunda escritura el mismo día no lo sobrescribe.
- Migración idempotente: tests que ya existen en esta fase se mantienen.

La suite backend sigue verde con las pruebas añadidas (se correrá al cierre de la fase).

## Cierre de findings (2026-11-26)

Auditoría adversarial posterior al despliegue. Fixes críticos aplicados en commit anterior (unpublish, params `new_*`, `/api/editar` → 410, fallbacks cerrados). Estos son los medium/low cerrados aquí:

- **Canal oficial de provisionado: `#auth=<base64>` (fragmento, no `?auth=`).** El fragmento NO viaja al servidor, no queda en logs de Cloudflare. `?auth=` se mantiene por compatibilidad (la primera vez que se ha usado ya quedó en logs; consumirlo no lo reintroduce). Documentado en `frontend/web/js/auth.js`.
- **Orden de escrituras en `withLockedWrite` (atomicidad).** Primero `appendEvent`, después `writeCatalog`, después `ensureVersionSnapshot(next)`. Si el *isolate* muere a medias, el historial deja una entrada "huérfana" detectable al comparar `catalog.version` con `version_after` del último evento; la recuperación es reaplicar el cambio del evento huérfano. Mal menor sobre el orden antiguo (que dejaba versiones sin registro).
- **Snapshot `by-version/v<new>` por cada edición.** Sin esta llamada, el *rollback* a la versión actual era 404 hasta la siguiente edición. Hoy es idempotente (HEAD + PUT por escritura).
- **Rotación de `history/latest.jsonl` atómica.** Primero se escribe el `latest.jsonl` con la línea nueva, después la copia histórica `latest-rotado-<ulid>.jsonl`. Si muere entre ambos, la línea nueva ya está en el rollup; como mucho se pierde la copia histórica (los eventos siguen en `history/YYYY/MM/`).
- **SW reenvía `If-None-Match`.** `networkFirst` pasa el `Request` entero (antes pasaba sólo la URL y descartaba las cabeceras). El Worker devuelve 304 cuando el cliente ya tiene la versión actual del catálogo.
- **Esquema del evento del script de migración alineado con el Worker** (`{id, at, kind, by, version_before, version_after, ...}`). La UI del historial ya no ve `undefined` si se vuelve a correr `scripts/migrar_catalogo_a_r2.py` (p. ej. en un entorno nuevo).
- **Deadcode retirado.** `scripts/` y `backend/sonidos/` que solo disparaban los workflows `biblioteca.yml` / `buzon.yml` / `r2.yml` ya no están, junto con sus tests. Lista exacta en el commit.

### Nota sobre `X-Actor` / `by` (no autenticado, informativo)

El campo `by` del historial (y la cabecera `X-Actor` que lo alimenta) **NO está autenticado**. Cualquier portador de `AUTH_PASSWORD` puede escribir cualquier valor en `X-Actor` y, por tanto, en el `by` del evento. El modelo actual asume una contraseña compartida entre dispositivos autorizados; el `by` sirve para distinguir quién editó cuándo cuando el operador se identifica honestamente (p. ej. la web deja `web`, la APK `apk`, la Mac `migration-ops`), pero no vale para auditoría forense: una contraseña comprometida permite forjar cualquier `by`.

Si se necesita auditoría por usuario real, hace falta emitir tokens por usuario (JWT firmado por el Worker, con `sub` fijado en la emisión) y derivar `by` del token verificado, no del header del cliente. Queda **fuera del alcance de este ADR**; se registrará como ADR aparte cuando alguien pida la capacidad.
