// Handlers que envuelven convert/status/download del Worker con la cache R2 (ADR-0052 ampliación).
// Se sitúan ENTRE el router del Worker y los handlers nativos de `frontend/web/server/youtube-*.js`.

import {
  CACHE_JOB_PREFIX, cachedVideoId, extractVideoId,
  cacheGet, cacheGetOpus, cacheCheck, cachePut,
  CACHE_MAX_DURATION_S,
} from './youtube-cache.js';

// Request coalescing (ADR-0052): si 2+ clientes piden /convert del mismo videoId en paralelo, hacemos UNA sola llamada
// a yttowav y compartimos la respuesta. Scope = isolate; TTL corto (el fetch se completa en segundos y limpia solo).
const inFlightConvert = new Map();

/** Para tests: permite inspeccionar/limpiar el estado del coalescing sin exponer el Map. */
export function _coalesceStateForTests() {
  return { size: inFlightConvert.size };
}
export function _clearCoalesceStateForTests() {
  inFlightConvert.clear();
}

const YOUTUBE_MARK_HEADER = 'X-Reminiscencia-Youtube';

function markYoutubeResponse(response) {
  const headers = new Headers(response.headers);
  headers.set(YOUTUBE_MARK_HEADER, '1');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function jsonResponse(status, body, extraHeaders = {}) {
  return markYoutubeResponse(new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...extraHeaders,
    },
  }));
}

/**
 * /api/youtube/convert con hit de cache: si el videoId ya está en R2, devolvemos `cached:<id>`
 * inmediatamente sin tocar yttowav. Si no, delegamos al handler nativo del Worker.
 */
export async function handleCachedConvert(request, env, nativeHandler, { fetchImpl = globalThis.fetch } = {}) {
  if (request.method !== 'POST') {
    return markYoutubeResponse(await nativeHandler(request, { fetchImpl }));
  }
  // Clon para poder leer el cuerpo y luego pasárselo al handler nativo si hay miss.
  let body;
  try {
    body = await request.clone().json();
  } catch {
    return markYoutubeResponse(await nativeHandler(request, { fetchImpl }));
  }
  const videoId = extractVideoId(body?.url);
  if (!videoId) {
    return markYoutubeResponse(await nativeHandler(request, { fetchImpl }));
  }
  const meta = await cacheGet(env?.PUBLIC_BUCKET, videoId);
  if (meta) {
    return jsonResponse(200, {
      jobId: `${CACHE_JOB_PREFIX}${videoId}`,
      cached: true,
      source: 'cache',
      estimated_seconds: 0,
      size_bytes: meta.size_bytes ?? null,
      duration_s: meta.duration_s ?? null,
    });
  }
  // Request coalescing: si otro cliente ya está esperando la conversión de este videoId, nos colgamos de esa misma
  // promise en vez de disparar un segundo fetch a yttowav. El primer client-side flow abre el job; el resto comparte.
  const existing = inFlightConvert.get(videoId);
  if (existing) {
    try {
      const cloned = await existing;
      return markYoutubeResponse(cloned.clone());
    } catch {
      // si la promise raíz cascó, dejamos que el handler nativo se encargue abajo
    }
  }
  const pending = (async () => markYoutubeResponse(await nativeHandler(request, { fetchImpl })))();
  inFlightConvert.set(videoId, pending);
  try {
    const response = await pending;
    return response.clone();
  } finally {
    // Limpiamos pasado un tick: otros clientes que aún estén en espera comparten; después se vuelve a pedir fresh.
    setTimeout(() => {
      if (inFlightConvert.get(videoId) === pending) inFlightConvert.delete(videoId);
    }, 0);
  }
}

/**
 * /api/youtube/status?jobId=cached:<id> → "completed" al momento.
 * Si no es un jobId sintético, pasa al handler nativo.
 */
export async function handleCachedStatus(request, env, nativeHandler, { fetchImpl = globalThis.fetch } = {}) {
  if (request.method === 'GET') {
    const jobId = new URL(request.url).searchParams.get('jobId') ?? '';
    const videoId = cachedVideoId(jobId);
    if (videoId) {
      return jsonResponse(200, { status: 'completed', cached: true, source: 'cache', progress: 100 });
    }
  }
  return markYoutubeResponse(await nativeHandler(request, { fetchImpl }));
}

/**
 * /api/youtube/download?jobId=cached:<id> → stream del Opus desde R2.
 * Si no es jobId sintético, delega al nativo (que descarga el WAV de yttowav).
 */
export async function handleCachedDownload(request, env, nativeHandler, { fetchImpl = globalThis.fetch } = {}) {
  if (request.method === 'GET') {
    const jobId = new URL(request.url).searchParams.get('jobId') ?? '';
    const videoId = cachedVideoId(jobId);
    if (videoId) {
      const [opus, meta] = await Promise.all([
        cacheGetOpus(env?.PUBLIC_BUCKET, videoId),
        cacheGet(env?.PUBLIC_BUCKET, videoId),
      ]);
      if (!opus) {
        return jsonResponse(404, { error: 'La entrada en cache ya no existe.' });
      }
      const headers = new Headers();
      headers.set('Content-Type', 'audio/ogg');
      headers.set('Cache-Control', 'public, max-age=31536000, immutable');
      headers.set('X-Cache', 'HIT');
      headers.set('Content-Disposition', `attachment; filename="${videoId}.opus"`);
      headers.set(YOUTUBE_MARK_HEADER, '1');
      if (meta?.size_bytes) headers.set('X-Cache-Size-Bytes', String(meta.size_bytes));
      if (meta?.duration_s) headers.set('X-Cache-Duration-S', String(meta.duration_s));
      if (meta?.sha256) headers.set('X-Cache-Sha256', String(meta.sha256));
      return new Response(opus.body, { status: 200, headers });
    }
  }
  return markYoutubeResponse(await nativeHandler(request, { fetchImpl }));
}

/**
 * POST /api/youtube/cache/check {urls:[...]} → {hits:[], misses:[], invalid:[]}.
 * Público (sin auth): es solo lectura y la cache es en el bucket público.
 */
export async function handleCacheCheck(request, env) {
  if (request.method !== 'POST') return jsonResponse(405, { error: 'Solo se admite POST.' });
  let body;
  try { body = await request.json(); } catch { return jsonResponse(400, { error: 'JSON inválido.' }); }
  const urls = Array.isArray(body?.urls) ? body.urls.slice(0, 500) : null;
  if (!urls) return jsonResponse(400, { error: 'Falta la lista "urls".' });
  const result = await cacheCheck(env?.PUBLIC_BUCKET, urls);
  return jsonResponse(200, result);
}

/**
 * Ayudante llamable desde el router para saber si la ruta es la de cache-check.
 */
export function isCacheCheckRoute(path) {
  return path === '/api/youtube/cache/check';
}

/**
 * Tras una conversión exitosa en el flujo normal (miss), guarda el Opus en cache.
 * Se llama desde el cliente cuando ya tiene el Opus local, o internamente tras transcodificar el WAV.
 * Aquí la firma es puramente para fire-and-forget desde el Worker si tuviéramos acceso al Opus.
 */
export async function maybeCachePut(env, ctx, videoId, opusBytes, meta = {}) {
  if (!env?.PUBLIC_BUCKET || !videoId || !opusBytes) return;
  const put = cachePut(env.PUBLIC_BUCKET, videoId, { opusBytes, ...meta });
  if (ctx?.waitUntil) ctx.waitUntil(put); else await put;
}

export { CACHE_JOB_PREFIX, CACHE_MAX_DURATION_S };
