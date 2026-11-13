// Ingesta de Spotify para «Transferir música» (ADR-0044): interpretar un enlace/URI de Spotify y normalizar las
// respuestas de la API de Spotify a la forma interna de una pista que entiende el motor de identificación
// (spotify-match.js) y, más adelante, el pipeline de subida. PURO: no hace red (eso lo pone la capa de transporte con
// OAuth, que se inyecta); así se prueba contra respuestas simuladas sin credenciales.
//
// Forma interna de una pista: { title, artists:[principal, ...], album, durationMs, year, isrc, trackNumber, discNumber,
// cover, spotifyId }. Forma de una colección: { type:'track'|'album'|'playlist', id, name, artist?, year?, cover?, tracks:[...] }.

import { normalizeText } from '../js/catalog.js';

const ID = '[A-Za-z0-9]{22}'; // los ids de Spotify son base62 de 22 caracteres
const URL_RE = new RegExp(`open\\.spotify\\.com/(?:intl-[a-z]{2}/)?(track|album|playlist)/(${ID})`, 'i');
const URI_RE = new RegExp(`^spotify:(track|album|playlist):(${ID})$`, 'i');

/** Interpreta un enlace o URI de Spotify. Devuelve { type, id } o null si no es uno válido. */
export function parseSpotifyRef(input) {
  const text = String(input ?? '').trim();
  const byUri = URI_RE.exec(text);
  if (byUri) return { type: byUri[1].toLowerCase(), id: byUri[2] };
  const byUrl = URL_RE.exec(text);
  if (byUrl) return { type: byUrl[1].toLowerCase(), id: byUrl[2] };
  return null;
}

const yearOf = (releaseDate) => {
  const match = /^(\d{4})/.exec(String(releaseDate ?? ''));
  return match ? Number(match[1]) : null;
};

const artistNames = (artists) =>
  (Array.isArray(artists) ? artists : []).map((artist) => artist?.name).filter((name) => typeof name === 'string' && name);

const coverOf = (images) => (Array.isArray(images) && images[0]?.url) || null;

/**
 * Normaliza un objeto «track» de la API de Spotify. [albumContext] rellena álbum, año y portada cuando el track viene
 * «simplificado» dentro de un álbum (los tracks de un álbum no traen su propio objeto `album`).
 */
export function normalizeTrack(track, albumContext = null) {
  if (!track || typeof track !== 'object' || track.is_local) return null;
  const album = track.album ?? albumContext ?? {};
  const name = typeof track.name === 'string' ? track.name : '';
  if (!name) return null;
  return {
    title: name,
    artists: artistNames(track.artists),
    album: typeof album.name === 'string' ? album.name : (albumContext?.name ?? ''),
    durationMs: typeof track.duration_ms === 'number' ? track.duration_ms : null,
    year: yearOf(album.release_date ?? albumContext?.release_date),
    isrc: track.external_ids?.isrc ?? null,
    trackNumber: typeof track.track_number === 'number' ? track.track_number : null,
    discNumber: typeof track.disc_number === 'number' ? track.disc_number : null,
    cover: coverOf(album.images) ?? (albumContext ? coverOf(albumContext.images) : null),
    spotifyId: typeof track.id === 'string' ? track.id : null,
  };
}

/** Normaliza un objeto «album» de Spotify a { type:'album', id, name, artist, year, cover, tracks:[...] } respetando el orden. */
export function normalizeAlbum(album) {
  if (!album || typeof album !== 'object') return null;
  const context = { name: album.name, release_date: album.release_date, images: album.images };
  const items = album.tracks?.items ?? [];
  const tracks = items.map((item) => normalizeTrack(item, context)).filter(Boolean);
  const artists = artistNames(album.artists);
  return {
    type: 'album',
    id: typeof album.id === 'string' ? album.id : null,
    name: typeof album.name === 'string' ? album.name : '',
    artist: artists.length === 1 ? artists[0] : (artists[0] ?? ''),
    artists,
    year: yearOf(album.release_date),
    cover: coverOf(album.images),
    tracks,
  };
}

/** Normaliza un objeto «playlist» de Spotify a { type:'playlist', id, name, cover, tracks:[...] } respetando el orden. */
export function normalizePlaylist(playlist) {
  if (!playlist || typeof playlist !== 'object') return null;
  // Desde la migración de 2026 (apps en «development mode»), el objeto paginado de pistas es `items` y cada entrada lleva
  // la pista en `item` (antes eran `tracks` y `track`); se admiten ambos. Se saltan las entradas locales, las retiradas
  // (nulas) y los episodios (`type` distinto de `track`).
  const paging = playlist.items ?? playlist.tracks ?? {};
  const entries = paging.items ?? [];
  const tracks = entries.map((entry) => {
    if (!entry || entry.is_local) return null;
    const track = entry.item ?? entry.track;
    if (!track || (track.type && track.type !== 'track')) return null;
    return normalizeTrack(track);
  }).filter(Boolean);
  return {
    type: 'playlist',
    id: typeof playlist.id === 'string' ? playlist.id : null,
    name: typeof playlist.name === 'string' ? playlist.name : '',
    cover: coverOf(playlist.images),
    owner: playlist.owner?.display_name ?? null,
    tracks,
  };
}

/** Una sola canción (objeto «track» de Spotify) como colección de un elemento, para tratar todo igual aguas abajo. */
export function normalizeSingleTrack(track) {
  const normalized = normalizeTrack(track);
  if (!normalized) return null;
  return {
    type: 'track',
    id: normalized.spotifyId,
    name: normalized.title,
    artist: normalized.artists[0] ?? '',
    year: normalized.year,
    cover: normalized.cover,
    tracks: [normalized],
  };
}

/**
 * Consultas de YouTube para buscar una pista, de la más precisa a la más amplia (ADR-0046). El resolver las prueba en orden
 * y acumula candidatos hasta tener una coincidencia sólida, en vez de depender de un único intento. Variantes:
 *   1. «artista principal + título» (sin la cola de «feat»): la de siempre, la mejor en el caso normal.
 *   2. «todos los artistas + título» (solo si hay colaboración): desambigua los temas con featuring, que YouTube suele
 *      titular con todos los artistas.
 *   3. «título solo»: último recurso amplio para cuando el nombre del artista en Spotify no coincide con el de YouTube
 *      (localizaciones, grafías distintas).
 * No normaliza acentos: YouTube los maneja. Sin duplicados ni cadenas vacías.
 */
export function youtubeQueriesFor(internalTrack) {
  const artists = Array.isArray(internalTrack.artists) ? internalTrack.artists.filter(Boolean) : [];
  const a0 = artists[0] ?? '';
  const titleCore = String(internalTrack.title ?? '')
    .replace(/\s*[([].*?(feat\.?|ft\.?|con)\s.*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  const allArtists = artists.join(' ');
  const out = [];
  const seen = new Set();
  // Deduplica SIN distinguir mayúsculas (YouTube es insensible a mayúsculas): así la variante «plegada» solo se añade cuando
  // de verdad cambia algo (quita tildes o guiones), no por el mero cambio de caja.
  const add = (parts) => {
    const q = parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    const key = q.toLowerCase();
    if (q && !seen.has(key)) { seen.add(key); out.push(q); }
  };
  // Exacta y, justo detrás, la PLEGADA (sin tildes ni guiones): «Cazzu Peli-Culeo» → «cazzu peli culeo», «Quevedo AMANECIÓ»
  // → «quevedo amanecio». Es la que rescata los títulos con guion o acento que YouTube no encontraba tal cual (ADR-0046).
  add([a0, titleCore]);
  add([normalizeText(a0), normalizeText(titleCore)]);
  if (artists.length > 1) {
    add([allArtists, titleCore]);
    add([normalizeText(allArtists), normalizeText(titleCore)]);
  }
  add([titleCore]);
  add([normalizeText(titleCore)]);
  return out.length ? out : [String(internalTrack.title ?? '').replace(/\s+/g, ' ').trim()].filter(Boolean);
}

/** La mejor consulta (primera variante). Se conserva para compatibilidad y para la reselección manual. */
export function youtubeQueryFor(internalTrack) {
  return youtubeQueriesFor(internalTrack)[0] ?? '';
}
