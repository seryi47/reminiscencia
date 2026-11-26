// Cache de YouTube→Opus en R2 (ADR-0052 ampliación). Evita reconvertir el mismo vídeo repetidas veces en yttowav.
//
// Claves R2 (en PUBLIC_BUCKET):
//   youtube-cache/opus/<video_id>.opus      — Opus convertido (audio/ogg)
//   youtube-cache/meta/<video_id>.json      — { videoId, title, duration_s, size_bytes, sha256, convertedAt, source }
//   youtube-cache/playlist/<playlist_id>.json — { playlistId, items, fetchedAt, ttl }
//
// Usos:
//   - /api/youtube/convert: si hay hit para videoId, responde {jobId:"cached:<id>", cached:true} sin llamar a yttowav.
//   - /api/youtube/status?jobId=cached:X: estado "completed" al momento.
//   - /api/youtube/download?jobId=cached:X: stream del Opus desde R2.
//   - /api/youtube/cache/check (POST {urls:[]}): HEAD por lote para que el cliente sepa qué ya está.
//   - /api/youtube/playlist: lookup en R2 (TTL 24 h); tras scraping real, se guarda.
//
// Diseño: fire-and-forget con ctx.waitUntil en los put, para no bloquear la respuesta al cliente.

/** Extensiones máximas aceptadas de vídeo cacheable; vídeos muy largos no se cachean (no justifica el espacio). */
export const CACHE_MAX_DURATION_S = 15 * 60;

/** Prefijo de los jobId sintéticos de la cache (para distinguirlos de los de yttowav en status/download). */
export const CACHE_JOB_PREFIX = 'cached:';

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
const PLAYLIST_ID_RE = /^[A-Za-z0-9_-]{1,200}$/;

const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
]);

/** Extrae el videoId de una URL de YouTube (acepta /watch?v=, youtu.be/, /shorts/, /embed/). Devuelve null si no vale. */
export function extractVideoId(url) {
  if (typeof url !== 'string' || url.length > 2048) return null;
  let parsed;
  try { parsed = new URL(url); } catch { return null; }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  if (!YOUTUBE_HOSTS.has(parsed.hostname.toLowerCase())) return null;
  if (parsed.hostname === 'youtu.be') {
    const candidate = parsed.pathname.slice(1).split('/')[0] ?? '';
    return VIDEO_ID_RE.test(candidate) ? candidate : null;
  }
  if (parsed.pathname === '/watch') {
    const candidate = parsed.searchParams.get('v') ?? '';
    return VIDEO_ID_RE.test(candidate) ? candidate : null;
  }
  const match = parsed.pathname.match(/^\/(?:shorts|embed)\/([A-Za-z0-9_-]{11})/);
  return match ? match[1] : null;
}

/** Extrae el playlistId de una URL de YouTube (parámetro ?list=). Devuelve null si no es playlist. */
export function extractPlaylistId(url) {
  if (typeof url !== 'string' || url.length > 2048) return null;
  let parsed;
  try { parsed = new URL(url); } catch { return null; }
  if (parsed.hostname === 'youtu.be') return null;
  if (!YOUTUBE_HOSTS.has(parsed.hostname.toLowerCase())) return null;
  const list = parsed.searchParams.get('list') ?? '';
  return PLAYLIST_ID_RE.test(list) ? list : null;
}

/** Decodifica el videoId de un jobId "cached:<id>" (devuelve null si no es sintético o es inválido). */
export function cachedVideoId(jobId) {
  if (typeof jobId !== 'string' || !jobId.startsWith(CACHE_JOB_PREFIX)) return null;
  const id = jobId.slice(CACHE_JOB_PREFIX.length);
  return VIDEO_ID_RE.test(id) ? id : null;
}

/** Comprueba si existe el Opus del videoId en R2. Devuelve el meta parseado o null. */
export async function cacheGet(bucket, videoId) {
  if (!bucket || !VIDEO_ID_RE.test(videoId || '')) return null;
  try {
    const metaObj = await bucket.get(metaKey(videoId));
    if (!metaObj) return null;
    const metaText = await metaObj.text();
    const meta = JSON.parse(metaText);
    if (!meta || typeof meta !== 'object') return null;
    return meta;
  } catch {
    return null;
  }
}

/** HEAD rápido para preflight: devuelve true si el Opus del videoId existe en R2 (sin bajar bytes). */
export async function cacheHas(bucket, videoId) {
  if (!bucket || !VIDEO_ID_RE.test(videoId || '')) return false;
  try {
    const opus = await bucket.head(opusKey(videoId));
    return !!opus;
  } catch {
    return false;
  }
}

/** Guarda un Opus + meta en R2. No throw: si algo falla, lo registra y sigue. */
export async function cachePut(bucket, videoId, { opusBytes, title = '', duration_s = 0, sha256 = '' }) {
  if (!bucket || !VIDEO_ID_RE.test(videoId || '') || !opusBytes) return false;
  if (duration_s && duration_s > CACHE_MAX_DURATION_S) return false;
  try {
    const size_bytes = opusBytes.byteLength ?? opusBytes.length ?? 0;
    const meta = {
      videoId,
      title: String(title || '').slice(0, 200),
      duration_s: Number.isFinite(duration_s) ? Math.max(0, Math.floor(duration_s)) : 0,
      size_bytes,
      sha256: String(sha256 || '').slice(0, 64),
      convertedAt: new Date().toISOString(),
      source: 'yttowav',
    };
    await Promise.all([
      bucket.put(opusKey(videoId), opusBytes, {
        httpMetadata: { contentType: 'audio/ogg', cacheControl: 'public, max-age=31536000, immutable' },
      }),
      bucket.put(metaKey(videoId), JSON.stringify(meta), {
        httpMetadata: { contentType: 'application/json; charset=utf-8' },
      }),
    ]);
    return true;
  } catch (error) {
    console.warn('youtube-cache: no se pudo guardar Opus en R2', videoId, error?.name ?? error);
    return false;
  }
}

/** Devuelve el objeto Opus de R2 para servirlo como stream. */
export async function cacheGetOpus(bucket, videoId) {
  if (!bucket || !VIDEO_ID_RE.test(videoId || '')) return null;
  try { return await bucket.get(opusKey(videoId)); }
  catch { return null; }
}

/** HEAD por lote: devuelve { hits:[{url,videoId}], misses:[{url,videoId}] } para una lista de URLs de YouTube. */
export async function cacheCheck(bucket, urls) {
  const hits = [];
  const misses = [];
  const invalid = [];
  if (!Array.isArray(urls)) return { hits, misses, invalid };
  const seen = new Set();
  for (const raw of urls) {
    if (typeof raw !== 'string') continue;
    const videoId = extractVideoId(raw);
    if (!videoId) { invalid.push({ url: raw }); continue; }
    if (seen.has(videoId)) continue;
    seen.add(videoId);
    const metaObj = bucket ? await bucket.get(metaKey(videoId)).catch(() => null) : null;
    if (metaObj) {
      let meta = null;
      try { meta = JSON.parse(await metaObj.text()); } catch { meta = null; }
      hits.push({
        url: raw,
        videoId,
        cached: true,
        size_bytes: meta?.size_bytes ?? null,
        duration_s: meta?.duration_s ?? null,
        title: meta?.title ?? null,
      });
    } else {
      misses.push({ url: raw, videoId });
    }
  }
  return { hits, misses, invalid };
}

/** Lee la cache de playlist; devuelve null si no hay o ha caducado (TTL en milisegundos). */
export async function playlistCacheGet(bucket, playlistId, now = Date.now()) {
  if (!bucket || !PLAYLIST_ID_RE.test(playlistId || '')) return null;
  try {
    const obj = await bucket.get(playlistKey(playlistId));
    if (!obj) return null;
    const data = JSON.parse(await obj.text());
    const fetched = Number(data?.fetchedAt);
    const ttl = Number(data?.ttl) || 86400 * 1000;
    if (!Number.isFinite(fetched) || now - fetched > ttl) return null;
    if (!Array.isArray(data.items)) return null;
    return data;
  } catch {
    return null;
  }
}

/** Guarda la cache de playlist con TTL por defecto de 24 h. */
export async function playlistCachePut(bucket, playlistId, items, { ttlMs = 86400 * 1000, now = Date.now() } = {}) {
  if (!bucket || !PLAYLIST_ID_RE.test(playlistId || '') || !Array.isArray(items)) return false;
  try {
    await bucket.put(playlistKey(playlistId), JSON.stringify({
      playlistId,
      items,
      fetchedAt: now,
      ttl: ttlMs,
    }), {
      httpMetadata: { contentType: 'application/json; charset=utf-8' },
    });
    return true;
  } catch (error) {
    console.warn('youtube-cache: no se pudo guardar playlist en R2', playlistId, error?.name ?? error);
    return false;
  }
}

export function opusKey(videoId) { return `youtube-cache/opus/${videoId}.opus`; }
export function metaKey(videoId) { return `youtube-cache/meta/${videoId}.json`; }
export function playlistKey(playlistId) { return `youtube-cache/playlist/${playlistId}.json`; }
