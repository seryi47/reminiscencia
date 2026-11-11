// Transporte de la API de Spotify para «Transferir música» (ADR-0044): dado un token y una referencia {type,id}, trae
// la canción, el álbum o la playlist (siguiendo la paginación) y los normaliza con spotify-core. `fetch` se inyecta, así
// que se prueba contra respuestas simuladas sin credenciales. Respeta el tipo y el ORDEN.

import { normalizeAlbum, normalizePlaylist, normalizeSingleTrack, normalizeTrack } from './spotify-core.js';

const API = 'https://api.spotify.com';

/** Error con el estado HTTP, para que la capa de arriba distinga 401 (refrescar) de 429 (esperar) o lo demás. */
export class SpotifyApiError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'SpotifyApiError';
    this.status = status;
  }
}

async function getJson(url, accessToken, fetchImpl) {
  const response = await fetchImpl(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (response.status === 401) throw new SpotifyApiError(401, 'token de Spotify caducado o inválido');
  if (response.status === 429) throw new SpotifyApiError(429, 'límite de peticiones de Spotify');
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new SpotifyApiError(response.status, data.error?.message || `HTTP ${response.status}`);
  }
  return data;
}

// Sigue `.next` de un objeto paginado (p. ej. playlist.tracks o album.tracks) y acumula todos los items, en orden.
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
    const track = await getJson(`${API}/v1/tracks/${ref.id}`, accessToken, fetchImpl);
    const collection = normalizeSingleTrack(track);
    if (!collection) throw new SpotifyApiError(404, 'canción no disponible');
    return collection;
  }

  if (ref.type === 'liked') {
    // «Me gusta» del usuario (GET /v1/me/tracks). Cada entrada es { added_at, track }. Se trata como una colección.
    const first = await getJson(`${API}/v1/me/tracks?limit=50`, accessToken, fetchImpl);
    const items = await allItems(first, accessToken, fetchImpl, maxTracks);
    const tracks = items.map((entry) => normalizeTrack(entry?.track ?? entry?.item)).filter(Boolean);
    return { type: 'liked', id: 'liked', name: 'Canciones favoritas', cover: null, tracks };
  }

  if (ref.type === 'album') {
    const album = await getJson(`${API}/v1/albums/${ref.id}`, accessToken, fetchImpl);
    const items = await allItems(album.tracks ?? { items: [] }, accessToken, fetchImpl, maxTracks);
    const collection = normalizeAlbum({ ...album, tracks: { items } });
    if (!collection) throw new SpotifyApiError(404, 'álbum no disponible');
    return collection;
  }

  if (ref.type === 'playlist') {
    // GET /playlists/{id} no acepta `limit` (la migración de 2026); el objeto paginado es `items` (antes `tracks`) y se
    // sigue su `next` tal cual lo devuelve Spotify. En «development mode» solo trae el contenido de listas propias o
    // colaborativas; para el resto llega vacío (metadatos), y la UI avisa.
    const playlist = await getJson(`${API}/v1/playlists/${ref.id}`, accessToken, fetchImpl);
    const paging = playlist.items ?? playlist.tracks ?? { items: [] };
    const items = await allItems(paging, accessToken, fetchImpl, maxTracks);
    const collection = normalizePlaylist({ ...playlist, items: { items }, tracks: undefined });
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
  try { me = (await getJson(`${API}/v1/me`, accessToken, fetchImpl))?.id ?? null; } catch { /* sin /me, no se marca dueño */ }
  const first = await getJson(`${API}/v1/me/playlists?limit=50`, accessToken, fetchImpl);
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
  return { playlists, liked, me };
}
