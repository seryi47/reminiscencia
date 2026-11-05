# ADR-0025: Publicar aunque main avance si no toca la biblioteca

- Estado: aceptada (2026-11-05). Pendiente de verificar en GitHub Actions (ver «Qué no se ha verificado»).
- Fecha: 2026-11-05
- Modifica: [ADR-0010](ADR-0010-procesado-y-publicacion-separados.md), decisión 2 («su `base` es el HEAD de `main`; si `main` cambió, la petición se rechaza»), y la consecuencia de [ADR-0014](ADR-0014-buzon-de-canciones.md) sobre relanzar cuando `main` cambia.
- Relacionadas: [ADR-0011](ADR-0011-publicar-regenera-parte-publica.md) (publicar regenera la parte pública), [ADR-0017](ADR-0017-subida-directa-github-web-publica.md) (subida por trozos) y [ADR-0024](ADR-0024-audio-privado-en-r2.md) (los trozos salen de Git).

## Contexto

`publicar` rechazaba el paquete si su `base` (el HEAD de `main` cuando empezó `procesar`) no era el HEAD de `main` al publicar. Era correcto pero demasiado estricto: cualquier commit ajeno entre el procesado y la publicación tiraba la petición, aunque no tuviera nada que ver con la biblioteca. El caso real: `/api/subir` hacía un commit en `main` por cada trozo de una subida (`audio-library/buzon/.partes/<UUID>/`), así que con dos subidas seguidas desde la web la publicación de la primera fallaba casi siempre («main cambió mientras se procesaba la petición»), y había que relanzar el run. Lo mismo pasaba en el `git push` final si `main` avanzaba entre la validación y la subida (rechazo por no ser *fast-forward*).

Evidencia recogida en GitHub Actions hasta el 2026-11-05 (revisión de CI del mismo día): 21 ejecuciones de `buzon` (por ejemplo, la 42092655183) y 7 de `biblioteca` fallaron con «main cambió mientras se procesaba la petición», y 2 con el `git push` rechazado (41835170335 y 41834957251). La cola `library-catalog` llegó a tener 74 ejecuciones en espera (`queue: max` admite 100), así que cada ejecución tirada y relanzada alargaba la cola de todas las demás.

## Decisión

1. **Base antecesora compatible** (`sonidos.paquete.check_base`, llamada desde `read_manifest` con el repositorio). Si la `base` del paquete no es el HEAD de `main`, el paquete sigue valiendo y se aplica sobre el HEAD cuando:
   - la base es un antecesor de `main` (`git merge-base --is-ancestor base HEAD`), y
   - ninguna ruta cambiada en `base..HEAD` (`git diff --name-only --no-renames`) es una ruta del paquete ni algo que la publicación lee o regenera (`ruta_de_publicacion`): `audio-library/indexes/catalog.json` y cualquier cosa bajo `audio-library/audio/`, `audio-library/covers/`, `frontend/web/audio/`, `frontend/web/data/` o `frontend/web/covers/`.

   Si no, el error es claro: «main cambió mientras se procesaba la petición; hay que reenviarla», con el motivo (la base ya no está en el historial de `main`, no está en la copia, o el cambio toca `<ruta>`). Sin el repositorio (`repo=None`) el comportamiento es el de antes: base distinta, error.
2. **Historial en `publicar`.** El checkout de `publicar` (los dos workflows) usa `fetch-depth: 0` y `filter: blob:none`: todos los commits y árboles, sin el contenido de los ficheros antiguos. Es lo que necesitan `merge-base` y `diff --name-only`, que solo leen commits y árboles. Ningún paso necesita el contenido de ficheros antiguos: el rebase del paso final solo se hace cuando lo nuevo de `main` y el commit no comparten rutas, así que se resuelve con los árboles, y los commits nuevos de `main` se traen completos con el token en ese mismo paso. Por eso no importa que el repositorio sea privado (sin credenciales guardadas, una descarga diferida de `origin` fallaría). Probado con un clon parcial en `test_publicar_push.py`.
3. **Subida a `main` con reintento** (paso «Subir a main» de `buzon.yml` y `biblioteca.yml`). Si `git push` se rechaza, el paso trae `main` (`git fetch` con la misma URL con token), y solo rebasa y reintenta si:
   - `main` no ha sido reescrito (`BASE` es antecesor de lo traído) y ha cambiado;
   - lo nuevo de `main` no toca ninguna ruta del commit de la publicación ni las rutas de la decisión 1 (la misma expresión, `PUBLICACION`, comprobada contra `ruta_de_publicacion` en `test_buzon_workflow.py`);
   - `git rebase` no choca (si choca, `git rebase --abort`).

   Hasta tres reintentos. Si algo falla, el paso termina con un mensaje claro y no sube nada. El token sigue sin salir de ese paso: el paso solo ejecuta git, sin Python ni otros programas del árbol.
4. **Lo que no cambia.** Las rutas permitidas del paquete, la regeneración de la parte pública (ADR-0011), la comprobación del índice y que `publicar` no ejecute código del procesado.

## Por qué es seguro

El paquete trae ficheros completos (el catálogo entero, el audio entero), no parches. Aplicarlos sobre un `main` más nuevo solo es correcto si nada de lo que traen ni nada de lo que la publicación lee o regenera ha cambiado desde la base: eso es exactamente lo que se comprueba. Un cambio en el código (por ejemplo `publish.py`) no invalida el paquete, porque `publicar` ya ejecuta el código de `main` al regenerar. Para el rebase del paso final vale el mismo argumento: lo nuevo de `main` no toca ni el catálogo, ni el audio, ni la parte pública, ni las rutas del commit, así que la parte pública regenerada sigue siendo la que corresponde al catálogo.

## Alternativas descartadas

- **Rehacer el procesado sobre el `main` nuevo.** Volvería a ejecutar ffmpeg y el código del procesado; además, `publicar` no debe ejecutar nada del procesado (ADR-0010).
- **Fusión de tres vías del catálogo.** Más permisiva, pero el catálogo se reescribe entero y una fusión automática de JSON es frágil; un cambio concurrente del catálogo es raro y basta con relanzar.
- **`git push --force`.** Borraría el trabajo ajeno.

## Consecuencias

- Un commit en `main` que no toca la biblioteca (código, documentación, otra subida al buzón por la página de GitHub, trozos antiguos de `.partes/`) ya no tumba una publicación en curso.
- Un cambio del catálogo, del audio, de las portadas o de la parte pública entre medias sigue obligando a relanzar (o a reenviar la petición).
- Con [ADR-0024](ADR-0024-audio-privado-en-r2.md), `/api/subir` deja de escribir en `main`, así que el caso real casi desaparece; esta decisión cubre el resto (pushes de personas, otros workflows).

## Cómo se prueba

- `backend/tests/test_paquete.py`: con git real, un commit que solo toca `audio-library/buzon/.partes/` entre procesar y publicar ya no rompe (el paquete se aplica sobre el HEAD nuevo y el commit ajeno sigue); uno que toca el catálogo, el audio, las portadas o la parte pública sí; uno que toca una ruta del paquete, también; base que no es antecesora o que no está en la copia, error claro; `ruta_de_publicacion`.
- `backend/tests/test_aplicar_paquete.py`: el script del job, con el caso real (`BASE` queda con el HEAD nuevo) y con un cambio del catálogo (error).
- `backend/tests/test_publicar_push.py`: el bloque `run:` del paso «Subir a main» de los dos workflows se ejecuta con bash contra un remoto git local: sube directo si `main` no se movió; rebasa y sube si entre medias llegó un commit que solo añade trozos; no sube nada si lo nuevo toca el catálogo, la parte pública, el audio o una ruta del propio commit, ni si `main` se reescribió.
- `backend/tests/test_buzon_workflow.py`: checkout con historial, reintento con rebase, misma expresión de rutas que `ruta_de_publicacion`, el token solo en ese paso.

## Qué no se ha verificado

- En GitHub Actions: el checkout con `filter: blob:none` y `fetch-depth: 0` de `actions/checkout` v7, y un rechazo real del push resuelto con el rebase. Hay que mirarlo en la primera ejecución en la que coincidan dos escrituras.
