# ADR-0010: Procesado y publicación separados en la biblioteca

- Estado: aceptada
- Fecha: 2026-11-02
- Completa: ADR-0008 (decisiones 4 y 5, y el control de ejecución y de salida).

## Contexto

En la primera versión de ADR-0008, un único job de `biblioteca.yml` descargaba ficheros de Internet Archive, los convertía con ffmpeg y, en el mismo job, ejecutaba código del árbol de trabajo y hacía el push a `main` con el `GITHUB_TOKEN`. La revisión de seguridad de 2026-11-02 lo señaló: un procesado comprometido (un fallo de ffmpeg con un fichero manipulado, por ejemplo) podía alterar código que luego se ejecutaba con el token, y nada comprobaba qué rutas se publicaban. La web se despliega desde `main` (ADR-0006), así que lo que entra en `main` se publica.

## Decisión

1. **Dos jobs.** `procesar` ejecuta la petición (`scripts/issue_request.py` y `scripts/ci_library.py`) y empaqueta lo que cambió en la biblioteca, sin la parte pública (`scripts/empaquetar_cambios.py`; ver la nota de 2026-11-02). Tiene `contents: read`, no recibe `GITHUB_TOKEN` y su checkout no guarda credenciales. Sube un artefacto `biblioteca-paquete` con el manifiesto y los ficheros cambiados.
2. **`publicar`** (`needs: procesar`) descarga el artefacto y lo valida con `backend/sonidos/paquete.py` antes de tocar el repositorio:
   - el manifiesto tiene la forma exacta y su `base` es el HEAD de `main`; si `main` cambió, la petición se rechaza y se reenvía;
   - cada ruta está en la lista cerrada de la biblioteca: `audio-library/indexes/catalog.json` y un fichero directo en `audio-library/audio/`, `frontend/web/audio/` o `frontend/web/data/`;
   - cada fichero es regular: sin enlaces simbólicos, sin carpetas enlazadas y sin ficheros que no estén en el manifiesto;
   - tras aplicar, el índice de git solo contiene esas rutas, con modos de fichero regular.

   Solo después regenera la parte pública desde el catálogo, confirma, sube a `main` y responde a la incidencia. Este job no ejecuta ffmpeg ni código del paquete: el código que ejecuta (`scripts/aplicar_paquete.py`, `scripts/responder_incidencia.py`) viene del checkout de `main`.
3. **Guardas en los dos jobs:** condición de propietario y etiqueta; guarda de rama al inicio del procesado, antes de instalar nada que ejecute código del árbol, y otra antes del push; `persist-credentials: false` en los checkouts. La concurrencia `library-catalog` con `queue: max` va a nivel de workflow, de modo que cubre los dos jobs como una sola escritura.
4. **Acciones fijadas por SHA** en el workflow de la biblioteca, con la versión en un comentario, y todas con runtime node24.

## Alternativas descartadas

- **Un solo job con más comprobaciones.** El token seguiría en el mismo entorno que el código que ejecuta ffmpeg.
- **El token solo en un paso del mismo job.** El código del árbol (la instalación del backend y los scripts) se ejecuta en el mismo job antes y después del procesado; limitar el token a un paso no lo aísla.
- **Publicar un parche (`git diff`) en lugar de ficheros.** Se descartó: validar los ficheros completos uno a uno es más fácil de auditar, y la comprobación de base evita sobrescribir cambios ajenos.

## Consecuencias

- Si alguien sube a `main` entre el procesado y la publicación, la petición se rechaza sin tocar el repositorio y el propietario la reenvía.
- Un fichero sin rastrear fuera de la biblioteca (una carpeta de compilación, una caché) no se publica ni bloquea la ejecución. Un cambio rastreado fuera de la biblioteca sí bloquea el procesado.
- El paquete viaja como artefacto de GitHub con retención de un día.
- **Riesgo residual:** la validación comprueba rutas y tipos de fichero, no el contenido. Un procesado comprometido podría escribir contenido indebido en el catálogo o en el audio, que son las fuentes de la parte pública; los datos de la web ya no se aceptan del paquete (ver la nota de 2026-11-02). Lo que limita el daño es que el procesado no tiene token y que la web trata esos datos como texto (ADR-0008).

## Nota de 2026-11-02: la parte pública la regenera `publicar`

La revisión de seguridad dejó un hueco que la decisión anterior no cubría. `procesar` generaba `frontend/web/data/*.json` y el audio publicado, los empaquetaba, y `publicar` los validaba por ruta y tipo, pero los aplicaba tal cual. Un paquete con un `songs.json` forjado (un título con HTML, por ejemplo) llegaba a `main` y, con él, a la web.

Decisiones:

- **El paquete ya no lleva la parte pública.** `procesar` empaqueta con `package_processing_changes` (`backend/sonidos/paquete.py`): solo el catálogo y el audio de `audio-library/`. Se eligió la opción de menor superficie que pasa las pruebas existentes. La parte pública sale del catálogo y del audio, así que el paquete no necesita transportarla; además, el artefacto dejaba de duplicar el audio público. Las pruebas que fijan el paquete completo siguen llamando a `package_changes`, cuyo comportamiento por defecto no cambia.
- **`publicar` regenera.** `publish_package` aplica el paquete y, después, ejecuta `sonidos.publish.sync_public` sobre el catálogo y el audio aplicados. Lo que cambia se añade al índice junto con el paquete. Lo que se publica de la parte pública depende solo de `audio-library/indexes/catalog.json`, de `audio-library/audio/` y del código de `main` que la genera.
- **Qué queda visible en el registro del job.** El resultado separa dos listas. `regenerados` son los ficheros de la parte pública que la regeneración escribió y el paquete no traía; se anotan con `::notice` y, en el caso normal, son los que cambian con la petición. `sustituidos_del_paquete` son los que el paquete traía y la regeneración ha reemplazado; son la señal de un paquete forjado o desfasado, y se anotan con `::warning`. La publicación no falla por ello: se publica lo que dice el catálogo.
- **Comparación de contenido en `sync_public`.** Antes, un audio público ya copiado se daba por bueno con el mismo tamaño. Ahora se compara el contenido, así que un audio forjado del mismo tamaño se sustituye.
- **Identificadores con formato fijo.** `sync_public` rechaza una canción pública cuyo `id` no tenga la forma `S` seguida de 16 hexadecimales. El `id` da nombre al fichero, y con un `../` la copia saldría de la carpeta de audio. Esto apareció al revisar la regeneración, cuando `publicar` empezó a procesar el catálogo del paquete; tiene prueba propia.
- **Paradas antes de confirmar.** Sin `catalog.json`, `sync_public` tomaría el catálogo por vacío y vaciaría la parte pública; por eso `publicar` lo rechaza antes. Una canción pública sin su audio detiene la publicación, y lo mismo un catálogo que no se puede regenerar (una canción pública sin título, por ejemplo).
- **La validación no se amplía.** `ruta_permitida` sigue admitiendo los datos de la web y el audio publicado, porque las pruebas actuales lo exigen. Lo que impide que algo forjado llegue a `main` es la regeneración.

Pruebas: 472 en `backend/` (`python -m pytest -q`). Las nuevas de esta decisión son 6 en `test_paquete.py` (63 en total), 3 en `test_aplicar_paquete.py` (que ejecutan el script tal como lo ejecuta el job, con git real), 2 en `test_publish.py` (7 en total) y 2 en `test_biblioteca_workflow.py` (27 en total). Simulación local sin GitHub, con un remoto bare: un procesado que importa y publica una canción, `publicar` sobre un checkout limpio de `main`, y la comparación: los cinco ficheros públicos confirmados son idénticos a los que produjo el procesado.

**Riesgo residual actualizado:** el procesado sigue pudiendo alterar el catálogo y el audio. El contenido del audio no se valida, y el catálogo se toma como fuente. Las cadenas del catálogo llegan a la web como texto (ADR-0008). Lo que cambia es que el procesado ya no escribe los datos de la web directamente: solo puede influir en ellos a través del catálogo, por ejemplo con títulos y etiquetas, que llegan a `songs.json` y a `catalog.json`.

**No verificado:** la ejecución real en GitHub Actions de esta versión (el paso del artefacto, `queue: max` y los permisos efectivos). Igual que antes, hay que probarlo con una incidencia de prueba antes de darlo por cerrado.

## Qué se verificó

- Pruebas: `backend/tests/test_paquete.py` (63 casos, con git real en un repositorio temporal) y la estructura del workflow en `backend/tests/test_biblioteca_workflow.py`.
- Simulación local con un remoto bare, sin GitHub: procesado de la creación de una carpeta, validación, aplicación, confirmación y push; y rechazos de base distinta de `main`, de cambio rastreado fuera de la biblioteca y de enlace simbólico.

**No verificado:** la ejecución real en GitHub Actions: el paso del artefacto entre jobs, la cola `queue: max` y los permisos efectivos. Hay que probarlo con una incidencia de prueba y con `workflow_dispatch` antes de darlo por cerrado, como indica ADR-0008.
