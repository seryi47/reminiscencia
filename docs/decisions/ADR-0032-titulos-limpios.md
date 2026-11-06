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
- A 2026-11-06 el catálogo tiene 305 canciones. 77 cambian con la regla de este ADR (ver «Cómo se aplica»).

## Decisión

### 1. Una regla, como dato y función pura

- **Código:** `backend/sonidos/titulos.py`, función `clean_song(title, artist, *, keep_artist, known_artists)` → `(título, artista)`.
- **Datos y casos:** `tests/contrato/titulos.json` (separadores, palabras de etiqueta, marcas de colaboración, separadores de créditos, partículas, siglas, extensiones, palabras y sufijos de canal y límites; 97 casos y 52 nombres revisados de «parece canal»).
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
     - con artista, salvo que venga de una playlist: si la izquierda contiene al artista y más, pasa a ser el artista («Daddy Yankee | Daddy Yankee x Natti Natasha x Becky G - Zona Del Perreo» → artista completo); y si todos los nombres de la izquierda son **artistas conocidos** de la biblioteca, también (el artista era el canal: «iPerol | Bad Bunny - DtMF» → «Bad Bunny | DtMF»); y si el artista **parece un canal de YouTube** (ver «Canales»), también.
     - La izquierda pierde un grupo entre corchetes o paréntesis al principio, la marca del canal: «[HDLR LIVE] Natos x Waor x Recycled j» → «Natos x Waor x Recycled j».
  6. Sin grupos vacíos, sin espacios tras «(» ni antes de una coma o de «)», sin separadores colgando.
  7. **Mayúsculas.** Un título entero en mayúsculas con al menos 4 letras pasa a «Tipo Título»: partículas (de, la, y, el, en, con…) en minúscula salvo al principio o tras «(» o un separador, siglas (DJ, MC, TV, II, IV…) en mayúsculas, palabras con cifras como están y mayúscula tras un guion interior («Ska-P»). El artista que sale del título, igual.
  8. **Nunca vacío:** si el título quedaría vacío («(Official Video)»), se dejan el título y el artista de entrada.
  9. **Idempotente:** los pasos se repiten hasta que no cambia nada (como mucho 8 rondas). Una prueba con 20 000 títulos al azar lo comprueba.

### 2. Canales de YouTube como artista

Pedido por el propietario tras revisar la primera vista previa (2026-11-06).

- **Qué parece un canal** (`looks_like_channel`; datos en `palabras_de_canal`, `sufijos_de_canal` y `min_letras_canal_alfanumerico` del JSON). Tiene que ser un único nombre: «El Jhota, CANO MUSIC y Los Del Control» no lo es. Además, una de dos:
  - alguna de sus palabras es de canal: vevo, music, records, archivos, tv, producciones, lyrics, fan, oficial, official, channel o topic. También cuentan las palabras pegadas en «CamelCase»: «KapitalMusicTv» → Kapital Music Tv, «IkonProducciones»;
  - o es una sola palabra solo de letras y cifras, con al menos una cifra y dos letras: «ra29597», «gigatr0n», «antifa93cat», «CarlinhosX7». No lo son «U2» (una letra), «Blink-182» (lleva guion) ni «Haylee Maree (Salt F4)» (varias palabras).
- **Qué se hace.** Con un título «X - Y» y una X razonable, X pasa a ser el artista, con la regla de mayúsculas de los artistas que salen del título. Si el nombre del canal aparece en Y, se quita con lo que le sigue («Sudores Frios Lyrics Luxury Life Music regala Amazon Music» → «Sudores Frios»).
- **VEVO.** Un nombre que termina en «VEVO», pegado o aparte, lo pierde y se separan las palabras pegadas: «OmarMontesVEVO» → «Omar Montes», «SFDKVEVO» → «SFDK». Pasa aunque el título no tenga guion. Riesgo aceptado: un nombre compuesto pegado sin mayúsculas intermedias se queda junto («LaOrejadeVanGoghVEVO» → «La Orejade Van Gogh»).
- **Nunca con artista de playlist** (ADR-0019), como el resto del paso 5.
- **Revisión uno a uno** de los 191 artistas del catálogo real:
  - Parecen canal 15: CantoYo Video Lyrics, CarlinhosX7, Disney Channel Animation, Doble Music, EuskalGazte778, IkonProducciones, Imagine Dragons FAN, KapitalMusicTv, Luxury Life Music, OmarMontesVEVO, Warner Music Spain Archivos, YouMoreTv - Espectáculo, antifa93cat, gigatr0n y ra29597.
  - Ninguno de los demás. Nombres de persona como Angel Delgado Sanchez, Daniel Castro, Asaki Takaya o Anfezi no cuentan como canal; tampoco grupos ni cuentas como Prime Video, EpicBebe, Vivziepop o TOP SONGS.
  - `test_titulos.py` falla si aparece un canal nuevo sin revisar.
- **Daniel Castro.** No es un canal, pero «Daniel Castro | Marea - Trasegando» pasa a «Marea | Trasegando» por la regla de artistas conocidos: «Marea» sale de las dos canciones de «gigatr0n». No se puede evitar sin romper la idempotencia: después de la primera limpieza, «Marea» ya está en el catálogo y una segunda limpieza la cambiaría igual.

### 3. Decisiones propias sobre el encargo

- **El artista que ya tiene la canción no cambia de mayúsculas.** El encargo decía «un artista o título ENTERO en mayúsculas». Pero los artistas del catálogo vienen de YouTube Music o de quien los editó, y en mayúsculas son nombres oficiales: «SFDK», «ROSALÍA», «KAROL G», «SAIKO». Solo se pasa a «Tipo Título» el artista que sale del título («BAD BUNNY - …» → «Bad Bunny»).
- **Artistas conocidos.** El encargo solo quitaba el prefijo si era el mismo artista. Con eso, «iPerol | Bad Bunny - DtMF (Letra)», uno de los ejemplos, se quedaba con artista «iPerol». Se reconoce el prefijo cuando todos sus nombres ya son artistas de la biblioteca (canciones y álbumes). `plan_clean` añade los artistas que salen al limpiar y repite hasta que no cambian, para que una segunda limpieza no encuentre nada nuevo.
- **Prefijo que contiene al artista** («Daddy Yankee x Natti Natasha x Becky G»): se queda el crédito completo en vez de perderlo.
- **Etiqueta en mitad**, **«Oficial» suelto**, **extensiones** y **grupos de colaboración tras la etiqueta**: salieron de revisar la vista previa del catálogo real.

### 4. Al publicar (buzón)

- `sonidos.buzon._add` limpia título y artista **solo al crear** una canción nueva. Vale para las subidas de la web y la APK (`/api/subir`), las de la página de GitHub y las de dentro de un ZIP.
- Si la subida trae álbum de una playlist (ADR-0019), el artista se respeta (`keep_artist`): solo se limpia el título, incluido quitar el prefijo «ese artista - ».
- El id sigue siendo el SHA-256 del audio, y el nombre del archivo en el resumen no cambia. Una grabación que ya estaba no cambia de título.
- El aviso de posible duplicado del buzón (ADR-0026) compara ya el título limpio.

### 5. Arreglar las que ya están: operación `clean_titles`

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

### 6. Aviso de posible duplicado con títulos limpios

- Con los títulos limpios, «Bad Bunny - Monaco.mp3» dejaba de parecerse a «Monaco» de «Bad Bunny». Cambia la regla común de ADR-0026 en las tres capas: `backend/sonidos/duplicados.py`, `frontend/web/js/duplicates.js` y `mobile/lib/duplicates.dart`.
- **«Artista título».** Se forma con el artista normalizado, un espacio y el título normalizado; queda vacío si falta alguno de los dos (`title_with_artist`, `titleWithArtist`).
- **Cuándo coinciden los títulos.** Si el título normalizado de una canción es el «artista título» de la otra, también coinciden. Entonces el artista ya coincide: si las dos tienen duración, se diferencian como mucho 2 s; si no, basta.
- **Contrato** (`tests/contrato/duplicados.json`):
  - la regla, ampliada;
  - la lista `titulo_con_artista`;
  - 7 casos nuevos: el archivo frente a la canción limpia, con etiqueta y sin duración, la duración muy distinta, otro artista en el prefijo, el canal como artista, acentos y signos, y un título igual al artista, que no basta.
- **Dónde se usa:** en la web y la APK, «Subir canciones» (`findUploadDuplicates`); en el backend, el buzón. Cambia `js/duplicates.js`, que está en el shell, así que `SHELL_VERSION` pasa de 30 a 31 (también cubre `js/cuidador/incidencias.js`).

### 7. Vista previa

- `scripts/vista_previa_titulos.py [catalog.json] [--id S…]` lee un catálogo **local**: por defecto, el de la copia de trabajo. Escribe, por cada canción que cambiaría, su id, «antes (artista | título)» y «después», y al final el total.
- Usa `plan_clean`, la misma función que la operación. No escribe nada ni usa la red.

## Cómo se aplica

1. Fusionar en `main`. Desde ese momento, las subidas nuevas entran limpias.
2. Con `main` al día, ejecutar `python3 scripts/vista_previa_titulos.py` y revisar la lista. A 2026-11-06 da **77 de 305**.
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
  - Si el artista es un canal que no parece canal (dos palabras normales, sin marca: «king rd», «Viral Latín», «TOP SONGS», «Sisster») y el artista real no está en la biblioteca, no se toca: «TOP SONGS | KEVVO - 105 F Remix 2022 GRAMMYs».
  - Si el artista parece un canal y el título es «Canción - Subtítulo», la canción pasaría a ser el artista. No hay ninguno en el catálogo real; la vista previa lo enseñaría.
  - «Chucky73» solo sería un canal si fuera el único artista. Hoy va con otros, así que no cuenta.
  - Sin artista, la izquierda del primer separador se toma como artista aunque no lo sea: «One Piece AMV - Royalty» → artista «One Piece AMV».
  - Las partículas del «Tipo Título» se aplican también a nombres propios: «ESBARZERS (REMIX LA GOSSA SORDA)» → «Esbarzers (Remix la Gossa Sorda)». Las siglas que no están en la lista pierden las mayúsculas («BNN» → «Bnn»).
  - Todos se arreglan a mano con `edit_song`. La vista previa los enseña antes.
- **Aviso de duplicado.** Con la regla de «artista título» (sección 6), un archivo «Artista - Tema.mp3» se sigue pareciendo a «Tema» de «Artista». No cubre un prefijo con varios créditos distintos de los del catálogo («Daddy Yankee x Natti Natasha - Tema» frente al artista «Daddy Yankee»).
- **Una regla más que mantener:** cambiar una palabra de etiqueta o una partícula es cambiar el JSON y `titulos.py`. Las pruebas fallan si no coinciden.
- `clean_titles` sobre todo el catálogo es un solo commit, con un diff de 77 canciones en `catalog.json` y en `frontend/web/data/`.

## Validación

- **Backend:** `test_titulos.py` (contrato, idempotencia, `plan_clean` sobre el catálogo real, la operación, el buzón y la vista previa). Además, `test_contrato_peticiones.py` con los casos nuevos, `test_responder_incidencia.py`, y `test_buzon.py` y `test_duplicados.py` ajustados al título limpio («01 Vals» → «Vals», «Nueva [HD]» → «Nueva»). Además, `test_duplicados.py` con `titulo_con_artista` y los casos nuevos. Suite completa en verde.
- **Web:** `contrato-peticiones.test.mjs`, `api-editar.test.mjs` (`clean_titles` en `/api/editar`, sin llamar a GitHub si está mal formada) y `duplicados.test.mjs` («artista título» y el aviso de «Subir canciones»). Pruebas unitarias y de extremo a extremo en verde.
- **APK:** `duplicates_test.dart` («artista título» y `findUploadDuplicates`), más `flutter test` y `flutter analyze` en verde. El contrato marca `clean_titles` como no aplicable y la prueba lo comprueba.
- **Sin producción:** ninguna prueba habla con el Worker, R2 ni GitHub. Se comprobó antes y después que no cambian las últimas incidencias ni las ejecuciones de `buzon.yml`.
