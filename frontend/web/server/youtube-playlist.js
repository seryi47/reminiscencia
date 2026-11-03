import { spawn as nodeSpawn } from 'node:child_process';
import { createRequire } from 'node:module';

import {
  MAX_PLAYLIST_ITEMS,
  YoutubeApiError,
  canonicalVideoUrl,
  json,
  publicError,
  youtubeUrl,
} from './youtube-common.js';

const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 45_000;
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
    const title = line.slice(tab + 1).trim().slice(0, 200) || 'audio';
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

export async function handlePlaylist(request, { spawnImpl = nodeSpawn, env = process.env } = {}) {
  try {
    if (request.method !== 'GET') throw new YoutubeApiError(405, 'Solo se admite GET.');
    const value = new URL(request.url).searchParams.get('url') ?? '';
    // yt-dlp también acepta un vídeo individual, igual que el script de
    // escritorio que sirve de referencia para este importador.
    const url = youtubeUrl(value, { playlist: true }) || youtubeUrl(value);
    if (!url) throw new YoutubeApiError(400, 'La URL de YouTube no es válida.');
    const result = await runYtdlp(url, { spawnImpl, env });
    return json(200, { items: extractPlaylist({ url, ...result }) });
  } catch (error) {
    return publicError(error);
  }
}

export function GET(request) {
  return handlePlaylist(request, { env: process.env });
}
