// Lógica de cliente de «Transferir música» (ADR-0044), compartida por la vista web y probada aparte (sin DOM): guarda la
// sesión de Spotify, arranca el login, resuelve la colección por páginas (refrescando el token si caduca), marca las que
// ya están en la biblioteca y decide qué pistas se transfieren. La UI (views/transferir.js) solo pinta esto y llama a
// importYoutubeTracks para el enganche al pipeline.

import { isSameLibraryTrack } from './library-match.js';
import { normalizeText } from './catalog.js';

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
    if (!res.ok) {
      const err = new Error(data.error || `HTTP ${res.status}`);
      // Propagamos el detalle del fallo de Spotify (ADR-0044 ampliado 2026-11-23): si Spotify ha restringido
      // el listado automático de playlists (403 en /v1/me/playlists para apps en Development Mode sin Extended
      // Quota), el cliente lo detecta y ofrece la vía manual «pega una URL» en vez del error genérico.
      err.endpoint = data.endpoint;
      err.spotifyStatus = data.spotifyStatus;
      err.spotifyBody = data.spotifyBody;
      throw err;
    }
    return data;
  };
  return {
    login: () => post('/api/spotify/login'),
    token: (code, verifier) => post('/api/spotify/token', { code, verifier }),
    refresh: (refreshToken) => post('/api/spotify/refresh', { refreshToken }),
    mine: (accessToken) => post('/api/spotify/mine', { accessToken }),
    resolve: (params) => post('/api/spotify/resolve', params), // { url|source|ref|tracks, accessToken, offset, limit }
    recent: (accessToken, cap = 200) => post('/api/spotify/recent', { accessToken, cap }), // últimas pistas escuchadas
  };
}

// --- Login -----------------------------------------------------------------------------------------------------------
/** Arranca el login: pide la URL de Spotify, guarda verifier+state para el callback y devuelve la URL a abrir. */
export async function beginConnect({ api, returnTo = '/#transferir', pkceStore = globalThis.sessionStorage } = {}) {
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
export async function resolveCollection({ api, url, source, ref, storage = globalThis.localStorage, onPage, now = () => Date.now(), pageLimit = 25, compareOnly = false }) {
  const target = ref ? { ref } : (source ? { source } : { url }); // qué se resuelve: enlace, «Me gusta» o una referencia
  if (compareOnly) target.compareOnly = true; // solo listar y comparar, sin resolver YouTube (ADR-0046)
  let accessToken = await freshAccessToken({ api, storage, now });
  const results = [];
  const summary = { total: 0, alta: 0, media: 0, baja: 0, error: 0 };
  let album = null;
  let total = 0;
  let offset = 0;
  let devModeCap = false;
  let reportedTotal = 0;
  for (;;) {
    let page;
    try {
      page = await api.resolve({ ...target, accessToken, offset, limit: pageLimit });
    } catch (error) {
      if (!error.needsAuth) throw error;
      accessToken = await refreshNow({ api, storage }); // token caducado a mitad: refresca y reintenta la misma página
      page = await api.resolve({ ...target, accessToken, offset, limit: pageLimit });
    }
    album = page.album ?? album;
    total = page.total ?? results.length + page.results.length;
    // Tope de dev-mode de Spotify: una página marca la colección si Spotify respondió un total mayor que lo leído
    // (ADR-0044). Lo propagamos arriba para que la vista pueda mostrar el aviso con el recuento real.
    devModeCap = devModeCap || page.devModeCap === true;
    reportedTotal = Math.max(reportedTotal, page.reportedTotal ?? total);
    results.push(...page.results);
    for (const tier of ['alta', 'media', 'baja', 'error']) summary[tier] += page.summary?.[tier] ?? 0;
    summary.total = results.length;
    onPage?.({ loaded: results.length, total, album });
    if (!page.hasMore) break;
    offset += pageLimit;
  }
  // Ampliación 2026-11-25 — amplía con RECENTLY-PLAYED del usuario: cuando se resuelve una PLAYLIST (típicamente
  // una «Mix» con Autoplay), pedimos también sus últimas pistas escuchadas (hasta 300) y añadimos al batch las
  // que NO estén ya en la lista. Esto emula lo que hace TuneMyMusic: ver más allá de las 100 pistas fijas de
  // la Mix cogiendo las canciones que han estado sonando por Autoplay. Spotify no expone el Autoplay directamente
  // pero el historial es la señal más cercana. Solo se activa cuando NO es compareOnly.
  const isPlaylistLike = ref?.type === 'playlist'
    || (url && typeof url === 'string' && url.includes('/playlist/'))
    || source === 'liked';
  if (!compareOnly && isPlaylistLike) {
    let recentTracks = [];
    try {
      const r = await api.recent(accessToken, 300);
      recentTracks = Array.isArray(r?.tracks) ? r.tracks : [];
    } catch (error) {
      // 403 (sin scope user-read-recently-played): seguimos SIN aviso duro; el usuario tiene que reconectar,
      // pero las 100 de la playlist van igual. Un 401 ya lo gestiona el flujo normal abajo.
      if (error?.needsAuth) throw error;
    }
    // Deduplicar: quitar del `recentTracks` los spotifyId ya presentes en la playlist.
    const existingIds = new Set(results.map((r) => r.track?.spotifyId).filter(Boolean));
    const extraRaw = recentTracks
      .filter((t) => t && t.id && !existingIds.has(t.id))
      .filter((t) => (t.type ?? 'track') === 'track' && !t.is_local);
    if (extraRaw.length > 0) {
      const alreadyLoaded = results.length;
      const albumRef = ref?.type === 'playlist' ? ref
        : (url?.includes('/playlist/') ? { type: 'playlist', id: url.match(/\/playlist\/([A-Za-z0-9]+)/)?.[1] ?? 'recent' } : { type: 'playlist', id: 'recent' });
      // Matcheamos las nuevas en ventanas de `pageLimit` usando el endpoint `tracks:[...]` (ADR-0044 2026-11-25).
      for (let extraOffset = 0; extraOffset < extraRaw.length; extraOffset += pageLimit) {
        const window = extraRaw.slice(extraOffset, extraOffset + pageLimit);
        const indexOffset = alreadyLoaded + extraOffset;
        const call = () => api.resolve({
          tracks: window, accessToken, albumRef, name: album?.name,
          offset: 0, limit: window.length, indexOffset,
        });
        let page;
        try { page = await call(); }
        catch (error) {
          if (!error.needsAuth) throw error;
          accessToken = await refreshNow({ api, storage });
          page = await call();
        }
        results.push(...page.results);
        for (const tier of ['alta', 'media', 'baja', 'error']) summary[tier] += page.summary?.[tier] ?? 0;
        summary.total = results.length;
        total = alreadyLoaded + extraRaw.length;
        onPage?.({ loaded: results.length, total, album, recent: true });
      }
    }
  }
  // Rescate final (ADR-0044 ampliado 2026-11-19): aisladas, las pistas sí salen `tier=alta`; en una página de 25 un
  // puñado se pierde por rate-limit acumulado del upstream. Para esos sobrantes, relanzamos `/resolve` UNO a UNO con la
  // URL del track — concurrencia 2 y solo las verdaderamente vacías (`tier=baja, alternatives=[], !error`), nunca las
  // que el servidor ya marcó como fallidas con error. Si la 2ª llamada sigue vacía, la dejamos tal cual.
  if (!compareOnly) {
    const stragglers = [];
    for (let i = 0; i < results.length; i += 1) {
      const r = results[i];
      if (r.tier === 'baja' && (!r.alternatives || r.alternatives.length === 0) && !r.error && r.track?.spotifyId) {
        stragglers.push(i);
      }
    }
    if (stragglers.length > 0) {
      onPage?.({ loaded: results.length, total, album, retrying: stragglers.length });
      let next = 0;
      const rescue = async () => {
        while (next < stragglers.length) {
          const idx = next; next += 1;
          const i = stragglers[idx];
          const r = results[i];
          const trackUrl = `https://open.spotify.com/track/${r.track.spotifyId}`;
          try {
            const page = await api.resolve({ url: trackUrl, accessToken });
            const fresh = page?.results?.[0];
            if (fresh && (fresh.tier === 'alta' || fresh.tier === 'media')) {
              // sumar al sumario (restar de baja, sumar al nuevo tier)
              summary.baja = Math.max(0, (summary.baja ?? 0) - 1);
              summary[fresh.tier] = (summary[fresh.tier] ?? 0) + 1;
              results[i] = { ...fresh, index: r.index }; // conservar índice global
            }
          } catch { /* una pista que falla en el rescate se deja como estaba */ }
        }
      };
      await Promise.all([rescue(), rescue()]);
    }
  }
  return { album, results, total, summary, devModeCap, reportedTotal };
}

/** Lista la biblioteca del usuario (playlists + «Me gusta») para elegir qué transferir. Refresca el token si hace falta. */
export async function listLibrary({ api, storage = globalThis.localStorage, now = () => Date.now() }) {
  const accessToken = await freshAccessToken({ api, storage, now });
  try {
    return await api.mine(accessToken);
  } catch (error) {
    if (!error.needsAuth) throw error;
    return api.mine(await refreshNow({ api, storage }));
  }
}

// --- Dedup y selección -----------------------------------------------------------------------------------------------
const trackArtist = (track) => (Array.isArray(track.artists) ? track.artists[0] : track.artist) ?? '';
const trackDurationS = (track) => (typeof track.durationMs === 'number' ? track.durationMs / 1000 : null);

/** Clave normalizada «título|artista» para no transferir dos veces la misma canción dentro de una misma tanda. */
const transferKey = (title, artist) => `${normalizeText(title)}|${normalizeText(artist)}`;

/**
 * Marca cada resultado con `inLibrary` si la canción ya está en la biblioteca, con la regla TOLERANTE de presencia en
 * biblioteca (ADR-0046, library-match.js): más laxa que la de duplicados a propósito, para no contar como «falta» algo que
 * ya tienes por un «Remastered», un «feat.» o unos segundos de diferencia; pero la regla de versión sigue distinguiendo
 * (una versión en directo o un remix NO cuentan como que ya la tienes).
 */
export function markDuplicates(results, songs = []) {
  for (const result of results) {
    const probe = { title: result.track.title, artist: trackArtist(result.track), durationS: trackDurationS(result.track) };
    const match = songs.find((song) =>
      isSameLibraryTrack(probe, { title: song.title, artist: song.artist, durationS: song.durationS ?? song.duration_s }));
    result.inLibrary = Boolean(match);
    // Guarda la canción de la biblioteca que coincide (id + carpeta actual) para poder recolocarla en su álbum al transferir.
    result.libraryMatch = match ? { id: match.id, folderId: match.folder_id ?? match.folderId ?? null } : null;
  }
  return results;
}

/**
 * Recuento por colección y global para el panel (ADR-0046): por cada álbum/lista, el TOTAL de canciones, cuántas ya TIENES
 * en la biblioteca (`inLibrary`, marcado por markDuplicates con la regla tolerante) y cuántas te FALTAN. El total global de
 * «faltan» NO cuenta dos veces una misma canción que aparezca en varias listas (dedup por título+artista, como el plan de
 * transferencia). Puro y sin DOM, para poder probarlo.
 */
export function transferStats(collections) {
  const missingSeen = new Set();
  const haveSeen = new Set();
  let uniqueMissing = 0;
  let totalHave = 0;
  const perAlbum = [];
  for (const collection of collections) {
    const total = collection.results.length;
    const have = collection.results.filter((r) => r.inLibrary).length;
    // El recuento por álbum es el suyo (sin deduplicar); los totales globales SÍ se deduplican, para que «faltan» y «ya
    // tienes» usen el mismo criterio y una canción que esté en dos listas no se cuente dos veces.
    perAlbum.push({ name: collection.name ?? collection.album?.name ?? '', total, have, missing: total - have });
    for (const result of collection.results) {
      const key = transferKey(result.track.title, trackArtist(result.track));
      if (result.inLibrary) {
        if (!haveSeen.has(key)) { haveSeen.add(key); totalHave += 1; }
      } else if (!missingSeen.has(key)) { missingSeen.add(key); uniqueMissing += 1; }
    }
  }
  return { perAlbum, uniqueMissing, totalHave };
}

/**
 * Comparación LIGERA de una colección contra la biblioteca (ADR-0046): lista las pistas de Spotify (compareOnly, sin
 * resolver YouTube) y cuenta total/tengo/faltan, para enseñarlo al abrir un álbum/lista SIN iniciar una transferencia. El
 * conjunto `owned` (opcional) son claves título|artista de canciones que ya tienes aunque no estén aún en el catálogo
 * publicado (recién transferidas), para la actualización en vivo.
 */
export async function compareCollection({ api, url, source, ref, songs = [], storage = globalThis.localStorage, owned = null }) {
  const { results } = await resolveCollection({ api, url, source, ref, storage, compareOnly: true });
  markDuplicates(results, songs);
  if (owned && owned.size > 0) {
    for (const r of results) {
      if (!r.inLibrary && owned.has(transferKey(r.track.title, trackArtist(r.track)))) r.inLibrary = true;
    }
  }
  const total = results.length;
  const have = results.filter((r) => r.inLibrary).length;
  return { total, have, missing: total - have, results };
}

/** Clave título|artista de una pista de Spotify, para el conjunto «ya la tienes» de la actualización en vivo. */
export const transferTrackKey = (track) => transferKey(track.title, trackArtist(track));

/**
 * Plan de transferencia: por cada colección, las pistas elegidas (selectedTracks), SIN repetir una misma canción que ya
 * aparezca en otra colección o antes en la tanda (dedup por título+artista). Devuelve [{ album, tracks }].
 */
export function buildTransferPlan(collections) {
  const seen = new Set();
  const plan = [];
  for (const collection of collections) {
    const tracks = [];
    for (const pick of selectedTracks(collection.results, { excluded: collection.excluded, overrides: collection.overrides })) {
      const key = transferKey(pick.title, pick.artist);
      if (seen.has(key)) continue;
      seen.add(key);
      tracks.push(pick);
    }
    if (tracks.length > 0) plan.push({ album: collection.album, tracks });
  }
  return plan;
}

/**
 * Pistas que se van a transferir, como [{ index, url, title, artist }] para importYoutubeTracks:
 * - se saltan las excluidas (el usuario las quitó) y las que ya están en la biblioteca;
 * - se incluye la MEJOR coincidencia siempre que la haya (alta Y media), ya pre-elegida, para no tener que ir canción
 *   por canción; solo las de confianza BAJA (sin mejor candidato) quedan sin elegir hasta que el usuario pique una;
 * - un override (alternativa elegida o búsqueda manual) manda sobre todo.
 */
export function selectedTracks(results, { excluded = new Set(), overrides = new Map() } = {}) {
  const chosen = [];
  for (const result of results) {
    if (excluded.has(result.index) || result.inLibrary) continue;
    const pick = overrides.get(result.index) ?? result.best;
    const url = pick?.candidate?.url;
    if (!url) continue;
    chosen.push({ index: result.index, url, title: result.track.title, artist: trackArtist(result.track) });
  }
  return chosen;
}
