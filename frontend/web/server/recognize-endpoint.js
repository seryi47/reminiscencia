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
const DB_LOOKUP_BATCH = 100;        // D1 (Cloudflare) acepta hasta 100 parámetros por prepared statement.
/*
 * (2026-11-19, ampliación ADR-0048/0049): el Worker devolvía 503 «exceeded resource limits» en el 90% de las consultas
 * reales. Dos causas:
 *   a) demasiados subrequests (65 batches con 5825 hashes),
 *   b) tamaño total de respuesta: los hashes reales son MUY COMUNES (suelen aparecer en decenas de canciones) y
 *      acumular todas las filas devoraba memoria + CPU del Worker. Bajar hashes a 3500 no bastó (seguía 503 porque las
 *      respuestas eran grandes).
 *
 * Solución combinada:
 *   - MAX_UNIQUE_HASHES = 2000: 20 batches como mucho. Cubre ~2,5 s de la grabación de 8 s.
 *   - PER_HASH_LIMIT = 50: cada query en D1 trae como mucho 50 (hash, song_id, offset) → cota superior de 20·100·50 =
 *     100 000 filas tope. En la práctica muchos hashes coinciden con <5 canciones y se cortan los pocos ruidosos. Un
 *     hash que coincida con 100+ canciones NO es discriminativo, perderlo no afecta al matching.
 */
const MAX_UNIQUE_HASHES = 2000;
const PER_HASH_LIMIT = 50;

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
    // Secuencial sigue siendo lo más FIABLE (db.batch() con JOIN y Promise.all con oleadas rompían el Worker en
    // pruebas: tamaño de respuesta y concurrencia). La diferencia respecto a la versión anterior: ahora limitamos los
    // hashes únicos a MAX_UNIQUE_HASHES para no exceder el cap de subrequests de Workers (~50/invocación). Antes se
    // generaban 65 batches con 5825 hashes → 503 en ~90% de las consultas reales.
    //
    // Dedup preservando el ORDEN de primera aparición (son un orden temporal razonable: primeros fotogramas, luego
    // siguientes). Si sobran, nos quedamos con los primeros; los últimos del fragmento aún pueden votar si esos hashes
    // están repetidos antes en la query (matchFingerprint vota por cada posición de query.hashes que coincide con el
    // índice, no por hash único).
    const seenHash = new Set();
    const uniqueHashes = [];
    for (const h of body.hashes) {
      if (!seenHash.has(h)) {
        seenHash.add(h);
        uniqueHashes.push(h);
        if (uniqueHashes.length >= MAX_UNIQUE_HASHES) break;
      }
    }
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
        let list = indexForMatch.get(h);
        if (!list) { list = []; indexForMatch.set(h, list); }
        // Tope por hash en JS: evita que hashes «basura» (presentes en muchas canciones y no discriminativos) hinchen
        // la estructura y maten al Worker. La window function SQL causaba db_query_failed intermitente en D1 bajo carga.
        if (list.length >= PER_HASH_LIMIT) continue;
        list.push({ songId: String(row.song_id), offset: Number(row.offset) });
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
