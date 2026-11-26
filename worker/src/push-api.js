// Endpoints auxiliares del canal push FCM (ADR-0052): health público para instalaciones y /test con X-Auth
// para disparar un push manual al topic catalog-changes.

import { isAuthorized } from './auth.js';
import { getFcmAccessToken, sendTestPush, _hasCachedToken } from './fcm.js';

function jsonResponse(status, body, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...extra,
    },
  });
}

/** GET /api/push/health — comprueba que el Worker puede obtener un access_token; no revela el token. */
export async function handlePushHealth(request, env) {
  if (request.method !== 'GET') return jsonResponse(405, { ok: false, error: 'Solo GET.' });
  if (!env?.FCM_SERVICE_ACCOUNT || !env?.FCM_PROJECT_ID) {
    return jsonResponse(503, { ok: false, error: 'FCM no configurado (faltan secretos FCM_SERVICE_ACCOUNT y/o FCM_PROJECT_ID).' });
  }
  const cachedBefore = _hasCachedToken();
  try {
    await getFcmAccessToken(env);
  } catch (err) {
    return jsonResponse(500, { ok: false, error: `No se pudo obtener access token: ${err?.message ?? 'desconocido'}` });
  }
  return jsonResponse(200, {
    ok: true,
    projectId: env.FCM_PROJECT_ID,
    tokenCached: cachedBefore, // si ya estaba en caché antes de esta llamada
  });
}

/** POST /api/push/test — con X-Auth. Dispara un push al topic. Útil para confirmar que la APK lo recibe. */
export async function handlePushTest(request, env) {
  if (request.method !== 'POST') return jsonResponse(405, { ok: false, error: 'Solo POST.' });
  if (!env?.FCM_SERVICE_ACCOUNT || !env?.FCM_PROJECT_ID) {
    return jsonResponse(503, { ok: false, error: 'FCM no configurado.' });
  }
  if (!isAuthorized(request, env)) {
    return jsonResponse(401, { ok: false, error: 'Falta o no coincide X-Auth.' });
  }
  const result = await sendTestPush(env);
  if (!result.ok) {
    return jsonResponse(result.status || 500, { ok: false, error: result.detail || 'FCM rechazó el push.' });
  }
  return jsonResponse(200, { ok: true, projectId: env.FCM_PROJECT_ID, topic: 'catalog-changes' });
}

export function isPushRoute(path) {
  return path === '/api/push/health' || path === '/api/push/test';
}

export async function handlePushRoute(path, request, env) {
  switch (path) {
    case '/api/push/health': return handlePushHealth(request, env);
    case '/api/push/test':   return handlePushTest(request, env);
    default: return jsonResponse(404, { ok: false, error: 'Ruta push desconocida.' });
  }
}
