# ADR-0010: Procesado y publicación separados en la biblioteca

- Estado: aceptada
- Fecha: 2026-11-02
- Completa: ADR-0008 (decisiones 4 y 5, y el control de ejecución y de salida).

## Contexto

En la primera versión de ADR-0008, un único job de `biblioteca.yml` descargaba ficheros de Internet Archive, los convertía con ffmpeg y, en el mismo job, ejecutaba código del árbol de trabajo y hacía el push a `main` con el `GITHUB_TOKEN`. La revisión de seguridad de 2026-11-02 lo señaló: un procesado comprometido (un fallo de ffmpeg con un fichero manipulado, por ejemplo) podía alterar código que luego se ejecutaba con el token, y nada comprobaba qué rutas se publicaban. La web se despliega desde `main` (ADR-0006), así que lo que entra en `main` se publica.

## Decisión

1. **Dos jobs.** `procesar` ejecuta la petición (`scripts/issue_request.py` y `scripts/ci_library.py`) y empaqueta lo que cambió (`scripts/empaquetar_cambios.py`). Tiene `contents: read`, no recibe `GITHUB_TOKEN` y su checkout no guarda credenciales. Sube un artefacto `biblioteca-paquete` con el manifiesto y los ficheros cambiados.
2. **`publicar`** (`needs: procesar`) descarga el artefacto y lo valida con `backend/sonidos/paquete.py` antes de tocar el repositorio:
   - el manifiesto tiene la forma exacta y su `base` es el HEAD de `main`; si `main` cambió, la petición se rechaza y se reenvía;
   - cada ruta está en la lista cerrada de la biblioteca: `audio-library/indexes/catalog.json` y un fichero directo en `audio-library/audio/`, `frontend/web/audio/` o `frontend/web/data/`;
   - cada fichero es regular: sin enlaces simbólicos, sin carpetas enlazadas y sin ficheros que no estén en el manifiesto;
   - tras aplicar, el índice de git solo contiene esas rutas, con modos de fichero regular.

   Solo después confirma, sube a `main` y responde a la incidencia. Este job no ejecuta ffmpeg ni código del paquete: el código que ejecuta (`scripts/aplicar_paquete.py`, `scripts/responder_incidencia.py`) viene del checkout de `main`.
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
- **Riesgo residual:** la validación comprueba rutas y tipos de fichero, no el contenido. Un procesado comprometido podría escribir contenido indebido en las rutas permitidas (el catálogo, el audio o los datos de la web). Lo que limita el daño es que el procesado no tiene token y que la web trata esos datos como texto (ADR-0008).

## Qué se verificó

- Pruebas: `backend/tests/test_paquete.py` (57 casos, con git real en un repositorio temporal) y la estructura del workflow en `backend/tests/test_biblioteca_workflow.py`.
- Simulación local con un remoto bare, sin GitHub: procesado de la creación de una carpeta, validación, aplicación, confirmación y push; y rechazos de base distinta de `main`, de cambio rastreado fuera de la biblioteca y de enlace simbólico.

**No verificado:** la ejecución real en GitHub Actions: el paso del artefacto entre jobs, la cola `queue: max` y los permisos efectivos. Hay que probarlo con una incidencia de prueba y con `workflow_dispatch` antes de darlo por cerrado, como indica ADR-0008.
