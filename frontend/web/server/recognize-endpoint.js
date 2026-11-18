// Endpoint HTTP del reconocedor (ADR-0048). Recibe un cuerpo JSON `{v:1, hashes:[int], offsets:[int]}` del móvil y
// devuelve `{matched, songId?, title?, artist?, confidence}`.
//
// Vías de reconocimiento (en este orden):
//   1. Base D1 de nuestra biblioteca (binding `RECOGNIZE_DB`). Match por histograma de deltas.
//   2. (Fallback futuro) Transcripción Whisper + búsqueda LRClib, para canciones fuera de la biblioteca.
//
// Si `RECOGNIZE_DB` no está cableado (pruebas o Worker sin binding), responde 200 con `matched:false` y
// `reason:"db_not_ready"`, sin fallar. La UI de la app lo trata con un mensaje claro.

import { matchFingerprint, enrichMatch } from './recognize-core.js';

const MAX_HASHES_PER_QUERY = 50000; // tope defensivo
const DB_LOOKUP_BATCH = 90;         // SQLite tiene un límite de 999 parámetros; 90 va sobrado y suma pocas rondas

/** Para pruebas: inyecta un `db` simulado con la misma interfaz (`prepare().bind().all()`). */
let injectedDb = null;
export function setRecognizeDb(db) { injectedDb = db; }

export async function handleRecognizeRequest(request, { env } = {}) {
  if (request.method !== 'POST') {
    return jsonResponse(405, { ok: false, matched: false, error: 'Solo se admite POST.' });
  }
  let body;
  try { body = await request.json(); } catch (_) {
    return jsonResponse(400, { ok: false, matched: false, error: 'Cuerpo JSON no válido.' });
  }
  if (!body || body.v !== 1 || !Array.isArray(body.hashes) || !Array.isArray(body.offsets)
      || body.hashes.length !== body.offsets.length) {
    return jsonResponse(400, { ok: false, matched: false, error: 'Formato no reconocido.' });
  }
  if (body.hashes.length > MAX_HASHES_PER_QUERY) {
    return jsonResponse(413, { ok: false, matched: false, error: 'Demasiados hashes.' });
  }
  const db = injectedDb ?? (env && env.RECOGNIZE_DB);
  if (!db) {
    return jsonResponse(200, { ok: true, matched: false, reason: 'db_not_ready', totalQueryHashes: body.hashes.length });
  }

  try {
    // Lanzamos queries por lotes de 90 hashes y combinamos los hits en un índice local; luego matchFingerprint (JS puro).
    const indexForMatch = new Map();
    const uniqueHashes = [...new Set(body.hashes)];
    for (let start = 0; start < uniqueHashes.length; start += DB_LOOKUP_BATCH) {
      const slice = uniqueHashes.slice(start, start + DB_LOOKUP_BATCH);
      const placeholders = slice.map(() => '?').join(',');
      const stmt = db.prepare(`SELECT hash, song_id, offset FROM hashes WHERE hash IN (${placeholders})`).bind(...slice);
      const { results } = await stmt.all();
      for (const row of results ?? []) {
        if (!row) continue;
        const h = Number(row.hash);
        const list = indexForMatch.get(h) ?? [];
        list.push({ songId: String(row.song_id), offset: Number(row.offset) });
        indexForMatch.set(h, list);
      }
    }
    const result = matchFingerprint({ hashes: body.hashes, offsets: body.offsets }, indexForMatch);
    if (!result.matched) {
      return jsonResponse(200, { ok: true, matched: false, totalQueryHashes: body.hashes.length });
    }
    // Enriquecer con metadata del propio D1.
    const meta = {};
    try {
      const songRow = await db.prepare('SELECT id, title, artist FROM songs WHERE id = ?').bind(result.songId).first();
      if (songRow) meta[result.songId] = { title: songRow.title, artist: songRow.artist };
    } catch (_) { /* si falla, devolvemos sin enriquecer */ }
    const enriched = enrichMatch(result, meta);
    return jsonResponse(200, { ok: true, ...enriched });
  } catch (error) {
    return jsonResponse(500, { ok: false, matched: false, error: 'db_query_failed', detail: String(error?.message ?? error) });
  }
}

function jsonResponse(status, data) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}
