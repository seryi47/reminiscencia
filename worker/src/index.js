// Worker de Cloudflare «reminiscencia-api» (ADR-0029). Las mismas rutas y contratos que las funciones de Vercel, con la
// lógica compartida (frontend/web/server/upload-core.js y edit-core.js, que a su vez usa js/cuidador/incidencias.js) y
// los buckets de R2 por binding (sin SigV4 ni claves de R2):
//
//   GET  /api/salud                 { ok: true, servicio, trozoMaximo }: la web y la APK lo preguntan antes de subir.
//   POST /api/subir                 trozos al bucket privado (entrada/<UUID>/), hasta 32 MB por trozo; con el último,
//                                   manifiesto y repository_dispatch «subida-web» (como api/subir.js).
//   POST /api/editar                organizar (incidencia, como api/editar.js) o portada JPEG (al bucket público y al
//                                   índice de portadas, sin GitHub; respuesta con «portada» y «url»).
//   GET  /api/editar?incidencia=N   estado de una edición (como api/editar.js).
//   POST /api/portada               solo portadas (lo mismo que la portada de /api/editar).
//   GET  /api/portadas              el índice de portadas leído del bucket, sin caché.
//   GET  /audio/<id>.opus           audio público del bucket público, con rangos, ETag y caché de un año (también
//   HEAD                            HEAD); id S + 16 hex, nada fuera de audio/ (ADR-0031, worker/src/audio.js).
//   *    /api/youtube/*             se reenvía tal cual a las funciones de YouTube, que siguen en Vercel (ADR-0034):
//                                   mismo método, consulta, cuerpo y cabeceras útiles; la respuesta vuelve en flujo.
//   lo demás                        la web estática (binding ASSETS, frontend/web; ADR-0034). En producción solo
//                                   /api/* y /audio/* llegan al Worker (run_worker_first de wrangler.toml).
//
// CORS solo para los orígenes de la web (https://reminiscencia.cometia.es y https://reminiscencia.vercel.app; más los
// de ALLOWED_ORIGINS). localhost y 127.0.0.1 solo con ALLOW_LOCALHOST="1" (el Worker simulado de las pruebas o
// «wrangler dev»), NUNCA en producción: el
// 2026-11-06 el navegador de las pruebas habló con el Worker real por esa puerta y abrió incidencias y subidas reales.
// Una petición con otro Origin se rechaza con 403 sin hacer nada. Sin Origin (la APK, curl, el elemento <audio> tras
// la redirección de vercel.json) se atiende. Todas las respuestas llevan X-Reminiscencia-Api: así los clientes
// distinguen una respuesta del Worker de una página de error de Cloudflare y saben cuándo volver a Vercel.
//
// Bindings y secretos (worker/wrangler.toml): PRIVATE_BUCKET (reminiscencia-audio-privado), PUBLIC_BUCKET
// (reminiscencia-audio) y el secreto GITHUB_TOKEN (wrangler secret put GITHUB_TOKEN; Contents e Issues en escritura).

import { EditError, handleEditRequest, jsonResponse, readCover } from '../../frontend/web/server/edit-core.js';
import { handleUploadRequest, UploadError, WORKER_MAX_CHUNK_BYTES } from '../../frontend/web/server/upload-core.js';
import { handleConvert } from '../../frontend/web/server/youtube-convert.js';
import { handleStatus } from '../../frontend/web/server/youtube-status.js';
import { handleDownload } from '../../frontend/web/server/youtube-download.js';
import { YOUTUBE_MARK_HEADER, markYoutube } from '../../frontend/web/server/youtube-mark.js';
import {
  handleSpotifyLogin, handleSpotifyToken, handleSpotifyRefresh, handleSpotifyResolve, handleSpotifyCallback,
} from '../../frontend/web/server/spotify-endpoints.js';
import { AUDIO_EXPOSE_HEADERS, handleAudioRequest } from './audio.js';
import { readCoverIndex, saveCoverToBucket } from './portadas.js';
import { bindingStorage } from './r2-storage.js';
import { serializeCoverIndex } from '../../frontend/web/js/cover-index.js';

export const SERVICE = 'reminiscencia-api';
export const API_HEADER = 'X-Reminiscencia-Api';
/** La web en Cloudflare (ADR-0034): el mismo origen que el Worker en su dominio propio. */
export const SITE_ORIGIN = 'https://reminiscencia.cometia.es';
/** La web en Vercel (se conserva: vuelve a funcionar cuando Vercel la desbloquee). */
export const WEB_ORIGIN = 'https://reminiscencia.vercel.app';
/** La copia de la web en Netlify (ADR-0037), respaldo de las funciones de YouTube mientras Vercel está bloqueado. */
export const NETLIFY_ORIGIN = 'https://reminiscencia.netlify.app';
/** Reenvío de /api/youtube/search y /playlist (las que usan yt-dlp): se prueban en este orden y se usa la primera que
 *  responda con la cabecera-marca (ADR-0038). Vercel va primero para que, cuando se desbloquee (2026-12-07), vuelva a
 *  usarse sola; Netlify es el respaldo mientras tanto. Se cambia con la variable YOUTUBE_UPSTREAMS de wrangler.toml. */
export const DEFAULT_YOUTUBE_UPSTREAMS = Object.freeze([WEB_ORIGIN, NETLIFY_ORIGIN]);
/** Compatibilidad: el primer upstream por defecto (antes era la única constante de reenvío). */
export const YOUTUBE_UPSTREAM = DEFAULT_YOUTUBE_UPSTREAMS[0];
const YOUTUBE_PREFIX = '/api/youtube/';
/** convert/status/download son proxies fetch puros (sin child_process): el Worker los ejecuta él mismo (ADR-0038), así
 *  no dependen de Vercel/Netlify, no gastan Fast Origin Transfer y la descarga del WAV no choca con el límite de 10 s
 *  de las funciones de Netlify. search y playlist (yt-dlp) se reenvían. */
const YOUTUBE_NATIVE = Object.freeze({ convert: handleConvert, status: handleStatus, download: handleDownload });
/** Cuánto se recuerda que un upstream está caído, para no volver a probarlo en cada petición (p. ej. Vercel pausado). */
const YOUTUBE_DOWN_TTL_MS = 5 * 60 * 1000;
/** upstream -> instante hasta el que se le considera caído (memoria por isolate; caduca sola). */
const youtubeDown = new Map();
/** Cabeceras de la petición que se reenvían (las que usan las funciones de YouTube). */
const YOUTUBE_FORWARD_HEADERS = Object.freeze([
  'accept', 'accept-language', 'content-type', 'range', 'if-none-match', 'user-agent',
  'x-homeostasia-trace', 'x-homeostasia-poll',
]);

/** Lista de upstreams de YouTube: la de env.YOUTUBE_UPSTREAMS (separada por comas) o, si falta, la de por defecto. */
export function youtubeUpstreams(env = {}) {
  const raw = typeof env.YOUTUBE_UPSTREAMS === 'string' ? env.YOUTUBE_UPSTREAMS : '';
  const list = raw.split(',').map((item) => item.trim()).filter(Boolean);
  return list.length ? list : [...DEFAULT_YOUTUBE_UPSTREAMS];
}

/** Solo para pruebas: olvida el estado de salud memorizado de los upstreams, para que cada caso empiece limpio. */
export function resetYoutubeUpstreamHealth() {
  youtubeDown.clear();
}
export const ALLOWED_HEADERS = Object.freeze([
  'Content-Type', 'X-Nombre-Archivo', 'X-Subida-Id', 'X-Parte', 'X-Partes', 'X-Album-Id', 'X-Album-Name',
  'X-Artista-Cancion', 'X-Portada-Id', 'Range', 'If-None-Match', 'If-Range',
]);
const LOCAL_ORIGIN = /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d{1,5})?$/;
export const COVER_DONE_MESSAGE = 'Portada guardada: ya la ven todos.';
const NOT_CONFIGURED_UPLOAD = 'La subida no está configurada en el servidor (falta GITHUB_TOKEN o el bucket privado). Avisa a quien mantiene la web.';
const NOT_CONFIGURED_COVER = 'Las portadas no están configuradas en el servidor (falta el bucket público). Avisa a quien mantiene la web.';

/** Orígenes admitidos: la web (en Cloudflare y en Vercel), los de env.ALLOWED_ORIGINS (separados por comas) y, solo
 *  con env.ALLOW_LOCALHOST === "1", localhost y 127.0.0.1 (pruebas y desarrollo local; nunca en producción). */
export function isAllowedOrigin(origin, env = {}) {
  if (origin === SITE_ORIGIN || origin === WEB_ORIGIN) return true;
  if (LOCAL_ORIGIN.test(origin)) return env.ALLOW_LOCALHOST === '1';
  const extra = typeof env.ALLOWED_ORIGINS === 'string' ? env.ALLOWED_ORIGINS.split(',').map((item) => item.trim()) : [];
  return extra.includes(origin);
}

function corsHeaders(origin, expose = []) {
  return origin ? {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Expose-Headers': [API_HEADER, ...expose].join(', '),
    Vary: 'Origin',
  } : { Vary: 'Origin' };
}

/** Copia la respuesta con las cabeceras del Worker (CORS y X-Reminiscencia-Api). */
function finish(response, origin, expose = []) {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(corsHeaders(origin, expose))) headers.set(name, value);
  headers.set(API_HEADER, '1');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

const token = (env) => (typeof env.GITHUB_TOKEN === 'string' ? env.GITHUB_TOKEN.trim() : '');

function saveCoverWith(env) {
  const save = async ({ id, bytes }) => {
    if (!env.PUBLIC_BUCKET) {
      console.error('portada: falta el binding PUBLIC_BUCKET');
      throw new EditError(500, NOT_CONFIGURED_COVER);
    }
    return { ...(await saveCoverToBucket(env.PUBLIC_BUCKET, { id, bytes })), mensaje: COVER_DONE_MESSAGE };
  };
  save.withoutToken = true;
  return save;
}

async function handleCover(request, env) {
  try {
    if (request.method !== 'POST') throw new EditError(405, 'Solo se admite POST.');
    const cover = await readCover(request);
    const extra = await saveCoverWith(env)(cover);
    return jsonResponse(200, { ok: true, ...extra });
  } catch (error) {
    if (error instanceof EditError) return jsonResponse(error.status, { ok: false, error: error.message });
    console.error('portada: fallo inesperado', error?.name ?? 'Error');
    return jsonResponse(500, { ok: false, error: 'No se ha podido guardar la portada. Inténtalo de nuevo.' });
  }
}

async function handleCoverIndex(request, env) {
  if (request.method !== 'GET') return jsonResponse(405, { ok: false, error: 'Solo se admite GET.' });
  if (!env.PUBLIC_BUCKET) return jsonResponse(500, { ok: false, error: NOT_CONFIGURED_COVER });
  try {
    const { index } = await readCoverIndex(env.PUBLIC_BUCKET);
    return new Response(serializeCoverIndex(index), {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    const status = error instanceof EditError ? error.status : 500;
    return jsonResponse(status, { ok: false, error: 'No se ha podido leer el índice de portadas.' });
  }
}

/** Ejecuta en el propio Worker una función de YouTube que no necesita yt-dlp (convert/status/download) y marca la
 *  respuesta (ADR-0038). El cuerpo (también el flujo del WAV) se transmite tal cual. */
async function youtubeNative(handler, request, fetchImpl) {
  return markYoutube(await handler(request, { fetchImpl }));
}

/** Reenvía /api/youtube/search y /playlist al primer upstream que responda con la cabecera-marca (ADR-0038): mismo
 *  método, ruta, consulta, cuerpo y las cabeceras de YOUTUBE_FORWARD_HEADERS; la respuesta vuelve en flujo y las
 *  redirecciones no se siguen. Un upstream que no responde, o que responde SIN la marca (Vercel pausado devuelve 402,
 *  Netlify caído una página de error), se recuerda como caído y se prueba el siguiente. Si ninguno responde, 502. */
async function forwardYoutube(request, env, fetchImpl) {
  const source = new URL(request.url);
  const headers = new Headers();
  for (const name of YOUTUBE_FORWARD_HEADERS) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  const method = request.method;
  const body = method !== 'GET' && method !== 'HEAD' ? await request.arrayBuffer() : undefined;
  const now = Date.now();
  // Orden de prioridad, pero con los que se saben caídos al final (sort estable: se mantiene el orden relativo).
  const upstreams = youtubeUpstreams(env)
    .map((base, index) => ({ base, index, down: (youtubeDown.get(base) ?? 0) > now }))
    .sort((a, b) => (a.down === b.down ? a.index - b.index : a.down ? 1 : -1));
  for (const { base } of upstreams) {
    const init = { method, headers, redirect: 'manual' };
    if (body !== undefined) init.body = body;
    let response;
    try {
      response = await fetchImpl(`${base}${source.pathname}${source.search}`, init);
    } catch (error) {
      console.error('youtube: upstream no responde', base, error?.name ?? 'Error');
      youtubeDown.set(base, now + YOUTUBE_DOWN_TTL_MS);
      continue;
    }
    // ¿Está caída la plataforma? Vercel pausado responde 402; un error 4xx/5xx SIN nuestra cabecera-marca es una página
    // de error de la plataforma (no de nuestra función). Un 2xx cuenta como EN PIE aunque NO lleve la marca: así, cuando
    // Vercel se desbloquee el 2026-12-07 sirviendo el código anterior (desplegado antes de esta cabecera, porque ahora
    // está pausado y no puede desplegar el nuevo), el Worker vuelve a usar Vercel SOLO, sin que nadie toque nada. Un
    // error legítimo de nuestra función (p. ej. 502 «demasiados datos») SÍ lleva la marca, así que se devuelve tal cual.
    const platformDown = response.status === 402 || (!response.ok && !response.headers.get(YOUTUBE_MARK_HEADER));
    if (!platformDown) {
      youtubeDown.delete(base);
      return response;
    }
    console.error('youtube: upstream caído', base, response.status);
    youtubeDown.set(base, now + YOUTUBE_DOWN_TTL_MS);
  }
  return jsonResponse(502, { ok: false, error: 'El servicio de YouTube no responde ahora mismo. Inténtalo más tarde.' });
}

const SPOTIFY_PREFIX = '/api/spotify/';

/**
 * Búsqueda de YouTube para el resolver de «Transferir música» (ADR-0044): el Worker no tiene yt-dlp, así que reutiliza su
 * propio proxy de upstreams (forwardYoutube) para /api/youtube/search y devuelve los candidatos.
 */
function spotifySearch(env, fetchImpl) {
  return async (query) => {
    const search = new Request(`https://worker.local/api/youtube/search?q=${encodeURIComponent(query)}`, { method: 'GET' });
    const response = await forwardYoutube(search, env, fetchImpl);
    if (!response.ok) return [];
    const data = await response.json().catch(() => ({}));
    return Array.isArray(data.items) ? data.items : [];
  };
}

/** Rutas de «Transferir música» (ADR-0044). Spotify (fetch) y el matching (JS puro) corren aquí; solo el yt-dlp de la
 *  búsqueda se delega al upstream. El token del usuario no se guarda: llega en cada /resolve. */
async function handleSpotify(name, request, env, fetchImpl) {
  switch (name) {
    case 'login': return handleSpotifyLogin(request, { env });
    case 'token': return handleSpotifyToken(request, { env, fetchImpl });
    case 'refresh': return handleSpotifyRefresh(request, { env, fetchImpl });
    case 'resolve': return handleSpotifyResolve(request, { search: spotifySearch(env, fetchImpl), fetchImpl });
    case 'callback': return handleSpotifyCallback();
    default: return jsonResponse(404, { ok: false, error: 'No existe.' });
  }
}

/** Atiende una petición (también en las pruebas: tests/web-unit/worker.test.mjs, con bindings simulados). */
export async function handleRequest(request, env = {}, { fetchImpl = (...args) => globalThis.fetch(...args) } = {}) {
  const origin = request.headers.get('origin');
  const path = new URL(request.url).pathname;
  // La web estática no pasa por CORS ni por las rutas del API: la sirve el binding ASSETS (ADR-0034).
  if (!path.startsWith('/api/') && !path.startsWith('/audio/') && env.ASSETS) return env.ASSETS.fetch(request);
  if (origin !== null && !isAllowedOrigin(origin, env)) {
    return finish(jsonResponse(403, { ok: false, error: 'Origen no permitido.' }), null);
  }
  if (request.method === 'OPTIONS') {
    return finish(new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
        'Access-Control-Allow-Headers': ALLOWED_HEADERS.join(', '),
        'Access-Control-Max-Age': '86400',
      },
    }), origin);
  }
  if (path.startsWith(YOUTUBE_PREFIX)) {
    const name = path.slice(YOUTUBE_PREFIX.length);
    const native = Object.prototype.hasOwnProperty.call(YOUTUBE_NATIVE, name) ? YOUTUBE_NATIVE[name] : null;
    if (native) return finish(await youtubeNative(native, request, fetchImpl), origin);
    return finish(await forwardYoutube(request, env, fetchImpl), origin);
  }
  if (path.startsWith(SPOTIFY_PREFIX)) {
    return finish(await handleSpotify(path.slice(SPOTIFY_PREFIX.length), request, env, fetchImpl), origin);
  }
  const audio = await handleAudioRequest(request, env.PUBLIC_BUCKET);
  if (audio) return finish(audio, origin, AUDIO_EXPOSE_HEADERS);
  let response;
  switch (path) {
    case '/api/salud':
      response = jsonResponse(200, { ok: true, servicio: SERVICE, trozoMaximo: WORKER_MAX_CHUNK_BYTES });
      break;
    case '/api/subir':
      response = await handleUploadRequest(request, {
        fetchImpl,
        maxChunkBytes: WORKER_MAX_CHUNK_BYTES,
        config: () => {
          if (!token(env) || !env.PRIVATE_BUCKET) {
            console.error('subir: falta el secreto GITHUB_TOKEN o el binding PRIVATE_BUCKET');
            throw new UploadError(500, NOT_CONFIGURED_UPLOAD);
          }
          return { token: token(env), storage: bindingStorage(env.PRIVATE_BUCKET) };
        },
      });
      break;
    case '/api/editar':
      response = await handleEditRequest(request, { token: token(env), fetchImpl, saveCover: saveCoverWith(env) });
      break;
    case '/api/portada':
      response = await handleCover(request, env);
      break;
    case '/api/portadas':
      response = await handleCoverIndex(request, env);
      break;
    default:
      response = jsonResponse(404, { ok: false, error: 'No existe.' });
  }
  return finish(response, origin);
}

export default {
  fetch(request, env) {
    return handleRequest(request, env);
  },
};
