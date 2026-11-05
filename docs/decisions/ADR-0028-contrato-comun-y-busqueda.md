# ADR-0028: Casos de contrato comunes y una sola regla de búsqueda

- Estado: aceptada (rama `feature/contrato-y-busqueda`, 2026-11-05; pendiente de fusionar en main).
- Fecha: 2026-11-05.
- Relacionadas: ADR-0008 (peticiones por incidencias), ADR-0016 (álbumes), ADR-0022 (editar sin GitHub), ADR-0023 (`move_songs`), ADR-0026 (`order_album` y la regla de duplicados, que estrenó `tests/contrato/`).

## Contexto

- **Las reglas de las peticiones estaban escritas a mano tres veces.**
  - Backend: `sonidos.issue_request` (`validate_payload` y `parse_request`).
  - Web: `js/cuidador/incidencias.js` (`validateOperation`, `validateRequest`, `buildIssueBody`) y `api/editar.js` (`ALLOWED_OPS`).
  - APK: `lib/library_requests.dart` (`LibraryRequest.*` y los límites `kMax…`).
  - Cada copia tenía sus pruebas, con sus propios ejemplos. Nada comprobaba que dijeran lo mismo, y no lo decían (ver «Divergencias»).
- **Había dos reglas de búsqueda.**
  - El buscador principal y el filtro de una colección perdonaban erratas: hasta 2 en palabras de 7 o más letras, y buscaban también en mitad de una palabra.
  - «Añadir canciones» a un álbum era estricto: cada palabra tenía que aparecer tal cual, sin erratas, y no miraba año ni etiquetas.
  - Además, web y APK no buscaban en los mismos campos: el buscador de la APK no miraba el álbum, el filtro de colección de la web no miraba año ni etiquetas, y la APK plegaba menos letras (sin «å», «ø», «ý»…).
  - Ninguna ordenaba igual: la web puntuaba; la APK dejaba el orden del catálogo.
  - Quien usa la plataforma puede ser una persona mayor que escribe con erratas: la misma consulta tiene que dar lo mismo en todas partes.

## Decisión

### 1. Casos de contrato comunes: `tests/contrato/peticiones.json`

- **Fuente única de verdad.** Un JSON con:
  - 111 casos de todas las operaciones de organize: `create_folder`, `edit_folder`, `rename_folder`, `delete_folder`, `edit_song`, `move_songs`, `order_album` y `organize_youtube_playlist`.
  - Los límites, la lista de espacios que se recortan y los ids válidos e inválidos.
  - 18 textos completos de incidencia (`parse_request`).
- **Cada caso** lleva:
  - el `payload` y si es `valido`;
  - si no vale, el `motivo` como código estable en inglés (`too_long`, `invalid_folder_id`, `song_ids_too_many`…) y el `campo`, nunca el texto en español;
  - si vale, el `normalizado` del backend, el `cuerpo` exacto de la incidencia y si `/api/editar` lo admite (`api_editar`);
  - `web` (`aplica` o `no_aplica`) y `apk`: la factoría de `LibraryRequest` que construye ese payload (`createAlbum`, `editAlbum`, `editSong`, `moveSong`, `moveSongs` u `orderAlbum`) o `no_aplica`. La prueba de la APK comprueba que esa etiqueta es correcta: no se puede marcar como «no aplica» algo que la APK sí construye.
- **Formato del cuerpo**, el mismo en la web y en la APK: `action: organize\npayload: <JSON compacto en una línea>`, con las claves en el orden del cliente, sin escapar lo que no es ASCII, los textos sin espacios a los lados y las etiquetas normalizadas.
- **Quién lo ejecuta.**
  - Backend, `backend/tests/test_contrato_peticiones.py`: `validate_payload` da el normalizado o el código; `parse_request` acepta cada cuerpo y da el mismo payload. Es la prueba de que lo que generan la web y la APK lo acepta el backend.
  - Web, `tests/web-unit/contrato-peticiones.test.mjs`: `operationIssue` da el código; `buildIssueBody` da el cuerpo carácter a carácter; `organizeProblem` de `/api/editar` acepta lo que debe.
  - APK, `mobile/test/contrato_peticiones_test.dart`: cada factoría da el cuerpo carácter a carácter o lanza `LibraryRequestException` con el código y el campo.
- **Códigos estables.** `RequestError` (backend), `operationIssue` (web) y `LibraryRequestException` (APK) llevan `code` y `field`. Los mensajes en español siguen siendo libres.
- **El backend es la referencia**, porque es quien aplica. Si una implementación se aparta, su suite falla.

### 2. Una sola regla de búsqueda: `tests/contrato/busqueda.json`

- **Normalización** (la misma tabla de pliegue que `duplicados.json`): minúsculas, sin marcas combinantes, letras plegadas, signos a espacio y espacios simples.
- **Coincidencia.**
  - Todas las palabras de la consulta tienen que coincidir, en cualquier orden y en cualquier campo.
  - Cada una, con una palabra entera (3 puntos) o con su principio (2).
  - Una errata (1 punto) solo si la palabra tiene 4 o más caracteres y alguna letra: distancia de edición 1 con intercambio de contiguas, frente al principio de la palabra o frente a la palabra entera.
- **Relevancia.**
  - Los puntos se multiplican por el peso del campo (×3 el título o nombre, ×2 el artista o creador, ×1 el resto) y se suman.
  - +100 si el título entero es la consulta; +50 si empieza por ella.
  - De más a menos puntos y, con empate, en el orden de entrada.
- **Campos.** Canción: título, artista, nombre de su álbum, año y etiquetas. Álbum: nombre y artista. Lista: nombre. Tu biblioteca: título y creador.
- **Una función por plataforma** que usan todos los buscadores, con los campos como parámetro:
  - Web: `searchRank` y `searchScore` en `js/catalog.js`. La usan `searchCatalog` (Buscar y «Busquemos algo para tu lista»), `filterSongs` («Buscar en esta colección»), `songsToAddToAlbum` («Añadir canciones») y el filtro de Tu biblioteca (`views/library.js`, que conserva el orden elegido).
  - APK: `searchRank` y `searchScore` en `lib/fuzzy_search.dart`. La usan `LibraryController.searchSongs` y `searchFolders` (Buscar), `filterSongsByText` («Buscar en esta colección») y `filterSongsForAlbumPicker` («Añadir canciones»).
- **Casos comunes** en `tests/contrato/busqueda.json` (normalización, puntos por palabra, puntuaciones, 33 búsquedas de canciones y 6 de álbumes). Los ejecutan `tests/web-unit/busqueda-contrato.test.mjs` y `mobile/test/busqueda_contrato_test.dart` contra cada buscador.
- **Por qué esta regla.**
  - Todas las palabras y principio de palabra: escribir más acota, nunca amplía. Era lo que hacía «Añadir canciones», y lo que se espera de un buscador.
  - Una errata en palabras de 4 o más letras cubre los fallos típicos (una letra de menos, dos intercambiadas) sin que palabras cortas como «el» o «de» encuentren medio catálogo. Con dos erratas, «montaña» encontraba palabras que no se parecían.
  - Sin erratas en los números: «1952» no puede encontrar 1953.
  - Sin búsqueda en mitad de la palabra: «ton» encontraba «Charleston» y cualquier «-ción».
  - La relevancia pone primero lo exacto: con erratas permitidas, el orden es lo que evita que el ruido tape lo buscado.

### 3. Divergencias encontradas y corregidas

Al escribir los casos aparecieron diferencias reales. Se corrigieron hacia el backend:

1. **Web, `edit_folder`:** aceptaba un payload sin `name` (solo `artist`), que el backend rechaza. Ahora `name` es obligatorio, como en el backend.
2. **APK, artista de una canción:** la APK lo limitaba a 80 caracteres (el límite del artista de un álbum). El backend admite 200 (`catalog.SONG_ARTIST_MAX_CHARS`). Ahora es `kMaxSongArtistLength = 200`, también en el campo de «Editar detalles».
3. **Web y APK, espacios y caracteres de control:** miraban los caracteres de control antes de recortar, y recortaban con `trim()`. El backend recorta con `str.strip` de Python y mira después. Por eso «Valses» con un tabulador al final se rechazaba aunque el backend lo acepta. Además, `trim()` quita U+FEFF y no U+001C a U+001F, al revés que Python. Ahora las dos usan `stripLikeBackend`, con la lista exacta de espacios del contrato.
4. **APK, orden de comprobación** de `move_songs` y `order_album`: miraba las repetidas antes que los ids no válidos. El backend lo hace al revés.
5. **Web, cuerpo de la incidencia:** enviaba el payload tal como llegaba, con espacios a los lados y etiquetas sin normalizar. La APK ya los recortaba. Ahora `buildIssueBody` envía el payload normalizado (`normalizeOperation`), así que la web y la APK escriben el mismo cuerpo.

## Consecuencias

- **Una regla nueva o un límite nuevo se cambia en cuatro sitios:** el JSON y las tres implementaciones. Si falta alguno, falla su suite. Se comprobó rompiendo a propósito una regla en cada implementación (ver «Validación»).
- **El contrato de peticiones ocupa unos 95 KB,** porque los casos límite llevan las listas completas (100, 101, 190 y 191 ids; 201 canciones). Se editan a mano; no hay generador.
- **`organize_youtube_playlist` solo la genera el backend** (`scripts/ci_library.py`). Sus casos se marcan como `web: no_aplica` y la prueba de la web lo comprueba.
- **La búsqueda cambia para quien la usa.**
  - Ya no encuentra fragmentos en mitad de una palabra.
  - Perdona como mucho una errata, y nunca en números ni en palabras de menos de 4 letras.
  - «Añadir canciones» y el filtro de una colección ordenan por relevancia en vez de por el orden de la lista.
  - El buscador de la APK ahora también busca por álbum y ordena por relevancia.

## Validación

- **Backend:** `test_contrato_peticiones.py` (170 pruebas) y la suite completa.
- **Web:** `contrato-peticiones.test.mjs` (108 pruebas) y `busqueda-contrato.test.mjs` (45). `cuidador-incidencias*.test.mjs` y `busqueda-tolerante.test.mjs` se actualizaron a la regla nueva.
- **APK:** `contrato_peticiones_test.dart` (55) y `busqueda_contrato_test.dart` (45). `library_requests_test.dart`, `fuzzy_search_test.dart` y `library_ui_test.dart` se actualizaron.
- **Detección de desviaciones**, probada rompiendo una regla a propósito en cada implementación:
  - backend: `MAX_FOLDER_NAME_CHARS` a 81;
  - web: `edit_folder` con `name` opcional otra vez;
  - APK: `kMaxSongArtistLength` a 80;
  - búsqueda web y APK: dos erratas en palabras largas.
  
  En todos los casos falló la suite de esa implementación. Después se deshizo el cambio.
