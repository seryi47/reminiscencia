// Búsqueda de canciones en YouTube para el buscador de la web y de la APK (ADR-0021).
// Solo devuelve candidatos (id, título, canal y duración): la descarga sigue el mismo camino que una URL pegada
// en Homeostasia (/api/youtube/playlist y el conversor), así que el título y el artista salen del mismo sitio.

import { spawn as nodeSpawn } from 'node:child_process';

import {
  YoutubeApiError,
  canonicalVideoUrl,
  fetchWithTimeout,
  json,
  publicError,
} from './youtube-common.js';
import { executable, parseAssignedJson } from './youtube-playlist.js';

export const MIN_QUERY_LENGTH = 2;
export const MAX_QUERY_LENGTH = 100;
export const MAX_RESULTS = 8;
// Se piden algunos más porque se descartan los directos y las mezclas largas.
const CANDIDATES = 14;
// Una canción no dura más: así no se ofrecen álbumes completos, mezclas ni podcasts.
export const MAX_DURATION_S = 20 * 60;
const HTML_TIMEOUT_MS = 8_000;
const YTDLP_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_BYTES = 1024 * 1024;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const CACHE_CONTROL = 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400';

export function cleanQuery(value) {
  if (typeof value !== 'string') return null;
  const query = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  const length = Array.from(query).length;
  return length >= MIN_QUERY_LENGTH && length <= MAX_QUERY_LENGTH ? query : null;
}

/** «Artista - Topic» es el canal automático de YouTube Music: el artista es lo anterior. */
export function artistFromChannel(channel) {
  return String(channel ?? '').replace(/\s+-\s+Topic$/i, '').trim().slice(0, 200);
}

/** «3:45» o «1:02:03» a segundos; null si no tiene el formato (por ejemplo, un directo). */
export function parseClock(text) {
  const parts = String(text ?? '').trim().split(':');
  if (parts.length < 2 || parts.length > 3 || !parts.every((part) => /^\d{1,2}$/.test(part))) return null;
  return parts.reduce((total, part) => total * 60 + Number(part), 0);
}

function normalize(candidates) {
  const items = [];
  const seen = new Set();
  for (const candidate of candidates) {
    const { id, durationS } = candidate;
    const title = String(candidate.title ?? '').trim().slice(0, 200);
    if (!VIDEO_ID.test(id) || seen.has(id) || !title) continue;
    if (!Number.isFinite(durationS) || durationS <= 0 || durationS > MAX_DURATION_S) continue;
    seen.add(id);
    items.push({
      id,
      url: canonicalVideoUrl(id),
      title,
      artist: artistFromChannel(candidate.channel),
      durationS: Math.round(durationS),
    });
    if (items.length >= MAX_RESULTS) break;
  }
  return items;
}

const text = (value) => value?.simpleText ?? value?.runs?.map((run) => run?.text ?? '').join('') ?? '';

/** Resultados de la página de búsqueda (ytInitialData): cada `videoRenderer` es un vídeo. */
export function extractSearchHtml(html) {
  const data = parseAssignedJson(html, 'var ytInitialData = ') ?? parseAssignedJson(html, 'window["ytInitialData"] = ');
  if (!data) return [];
  const candidates = [];
  const walk = (node, depth) => {
    if (!node || typeof node !== 'object' || depth > 40) return;
    if (Array.isArray(node)) {
      for (const child of node) walk(child, depth + 1);
      return;
    }
    const renderer = node.videoRenderer;
    if (renderer && typeof renderer === 'object') {
      candidates.push({
        id: renderer.videoId,
        title: text(renderer.title),
        channel: text(renderer.ownerText) || text(renderer.longBylineText),
        durationS: parseClock(text(renderer.lengthText)),
      });
    }
    for (const key of Object.keys(node)) if (key !== 'videoRenderer') walk(node[key], depth + 1);
  };
  walk(data, 0);
  return normalize(candidates);
}

/** Salida de yt-dlp con `%(id)s\t%(title)s\t%(channel)s\t%(duration)s`, una línea por vídeo. */
export function extractSearchYtdlp(stdout) {
  const candidates = [];
  for (const line of String(stdout ?? '').split(/\r?\n/)) {
    const [id, title, channel, duration] = line.split('\t');
    candidates.push({
      id: id?.trim(),
      title,
      channel: channel === 'NA' ? '' : channel,
      durationS: duration && duration !== 'NA' ? Number(duration) : null,
    });
  }
  return normalize(candidates);
}

async function searchHtml(query, fetchImpl) {
  const url = new URL('https://www.youtube.com/results');
  url.searchParams.set('search_query', query);
  // Filtro «Vídeo»: sin listas, canales ni películas.
  url.searchParams.set('sp', 'EgIQAQ%3D%3D');
  const response = await fetchWithTimeout(fetchImpl, url.href, {
    headers: {
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
      'Accept-Encoding': 'gzip, deflate',
      'User-Agent': USER_AGENT,
    },
  }, HTML_TIMEOUT_MS);
  if (!response.ok) return [];
  return extractSearchHtml(await response.text());
}

function searchYtdlp(query, { spawnImpl, env }) {
  return new Promise((resolve, reject) => {
    // «ytsearchN:» va delante del texto: lo que escribe la persona nunca se lee como una opción de yt-dlp.
    const child = spawnImpl(executable(env), [
      '--no-warnings',
      '--flat-playlist',
      '--print', '%(id)s\t%(title)s\t%(channel)s\t%(duration)s',
      `ytsearch${CANDIDATES}:${query}`,
    ], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '';
    let settled = false;
    let timedOut = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill('SIGKILL'); } catch { /* el proceso puede haber terminado justo antes */ }
    }, YTDLP_TIMEOUT_MS);
    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk);
      if (Buffer.byteLength(stdout) > MAX_OUTPUT_BYTES) {
        try { child.kill('SIGKILL'); } catch { /* idem */ }
        finish(reject, new YoutubeApiError(502, 'YouTube devolvió demasiados datos.'));
      }
    });
    child.on('error', (error) => {
      if (error?.code === 'ENOENT') finish(reject, new YoutubeApiError(503, 'El servidor no tiene yt-dlp configurado.'));
      else finish(reject, new YoutubeApiError(502, 'No se pudo iniciar la búsqueda en YouTube.'));
    });
    child.on('close', (code) => {
      if (timedOut) finish(reject, new YoutubeApiError(504, 'YouTube tardó demasiado en responder.'));
      else if (code !== 0) finish(reject, new YoutubeApiError(502, 'No se pudo buscar en YouTube.'));
      else finish(resolve, extractSearchYtdlp(stdout));
    });
  });
}

export async function handleSearch(request, { spawnImpl = nodeSpawn, env = process.env, fetchImpl = globalThis.fetch } = {}) {
  try {
    if (request.method !== 'GET') throw new YoutubeApiError(405, 'Método no permitido.', { Allow: 'GET' });
    const query = cleanQuery(new URL(request.url).searchParams.get('q'));
    if (!query) {
      throw new YoutubeApiError(400, `Escribe entre ${MIN_QUERY_LENGTH} y ${MAX_QUERY_LENGTH} caracteres para buscar.`);
    }
    // La página de resultados es rápida; yt-dlp, más lento, solo entra si la página no da nada.
    let items = [];
    try {
      items = await searchHtml(query, fetchImpl);
    } catch (error) {
      if (!(error instanceof YoutubeApiError)) throw error;
    }
    if (items.length === 0) items = await searchYtdlp(query, { spawnImpl, env });
    return json(200, { items }, { 'Cache-Control': CACHE_CONTROL });
  } catch (error) {
    return publicError(error);
  }
}

export function GET(request) {
  return handleSearch(request);
}
