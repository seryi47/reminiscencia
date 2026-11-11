// Búsqueda en YouTube Music (candidatos oficiales «Topic»/«Art Track») para «Transferir música» (ADR-0044). Mejora la
// precisión del matcher: estos resultados son subidas oficiales de sello, con artista y duración limpios.
//
// Módulo propio SIN node:child_process (a diferencia de youtube-search.js, que usa yt-dlp): así lo puede importar también
// el Worker de Cloudflare, que no tiene child_process. Solo usa `fetch` (lo tiene tanto Node como el Worker). Es ADITIVO:
// si YouTube Music falla o no se puede parsear, devuelve [] y se usa la búsqueda normal.

import { canonicalVideoUrl, fetchWithTimeout } from './youtube-common.js';

const USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const MAX_DURATION_S = 20 * 60; // una canción no dura más (igual que la búsqueda normal)
const HOME_TIMEOUT_MS = 8_000;
const SEARCH_TIMEOUT_MS = 12_000;
const MUSIC_HOME = 'https://music.youtube.com/';
const MUSIC_SEARCH = 'https://music.youtube.com/youtubei/v1/search';
export const MUSIC_MAX_RESULTS = 8;
// Filtro «Canciones» de YouTube Music: sin él, la búsqueda devuelve una página mixta (tarjeta + vídeos + listas) de la
// que apenas se puede extraer un par de canciones; con él, devuelve la LISTA limpia de grabaciones oficiales («Topic»/
// «Art Track»), cada una con artista y duración exacta, y la mejor coincidencia suele venir la primera. Es la señal más
// útil del matcher (ADR-0044): para casi cualquier canción trae la versión de estudio con la duración precisa.
const MUSIC_SONGS_FILTER = 'EgWKAQIIAWoKEAkQBRAKEAMQBA==';

/** «3:45» o «1:02:03» a segundos; null si no tiene el formato (por ejemplo, «EN DIRECTO»). */
export function parseClock(text) {
  const parts = String(text ?? '').trim().split(':');
  if (parts.length < 2 || parts.length > 3 || !parts.every((part) => /^\d{1,2}$/.test(part))) return null;
  return parts.reduce((total, part) => total * 60 + Number(part), 0);
}

/** Primer watchEndpoint.videoId que cuelgue de un nodo (el id de la canción). */
function firstVideoId(node, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 20) return null;
  const id = node.watchEndpoint?.videoId;
  if (typeof id === 'string' && VIDEO_ID.test(id)) return id;
  for (const key of Object.keys(node)) {
    const found = firstVideoId(node[key], depth + 1);
    if (found) return found;
  }
  return null;
}

const flexRuns = (col) => col?.musicResponsiveListItemFlexColumnRenderer?.text?.runs ?? [];
const flexText = (col) => flexRuns(col)[0]?.text ?? '';
const flexTexts = (col) => flexRuns(col).map((run) => run?.text ?? '').filter((t) => t && t.trim() && t.trim() !== '•');

/** Extrae canciones de la respuesta de /youtubei/v1/search: cada `musicResponsiveListItemRenderer` es un resultado. */
export function extractMusicSearch(data) {
  const out = [];
  const seen = new Set();
  const walk = (node, depth) => {
    if (!node || typeof node !== 'object' || depth > 30) return;
    if (Array.isArray(node)) { for (const child of node) walk(child, depth + 1); return; }
    const item = node.musicResponsiveListItemRenderer;
    if (item && typeof item === 'object') {
      const id = firstVideoId(item);
      const cols = item.flexColumns ?? [];
      const title = String(flexText(cols[0]) ?? '').trim().slice(0, 200);
      const sub = flexTexts(cols[1]);
      const durationS = parseClock(sub.find((t) => /^\d{1,2}:\d{2}(:\d{2})?$/.test(t)) ?? '');
      if (id && title && !seen.has(id) && Number.isFinite(durationS) && durationS > 0 && durationS <= MAX_DURATION_S) {
        seen.add(id);
        out.push({ id, url: canonicalVideoUrl(id), title, artist: (sub[0] ?? '').trim().slice(0, 200), durationS: Math.round(durationS), source: 'topic' });
      }
    }
    for (const key of Object.keys(node)) if (key !== 'musicResponsiveListItemRenderer') walk(node[key], depth + 1);
  };
  walk(data, 0);
  return out.slice(0, MUSIC_MAX_RESULTS);
}

// La apiKey/clientVersion de InnerTube salen de la home de YouTube Music y apenas cambian (versión diaria). Recargar la
// home en CADA búsqueda hace que, al resolver una playlist larga (decenas o cientos de canciones), YouTube empiece a
// limitar y devuelva vacío para muchas → esas canciones pierden la señal «Topic». Se cachean ~30 min para que toda una
// tanda reutilice una sola recarga (ADR-0044). Es memoria de proceso; en el Worker vive lo que dure la instancia.
const CREDS_TTL_MS = 30 * 60 * 1000;
let credsCache = null; // { apiKey, clientVersion, at }

async function innertubeCreds(fetchImpl) {
  const now = Date.now();
  if (credsCache && now - credsCache.at < CREDS_TTL_MS) return credsCache;
  const home = await fetchWithTimeout(fetchImpl, MUSIC_HOME, {
    headers: { Accept: 'text/html', 'Accept-Language': 'es-ES,es;q=0.9', 'User-Agent': USER_AGENT },
  }, HOME_TIMEOUT_MS);
  if (!home.ok) return null;
  const html = await home.text();
  const apiKey = html.match(/"INNERTUBE_API_KEY"\s*:\s*"([^"]+)"/)?.[1];
  const clientVersion = html.match(/"INNERTUBE_CLIENT_VERSION"\s*:\s*"([^"]+)"/)?.[1];
  if (!apiKey || !clientVersion) return null;
  credsCache = { apiKey, clientVersion, at: now };
  return credsCache;
}

/** Vacía la caché de credenciales de InnerTube (para pruebas; en producción caduca sola). */
export function resetMusicCredsCache() { credsCache = null; }

/** Busca una canción en YouTube Music. Devuelve candidatos oficiales o [] si no se puede (fallback a la búsqueda normal). */
export async function searchYoutubeMusic(query, { fetchImpl = globalThis.fetch } = {}) {
  try {
    const creds = await innertubeCreds(fetchImpl);
    if (!creds) return [];
    const { apiKey, clientVersion } = creds;
    const response = await fetchWithTimeout(fetchImpl, `${MUSIC_SEARCH}?key=${apiKey}&prettyPrint=false`, {
      method: 'POST',
      headers: {
        Accept: 'application/json', 'Content-Type': 'application/json',
        Origin: 'https://music.youtube.com', Referer: MUSIC_HOME, 'User-Agent': USER_AGENT,
      },
      body: JSON.stringify({
        context: { client: { clientName: 'WEB_REMIX', clientVersion, hl: 'es', gl: 'ES' } },
        query,
        params: MUSIC_SONGS_FILTER,
      }),
    }, SEARCH_TIMEOUT_MS);
    if (!response.ok) {
      // Credenciales caducadas o bloqueo: olvida la caché para que la próxima llamada recargue claves frescas.
      if (response.status === 400 || response.status === 401 || response.status === 403) credsCache = null;
      return [];
    }
    return extractMusicSearch(await response.json());
  } catch {
    return [];
  }
}

/** Une varias listas de candidatos conservando el orden y sin repetir ids (YouTube Music primero). */
export function mergeCandidates(...lists) {
  const seen = new Set();
  const out = [];
  for (const list of lists) {
    for (const candidate of list ?? []) {
      if (candidate?.id && !seen.has(candidate.id)) { seen.add(candidate.id); out.push(candidate); }
    }
  }
  return out;
}
