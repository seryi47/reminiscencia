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
  const response = await fetchImpl(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const endpoint = endpointOf(url);
  if (response.status === 401) throw new SpotifyApiError(401, 'token de Spotify caducado o inválido', { endpoint });
  if (response.status === 429) throw new SpotifyApiError(429, 'límite de peticiones de Spotify', { endpoint });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new SpotifyApiError(response.status, data.error?.message || `HTTP ${response.status}`, { endpoint, body: data?.error ?? data ?? null });
  }
  return data;
}

/**
 * Pide las pistas de una playlist por offset explícito hasta cubrir `cap` (o el total).
 * Es MÁS ROBUSTO que seguir `.next` del wrapper: Spotify a veces devuelve `.next=null` en primera página para
 * listas ajenas o enlaces internos rotos, cortando la paginación a 100 pistas aunque haya más. Aquí vamos
 * offset=0,100,200,… hasta que la última página venga con menos de `limit` items (señal de que ya no hay más).
 */
async function fetchPlaylistTracksByOffset(playlistId, accessToken, fetchImpl, cap = Infinity) {
  const LIMIT = 100; // tope duro de /v1/playlists/{id}/tracks por petición
  const items = [];
  let offset = 0;
  while (items.length < cap) {
    const url = `${API}/v1/playlists/${encodeURIComponent(playlistId)}/tracks?offset=${offset}&limit=${LIMIT}`;
    const page = await getJson(url, accessToken, fetchImpl);
    const pageItems = Array.isArray(page?.items) ? page.items : [];
    if (pageItems.length === 0) break;
    items.push(...pageItems);
    if (pageItems.length < LIMIT) break; // ya no queda nada
    offset += LIMIT;
    // Cortocircuito por `total` (si Spotify lo da): evitamos la última petición vacía.
    if (Number.isFinite(page?.total) && offset >= page.total) break;
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
      const playlist = await getJson(`${API}/v1/playlists/${ref.id}?fields=id,name,images,owner,tracks(total,limit)`, accessToken, fetchImpl);
      totalTracks = Number.isFinite(playlist?.tracks?.total) ? playlist.tracks.total : 0;
      const cap = Math.min(totalTracks, maxTracks === Infinity ? totalTracks : maxTracks);
      const items = await fetchPlaylistTracksByOffset(ref.id, accessToken, fetchImpl, cap);
      collection = normalizePlaylist({ ...playlist, tracks: { items } });
    } catch (error) {
      if (!(error instanceof SpotifyApiError) || error.status !== 403) throw error;
      // 403 por Premium del owner o lista bloqueada en dev-mode: dejamos `collection` en null y caemos al embed.
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
