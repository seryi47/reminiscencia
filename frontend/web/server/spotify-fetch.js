// Transporte de la API de Spotify para «Transferir música» (ADR-0044): dado un token y una referencia {type,id}, trae
// la canción, el álbum o la playlist (siguiendo la paginación) y los normaliza con spotify-core. `fetch` se inyecta, así
// que se prueba contra respuestas simuladas sin credenciales. Respeta el tipo y el ORDEN.

import { normalizeAlbum, normalizePlaylist, normalizeSingleTrack, normalizeTrack } from './spotify-core.js';
import { fetchPublicPlaylistTracks, fetchPublicAlbumTracks, fetchPublicTrack, fetchPublicEmbedMeta } from './spotify-embed.js';

const API = 'https://api.spotify.com';

/** Error con el estado HTTP, para que la capa de arriba distinga 401 (refrescar) de 429 (esperar) o lo demás. */
export class SpotifyApiError extends Error {
  constructor(status, message, { endpoint = '', body = null } = {}) {
    super(message);
    this.name = 'SpotifyApiError';
    this.status = status;
    this.endpoint = endpoint; // path relativo del endpoint que falló (p. ej. '/v1/me/playlists')
    this.body = body;          // cuerpo de error devuelto por Spotify, si lo hubiera (sin tokens)
  }
}

// Extrae el path relativo del endpoint de Spotify (sin host ni query sensible), para enriquecer los errores
// con contexto diagnóstico sin filtrar nada secreto.
function endpointOf(url) {
  try {
    const u = new URL(url);
    return u.pathname + (u.search ? '?' + u.search.replace(/access_token=[^&]+/g, 'access_token=***') : '');
  } catch { return url; }
}

async function getJson(url, accessToken, fetchImpl) {
  // Reintentos cortos para 5xx transitorios de Spotify (ADR-0044 ampliado 2026-11-24): su API devuelve 500/502/503
  // ocasionalmente sin que nada esté roto, y antes se traducía a 502 en seco para el usuario. 3 intentos con backoff
  // breve (300/900 ms) cubren casi todo el ruido. 401/429/404 NO se reintentan (son decisiones firmes de Spotify).
  const endpoint = endpointOf(url);
  const transient = new Set([500, 502, 503, 504]);
  let lastResponse = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetchImpl(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (response.status === 401) throw new SpotifyApiError(401, 'token de Spotify caducado o inválido', { endpoint });
    if (response.status === 429) throw new SpotifyApiError(429, 'límite de peticiones de Spotify', { endpoint });
    if (transient.has(response.status) && attempt < 2) {
      await new Promise((r) => setTimeout(r, 300 * (attempt + 1) ** 2));
      lastResponse = response;
      continue;
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new SpotifyApiError(response.status, data.error?.message || `HTTP ${response.status}`, { endpoint, body: data?.error ?? data ?? null });
    }
    return data;
  }
  // 3 intentos agotados en 5xx: propagamos con el último estado.
  throw new SpotifyApiError(lastResponse?.status ?? 502, `Spotify respondió ${lastResponse?.status ?? 502} tras 3 intentos`, { endpoint });
}

/**
 * Pide las pistas de una playlist por offset explícito hasta cubrir `cap` (o hasta que no quede nada).
 * Resiliente: si una página en medio falla (5xx transitorio de Spotify, red flaky, rate-limit), devuelve lo que
 * llevamos acumulado en lugar de propagar el error — una petición parcial siempre vale más que un 502 en seco.
 * Los 401 (token caducado) SÍ se propagan: si no, el cliente no sabría que debe refrescar.
 */
async function fetchPlaylistTracksByOffset(playlistId, accessToken, fetchImpl, cap = Infinity) {
  const LIMIT = 100; // tope duro de /v1/playlists/{id}/tracks por petición
  const MAX_PAGES = 100; // seguridad contra bucles infinitos o listas absurdas (10 000 pistas máximo)
  const items = [];
  let offset = 0;
  for (let pages = 0; pages < MAX_PAGES && items.length < cap; pages += 1) {
    const url = `${API}/v1/playlists/${encodeURIComponent(playlistId)}/tracks?offset=${offset}&limit=${LIMIT}`;
    let page;
    try {
      page = await getJson(url, accessToken, fetchImpl);
    } catch (error) {
      // 401: dejamos que suba (el cliente tiene que refrescar el token). Cualquier otro error lo convertimos en
      // «fin de paginación»: devolvemos lo que tengamos. Un 5xx transitorio de Spotify a mitad de una lista grande
      // dejaba al usuario sin NADA en pantalla; ahora al menos ve las primeras N páginas.
      if (error instanceof SpotifyApiError && error.status === 401) throw error;
      break;
    }
    const pageItems = Array.isArray(page?.items) ? page.items : [];
    if (pageItems.length === 0) break;
    items.push(...pageItems);
    if (pageItems.length < LIMIT) break; // Spotify dice que esto es el final
    offset += LIMIT;
  }
  return cap === Infinity ? items : items.slice(0, cap);
}

// Sigue `.next` de un objeto paginado (p. ej. album.tracks). Se mantiene para álbumes y «liked», donde el
// comportamiento de `.next` es estable. Para playlists usamos fetchPlaylistTracksByOffset.
async function allItems(firstPage, accessToken, fetchImpl, cap = Infinity) {
  const items = [...(firstPage.items ?? [])];
  let next = firstPage.next;
  while (next && items.length < cap) {
    const page = await getJson(next, accessToken, fetchImpl);
    items.push(...(page.items ?? []));
    next = page.next;
  }
  return cap === Infinity ? items : items.slice(0, cap);
}

/**
 * Trae y normaliza una colección de Spotify. Devuelve la forma interna de spotify-core
 * ({ type, id, name, tracks:[...] }). [maxTracks] limita playlists enormes (por defecto, sin límite).
 */
export async function fetchCollection({ ref, accessToken }, fetchImpl = fetch, { maxTracks = Infinity } = {}) {
  if (!ref || !ref.type || (ref.type !== 'liked' && !ref.id)) throw new Error('referencia de Spotify inválida');
  if (!accessToken) throw new Error('falta el token de acceso');

  if (ref.type === 'track') {
    // Fallback embed público si la Web API está bloqueada (owner sin Premium, 2026-11): intentamos el embed público
    // de la canción y, si trae la pista, la devolvemos. Es mejor que tirar al usuario con 403.
    try {
      const track = await getJson(`${API}/v1/tracks/${ref.id}`, accessToken, fetchImpl);
      const collection = normalizeSingleTrack(track);
      if (collection) return collection;
    } catch (error) {
      if (!(error instanceof SpotifyApiError) || error.status !== 403) throw error;
      // 403 por Premium del owner: usamos el embed público
    }
    const embedTracks = await fetchPublicTrack(ref.id, fetchImpl);
    if (embedTracks.length > 0) {
      const t = embedTracks[0];
      return { type: 'track', id: ref.id, name: t.title, cover: null, artist: (t.artists||[])[0] || null, tracks: [t], source: 'embed' };
    }
    throw new SpotifyApiError(404, 'canción no disponible');
  }

  if (ref.type === 'liked') {
    // «Me gusta» del usuario (GET /v1/me/tracks). Cada entrada es { added_at, track }. Se trata como una colección.
    const first = await getJson(`${API}/v1/me/tracks?limit=50`, accessToken, fetchImpl);
    const items = await allItems(first, accessToken, fetchImpl, maxTracks);
    const tracks = items.map((entry) => normalizeTrack(entry?.track ?? entry?.item)).filter(Boolean);
    return { type: 'liked', id: 'liked', name: 'Canciones favoritas', cover: null, tracks };
  }

  if (ref.type === 'album') {
    try {
      const album = await getJson(`${API}/v1/albums/${ref.id}`, accessToken, fetchImpl);
      const items = await allItems(album.tracks ?? { items: [] }, accessToken, fetchImpl, maxTracks);
      const collection = normalizeAlbum({ ...album, tracks: { items } });
      if (collection) return collection;
    } catch (error) {
      if (!(error instanceof SpotifyApiError) || error.status !== 403) throw error;
    }
    // Fallback embed público (ADR-0044 ampliado 2026-11-23): el embed de álbum también trae trackList.
    const embedTracks = await fetchPublicAlbumTracks(ref.id, fetchImpl);
    if (embedTracks.length > 0) {
      const meta = await fetchPublicEmbedMeta('album', ref.id, fetchImpl);
      return {
        type: 'album', id: ref.id,
        name: meta?.name || 'Álbum', cover: meta?.image || null,
        artist: meta?.subtitle || null,
        tracks: maxTracks === Infinity ? embedTracks : embedTracks.slice(0, maxTracks),
        source: 'embed',
      };
    }
    throw new SpotifyApiError(404, 'álbum no disponible');
  }

  if (ref.type === 'playlist') {
    // Paginación EXPLÍCITA por offset (ADR-0044 ampliado 2026-11-24): antes seguíamos `.next` del wrapper, pero Spotify
    // a veces devuelve `.next=null` en la primera página (p. ej. listas ajenas en Development Mode) o un `.next` con
    // host interno que da 404 → se capaba a 100 pistas aunque la lista tuviera 300. Ahora pedimos los metadatos,
    // leemos `tracks.total` y pedimos las páginas por offset hasta cubrirlo todo. Da la vuelta al bug de raíz.
    let collection = null;
    let totalTracks = 0;
    try {
      // Pedimos la metadata y las pistas por separado; cualquier error (403 lista bloqueada, 404, 5xx transitorio
      // de Spotify) hace que `collection` quede en null y caigamos al embed público. Solo el 401 sube para forzar
      // un refresh de token en el cliente.
      const playlist = await getJson(`${API}/v1/playlists/${ref.id}?fields=id,name,images,owner,tracks(total,limit)`, accessToken, fetchImpl);
      totalTracks = Number.isFinite(playlist?.tracks?.total) ? playlist.tracks.total : 0;
      const items = await fetchPlaylistTracksByOffset(ref.id, accessToken, fetchImpl, maxTracks);
      collection = normalizePlaylist({ ...playlist, tracks: { items } });
      // Dev-mode cap de Spotify (ADR-0044): en apps sin Extended Quota, Spotify TOPA a 100 pistas la lectura de
      // playlists ajenas aunque la lista tenga más. Si `tracks.total` reportado > pistas leídas, marcamos la
      // colección como PARCIAL y pasamos el motivo al cliente para que ofrezca «Clonar a mi Spotify» (la copia
      // propia del usuario sí se lee entera). Antes probamos un fallback con token anónimo del reproductor
      // web, pero Spotify ya lo bloquea con 403 Varnish desde IPs sin cookies de sesión.
      if (collection && totalTracks > 0 && collection.tracks.length < totalTracks) {
        collection.partial = true;
        collection.devModeCap = true;
        collection.reportedTotal = totalTracks;
      }
    } catch (error) {
      if (error instanceof SpotifyApiError && error.status === 401) throw error;
      // Cualquier otro error (403/404/5xx): caemos al embed, es mejor que un 502 en seco.
    }
    // Respaldo para listas PÚBLICAS cuando la Web API está bloqueada (owner sin Premium, dev-mode).
    if (!collection || collection.tracks.length === 0) {
      const embedTracks = await fetchPublicPlaylistTracks(ref.id, fetchImpl);
      if (embedTracks.length > 0) {
        if (!collection) {
          const meta = await fetchPublicEmbedMeta('playlist', ref.id, fetchImpl);
          collection = { type: 'playlist', id: ref.id, name: meta?.name || 'Playlist', cover: meta?.image || null, tracks: [] };
        }
        collection.tracks = maxTracks === Infinity ? embedTracks : embedTracks.slice(0, maxTracks);
        collection.source = 'embed';
        collection.partial = embedTracks.length >= 100; // el embed topa a ~100 (limitación del embed, no nuestra)
      }
    }
    if (!collection) throw new SpotifyApiError(404, 'playlist no disponible');
    return collection;
  }

  throw new Error(`tipo de Spotify no soportado: ${ref.type}`);
}

/**
 * Lista la biblioteca del usuario para elegir qué transferir: sus playlists (propias y seguidas) y cuántas canciones
 * tiene en «Me gusta». Devuelve { playlists: [{ id, name, total, image, ownerId, ownerName }], liked: <número> }.
 * En «development mode» solo se podrá traer el CONTENIDO de las propias/colaborativas; esto solo lista.
 */
export async function listMine({ accessToken }, fetchImpl = fetch) {
  if (!accessToken) throw new Error('falta el token de acceso');
  // Id del usuario, para saber qué listas son SUYAS. En «development mode» Spotify solo deja leer el contenido de listas
  // propias o colaborativas; las que solo sigues llegan vacías (ADR-0044). Marcar el dueño evita el «no hay canciones».
  let me = null;
  try { me = (await getJson(`${API}/v1/me`, accessToken, fetchImpl))?.id ?? null; } catch (error) {
    // 401 (token caducado) SÍ se propaga: si lo tragamos aquí, /v1/me/playlists también dará 401 pero nosotros ya
    // lo habríamos convertido en 403 por el catch de abajo → envoltorio 502 y el cliente no refresca. Dejamos que
    // suba y el handler lo mapee a 401 + needsAuth (ADR-0044 ampliado 2026-11-24). El 403 (dev-mode sin quota),
    // el 429 (rate-limit) y cualquier error de red siguen tragados: se seguirá sin marcar dueño.
    if (error instanceof SpotifyApiError && error.status === 401) throw error;
  }
  // Spotify restringió /v1/me/playlists en apps en Development Mode sin Extended Quota (2024-11+, ADR-0044 ampliado
  // 2026-11-23): devuelve 403 aunque el token sea válido. Si pasa, caemos a /v1/users/{me}/playlists, que SÍ sigue
  // público y lista las playlists públicas del usuario (sin scopes especiales). Limitación: no incluye las privadas
  // ni «Me gusta», pero cubre a quien tenga la mayoría públicas. Para «Me gusta» el usuario tiene que pegar la URL.
  let first;
  let publicOnly = false;
  try {
    first = await getJson(`${API}/v1/me/playlists?limit=50`, accessToken, fetchImpl);
  } catch (error) {
    if (error instanceof SpotifyApiError && error.status === 403 && me) {
      first = await getJson(`${API}/v1/users/${encodeURIComponent(me)}/playlists?limit=50`, accessToken, fetchImpl);
      publicOnly = true;
    } else if (error instanceof SpotifyApiError && error.status === 403 && !me) {
      // Sin `me` (porque /v1/me también falló con 403 y lo tragamos arriba: cuenta sin Extended Quota) seguimos
      // dando una lista VACÍA en vez de tirar el 502 (ADR-0044 ampliado 2026-11-24). El cliente ya sabe tratar
      // publicOnly (muestra el aviso de que hay que pegar enlaces); antes esto reventaba la pantalla al abrir.
      first = { items: [], next: null };
      publicOnly = true;
    } else {
      throw error;
    }
  }
  const items = await allItems(first, accessToken, fetchImpl);
  const playlists = items.filter(Boolean).map((pl) => {
    const ownerId = pl.owner?.id ?? null;
    const collaborative = pl.collaborative === true;
    return {
      id: pl.id,
      name: typeof pl.name === 'string' ? pl.name : '',
      total: pl.tracks?.total ?? pl.items?.total ?? 0, // «items» desde la migración de 2026; «tracks» en el esquema antiguo
      image: (Array.isArray(pl.images) && pl.images[0]?.url) || null,
      ownerId,
      ownerName: pl.owner?.display_name ?? null,
      collaborative,
      // Importable en modo desarrollo: propia o colaborativa. null si no se pudo saber el usuario (no se marca nada).
      mine: me == null ? null : (ownerId === me || collaborative),
    };
  });
  let liked = 0;
  try {
    const saved = await getJson(`${API}/v1/me/tracks?limit=1`, accessToken, fetchImpl);
    liked = saved.total ?? 0;
  } catch { /* si no hay permiso de biblioteca, se omite «Me gusta» */ }
  return { playlists, liked, me, publicOnly };
}

/**
 * Lee las últimas pistas escuchadas del usuario (ADR-0044 ampliado 2026-11-25). Spotify devuelve las últimas 50
 * por llamada; paginamos hacia atrás con el cursor `before` para traer hasta `cap`. Los duplicados por `spotifyId`
 * se eliminan conservando la más reciente. Requiere scope `user-read-recently-played`.
 *
 * Esto NO es el «Autoplay» de una playlist concreta (Spotify no lo expone), sino el historial de reproducción
 * reciente del usuario. Se usa para ampliar una playlist tipo Mix con las canciones que has estado escuchando y
 * no están en la lista.
 */
export async function fetchRecentlyPlayed({ accessToken, cap = 200 }, fetchImpl = fetch) {
  if (!accessToken) throw new Error('falta el token de acceso');
  const items = [];
  const seen = new Set();
  let before = null;
  for (let pages = 0; pages < 6 && items.length < cap; pages += 1) { // 6 × 50 = 300 máx
    const qs = `?limit=50${before ? `&before=${before}` : ''}`;
    const page = await getJson(`${API}/v1/me/player/recently-played${qs}`, accessToken, fetchImpl);
    const entries = Array.isArray(page?.items) ? page.items : [];
    if (entries.length === 0) break;
    for (const entry of entries) {
      const track = entry?.track;
      if (!track?.id || seen.has(track.id)) continue;
      seen.add(track.id);
      items.push(track);
    }
    before = page?.cursors?.before;
    if (!before) break;
  }
  return items.slice(0, cap);
}
