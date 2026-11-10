// OAuth de Spotify con PKCE para «Transferir música» (ADR-0044). PKCE no usa secreto de cliente: solo el Client ID
// (público). El usuario inicia sesión en Spotify (con Google si quiere), autoriza, y el servidor cambia el código por un
// token y lo refresca. Cross-env: usa Web Crypto y btoa, disponibles en el Worker de Cloudflare, en Node 18+ y en el
// navegador. La capa HTTP (funciones de Vercel / Worker) inyecta `fetch`; aquí la lógica es probable contra simulado.

const AUTH_URL = 'https://accounts.spotify.com/authorize';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';

// Permisos mínimos: leer las listas privadas y colaborativas del usuario y su biblioteca («Tus me gusta»).
export const SPOTIFY_SCOPES = 'playlist-read-private playlist-read-collaborative user-library-read';

const bytesToBase64Url = (bytes) => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

/** Verificador PKCE aleatorio (texto base64url de 43 caracteres a partir de 32 bytes). */
export function createVerifier() {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

/** Reto PKCE S256: base64url(SHA-256(verifier)). */
export async function challengeFor(verifier) {
  const data = new TextEncoder().encode(verifier);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', data);
  return bytesToBase64Url(new Uint8Array(digest));
}

/** Un `state` opaco anti-CSRF para el ida y vuelta de OAuth. */
export function createState() {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

/**
 * Arranca el login: devuelve { url, verifier, state }. El cliente guarda `verifier` y `state` (p. ej. en sessionStorage),
 * abre `url`, y en el callback valida `state` y usa `verifier` para cambiar el código por el token.
 */
export async function startLogin({ clientId, redirectUri, scopes = SPOTIFY_SCOPES } = {}) {
  if (!clientId || !redirectUri) throw new Error('faltan clientId o redirectUri');
  const verifier = createVerifier();
  const state = createState();
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: scopes,
    state,
    code_challenge_method: 'S256',
    code_challenge: await challengeFor(verifier),
  });
  return { url: `${AUTH_URL}?${params.toString()}`, verifier, state };
}

async function tokenRequest(body, fetchImpl) {
  const response = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = data.error_description || data.error || `HTTP ${response.status}`;
    throw new Error(`Spotify token: ${detail}`);
  }
  return data;
}

const withExpiry = (token, now) => ({
  accessToken: token.access_token,
  refreshToken: token.refresh_token ?? null,
  scope: token.scope ?? '',
  expiresAt: now + (Number(token.expires_in) || 3600) * 1000,
});

/** Cambia el `code` del callback por un token. Devuelve { accessToken, refreshToken, scope, expiresAt }. */
export async function exchangeCode({ clientId, redirectUri, code, verifier }, fetchImpl = fetch, now = Date.now()) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    code_verifier: verifier,
  });
  return withExpiry(await tokenRequest(body, fetchImpl), now);
}

/**
 * Refresca el token. Spotify con PKCE puede devolver un refresh_token nuevo; si no, se conserva el anterior. Devuelve
 * { accessToken, refreshToken, scope, expiresAt }.
 */
export async function refreshAccess({ clientId, refreshToken }, fetchImpl = fetch, now = Date.now()) {
  const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId });
  const token = await tokenRequest(body, fetchImpl);
  const normalized = withExpiry(token, now);
  if (!normalized.refreshToken) normalized.refreshToken = refreshToken;
  return normalized;
}

/** ¿Hace falta refrescar? Con un margen de 60 s para no usar un token a punto de caducar. */
export const needsRefresh = (session, now = Date.now()) => !session?.expiresAt || session.expiresAt - now <= 60000;
