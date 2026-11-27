// Búsqueda full-text server-side (ADR-0052). Normaliza acentos, tokeniza por espacios, busca por substring en
// title/artist/tags/folder.name con scoring simple. Edge cache 10 s para que consultas repetidas no toquen R2.
//
// Endpoint: GET /api/search?q=<query>&limit=50&type=all|song|folder
// Respuesta: { songs:[{id, title, artist, score}], folders:[{id, name, score}], query, total_candidates }

import { readCatalog } from './catalog.js';

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;
const MAX_QUERY_LEN = 120;

/** Normaliza una cadena para la búsqueda: minúsculas y sin acentos. */
export function normalize(text) {
  if (typeof text !== 'string') return '';
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Puntúa un item para un token concreto. 0 = no match. Match al inicio > artista > en medio > tags. */
function scoreSongForToken(normTitle, normArtist, normTags, token) {
  if (!token) return 0;
  let best = 0;
  if (normTitle === token) best = Math.max(best, 100);
  if (normTitle.startsWith(token)) best = Math.max(best, 80);
  if (normArtist === token) best = Math.max(best, 70);
  if (normArtist.startsWith(token)) best = Math.max(best, 60);
  const titleIdx = normTitle.indexOf(token);
  if (titleIdx > 0) best = Math.max(best, 50 - Math.min(titleIdx, 40));
  const artistIdx = normArtist.indexOf(token);
  if (artistIdx > 0) best = Math.max(best, 40 - Math.min(artistIdx, 30));
  if (normTags.includes(token)) best = Math.max(best, 20);
  return best;
}

function scoreFolderForToken(normName, token) {
  if (!token) return 0;
  if (normName === token) return 100;
  if (normName.startsWith(token)) return 70;
  const idx = normName.indexOf(token);
  if (idx > 0) return 40 - Math.min(idx, 30);
  return 0;
}

/** Busca en el catálogo dado. Puro, sin I/O. */
export function searchCatalog(catalog, { query, limit = DEFAULT_LIMIT, type = 'all' } = {}) {
  const normQuery = normalize(query ?? '');
  const tokens = normQuery.split(' ').filter(Boolean);
  if (tokens.length === 0) {
    return { songs: [], folders: [], query: query ?? '', total_candidates: 0 };
  }
  const songs = (type === 'folder' ? [] : (catalog?.songs ?? []));
  const folders = (type === 'song' ? [] : (catalog?.folders ?? []));
  const songHits = [];
  const folderHits = [];
  for (const s of songs) {
    const normTitle = normalize(s.title ?? '');
    const normArtist = normalize(s.artist ?? '');
    const normTags = normalize(Array.isArray(s.tags) ? s.tags.join(' ') : '');
    let totalScore = 0;
    let allMatched = true;
    for (const t of tokens) {
      const sc = scoreSongForToken(normTitle, normArtist, normTags, t);
      if (sc === 0) { allMatched = false; break; }
      totalScore += sc;
    }
    if (allMatched && totalScore > 0) {
      songHits.push({ id: s.id, title: s.title, artist: s.artist ?? '', score: totalScore });
    }
  }
  for (const f of folders) {
    const normName = normalize(f.name ?? '');
    let totalScore = 0;
    let allMatched = true;
    for (const t of tokens) {
      const sc = scoreFolderForToken(normName, t);
      if (sc === 0) { allMatched = false; break; }
      totalScore += sc;
    }
    if (allMatched && totalScore > 0) {
      folderHits.push({ id: f.id, name: f.name, score: totalScore });
    }
  }
  songHits.sort((a, b) => b.score - a.score);
  folderHits.sort((a, b) => b.score - a.score);
  const cappedLimit = Math.min(Math.max(1, limit | 0), MAX_LIMIT);
  return {
    songs: songHits.slice(0, cappedLimit),
    folders: folderHits.slice(0, cappedLimit),
    query: query ?? '',
    total_candidates: songHits.length + folderHits.length,
  };
}

/** Handler HTTP del endpoint GET /api/search. */
export async function handleSearch(request, env) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response(JSON.stringify({ error: 'Solo se admite GET.' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }
  const url = new URL(request.url);
  const query = (url.searchParams.get('q') ?? '').slice(0, MAX_QUERY_LEN);
  const limitRaw = Number(url.searchParams.get('limit') ?? DEFAULT_LIMIT);
  const limit = Number.isFinite(limitRaw) ? limitRaw : DEFAULT_LIMIT;
  const type = ['all', 'song', 'folder'].includes(url.searchParams.get('type') ?? 'all')
    ? (url.searchParams.get('type') ?? 'all') : 'all';
  if (!env?.PUBLIC_BUCKET) {
    return new Response(JSON.stringify({ error: 'Catálogo no disponible.' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }
  const catalog = await readCatalog(env.PUBLIC_BUCKET);
  if (!catalog) {
    return new Response(JSON.stringify({ songs: [], folders: [], query, total_candidates: 0 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=10' },
    });
  }
  const body = request.method === 'HEAD' ? null : JSON.stringify(searchCatalog(catalog, { query, limit, type }));
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=10',
    },
  });
}

export function isSearchRoute(path) {
  return path === '/api/search';
}
