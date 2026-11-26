# Almacenamiento en GitHub: código y límites (catálogo ahora en R2)

- Estado: 2026-11-26, tras ADR-0052. **El catálogo ya no vive en Git**: `catalog/catalog.json` + `catalog/VERSION.txt`, `history/latest.jsonl`, `history/YYYY/MM/<ulid>.json` por evento y las snapshots (diaria + por versión) viven en R2 bajo el bucket público `reminiscencia-audio`. El audio sigue en los dos buckets de R2 (privado como fuente de verdad, público como copia servible). Portadas en `audio-library/covers/` (ADR-0016). `audio-library/indexes/catalog.json` queda como contrato de tests.
- Workflows retirados el 2026-11-26 (ADR-0052): `biblioteca.yml`, `buzon.yml` y `r2.yml`. Las ediciones pasan por `POST /api/catalogo/edit` del Worker; las publicaciones del buzón por `POST /api/buzon/publish`; el sync batch de R2 ya no hace falta porque el Worker guarda el audio al subir y el catálogo al mismo tiempo.
- Decisiones: ADR-0003 (parcialmente superada), ADR-0006 (parcialmente superada), ADR-0007 (parcialmente superada por ADR-0052), ADR-0008 (retirada: ya no hay incidencias), ADR-0010 (parcialmente superada), ADR-0014 (parcialmente superada), ADR-0016 (portadas, vigente), ADR-0017 (`/api/subir` vigente; dispatch retirado), ADR-0020 y ADR-0024 (audio en R2, vigentes), ADR-0025 (reemplazado por If-Match + lock), **ADR-0052 (modelo actual)**.
- Código: `worker/src/` (`catalog.js`, `catalog-actions.js`, `catalog-api.js`, `catalog-lock.js`, `history.js`, `snapshots.js`, `auth.js`, `r2-storage.js`), `scripts/migrar_catalogo_a_r2.py` (one-shot) y `backend/sonidos/` (`limits.py`, `catalog.py`, `publish.py`, `r2.py`, `entrada.py`) para tests y batch jobs puntuales.

## 1. Qué hay en el repositorio

| Ruta | Qué contiene | Estado en main | Llega al público |
|---|---|---|---|
| `audio-library/indexes/catalog.json` | Catálogo histórico: la copia del arranque de la migración (ADR-0052). Modelo de datos vigente, pero **ya no es fuente de verdad** | Versionado (contrato de tests) | No |
| `catalog/catalog.json` + `VERSION.txt` del bucket público R2 | **Fuente de verdad del catálogo** (ADR-0052). Lo lee y lo escribe el Worker | Fuera de Git | Sí, vía `GET /api/catalogo/latest` |
| `history/latest.jsonl`, `history/YYYY/MM/<ulid>.json` del bucket público R2 | Historial append-only de cambios (ADR-0052). Rotación en `latest.jsonl` al pasar 1000 entradas | Fuera de Git | Sí, vía `GET /api/catalogo/historial` |
| `snapshots/YYYY-MM-DD.json`, `snapshots/by-version/v<N>.json` del bucket público R2 | Snapshot diaria idempotente + snapshot por versión (rollback O(1)) | Fuera de Git | Indirectamente, por `POST /api/catalogo/rollback` |
| `audio-library/audio/<id>.opus` | Audio de paso en los scripts de migración puntuales; en producción el audio solo vive en R2 | No se versiona (`.gitignore`); el historial conserva lo que hubo | No |
| `audio/<id>.opus` del bucket privado de R2 | Copia de todo el audio, público y privado: fuente de verdad desde ADR-0024. Lo escribe el Worker al recibir las subidas | Fuera de Git | No |
| `audio/<id>.opus` del bucket público de R2 | Copia de las canciones publicadas; lo sirve el Worker en `/audio/<id>.opus` | Fuera de Git | Sí |
| `entrada/<id>/` del bucket privado de R2 | Trozos y manifiesto de las subidas de `/api/subir`, hasta que el cliente llama a `/api/buzon/publish` (ADR-0024 + ADR-0052). Ya no hay workflow que las procese | Fuera de Git | No |
| `audio-library/covers/<id>.jpg` y `frontend/web/covers/<id>.jpg` | Portadas de 640×640 (ADR-0016); se incorporan al catálogo con `set_cover` | Versionado | Las de `frontend/web/covers/` |
| `audio-library/buzon/` (histórico) | Carpeta de paso del flujo antiguo. Ya no se escribe en el camino caliente (ADR-0052). Queda en el historial | Versionado de paso; queda en el historial | No |
| `frontend/web/data/songs.json`, `folders.json`, `catalog.json` | Estáticos de fallback. Ya no se regeneran; sirven como copia de emergencia si el Worker da 503 | Versionado | Sí, lo sirve el Worker como estático |
| `releases/**/*.apk` y `SHA256SUMS.txt` | APK de la app Android | Excluidos por `.gitignore`; se adjuntan a la release | Como descarga de la release |

El repositorio es privado (comprobado con `gh` el 2026-11-02). El Worker sirve `frontend/web` (ADR-0034), y además los endpoints del catálogo (ADR-0052). Lo que está en `audio-library/` fuera de `covers/` y los estáticos de `frontend/web/` no llega al público.

## 2. Cómo entra una canción (ADR-0052)

Un solo flujo: subida desde la web o la APK con la contraseña del Worker.

1. **Conversión en el dispositivo.** La web (`js/cuidador/subida-publica.js`) o la APK (`shared_upload.dart`) convierten el archivo a Opus (ADR-0042/0045/0051) y, mientras convierten, calculan `sha256` y `duration_s` del fichero convertido.
2. **Identificador.** `S` seguido de los 16 primeros caracteres hexadecimales del `sha256` (`song_id_for` en `catalog.py` y en `worker/src/catalog-actions.js`). Subir dos veces el mismo contenido da el mismo id; el Worker devuelve 409 y no lo duplica.
3. **Trozos a R2.** El cliente envía los trozos (hasta 4 MiB cada uno) a `POST /api/subir` del Worker, que los guarda en `entrada/<id>/` del bucket privado con `If-None-Match: *` (no sobrescribe). Con el último trozo, el Worker responde `{ok, song_ready, upload_id, nombre, next_step}`.
4. **Publicación.** El cliente llama `POST /api/buzon/publish` con `X-Auth` y `{songs: [{sha256, title, artist?, year?, tags?, license, duration_s, size_bytes, codec:'opus', folder_id?, source?}], if_match}`. El Worker toma el candado `catalog/LOCK.json`, aplica `addBuzonSongs`, sube el `catalog/catalog.json` nuevo (version +=1), graba el evento en `history/` y, si es el primer cambio del día, la snapshot diaria. Responde 200 `{ok, version, event}`; 409 si `sha256` duplicado; 412 si `if_match` desfasado (el cliente refetchea y reintenta).
5. **Audio público.** Cuando la canción es pública, el Worker además copia el Opus al bucket público. La UI del usuario ve la canción publicada en segundos, sin polling.

Despublicar: `POST /api/catalogo/edit` con `action: 'unpublish_song'` y `{song_id}` pone `public: false`; el audio sigue en el bucket privado. Eliminar: `delete_song` lo quita del catálogo (no borra el bucket). Las operaciones batch (migrar a 48k, regenerar huellas, migrar portadas) siguen siendo workflows aparte (`migrar-audio-48k.yml`, `migrar-portadas.yml`, `regenerar-huellas.yml`).

## 3. Qué sale a la web

Lo que sirve el Worker en `GET /api/catalogo/latest` (ADR-0052):

- Cuerpo: `{ version:int, updated_at:ISO, folders:[…], songs:[…] }`.
- Canciones públicas: `id`, `title`, `artist`, `year`, `tags`, `folder_id`, `duration_s`, `license`, `source`, `public:true`, `track_index?`, `cover?`, `audio:'audio/<id>.opus'`. No incluye `sha256` ni metadatos sensibles.
- Carpetas: todas, con `id`, `name`, `parent_id`, `artist?`, `cover?`.
- Las canciones no publicadas **no** aparecen en la respuesta del Worker (el filtro se aplica al subir el catálogo o al servirlo; `backend/tests/test_publish.py` sigue cubriendo esa invariante en el modelo).
- Cabeceras: `ETag: W/"v<version>"`, `Cache-Control: no-store`, `Content-Type: application/json; charset=utf-8`. `If-None-Match` del cliente → 304 sin cuerpo.

## 4. Límites de GitHub

Cifras de `backend/sonidos/limits.py`, que cita docs.github.com consultado el 2026-10-31. No se han vuelto a consultar en esta revisión.

| Límite | Valor | Qué hace el proyecto |
|---|---|---|
| Fichero en Git: aviso | 50 MiB | `check_repo_limits.py` avisa |
| Fichero en Git: bloqueo | 100 MiB | `check_repo_limits.py` falla en CI |
| Repositorio: tamaño ideal | 1 GiB | `check_repo_limits.py` avisa |
| Repositorio: máximo recomendado | 5 GiB | `check_repo_limits.py` falla en CI |
| Asset de una release | Menos de 2 GiB | `release.py` lo comprueba; ningún workflow usa `release.py` |
| Assets por release | 1000, de los que se reserva uno para `SHA256SUMS.txt` | `plan_release_batches`, en `limits.py` |

`check_repo_limits.py` corre en `backend.yml` (en cada push a `main` y en cada pull request). Desde ADR-0052 ya no se dispara antes de un commit del catálogo porque el catálogo no se commitea.

**Cómo se mide.** `audit_repository` suma el tamaño de cada fichero versionado (`git ls-files`) tal como está en el árbol de trabajo. El audio no cuenta (`.gitignore`). El catálogo en R2 no cuenta (no está en Git). El cálculo no mide el historial de Git, que conserva lo antiguo.

## 5. Límites de entrada y descarga

| Límite | Valor | Dónde |
|---|---|---|
| Trozo de una subida por `/api/subir` del Worker | 4 MiB | `frontend/web/server/upload-core.js`, `MAX_CHUNK_BYTES` |
| Trozos por archivo | 1000 | `upload-core.js`, `MAX_PARTS` |
| URL, licencia, título | 2048, 300, 200 caracteres | `worker/src/catalog-actions.js` (validación de campos) |
| Nombre de carpeta y artista | 80 y 200 caracteres | `catalog-actions.js` |
| Etiquetas | 20 por canción, 40 caracteres cada una | `catalog-actions.js` |
| Subidas por hora | Sin límite, por decisión del propietario (ADR-0017) | — |
| `latest.jsonl` del historial | 1000 entradas, rota a `latest-rotado-<ulid>.jsonl` | `worker/src/history.js` |
| TTL del candado `catalog/LOCK.json` | 15 segundos | `worker/src/catalog-lock.js` |

## 6. Flujo de edición (ADR-0052)

1. **Petición.** La web o la APK presentan el cambio al usuario y mandan `POST /api/catalogo/edit` con `{action, params, if_match}` + header `X-Auth: <AUTH_PASSWORD>`.
2. **Autorización.** El Worker compara `X-Auth` en tiempo constante. 401 si falta o no coincide.
3. **Concurrencia.** El Worker lee el catálogo, comprueba `if_match === current.version`; si no, 412. Toma `catalog/LOCK.json` con TTL 15 s; si otra escritura lo tiene, 423 con `Retry-After`.
4. **Aplicación.** La acción es una función pura en `worker/src/catalog-actions.js` (15 acciones soportadas; ver sección de componentes). Devuelve el catálogo nuevo + el evento.
5. **Escritura.** Snapshot de la versión anterior (idempotente para rollback O(1)), sube `catalog/catalog.json` con `version += 1`, actualiza `VERSION.txt`, graba el evento (fichero inmutable + línea a `latest.jsonl`), snapshot diaria si es el primer cambio del día.
6. **Respuesta.** 200 `{ok, version, event}` con `ETag: W/"v<version>"`. La UI aplica el cambio y persiste la nueva ETag. No hay commit en Git, no hay redeploy.

**Rollback.** `POST /api/catalogo/rollback` con `{to_version}` y `X-Auth`. El Worker lee `snapshots/by-version/v<N>.json`, publica el contenido como `version = current + 1` y registra un evento `rollback` en el historial. El cliente actualiza la UI con la nueva versión.

**Garantías y límites.** La concurrencia optimista (`If-Match`) + el candado R2 evitan dos escrituras simultáneas que corrompan el catálogo. El Worker nunca escribe sin `AUTH_PASSWORD` válido. 412 y 423 son recuperables sin intervención (el cliente reintenta).

## 7. Pendientes

- Las APK anteriores a 1.4.25+51 que aún no se hayan actualizado no pueden publicar por el camino nuevo: sus subidas quedan en `entrada/<id>/` del bucket privado sin aparecer en el catálogo. ADR-0047 empuja la actualización; recuperable a mano.
- El campo `source` publicado incluye, en subidas, el valor de `X-Actor` (`web` o `apk` por defecto). Decidir si se publica.
- Monitorizar el tamaño del bucket público (historial crece lineal, ~1-2 KB por evento).
- Cambiar `p=none` del rollback por un sistema que también soporte rollback parcial (no clave hoy).

**Cambio 2026-11-26 (ADR-0052):** el catálogo pasó a vivir en R2; los workflows `biblioteca.yml`, `buzon.yml` y `r2.yml` se retiraron. El modelo descrito arriba ya es el nuevo.
