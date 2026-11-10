// Ingesta de Spotify para «Transferir música» (ADR-0044): interpretar un enlace/URI de Spotify y normalizar las
// respuestas de la API de Spotify a la forma interna de una pista que entiende el motor de identificación
// (spotify-match.js) y, más adelante, el pipeline de subida. PURO: no hace red (eso lo pone la capa de transporte con
// OAuth, que se inyecta); así se prueba contra respuestas simuladas sin credenciales.
//
// Forma interna de una pista: { title, artists:[principal, ...], album, durationMs, year, isrc, trackNumber, discNumber,
// cover, spotifyId }. Forma de una colección: { type:'track'|'album'|'playlist', id, name, artist?, year?, cover?, tracks:[...] }.

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
  const items = playlist.tracks?.items ?? [];
  // Cada entrada es { track: <track o null> }; se saltan las pistas locales o retiradas.
  const tracks = items.map((item) => normalizeTrack(item?.track)).filter(Boolean);
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
 * Consulta de YouTube para buscar una pista: «artista título», ya sin la cola de «feat» del título (el matcher ya la
 * ignora, pero acortar la consulta mejora los resultados). No normaliza acentos: YouTube los maneja.
 */
export function youtubeQueryFor(internalTrack) {
  const artist = internalTrack.artists?.[0] ?? '';
  const title = String(internalTrack.title ?? '').replace(/\s*[([].*?(feat\.?|ft\.?|con)\s.*$/i, '').trim();
  return [artist, title].filter(Boolean).join(' ').trim();
}
