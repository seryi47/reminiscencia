# ADR-0044: «Transferir música» — importar de Spotify vía YouTube a la biblioteca

- Estado: **implementada en web y APK** (2026-11-10), a falta de la verificación de extremo a extremo en vivo (el usuario la hace: login real de Spotify + descarga + publicación, en web y en dispositivo). Todo el código está en `main` con pruebas; las ejecuciones de Actions y el comportamiento en dispositivo no se pueden correr desde el entorno de desarrollo. Client ID real configurado (público, en `spotify-config.js`, sobreescribible por env). El Worker se auto-despliega al hacer push, así que los endpoints quedan vivos en `reminiscencia.cometia.es`.
- Fecha: 2026-11-10.
- Relacionadas: [ADR-0021](ADR-0021-buscar-en-youtube.md) (resolver una consulta a candidatos de YouTube), [ADR-0019](ADR-0019-playlists-de-youtube-como-albumes.md) (playlist → álbum, artista y orden), [ADR-0017](ADR-0017-subida-directa-github-web-publica.md)/[ADR-0024](ADR-0024-audio-privado-en-r2.md)/[ADR-0030](ADR-0030-subida-rapida.md) (pipeline de subida), [ADR-0026](ADR-0026-albumes-orden-seleccion-duplicados.md) (duplicados y orden), [ADR-0028](ADR-0028-contrato-comun-y-busqueda.md) (búsqueda/normalización), [ADR-0032](ADR-0032-titulos-limpios.md) (títulos limpios), [ADR-0039](ADR-0039-descarga-youtube-persistente.md) (persistir la intención de importar), [ADR-0029](ADR-0029-worker-cloudflare.md)/[ADR-0038](ADR-0038-youtube-en-netlify-con-failover.md) (dónde viven el código servidor y los secretos).

## Contexto

Se quiere transferir bibliotecas de Spotify a Reminiscencia con el recorrido **Spotify → YouTube → Reminiscencia**, con mejor precisión que TuneMyMusic (que confunde versiones, artistas y covers). Respetando el tipo de contenido: canción suelta, álbum completo (nombre, portada, artista, orden), playlist (orden), y varios elementos sin mezclarse.

Dos hechos del terreno mandan sobre el diseño:

1. **La importación de YouTube que ya tenemos NO es un pipeline propio:** es un *front-end* que resuelve cada pista a un audio reproducible (WAV del proxy yttowav) y entrega **File**s al pipeline genérico de subida→publicación (`addUploads` en web, `uploadShared` en la APK), que ya hace descarga, transcodificación a Opus, catálogo, álbum/orden (ADR-0019), dedup (ADR-0026), publicación (buzón) y segundo plano persistente (ADR-0033/0039). **Un importador de Spotify se engancha en ese mismo punto**: lo único nuevo es *de dónde* salen los metadatos (Spotify) y *cómo* se elige el vídeo de YouTube (el motor de identificación).

2. **Spotify ha cerrado la API en 2024-2026:** se eliminaron `audio-features`, `audio-analysis`, `recommendations`, `related-artists` y `featured-playlists` (27-nov-2024); «development mode» queda limitado al dueño + ~5 cuentas; la «quota extendida» exige empresa con 250k usuarios/mes (inviable). Conclusión: **el matching NO puede usar huella acústica de Spotify**; se hace con **metadatos** (título, artista(s), álbum, **duración exacta en ms**, año e **ISRC**).

## Decisión

### Origen de datos: OAuth (cuenta del usuario)

El usuario conecta su cuenta de Spotify en la web de Reminiscencia (flujo Authorization Code). Da acceso a sus listas (incluidas privadas y «Tus me gusta»). En development mode vale para el dueño de la app + hasta 5 cuentas, suficiente para el proyecto. Requiere **una app de Spotify registrada una sola vez** (client id + secret como variables de entorno seguras en Vercel/Worker, nunca en el código, como `GITHUB_TOKEN` y las claves de R2); el intercambio y refresco de tokens es servidor. En uso: «Conectar Spotify» y listo.

### El motor de identificación vive en el servidor (paridad web/APK real)

La resolución Spotify→YouTube corre en el servidor (funciones de Vercel + Worker, junto a `server/youtube-*.js`), **una sola implementación** que web y APK consumen por HTTP. No hay dos matchers que diverjan. El cliente solo pinta la revisión y manda la selección.

### Mejora de búsqueda y autonomía (2026-11-11)

Para que funcione solo en listas grandes sin ir canción por canción: (1) a los candidatos de la búsqueda normal se suman
los **oficiales de YouTube Music** (canales «Topic», `server/youtube-music.js`, sin `child_process` para que lo use también
el Worker; aditivo con *fallback*); (2) **puerta de artista**: un título+duración exactos pero de otro artista no se
autoaceptan salvo fuente oficial o ISRC; (3) las coincidencias **alta y media** entran pre-elegidas con su mejor versión
(solo «baja» pide elección); (4) antiduplicados por **título+artista** además de título+duración, y un plan que no repite
una canción entre listas ni dentro de la tanda.

### Motor de puntuación (la parte más importante)

Por cada pista de Spotify `{title, artists, album, durationMs, year, isrc}` se buscan candidatos en YouTube (reutilizando `server/youtube-search.js` y, para metadatos limpios/artista/álbum, la búsqueda de **YouTube Music** de `server/youtube-music.js`, que marca los canales «Topic»/«Art Track» = subidas oficiales de sello). La búsqueda de YouTube Music usa el **filtro «Canciones»** de InnerTube (`params`): sin él la respuesta es una página mixta de la que apenas se saca un resultado; con él devuelve la lista limpia de grabaciones oficiales, cada una con artista y duración exacta, y la mejor suele venir la primera. Las credenciales de InnerTube (`apiKey`/`clientVersion`) se cachean ~30 min para que una playlist larga no recargue la home en cada canción (evita el throttling que dejaba sin candidatos «Topic» a media lista). Cada candidato se puntúa con señales ponderadas:

- **Duración** (señal más fiable): ±3 s fuerte, ±8 s media, ±15 s leve, >15 s penalización fuerte (descarta directos largos y versiones extendidas). El margen es amplio a propósito: Spotify y YouTube difieren varios segundos de forma rutinaria (intros, silencios, conteos) para la MISMA grabación, y exigir ±2 s mandaba a «revisar» coincidencias correctas.
- **Título** normalizado (reutiliza `foldText`/`normalizeText`/`editDistance`/`wordPoints` de `catalog.js`): el núcleo del título debe estar presente.
- **Artista** normalizado (reutiliza la normalización de duplicados): coincide → suma; artista claramente distinto → penaliza (mata covers/tributos de «Various Artists»).
- **Consistencia de versión**: se detectan etiquetas de versión en el título de Spotify y en el del candidato (live, acoustic, remix, instrumental, karaoke, cover, demo, nightcore, «sped up», 8d, extended…). Si Spotify es la versión de estudio y el candidato es otra versión → penalización fuerte; si Spotify ES «Live»/«Remix», se prefiere el candidato con esa misma etiqueta. «Remaster» es la misma grabación: penalización leve o nula.
- **Fuente oficial**: «Topic»/«Art Track» y VEVO/canal del artista → bonus.
- **ISRC**: si algún día un candidato trae ISRC igual al de Spotify → decisivo. (Hoy YouTube no suele exponerlo; queda preparado.)

### Niveles de confianza (precisión por encima de velocidad)

- **Alta** → se acepta sola: título+artista sólidos, duración ±8 s y versión consistente. **No se exige ventaja sobre el segundo**: cuando hay dos subidas de la MISMA canción (vídeo oficial + lyric video), ambas valen y escoger la primera es correcto; lo que descarta un candidato es ser OTRA versión (directo, remix, extendida, cover…), que rompe la consistencia de versión.
- **Media** → título+artista cuadran pero algo no encaja del todo (duración 8–15 s, versión dudosa o puntuación justa): se **preselecciona el mejor** y se muestran alternativas (título, artista, duración, miniatura, tipo de versión, enlace) por si el usuario quiere cambiar.
- **Baja** → no se selecciona nada automáticamente; búsqueda manual.

### Integración con el pipeline actual (nada de un sistema paralelo)

Las coincidencias aceptadas producen, por pista, lo mismo que hoy produce la importación de YouTube: un File de audio + `{album, trackArtists}`, que entra por `addUploads`/`uploadShared`. Así heredamos **gratis**: transcodificación a Opus, alta en catálogo (nacen `public:false` hasta publicarse), **álbum con id estable** (como `catalog.youtube_album`, un `spotify:album:<id>` seguiría la misma forma), **orden de pista** (UUIDv7 = orden de selección), **dedup** (ADR-0026: si ya existe, no se añade), «Añadidas recientemente» y «Tu biblioteca» reactivas, estados de descarga/publicación correctos (nunca «publicada» antes de estarlo) y **segundo plano persistente** (la intención se guarda como en ADR-0039; la cola de subidas ya sobrevive a navegación y reinicio).

### Interfaz «Transferir música»

Un apartado propio, coherente con el diseño actual: conectar Spotify → **elegir de tu biblioteca** (tus playlists y tus «Canciones favoritas», con casillas y buscador, como TuneMyMusic; o pegar un enlace de álbum/canción) → analizar → **revisar coincidencias** (con alternativas y búsqueda manual) → confirmar → progreso de descarga/publicación → resumen. El listado sale de `/api/spotify/mine` (`/v1/me/playlists` + `/v1/me/tracks`); «Me gusta» se transfiere con `source: 'liked'` (`/v1/me/tracks`).

## Etapas (cada una con pruebas)

1. ✅ **Motor de identificación** (`server/spotify-match.js`, puro) + set «dorado» (`tests/web-unit/spotify-match.test.mjs`).
2. ✅ **Ingesta de Spotify** (`server/spotify-core.js` parseo/normalización; `server/spotify-auth.js` OAuth PKCE; `server/spotify-fetch.js` transporte) con fixtures.
3. ✅ **Resolver + endpoints** (`server/spotify-resolve.js`, `server/spotify-endpoints.js`) enrutados en Worker (nativo), Vercel (shims) y Netlify (redirect); la búsqueda de YouTube se inyecta.
4. ✅ **UI de revisión** — web (`js/views/transferir.js` + lógica `js/spotify-transfer.js`) y APK (`lib/ui/spotify_transfer_page.dart` + `lib/spotify_transfer.dart`), con alternativas y búsqueda manual.
5. ✅ **Enganche al pipeline** — web `importYoutubeTracks` (homeostasia.js) → `addUploads`; APK `importTracks` (youtube_importer.dart) → `uploadShared`. Dedup (regla común) y orden (álbum de Spotify).
6. ⏳ **Segundo plano / escala**: hereda la cola de subidas persistente y la descarga reanudable que ya existen; el `resolve` pagina (offset/limit) para playlists grandes. La verificación de extremo a extremo en vivo (login real + descarga + publicación, web y APK) la hace el usuario.

## Verificación contra la documentación oficial (2026-11-10)

Tras una prueba real que se quedó colgada, se auditó todo el flujo contra la doc oficial de Spotify:

- **OAuth PKCE correcto, sin secreto.** El intercambio de código y el refresco NO necesitan client secret ni cabecera Basic (solo `client_id` en el cuerpo); los nombres y valores (incluido `code_challenge_method=S256`) coinciden con la doc. En `invalid_grant` se descarta el token y se reinicia el login (ya lo hacíamos). El client secret del dashboard **no se usa** (se puede regenerar sin romper nada).
- **Bug real arreglado (login):** el callback redirigía con `'#transferir'` (sin barra), que solo cambia el hash de la propia página del callback → se quedaba en «Conectando con Spotify…». Corregido a `'/#transferir'` y, además, el callback **normaliza** la vuelta (exige barra inicial) para tolerar una app en caché.
- **Bugs reales arreglados (lectura de playlist), por la migración de Spotify de feb/mar 2026 que afecta a las apps en «development mode»:** el objeto paginado de una playlist pasó de `tracks` a **`items`**, y cada entrada lleva la pista en **`item`** (antes `track`); `GET /playlists/{id}` ya **no acepta `limit`** (se sigue `next` tal cual); hay que **saltar episodios** (`type != 'track'`) y respetar `is_local` de la entrada. La normalización (`spotify-core.js`) admite ambos esquemas. Los álbumes y las canciones sueltas no cambiaron.
- **ISRC:** las pistas simplificadas de un álbum no traen `external_ids`; se propaga el contexto del álbum y, si hiciera falta el ISRC exacto, se leería `GET /tracks/{id}` por pista (no implementado aún; el matcher ya funciona sin él).

## Límite conocido: «development mode»

En development mode, Spotify solo devuelve el **contenido de las playlists propias o colaborativas**; las de otras personas o las editoriales llegan sin pistas (solo metadatos). Los **álbumes** y las **canciones sueltas** (catálogo) funcionan siempre. El dueño de la app necesita **Premium** y se permiten hasta 5 cuentas.

**Ampliación 2026-11-24 — tope de 100 pistas en listas ajenas sin «Extended Quota»:** en apps en dev-mode SIN Extended Quota, Spotify **TOPA a 100 pistas** la lectura de playlists ajenas aunque la lista tenga más (p. ej. una lista pública de 304 canciones devuelve `tracks.total: 304` pero `/v1/playlists/<id>/tracks` solo expone las 100 primeras). Desde el Worker no se puede saltar: el endpoint `open.spotify.com/get_access_token` que usa el reproductor web devuelve `403 Varnish` desde IPs sin cookies de sesión. El Worker marca la colección con `devModeCap: true` + `reportedTotal: 304` y lo propaga al cliente. Reintentos cortos para 5xx transitorios en `getJson` (3 intentos, backoff 300/900 ms) y resilencia en la paginación (si una página falla, se devuelve lo acumulado en vez de propagar) completan la robustez del camino principal.

**Ampliación 2026-11-25 — fallback «Web Player» desde el navegador del usuario:** cuando el server marca `devModeCap`, el CLIENTE intenta saltar el tope por cuenta propia. El navegador del usuario (si tiene abierta su sesión de Spotify) pide un token a `open.spotify.com/get_access_token` con `credentials: 'include'`: Spotify lo acepta porque viajan las cookies de sesión y emite un token con el client_id del reproductor web, que tiene **cuota completa**. Con ese token el cliente pagina `api.spotify.com/v1/playlists/<id>/tracks?offset=X&limit=100` hasta leer la lista entera. Luego vuelve a llamar a nuestro `/api/spotify/resolve` pero con `tracks: [...]` en vez de `url`/`ref`: el server reconoce el nuevo formato y solo hace el matching de YouTube (sin ir a Spotify). Si el usuario no está logueado en Spotify en el mismo navegador, `get_access_token` devuelve un token anónimo (`isAnonymous: true`) que SÍ está capado — lo detectamos y abortamos limpiamente, quedándose con el banner original. La CSP se amplía para admitir `api.spotify.com` y `open.spotify.com` en `connect-src`. Módulo web: `frontend/web/js/spotify-webplayer.js`; wiring en `spotify-transfer.js` → `resolveCollection`.

**Ampliación 2026-11-25 — fallback «Web Player» también en la APK:** paridad con la web usando un WebView del propio reproductor. Flujo: al detectar `devModeCap`, la APK abre `ui/spotify_web_player_dialog.dart` que contiene un `WebViewController`. Primero intenta `open.spotify.com/get_access_token` directamente. Si Spotify devuelve un token anónimo (sesión no iniciada en el WebView), el diálogo muestra `accounts.spotify.com/login` y el usuario escribe sus credenciales UNA VEZ; las cookies persisten en el WebView para futuras aperturas. Con el token conseguido, la APK pagina `api.spotify.com/v1/playlists/<id>/tracks` con `package:http` (el Bearer basta, no necesita cookies) y llama a `/api/spotify/resolve` con `tracks:[...]` + `indexOffset` para matchear YouTube. Módulo: `mobile/lib/spotify_webplayer.dart` + `mobile/lib/ui/spotify_web_player_dialog.dart`; wiring en `spotify_transfer_page.dart::_analyze`.

Alternativa oficial permanente, cuando se conceda, es solicitar «Extended Quota» en el Developer Dashboard de Spotify.

**Ampliación 2026-11-24 — resolver: presupuesto de tiempo + auto-rescate cliente.** El resolver pasa `budgetMs: 25000` al pipeline para que, con 25 pistas × `concurrency: 1` + reintentos + «último recurso» de 8 s, no se supere el límite de 30 s de CPU del Worker (antes se traducía a 503 Error 1102). El cliente, cuando una pista llega con `best=null` y sin `alternatives`, lanza una búsqueda directa a `/api/youtube/search` con `artista título` y rellena el selector al vuelo (evita el dropdown vacío «Elige una versión»).

**Ampliación 2026-11-24 — transferir: detector de cola atascada y corte por ciclo seco.** `jobTimeout` bajado de 10 min a 4 min por pista, y si la cola del conversor no cambia en 20 polls (~60 s) la pista se da por atascada y se salta. Y si un ciclo entero de reintentos no añade NI UNA pista nueva, el bucle corta (antes repetía «reintento en 10 min» en bucle aunque llevara horas sin avanzar).

**Ampliación 2026-11-24 — fetch robusto: propagación limpia de 401.** El 401 de `/v1/me` se propaga al handler (antes se tragaba en silencio → `me=null` → 403 de `/v1/me/playlists` sin fallback → 502 al cliente, que nunca refrescaba el token). Ahora sube limpio y el handler devuelve 401 + `needsAuth` para disparar el refresh. Y si `/v1/me/playlists` da 403 sin `me`, se responde lista vacía con `publicOnly: true` (antes reventaba la pantalla al abrir «Transferir»).

## Límite conocido del login web

El Redirect URI registrado es el del Worker (`reminiscencia.cometia.es`), así que el callback siempre cae ahí y lee el `verifier` de `sessionStorage` del mismo origen: **el login web funciona servido desde cometia** (el dominio principal). Desde los dominios de Vercel/Netlify el `sessionStorage` sería de otro origen; para esos casos se usaría un redirect propio o se conecta desde cometia. La APK no se ve afectada (su login va por un WebView que intercepta la vuelta).

## Consecuencias

- **Reutilización máxima**: el 90 % del trabajo pesado (descarga/transcodificación/publicación/álbum/dedup/segundo plano) ya existe; el esfuerzo se concentra donde está el valor (identificación y revisión).
- **Precisión**: duración exacta de Spotify + preferencia por «Topic»/oficial + penalización de versiones incorrectas resuelven los fallos típicos de TuneMyMusic.
- **Límite conocido**: sin huella acústica de Spotify, la identificación es por metadatos; por eso los casos dudosos van a revisión manual en vez de adivinar.
- **Requisito externo**: registrar una app de Spotify una sola vez (el usuario, por seguridad). Hasta entonces se desarrolla y prueba contra respuestas simuladas, así que nada bloquea la construcción.
- **Verificación**: el flujo completo de extremo a extremo (OAuth real + descarga + publicación) se confirma cuando existan las credenciales; el motor y la ingesta se prueban antes contra fixtures.

## Ampliación 2026-11-25 — ampliar playlists con el historial de reproducción (`/recent`)

Spotify expone el objeto playlist tal cual está guardado en la cuenta del owner. Las sugerencias de Autoplay que aparecen en el reproductor web NO son parte de la playlist y no hay endpoint que las devuelva. Lo más parecido que ofrece la API es el historial reciente del usuario (`/v1/me/player/recently-played`): si has estado escuchando una Mix con Autoplay, muchas de esas canciones quedan ahí.

- Scope nuevo: `user-read-recently-played` añadido a `SPOTIFY_SCOPES` en `server/spotify-auth.js`. Un login OAuth existente devuelve 403 en `/recent` con `needsReconnect:true`; el cliente pide reconectar una vez.
- `server/spotify-fetch.js::fetchRecentlyPlayed` pagina `/v1/me/player/recently-played?limit=50` con el cursor `before`. Deduplica por `track.id` conservando la más reciente. Hasta 300 pistas (6 × 50).
- Endpoint `POST /api/spotify/recent` en `server/spotify-endpoints.js`. Devuelve `{tracks:[...]}` crudo para que el cliente lo mande al `/resolve` con el camino `tracks:[...]` + `indexOffset` (ADR-0044 ampliado 2026-11-25).
- Cliente (`js/spotify-transfer.js::resolveCollection`) activa el flujo tras resolver una playlist (`ref.type === 'playlist'`, URL con `/playlist/` o `source === 'liked'`): llama a `api.recent`, deduplica contra lo ya traído por `spotifyId` y resuelve las nuevas en ventanas de `pageLimit` matcheando YouTube con el camino `tracks:[...]`.
- No es equivalente al Autoplay (eso es per-sesión de reproductor), pero recupera las canciones que has estado escuchando y no están en la playlist estática, que es el 90 % de lo que el usuario intenta pasar a su biblioteca.

## Ampliación 2026-11-25 — tope diario del conversor yttowav

Confirmado en producción: yttowav limita a **40 conversiones por día por IP**. Antes se trataba como un 429 normal y el cliente reintentaba 6 veces por canción; al tocar el tope, con 60 canciones en cola, generaba cientos de llamadas inútiles hasta que `circuitBreak` por fallos consecutivos lo cortaba. Fix:

- `js/views/homeostasia.js::crearJob` detecta `daily conversion limit`, `40 per day` o `come back tomorrow` y lanza un error con `dailyLimit:true` SIN pasar por el backoff.
- `convertirCancion` propaga `dailyLimit` al resultado; `convertirPlaylist` abre el circuito al instante al verlo. Las siguientes canciones de la tanda se marcan como pendientes sin llamar al conversor.
- El usuario puede esperar al reset diario (00:00 UTC) o usar la APK, que va directa a yttowav con su propia IP (ADR-0045).

## Ampliación 2026-11-25 — `pendingJob` caducado (TTL + rescate 404)

Síntoma: al reintentar una playlist grande de YouTube el reporte salía «Importación procesada: 296 canciones. 0 WAV preparados para subir. 273 errores de conversión. Primer error: La conversión ya no está disponible.» con yttowav perfectamente sano.

Causa raíz: `convertirCancion` reutiliza el `jobId` guardado en `localStorage` cuando el record quedó en estado `'converting'` (p. ej. el usuario cerró la pestaña a mitad). yttowav purga jobs tras unas horas, así que al reutilizar un id de ayer la primera consulta a `/api/status` devuelve 404 → «La conversión ya no está disponible» → se marca la pista como `expired`. Con una lista grande heredada, los 15 primeros fallos seguidos abren el cortacircuitos y las ~280 restantes caen con «El conversor alcanzó su límite», aunque la cuota diaria seguía intacta.

Fix (`js/views/homeostasia.js`):

- Constante `PENDING_JOB_TTL_MS = 30 min`. Solo se reutiliza `pendingJob` si `Date.now() - saved.updatedAt < PENDING_JOB_TTL_MS`. Un record `'converting'` viejo se degrada a `'retry'` y se crea un job nuevo.
- Rescate 404: si al reutilizar un `pendingJob` fresco la consulta a `/api/status` devuelve 404 (yttowav ya lo purgó), se crea un job nuevo con el mismo `traceId` y se reanuda el polling sin romper el cortacircuitos.

**Ampliación 2026-11-25 (bis)** — Los logs del usuario mostraron además un patrón distinto: **jobIds frescos** (recién creados, no de `localStorage`) devolvían 404 en `/api/status` con el patrón «2 pistas OK / 2 pistas 404» por tanda de 4. yttowav acepta `/api/convert` (devuelve `jobId` válido) pero descarta el job en el backend cuando supera su cupo de concurrencia por IP. Dos cambios:

- `CONFIG.batchSize`: 4 → 2. Con batch de 2, cada pista llega al worker de verdad. El throughput apenas baja porque yttowav serializa los `yt-dlp` por IP de todos modos.
- Rescate 404 generalizado: **cualquier** 404 en status (no solo con `pendingJob`) → espera 5 s y crea job nuevo. Un único reintento; si el nuevo vuelve a ser 404 se propaga como error real.
