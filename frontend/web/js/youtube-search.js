// Búsqueda en YouTube desde el buscador (ADR-0021). Lógica sin DOM: pedir resultados al proxy del mismo origen,
// comprobar lo que devuelve y preparar los textos. La pantalla está en views/youtube-search.js.

export const YOUTUBE_SEARCH_ENDPOINT = '/api/youtube/search';
export const YOUTUBE_MIN_QUERY = 3;
export const YOUTUBE_MAX_QUERY = 100;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

/** Texto que se manda a YouTube: sin espacios de más. Null si es demasiado corto o largo. */
export function youtubeQuery(value) {
  const query = String(value ?? '').replace(/\s+/g, ' ').trim();
  const length = Array.from(query).length;
  return length >= YOUTUBE_MIN_QUERY && length <= YOUTUBE_MAX_QUERY ? query : null;
}

/** ¿Se busca en YouTube sin que lo pida la persona? Solo cuando la biblioteca no tiene ninguna canción que coincida. */
export function shouldSearchAutomatically(songCount) {
  return songCount === 0;
}

/** Segundos a «3:45» o «1:02:03». */
export function formatClock(seconds) {
  const total = Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds) : 0;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = String(total % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`;
}

/** Dirección del reproductor incrustado. youtube-nocookie evita las cookies de seguimiento hasta que se pulsa. */
export function embedUrl(id) {
  if (!VIDEO_ID.test(id)) throw new TypeError('Identificador de vídeo no válido.');
  return `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0&playsinline=1`;
}

/** Deja solo lo que la pantalla usa y descarta lo que no tenga la forma esperada. */
export function normalizeResults(data) {
  if (!Array.isArray(data?.items)) throw new Error('La respuesta de la búsqueda no es válida.');
  const seen = new Set();
  const items = [];
  for (const raw of data.items) {
    if (!raw || typeof raw.id !== 'string' || !VIDEO_ID.test(raw.id) || seen.has(raw.id)) continue;
    if (typeof raw.title !== 'string' || raw.title.trim() === '') continue;
    seen.add(raw.id);
    items.push({
      id: raw.id,
      url: `https://www.youtube.com/watch?v=${raw.id}`,
      title: raw.title.trim(),
      artist: typeof raw.artist === 'string' ? raw.artist.trim() : '',
      durationS: Number.isFinite(raw.durationS) ? raw.durationS : 0,
    });
  }
  return items;
}

/** Busca [query] en YouTube. Lanza Error con un mensaje para la persona si falla. */
export async function searchYoutube(query, { fetchImpl = globalThis.fetch, signal } = {}) {
  const text = youtubeQuery(query);
  if (!text) throw new Error('Escribe al menos tres letras para buscar en YouTube.');
  let response;
  try {
    response = await fetchImpl(`${YOUTUBE_SEARCH_ENDPOINT}?q=${encodeURIComponent(text)}`, {
      headers: { Accept: 'application/json' },
      signal,
    });
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    throw new Error('No se pudo conectar para buscar en YouTube. Comprueba la conexión.');
  }
  let data = null;
  try {
    data = await response.json();
  } catch {
    // Se informa más abajo.
  }
  if (!response.ok) {
    throw new Error(typeof data?.error === 'string' && data.error ? data.error : 'No se pudo buscar en YouTube.');
  }
  return normalizeResults(data);
}
