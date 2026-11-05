# Reminiscencia: especificación de diseño

**Versión:** 3.0 (2026-11-03). Distribución y colores del reproductor web de Spotify de 2025, con edición de canciones, portadas y álbumes. Decisión del propietario ([ADR-0015](../decisions/ADR-0015-interfaz-sin-usuarios-aspecto-spotify.md)).
**Sustituye** a la versión 2.0 (barra lateral con «Inicio» y «Buscar», sin portadas ni edición), que queda en el historial de git.
**Código:** `frontend/web/` (`index.html`, `css/tokens.css`, `css/app.css`, `js/`). **Pruebas:** `tests/web-unit/` y `tests/web-e2e/` (`funcional`, `a11y` y `medidas`).

Se replican la distribución, los colores y el comportamiento de Spotify web. No se usan su logotipo, su tipografía propia, sus iconos de marca, sus imágenes ni su CSS: el nombre «Reminiscencia» va como texto, la tipografía es Figtree y los iconos son SVG propios con el mismo estilo de trazo (`js/ui/icons.js`).

---

## 1. Alcance y principios

- Una sola biblioteca pública para todos: `data/songs.json` y `data/folders.json`, que genera el backend. Las carpetas del catálogo se llaman **«Álbumes»** en toda la interfaz; el contrato conserva sus nombres (`folder_id`, `create_folder`, `edit_folder`). No hay cuentas, perfiles, modos, PIN ni sesiones. La web abre en Inicio.
- Las listas propias y «Me gusta» se guardan solo en este navegador (IndexedDB `reminiscencia-biblioteca`; `js/local-library.js`), también la foto propia de una lista.
- «Subir canciones» sube siempre para todos, por la función `/api/subir` (ADR-0017, §12). Las canciones subidas antes «Solo en este navegador» siguen en su propia base (`reminiscencia-audio-local`, ADR-0012), nunca salen del dispositivo y se pueden borrar; ya no se guardan nuevas.
- Salvo la subida de canciones (§12), la web no escribe en la biblioteca pública (ADR-0008): editar una canción o un álbum, crear un álbum o cambiar una portada abre GitHub en otra pestaña con la petición ya escrita (§11).
- PWA sin framework ni dependencias de runtime, que funciona sin conexión. Sin scripts de terceros, analítica ni tokens en el navegador.

## 2. Colores

Tema oscuro único. Tokens en `css/tokens.css`.

| Token | Valor | Uso |
|---|---|---|
| `--bg` | `#000000` | Fondo, huecos entre paneles, barra superior y reproductor |
| `--surface` | `#121212` | Paneles («Tu biblioteca», contenido y «Reproduciendo») |
| `--elevated` | `#1f1f1f` | Botón Inicio, buscador, «+ Crear», hover de tarjetas y de elementos de la biblioteca, cabecera fija de la tabla |
| `--highlight` | `#2a2a2a` | Hover del buscador, chips, elemento abierto de la biblioteca |
| `--card` / `--card-hover` | `#181818` / `#282828` | Tarjeta del resultado principal; diálogos y menús (`#282828`) |
| `--text` / `--text-2` | `#ffffff` / `#b3b3b3` | Texto principal y secundario |
| `--accent` | `#1ed760` | Botón verde, fila que suena, estado activo; texto negro encima |
| `--separator` | `#3e3e3e` | Separadores (cabecera fija de la tabla, «Busquemos algo para tu lista», hover de menú) |
| `--tile` / `--tile-hover` | `rgba(255,255,255,.1)` / `.2` | Accesos rápidos de Inicio |
| `--row-hover` | `rgba(255,255,255,.1)` | Fila con hover |
| `--slider-track` | `#4d4d4d` | Pista de las barras deslizantes |

**Portadas generadas** (sin imagen o si la imagen no carga): diez colores (`COVER_COLORS` en `js/catalog.js`, 6:1 o más con texto blanco) con un icono propio; «Me gusta» `#4b2bd6`, «Todas las canciones» `#1d5c4a` y «Subidas a este navegador» `#5b4636`.

**Color dominante** (`js/cover-color.js`): de una portada con imagen se toma el color más representativo (cubos de 4 bits por canal, pesando los saturados) y se oscurece hasta que el blanco contraste 6:1. Lo usan la cabecera y el cuerpo de un álbum o una lista, el minirreproductor, la pantalla completa y el degradado de Inicio.

Contrastes medidos: `#b3b3b3` sobre `#121212` 8,9:1 y sobre `#282828` 7,0:1; `#1ed760` sobre `#121212` 9,8:1; negro sobre `#1ed760` 10,9:1.

## 3. Tipografía

Figtree (SIL OFL 1.1), autoalojada en `frontend/web/fonts/figtree-{400,600,700,800}.woff2`, con la licencia en `fonts/LICENSE-figtree.txt` (subconjunto latino de Fontsource 5.3.0). Se precargan 400 y 700.

| Uso | Tamaño | Peso |
|---|---|---|
| Título de álbum o lista | 96 / 72 / 48 / 32 px según la longitud (hasta 14, 24 y 40 caracteres, o más); un paso menos con el contenido por debajo de 760 px y 40/28 px por debajo de 600 px; 24 px en el teléfono | 800 |
| H1 de página («Tu biblioteca», «Mostrar todo») | 32 px (24 px en el teléfono) | 700 |
| Título de estante | 24 px (20 px en el teléfono) | 700 |
| Nombre «Reminiscencia» en la barra superior | 20 px (18 px en tableta) | 800 |
| Título de tarjeta | 16 px | 700 |
| Subtítulo de tarjeta, metadatos, tabla | 14 px | 400 |
| Tiempos y artista del reproductor | 12 px | 400 |

## 4. Marco y anchos

Anchos de referencia de las pruebas: 390 (teléfono), 820 (tableta), 1024 y 1440 px (escritorio).

**Escritorio (≥ 1024 px).** Fondo `#000`, 8 px de margen a los lados:
- **barra superior** de 64 px a todo el ancho (§5);
- debajo, **tres paneles** redondeados (radio 8) sobre `#121212`, separados 8 px: «Tu biblioteca» a la izquierda (de 280 a 420 px; por defecto `clamp(280px, 22vw, 420px)`), el contenido en el centro (con desplazamiento propio y degradado superior según la portada) y «Reproduciendo» a la derecha (300 px; oculto hasta que se abre, §10);
- **reproductor** de 72 px abajo, a todo el ancho, 8 px por debajo de los paneles.
- El borde derecho de «Tu biblioteca» es un separador (`role="separator"`, `aria-valuenow`) que se arrastra o se mueve con las flechas, Inicio y Fin; el ancho se recuerda en `localStorage` (`reminiscencia.biblioteca`).

**Tableta (768–1023 px).** La misma estructura con «Tu biblioteca» de 280 px y sin panel «Reproduciendo»: su botón abre la pantalla completa y la cola, una hoja modal. En la barra del reproductor no se ve la letra y el volumen mide 64 px.

**Teléfono (< 768 px), como la app de Spotify.** Sin barra superior, paneles ni barra del reproductor. El contenido ocupa la pantalla; abajo, la barra inferior de 64 px («Inicio», «Buscar» y «Tu biblioteca», con degradado desde negro) y, encima, el minirreproductor de 56 px. Sin desplazamiento horizontal.

## 5. Barra superior

- Izquierda: «Reminiscencia» en texto (enlace a Inicio), sin logotipo.
- Centro: botón circular de **Inicio** (48 px, `#1f1f1f`, hover `#2a2a2a`; icono relleno y blanco en Inicio, con `aria-current="page"`) y el **buscador** en pastilla: 48 px de alto, hasta 480 px de ancho, `#1f1f1f`, hover `#2a2a2a`, borde de 1 px transparente que pasa a blanco con el foco, lupa a la izquierda, «Borrar la búsqueda» cuando hay texto, separador y el botón **«Explorar»** a la derecha (lleva a Buscar sin texto). Texto de ejemplo: «¿Qué quieres reproducir?».
- Al escribir se va a Buscar y el foco sigue en el buscador; Escape lo vacía.

## 6. «Tu biblioteca»

- **Cabecera:** «Tu biblioteca» (H2, enlace a `#/biblioteca`) y el botón **«+ Crear»** (32 px, `#1f1f1f`), que abre un menú con «Lista» (crea «Mi lista n.º N» y abre su página), «Álbum» (hoja «Crear álbum», §11) y «Subir canciones» (§12), cada opción con una línea de descripción.
- **Chips** «Listas» y «Álbumes» (32 px; el activo en blanco con texto negro, `aria-pressed`; pulsar el activo lo quita).
- **Herramientas:** buscador pequeño (la lupa lo abre; filtra por nombre y por creador con la regla de búsqueda de §9.1, sin cambiar el orden elegido; Escape lo cierra) y el orden: «Recientes» (lo último que ha sonado primero; se guarda en `localStorage`, `reminiscencia.recientes`), «Orden alfabético» o «Creador». «Me gusta» queda fijada arriba en todos los órdenes.
- **Elemento:** 64 px de alto, portada de 48 px (radio 4; serían circulares solo los artistas, que no hay), título de 16 px y subtítulo de 14 px en `#b3b3b3`: «Lista • Reminiscencia», «Álbum • <artista>» (o «Álbum • Reminiscencia» sin artista), «Lista • 3 canciones» en «Me gusta». Hover `#1f1f1f`; el abierto en `#2a2a2a` con `aria-current="page"`; el que suena, con el título en verde y un altavoz verde.
- En el teléfono, lo mismo está en la página «Tu biblioteca» (`#/biblioteca`), con el título como H1.

## 7. Inicio

- **H1 «Inicio»** solo para lectores de pantalla (Spotify no muestra saludo).
- **Chips** «Todo» y «Música» arriba. «Música» deja los accesos rápidos de álbumes y los estantes de álbumes y canciones; pulsarlo otra vez vuelve a «Todo».
- **Accesos rápidos:** hasta ocho, en 4 columnas desde 600 px de contenido y 2 por debajo; tarjetas de 48 px de alto (56 px en el teléfono) con la portada a la izquierda, fondo `rgba(255,255,255,.1)` y hover `.2`, y un botón verde de 32 px con hover o foco (unas barras verdes si esa colección suena). Primero lo escuchado hace poco; después «Me gusta», «Todas las canciones», las listas y los álbumes. Con el ratón o el foco encima, el degradado de Inicio toma el color de ese acceso.
- **Estantes** «Escuchado recientemente» (si hay), «Álbumes», «Añadidas recientemente» y «Tus listas», con título de 24 px y «Mostrar todo» (`#/seccion/albumes`, `recientes` o `listas`; `#/seccion/carpetas` sigue valiendo). Sin listas, «Tus listas» muestra «Crea tu primera lista».
- **Tarjeta** de 180 px (152 px en el teléfono): sin fondo visible hasta el hover (`#1f1f1f`), portada con radio 6 y sombra, título de 16 px peso 700 y subtítulo de 14 px en `#b3b3b3` (el artista de un álbum, la descripción de una lista). El botón verde de 48 px aparece con hover o foco y sube 8 px; si su colección suena, se queda visible con el icono de pausa. El título es un enlace que cubre la tarjeta; en las de canción, toda la tarjeta es un botón.

## 8. Página de álbum o lista

Álbum (`#/album/<id>`; la ruta anterior `#/carpeta/<id>` sigue valiendo), lista propia (`#/lista/<id>`), «Me gusta», «Todas las canciones», «Subidas a este navegador» y «Tus subidas» (`#/subidas`, las que se están publicando; §12).

- **Cabecera:** degradado del color dominante de la portada a una mezcla con `#121212`, que sigue en el cuerpo hasta `#121212`. Portada de 232 px (radio 4, sombra grande), tipo («Álbum», «Lista», «Biblioteca», «Canciones locales»), título enorme como H1 (hasta 96 px, peso 800, se reduce si es largo), descripción de la lista si la tiene y metadatos: «<artista> • <año> • 8 canciones, 23 min 10 s» en un álbum (el año más repetido entre sus canciones) y «Reminiscencia • 3 canciones, …» en una lista. En un álbum o una lista, la portada es el botón «Editar detalles» (lápiz al pasar el ratón).
- **Barra de acciones:** botón verde de 56 px (pausa si esa colección suena), «Aleatorio» (es el del reproductor, `aria-pressed`, verde con un punto), «Me gusta» (marca o quita todas las canciones de la colección; no en «Me gusta»), «Descargar para escuchar sin conexión» y «···»: «Añadir a la cola», «Editar detalles» y, en un álbum F (§11), «Cambiar portada»; en una lista, «Borrar la lista» (con confirmación). En el teléfono, como en la app: «Me gusta», descargar y «···» a la izquierda; aleatorio y reproducir a la derecha.
- **Tabla:** cabecera fija (#, Título, Álbum —no en la página de un álbum— y un reloj); al quedarse arriba toma fondo `#1f1f1f` y separador `#3e3e3e`. Filas de 56 px, hover `rgba(255,255,255,.1)` (el número pasa a un triángulo de reproducir); la que suena con el título en verde y barras verdes. Portada de 40 px en las filas, salvo en un álbum. «Me gusta» y «Más opciones» aparecen con hover o foco. En el teléfono solo quedan la portada, el título, el artista y «Más opciones».
- **Más opciones de una canción:** «Añadir a una lista» (con «Nueva lista»), «Quitar de esta lista», «Guardar en Me gusta», «Añadir a la cola», «Ir al álbum», y en las públicas «Editar detalles», «Añadir a un álbum» y «Cambiar portada» (§11); en las subidas a este navegador, «Borrar de este navegador». Menú con `role="menu"`, flechas, Inicio, Fin y Escape; al abrir una hoja desde el menú, el foco vuelve después a «Más opciones».
- **Lista propia:** debajo de la tabla, «Busquemos algo para tu lista», con un campo y botones «Añadir».
- **Portada de una lista:** la foto propia; si no tiene, un mosaico de cuatro portadas distintas de sus canciones, o la primera que haya, o la generada.
- En el teléfono, un botón «Atrás» arriba a la izquierda.

## 9. Buscar

- En escritorio y tableta se escribe en el buscador de la barra superior; la página no repite el campo y su H1 «Buscar» es solo para lectores de pantalla. En el teléfono, la página tiene su H1 y un campo de 48 px.
- Busca canciones (título, artista, álbum, año y etiquetas), álbumes (nombre y artista) y listas propias (nombre) con la regla de §9.1 (`searchCatalog` en `js/catalog.js`).
- **Con texto:** chips «Todo», «Canciones», «Álbumes» y «Listas»; en «Todo», «Resultado principal» (tarjeta `#181818`, hover `#282828`, portada de 92 px, título de 32 px, «Álbum • artista» y botón verde que sube), «Canciones» (las cuatro primeras), «Más canciones», «Álbumes» y «Tus listas». Sin resultados: «No se ha encontrado nada para «…»». El número de resultados se anuncia en una región de estado.
- **Sin texto:** «Explorar todo», tarjetas de color con el nombre y la portada girada en la esquina.

### 9.1 Regla de búsqueda (todos los buscadores)

Una sola regla para todos los buscadores de la web y de la APK ([ADR-0028](../decisions/ADR-0028-contrato-comun-y-busqueda.md)): Buscar, «Buscar en esta colección», «Añadir canciones» de un álbum, «Busquemos algo para tu lista» y el filtro de Tu biblioteca. Está pensada para personas mayores que escriben con erratas, sin llenar la lista de ruido.

- **Sin mayúsculas, tildes ni signos.** «¡CORAZÓN!» busca lo mismo que «corazon»; «ñandu» encuentra «Ñandú»; los signos (apóstrofos, barras, comas) separan palabras.
- **Todas las palabras.** Cada palabra escrita tiene que aparecer en algún campo, en cualquier orden: «rosendo mimbre» encuentra «Corazón de mimbre» de Rosendo; «rock and roll» no encuentra «Rock'n'roll» porque falta «and».
- **Por el principio de la palabra.** «superstar» encuentra «SUPERSTARS» y «195» encuentra los años 1950 a 1959; «ton» no encuentra «Charleston» (no se busca en mitad de una palabra).
- **Una errata, desde 4 letras.** En palabras de 4 o más caracteres con alguna letra se perdona una errata (una letra de más, de menos, cambiada o dos seguidas intercambiadas) frente a la palabra o frente a su principio: «charlston», «orqeusta», «castilos». En las palabras cortas y en los números, no: «kxo» no encuentra «Keo» y «1952» no encuentra 1953.
- **Campos.** Canción: título, artista, nombre de su álbum, año y etiquetas. Álbum: nombre y artista. Lista: nombre. Tu biblioteca: título y creador.
- **Orden por relevancia.** Palabra igual, 3 puntos; principio de palabra, 2; con errata, 1. Se multiplican por el peso del campo (título o nombre ×3, artista o creador ×2, el resto ×1) y se suman; si el título entero es la consulta, +100, y si empieza por ella, +50. De más a menos puntos y, con los mismos, en el orden de la lista. Así, «mimbre» pone primero la canción que se llama «Mimbre» y «casa» pone «Casa» antes que «Castillos en el aire». Tu biblioteca es la excepción: conserva el orden elegido (Recientes, alfabético o creador).
- **Sin texto.** Los filtros enseñan todo en su orden; Buscar enseña «Explorar todo».
- **Código y pruebas.** Web: `searchRank`, `searchScore` y `normalizeText` en `js/catalog.js`. APK: `searchRank`, `searchScore` y `foldForSearch` en `lib/fuzzy_search.dart`. Los casos comunes están en `tests/contrato/busqueda.json` y los ejecutan `tests/web-unit/busqueda-contrato.test.mjs` y `mobile/test/busqueda_contrato_test.dart`.

## 10. Reproductor y «Reproduciendo»

**Barra (≥ 768 px), 72 px sobre `#000`:**
- Izquierda: portada de 56 px (radio 4), título (14 px, enlace al álbum), artista (12 px, `#b3b3b3`) y «Me gusta».
- Centro: aleatorio, anterior, reproducir (círculo blanco de 32 px con icono negro), siguiente y repetir; debajo, tiempo, barra de progreso y duración. La barra mide 4 px, blanca sobre `#4d4d4d`, verde con hover o foco y con un punto blanco de 12 px. Es un `input type="range"` con `aria-valuetext` («1:23 de 3:45»).
- Derecha: «Reproduciendo» (`aria-pressed`), letra (desactivado: «Letra (no disponible)»), «Cola» (`aria-pressed`), dispositivo (oculto), volumen (silenciar y barra de 93 px; no aparece donde no se puede cambiar, iOS) y «Pantalla completa».

**Panel «Reproduciendo» (≥ 1024 px, 300 px):** título (el nombre de la colección), portada grande a todo el ancho (radio 8), título de 24 px, artista y «Me gusta», y «Siguiente en la cola» con la siguiente canción y «Abrir la cola». «Cola» muestra la cola en el mismo panel: «Sonando», «A continuación en la cola» (lo añadido) y «A continuación de: <colección>». Abierto o cerrado se recuerda en `localStorage` (`reminiscencia.panel`).

**Minirreproductor (< 768 px):** 56 px, radio 6, con el color dominante de la portada, justo encima de la barra inferior: portada de 40 px, título y artista (botón que abre la pantalla completa), «Me gusta» y reproducir (44 px), y una línea de progreso de 2 px.

**Pantalla completa:** diálogo con el degradado del color de la portada, «Cerrar el reproductor», «Reproduciendo desde …», portada grande, artista, «Me gusta», progreso con tiempos, controles (reproducir de 64 px) y «Cola». «Pantalla completa» de la barra lo abre y pide al navegador pantalla completa.

**Reglas de reproducción (`js/player.js`):** nada suena al abrir; con aleatorio, la elegida suena primero; «Anterior» vuelve al principio si la canción lleva más de 3 s; al final de la cola sin repetir, se para; lo añadido a la cola se conserva al cambiar de colección; sin conexión se saltan las no descargadas, con aviso. Volumen, aleatorio y repetición se recuerdan en `localStorage` (`reminiscencia.reproductor`). Media Session con título, artista, colección, portada y teclas multimedia.

## 11. Editar canciones, álbumes y portadas

**Contrato con el backend.** Canción: campo opcional `"cover": "covers/<id>.jpg"` en `data/songs.json`. Álbum: campos opcionales `"artist"` y `"cover": "covers/<id>.jpg"` en `data/folders.json`. Solo aparecen cuando tienen valor; cualquier otra forma de `cover` se ignora (`normalizeCoverPath`). Sin portada, o si no carga, se ve la generada. Una canción sin portada usa la de su álbum. Las portadas se guardan al verse en la caché `reminiscencia-portadas-v1` del service worker.

**Identificadores de álbum.** Nuevos: «F» + 16 hexadecimales; antiguos: 10 hexadecimales. Los dos valen en `folder_id`; solo los F admiten portada, así que «Cambiar portada» solo aparece en canciones (S + 16) y álbumes F.

**Hojas** (`js/views/edit.js`, con el aspecto del «Editar detalles» de Spotify: portada de 180 px a la izquierda y campos a la derecha). Cada una abre una incidencia nueva de GitHub con la etiqueta `biblioteca` y la petición validada con las reglas del backend (`js/cuidador/incidencias.js`: nombre de álbum de 1 a 80 caracteres, artista de álbum de 0 a 80, título de canción de 1 a 200, artista de canción de 0 a 200, una sola línea). «Abrir en GitHub» queda desactivado hasta que la petición vale y hay algo que cambiar; cada campo con error se marca. Todas dicen que hace falta permiso de escritura en el repositorio y que el cambio llega a todos en un par de minutos.

| Hoja | Desde | Petición |
|---|---|---|
| Editar detalles (canción) | «Más opciones» de la fila | `{"op":"edit_song","song_id":…,"title":…,"artist":…}` |
| Añadir a un álbum | «Más opciones» de la fila | `{"op":"edit_song","song_id":…,"folder_id":…}` (`null`: «Sin álbum») |
| Quitar de este álbum | «Más opciones» de una fila, dentro de un álbum (pide confirmación) | `{"op":"edit_song","song_id":…,"folder_id":null}`: la canción sigue en la biblioteca (ADR-0023) |
| Añadir canciones (álbum) | «···» del álbum | Buscador con casillas; varias canciones en una petición: `{"op":"move_songs","song_ids":[…],"folder_id":…}` (ADR-0023) |
| Seleccionar (álbum) | Botón «Seleccionar» de la barra del álbum o «···» › «Seleccionar canciones» | Casillas, contador, «Seleccionar todo»/«Ninguna». «Quitar del álbum» (confirma): `{"op":"move_songs","song_ids":[…],"folder_id":null}`; «Mover a otro álbum»: `{"op":"move_songs",…,"folder_id":"F…"}` (ADR-0026) |
| Ordenar canciones (álbum) | «···» del álbum (dos canciones o más) | Lista con «Subir»/«Bajar» (44 px; se anuncia «X ahora es la N de M»); «Guardar orden»: `{"op":"order_album","folder_id":…,"song_ids":[…lista completa…]}` (ADR-0026). Las canciones de un álbum se ordenan por su número de pista `track`. |
| Editar detalles (álbum) | «···» del álbum o su portada | `{"op":"edit_folder","folder_id":…,"name":…,"artist":…}` |
| Crear álbum | «+ Crear» › «Álbum» | `{"op":"create_folder","name":…,"artist":…}` (`artist` solo si se escribe) |
| Cambiar portada | «Más opciones», «···» o la hoja de detalles | Abre `https://github.com/seryi47/reminiscencia/upload/main/audio-library/buzon/portadas` |

«Cambiar portada» muestra el ID que hay que usar como nombre del archivo (con «Copiar el ID») y las reglas: JPG, PNG o WebP de hasta 10 MB; se recorta al centro a 640 × 640.

**Listas propias** (solo en este navegador): «Editar detalles» desde la portada o «···»: «Elegir foto» (JPG, PNG o WebP del dispositivo, hasta 20 MB; se recorta en cuadrado y se reduce a 640 px en el navegador, `js/cover-image.js`, y se guarda en la lista como JPEG en `data:`, porque la CSP admite imágenes de `'self'` y `data:`, no `blob:`), «Quitar foto», nombre (hasta 100 caracteres) y descripción opcional (una línea, hasta 300). «Guardar» en blanco.

## 12. Subir canciones

«+ Crear» › «Subir canciones» abre una hoja con una sola forma de subir (ADR-0017): «Elegir archivos» (WAV, MP3, M4A, FLAC, OGG u OPUS, o archivos ZIP con canciones; uno o varios, mezclados y sin límite de tamaño), el texto fijo «Al subir, declaras que tienes derecho a publicar estos archivos» y, debajo, el estado de cada subida, como en Spotify. El título de la canción es el nombre del archivo sin extensión.

- **Una fila por archivo** (`upload-item`, con `data-state`): icono del paso, nombre del archivo (una línea con elipsis; entero en `title`), el paso en texto y una barra de 4 px en verde. Pasos: «En cola» → «Convirtiendo a Opus…» → «Subiendo… 45 %» (por trozos de 4 MiB) → «Guardada en GitHub» → «Publicándose… (suele tardar 2–3 minutos)» (barra sin porcentaje, en movimiento) → «Publicada» (en verde, con «Reproducir»). Si algo falla: «Error: <motivo>» (en rojo claro, con un icono de aviso y «Reintentar»). Si a los 10 minutos aún no aparece, muestra «Aún no aparece en la biblioteca; seguiremos comprobando» y consulta el catálogo cada minuto hasta resolverlo.
- **Archivos ZIP:** el navegador lee el directorio central de cada ZIP (`js/cuidador/zip.js`, sin librerías: entradas «stored» y «deflate» con `DecompressionStream('deflate-raw')`, ZIP64, CRC-32 comprobado) y saca todas las canciones de audio, también las de subcarpetas; ignora carpetas, `__MACOSX/`, lo oculto (lo que empieza por «.») y lo que no es audio. Cada canción es una subida más (mismo flujo y mismos pasos), con el nombre de su archivo dentro del ZIP sin ruta ni extensión como título, y se descomprime solo cuando le toca en la cola, de una en una (`js/cuidador/subida-zip.js`). Las rutas del ZIP solo sirven para sacar el nombre base. El ZIP no se sube nunca y se suelta en cuanto cada canción está en GitHub. En la hoja, cada ZIP es un grupo (`upload-group`): cabecera con icono «Álbum.zip: 12 canciones» (`upload-group-title`), «Se ignoraron 3 archivos que no son canciones…» si hay (`upload-group-note`) y una fila por canción, un poco sangradas; las canciones sueltas van fuera de los grupos. Un ZIP dañado, en varias partes o sin canciones es una sola fila con su error («Error: El archivo ZIP está dañado o no es un ZIP válido.»), sin «Reintentar»; una canción cifrada dentro del ZIP falla en su fila («Está cifrada con contraseña dentro del ZIP…») y las demás siguen.
- **Resumen** arriba de las filas: «2 de 3 publicadas», con «· 1 con error» o «· 1 sigue procesándose» si los hay.
- **«Publicada» es de verdad:** tras guardarse en GitHub se pide `data/songs.json` cada 15 s con `cache: 'no-store'` y se da por publicada cuando aparece una canción con un id que no estaba antes de subir y con ese título (o el que dio el buzón, por ejemplo «Tono (2)»). El id de la canción sale del contenido (`S` + SHA-256[:16] del Opus enviado), así que una canción que el buzón ya tenía se reconoce con exactitud, y al reabrir la web una subida con error cuyo Opus ya está publicado se da por resuelta. Si no, una pista ya existente de una playlist se reconoce solo cuando coinciden el ID estable de esa playlist, el título y el artista; se muestra «Ya estaba en la biblioteca». Así, una canción que solo comparte título no cuenta.
- **Ya en la biblioteca:** en cuanto termina la conversión, el Opus se guarda en este navegador (`reminiscencia-audio-local`, marcado como pendiente) y la canción sale en «Tus subidas» (`#/subidas`, en «Tu biblioteca» debajo de «Me gusta»), en «Añadidas recientemente» y en «Todas las canciones», con la etiqueta verde «Publicándose…» (o «No se ha podido subir») en lugar del artista. Suena ya, desde `audio/L….opus`. Al publicarse se sustituye por la pública sin recargar: en la biblioteca, en «Me gusta», en las listas y en la cola; lo que suena no se corta y la copia local se borra en cuanto deja de sonar.
- **Al cerrar la hoja, las subidas siguen** (el gestor vive en la app, `js/cuidador/subida-estado.js`): al pie de «Tu biblioteca» queda un indicador discreto, «Publicándose 1 canción» (`upload-indicator`, abre la hoja), y al publicarse llega el aviso «“<título>” ya está en la biblioteca». Las pendientes se guardan en `localStorage` (`reminiscencia.subidas`; si el navegador no deja, valen durante la visita): al volver a abrir la página se siguen comprobando y las que se cortaron a medias quedan con «Reintentar», que reenvía la copia local. Con un archivo convirtiéndose o subiéndose, el navegador pregunta antes de cerrar la página.
- **Accesibilidad:** cada cambio de paso (no cada porcentaje) se anuncia en una región `aria-live="polite"` («Tono.wav: Publicada»); el paso va siempre en texto, además del icono y el color; al pulsar «Reintentar», el foco pasa a su fila; «Reproducir» y «Reintentar» llevan el nombre en su etiqueta.
- **Guardadas solo en este navegador:** las canciones subidas antes solo aquí (ADR-0012) siguen sonando y se borran desde la hoja (solo se ve si hay alguna).
- **Importar desde Internet Archive:** dirección, licencia (solo en un fichero directo) y título opcional, validados por `incidencias.js` e `intake.js` con la lista de bloqueo de 42 plataformas (ADR-0008); abre la incidencia en GitHub.

Quien tiene permiso de escritura puede seguir subiendo desde la página de GitHub del buzón con una línea «Licencia: …» (ADR-0014); la hoja ya no la abre.

Antes de la cola, cada archivo se compara con la biblioteca y con los de la misma tanda; si parece repetido (regla común de `tests/contrato/duplicados.json`), el diálogo «Posible duplicado» pregunta «Subir igualmente» / «Quitar de la cola» (ADR-0026).

## 13. Sin conexión

- `sw.js` precarga el shell (`SHELL_ASSETS` de `js/offline-core.js`, versión 10), pide los datos (`data/*.json`) siempre primero a la red y sin la caché HTTP (`cache: 'no-store'`; la copia guardada solo responde sin conexión), guarda las portadas al verse y sirve el audio descargado desde `reminiscencia-audio-v1`, con rangos. Al llegar una versión nueva, la página se recarga una vez (`js/pwa.js`).
- «Descargar» guarda las canciones de esa colección; pulsado otra vez, las quita. Sin conexión, un aviso arriba del contenido lo dice y las no descargadas se ven atenuadas.

## 14. Accesibilidad (WCAG 2.2 AA)

- `html lang="es"`; un único H1 por pantalla (en Inicio y, en escritorio, en Buscar, solo para lectores de pantalla); los diálogos llevan su título en H2.
- Enlace «Saltar al contenido» como primer foco. Al abrir la página no se mueve el foco; al cambiar de pantalla, el foco va al H1 (salvo si se está escribiendo en el buscador de la barra superior).
- Foco visible: contorno blanco de 2 px en todos los controles; en las tarjetas, alrededor de toda la tarjeta; en el buscador de la barra superior, el borde pasa a blanco.
- Contraste de texto de 4,5:1 o más (§2); el texto sobre un color dominante, 6:1 con blanco.
- Objetivos táctiles de 44 px o más en el teléfono (barra inferior, minirreproductor, filas, chips, «+ Crear», orden, botones, menús, hojas y pantalla completa).
- `<dialog>` modal con foco atrapado, Escape y devolución del foco; menús con `role="menu"` (opciones de orden con `menuitemradio`); botones conmutables con `aria-pressed`; separador con `aria-valuenow`; avisos en `role="status"`.
- `prefers-reduced-motion`: sin transiciones, sin animación de barras y sin escalados ni desplazamientos de botones.
- Comprobado con axe-core (wcag2a, wcag2aa y wcag22aa, sin fallos serios ni críticos) a 390, 820, 1024 y 1440 px en todas las pantallas, hojas y menús (`tests/web-e2e/a11y.e2e.mjs`). Pendiente: lectores de pantalla reales y dispositivos físicos.

## 15. Contrato de `data-testid`

| Zona | Identificadores |
|---|---|
| Marco | `skip-link`, `topbar`, `brand`, `nav-inicio`, `top-search`, `top-search-input`, `top-search-clear`, `nav-buscar` (Explorar), `sidebar`, `library-resize`, `main`, `now-panel`, `offline-banner`, `tabbar`, `tab-inicio`, `tab-buscar`, `tab-biblioteca`, `toast` |
| Tu biblioteca | `sidebar-library-link`, `sidebar-list`, `sidebar-item`, `sidebar-create`, `sidebar-chip-listas`, `sidebar-chip-albumes`, `sidebar-search-toggle`, `sidebar-filter`, `sidebar-sort`; en la página, lo mismo con `library-page-` (`library-page-list`, `library-page-item`…) y `view-library` |
| Inicio | `view-home`, `home-title`, `home-chip-todo`, `home-chip-musica`, `quick-grid`, `quick-tile`, `tile-play`, `shelf-recently-played`, `shelf-albums`, `shelf-recent`, `shelf-playlists`, `<estante>-more`, `card`, `card-play`, `song-card`, `home-create-playlist`, `view-section-*`, `section-grid` |
| Colección | `view-collection`, `page-back`, `collection-header`, `collection-edit`, `collection-title`, `collection-description`, `collection-meta`, `action-bar`, `collection-play`, `collection-shuffle`, `collection-like`, `collection-download`, `collection-more`, `collection-empty`, `track-table`, `track-row`, `track-title`, `row-like`, `row-more`, `playlist-add-search`, `playlist-add-results`, `playlist-add-button`, `subfolders` |
| Menús | `menu`, `menu-create-playlist`, `menu-create-album`, `menu-upload`, `menu-sort-*`, `menu-queue`, `menu-add-playlist`, `menu-new-playlist`, `menu-playlist`, `menu-remove-playlist`, `menu-like`, `menu-album`, `menu-edit-song`, `menu-move-album`, `menu-song-cover`, `menu-delete-local`, `menu-queue-all`, `menu-edit-details`, `menu-album-cover`, `menu-delete-playlist` |
| Buscar | `view-search`, `search-input`, `search-clear`, `search-status`, `search-results`, `search-chip-*`, `top-result`, `top-result-play`, `search-songs`, `search-more-songs`, `search-albums`, `search-playlists`, `search-albumes-grid`, `search-listas-grid`, `search-empty`, `browse-grid`, `browse-tile` |
| Reproductor | `player-bar`, `player-cover`, `player-title`, `player-artist`, `player-like`, `player-shuffle`, `player-prev`, `player-play`, `player-next`, `player-repeat`, `player-time`, `player-progress`, `player-progress-track`, `player-duration`, `player-now`, `player-lyrics`, `player-queue`, `player-device`, `player-mute`, `player-volume`, `player-fullscreen`, `now-panel-title`, `now-panel-body`, `now-close`, `now-track`, `now-like`, `now-next`, `now-open-queue`, `queue-added`, `queue-next`, `queue-item`, `queue-dialog`, `mini-player`, `mini-open`, `mini-title`, `mini-like`, `mini-play`, `full-player`, `full-play`, `full-prev`, `full-next`, `full-shuffle`, `full-repeat`, `full-like`, `full-progress`, `full-queue` |
| Edición | `edit-song`, `edit-song-title`, `edit-song-artist`, `edit-song-cover`, `edit-song-link`, `edit-album`, `edit-album-name`, `edit-album-artist`, `edit-album-cover`, `edit-album-link`, `create-album`, `create-album-name`, `create-album-artist`, `create-album-link`, `move-album`, `move-album-option`, `move-album-link`, `<hoja>-link-status`, `edit-note`, `cover-sheet`, `cover-id`, `cover-copy`, `cover-rules`, `cover-github-link`, `playlist-edit`, `playlist-edit-choose`, `playlist-edit-file`, `playlist-edit-remove-photo`, `playlist-edit-name`, `playlist-edit-description`, `playlist-edit-status`, `playlist-edit-save` |
| Subir | `upload-sheet`, `upload-panel`, `upload-pick`, `upload-file-input`, `upload-rights`, `upload-support`, `upload-status`, `upload-summary`, `upload-items`, `upload-group`, `upload-group-title`, `upload-group-note`, `upload-item` (con `data-state`), `upload-item-name`, `upload-item-status`, `upload-item-progress`, `upload-item-play`, `upload-item-retry`, `upload-live`, `upload-indicator`, `track-pending`, `upload-local`, `upload-local-list`, `upload-delete`, `upload-open-archive`, `upload-back`, `upload-panel-archive`, `archive-url`, `archive-license`, `archive-title`, `archive-status`, `archive-issue-link` |
| Álbumes (ADR-0023) | Quitar: `menu-remove-from-album`, `remove-from-album`, `remove-from-album-text`, `remove-from-album-cancel`, `remove-from-album-save`, `remove-from-album-save-status`, `remove-from-album-close`. Añadir: `album-add-songs`, `menu-album-add-songs`, `album-add`, `album-add-search`, `album-add-count`, `album-add-results`, `album-add-option` y `album-add-check` (con `data-song-id`), `album-add-empty`, `album-add-save`, `album-add-save-status`, `album-add-close` |
| Álbumes, selección y orden (ADR-0026) | `album-select`, `album-select-panel`, `album-select-count`, `album-select-all`, `album-select-none`, `album-select-remove`, `album-select-move`, `album-select-cancel`, `album-select-list`, `album-select-option`, `album-select-check`, `menu-album-select`, `menu-album-order`, `album-remove-many(-text/-save/-cancel)`, `album-move-many(-option/-save)`, `album-order`, `album-order-list`, `album-order-row`, `album-order-up`, `album-order-down`, `album-order-live`, `album-order-save(-status)`, `album-order-too-many` |
| Duplicados (ADR-0026) | `duplicate-dialog`, `duplicate-file`, `duplicate-message`, `duplicate-keep`, `duplicate-drop` |
| Diálogos | `confirm`, `confirm-ok`, `confirm-cancel`, `prompt`, `prompt-input`, `prompt-ok`, `<diálogo>-close` |

## 16. Medidas comprobadas

`tests/web-e2e/medidas.e2e.mjs`, en Chrome, con una tolerancia de ±2 px.

| Medida | Valor | Ancho |
|---|---|---|
| Barra superior | 64 px; nombre a la izquierda; Inicio de 48 px `#1f1f1f`; buscador de 48 × 480 px `#1f1f1f`, hover `#2a2a2a`, borde de 1 px transparente y blanco con foco; lupa, campo y Explorar en ese orden | 1440 |
| Paneles | radio 8, `#121212`, separados 8 px, empiezan en y = 64; Tu biblioteca entre 280 y 420 px (el separador llega a 280 y 420) | 1440, 1024 |
| Reproductor | 72 px, `#000`, a todo el ancho y 8 px por debajo de los paneles | 1440, 820 |
| Tu biblioteca | «Crear» de 32 px `#1f1f1f` con Lista, Álbum y Subir canciones; chips Listas y Álbumes; «Recientes»; elementos de 64 px, portada de 48 px y radio 4; subtítulos «Lista • Reminiscencia» y «Álbum • <artista>»; abierto en `#2a2a2a` | 1440 |
| Inicio | chips Todo y Música (el elegido blanco y negro); accesos de 48 px en 4 columnas, `rgba(255,255,255,.1)` y hover `.2` | 1440 |
| Columnas de accesos rápidos | 4 / 4 / 2 / 2 | 1440 / 1024 / 820 / 390 |
| Tarjeta | sin fondo, hover `#1f1f1f`, portada con radio 6 y sombra, título 16/700, subtítulo 14 `#b3b3b3`; botón verde de 48 px, oculto sin hover, sube 8 px | 1440 |
| Álbum | degradado hasta `#121212`; portada de 232 px con sombra; «Álbum»; título de 96 px y peso 800 («Me gusta»), menor si es largo; botón verde de 56 px; acciones en orden; columnas #, Título y reloj (y Álbum en una lista); cabecera `sticky`, fija arriba con separador `#3e3e3e`; filas de 56 px, hover `rgba(255,255,255,.1)`, la que suena en `#1ed760` | 1440 |
| Resultado principal | `#181818`, hover `#282828` | 1440 |
| Reproductor | portada de 56 px; círculo blanco de 32 px; progreso de 4 px blanco y verde con hover, con punto blanco; controles del centro y de la derecha en orden; dispositivo oculto | 1440 |
| Reproduciendo | 300 px, 8 px a cada lado, `#121212`, radio 8, portada cuadrada a todo el ancho, título de 24 px | 1440, 1024 |
| Barra inferior | 64 px, degradado desde negro, tres destinos | 390 |
| Minirreproductor | 56 px, redondeado, color de la portada, justo encima de la barra inferior, progreso de 2 px | 390 |
| Objetivos táctiles | 44 px o más | 390 |
| Desplazamiento horizontal | ninguno | 1024, 820, 390 |

## 17. Estado y pendiente

- En `main` (merge `315a7c3` de `feat/web-spotify-2`), con pruebas unitarias y de extremo a extremo. El backend de `edit_folder`, `artist` y el buzón de portadas está en `main` (merge `aba83c2`, ADR-0016). La hoja «Subir canciones» de §12 es la de ADR-0017 (merge `d68add5`).
- Pendiente:
  - probar en dispositivos y con lectores de pantalla reales (§14);
  - fechas de alta en el catálogo (`added_at`) para que «Añadidas recientemente» sea fiel;
  - llevar listas, fotos y «Me gusta» a otro navegador (no hay copia ni exportación).
