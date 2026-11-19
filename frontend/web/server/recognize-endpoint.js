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
const DB_LOOKUP_BATCH = 100;        // D1 (Cloudflare) acepta hasta 100 parámetros por prepared statement. Usamos el máximo
                                    // para minimizar subrequests, que es lo que sacaba 503 al Worker (ver abajo).
/*
 * MAX_UNIQUE_HASHES (2026-11-19, ampliación ADR-0048/0049): Workers Free tier limita a ~50 subrequests por invocación.
 * Con 5825 hashes se generaban 65 batches secuenciales a D1 → el Worker devolvía 503 «exceeded resource limits» en ~90%
 * de las consultas reales (reproducido: 1/10 aciertos antes del cambio). Cerramos el tope a 3500 hashes únicos (35
 * batches de 100) para dejar margen cómodo. La poda es por tiempo (primeros N por orden): un fragmento de 8 s tiene
 * ~6250 hashes y los 3500 primeros cubren ~4,5 s, suficiente para un match robusto.
 */
const MAX_UNIQUE_HASHES = 3500;

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
