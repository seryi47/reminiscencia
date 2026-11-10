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

### Motor de puntuación (la parte más importante)

Por cada pista de Spotify `{title, artists, album, durationMs, year, isrc}` se buscan candidatos en YouTube (reutilizando `server/youtube-search.js` y, para metadatos limpios/artista/álbum, YouTube Music InnerTube de `server/youtube-playlist.js`, que marca los canales «Topic»/«Art Track» = subidas oficiales de sello). Cada candidato se puntúa con señales ponderadas:

- **Duración** (señal más fiable): ±2 s fuerte, ±5 s media, >10 s penalización fuerte (descarta directos largos y versiones extendidas).
- **Título** normalizado (reutiliza `foldText`/`normalizeText`/`editDistance`/`wordPoints` de `catalog.js`): el núcleo del título debe estar presente.
- **Artista** normalizado (reutiliza la normalización de duplicados): coincide → suma; artista claramente distinto → penaliza (mata covers/tributos de «Various Artists»).
- **Consistencia de versión**: se detectan etiquetas de versión en el título de Spotify y en el del candidato (live, acoustic, remix, instrumental, karaoke, cover, demo, nightcore, «sped up», 8d, extended…). Si Spotify es la versión de estudio y el candidato es otra versión → penalización fuerte; si Spotify ES «Live»/«Remix», se prefiere el candidato con esa misma etiqueta. «Remaster» es la misma grabación: penalización leve o nula.
- **Fuente oficial**: «Topic»/«Art Track» y VEVO/canal del artista → bonus.
- **ISRC**: si algún día un candidato trae ISRC igual al de Spotify → decisivo. (Hoy YouTube no suele exponerlo; queda preparado.)

### Niveles de confianza (precisión por encima de velocidad)

- **Alta** → se acepta sola: duración ±2 s, título+artista sólidos, versión consistente y ventaja clara sobre el segundo o fuente oficial.
- **Media** → se muestran varias alternativas (título, artista, duración, miniatura, tipo de versión, enlace) para que el usuario elija.
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

En development mode, Spotify solo devuelve el **contenido de las playlists propias o colaborativas**; las de otras personas o las editoriales llegan sin pistas (solo metadatos). Los **álbumes** y las **canciones sueltas** (catálogo) funcionan siempre. El dueño de la app necesita **Premium** y se permiten hasta 5 cuentas. La UI avisa si una playlist llega vacía.

## Límite conocido del login web

El Redirect URI registrado es el del Worker (`reminiscencia.cometia.es`), así que el callback siempre cae ahí y lee el `verifier` de `sessionStorage` del mismo origen: **el login web funciona servido desde cometia** (el dominio principal). Desde los dominios de Vercel/Netlify el `sessionStorage` sería de otro origen; para esos casos se usaría un redirect propio o se conecta desde cometia. La APK no se ve afectada (su login va por un WebView que intercepta la vuelta).

## Consecuencias

- **Reutilización máxima**: el 90 % del trabajo pesado (descarga/transcodificación/publicación/álbum/dedup/segundo plano) ya existe; el esfuerzo se concentra donde está el valor (identificación y revisión).
- **Precisión**: duración exacta de Spotify + preferencia por «Topic»/oficial + penalización de versiones incorrectas resuelven los fallos típicos de TuneMyMusic.
- **Límite conocido**: sin huella acústica de Spotify, la identificación es por metadatos; por eso los casos dudosos van a revisión manual en vez de adivinar.
- **Requisito externo**: registrar una app de Spotify una sola vez (el usuario, por seguridad). Hasta entonces se desarrolla y prueba contra respuestas simuladas, así que nada bloquea la construcción.
- **Verificación**: el flujo completo de extremo a extremo (OAuth real + descarga + publicación) se confirma cuando existan las credenciales; el motor y la ingesta se prueban antes contra fixtures.
