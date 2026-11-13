// Endpoints HTTP de «Transferir música» (ADR-0044), compartidos por el Worker y las funciones de Vercel (como
// upload-core.js). Devuelven una `Response` web. La búsqueda de YouTube (`search`) y el `fetch` se inyectan: así el mismo
// código corre donde hay yt-dlp (Vercel/Netlify) o donde no (el Worker, que la toma de su upstream; ADR-0038).
//
// Rutas: POST /api/spotify/login (arranca OAuth PKCE), POST /api/spotify/token (cambia el código), POST
// /api/spotify/refresh (refresca), POST /api/spotify/resolve (Spotify → YouTube con confianza) y GET
// /api/spotify/callback (la página que cierra el login). El token del usuario NO se guarda en el servidor (sin estado):
// el cliente lo manda en cada /resolve.

import { startLogin, exchangeCode, refreshAccess } from './spotify-auth.js';
import { parseSpotifyRef } from './spotify-core.js';
import { fetchCollection, listMine, SpotifyApiError } from './spotify-fetch.js';
import { resolveCollection, albumOf } from './spotify-resolve.js';
import { spotifyClientId, SPOTIFY_REDIRECT_URI } from './spotify-config.js';

export const RESOLVE_DEFAULT_LIMIT = 25;
export const RESOLVE_MAX_LIMIT = 50;
export const CALLBACK_SCHEME = 'reminiscencia://spotify-callback'; // vuelta a la APK (ADR-0044)

const json = (status, body, headers = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
});

async function readJson(request) {
  try { return await request.json(); } catch { return {}; }
}

const isText = (value) => typeof value === 'string' && value.length > 0 && value.length < 4096;

/** POST /api/spotify/login → { url, verifier, state }. El cliente guarda verifier+state y abre `url`. */
export async function handleSpotifyLogin(request, { env = {} } = {}) {
  if (request.method !== 'POST' && request.method !== 'GET') return json(405, { error: 'método no permitido' });
  const login = await startLogin({ clientId: spotifyClientId(env), redirectUri: SPOTIFY_REDIRECT_URI });
  return json(200, login);
}

/** POST /api/spotify/token { code, verifier } → sesión { accessToken, refreshToken, scope, expiresAt }. */
export async function handleSpotifyToken(request, { env = {}, fetchImpl = fetch } = {}) {
  if (request.method !== 'POST') return json(405, { error: 'método no permitido' });
  const { code, verifier } = await readJson(request);
  if (!isText(code) || !isText(verifier)) return json(400, { error: 'faltan code o verifier' });
  try {
    const session = await exchangeCode(
      { clientId: spotifyClientId(env), redirectUri: SPOTIFY_REDIRECT_URI, code, verifier }, fetchImpl,
    );
    return json(200, session);
  } catch (error) {
    return json(400, { error: String(error?.message ?? 'no se pudo iniciar sesión en Spotify') });
  }
}

/** POST /api/spotify/refresh { refreshToken } → sesión nueva. */
export async function handleSpotifyRefresh(request, { env = {}, fetchImpl = fetch } = {}) {
  if (request.method !== 'POST') return json(405, { error: 'método no permitido' });
  const { refreshToken } = await readJson(request);
  if (!isText(refreshToken)) return json(400, { error: 'falta refreshToken' });
  try {
    return json(200, await refreshAccess({ clientId: spotifyClientId(env), refreshToken }, fetchImpl));
  } catch (error) {
    return json(400, { error: String(error?.message ?? 'no se pudo refrescar la sesión de Spotify') });
  }
}

/** POST /api/spotify/mine { accessToken } → { playlists:[{id,name,total,image,ownerId,ownerName}], liked }. */
export async function handleSpotifyMine(request, { fetchImpl = fetch } = {}) {
  if (request.method !== 'POST') return json(405, { error: 'método no permitido' });
  const { accessToken } = await readJson(request);
  if (!isText(accessToken)) return json(401, { error: 'falta el token de Spotify', needsAuth: true });
  try {
    return json(200, await listMine({ accessToken }, fetchImpl));
  } catch (error) {
    if (error instanceof SpotifyApiError && error.status === 401) {
      return json(401, { error: 'token de Spotify caducado', needsAuth: true });
    }
    if (error instanceof SpotifyApiError && error.status === 429) return json(429, { error: 'Spotify pide esperar un momento' });
    return json(502, { error: String(error?.message ?? 'no se pudo leer tu biblioteca de Spotify') });
  }
}

/**
 * POST /api/spotify/resolve { url|ref|source, accessToken, offset?, limit?, concurrency? }
 * → { type, id, name, album, results, summary, offset, limit, total, hasMore }.
 * `search` (inyectada) recibe una consulta y devuelve candidatos de YouTube. Resuelve solo la página [offset, limit)
 * para no agotar el tiempo de la función; el cliente pide las siguientes.
 */
export async function handleSpotifyResolve(request, { search, fetchImpl = fetch } = {}) {
  if (request.method !== 'POST') return json(405, { error: 'método no permitido' });
  const body = await readJson(request);
  // compareOnly (ADR-0046): solo listar las pistas y dejar que el cliente compare con la biblioteca (total/tengo/faltan),
  // SIN resolver YouTube. Es rápido (una lectura de Spotify) y permite enseñar el recuento al abrir un álbum sin transferir.
  const compareOnly = body.compareOnly === true;
  if (!compareOnly && typeof search !== 'function') return json(500, { error: 'búsqueda de YouTube no disponible' });
  const ref = body.ref ?? (body.source === 'liked' ? { type: 'liked' } : parseSpotifyRef(body.url));
  if (!ref) return json(400, { error: 'enlace de Spotify no válido' });
  if (!isText(body.accessToken)) return json(401, { error: 'falta el token de Spotify', needsAuth: true });

  const offset = Number.isInteger(body.offset) && body.offset >= 0 ? body.offset : 0;
  const limit = Math.min(RESOLVE_MAX_LIMIT, Number.isInteger(body.limit) && body.limit > 0 ? body.limit : RESOLVE_DEFAULT_LIMIT);

  let collection;
  try {
    collection = await fetchCollection({ ref, accessToken: body.accessToken }, fetchImpl);
  } catch (error) {
    if (error instanceof SpotifyApiError && error.status === 401) {
      return json(401, { error: 'token de Spotify caducado', needsAuth: true });
    }
    if (error instanceof SpotifyApiError && error.status === 429) {
      return json(429, { error: 'Spotify pide esperar un momento' });
    }
    return json(502, { error: String(error?.message ?? 'no se pudo leer de Spotify') });
  }

  const total = collection.tracks.length;
  const pageTracks = collection.tracks.slice(offset, offset + limit);

  if (compareOnly) {
    // Solo pistas, sin candidatos de YouTube: el cliente marca `inLibrary` y cuenta total/tengo/faltan.
    const results = pageTracks.map((track, i) => ({ index: offset + i, track, tier: 'baja', best: null, alternatives: [] }));
    const summary = { total: results.length, alta: 0, media: 0, baja: results.length, error: 0 };
    return json(200, {
      type: collection.type, id: collection.id, name: collection.name, album: albumOf(collection),
      results, summary, offset, limit, total, hasMore: offset + limit < total,
    });
  }

  const pageCollection = { ...collection, tracks: pageTracks };
  const resolved = await resolveCollection(pageCollection, { searchYoutube: search }, { concurrency: 4 });
  for (const result of resolved.results) result.index += offset; // índices globales

  return json(200, { ...resolved, offset, limit, total, hasMore: offset + limit < total });
}

/** GET /api/spotify/callback → la página que cierra el login (web: cambia el código; APK: lo devuelve por el esquema). */
export function handleSpotifyCallback() {
  return new Response(CALLBACK_HTML, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

// Página de retorno de OAuth. Para la web, lee el `verifier` de sessionStorage (mismo origen que la app en cometia),
// cambia el código por el token y vuelve a la app. Para la APK, si el `state` acaba en «.apk», devuelve el código a la
// app por el esquema reminiscencia:// (la APK tiene el verifier y hace el intercambio). Sin datos sensibles en la URL.
const CALLBACK_HTML = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Conectando con Spotify…</title>
<style>body{font-family:system-ui,sans-serif;background:#121212;color:#eee;display:grid;place-items:center;height:100vh;margin:0}
.box{max-width:28rem;padding:1.5rem;text-align:center}a{color:#1db954}</style></head>
<body><div class="box"><p id="msg">Conectando con Spotify…</p></div>
<script>
(async () => {
  const p = new URLSearchParams(location.search);
  const code = p.get('code'); const state = p.get('state') || ''; const err = p.get('error');
  const msg = document.getElementById('msg');
  const fail = (text) => { msg.innerHTML = text + '<br><a href="/#transferir">Volver</a>'; };
  // APK: devuelve el código a la app por el esquema; la app valida el state y cambia el código.
  if (state.endsWith('.apk')) {
    location.replace(${JSON.stringify(CALLBACK_SCHEME)} + '?' + new URLSearchParams({ code: code || '', state, error: err || '' }));
    return;
  }
  if (err) { fail('Spotify no autorizó la conexión.'); return; }
  let saved;
  try { saved = JSON.parse(sessionStorage.getItem('reminiscencia.spotify.pkce') || 'null'); } catch { saved = null; }
  if (!code || !saved || !saved.verifier) { fail('Falta información del inicio de sesión. Inténtalo otra vez.'); return; }
  if (state !== saved.state) { fail('La respuesta de Spotify no coincide (seguridad). Inténtalo otra vez.'); return; }
  msg.textContent = 'Casi listo…';
  try {
    const controller = new AbortController();
    const timer = setTimeout(function () { controller.abort(); }, 20000);
    var res;
    try {
      res = await fetch('/api/spotify/token', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store', signal: controller.signal,
        body: JSON.stringify({ code: code, verifier: saved.verifier }),
      });
    } finally { clearTimeout(timer); }
    const session = await res.json().catch(function () { return {}; });
    if (!res.ok) { fail('No se pudo iniciar sesión: ' + (session.error || ('error ' + res.status)) + '.'); return; }
    try { localStorage.setItem('reminiscencia.spotify', JSON.stringify(session)); } catch (e) {}
    try { sessionStorage.removeItem('reminiscencia.spotify.pkce'); } catch (e) {}
    // La vuelta debe ser una ruta absoluta (empezar por «/»); si no, redirigiría dentro del propio callback (bug que vimos
    // con «#transferir» sin barra). Tolera una app en caché que aún guarde el valor antiguo.
    var back = (saved.returnTo && saved.returnTo.charAt(0) === '/') ? saved.returnTo : '/#transferir';
    location.replace(back);
  } catch (e) {
    fail('No se pudo completar el inicio de sesión (' + (e && e.name === 'AbortError' ? 'tardó demasiado' : (e && e.message || e)) + ').');
  }
})();
</script></body></html>`;
