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
    // Preparamos TODOS los lotes de 90 hashes y los ejecutamos en UNA sola round-trip con `db.batch()`. Antes el bucle
    // hacía ~65 SELECTs secuenciales (~600 ms con 5825 hashes); con batch, ~50 ms (una sola ida/vuelta Worker↔D1).
    const uniqueHashes = [...new Set(body.hashes)];
    const batches = [];
    for (let start = 0; start < uniqueHashes.length; start += DB_LOOKUP_BATCH) {
      const slice = uniqueHashes.slice(start, start + DB_LOOKUP_BATCH);
      const placeholders = slice.map(() => '?').join(',');
      // Hacemos el JOIN con `songs` en el mismo SELECT para no gastar una query extra tras el match: metemos title/artist
      // en cada fila, el matcher ignorará lo que no use. La duplicación de texto no pesa (D1 responde comprimido).
      batches.push(db.prepare(
        `SELECT h.hash, h.song_id, h.offset, s.title, s.artist
         FROM hashes h JOIN songs s ON s.id = h.song_id
         WHERE h.hash IN (${placeholders})`
      ).bind(...slice));
    }
    const indexForMatch = new Map();
    const meta = {};
    if (batches.length > 0) {
      const results = await db.batch(batches);
      for (const { results: rows } of results ?? []) {
        for (const row of rows ?? []) {
          if (!row) continue;
          const h = Number(row.hash);
          const songId = String(row.song_id);
          const list = indexForMatch.get(h) ?? [];
          list.push({ songId, offset: Number(row.offset) });
          indexForMatch.set(h, list);
          if (!meta[songId]) meta[songId] = { title: row.title ?? '', artist: row.artist ?? '' };
        }
      }
    }
    const result = matchFingerprint({ hashes: body.hashes, offsets: body.offsets }, indexForMatch);
    if (!result.matched) {
      return jsonResponse(200, { ok: true, matched: false, totalQueryHashes: body.hashes.length });
    }
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
