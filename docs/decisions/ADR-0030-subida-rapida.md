# ADR-0030: Subida rápida: una ejecución publica todo lo pendiente y el cliente canaliza

- Estado: aceptada (rama `feature/subida-rapida`, 2026-11-06; pendiente de fusionar en main). Sin verificar todavía en vivo (ver «Qué no se ha verificado»).
- Fecha: 2026-11-06.
- Modifica: [ADR-0017](ADR-0017-subida-directa-github-web-publica.md) (el cliente ya no envía «de uno en uno y en orden») y [ADR-0024](ADR-0024-audio-privado-en-r2.md), decisión 3 (qué recoge `recoger` y en qué orden se cataloga).
- Relacionadas: [ADR-0010](ADR-0010-procesado-y-publicacion-separados.md) (procesado sin secretos), [ADR-0014](ADR-0014-buzon-de-canciones.md) (buzón), [ADR-0025](ADR-0025-publicar-robusto.md) (publicar robusto) y [ADR-0026](ADR-0026-albumes-orden-seleccion-duplicados.md) (número de pista).

## Contexto

Medido en la ejecución real de `buzon` tras una subida desde la web (run 42192748973, 2026-11-06): `autorizar` 3 s, `recoger` 44 s (37 s de checkout), `procesar` 79 s (checkout 40 s, «Instalar ffmpeg» 23 s, «Instalar el backend» 4 s), `publicar` 28 s (checkout 13 s). Unos 2 min 40 s por ejecución.

- **Una ejecución por archivo.** `/api/subir` lanza un `repository_dispatch` por cada subida completa, y las ejecuciones van en serie en la cola `library-catalog` (`queue: max`). `recoger` ya bajaba todo lo completo, pero las ejecuciones siguientes de la cola seguían costando el checkout (unos 45 s cada una) y, si quedaba algo en el buzón de `main`, también `procesar` y `publicar` aunque en un aviso de la web ese buzón no se procese. Con 20 canciones se midieron unos 50 minutos hasta que se publicaba la última.
- **Checkouts caros.** El árbol de `main` tenía 504 MB de audio (`audio-library/audio/`). La parte 2 de ADR-0024 (fusionada el 2026-11-06) lo sacó de Git: el árbol de `main` ocupa ahora 7 MB. `recoger` y `procesar` siguen bajando todo el árbol aunque usen una parte.
- **ffmpeg desde cero en cada ejecución** (`apt-get install`, salida a `/dev/null` y errores silenciados con `|| true`), e `pip install -e backend` aunque el backend no tiene dependencias.
- **El cliente, en serie.** La web (`js/cuidador/subida-estado.js`) y la APK (`lib/shared_upload.dart`) convertían un archivo, lo enviaban entero y solo entonces empezaban a convertir el siguiente.
- **El orden de las pistas.** El buzón catalogaba lo recogido en una ejecución por nombre de archivo, y el número de pista de un álbum se da al entrar (ADR-0026): una playlist que entrara en una sola ejecución quedaba numerada por orden alfabético. Con envíos en paralelo, además, las subidas terminan desordenadas.

## Decisión

### 1. Una ejecución publica todo lo pendiente

- **`recoger` toma todas las subidas completas** de `entrada/` (con manifiesto), no solo la del aviso, por orden de llegada (fecha `LastModified` del manifiesto, que pone R2 y no quien sube; `sonidos.entrada.arrival_order`), con el tope de siempre (50 subidas o 2 GiB por ejecución): lo que no cabe, lo más nuevo, se queda para la ejecución siguiente. `S3Bucket.list_details` lee la fecha del listado.
- **Orden de catalogar.** `recoger` deja en el artefacto `orden.json` (`{"subidas": [UUID, …]}`) el orden de la cola de quien subió (`queue_order`): la web y la APK numeran cada subida con un **UUID versión 7** (RFC 9562), que empieza por los milisegundos en que terminó de prepararse, y las preparaciones van una a una y en el orden de la lista. Un UUID que no es v7 (un cliente anterior) cuenta con la fecha de su manifiesto. El buzón (`sonidos.buzon`) cataloga lo del buzón de `main` por nombre, como siempre, y después las subidas de la web en ese orden; si `orden.json` falta o no tiene la forma esperada, usa el orden por nombre (el orden nunca hace perder una subida). Así las pistas de una playlist se numeran en el orden de la lista. `/api/subir` y el buzón ya aceptaban cualquier UUID en minúsculas: el contrato no cambia.
- **Las ejecuciones sin nada que hacer terminan en segundos.** `procesar` y `publicar` se saltan si `recoger` da `cantidad=0` y no hay nada pendiente en `main`. En un aviso de la web (`repository_dispatch`), `autorizar` ya no cuenta los archivos del buzón de `main` (ese buzón no se procesa en un aviso: espera a su propio push, con su licencia), solo los manifiestos antiguos de `.partes/`, que sí se unen.
- **Idempotente.** `publicar` borra de `entrada/` solo lo que recogió su ejecución (lo que llegó después se queda). Si borrar falla después del push, o llegan varios avisos de lo mismo, la ejecución siguiente vuelve a recogerlo y el buzón lo reconoce por su SHA-256: sale como duplicada, el catálogo no cambia y el paquete va vacío. Dos subidas con los mismos bytes en una ejecución dan una canción y una duplicada.

### 2. Ejecuciones más rápidas

- **Checkout mínimo** (`sparse-checkout` en modo cone; `actions/checkout` baja entonces con `filter: blob:none`):
  - `recoger`: `scripts` y `backend/sonidos`.
  - `procesar`: `scripts`, `backend/sonidos`, `audio-library`, `frontend/web/data` y `frontend/web/covers` (el modo cone añade los ficheros sueltos de la raíz y de `frontend/`, `frontend/web/` y `backend/`).
  - `publicar` no cambia: necesita el historial completo sin contenidos (`fetch-depth: 0`, `filter: blob:none`) para la comprobación de antecesor y el rebase de ADR-0025, y escribe en el árbol entero.
- **Sin `pip install`** en `procesar`: el backend no tiene dependencias y los scripts lo importan desde `backend/` (ya lo hacían `recoger` y `publicar`).
- **ffmpeg desde una caché de sus `.deb`** (`actions/cache/restore` y `actions/cache/save` v6.1.0, fijadas por SHA como las demás):
  - la clave es el hash de la lista exacta que daría `apt-get install --print-uris --no-install-recommends ffmpeg` (URL, nombre, tamaño y hash de cada paquete, del índice firmado de apt): si cambia una versión, cambia la clave;
  - apt solo compara el **tamaño** de un `.deb` que ya está en su carpeta de descargas, no su hash (`pkgAcqArchive::QueueNext` en `apt-pkg/acquire-item.cc`, comprobado en el código de apt): por eso un paso propio compara el SHA-256 (o SHA-512) de cada `.deb` restaurado con el de esa lista y borra lo que no coincida o no esté en ella, y apt lo vuelve a descargar;
  - la caché se guarda **antes** de que el job descargue o toque nada subido: lo que entra en ella solo lo ha escrito apt. Es de `main` (el job solo corre en `main`) y una clave no se sobrescribe;
  - la instalación ya no silencia errores: sin `/dev/null` ni `|| true`, con `-o DPkg::Lock::Timeout=60`, tres intentos de 180 s como máximo (con `apt-get update` entre medias) y un error claro si no se consigue. Sin regenerar el índice de `man-db` y con `--force-unsafe-io` (máquina de usar y tirar).
- **Menos trabajo repetido:** las ejecuciones vacías ya no hacen checkout completo ni procesan; `procesar` ya no instala el backend.

### 3. Cliente más rápido (web y APK, igual)

- **Canalización:** la conversión va de una en una y en el orden de la lista; mientras se envía un archivo ya se convierte el siguiente. Como mucho **un archivo convertido espera** hueco para enviarse (`MAX_CONVERTED_WAITING` / `kMaxConvertedWaiting`): la memoria y el disco no crecen con la cola.
- **Hasta dos archivos a la vez** (`MAX_PARALLEL_SENDS` / `kMaxParallelSends`). `/api/subir` exige en orden los trozos de cada archivo (un trozo solo entra si están los anteriores de esa subida); entre subidas distintas no hay ninguna dependencia: cada una tiene su carpeta `entrada/<UUID>/`. Lo comprueba `api-subir.test.mjs` con dos subidas intercaladas y en paralelo.
- **Estados y progreso:** la máquina de estados no cambia. Un archivo convertido que espera hueco se ve como «Subiendo… 0 %». La lista conserva su orden aunque una subida termine antes que otra. Un fallo del servidor que para la cola (500 o 404) falla lo que está en cola, convirtiéndose o esperando hueco; lo que ya se envía termina solo. En la APK, si se pierde la red, lo que aún no se ha empezado a enviar queda pendiente.
- **UUID v7** en orden de cola: `orderedUploadIds` (web) y `OrderedUploadIds` (APK), con los mismos casos de prueba (contador de 12 bits si coincide el milisegundo o el reloj va hacia atrás, y paso al milisegundo siguiente tras 4096). En la web, el gestor pasa `uploadId` a `send`; en la APK, `SharedUploader` lo saca al terminar cada conversión y al reenviar.
- No cambian las constantes de URL base ni el tamaño de trozo (`UPLOAD_ENDPOINT`, `CHUNK_BYTES`, `kUploadEndpoint`, `kUploadChunkBytes`).

## Ahorro estimado

Medido en local (2026-11-06, desde GitHub): un clon superficial de `main` (ya sin audio en Git) tarda 1,7 s y ocupa 12 MB en disco; con `--filter=blob:none --sparse` (solo la raíz), 1,5 s y 0,7 MB. Según el árbol de `main`, el sparse-checkout de `recoger` baja 2,2 MB de contenido y el de `procesar` 2,6 MB, de 7,1 MB. No se ha podido medir en GitHub Actions. Las cifras del runner son estimaciones a partir de la ejecución medida:

| Parte | Antes (medido) | Después (estimado) | De dónde sale |
|---|---|---|---|
| Checkout de `recoger` y `procesar` | 37 s y 40 s | 2–4 s cada uno | Sobre todo la parte 2 de ADR-0024 (504 MB → 7 MB); el sparse-checkout baja además solo lo que usan (2,2 y 2,6 MB de 7,1 MB). |
| «Instalar ffmpeg» | 23 s | 10–15 s con la caché; igual que antes la primera vez de cada lista de paquetes (más 2–3 s de guardarla) | Sin descarga, sin `man-db` y sin `fsync` por fichero; restaurar la caché cuesta 1–2 s. |
| «Instalar el backend» | 4 s | 0 s | Ya no se instala. |
| Ejecución vacía de la cola | ≈ 50 s (3 s + 44 s + arranque de jobs) | ≈ 15 s | `autorizar` + `recoger` con checkout mínimo; `procesar` y `publicar` se saltan. |
| Ejecución con trabajo | ≈ 160 s | ≈ 70–90 s + lo que tarde convertir cada canción | Suma de lo anterior; `publicar` también baja menos ahora que el audio no está en Git. |
| Cliente, N archivos | N × (convertir + enviar) | ≈ N × max(convertir, enviar / 2) + lo que tarde el último | Con 20 canciones, 10 s de conversión y 6 s de envío cada una: de 320 s a unos 206 s (−35 %). Si manda la red, los dos envíos a la vez ocultan la latencia de cada trozo (Vercel → R2 y el listado previo), no el ancho de banda. |
| 20 canciones hasta la última publicada | ≈ 50 min (medido) | lo que tarde el cliente + 1–2 ejecuciones (unos 3–5 min) | La primera ejecución que llega después de completarse lo último lo publica todo; las demás de la cola terminan en segundos. |

## Seguridad

- `procesar` sigue sin token ni secretos (no tiene `secrets.` ni `GH_TOKEN`), y ya no ejecuta `pip install` sobre el árbol. La caché de ffmpeg no lleva secretos y se guarda antes de tocar nada subido; lo que se restaura se comprueba contra el índice firmado de apt.
- `recoger` sigue sin token, sin instalar nada y solo leyendo del bucket; las credenciales de R2 siguen solo en sus pasos. El orden de catalogar sale de UUID que elige el cliente, pero solo ordena lo ya recogido: qué entra en cada ejecución (y el tope) va por la fecha que pone R2.
- `orden.json` lo escribe `recoger` (código de `main`); el buzón solo acepta una lista de UUID y nunca lo usa para escribir rutas.
- Lo vigilan `test_buzon_workflow.py` (sin `pip install` en `procesar`, sin token ni secretos en `procesar`, guarda de rama antes de ejecutar nada del árbol, acciones fijadas por SHA, caché guardada antes de descargar las subidas, apt sin `/dev/null` y con `DPkg::Lock::Timeout`) y las pruebas ya existentes.

## Alternativas descartadas

- **Un binario estático de ffmpeg fijado por SHA-256.** Sería más rápido (unos 3 s), pero depende de un tercero que no garantiza conservar las versiones antiguas, y cambiaría la versión de ffmpeg respecto a la de Ubuntu. Los `.deb` de Ubuntu ya vienen firmados.
- **Agrupar avisos en el cliente** (un solo `repository_dispatch` al final de la tanda). Cambia el contrato de `/api/subir` y no evita las ejecuciones de otros clientes; con «todo lo pendiente por ejecución», los avisos de más cuestan unos segundos.
- **Ordenar el último trozo de cada archivo en el cliente** para que terminen en orden. Casi todas las canciones caben en un solo trozo de 4 MB: anularía el envío en paralelo.
- **Sparse-checkout en `publicar`.** `git add` de rutas fuera del sparse-checkout falla sin `--sparse` y el job escribe en todo el árbol; con el audio fuera de Git, su checkout ya es pequeño.

## Cómo se prueba

- `backend/tests/test_entrada.py`: recoger todo por orden de llegada con el tope (lo más antiguo primero; lo demás, en la ejecución siguiente), `orden.json` con el orden de la cola (UUID v7, y la fecha del manifiesto para otros UUID), `limpiar` no toca lo que llegó después, pistas de un álbum numeradas en orden de llegada, `orden.json` dañado sin perder nada, la misma subida dos veces en una ejecución, volver a procesar lo ya publicado sin cambios (paquete vacío), y el procesado en el sparse-checkout del job (git real, modo cone) con el mismo paquete que un checkout completo.
- `backend/tests/test_r2.py`: `list_details` lee `LastModified`.
- `backend/tests/test_buzon_workflow.py`: listas de sparse-checkout; los scripts de `recoger` y `procesar` se importan con solo su sparse-checkout (copia del árbol, `python -I`); orden de la caché (restaurar, comprobar, instalar, guardar, y después descargar las subidas); el paso que comprueba los `.deb` ejecutado con bash (bueno, alterado, que no está en la lista, enlace, sin lista); apt sin silenciar errores; el filtro de `autorizar` ejecutado con jq (push frente a aviso de la web).
- `tests/web-unit/subida-estado.test.mjs`: con `sendOpus` y un `fetch` simulado que retiene cada respuesta, el siguiente se convierte mientras se envía el anterior; nunca más de dos peticiones a la vez; un convertido esperando y el cuarto sin convertir; trozos en orden por subida; UUID v7 en orden de cola aunque terminen desordenadas; un 500 que para la cola; y `orderedUploadIds`. Sin esperas fijas: `idle()` y una espera a cada cambio de estado.
- `tests/web-unit/api-subir.test.mjs`: dos subidas v7 intercaladas y en paralelo.
- `mobile/test/shared_upload_test.dart`: lo mismo en la APK con un `MockClient` que retiene cada respuesta; en serie con `maxParallelSends: 1`; pérdida de red determinista; `OrderedUploadIds` con los mismos casos que la web.
- `tests/web-e2e/funcional.e2e.mjs`: la subida de dos archivos comprueba UUID v7 y el orden por id.

## Qué no se ha verificado

- Nada de esto se ha ejecutado en GitHub Actions ni contra R2: el sparse-checkout de `actions/checkout` v7, `apt-get install --print-uris` sin `sudo` en el runner, el formato de su hash (se aceptan SHA256 y SHA512), la caché de `actions/cache` v6.1.0 y los tiempos reales; el `LastModified` del listado de R2 (se espera ISO 8601 en UTC, como S3).
- Dos envíos a la vez desde un teléfono real y desde Vercel en producción.
