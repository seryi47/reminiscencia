# ADR-0024: Todo el audio en un bucket privado de R2; Git solo guarda el catálogo

- Estado: aceptada (2026-11-05), en dos partes que se despliegan por orden (ver «Despliegue»). Sin verificar todavía en vivo.
- Fecha: 2026-11-05
- Modifica: [ADR-0017](ADR-0017-subida-directa-github-web-publica.md) (los trozos de `/api/subir` ya no van a `main`), [ADR-0020](ADR-0020-audio-en-r2.md) (el audio público ya no se toma de `audio-library/audio/`), [ADR-0011](ADR-0011-publicar-regenera-parte-publica.md), decisión 6 (la parada por falta de audio pasa a `sync_r2.py`), y [ADR-0003](ADR-0003-almacenamiento-audio-github.md) y [ADR-0007](ADR-0007-catalogo-y-flujo-desde-vercel.md) en lo que dicen de versionar el audio en Git.
- Relacionadas: [ADR-0010](ADR-0010-procesado-y-publicacion-separados.md) (procesado sin secretos), [ADR-0014](ADR-0014-buzon-de-canciones.md) (buzón) y [ADR-0025](ADR-0025-publicar-robusto.md) (publicar aunque main avance).

## Contexto

- El audio de todas las canciones (también el de las privadas) estaba en Git, en `audio-library/audio/` (unos 480 MB y 287 ficheros el 2026-11-05). GitHub recomienda repositorios de menos de 1 GB y el repositorio solo crece: cada canción nueva añade su Opus al historial para siempre.
- `/api/subir` guardaba cada trozo de una subida de la web o la APK con un commit en `main` (`audio-library/buzon/.partes/<UUID>/`). Esos trozos ensucian el historial para siempre (la misma canción, otra vez, en trozos) y provocaban los choques de «main cambió mientras se procesaba la petición» (ADR-0025).
- Desde ADR-0020 el audio público ya lo sirve un bucket público de R2 (`reminiscencia-audio`), que no cobra la salida de datos.

## Decisión

1. **Bucket privado** (`R2_PRIVATE_BUCKET`, por ejemplo `reminiscencia-audio-privado`, sin acceso público ni dominio). Es la fuente de verdad de todo el audio, en `audio/<id>.opus` (mismas claves, tipo `audio/ogg; codecs=opus` y caché que en el público). El bucket público sigue con solo las canciones públicas.
2. **Subidas de la web y la APK fuera de Git** (`frontend/web/api/subir.js`). El contrato de `POST /api/subir` no cambia (la web y la APK no se tocan). Cada trozo va a `entrada/<UUID>/<índice>.part` del bucket privado con `PUT` e `If-None-Match: *` (nunca sobrescribe; R2 lo admite: «Conditional Operations» en la página de compatibilidad S3 de Cloudflare, consultada el 2026-11-05), en orden (un trozo solo entra si están los anteriores; uno repetido igual se da por bueno y uno distinto, 409). Con el último se escribe `entrada/<UUID>/manifiesto.json` (`{"nombre", "partes"}` y, si llegan, `album` y `artist`, como antes) y se lanza `buzon.yml` con un `repository_dispatch` de tipo `subida-web` y `client_payload: {"id": "<UUID>"}`, con el `GITHUB_TOKEN` que ya tenía Vercel (este punto de la API pide «Contents: write» en un token de grano fino, el mismo permiso que ya tenía; docs.github.com, «Permissions required for fine-grained personal access tokens», consultado el 2026-11-05). Si el aviso falla, se responde 502: la web y la APK reintentan el último trozo, que ya está guardado, y solo se repite el aviso. La firma SigV4 es propia (`node:crypto`), igual que la de Python (`sign_v4`): las dos se comprueban con los mismos vectores (`tests/fixtures/sigv4-vectores.json`, que incluyen el ejemplo oficial de AWS). Variables nuevas en Vercel: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` y `R2_PRIVATE_BUCKET`.
3. **`buzon.yml`: job nuevo `recoger`** entre `autorizar` y `procesar`. Con las credenciales de R2 (los mismos secretos que `publicar`) y sin token de GitHub ni instalar nada, baja del bucket privado las subidas completas (`entrada/<UUID>/` con manifiesto; como mucho 50 o 2 GiB por ejecución, y nunca una de más de 100 MiB, que el buzón rechazaría) y las deja en el artefacto `buzon-entrada` (`scripts/entrada_r2.py recoger`, `sonidos.entrada`). Solo lee. Se salta en un push de la página de GitHub: así una subida de la web queda siempre a nombre de la cuenta del token, como antes. `procesar` sigue sin secretos: descarga el artefacto y `scripts/buzon.py --entrada` une las subidas igual que las de `.partes/` (mismas validaciones del manifiesto y de las partes), con la licencia fija de la web (`WEB_LICENSE`, la misma que antes llegaba en el mensaje del commit). En un `repository_dispatch` no se mira el buzón de `main`: lo que alguien subiera por la página de GitHub espera a su propio run, con la licencia de su commit. Lo que no se puede unir se rechaza (no queda «para revisar»). `publicar`, después de subir a `main`, borra `entrada/<UUID>/` de lo recogido (`scripts/entrada_r2.py limpiar`, solo UUID, sin el token de GitHub). El código de `.partes/` se mantiene para las subidas que quedaran a medias en `main` al desplegar.
4. **`publicar` sincroniza los dos buckets** (`scripts/sync_r2.py --aplicar --borrar-sobrantes`, `sonidos.r2.plan_publication` y `apply_publication`), antes de subir a `main`:
   - sube al privado el audio de `audio-library/audio/` de la copia de trabajo que no tenga (con el audio fuera de Git, solo el que acaba de traer el paquete);
   - copia al público el de las canciones de `data/songs.json` que le falte, desde la copia local o, si no está, desde el privado (`GetObject` y `PutObject`: la documentación de R2 admite `CopyObject` con `x-amz-copy-source`, pero no dice que el origen pueda estar en otro bucket, así que no se usa);
   - borra del público el de las despublicadas (nunca lo vacía);
   - si una canción pública no tiene audio ni en local ni en ningún bucket, se detiene antes de escribir nada y no se sube nada a `main` (antes lo hacía `sync_public`, que ya no mira el audio);
   - avisa (sin fallar) de las canciones del catálogo sin audio en el privado. Nunca borra del privado.

   `r2.yml` (repaso) hace lo mismo sin borrar. Las credenciales de R2 solo llegan a esos pasos, que no tienen el token de GitHub ni instalan nada. Un solo token de R2 sirve para los dos buckets.
5. **El paquete y el audio ignorado.** `sonidos.paquete` empaqueta también el audio nuevo que `.gitignore` excluye (`git status --ignored` solo en `audio-library/audio/`) y, al aplicarlo en `publicar`, lo deja en la copia de trabajo sin añadirlo al índice (`git check-ignore`). Así el mismo código vale con el audio en Git (parte 1) y fuera (parte 2).
6. **Pruebas sin audio real.** El catálogo de prueba de las pruebas de extremo a extremo usa `tests/fixtures/tono-prueba.opus` (10 s de un tono, 16 KB, generado con ffmpeg) en lugar del audio de `audio-library/audio/`.

## Despliegue (dos partes)

- **Parte 1** (rama `feature/pipeline-audio-privado`): todo lo anterior, con el audio todavía en Git. Añade el workflow manual `migrar-audio-privado.yml` (solo `workflow_dispatch` desde `main`): sube todo `audio-library/audio/` al bucket privado (`scripts/migrar_audio_privado.py --aplicar`), vuelve a listarlo y comprueba que cada fichero está con el mismo tamaño y que cada canción del catálogo tiene su audio. No borra nada. Mientras el audio siga en Git, cada `publicar` también sube al privado lo que le falte, así que la migración es idempotente y se puede repetir.
- **Parte 2** (rama `feature/audio-fuera-de-git`, encima de la parte 1): `git rm -r --cached audio-library/audio`, la carpeta en `.gitignore` y fuera lo que ya no hace falta. **El historial no encoge**: el audio sigue en los commits antiguos; no se reescribe la historia. Lo que se gana es que el repositorio deja de crecer con cada canción.
- Orden: crear el bucket privado y los secretos → fusionar la parte 1 → lanzar `migrar-audio-privado` y comprobar que termina en verde → fusionar la parte 2.

## Seguridad

- `procesar` sigue sin secretos ni token. `recoger` tiene credenciales de R2 pero solo ejecuta código de `main` con la biblioteca estándar, sin ffmpeg ni nada de lo subido; descarga bytes y comprueba nombres y tamaños; no interpreta el contenido. El contenido lo valida `procesar` (manifiesto, nombres, ffprobe y ffmpeg) como antes.
- El token de R2 de Vercel puede leer el bucket privado entero (R2 no limita un token a un prefijo), también el audio de las canciones privadas. Se recomienda un token propio para Vercel, con «Object Read & Write» solo en el bucket privado, distinto del de GitHub (que necesita los dos buckets).
- La función nunca escribe fuera de `entrada/<UUID>/` ni sobrescribe, y no escribe las claves en los registros ni en las respuestas (solo el estado HTTP).

## Alternativas descartadas

- **Seguir con el audio en Git y Git LFS.** La cuota gratuita de LFS es pequeña y el repositorio público lo descargaría igual.
- **Que `procesar` lea del bucket con credenciales.** Rompe ADR-0010: el job que ejecuta ffmpeg sobre archivos de cualquiera no debe tener secretos.
- **`workflow_dispatch` en lugar de `repository_dispatch`.** Pide «Actions: write» al token de Vercel; `repository_dispatch` se conforma con el permiso que ya tiene.
- **Reescribir la historia para quitar el audio antiguo.** Rompe los clones y los enlaces a commits; queda fuera de este cambio.

## Consecuencias

- El repositorio deja de crecer con el audio (parte 2) y con los trozos de las subidas (parte 1).
- Hacer una copia completa de la biblioteca ya no es clonar el repositorio: el audio está en el bucket privado (hay que copiarlo con las credenciales de R2).
- Una canción privada que se publica después se copia del privado al público en el `publicar` que la publica.
- Una subida de la web se queda en el bucket hasta que un run la recoge. Si el aviso a GitHub se perdiera, la recoge el siguiente run que llegue por `repository_dispatch` o a mano.

## Cómo se prueba

- `backend/tests/test_r2.py`: plan de publicación con los dos buckets (privado primero, público desde local o desde el privado, borrados, nunca vaciar, parada por audio que falta sin escribir nada), cliente S3 (`GetObject`, prefijo), firma con los vectores comunes, `sync_r2.py` y `migrar_audio_privado.py` con buckets en memoria.
- `backend/tests/test_entrada.py`: recoger (solo completas, límites, solo lee), limpiar (solo dentro de `entrada/<UUID>/`), el script con `GITHUB_OUTPUT`, y el buzón uniendo lo recogido con ffmpeg y git reales (pública con la licencia de la web, nada en Git, no toca el buzón de `main` en un `repository_dispatch`, rechazos).
- `backend/tests/test_paquete.py`: el audio ignorado se empaqueta y se aplica sin entrar en el índice.
- `backend/tests/test_buzon_workflow.py` y `test_r2_workflow.py`: estructura de `recoger`, credenciales solo en los pasos de R2, migración manual desde `main` y sin borrar.
- `tests/web-unit/api-subir.test.mjs`: la función con R2 y GitHub simulados (la firma de cada petición simulada se comprueba), orden, no sobrescribir, carrera con `If-None-Match`, aviso y reintento, configuración y claves fuera de respuestas y registros, y los vectores de firma comunes con Python.

## Qué no se ha verificado en vivo

- Nada de esto se ha ejecutado contra Cloudflare R2 ni GitHub de verdad: el `PUT` con `If-None-Match: *` y su 412, el listado con prefijo desde Vercel, el `repository_dispatch` con el token de Vercel, `recoger` y `limpiar` en Actions, la migración (tiempo y tamaños reales) y la copia del privado al público.
- Que Vercel admita el cuerpo `Uint8Array` en el `fetch` de salida hacia R2 (Node 18+ lo admite).
