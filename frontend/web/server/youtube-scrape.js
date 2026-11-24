// Scraping directo de youtube.com/results como SEGUNDO fallback cuando ni Vercel/Netlify (yt-dlp) ni YouTube Music
// responden (ADR-0038 ampliado 2026-11-24). Como youtube-music.js, usa solo `fetch`: no depende de child_process,
// así que el Worker de Cloudflare puede importarlo sin problema. Es ADITIVO: devuelve [] si no hay resultados.
//
// Es la misma idea que `extractSearchHtml` de youtube-search.js, pero self-contained para no arrastrar sus imports
// de child_process (y que el Worker pueda importar este módulo con `fetch` únicamente).

import { canonicalVideoUrl, fetchWithTimeout } from './youtube-common.js';

const USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const MAX_DURATION_S = 20 * 60;
const TIMEOUT_MS = 10_000;
export const SCRAPE_MAX_RESULTS = 10;

/** «3:45» o «1:02:03» a segundos; null si no tiene el formato (por ejemplo, un directo sin duración). */
export function parseClock(value) {
  const parts = String(value ?? '').trim().split(':');
  if (parts.length < 2 || parts.length > 3 || !parts.every((part) => /^\d{1,2}$/.test(part))) return null;
  return parts.reduce((total, part) => total * 60 + Number(part), 0);
}

/** «Artista - Topic» → «Artista». */
function artistFromChannel(channel) {
  return String(channel ?? '').replace(/\s+-\s+Topic$/i, '').trim().slice(0, 200);
}

/** Clasifica la fuente del candidato: 'topic' si el canal es «Artista - Topic», 'official' si es VEVO/oficial. */
function sourceFromChannel(channel) {
  const value = String(channel ?? '');
  if (/\s+-\s+Topic$/i.test(value)) return 'topic';
  if (/VEVO$/i.test(value) || /\bofficial\b/i.test(value)) return 'official';
  return 'search';
}

/** Lee el runs/simpleText de un campo de texto de ytInitialData. */
function readText(node) {
  if (!node) return '';
  if (typeof node.simpleText === 'string') return node.simpleText;
  if (Array.isArray(node.runs)) return node.runs.map((run) => run?.text ?? '').join('');
  return '';
}

/**
 * Localiza y parsea el JSON que YouTube asigna como `var ytInitialData = {...};` dentro del HTML. Está escrito por YouTube,
 * así que no es necesario escapar nada — con contar llaves equilibradas basta. Devuelve null si no se encuentra.
 */
export function parseInitialData(html) {
  const marks = ['var ytInitialData = ', 'window["ytInitialData"] = '];
  const source = String(html ?? '');
  for (const mark of marks) {
    const start = source.indexOf(mark);
    if (start < 0) continue;
    let depth = 0;
    let inString = false;
    let escape = false;
    let i = start + mark.length;
    if (source[i] !== '{') continue;
    const first = i;
    for (; i < source.length; i += 1) {
      const ch = source[i];
      if (escape) { escape = false; continue; }
      if (ch === '\\') { escape = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === '{') depth += 1;
      else if (ch === '}') { depth -= 1; if (depth === 0) { i += 1; break; } }
    }
    if (depth !== 0) continue;
    try { return JSON.parse(source.slice(first, i)); } catch { continue; }
  }
  return null;
}

/** Walk de ytInitialData sacando los `videoRenderer` con título/canal/duración. */
export function extractVideos(data) {
  const out = [];
  const walk = (node, depth) => {
    if (!node || typeof node !== 'object' || depth > 40) return;
    if (Array.isArray(node)) { for (const child of node) walk(child, depth + 1); return; }
    const renderer = node.videoRenderer;
    if (renderer && typeof renderer === 'object') {
      const id = renderer.videoId;
      const title = readText(renderer.title).trim().slice(0, 200);
      const channel = readText(renderer.ownerText) || readText(renderer.longBylineText);
      const durationS = parseClock(readText(renderer.lengthText));
      if (VIDEO_ID.test(id) && title && Number.isFinite(durationS) && durationS > 0 && durationS <= MAX_DURATION_S) {
        out.push({
          id, url: canonicalVideoUrl(id), title,
          artist: artistFromChannel(channel), durationS: Math.round(durationS),
          source: sourceFromChannel(channel),
        });
      }
    }
    for (const key of Object.keys(node)) {
      if (key === 'videoRenderer') continue;
      walk(node[key], depth + 1);
    }
  };
  walk(data, 0);
  // Dedup por id, conserva el orden.
  const seen = new Set();
  const dedup = [];
  for (const item of out) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    dedup.push(item);
    if (dedup.length >= SCRAPE_MAX_RESULTS) break;
  }
  return dedup;
}

/**
 * Busca canciones scrapeando youtube.com/results. Fallback cuando YT Music tampoco responde (ADR-0038 ampliado
 * 2026-11-24). Solo fetch; devuelve [] si no se puede.
 */
export async function searchYoutubeScrape(query, { fetchImpl = globalThis.fetch } = {}) {
  try {
    const url = new URL('https://www.youtube.com/results');
    url.searchParams.set('search_query', query);
    // Filtro «Vídeo»: sin listas, canales ni películas.
    // IMPORTANTE: el valor es el string base64 crudo `EgIQAQ==`, no el URL-encoded `EgIQAQ%3D%3D`.
    // `URLSearchParams.set` ya URL-encoda al serializar; pasar el encoded aquí lo encoda DOBLE y YouTube
    // ignora el filtro, devolviendo luego también playlists, canales y películas.
    url.searchParams.set('sp', 'EgIQAQ==');
    const response = await fetchWithTimeout(fetchImpl, url.href, {
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
        'User-Agent': USER_AGENT,
      },
    }, TIMEOUT_MS);
    if (!response.ok) return [];
    const html = await response.text();
    const data = parseInitialData(html);
    if (!data) return [];
    return extractVideos(data);
  } catch {
    return [];
  }
}
