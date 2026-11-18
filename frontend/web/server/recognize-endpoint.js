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
const DB_LOOKUP_BATCH = 90;         // D1 (Cloudflare) tiene un tope de 100 parámetros por prepared statement; 90 va sobrado

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
  // Valida que hashes y offsets sean enteros: un null colado se convertiría a NaN en D1 `bind`.
  for (let i = 0; i < body.hashes.length; i++) {
    if (!Number.isInteger(body.hashes[i]) || !Number.isInteger(body.offsets[i])) {
      return jsonResponse(400, { ok: false, matched: false, error: 'hashes/offsets no son enteros.' });
    }
  }
  const db = injectedDb ?? (env && env.RECOGNIZE_DB);
  if (!db) {
    return jsonResponse(200, { ok: true, matched: false, reason: 'db_not_ready', totalQueryHashes: body.hashes.length });
  }

  try {
    // Intenté `db.batch()` con JOIN y `Promise.all` con oleadas: ambos rompen el Worker (503 Cloudflare en pruebas
    // reales con 5825 hashes → 65 lotes). El CPU time y el subrequest cap del Worker en Free tier no toleran tanta
    // concurrencia a D1. Secuencial es más lento pero FIABLE. ADR-0049: optimización pendiente hasta probar en
    // Workers Paid o con un índice pre-agrupado.
    const uniqueHashes = [...new Set(body.hashes)];
    const indexForMatch = new Map();
    for (let start = 0; start < uniqueHashes.length; start += DB_LOOKUP_BATCH) {
      const slice = uniqueHashes.slice(start, start + DB_LOOKUP_BATCH);
      const placeholders = slice.map(() => '?').join(',');
      const { results: rows } = await db.prepare(
        `SELECT hash, song_id, offset FROM hashes WHERE hash IN (${placeholders})`
      ).bind(...slice).all();
      for (const row of rows ?? []) {
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
    // Una sola query extra para la metadata del match (barata: PK lookup).
    const meta = {};
    try {
      const songRow = await db.prepare('SELECT id, title, artist FROM songs WHERE id = ?').bind(result.songId).first();
      if (songRow) meta[result.songId] = { title: songRow.title, artist: songRow.artist };
    } catch (_) { /* si falla, devolvemos sin enriquecer */ }
    const enriched = enrichMatch(result, meta);
    return jsonResponse(200, { ok: true, ...enriched });
  } catch (error) {
    // No devolvemos 500: la UI (web y APK) trata los no-200 como fallo duro y no cae a la vía letras. Con 200 + reason
    // seguimos el contrato del endpoint y la UI puede decidir caer a letras / mostrar «fallo transitorio».
    return jsonResponse(200, { ok: true, matched: false, reason: 'db_query_failed', detail: String(error?.message ?? error) });
  }
}

function jsonResponse(status, data) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}
