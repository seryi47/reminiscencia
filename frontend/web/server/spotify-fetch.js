// Transporte de la API de Spotify para «Transferir música» (ADR-0044): dado un token y una referencia {type,id}, trae
// la canción, el álbum o la playlist (siguiendo la paginación) y los normaliza con spotify-core. `fetch` se inyecta, así
// que se prueba contra respuestas simuladas sin credenciales. Respeta el tipo y el ORDEN.

import { normalizeAlbum, normalizePlaylist, normalizeSingleTrack } from './spotify-core.js';

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
  if (!ref || !ref.type || !ref.id) throw new Error('referencia de Spotify inválida');
  if (!accessToken) throw new Error('falta el token de acceso');

  if (ref.type === 'track') {
    const track = await getJson(`${API}/v1/tracks/${ref.id}`, accessToken, fetchImpl);
    const collection = normalizeSingleTrack(track);
    if (!collection) throw new SpotifyApiError(404, 'canción no disponible');
    return collection;
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
