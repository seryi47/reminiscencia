// Fallback «Web Player» de Spotify (ADR-0044 ampliado 2026-11-25). En Development Mode sin Extended Quota, Spotify
// topa a 100 pistas la lectura de playlists AJENAS con nuestro client_id. Para saltarlo, pedimos un token al
// reproductor web público (`open.spotify.com/get_access_token`) desde el NAVEGADOR del usuario, que lleva las
// cookies de su sesión de Spotify. Ese endpoint emite tokens con el client_id del Web Player de Spotify, que sí
// tiene cuota completa; con él leemos la playlist entera directamente contra `api.spotify.com`.
//
// Requisitos para que funcione:
// - El usuario tiene que estar logueado en Spotify en el MISMO navegador. Si no, el endpoint devuelve un token
//   anónimo con `isAnonymous: true` que también está capado (devuelve 100 pistas); abortamos y lo decimos.
// - El origen de la web (reminiscencia.cometia.es) tiene que estar permitido en la CSP para `api.spotify.com` y
//   `open.spotify.com` (lo está desde este ADR).
// - La petición a `open.spotify.com` usa `credentials: 'include'` para que viajen las cookies de Spotify.

const WEB_PLAYER_TOKEN_URL = 'https://open.spotify.com/get_access_token?reason=transport&productType=web-player';
const API = 'https://api.spotify.com';
const LIMIT = 100; // tope duro del endpoint `/v1/playlists/{id}/tracks` por petición
const MAX_PAGES = 100; // seguridad (10 000 pistas máximo)

let cachedToken = null; // { accessToken, expiresAt }

/**
 * Obtiene un token del reproductor web público usando las cookies del usuario. Cachea mientras sea válido.
 * Devuelve `null` si no se puede (sin cookies, CORS, endpoint caído, token anónimo).
 */
export async function getWebPlayerToken({ fetchImpl = globalThis.fetch, now = () => Date.now() } = {}) {
  if (cachedToken && cachedToken.expiresAt > now() + 30_000) return cachedToken.accessToken;
  try {
    const res = await fetchImpl(WEB_PLAYER_TOKEN_URL, {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    if (!data?.accessToken) return null;
    // Un token anónimo (sin sesión del usuario) tiene las mismas limitaciones que el token de nuestra app.
    if (data.isAnonymous === true) return null;
    const expiresAt = Number(data.accessTokenExpirationTimestampMs) || (now() + 55 * 60_000);
    cachedToken = { accessToken: data.accessToken, expiresAt };
    return cachedToken.accessToken;
  } catch { return null; }
}

/**
 * Lee las pistas de una playlist directamente con el token del Web Player. Devuelve `null` si no se puede obtener
 * el token (sin sesión abierta en Spotify); o un array (posiblemente parcial) si una página en medio falla.
 * El formato devuelto es el CRUDO de `/v1/playlists/{id}/tracks`: cada entrada es `{ track: { ... } }`, no
 * normalizada. Quien llame debe normalizar con `spotify-core.normalizeTrack`.
 */
export async function fetchPlaylistFromWebPlayer(playlistId, { fetchImpl = globalThis.fetch, now = () => Date.now() } = {}) {
  const token = await getWebPlayerToken({ fetchImpl, now });
  if (!token) return null;
  const items = [];
  for (let page = 0, offset = 0; page < MAX_PAGES; page += 1, offset += LIMIT) {
    const url = `${API}/v1/playlists/${encodeURIComponent(playlistId)}/tracks?offset=${offset}&limit=${LIMIT}`;
    let res;
    try {
      res = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` } });
    } catch { break; }
    if (res.status === 401) { cachedToken = null; break; } // token caducado a mitad: lo olvidamos
    if (!res.ok) break;
    const data = await res.json().catch(() => null);
    const pageItems = Array.isArray(data?.items) ? data.items : [];
    if (pageItems.length === 0) break;
    items.push(...pageItems);
    if (pageItems.length < LIMIT) break;
  }
  return items;
}

/** Solo para las pruebas: olvida el token cacheado para que cada caso arranque limpio. */
export function _resetWebPlayerTokenCache() { cachedToken = null; }
