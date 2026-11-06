# ADR-0026: Álbumes con orden de pistas, selección múltiple y aviso de posibles duplicados

- Estado: aceptada (rama `feature/albumes-avanzado`, 2026-11-05; pendiente de fusionar en main).
- Fecha: 2026-11-05.
- Relacionadas: ADR-0008 (peticiones por incidencias), ADR-0014 (buzón), ADR-0016 (álbumes), ADR-0017 (subida para todos), ADR-0022 (editar sin GitHub) y ADR-0023 (`move_songs`, «Quitar de este álbum» y «Añadir canciones»).

## Contexto

- Un álbum enseña sus canciones en el orden de `data/songs.json`, que es alfabético por título. No había forma de dar el orden del disco.
- Sacar o mover varias canciones de un álbum obligaba a hacerlo de una en una. Cada petición es una incidencia y una ejecución de `biblioteca.yml`, y las ejecuciones en cola fallan si `main` cambia por el medio (ADR-0023).
- Solo se detectaban los ficheros idénticos (misma huella SHA-256). La misma canción en otro fichero entraba dos veces. Pasa a menudo con lo que llega de YouTube: «Tema (Official Video)», «Tema [HD]» o «Tema (Letra)».

## Decisión

### 1. Número de pista (`track`)

- **Qué es.** Campo opcional `track` en las canciones del catálogo: un entero desde 1 que da el orden dentro de su álbum.
  - Solo lo tienen las canciones con álbum.
  - En cada álbum va de 1 a n, sin huecos ni repetidos.
  - `edit_song` no lo admite: solo lo cambia `order_album`.
- **Entrar y salir de un álbum.**
  - Al entrar en un álbum, la canción recibe el número siguiente. Da igual el camino: `edit_song` con `folder_id`, `move_songs`, `organize_youtube_playlist` o el buzón con álbum.
  - Al salir, pierde el número y las demás se renumeran sin huecos.
  - Volver a poner una canción en el álbum en el que ya está no cambia su número.
  - Al borrar un álbum, sus canciones pasan al álbum superior, al final y en su orden. Si no hay álbum superior, pierden el número.
  - Todo está en `sonidos.catalog.update_song` y `delete_folder`.
- **Migración** (`catalog.normalize_tracks`, idempotente).
  - En cada álbum, primero van las canciones con número válido (en su orden). Después, las que no lo tienen, en el orden de hoy: título sin mayúsculas y, a igualdad, su posición en el catálogo. Es el orden de `data/songs.json`, el que ya se ve en la web y en la APK.
  - Una canción sin álbum pierde cualquier número.
  - Se ejecuta antes de cada escritura de `scripts/ci_library.py` (organize) y de `sonidos.buzon.procesar_buzon`. El catálogo de `main` se migra solo en la primera ejecución tras la fusión, sin un commit aparte que choque con los del bot.
  - Hasta entonces, nada cambia a la vista: sin `track`, la web y la APK ordenan como hoy.
- **Parte pública.** `publish.sync_public` pone `track` en `data/songs.json` y `catalog.json` solo cuando existe. `songs.json` sigue ordenado por título.
- **Web y APK** ordenan las canciones de un álbum por `track`. Las que no lo tienen van al final, en el orden de antes. Es `songsInFolder` en `js/catalog.js` y `sortByTrack` en `lib/song.dart`.

### 2. Operación nueva `order_album`

- **Forma:** `{"op":"order_album","folder_id":"F…","song_ids":[…]}`.
  - `folder_id` es obligatorio y no admite `null`.
  - `song_ids` es la lista completa y exacta de las canciones del álbum, en el orden nuevo.
  - **Máximo 190 canciones.** Con ids de álbum `F` + 16 hexadecimales, el payload normalizado ocupa 65 + 20 × n caracteres: 190 dan 3865, dentro de los 4000. El álbum más grande de `main` a 2026-11-05 («Fiesta») tiene 157.
- **Atómica.** `catalog.order_album` comprueba antes de tocar nada que el álbum existe y que la lista es exactamente su conjunto de canciones: sin repetidos, sin canciones de menos y sin canciones de más. Después asigna `track` 1..n.
  - Si no coincide, el catálogo no cambia. El error dice cuántas faltan y cuántas sobran, y pide recargar y volver a ordenar.
- **Mismas reglas en los tres contratos:**
  - `sonidos.issue_request.validate_payload` (`MAX_ORDER_SONGS`);
  - `validateOperation` en `js/cuidador/incidencias.js` (`REQUEST_LIMITS.orderSongs`), con el título de incidencia «Ordenar el álbum F…»;
  - `LibraryRequest.orderAlbum` en `lib/library_requests.dart` (`kMaxOrderSongs`).
  - Además, está en `ALLOWED_OPS` de `/api/editar`.
  - Comprobado que `parse_request` acepta el cuerpo que generan la web y la APK (`backend/tests/test_order_album.py`).
- **Riesgo aceptado.** La web y la APK solo ven las canciones públicas. Si un álbum tuviera canciones privadas, la lista que envían no estaría completa y la petición se rechazaría. A 2026-11-05 no hay ninguna canción privada en un álbum. Si las hubiera, la solución sería publicarlas o sacarlas del álbum antes de ordenarlo.

### 3. «Ordenar canciones», igual en la web y en la APK

- Está en el menú «···» del álbum cuando tiene dos canciones o más de la biblioteca común.
- **Web:** lista numerada con «Subir» y «Bajar» en cada fila.
  - Son botones de 44 px con nombre accesible («Subir «X»»).
  - Cada movimiento se anuncia: «X» ahora es la 2 de 8.
  - El foco se queda en el botón (o pasa al otro en el borde).
  - No hay arrastrar en la web: los botones cubren teclado, ratón y lector de pantalla, y arrastrar con HTML5 no es accesible por sí solo.
- **APK:** `ReorderableListView` (arrastrar con pulsación larga) y además «Subir» y «Bajar».
- «Guardar orden» solo se activa si el orden cambió y envía una sola petición `order_album`.
- Con más de 190 canciones, lo dice y no deja guardar.

### 4. Selección múltiple en la página de un álbum

- Modo «Seleccionar»:
  - un botón en la barra del álbum y «Seleccionar canciones» en «···»;
  - una casilla por canción de la biblioteca común;
  - contador («2 canciones elegidas.»);
  - «Seleccionar todo» y «Ninguna».
- **Acciones**, cada una con una sola petición `move_songs` con las canciones en el orden del álbum:
  - «Quitar del álbum»: pide confirmación y usa `folder_id: null`;
  - «Mover a otro álbum»: se elige el álbum de destino, sin ofrecer el actual.
- Como mucho 100 (el límite de `move_songs`). Al guardar, se sale del modo. En la web, cambiar de página también lo cierra.

### 5. Regla de «posible duplicado»

- **Normalización del título:**
  - minúsculas;
  - sin marcas diacríticas combinantes (U+0300 a U+036F) y con una tabla de pliegue de letras acentuadas (`á`→`a`, `ñ`→`n`, `ç`→`c`…);
  - sin los grupos entre paréntesis o corchetes cuyo contenido es una etiqueta típica («(Official Video)», «(Video Oficial)», «(Letra)», «(Lyrics)», «[HD]», «(Audio)»…) o empieza por `ft`, `feat` o `featuring`;
  - todo lo que no es letra ni número pasa a espacio;
  - se corta desde la primera marca de featuring que no es la primera palabra («Tema ft. Otro» → «tema»);
  - espacios simples.
- El artista se normaliza igual, pero sin quitar grupos ni cortar.
- **Posible duplicado:** título normalizado igual y no vacío, y además:
  - si las dos tienen duración, que se diferencien como mucho 2 s;
  - si a alguna le falta, que tengan el mismo artista normalizado.
  - Desde ADR-0032, el título también coincide si es el «artista título» de la otra; entonces solo cuenta la duración (ver la nota del final).
- **Los datos son un dato, no código disperso.** La tolerancia, la tabla de pliegue, la lista de etiquetas y las marcas de featuring están en `tests/contrato/duplicados.json`, con los casos de prueba.
  - Las tres implementaciones llevan esas constantes: `backend/sonidos/duplicados.py`, `frontend/web/js/duplicates.js` y `mobile/lib/duplicates.dart`.
  - Sus pruebas comprueban que son idénticas al JSON y que dan los resultados del JSON, en los dos sentidos.
- **Dónde se usa:**
  - **Buzón:** cada canción nueva que parece otra que ya está (o una anterior del mismo push) se anota en `posibles_duplicados` del resultado. Sale en el resumen del job y en un `::warning` con un texto fijo, sin nombres de archivo. **No se bloquea.** Un fichero idéntico sigue saliendo como «Ya estaban en el catálogo».
  - **«Subir canciones» (web y APK):** antes de poner los archivos en la cola, y después de abrir los ZIP, cada archivo se compara con la biblioteca y con los anteriores de la misma tanda. Si se parece a algo, se pregunta:
    - «Parece que ya está en la biblioteca: «X» (3:21). ¿Subirla igualmente?»;
    - o «Parece repetida en esta subida: «X» (3:21). ¿Subirla igualmente?».
    - Las respuestas son «Subir igualmente» y «Quitar de la cola». Cerrar el aviso equivale a subirla: es solo un aviso.
  - **Duración antes de subir.** La web decodifica el archivo con Web Audio (no con un `<audio>` sobre una URL `blob:`, que la política de contenido no admite en `media-src`). La APK usa FFprobe.
    - Las canciones de dentro de un ZIP no se abren para esto: sin duración, decide el artista.

## Consecuencias

- Ordenar un álbum es una sola incidencia y un solo commit. Si el álbum cambió por el medio, la petición se rechaza sin tocar nada.
- La primera escritura tras la fusión numera los 251 temas que hoy están en álbumes. Es un commit con un diff grande en `catalog.json`, pero no cambia el orden que se ve.
- La regla de duplicados da falsos positivos (dos canciones distintas con el mismo título y la misma duración) y falsos negativos (versiones con otro título). Por eso solo avisa.
- Cambiar la lista de etiquetas obliga a cambiar los tres sitios y el JSON. Las pruebas fallan si no coinciden.

## Validación

- **Backend:**
  - `test_order_album.py`: contrato de la petición, aplicación atómica, renumeración al entrar y salir, mover entre álbumes, playlists de YouTube, borrar álbum, migración del catálogo anterior y parte pública.
  - `test_duplicados.py`: contrato común, aviso en el buzón, `::warning` y migración desde el buzón.
  - `test_publish.py`: `track` en `catalog.json`.
- **Web:**
  - Pruebas unitarias: `albumes-orden.test.mjs` y `duplicados.test.mjs`.
  - Pruebas de extremo a extremo (`funcional.e2e.mjs`): seleccionar y quitar, mover, ordenar, orden por pista y aviso de duplicado.
  - Pantallas nuevas en `a11y.e2e.mjs`.
- **APK:** `duplicates_test.dart`, `album_tools_test.dart` y `upload_review_test.dart`.

## Nota (2026-11-06): títulos limpios

Desde [ADR-0032](ADR-0032-titulos-limpios.md), el buzón crea cada canción con el título limpio («Tema (Official Video)» pasa a «Tema») y el aviso de posible duplicado del buzón compara ese título.

La regla de duplicados se amplía en las tres capas, con el contrato en `duplicados.json`. Los títulos también coinciden si el de una canción es el «artista título» normalizado de la otra («Bad Bunny - Monaco.mp3» frente a «Monaco» de «Bad Bunny»). Entonces el artista ya coincide y solo cuenta la duración. Así, el aviso de «Subir canciones» sigue funcionando con un archivo «Artista - Tema» frente al catálogo limpio. Ver la sección 6 de ADR-0032.
