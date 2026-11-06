# ADR-0032: Títulos limpios

- Estado: aceptada (rama `feature/titulos-limpios`, 2026-11-06; pendiente de fusionar en main). **Sin aplicar en producción**: las canciones que ya están se limpian con una petición `clean_titles` (ver «Cómo se aplica»).
- Fecha: 2026-11-06.
- Relacionadas: ADR-0008 (peticiones por incidencias), ADR-0014 (buzón), ADR-0017 (subida para todos), ADR-0019 (playlists de YouTube como álbumes), ADR-0026 (regla de duplicados, cuya lista de etiquetas se reutiliza) y ADR-0028 (contratos comunes en `tests/contrato/`).

## Contexto

- Las canciones subidas toman el nombre del archivo como título (ADR-0014, ADR-0017). Lo que llega de YouTube trae de todo:
  - etiquetas: «Bad Bunny - DtMF (Letra)», «Rick Astley - Never Gonna Give You Up (Official Video) (4K Remaster)»;
  - el subtítulo del vídeo detrás de la etiqueta: «BAD BUNNY - MONACO (Official Video) nadie sabe lo que va a pasar mañana»;
  - el artista dentro del título, aunque la canción ya tenga artista, o sin tenerlo;
  - todo en mayúsculas: «BAD GYAL - FIEBRE PROD KING DOUDOU».
- Además, en los vídeos sueltos el artista que llega es el **canal** que subió el vídeo («iPerol | Bad Bunny - DtMF (Letra)», «king rd», «Viral Latín»). Las playlists de YouTube Music dan el mismo canal en los vídeos que no son de un artista.
- A 2026-11-06 el catálogo tiene 305 canciones. 71 cambian con la regla de este ADR (ver «Cómo se aplica»).

## Decisión

### 1. Una regla, como dato y función pura

- **Código:** `backend/sonidos/titulos.py`, función `clean_song(title, artist, *, keep_artist, known_artists)` → `(título, artista)`.
- **Datos y casos:** `tests/contrato/titulos.json` (separadores, palabras de etiqueta, marcas de colaboración, separadores de créditos, partículas, siglas, extensiones y límites, más 70 casos).
  - Las etiquetas exactas son las de `duplicados.json` (ADR-0026): no se copian. Se amplían con un vocabulario de **palabras de etiqueta**: un grupo es etiqueta si todas sus palabras son de él («(Videoclip Oficial 4K)», «(LETRA LYRICS)», «(Remastered 2009)»).
  - `backend/tests/test_titulos.py` comprueba que las constantes del módulo son exactamente las del JSON y que da sus resultados.
  - **Web y APK: no aplica** (el JSON lo dice). No ponen títulos: el backend los limpia al publicar.
- **Pasos** (el detalle, en el docstring del módulo y en `regla` del JSON):
  1. Espacios recortados y sin dobles.
  2. Extensión de vídeo o audio al final («Purpurina - Alberto Gambino.wmv»).
  3. **Etiquetas.** Se quita el primer grupo entre paréntesis o corchetes que es una etiqueta y **todo lo que va detrás** (el subtítulo de YouTube), salvo:
     - los grupos de colaboración posteriores («(con X)», «(feat. X)»): «Party (360 Visualizer) Un Verano Sin Ti (con Rauw Alejandro)» → «Party (con Rauw Alejandro)»;
     - si detrás viene un separador, la etiqueta estaba en mitad y solo se quita ella: «KEVVO (Lyrics Letra) - 105 F Remix» → «KEVVO - 105 F Remix».

     Además:
     - «(Remix - Official Video)» se queda en «(Remix)».
     - Al final, sin paréntesis, se quita una cola de dos o más palabras de etiqueta («Dead Mom DEMO Music Video») o «Oficial»/«Official» suelto («DILES Oficial»).
     - Se conservan «(feat. X)», «ft. X» y todo grupo que no es etiqueta: «(En Vivo)», «(Remix)», «(Directo)», «(Versión Original)», «(Sped Up Version)», «(Prod. X)», «(1999)».
  4. **Número de pista** al principio: «01 », «01. », «01 - », «1. », «12 - ». «2 Catorce» y «120» no lo son.
  5. **Artista y título** por el **primer** « - », « – » o « — », si la izquierda es razonable (1 a 80 caracteres, con alguna letra) y la derecha no queda vacía:
     - sin artista: la izquierda es el artista;
     - con artista, si los nombres de la izquierda están todos en el artista: se quita el prefijo (se comparan sin mayúsculas, acentos ni signos, y separando los créditos por «,», «&», « y », « x », « feat. »…; «Chimbala - Feliz» con artista «Chimbala, Chucky73 y …» → «Feliz»);
     - con artista, salvo que venga de una playlist: si la izquierda contiene al artista y más, pasa a ser el artista («Daddy Yankee | Daddy Yankee x Natti Natasha x Becky G - Zona Del Perreo» → artista completo); y si todos los nombres de la izquierda son **artistas conocidos** de la biblioteca, también (el artista era el canal: «iPerol | Bad Bunny - DtMF» → «Bad Bunny | DtMF»).
  6. Sin grupos vacíos, sin espacios tras «(» ni antes de una coma o de «)», sin separadores colgando.
  7. **Mayúsculas.** Un título entero en mayúsculas con al menos 4 letras pasa a «Tipo Título»: partículas (de, la, y, el, en, con…) en minúscula salvo al principio o tras «(» o un separador, siglas (DJ, MC, TV, II, IV…) en mayúsculas, palabras con cifras como están y mayúscula tras un guion interior («Ska-P»). El artista que sale del título, igual.
  8. **Nunca vacío:** si el título quedaría vacío («(Official Video)»), se dejan el título y el artista de entrada.
  9. **Idempotente:** los pasos se repiten hasta que no cambia nada (como mucho 8 rondas). Una prueba con 20 000 títulos al azar lo comprueba.

### 2. Decisiones propias sobre el encargo

- **El artista que ya tiene la canción no cambia de mayúsculas.** El encargo decía «un artista o título ENTERO en mayúsculas». Pero los artistas del catálogo vienen de YouTube Music o de quien los editó, y en mayúsculas son nombres oficiales: «SFDK», «ROSALÍA», «KAROL G», «SAIKO». Solo se pasa a «Tipo Título» el artista que sale del título («BAD BUNNY - …» → «Bad Bunny»).
- **Artistas conocidos.** El encargo solo quitaba el prefijo si era el mismo artista. Con eso, «iPerol | Bad Bunny - DtMF (Letra)», uno de los ejemplos, se quedaba con artista «iPerol». Se reconoce el prefijo cuando todos sus nombres ya son artistas de la biblioteca (canciones y álbumes). `plan_clean` añade los artistas que salen al limpiar y repite hasta que no cambian, para que una segunda limpieza no encuentre nada nuevo.
- **Prefijo que contiene al artista** («Daddy Yankee x Natti Natasha x Becky G»): se queda el crédito completo en vez de perderlo.
- **Etiqueta en mitad**, **«Oficial» suelto**, **extensiones** y **grupos de colaboración tras la etiqueta**: salieron de revisar la vista previa del catálogo real.

### 3. Al publicar (buzón)

- `sonidos.buzon._add` limpia título y artista **solo al crear** una canción nueva. Vale para las subidas de la web y la APK (`/api/subir`), las de la página de GitHub y las de dentro de un ZIP.
- Si la subida trae álbum de una playlist (ADR-0019), el artista se respeta (`keep_artist`): solo se limpia el título, incluido quitar el prefijo «ese artista - ».
- El id sigue siendo el SHA-256 del audio, y el nombre del archivo en el resumen no cambia. Una grabación que ya estaba no cambia de título.
- El aviso de posible duplicado del buzón (ADR-0026) compara ya el título limpio.

### 4. Arreglar las que ya están: operación `clean_titles`

- **Forma:** `{"op":"clean_titles"}` (todas) o `{"op":"clean_titles","song_ids":[…]}` (de 1 a 100, sin repetir; `MAX_CLEAN_SONGS`).
- **Aplicación** (`scripts/ci_library.py`):
  - **Atómica:** comprueba primero que existen todas las canciones pedidas y calcula todos los cambios (`titulos.plan_clean`); después los aplica con `catalog.update_song`, que también mantiene el artista de los álbumes de YouTube.
  - Solo cambian las canciones cuyo título o artista cambia. **Idempotente:** la segunda vez da `"cleaned": 0` y el catálogo queda byte a byte igual.
  - El resultado lleva `cleaned` y la lista de cambios (antes y después). La respuesta de la incidencia dice «Títulos limpiados: N canciones» (`scripts/responder_incidencia.py`).
- **Contrato** (ADR-0028): 9 casos en `tests/contrato/peticiones.json` y el límite `clean_titles: 100`.
  - Backend: `issue_request.OPERATIONS` y `validate_payload`.
  - Web: `OPERATIONS`, `operationIssue` y `buildIssueTitle` de `js/cuidador/incidencias.js` («Limpiar los títulos de todas las canciones» / «… de N canciones»), y `ALLOWED_OPS` de `server/edit-core.js` (`/api/editar` en Vercel y en el Worker).
  - APK: no aplica (no hay factoría en `LibraryRequest`; la prueba del contrato lo comprueba).
- **No hay botón** en la web ni en la APK. Se pide por incidencia `biblioteca` o por `POST /api/editar`.

### 5. Vista previa

- `scripts/vista_previa_titulos.py [catalog.json] [--id S…]` lee un catálogo **local**: por defecto, el de la copia de trabajo. Escribe, por cada canción que cambiaría, su id, «antes (artista | título)» y «después», y al final el total.
- Usa `plan_clean`, la misma función que la operación. No escribe nada ni usa la red.

## Cómo se aplica

1. Fusionar en `main`. Desde ese momento, las subidas nuevas entran limpias.
2. Con `main` al día, ejecutar `python3 scripts/vista_previa_titulos.py` y revisar la lista. A 2026-11-06 da **71 de 305**.
3. Abrir una incidencia con la etiqueta `biblioteca`:
   - título: «Limpiar los títulos de todas las canciones»;
   - cuerpo:
     ```
     action: organize
     payload: {"op":"clean_titles"}
     ```
4. Los casos dudosos de la vista previa se corrigen después, uno a uno, con `edit_song`.

Para `/api/editar` desde el Worker hay que desplegarlo (`npx --yes wrangler@4.151.3 deploy` en `worker/`): comparte `server/edit-core.js`. Vercel lo toma al desplegar `main`.

## Consecuencias

- **Lo que la regla no puede saber:**
  - Si el artista es un canal y el artista real no está en la biblioteca, no se toca: «gigatr0n | Marea - Corazon de mimbre», «Warner Music Spain Archivos | Melendi - …», «IkonProducciones | Benito Kamelas - …», «CarlinhosX7 | Pont Aeri - Flying Free», «OmarMontesVEVO».
  - Sin artista, la izquierda del primer separador se toma como artista aunque no lo sea: «One Piece AMV - Royalty» → artista «One Piece AMV».
  - Las partículas del «Tipo Título» se aplican también a nombres propios: «ESBARZERS (REMIX LA GOSSA SORDA)» → «Esbarzers (Remix la Gossa Sorda)». Las siglas que no están en la lista pierden las mayúsculas («BNN» → «Bnn»).
  - Todos se arreglan a mano con `edit_song`. La vista previa los enseña antes.
- **Aviso de duplicado en «Subir canciones» (web y APK).** Compara el nombre del archivo con los títulos del catálogo, que ahora están limpios y con el artista aparte. Un archivo «Artista - Tema.mp3» ya no se parece a «Tema» de «Artista».
  - El buzón sí lo detecta (limpia antes de comparar), y un fichero idéntico sigue saliendo como «Ya estaban» por su SHA-256.
  - Si hace falta, el siguiente paso es llevar esta regla a `js/` y `lib/` con este mismo contrato y limpiar el nombre antes de comparar.
- **Una regla más que mantener:** cambiar una palabra de etiqueta o una partícula es cambiar el JSON y `titulos.py`. Las pruebas fallan si no coinciden.
- `clean_titles` sobre todo el catálogo es un solo commit, con un diff de 71 canciones en `catalog.json` y en `frontend/web/data/`.

## Validación

- **Backend:** `test_titulos.py` (contrato, idempotencia, `plan_clean` sobre el catálogo real, la operación, el buzón y la vista previa). Además, `test_contrato_peticiones.py` con los casos nuevos, `test_responder_incidencia.py`, y `test_buzon.py` y `test_duplicados.py` ajustados al título limpio («01 Vals» → «Vals», «Nueva [HD]» → «Nueva»). Suite completa en verde.
- **Web:** `contrato-peticiones.test.mjs` y `api-editar.test.mjs` (`clean_titles` en `/api/editar`, sin llamar a GitHub si está mal formada). Pruebas unitarias y de extremo a extremo en verde.
- **APK:** `flutter test` y `flutter analyze` en verde. El contrato marca `clean_titles` como no aplicable y la prueba lo comprueba.
- **Sin producción:** ninguna prueba habla con el Worker, R2 ni GitHub. Se comprobó antes y después que no cambian las últimas incidencias ni las ejecuciones de `buzon.yml`.
