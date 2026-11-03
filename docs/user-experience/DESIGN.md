# Reminiscencia: especificación de diseño

**Versión:** 2.0 (2026-11-03). Interfaz sin usuarios con la estructura y el aspecto del reproductor web de Spotify, decisión del propietario ([ADR-0015](../decisions/ADR-0015-interfaz-sin-usuarios-aspecto-spotify.md)).
**Sustituye** a la versión 1.0 (dos modos, perfiles, PIN y registro del estudio), que queda en el historial de git.
**Código:** `frontend/web/` (`index.html`, `css/tokens.css`, `css/app.css`, `js/`). **Pruebas:** `tests/web-unit/` y `tests/web-e2e/` (`funcional`, `a11y` y `medidas`).

Se replica la estructura y el aspecto de Spotify web. No se usan su logotipo, sus iconos de marca, sus imágenes ni su CSS: los iconos son SVG propios (`js/ui/icons.js`) y las portadas se generan con un color y un icono.

---

## 1. Alcance y principios

- Una sola biblioteca pública para todos: `data/songs.json` y `data/folders.json`, que genera el backend. No hay cuentas, perfiles, modos, PIN ni sesiones. La web abre en Inicio.
- Las listas propias y «Me gusta» se guardan solo en este navegador (IndexedDB, base `reminiscencia-biblioteca`; `js/local-library.js`).
- Las canciones subidas «Solo en este navegador» viven en su propia base (`reminiscencia-audio-local`, ADR-0012) y nunca salen del dispositivo.
- PWA sin framework ni dependencias de runtime, que funciona sin conexión (ADR-0009, decisiones 1 y 5).
- Sin scripts de terceros, analítica ni tokens. Los únicos enlaces a otro dominio abren GitHub en otra pestaña (subida al buzón e incidencias).

## 2. Colores

Tema oscuro único. Tokens en `css/tokens.css`.

| Token | Valor | Uso |
|---|---|---|
| `--bg` | `#000000` | Fondo de la página, huecos entre paneles, reproductor |
| `--surface` | `#121212` | Paneles (barra lateral y contenido) |
| `--card` | `#181818` | Tarjetas |
| `--hover` | `#282828` | Tarjeta con hover, diálogos |
| `--elevated` | `#242424` | Campo de búsqueda, chips, botones de píldora |
| `--text` | `#ffffff` | Texto principal |
| `--text-2` | `#b3b3b3` | Texto secundario, iconos inactivos |
| `--accent` | `#1fdf64` | Botón de reproducir, fila que suena, estado activo; texto negro encima |
| `--row-hover` | `rgba(255,255,255,.1)` | Fila con hover |
| `--line` | `#727272` | Pista de las barras deslizantes, bordes de botones secundarios |

Portadas: diez colores (`COVER_COLORS` en `js/catalog.js`), todos con contraste de 6:1 o más con texto blanco; «Me gusta» `#4b2bd6`, «Todas las canciones» `#1d5c4a` y «Subidas a este navegador» `#5b4636`. El color de una canción es el de su carpeta (o el de su identificador si no tiene carpeta).

Contrastes medidos: `#b3b3b3` sobre `#121212` 8,9:1 y sobre `#282828` 7,0:1; `#1fdf64` sobre `#121212` 10,5:1; negro sobre `#1fdf64` 11,8:1.

## 3. Tipografía

Figtree (SIL OFL 1.1), autoalojada en `frontend/web/fonts/figtree-{400,600,700,800}.woff2`, con la licencia en `fonts/LICENSE-figtree.txt`. Ficheros del subconjunto latino de Fontsource 5.3.0 (`@fontsource/figtree`), que cubre el español. Se precargan 400 y 700.

| Uso | Tamaño | Peso |
|---|---|---|
| Título de colección | 96 / 72 / 48 / 32 px según la longitud (hasta 14, 24 y 40 caracteres, o más); un paso menos con el contenido por debajo de 760 px; 32 px (24 px los más largos) en el teléfono | 800 |
| H1 de página y saludo | 32 px (24 px en el teléfono) | 700 |
| Título de estante | 24 px (20 px en el teléfono) | 700 |
| Inicio, Buscar, Tu biblioteca (barra lateral) | 16 px | 700 |
| Título de tarjeta | 16 px | 700 |
| Subtítulo de tarjeta, metadatos, tabla | 14 px | 400 |
| Tiempos del reproductor, artista en el reproductor | 12 px | 400 |

## 4. Marco y anchos

Anchos de referencia de las pruebas: 390 (teléfono), 820 (tableta vertical), 1024 y 1440 px (escritorio).

**Escritorio (≥ 1024 px).** Fondo `#000` y paneles redondeados (radio 8 px) separados 8 px, con 8 px de margen exterior arriba y a los lados:
- barra lateral de 280 px a la izquierda, con dos paneles (navegación y «Tu biblioteca»);
- contenido sobre `#121212`, con desplazamiento propio;
- reproductor de 72 px abajo, sobre `#000`, a todo el ancho;
- con la cola abierta, un tercer panel de 320 px a la derecha.

**Tableta (768–1023 px).** La misma estructura con la barra lateral de 240 px; la cola se abre como hoja modal.

**Teléfono (< 768 px).** Sin barra lateral ni barra de reproductor. El contenido ocupa la pantalla; abajo, la barra inferior de 64 px y, encima, el minirreproductor de 56 px. Sin desplazamiento horizontal.

## 5. Barra lateral y «Tu biblioteca»

- **Bloque superior:** «Inicio» y «Buscar», icono de 24 px y texto de 16 px, peso 700, 40 px de alto. Inactivo `#b3b3b3`, activo `#fff` con el icono relleno. La página actual lleva `aria-current="page"`.
- **Bloque «Tu biblioteca»:** encabezado (enlace a la página de la biblioteca), botones de píldora «Crear lista» y «Subir canciones» (32 px, `#242424`), chips «Listas» y «Carpetas» (32 px; activo en blanco con texto negro, `aria-pressed`; pulsar el activo lo quita) y la lista de elementos.
- **Elemento:** portada de 48 px (radio 4), título de 16 px y subtítulo de 14 px en `#b3b3b3` («Lista · 3 canciones», «Carpeta · 8 canciones»). El abierto va resaltado (`#2a2a2a`), con el título en verde y `aria-current="page"`.
- **Orden:** «Me gusta» (siempre), «Subidas a este navegador» (si hay), las listas por fecha de creación y todas las carpetas.
- **Crear lista** crea «Mi lista n.º N» (el primer número libre) y abre su página.
- En el teléfono, lo mismo está en la página «Tu biblioteca» (`#/biblioteca`).

## 6. Inicio

- **Saludo** según la hora local, como H1: de 6 a 13 h «Buenos días», de 14 a 20 h «Buenas tardes», el resto «Buenas noches».
- **Accesos rápidos:** hasta ocho tarjetas horizontales de 64 px con la portada de 64 px a la izquierda y el nombre (14 px, 16 px desde 700 px de contenido; peso 700). Columnas según el ancho del contenido: 2, 3 desde 700 px y 4 desde 1000 px. Con hover o foco aparece un botón verde de 32 px. Contenido: «Me gusta», «Todas las canciones», «Subidas a este navegador», listas y carpetas.
- **Estantes** «Carpetas» (las de la raíz), «Añadidas recientemente» (canciones) y «Tus listas», cada uno con título de 24 px, enlace «Mostrar todo» (`#/seccion/carpetas`, `recientes` o `listas`) y una fila de tarjetas con desplazamiento horizontal. Sin listas, «Tus listas» muestra una tarjeta «Crea tu primera lista» con el botón «Crear lista».
- **Tarjeta de 180 px:** relleno de 12 px, fondo `#181818`, hover `#282828`, portada cuadrada con radio 6 y sombra, título de 16 px peso 700 y subtítulo de 14 px en `#b3b3b3` (dos líneas). El botón verde circular de 48 px aparece con hover o foco en la esquina inferior derecha de la portada; si su colección suena, se queda visible con el icono de pausa. El título es un enlace que cubre la tarjeta. En las tarjetas de canción, toda la tarjeta es un botón que reproduce el estante desde esa canción.
- **«Añadidas recientemente»:** primero las canciones con fecha (las subidas a este navegador y, si el catálogo publica `added_at`, las públicas), de la más reciente a la más antigua; después el resto en orden inverso al de `songs.json`, que hoy no publica fechas.

## 7. Página de colección

Carpeta (`#/carpeta/<id>`), lista propia (`#/lista/<id>`), «Me gusta» (`#/me-gusta`), «Todas las canciones» (`#/canciones`) y «Subidas a este navegador» (`#/locales`).

- **Cabecera:** degradado del color de la portada a una mezcla con `#121212`, que continúa en el cuerpo hasta `#121212`. Portada de 232 px (radio 4, sombra), tipo («Carpeta», «Lista», «Biblioteca», «Canciones locales»), título grande (hasta 96 px, peso 800, como H1) y metadatos («Tu lista · 12 canciones · 45 min 10 s»). En el teléfono, la portada va centrada y el texto debajo.
- **Barra de acciones:** botón verde de reproducir de 56 px (pausa si esa colección suena), «Aleatorio» (icono de 32 px, `aria-pressed`, verde con un punto cuando está activo; es el aleatorio del reproductor), «Descargar para escuchar sin conexión» (o «Quitar la descarga») y, en las listas, «Más opciones» (cambiar el nombre y borrar, con confirmación).
- **Tabla:** columnas #, Título (portada de 40 px y artista debajo), Carpeta (no en las carpetas) y duración, con «Me gusta» y «Más opciones» a la derecha. Filas de 56 px; hover `rgba(255,255,255,.1)`; la que suena con el título en verde y unas barras verdes en lugar del número. «Me gusta» y «Más opciones» aparecen con hover o foco (un corazón marcado siempre se ve). Pulsar la fila o el título reproduce la colección desde esa canción. En el teléfono solo quedan la portada, el título, el artista y «Más opciones».
- **Más opciones de una canción:** «Añadir a la cola», «Añadir a una lista» (con «Nueva lista»), «Quitar de esta lista» (en una lista), «Guardar en Me gusta» o «Quitar de Me gusta», «Ir a la carpeta» y, solo en las subidas a este navegador, «Borrar de este navegador» (confirmación: «¿Borrar esta canción de este navegador? No se puede deshacer.»). Menú con `role="menu"`, flechas, Inicio, Fin y Escape.
- **Lista propia:** debajo de la tabla, «Añadir canciones a tu lista», con un campo de búsqueda y botones «Añadir».
- **Subcarpetas:** en una carpeta con carpetas dentro, un estante «Carpetas» encima de la tabla. Una carpeta sin canciones ni subcarpetas dice «Esta carpeta está vacía.».

## 8. Buscar

- H1 «Buscar» y un campo grande redondeado: 48 px de alto, radio completo, fondo `#242424`, lupa a la izquierda, «Borrar la búsqueda» a la derecha y el texto de ejemplo «¿Qué quieres escuchar?».
- Busca en título, artista, carpeta, etiquetas y año, sin distinguir mayúsculas, tildes ni diéresis (`searchCatalog` en `js/catalog.js`).
- **Con texto:** «Resultado principal» (tarjeta con portada de 92 px, título de 32 px y tipo; botón verde con hover o foco; con empate gana una carpeta o una lista), «Canciones» (las cuatro primeras, al lado en escritorio), «Más canciones», «Carpetas» y «Tus listas». Sin resultados: «No se ha encontrado nada para «…»». El número de resultados se anuncia en una región de estado.
- **Sin texto:** «Explorar todo», tarjetas de color con el nombre de cada carpeta (y «Me gusta», «Todas las canciones» y las listas).
- Al escribir solo cambian los resultados: el campo conserva el foco.

## 9. Reproductor

**Barra (≥ 768 px), 72 px sobre `#000`:**
- Izquierda: portada de 56 px (radio 4), título (14 px), artista (12 px, `#b3b3b3`) y «Me gusta».
- Centro: aleatorio, anterior, reproducir (círculo blanco de 32 px con icono negro), siguiente y repetir; debajo, tiempo actual, barra de progreso y duración. La barra mide 4 px, es blanca sobre `#727272` y verde con hover o foco, con un punto blanco de 12 px en la posición. Es un `input type="range"` con `aria-valuetext` («1:23 de 3:45»).
- Derecha: «Cola» (`aria-pressed`) y volumen (silenciar y barra de 93 px). Donde el navegador no deja cambiar el volumen (iOS), el control no aparece.
- Aleatorio y repetir activos van en verde con un punto. Repetir pasa de «Repetir: desactivado» a «toda la cola» y a «esta canción».

**Minirreproductor (< 768 px):** 56 px, radio 6, 8 px de margen lateral, justo encima de la barra inferior, con el color de la portada mezclado con `#121212`. Portada de 40 px, título y artista (botón que abre la pantalla completa), «Me gusta» y reproducir (44 px), y una línea de progreso de 2 px abajo. Solo aparece cuando hay una canción.

**Pantalla completa (teléfono):** diálogo a pantalla completa con «Cerrar el reproductor» (flecha hacia abajo), «Reproduciendo desde …», portada grande, artista, «Me gusta», progreso con tiempos, controles (reproducir de 64 px) y «Cola».

**Cola:** «Sonando», «A continuación en la cola» (lo añadido con «Añadir a la cola», en orden de llegada) y «A continuación: <colección>». Cada canción se puede pulsar para saltar a ella. Panel de 320 px en escritorio; hoja modal en tableta y teléfono.

**Reglas de reproducción (`js/player.js`):**
- Nada suena al abrir. Pulsar una fila, un botón verde o una tarjeta de canción reproduce desde esa canción.
- Con aleatorio, la canción elegida suena primero y el resto se baraja; el botón verde de una colección empieza por una al azar. Quitar el aleatorio vuelve al orden de la colección desde la canción actual.
- «Anterior» vuelve al principio si la canción lleva más de 3 s.
- Al final de la cola sin repetir, se para. Con «toda la cola» vuelve a la primera; con «esta canción» la repite.
- Lo añadido a la cola sale de ella al dejarlo atrás y se conserva al cambiar de colección.
- Sin conexión se saltan las canciones no descargadas, con aviso. Un error de reproducción avisa y pasa a la siguiente a los 3 s.
- Volumen, aleatorio y repetición se recuerdan en `localStorage` (`reminiscencia.reproductor`), solo como comodidad.
- Media Session: título, artista, colección y las teclas multimedia.

## 10. Subir canciones

El botón «Subir canciones» abre una hoja con tres opciones:

1. **Solo en este navegador.** Elegir archivos (WAV, MP3, M4A, OGG o FLAC; hasta 60 MB y 20 minutos), que se convierten a Opus y se guardan solo aquí (ADR-0012). Progreso y resultado en una región de estado, y la lista de lo subido con «Borrar» (con confirmación). Si el navegador no convierte a Opus, se dice desde el principio. Las canciones subidas aparecen en «Subidas a este navegador», en la búsqueda y en «Añadidas recientemente», con la marca «En este navegador». Con el service worker activo suenan en `audio/L….opus`, servidas desde IndexedDB por `sw.js` (ADR-0015, decisión 7).
2. **Para todos.** Abre en otra pestaña `https://github.com/seryi47/reminiscencia/upload/main/audio-library/buzon`. Instrucciones: hace falta permiso de escritura en el repositorio; la web de GitHub admite hasta 25 MB por archivo; el mensaje del commit debe llevar una línea «Licencia: …», y sin ella las canciones quedan privadas; quien sube responde de esa declaración.
3. **Desde Internet Archive.** Dirección (`https://archive.org/details/<identificador>` o un fichero de audio directo con licencia), licencia (solo para un fichero directo) y título opcional. La petición pasa la validación de `js/cuidador/incidencias.js` y la de `js/intake.js`, con la lista de bloqueo de 42 plataformas. «Abrir incidencia en GitHub» queda desactivado hasta que la petición vale y abre la incidencia nueva con la etiqueta `biblioteca` (ADR-0008).

No hay tokens ni llamadas a la API de GitHub.

## 11. Sin conexión

- `sw.js` precarga el shell (`SHELL_ASSETS` de `js/offline-core.js`, versión 5), pide los datos primero a la red y sirve el audio descargado desde la caché `reminiscencia-audio-v1`, con rangos.
- «Descargar» en la barra de acciones guarda las canciones de esa colección; pulsado otra vez, las quita.
- Sin conexión, un aviso arriba del contenido lo dice; las canciones no descargadas se ven atenuadas con «No disponible sin conexión» y el reproductor las salta. Las subidas a este navegador siempre suenan.

## 12. Accesibilidad (WCAG 2.2 AA)

- `html lang="es"`; un único H1 por pantalla (el saludo, «Buscar», «Tu biblioteca» o el título de la colección); los diálogos llevan su título en H2.
- Enlace «Saltar al contenido» como primer foco; lleva el foco al contenido sin cambiar la ruta. Al abrir la página no se mueve el foco; al cambiar de pantalla, el foco va al H1.
- Foco visible: contorno blanco de 2 px con 2 px de separación en todos los controles; en las tarjetas, alrededor de toda la tarjeta.
- Contraste de texto de 4,5:1 o más (§2). El texto de los controles desactivados está exento.
- Objetivos táctiles de 44 px o más en el teléfono: barra inferior, minirreproductor, filas (el título y el artista forman un botón de 44 px), «Más opciones», chips, botones, «Mostrar todo» y controles de diálogos y pantalla completa.
- Diálogos con `<dialog>` modal: foco atrapado, Escape y devolución del foco. Menús con `role="menu"` y teclado. Botones conmutables con `aria-pressed`. Avisos breves en una región `role="status"`.
- `prefers-reduced-motion`: sin transiciones, sin la animación de las barras de la fila que suena y sin el desplazamiento de los botones.
- Comprobado con axe-core (etiquetas wcag2a, wcag2aa y wcag22aa, sin fallos serios ni críticos) a 390, 820, 1024 y 1440 px en todas las pantallas, hojas y menús (`tests/web-e2e/a11y.e2e.mjs`). Pendiente: lectores de pantalla reales (VoiceOver, TalkBack y NVDA) y dispositivos físicos.

## 13. Contrato de `data-testid`

Las pruebas localizan la interfaz por estos identificadores.

| Zona | Identificadores |
|---|---|
| Marco | `skip-link`, `sidebar`, `sidebar-nav`, `nav-inicio`, `nav-buscar`, `sidebar-library`, `sidebar-library-link`, `sidebar-list`, `sidebar-item`, `sidebar-create-playlist`, `sidebar-upload`, `sidebar-chip-listas`, `sidebar-chip-carpetas`, `main`, `offline-banner`, `tabbar`, `tab-inicio`, `tab-buscar`, `tab-biblioteca`, `toast` |
| Inicio | `view-home`, `home-title`, `quick-grid`, `quick-tile`, `tile-play`, `shelf-folders`, `shelf-recent`, `shelf-playlists`, `<estante>-more`, `card`, `card-play`, `song-card`, `home-create-playlist` |
| Colección | `view-collection`, `collection-header`, `collection-title`, `collection-meta`, `action-bar`, `collection-play`, `collection-shuffle`, `collection-download`, `playlist-more`, `collection-empty`, `track-table`, `track-row`, `track-title`, `row-like`, `row-more`, `playlist-add-search`, `playlist-add-results`, `playlist-add-button`, `subfolders` |
| Menú | `menu`, `menu-queue`, `menu-add-playlist`, `menu-new-playlist`, `menu-playlist`, `menu-remove-playlist`, `menu-like`, `menu-folder`, `menu-delete-local`, `menu-rename`, `menu-delete-playlist` |
| Buscar | `view-search`, `search-input`, `search-clear`, `search-status`, `search-results`, `top-result`, `top-result-play`, `search-songs`, `search-more-songs`, `search-folders`, `search-playlists`, `search-empty`, `browse-grid`, `browse-tile` |
| Biblioteca | `view-library`, `library-page-list`, `library-page-item`, `library-page-create-playlist`, `library-page-upload`, `library-page-chip-*`, `view-section-*`, `section-grid` |
| Reproductor | `player-bar`, `player-cover`, `player-title`, `player-artist`, `player-like`, `player-shuffle`, `player-prev`, `player-play`, `player-next`, `player-repeat`, `player-time`, `player-progress`, `player-progress-track`, `player-duration`, `player-queue`, `player-mute`, `player-volume`, `mini-player`, `mini-open`, `mini-title`, `mini-like`, `mini-play`, `full-player`, `full-play`, `full-prev`, `full-next`, `full-shuffle`, `full-repeat`, `full-like`, `full-progress`, `full-queue`, `queue-panel`, `queue-dialog`, `queue-added`, `queue-next`, `queue-item`, `queue-close` |
| Subir | `upload-sheet`, `upload-option-local`, `upload-option-todos`, `upload-option-archive`, `upload-back`, `upload-panel-local`, `upload-pick`, `upload-file-input`, `upload-status`, `upload-support`, `upload-failures`, `upload-local-list`, `upload-delete`, `upload-panel-todos`, `upload-rules`, `upload-github-link`, `upload-panel-archive`, `archive-url`, `archive-license`, `archive-title`, `archive-status`, `archive-issue-link` |
| Diálogos | `confirm`, `confirm-ok`, `confirm-cancel`, `prompt`, `prompt-input`, `prompt-ok`, `<diálogo>-close` |

## 14. Medidas comprobadas

`tests/web-e2e/medidas.e2e.mjs`, en Chrome, con una tolerancia de ±2 px.

| Medida | Valor | Ancho |
|---|---|---|
| Barra lateral | 280 px (240 px en tableta) | 1440, 1024 |
| Radio de los paneles y separación | 8 px y 8 px | 1440 |
| Reproductor | 72 px, fondo `#000` | 1440, 820 |
| Inicio y Buscar en la barra lateral | 16 px, peso 700; `#b3b3b3` / `#fff` | 1440 |
| Portada en «Tu biblioteca» | 48 px, radio 4 | 1440 |
| Acceso rápido | 64 px de alto, portada de 64 px a la izquierda | 1440 |
| Columnas de accesos rápidos | 4 / 3 / 2 / 2 | 1440 / 1024 / 820 / 390 |
| Tarjeta | 180 px, `#181818`, hover `#282828`, título 16/700, subtítulo 14 `#b3b3b3`, portada con sombra | 1440 |
| Botón verde de tarjeta | 48 px, oculto sin hover ni foco | 1440 |
| Portada de colección | 232 px | 1440 |
| Título de colección | 96 px y peso 800 («Me gusta»); nunca más de 96 | 1440 |
| Botón verde de colección | 56 px | 1440 |
| Fila | 56 px, portada de 40 px, hover `rgba(255,255,255,.1)`, la que suena en verde | 1440 |
| Campo de búsqueda | 48 px, `#242424`, redondeado | 1440 |
| Reproductor: portada, reproducir, progreso | 56 px; círculo blanco de 32 px; 4 px, blanca y verde con hover | 1440 |
| Barra inferior | 64 px, degradado desde negro | 390 |
| Minirreproductor | 56 px, redondeado, justo encima de la barra inferior, progreso de 2 px | 390 |
| Objetivos táctiles | 44 px o más | 390 |
| Desplazamiento horizontal | ninguno | 820, 390 |

## 15. Estado y pendiente

- Implementado en `main` (ADR-0015): todas las pantallas de esta especificación, con pruebas unitarias y de extremo a extremo.
- Pendiente:
  - probar en dispositivos y con lectores de pantalla reales (§12);
  - decidir cómo se estudian las hipótesis del proyecto sin el registro del estudio que tenía la versión 1.0 (ADR-0015, consecuencias);
  - fechas de alta en el catálogo (`added_at`) para que «Añadidas recientemente» sea fiel;
  - llevar listas y «Me gusta» a otro navegador (no hay copia ni exportación).
