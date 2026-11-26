// FCM HTTP v1 sin librerías — firma JWT RS256 con Web Crypto y manda push al topic (ADR-0052).
//
// La web/APK se suscribe al topic `catalog-changes`. Tras cada escritura al catálogo, el Worker
// llama fire-and-forget a notifyCatalogChange() y FCM entrega el push a todos los suscriptores.
// Coste: 0 (FCM es gratis; Firebase Spark plan). No requiere Cloudflare Queues ni R2 Event Notifications.

const CATALOG_TOPIC = 'catalog-changes';
const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';

// Cache en memoria del isolate del access_token (renovamos a los 55 min aunque Google diga 60).
let cachedToken = null;
let cachedUntil = 0;

export function _resetCache() { cachedToken = null; cachedUntil = 0; }
export function _hasCachedToken() { return cachedToken !== null && cachedUntil > Date.now(); }

function base64UrlEncode(bytes) {
  let s = typeof bytes === 'string' ? bytes : String.fromCharCode(...new Uint8Array(bytes));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlEncodeJson(obj) {
  return base64UrlEncode(JSON.stringify(obj));
}

function pemToArrayBuffer(pem) {
  const stripped = pem
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/\s+/g, '');
  const bin = atob(stripped);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

async function signJwtRs256(payload, pemKey) {
  const header = { alg: 'RS256', typ: 'JWT' };
  const signingInput = `${base64UrlEncodeJson(header)}.${base64UrlEncodeJson(payload)}`;
  const keyBuf = pemToArrayBuffer(pemKey);
  const key = await crypto.subtle.importKey(
    'pkcs8',
    keyBuf,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const encoder = new TextEncoder();
  const sigBuf = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, encoder.encode(signingInput));
  const sig = base64UrlEncode(sigBuf);
  return `${signingInput}.${sig}`;
}

function parseServiceAccount(env) {
  if (!env?.FCM_SERVICE_ACCOUNT) return null;
  try {
    return typeof env.FCM_SERVICE_ACCOUNT === 'string'
      ? JSON.parse(env.FCM_SERVICE_ACCOUNT)
      : env.FCM_SERVICE_ACCOUNT;
  } catch (err) {
    console.error('fcm: FCM_SERVICE_ACCOUNT no es JSON válido', err?.name ?? 'Error');
    return null;
  }
}

/** Obtiene un access_token OAuth2 para FCM HTTP v1. Cachea en memoria del isolate (~55 min). */
export async function getFcmAccessToken(env, { fetchImpl = fetch, now = Date.now } = {}) {
  if (cachedToken && cachedUntil > now()) return cachedToken;
  const sa = parseServiceAccount(env);
  if (!sa?.client_email || !sa?.private_key) {
    throw new Error('FCM_SERVICE_ACCOUNT inválido: faltan client_email o private_key.');
  }
  const tokenUri = sa.token_uri || 'https://oauth2.googleapis.com/token';
  const iat = Math.floor(now() / 1000);
  const jwt = await signJwtRs256(
    {
      iss: sa.client_email,
      scope: FCM_SCOPE,
      aud: tokenUri,
      iat,
      exp: iat + 3600,
    },
    sa.private_key,
  );
  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion: jwt,
  });
  const response = await fetchImpl(tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`fcm oauth error ${response.status}: ${detail.slice(0, 160)}`);
  }
  const data = await response.json();
  if (!data?.access_token) throw new Error('fcm oauth sin access_token');
  cachedToken = data.access_token;
  cachedUntil = now() + 55 * 60 * 1000;
  return cachedToken;
}

/** Envía un push al topic `catalog-changes`. Fire-and-forget: devuelve el detalle pero el caller debería
 *  ignorar los errores y seguir — la UX es un push "best-effort", nunca bloquea una escritura. */
export async function notifyCatalogChange(env, version, event, { fetchImpl = fetch, now = Date.now } = {}) {
  if (!env?.FCM_SERVICE_ACCOUNT || !env?.FCM_PROJECT_ID) {
    return { ok: false, status: 503, detail: 'FCM no configurado (faltan secretos).' };
  }
  let token;
  try {
    token = await getFcmAccessToken(env, { fetchImpl, now });
  } catch (err) {
    console.error('fcm: no se pudo obtener access token', err?.message ?? err);
    return { ok: false, status: 500, detail: `access token: ${err?.message ?? 'desconocido'}` };
  }
  const url = `https://fcm.googleapis.com/v1/projects/${env.FCM_PROJECT_ID}/messages:send`;
  const payload = {
    message: {
      topic: CATALOG_TOPIC,
      data: {
        type: 'catalog-updated',
        version: String(version),
        kind: event?.kind || 'edit',
        ts: new Date(now()).toISOString(),
      },
      android: { priority: 'high' },
    },
  };
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(payload),
  });
  const body = await response.text().catch(() => '');
  if (!response.ok) {
    console.error('fcm send falló', response.status, body.slice(0, 160));
    return { ok: false, status: response.status, detail: body.slice(0, 160) };
  }
  return { ok: true, status: 200, detail: body.slice(0, 80) };
}

/** Envía un push de prueba con type='test'. Útil para `/api/push/test`. */
export async function sendTestPush(env, { fetchImpl = fetch, now = Date.now } = {}) {
  return notifyCatalogChange(env, 0, { kind: 'test' }, { fetchImpl, now });
}

export { CATALOG_TOPIC };
