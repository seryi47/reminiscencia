import { spawn as nodeSpawn } from 'node:child_process';
import { createRequire } from 'node:module';

import {
  MAX_PLAYLIST_ITEMS,
  YoutubeApiError,
  canonicalVideoUrl,
  fetchWithTimeout,
  json,
  publicError,
  upstreamHeaders,
  videoId,
  youtubeUrl,
} from './youtube-common.js';

const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 45_000;
const HTML_TIMEOUT_MS = 30_000;
const TITLE_TIMEOUT_MS = 8_000;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const require = createRequire(import.meta.url);

function bundledExecutable() {
  try {
    return require('youtube-dl-exec/src/constants').YOUTUBE_DL_PATH;
  } catch {
    return '';
  }
}

function executable(env) {
  const configured = typeof env?.YTDLP_PATH === 'string' ? env.YTDLP_PATH.trim() : '';
  return configured || bundledExecutable() || 'yt-dlp';
}

export function extractPlaylist({ url, stdout, code, timedOut }) {
  if (timedOut) throw new YoutubeApiError(504, 'YouTube tardó demasiado en responder.');
  if (code !== 0) throw new YoutubeApiError(502, 'No se pudo leer la playlist de YouTube. Puede no existir o no ser accesible.');
  const items = [];
  const seen = new Set();
  for (const line of String(stdout ?? '').split(/\r?\n/)) {
    const tab = line.indexOf('\t');
    if (tab < 0) continue;
    const id = line.slice(0, tab).trim();
    if (!VIDEO_ID.test(id) || seen.has(id)) continue;
    const title = line.slice(tab + 1).trim().slice(0, 200);
    if (!title) {
      throw new YoutubeApiError(502, 'YouTube no devolvió el título original de un vídeo de la playlist.');
    }
    seen.add(id);
    items.push({ url: canonicalVideoUrl(id), title });
    if (items.length >= MAX_PLAYLIST_ITEMS) break;
  }
  if (items.length === 0) throw new YoutubeApiError(404, 'No se han encontrado canciones accesibles en la playlist.');
  return items;
}

function runYtdlp(url, { spawnImpl = nodeSpawn, env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawnImpl(executable(env), [
      '--no-warnings',
      '--flat-playlist',
      '--playlist-end', String(MAX_PLAYLIST_ITEMS),
      '--print', '%(id)s\t%(title)s',
      url.href,
    ], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '';
    let stderrBytes = 0;
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
    }, TIMEOUT_MS);
    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk);
      if (Buffer.byteLength(stdout) > MAX_OUTPUT_BYTES) {
        try { child.kill('SIGKILL'); } catch { /* idem */ }
        finish(reject, new YoutubeApiError(413, 'La playlist devuelve demasiados datos.'));
      }
    });
    child.stderr?.on('data', (chunk) => { stderrBytes += Buffer.byteLength(String(chunk)); });
    child.on('error', (error) => {
      if (error?.code === 'ENOENT') finish(reject, new YoutubeApiError(503, 'El servidor no tiene yt-dlp configurado.'));
      else finish(reject, new YoutubeApiError(502, 'No se pudo iniciar la lectura de YouTube.'));
    });
    child.on('close', (code) => finish(resolve, { stdout, code, timedOut, stderrBytes }));
  });
}

function parseAssignedJson(html, marker) {
  const markerAt = String(html ?? '').indexOf(marker);
  if (markerAt < 0) return null;
  const start = markerAt + marker.length;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < html.length; index += 1) {
    const char = html[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') { inString = true; continue; }
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        try { return JSON.parse(html.slice(start, index + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

function decodeHtmlEntities(value) {
  return String(value ?? '').replace(/&(#(?:x[\da-f]+|\d+)|amp|quot|apos|lt|gt|#39);/gi, (match, entity) => {
    const named = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' };
    if (entity[0] !== '#') return named[entity.toLowerCase()] ?? match;
    const code = entity[1].toLowerCase() === 'x'
      ? Number.parseInt(entity.slice(2), 16)
      : Number.parseInt(entity.slice(1), 10);
    return Number.isInteger(code) && code >= 0 && code <= 0x10ffff
      ? String.fromCodePoint(code)
      : match;
  });
}

function metaContent(html, property) {
  const tags = String(html ?? '').matchAll(/<meta\b[^>]*>/gi);
  for (const [tag] of tags) {
    const attributes = Object.fromEntries(
      [...tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)]
        .map(([, name, doubleQuoted, singleQuoted, unquoted]) => [
          name.toLowerCase(),
          doubleQuoted ?? singleQuoted ?? unquoted ?? '',
        ]),
    );
    if ((attributes.property ?? attributes.name ?? '').toLowerCase() === property) {
      return decodeHtmlEntities(attributes.content).trim();
    }
  }
  return '';
}

export function extractVideoTitleHtml(html) {
  const playerResponse = parseAssignedJson(html, 'ytInitialPlayerResponse = ');
  const playerTitle = playerResponse?.videoDetails?.title;
  if (typeof playerTitle === 'string' && playerTitle.trim()) {
    return decodeHtmlEntities(playerTitle).trim().slice(0, 200);
  }

  const openGraphTitle = metaContent(html, 'og:title');
  if (openGraphTitle) return openGraphTitle.slice(0, 200);

  const pageTitle = String(html ?? '').match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const cleanedTitle = decodeHtmlEntities(pageTitle).replace(/\s*-\s*YouTube\s*$/i, '').trim();
  return cleanedTitle && cleanedTitle.toLowerCase() !== 'youtube'
    ? cleanedTitle.slice(0, 200)
    : null;
}

function parseInitialData(html) {
  return parseAssignedJson(html, 'ytInitialData = ');
}

function textFrom(value) {
  if (typeof value?.simpleText === 'string') return value.simpleText;
  if (Array.isArray(value?.runs)) return value.runs.map((run) => run?.text || '').join('');
  return '';
}

export function extractPlaylistHtml(html) {
  const items = [];
  const seen = new Set();
  const add = (id, title = '') => {
    const originalTitle = String(title ?? '').trim().slice(0, 200);
    if (!VIDEO_ID.test(id) || !originalTitle || seen.has(id) || items.length >= MAX_PLAYLIST_ITEMS) return;
    seen.add(id);
    items.push({ url: canonicalVideoUrl(id), title: originalTitle });
  };
  const visit = (value) => {
    if (items.length >= MAX_PLAYLIST_ITEMS || value === null || value === undefined) return;
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (typeof value !== 'object') return;
    if (typeof value.videoId === 'string') add(value.videoId, textFrom(value.title) || textFrom(value.videoTitle));
    Object.values(value).forEach(visit);
  };
  visit(parseInitialData(html));
  return items;
}

async function readPlaylistHtml(url, fetchImpl) {
  const response = await fetchWithTimeout(fetchImpl, url.href, {
    headers: {
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Encoding': 'gzip, deflate',
      'User-Agent': upstreamHeaders()['User-Agent'],
    },
  }, HTML_TIMEOUT_MS);
  if (!response.ok) return [];
  return extractPlaylistHtml(await response.text());
}

async function readVideoTitle(url, { fetchImpl, spawnImpl, env }) {
  const id = videoId(url.href);
  const canonicalUrl = canonicalVideoUrl(id);
  const oembedUrl = new URL('https://www.youtube.com/oembed');
  oembedUrl.searchParams.set('url', canonicalUrl);
  oembedUrl.searchParams.set('format', 'json');

  try {
    const response = await fetchWithTimeout(fetchImpl, oembedUrl.href, {
      headers: { Accept: 'application/json', 'User-Agent': upstreamHeaders()['User-Agent'] },
    }, TITLE_TIMEOUT_MS);
    if (response.ok) {
      let data;
      try {
        data = await response.json();
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
      }
      if (typeof data?.title === 'string' && data.title.trim()) {
        return data.title.trim().slice(0, 200);
      }
    }
  } catch (error) {
    if (!(error instanceof YoutubeApiError)) throw error;
  }

  try {
    const response = await fetchWithTimeout(fetchImpl, canonicalUrl, {
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Encoding': 'gzip, deflate',
        'User-Agent': upstreamHeaders()['User-Agent'],
      },
    }, HTML_TIMEOUT_MS);
    if (response.ok) {
      const title = extractVideoTitleHtml(await response.text());
      if (title) return title;
    }
  } catch (error) {
    if (!(error instanceof YoutubeApiError)) throw error;
  }

  try {
    const result = await runYtdlp(new URL(canonicalUrl), { spawnImpl, env });
    const [item] = extractPlaylist({ url: new URL(canonicalUrl), ...result });
    if (item?.title) return item.title;
  } catch (error) {
    if (!(error instanceof YoutubeApiError)) throw error;
  }

  throw new YoutubeApiError(502, 'No se pudo leer el título original del vídeo de YouTube.');
}

export async function handlePlaylist(request, { spawnImpl = nodeSpawn, env = process.env, fetchImpl = globalThis.fetch } = {}) {
  try {
    if (request.method !== 'GET') throw new YoutubeApiError(405, 'Solo se admite GET.');
    const value = new URL(request.url).searchParams.get('url') ?? '';
    const playlistUrl = youtubeUrl(value, { playlist: true });
    const url = playlistUrl || youtubeUrl(value);
    if (!url) throw new YoutubeApiError(400, 'La URL de YouTube no es válida.');

    // OEmbed es la fuente primaria del título; la página y yt-dlp son alternativas
    // para los vídeos que no devuelven metadatos por esa vía.
    if (!playlistUrl) {
      return json(200, {
        items: [{ url: url.href, title: await readVideoTitle(url, { fetchImpl, spawnImpl, env }) }],
      });
    }

    try {
      const result = await runYtdlp(url, { spawnImpl, env });
      return json(200, { items: extractPlaylist({ url, ...result }) });
    } catch (error) {
      // YouTube suele bloquear yt-dlp desde IPs de nube, pero la página pública
      // aún puede incluir su `ytInitialData` con los vídeos de la playlist.
      if (!(error instanceof YoutubeApiError) || ![404, 502, 504].includes(error.status)) throw error;
      try {
        const items = await readPlaylistHtml(url, fetchImpl);
        if (items.length > 0) return json(200, { items });
      } catch { /* se conserva el diagnóstico seguro de yt-dlp */ }
      throw error;
    }
  } catch (error) {
    return publicError(error);
  }
}

export function GET(request) {
  return handlePlaylist(request, { env: process.env, fetchImpl: globalThis.fetch });
}
