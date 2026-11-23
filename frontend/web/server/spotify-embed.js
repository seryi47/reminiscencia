// Lectura de una playlist PÚBLICA de Spotify por su página «embed» (ADR-0044). Es el respaldo para listas que el usuario
// solo SIGUE (no son suyas): en «development mode» la API devuelve metadatos pero 0 pistas, y el token de app da 403 en
// /tracks. La página pública open.spotify.com/embed/playlist/<id> incluye en su JSON (`__NEXT_DATA__`) una `trackList` con
// título, artista y duración de hasta 100 canciones. Solo `fetch` (lo usa también el Worker), sin child_process.
//
// Límite: el embed tope en ~100 pistas, así que una lista más larga se importa parcial (se avisa en la interfaz).

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const NEXT_DATA = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/;

/** Busca en profundidad la primera propiedad `key` (array/objeto) dentro de un JSON anidado. */
function findDeep(node, key, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 40) return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findDeep(child, key, depth + 1);
      if (found != null) return found;
    }
    return null;
  }
  if (Object.prototype.hasOwnProperty.call(node, key)) return node[key];
  for (const value of Object.values(node)) {
    const found = findDeep(value, key, depth + 1);
    if (found != null) return found;
  }
  return null;
}

/** Normaliza una pista del embed al mismo formato que normalizeTrack (title, artists, durationMs, …). */
export function tracksFromEmbedData(data) {
  const trackList = findDeep(data, 'trackList');
  if (!Array.isArray(trackList)) return [];
  const tracks = [];
  for (const entry of trackList) {
    const title = typeof entry?.title === 'string' ? entry.title.trim() : '';
    if (!title) continue;
    const subtitle = typeof entry?.subtitle === 'string' ? entry.subtitle : '';
    const artists = subtitle ? subtitle.split(/,\s*/).map((a) => a.trim()).filter(Boolean) : [];
    const durationMs = typeof entry?.duration === 'number' ? entry.duration : null;
    const uri = typeof entry?.uri === 'string' ? entry.uri : '';
    const spotifyId = uri.startsWith('spotify:track:') ? uri.slice('spotify:track:'.length) : null;
    tracks.push({
      title, artists, album: '', durationMs, year: null, isrc: null,
      trackNumber: null, discNumber: null, cover: null, spotifyId,
    });
  }
  return tracks;
}

/** Lee las pistas (hasta ~100) de una playlist pública por su página embed. Devuelve [] si no se puede. */
export async function fetchPublicPlaylistTracks(playlistId, fetchImpl = fetch) {
  return fetchPublicEmbedTracks('playlist', playlistId, fetchImpl);
}

/** Lee las pistas de un álbum público por su página embed. Devuelve [] si no se puede. */
export async function fetchPublicAlbumTracks(albumId, fetchImpl = fetch) {
  return fetchPublicEmbedTracks('album', albumId, fetchImpl);
}

/** Lee la pista única de una canción pública por su página embed. Devuelve [] si no se puede. */
export async function fetchPublicTrack(trackId, fetchImpl = fetch) {
  return fetchPublicEmbedTracks('track', trackId, fetchImpl);
}

/** Núcleo común: lee `trackList` del `__NEXT_DATA__` del embed público (playlist/album/track) de Spotify.
 * Reintentos con backoff (ADR-0044 ampliado 2026-11-23): el embed de Spotify devuelve a veces 5xx transitorios cuando
 * se le piden varias páginas de la misma playlist seguidas (el cliente pagina y cada página vuelve a llamar aquí). Un
 * fallo sin reintento se traducía en una página ENTERA de 25 pistas perdidas como `tier=baja` sin candidato: el usuario
 * ve «faltan 5 de 100» pero solo puede marcar 3, porque 2 vienen de una página que cayó.
 */
async function fetchPublicEmbedTracks(kind, id, fetchImpl = fetch) {
  const url = `https://open.spotify.com/embed/${kind}/${encodeURIComponent(id)}`;
  const attempts = 3;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetchImpl(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml' } });
      if (!res.ok) { if (i < attempts - 1) { await sleep(300 * (i + 1)); continue; } return []; }
      const html = await res.text();
      const match = html.match(NEXT_DATA);
      if (!match) { if (i < attempts - 1) { await sleep(300 * (i + 1)); continue; } return []; }
      let data;
      try { data = JSON.parse(match[1]); } catch { if (i < attempts - 1) { await sleep(300 * (i + 1)); continue; } return []; }
      const tracks = tracksFromEmbedData(data);
      if (tracks.length === 0 && i < attempts - 1) { await sleep(300 * (i + 1)); continue; }
      return tracks;
    } catch {
      if (i < attempts - 1) { await sleep(300 * (i + 1)); continue; }
      return [];
    }
  }
  return [];
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/** Metadatos de cabecera del embed: name, image, artist (si álbum). Útil para pintar la card de la colección. */
export async function fetchPublicEmbedMeta(kind, id, fetchImpl = fetch) {
  try {
    const res = await fetchImpl(`https://open.spotify.com/embed/${kind}/${encodeURIComponent(id)}`, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml' },
    });
    if (!res.ok) return null;
    const html = await res.text();
    const match = html.match(NEXT_DATA);
    if (!match) return null;
    let data;
    try { data = JSON.parse(match[1]); } catch { return null; }
    const name = findDeep(data, 'name') || findDeep(data, 'title') || '';
    const image = findDeep(data, 'imageUrl') || findDeep(data, 'image') || null;
    const subtitle = findDeep(data, 'subtitle') || '';
    return { name: String(name || ''), image: typeof image === 'string' ? image : null, subtitle: String(subtitle || '') };
  } catch {
    return null;
  }
}
