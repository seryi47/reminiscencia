// Lógica de cliente de «Transferir música» (ADR-0044), compartida por la vista web y probada aparte (sin DOM): guarda la
// sesión de Spotify, arranca el login, resuelve la colección por páginas (refrescando el token si caduca), marca las que
// ya están en la biblioteca y decide qué pistas se transfieren. La UI (views/transferir.js) solo pinta esto y llama a
// importYoutubeTracks para el enganche al pipeline.

import { isPossibleDuplicate } from './duplicates.js';

export const SESSION_KEY = 'reminiscencia.spotify';
export const PKCE_KEY = 'reminiscencia.spotify.pkce';
const REFRESH_MARGIN_MS = 60_000;

const needAuth = () => Object.assign(new Error('Conecta tu cuenta de Spotify.'), { needsAuth: true });

// --- Sesión (en localStorage; tolerante a modo incógnito) ------------------------------------------------------------
export function readSession(storage = globalThis.localStorage) {
  try { return JSON.parse(storage?.getItem(SESSION_KEY) ?? 'null'); } catch { return null; }
}
export function writeSession(session, storage = globalThis.localStorage) {
  try { storage?.setItem(SESSION_KEY, JSON.stringify(session)); } catch { /* incógnito: la sesión dura lo que la pestaña */ }
  return session;
}
export function clearSession(storage = globalThis.localStorage) {
  try { storage?.removeItem(SESSION_KEY); } catch { /* nada */ }
}
export function isConnected(storage = globalThis.localStorage) {
  const session = readSession(storage);
  return Boolean(session?.accessToken || session?.refreshToken);
}
const needsRefresh = (session, now) => !session?.expiresAt || session.expiresAt - now <= REFRESH_MARGIN_MS;

// --- Cliente HTTP de los endpoints -----------------------------------------------------------------------------------
export function createTransferApi(fetchImpl = globalThis.fetch, base = '') {
  const post = async (path, body) => {
    const res = await fetchImpl(`${base}${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 || data.needsAuth) throw needAuth();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  };
  return {
    login: () => post('/api/spotify/login'),
    token: (code, verifier) => post('/api/spotify/token', { code, verifier }),
    refresh: (refreshToken) => post('/api/spotify/refresh', { refreshToken }),
    resolve: ({ url, accessToken, offset, limit }) => post('/api/spotify/resolve', { url, accessToken, offset, limit }),
  };
}

// --- Login -----------------------------------------------------------------------------------------------------------
/** Arranca el login: pide la URL de Spotify, guarda verifier+state para el callback y devuelve la URL a abrir. */
export async function beginConnect({ api, returnTo = '#transferir', pkceStore = globalThis.sessionStorage } = {}) {
  const { url, verifier, state } = await api.login();
  try { pkceStore?.setItem(PKCE_KEY, JSON.stringify({ verifier, state, returnTo })); } catch { /* incógnito */ }
  return url;
}

// --- Token fresco (refresca si hace falta) ---------------------------------------------------------------------------
async function refreshNow({ api, storage, session }) {
  const current = session ?? readSession(storage);
  if (!current?.refreshToken) throw needAuth();
  let refreshed;
  try { refreshed = await api.refresh(current.refreshToken); } catch { clearSession(storage); throw needAuth(); }
  writeSession(refreshed, storage);
  return refreshed.accessToken;
}
async function freshAccessToken({ api, storage, now }) {
  const session = readSession(storage);
  if (!session?.accessToken && !session?.refreshToken) throw needAuth();
  if (!needsRefresh(session, now())) return session.accessToken;
  return refreshNow({ api, storage, session });
}

// --- Resolver la colección por páginas -------------------------------------------------------------------------------
/**
 * Resuelve una colección entera llamando a /resolve por páginas (y refrescando el token si caduca a mitad). Devuelve
 * { album, results, total, summary }. `onPage({ loaded, total, album })` informa del avance.
 */
export async function resolveCollection({ api, url, storage = globalThis.localStorage, onPage, now = () => Date.now(), pageLimit = 25 }) {
  let accessToken = await freshAccessToken({ api, storage, now });
  const results = [];
  const summary = { total: 0, alta: 0, media: 0, baja: 0, error: 0 };
  let album = null;
  let total = 0;
  let offset = 0;
  for (;;) {
    let page;
    try {
      page = await api.resolve({ url, accessToken, offset, limit: pageLimit });
    } catch (error) {
      if (!error.needsAuth) throw error;
      accessToken = await refreshNow({ api, storage }); // token caducado a mitad: refresca y reintenta la misma página
      page = await api.resolve({ url, accessToken, offset, limit: pageLimit });
    }
    album = page.album ?? album;
    total = page.total ?? results.length + page.results.length;
    results.push(...page.results);
    for (const tier of ['alta', 'media', 'baja', 'error']) summary[tier] += page.summary?.[tier] ?? 0;
    summary.total = results.length;
    onPage?.({ loaded: results.length, total, album });
    if (!page.hasMore) break;
    offset += pageLimit;
  }
  return { album, results, total, summary };
}

// --- Dedup y selección -----------------------------------------------------------------------------------------------
const trackArtist = (track) => (Array.isArray(track.artists) ? track.artists[0] : track.artist) ?? '';
const trackDurationS = (track) => (typeof track.durationMs === 'number' ? track.durationMs / 1000 : null);

/** Marca cada resultado con `inLibrary` si la canción ya está en la biblioteca (misma regla de duplicados: título + duración). */
export function markDuplicates(results, songs = []) {
  for (const result of results) {
    const probe = { title: result.track.title, artist: trackArtist(result.track), duration_s: trackDurationS(result.track) };
    result.inLibrary = songs.some((song) =>
      isPossibleDuplicate(probe, { title: song.title, artist: song.artist, duration_s: song.durationS ?? song.duration_s }));
  }
  return results;
}

/**
 * Pistas que se van a transferir, como [{ index, url, title, artist }] para importYoutubeTracks:
 * - se saltan las excluidas (el usuario las quitó) y las que ya están en la biblioteca;
 * - una confianza ALTA se acepta sola; MEDIA/BAJA solo si el usuario eligió un candidato (override);
 * - un override (alternativa elegida o búsqueda manual) manda sobre todo.
 */
export function selectedTracks(results, { excluded = new Set(), overrides = new Map() } = {}) {
  const chosen = [];
  for (const result of results) {
    if (excluded.has(result.index) || result.inLibrary) continue;
    const pick = overrides.get(result.index) ?? (result.tier === 'alta' ? result.best : null);
    const url = pick?.candidate?.url;
    if (!url) continue;
    chosen.push({ index: result.index, url, title: result.track.title, artist: trackArtist(result.track) });
  }
  return chosen;
}
