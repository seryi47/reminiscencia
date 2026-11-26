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

import { EditError, jsonResponse, readCover } from '../../frontend/web/server/edit-core.js';
import { handleUploadRequest, UploadError, WORKER_MAX_CHUNK_BYTES } from '../../frontend/web/server/upload-core.js';
import { handleConvert } from '../../frontend/web/server/youtube-convert.js';
import { handleStatus } from '../../frontend/web/server/youtube-status.js';
import { handleDownload } from '../../frontend/web/server/youtube-download.js';
import { YOUTUBE_MARK_HEADER, markYoutube } from '../../frontend/web/server/youtube-mark.js';
import { searchYoutubeMusic, mergeCandidates } from '../../frontend/web/server/youtube-music.js';
import { searchYoutubeScrape, scrapeYoutubePlaylist } from '../../frontend/web/server/youtube-scrape.js';
import {
  handleSpotifyLogin, handleSpotifyToken, handleSpotifyRefresh, handleSpotifyMine, handleSpotifyResolve, handleSpotifyRecent, handleSpotifyCallback,
} from '../../frontend/web/server/spotify-endpoints.js';
import { handleRecognizeRequest } from '../../frontend/web/server/recognize-endpoint.js';
import { handleRecognizeLyricsRequest } from '../../frontend/web/server/recognize-lyrics.js';
import { AUDIO_EXPOSE_HEADERS, handleAudioRequest } from './audio.js';
import { readCoverIndex, saveCoverToBucket } from './portadas.js';
import { bindingStorage } from './r2-storage.js';
import { serializeCoverIndex } from '../../frontend/web/js/cover-index.js';
import { handleCatalogRoute, isCatalogRoute } from './catalog-api.js';

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
  'X-Auth', 'X-Actor', // ADR-0052: cabeceras de las escrituras del catálogo en R2.
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
  // Fallbacks desde el propio Worker (ADR-0038 ampliado 2026-11-24): si Vercel y Netlify están caídos los dos (Vercel
  // pausado por Fast Origin Transfer hasta 2026-12-07, Netlify con cupo mensual agotado) se intenta resolver aquí la
  // búsqueda de `/search` con dos capas:
  //   1. `searchYoutubeMusic` → canales oficiales (Topic/Art Track), señal de ADR-0044 más valiosa.
  //   2. `searchYoutubeScrape` → scraping de youtube.com/results, el mismo HTML que yt-dlp parsea.
  // Ambas solo usan `fetch` y no necesitan yt-dlp. Así «Transferir música» y el botón «Buscar otra en YouTube» siguen
  // funcionando aunque no haya upstream yt-dlp. Solo `/search` tiene este fallback; `/playlist` sigue necesitándolo.
  if (source.pathname === `${YOUTUBE_PREFIX}playlist`) {
    // Fallback de playlist cuando ambos upstreams yt-dlp (Vercel/Netlify) están caídos (ADR-0038 ampliado 2026-11-25):
    // scrapeamos directamente `youtube.com/playlist?list=<ID>` y devolvemos sus items. Esto NO resuelve metadatos de
    // audio, solo la lista de vídeos: homeostasia.js ya sabe pedir cada vídeo por separado.
    // El cliente puede mandar `?list=<ID>` directamente o `?url=https://youtube.com/playlist?list=<ID>` (homeostasia).
    let list = source.searchParams.get('list');
    let videoIdFromUrl = null;
    const urlParam = source.searchParams.get('url');
    if (urlParam) {
      try {
        const parsed = new URL(urlParam);
        if (!list) list = parsed.searchParams.get('list');
        // Detecta un enlace de VÍDEO suelto (sin `list=`): youtu.be/<id>, youtube.com/watch?v=<id>, /shorts/<id>, /embed/<id>.
        if (!list) {
          if (parsed.hostname === 'youtu.be') {
            videoIdFromUrl = parsed.pathname.slice(1).split('/')[0] ?? '';
          } else if (parsed.pathname === '/watch') {
            videoIdFromUrl = parsed.searchParams.get('v') ?? '';
          } else {
            const match = parsed.pathname.match(/^\/(?:shorts|embed)\/([A-Za-z0-9_-]{11})$/);
            videoIdFromUrl = match ? match[1] : null;
          }
          if (videoIdFromUrl && !/^[A-Za-z0-9_-]{11}$/.test(videoIdFromUrl)) videoIdFromUrl = null;
        }
      } catch { /* url mala */ }
    }
    if (list && /^[A-Za-z0-9_-]{1,64}$/.test(list)) {
      const scraped = await scrapeYoutubePlaylist(list, { fetchImpl });
      if (scraped && Array.isArray(scraped.items) && scraped.items.length > 0) {
        // Contrato esperado por homeostasia.js::listarPlaylist (ADR-0021): items + playlist.{id,title}. Si la
        // respuesta solo trae `title` (como antes de 2026-11-25), el cliente la rechaza con «YouTube no ha
        // devuelto el nombre de la playlist».
        const payload = {
          items: scraped.items,
          title: scraped.title,
          playlist: { id: list, title: scraped.title || list },
        };
        return new Response(JSON.stringify(payload), {
          status: 200,
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400',
            [YOUTUBE_MARK_HEADER]: 'worker-fallback',
          },
        });
      }
    }
    // Fallback para VÍDEO suelto (ADR-0038 ampliado 2026-11-25): si no hay yt-dlp arriba y la URL no es una playlist,
    // resolvemos el título vía oEmbed de YouTube (público, sin API key). Es un solo fetch barato. Antes caía al 502
    // «El servicio de YouTube no responde ahora mismo» aunque oEmbed estuviera perfectamente operativo.
    if (videoIdFromUrl) {
      const canonical = `https://www.youtube.com/watch?v=${videoIdFromUrl}`;
      try {
        const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(canonical)}&format=json`;
        const response = await fetchImpl(oembedUrl, {
          headers: {
            Accept: 'application/json',
            'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          },
        });
        if (response.ok) {
          const data = await response.json().catch(() => null);
          const title = typeof data?.title === 'string' ? data.title.trim().slice(0, 200) : '';
          if (title) {
            return new Response(JSON.stringify({ items: [{ url: canonical, title }] }), {
              status: 200,
              headers: {
                'Content-Type': 'application/json; charset=utf-8',
                'Cache-Control': 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400',
                [YOUTUBE_MARK_HEADER]: 'worker-fallback',
              },
            });
          }
        }
      } catch (error) {
        console.error('youtube: fallback oembed fallo', error?.name ?? 'Error');
      }
    }
  }
  if (source.pathname === `${YOUTUBE_PREFIX}search`) {
    // Saneado de la query antes de salir al upstream: mismo tope que la función oficial de /search
    // (MAX_QUERY_LENGTH=100). Sin él, una query larga gasta CPU del Worker y subrequests sin aportar nada
    // (YouTube corta por su cuenta en los primeros chars).
    const query = (source.searchParams.get('q') ?? '')
      .replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);
    if (query.length >= 2) {
      const [music, scrape] = await Promise.all([
        searchYoutubeMusic(query, { fetchImpl }).catch(() => []),
        searchYoutubeScrape(query, { fetchImpl }).catch(() => []),
      ]);
      // YT Music primero (canales oficiales); el scraping rellena con los vídeos normales.
      const items = mergeCandidates(music, scrape);
      if (items.length > 0) {
        return new Response(JSON.stringify({ items }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400',
            [YOUTUBE_MARK_HEADER]: 'worker-fallback',
          },
        });
      }
    }
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
    // Upstream primero (yt-dlp vía Vercel/Netlify): si trae >=3 candidatos, NO llamamos a YouTube Music para
    // esta pista. YT Music añade 'topic' (score +20) pero su cuota es mucho más estrecha que la del upstream y
    // se agotaba en listas grandes (Mix de 100 dejaba 3-12 pistas vacías). Sin 'topic' la mayoría de pistas
    // siguen puntuando suficiente para tier=alta (ADR-0046 ampliado 2026-11-19).
    const search = new Request(`https://worker.local/api/youtube/search?q=${encodeURIComponent(query)}`, { method: 'GET' });
    const response = await forwardYoutube(search, env, fetchImpl);
    let items = [];
    if (response.ok) {
      const data = await response.json().catch(() => ({}));
      items = Array.isArray(data.items) ? data.items : [];
    }
    // Si forwardYoutube ya cayó en su propio fallback (worker-fallback), YT Music ya está DENTRO de la respuesta
    // (ADR-0038 ampliado 2026-11-24). No llamamos otra vez para no duplicar gasto de cuota ni latencia.
    const alreadyFellBack = response.headers.get(YOUTUBE_MARK_HEADER) === 'worker-fallback';
    if (items.length >= 3 || alreadyFellBack) return items;
    // Fallback: también YT Music (para pistas raras donde el upstream no encuentra)
    const music = await searchYoutubeMusic(query, { fetchImpl }).catch(() => []);
    return mergeCandidates(music, items);
  };
}

/** Rutas de «Transferir música» (ADR-0044). Spotify (fetch) y el matching (JS puro) corren aquí; solo el yt-dlp de la
 *  búsqueda se delega al upstream. El token del usuario no se guarda: llega en cada /resolve. */
async function handleSpotify(name, request, env, fetchImpl) {
  switch (name) {
    case 'login': return handleSpotifyLogin(request, { env });
    case 'token': return handleSpotifyToken(request, { env, fetchImpl });
    case 'refresh': return handleSpotifyRefresh(request, { env, fetchImpl });
    case 'mine': return handleSpotifyMine(request, { fetchImpl });
    case 'recent': return handleSpotifyRecent(request, { fetchImpl });
    case 'resolve': return handleSpotifyResolve(request, { search: spotifySearch(env, fetchImpl), fetchImpl });
    case 'callback': return handleSpotifyCallback();
    default: return jsonResponse(404, { ok: false, error: 'No existe.' });
  }
}

/** Atiende una petición (también en las pruebas: tests/web-unit/worker.test.mjs, con bindings simulados). */
/** ¿Supera esta IP el rate limit de la API? Fail-open: si el binding no está (pruebas, o sin configurar en Cloudflare) o
 * el limitador falla, NUNCA se bloquea (la disponibilidad manda sobre el antiabuso). El limitador de Cloudflare cuenta
 * por IP y por centro de datos; es un tope aproximado para frenar inundaciones, no una cuota estricta. */
export async function isRateLimited(request, env) {
  const limiter = env && env.API_RATE_LIMITER;
  if (!limiter || typeof limiter.limit !== 'function') return false;
  const ip = request.headers.get('CF-Connecting-IP')
    || request.headers.get('x-forwarded-for')
    || 'desconocida';
  try {
    const { success } = await limiter.limit({ key: ip });
    return success === false;
  } catch (_) {
    return false;
  }
}

/** Atiende /api/subir con el ramal ADR-0052: si hay AUTH_PASSWORD, no se llama a api.github.com/dispatches
 *  (la publicación la hará el cliente con POST /api/buzon/publish). Fallback a la ruta histórica si no. */
async function handleSubir(request, env, fetchImpl) {
  const dispatchEnabled = !env?.AUTH_PASSWORD;
  const wrappedFetch = dispatchEnabled
    ? fetchImpl
    : async (url, init) => {
        try {
          const target = new URL(url);
          if (target.hostname === 'api.github.com' && target.pathname.endsWith('/dispatches')) {
            return new Response(null, { status: 204 });
          }
        } catch (_) { /* url inválida: lo trata el fetch real */ }
        return fetchImpl(url, init);
      };
  const response = await handleUploadRequest(request, {
    fetchImpl: wrappedFetch,
    maxChunkBytes: WORKER_MAX_CHUNK_BYTES,
    config: () => {
      if (!env?.PRIVATE_BUCKET) {
        console.error('subir: falta el binding PRIVATE_BUCKET');
        throw new UploadError(500, NOT_CONFIGURED_UPLOAD);
      }
      if (dispatchEnabled && !token(env)) {
        console.error('subir: falta el secreto GITHUB_TOKEN y el Worker está en modo legacy (sin AUTH_PASSWORD)');
        throw new UploadError(500, NOT_CONFIGURED_UPLOAD);
      }
      return { token: token(env) ?? '', storage: bindingStorage(env.PRIVATE_BUCKET) };
    },
  });
  if (dispatchEnabled || response.status !== 200) return response;
  let payload;
  try { payload = await response.clone().json(); } catch { return response; }
  if (payload?.completa !== true) return response;
  const uploadId = request.headers.get('x-subida-id') ?? request.headers.get('X-Subida-Id') ?? null;
  const nextBody = {
    ok: true,
    song_ready: true,
    upload_id: uploadId,
    nombre: payload.nombre ?? null,
    next_step: 'POST /api/buzon/publish con if_match',
  };
  return new Response(JSON.stringify(nextBody), {
    status: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

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
  // Rate limit por IP para los endpoints de API (ADR-0046): red de seguridad antiinundación (abuso/coste de los endpoints
  // abiertos). Tope MUY generoso (ver wrangler.toml): una subida normal es ~1 petición por canción por el Worker, así que
  // el uso real no lo roza. NO se aplica al audio (/audio/, reproducción con rangos) ni a la comprobación de salud.
  if (path.startsWith('/api/') && path !== '/api/salud' && await isRateLimited(request, env)) {
    return finish(jsonResponse(429, { ok: false, error: 'Demasiadas peticiones; espera un momento.' }), origin);
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
  // Rutas del catálogo en R2 (ADR-0052): lectura pública + escritura con X-Auth.
  if (isCatalogRoute(path)) {
    return finish(await handleCatalogRoute(path, request, env), origin);
  }
  let response;
  switch (path) {
    case '/api/salud':
      response = jsonResponse(200, { ok: true, servicio: SERVICE, trozoMaximo: WORKER_MAX_CHUNK_BYTES });
      break;
    case '/api/subir':
      // En el modo nuevo del catálogo (ADR-0052: AUTH_PASSWORD presente) el Worker ya no dispara
      // repository_dispatch; el cliente llamará a POST /api/buzon/publish tras el último trozo.
      response = await handleSubir(request, env, fetchImpl);
      break;
    case '/api/editar':
      // Retirado por los fixes críticos del ADR-0052: antes creaba una incidencia GitHub
      // con etiqueta `biblioteca`, pero el workflow `biblioteca.yml` ya no existe, así que
      // las peticiones quedaban silenciosamente sin aplicar (UI decía "enviada").
      response = jsonResponse(410, {
        ok: false,
        error: '/api/editar retirado (ADR-0052). Usa POST /api/catalogo/edit con X-Auth.',
      });
      break;
    case '/api/portada':
      response = await handleCover(request, env);
      break;
    case '/api/portadas':
      response = await handleCoverIndex(request, env);
      break;
    case '/api/recognize':
      response = await handleRecognizeRequest(request, { env });
      break;
    case '/api/recognize-lyrics':
      response = await handleRecognizeLyricsRequest(request, { env });
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
