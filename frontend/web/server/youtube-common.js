// Utilidades compartidas por las funciones de Vercel del importador de YouTube.
// El navegador solo habla con el mismo origen; las credenciales y la URL del conversor
// permanecen en el servidor.

export const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
]);

export const CONVERTER_API = 'https://api.yttowav.org';
export const CONVERTER_ORIGIN = new URL(CONVERTER_API).origin;
export const MAX_PLAYLIST_ITEMS = 200;
export const MAX_JOB_ID_LENGTH = 200;

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const PLAYLIST_ID = /^[A-Za-z0-9_-]{1,200}$/;
const JOB_ID = /^[A-Za-z0-9_-]{1,200}$/;

export class YoutubeApiError extends Error {
  constructor(status, message, headers = {}) {
    super(message);
    this.name = 'YoutubeApiError';
    this.status = status;
    this.headers = headers;
  }
}

export function json(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...headers,
    },
  });
}

export function youtubeUrl(value, { playlist = false } = {}) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' || !YOUTUBE_HOSTS.has(parsed.hostname.toLowerCase()) || parsed.username || parsed.password) {
    return null;
  }
  if (playlist) {
    if (parsed.hostname === 'youtu.be') return null;
    if (!parsed.searchParams.has('list') || !PLAYLIST_ID.test(parsed.searchParams.get('list') ?? '')) return null;
    return parsed;
  }
  if (parsed.hostname === 'youtu.be') {
    return VIDEO_ID.test(parsed.pathname.slice(1).split('/')[0] ?? '') ? parsed : null;
  }
  if (parsed.pathname === '/watch') {
    return VIDEO_ID.test(parsed.searchParams.get('v') ?? '') ? parsed : null;
  }
  const match = parsed.pathname.match(/^\/(?:shorts|embed)\/([A-Za-z0-9_-]{11})$/);
  return match ? parsed : null;
}

export function videoId(value) {
  const parsed = youtubeUrl(value);
  if (!parsed) return null;
  if (parsed.hostname === 'youtu.be') return parsed.pathname.slice(1).split('/')[0];
  if (parsed.pathname === '/watch') return parsed.searchParams.get('v');
  return parsed.pathname.split('/').pop();
}

export function canonicalVideoUrl(id) {
  return `https://www.youtube.com/watch?v=${id}`;
}

export function validJobId(value) {
  const id = typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  return id.length > 0 && id.length <= MAX_JOB_ID_LENGTH && JOB_ID.test(id) ? id : null;
}

export function jobIdFrom(data) {
  return validJobId(data?.jobId) || validJobId(data?.id) || validJobId(data?.job?.id);
}

export async function readJson(request, maxBytes = 32 * 1024) {
  const length = Number(request.headers.get('content-length'));
  if (Number.isFinite(length) && length > maxBytes) throw new YoutubeApiError(413, 'La petición es demasiado grande.');
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.length > maxBytes) throw new YoutubeApiError(413, 'La petición es demasiado grande.');
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new YoutubeApiError(400, 'El cuerpo JSON no es válido.');
  }
}

export async function fetchWithTimeout(fetchImpl, url, init = {}, timeoutMs = 30_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error?.name === 'AbortError') throw new YoutubeApiError(504, 'El servicio externo tardó demasiado en responder.');
    throw new YoutubeApiError(503, 'No se ha podido conectar con el servicio externo.');
  } finally {
    clearTimeout(timer);
  }
}

export function upstreamHeaders() {
  return {
    Accept: '*/*',
    'Accept-Encoding': 'gzip, deflate',
    Origin: 'https://www.yttowav.org',
    Referer: 'https://www.yttowav.org/',
    'User-Agent': 'reminiscencia-youtube-importer',
  };
}

export function publicError(error) {
  if (error instanceof YoutubeApiError) return json(error.status, { ok: false, error: error.message }, error.headers);
  console.error('youtube: fallo inesperado', error?.name ?? 'Error');
  return json(500, { ok: false, error: 'No se pudo completar la operación de YouTube.' });
}

export function safeUpstreamMessage(data) {
  const message = data?.errorText || data?.error || data?.message;
  return typeof message === 'string' && message.trim() ? message.trim().slice(0, 300) : 'El conversor no pudo completar el trabajo.';
}
