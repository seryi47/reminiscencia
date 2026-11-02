# ADR-0011: Publicar regenera la parte pública desde el catálogo

- Estado: aceptada
- Fecha: 2026-11-02
- Completa: ADR-0010. Su nota de 2026-11-02 queda sustituida por este documento.
- Relacionadas: ADR-0006 (audio publicado en la web), ADR-0007 (catálogo como fuente de verdad) y ADR-0008 (entrada por incidencias).

## Contexto

`procesar` generaba `frontend/web/data/*.json` y el audio publicado, los empaquetaba, y `publicar` los validaba por ruta y tipo de fichero y los aplicaba tal cual (ADR-0010). La validación no mira el contenido: un paquete con un `songs.json` forjado, por ejemplo con un título que lleve HTML, llegaba a `main` y, con él, a la web.

## Decisión

1. **El paquete del procesado ya no lleva la parte pública.** Esa parte son `frontend/web/data/songs.json`, `folders.json` y `catalog.json`, y los `frontend/web/audio/*.opus`. `package_processing_changes` (`backend/sonidos/paquete.py`) empaqueta solo el catálogo y el audio de `audio-library/`. Las pruebas que fijan el paquete completo siguen llamando a `package_changes`, cuyo comportamiento por defecto no cambia.
2. **`publicar` regenera la parte pública.** `publish_package` aplica el paquete y, después, ejecuta `sonidos.publish.sync_public` sobre el catálogo y el audio aplicados. Lo que la regeneración escribe se añade al índice junto con el paquete. La parte pública depende solo de `audio-library/indexes/catalog.json`, de `audio-library/audio/` y del código de `main` que la genera.
3. **Avisos sin fallar.** `scripts/aplicar_paquete.py` anota en el registro del job dos listas:
   - `regenerados`: ficheros de la parte pública que la regeneración escribió y el paquete no traía. Se anotan como aviso (`::notice`). En el caso normal, son los que cambian con la petición.
   - `sustituidos_del_paquete`: ficheros que el paquete traía y la regeneración ha reemplazado. Se anotan como alarma (`::warning`) y son la señal de un paquete forjado o desfasado.

   La publicación no falla por ninguna de las dos: se publica lo que dice el catálogo.
4. **Comparación por contenido.** `sync_public` compara por contenido el audio público que ya está copiado (`filecmp`, sin atajos por tamaño). Un audio de otro contenido y el mismo tamaño se vuelve a copiar.
5. **Identificador con formato fijo.** `sync_public` rechaza una canción pública cuyo `id` no tenga la forma `S` seguida de 16 hexadecimales (`S[0-9a-f]{16}`). El `id` da nombre al fichero de audio; con un `../` la copia saldría de la carpeta de audio.
6. **Paradas antes de confirmar.** Si falta `catalog.json` en `main`, `publicar` se detiene, porque `sync_public` tomaría el catálogo por vacío y vaciaría la parte pública. Lo mismo ocurre si una canción pública no tiene su audio, o si el catálogo no se puede regenerar (una canción pública sin título, por ejemplo). En esos casos el script imprime el error y sale con código 1, y el workflow no confirma nada.
7. **La validación no se amplía.** `ruta_permitida` sigue admitiendo los datos de la web y el audio publicado, porque las pruebas actuales lo exigen. Lo que impide que un dato forjado llegue a `main` es la regeneración.

## Consecuencias

- El paquete del procesado es más pequeño y ya no duplica el audio público. `procesar` sigue ejecutando `sync_public` en su copia de trabajo (`scripts/ci_library.py`) para incluir el resultado en la respuesta a la incidencia, pero no empaqueta lo que genera.
- La forma de la parte pública depende del código de `main`: un cambio en `sync_public` cambia lo que se publica.
- Un procesado comprometido sigue pudiendo alterar el catálogo y el audio, que son las fuentes. Lo que cambia es que ya no escribe `songs.json` ni `catalog.json` directamente: esos datos salen de la regeneración. Las cadenas del catálogo (títulos y etiquetas) llegan a la web como texto (ADR-0008), y el contenido del audio no se valida (ADR-0010).
- Una alarma (`sustituidos_del_paquete`) señala un paquete forjado o desfasado. No bloquea la publicación, pero conviene revisarla.

## Cómo se prueba

- Suite de `backend/` con `python -m pytest -q`: 472 pruebas en verde (comprobado el 2-nov-2026).
- Por archivo:
  - `backend/tests/test_paquete.py` (63 casos).
  - `backend/tests/test_aplicar_paquete.py` (3). Ejecutan el script tal como lo ejecuta el job, con git real: un `songs.json` forjado no llega a `main`, se avisa de lo que la regeneración añade y se detiene si falta el audio de una canción pública.
  - `backend/tests/test_publish.py` (7), con la comparación por contenido y el rechazo de identificadores fuera del formato.
  - `backend/tests/test_biblioteca_workflow.py` (27), que revisa la estructura del workflow.
- Simulación local del 2-nov-2026, sin GitHub y con un remoto bare, registrada en la nota original de ADR-0010: un procesado importa y publica una canción; `publicar` la aplica sobre un checkout limpio de `main`; los ficheros públicos resultantes son idénticos a los que produjo el procesado.
- **No verificado:** la ejecución real en GitHub Actions de esta versión: el paso del artefacto entre jobs, `queue: max` y los permisos efectivos. Hay que probarla con una incidencia de prueba o con `workflow_dispatch` antes de darla por cerrada, como indica ADR-0008.
