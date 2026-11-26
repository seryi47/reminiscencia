// Historial append-only del catálogo en R2 (ADR-0052). Reemplaza el git log del catálogo cuando dejemos de pasar por
// GitHub. Dos capas:
//
//   history/YYYY/MM/<ulid>.json  → un fichero por evento (auditoría completa, sin compactar).
//   history/latest.jsonl         → fichero rotativo con las últimas ≤1000 entradas, para GET /api/catalogo/historial.
//                                  Cuando pasa de 1000 líneas, se rota a history/latest-rotado-<ulid>.jsonl y se
//                                  arranca vacío (la auditoría completa sigue en los ficheros YYYY/MM/).

export const LATEST_JSONL_KEY = 'history/latest.jsonl';
export const LATEST_ROTATED_PREFIX = 'history/latest-rotado-';
export const LATEST_ROTATED_SUFFIX = '.jsonl.gz';
export const LATEST_MAX_LINES = 1000;

/** Comprime un string a `Uint8Array` con gzip usando `CompressionStream`. Devuelve `null` si el entorno no lo soporta
 *  (p.ej. runtimes de prueba sin Web Streams); el llamante cae a sin comprimir en ese caso. */
export async function gzipString(text) {
  if (typeof CompressionStream !== 'function') return null;
  try {
    const stream = new Response(new Blob([text])).body.pipeThrough(new CompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch { return null; }
}

const BASE32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** ULID de 26 chars (6 bytes de tiempo + 10 bytes aleatorios codificados en Crockford Base32). */
export function ulid(now = Date.now()) {
  let timePart = '';
  let t = now;
  for (let i = 0; i < 10; i += 1) { timePart = BASE32[t % 32] + timePart; t = Math.floor(t / 32); }
  const random = new Uint8Array(10);
  crypto.getRandomValues(random);
  let randomPart = '';
  for (const b of random) randomPart += BASE32[b % 32] + BASE32[(b >>> 3) % 32];
  return (timePart + randomPart).slice(0, 26);
}

function eventKey(now) {
  const d = new Date(now);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `history/${yyyy}/${mm}/${ulid(now)}.json`;
}

/** Añade un evento al historial: guarda el fichero YYYY/MM/<ulid>.json y actualiza latest.jsonl. Rota si supera 1000.
 *
 * Orden de escrituras pensado para que, si el isolate muere a medias, el estado observable sea consistente:
 *   1) history/YYYY/MM/<ulid>.json — fuente de verdad del historial (auditoría completa).
 *   2) history/latest.jsonl — rollup rotativo con la línea nueva ya incluida (lo que GET /historial lee).
 *   3) (solo al rotar) history/latest-rotado-<ulid>.jsonl — copia histórica del rollup anterior.
 *
 * Si muere entre (2) y (3), latest.jsonl ya tiene la línea nueva; como mucho se pierde la copia histórica rotada,
 * pero los eventos de ese tramo siguen vivos en history/YYYY/MM/. Si en lugar de esto rotáramos antes del PUT de
 * latest.jsonl, la línea nueva podría quedar fuera del rollup aunque sí estuviera en YYYY/MM/ (ADR-0052 cierre de
 * findings 2026-11-26).
 */
export async function appendEvent(bucket, event, { now = Date.now() } = {}) {
  const enriched = { at: new Date(now).toISOString(), ...event };
  const serialized = JSON.stringify(enriched);
  const key = eventKey(now);
  await bucket.put(key, serialized, { httpMetadata: { contentType: 'application/json; charset=utf-8' } });

  const existing = await bucket.get(LATEST_JSONL_KEY);
  const previousText = existing ? await existing.text() : '';
  const lines = previousText ? previousText.split('\n').filter(Boolean) : [];
  lines.push(serialized);
  const rotating = lines.length > LATEST_MAX_LINES;
  if (rotating) {
    // Al rotar, latest.jsonl arranca vacío + línea nueva; la copia histórica se escribe DESPUÉS, comprimida con gzip.
    // Ahorra ~70 % de espacio (el jsonl se repite mucho; `gzip` sobre contenido textual es muy eficiente).
    await bucket.put(LATEST_JSONL_KEY, `${serialized}\n`, { httpMetadata: { contentType: 'application/x-ndjson; charset=utf-8' } });
    const gz = await gzipString(previousText);
    if (gz) {
      const rotatedKey = `${LATEST_ROTATED_PREFIX}${ulid(now)}${LATEST_ROTATED_SUFFIX}`;
      await bucket.put(rotatedKey, gz, {
        httpMetadata: { contentType: 'application/x-ndjson; charset=utf-8', contentEncoding: 'gzip' },
      });
    } else {
      const rotatedKey = `${LATEST_ROTATED_PREFIX}${ulid(now)}.jsonl`;
      await bucket.put(rotatedKey, previousText, { httpMetadata: { contentType: 'application/x-ndjson; charset=utf-8' } });
    }
  } else {
    await bucket.put(LATEST_JSONL_KEY, `${lines.join('\n')}\n`, { httpMetadata: { contentType: 'application/x-ndjson; charset=utf-8' } });
  }
  return { key, event: enriched };
}

/** Lee las últimas `limit` líneas de latest.jsonl (más nuevas primero). */
export async function readLatest(bucket, limit = 100) {
  const object = await bucket.get(LATEST_JSONL_KEY);
  if (!object) return [];
  const text = await object.text();
  const lines = text.split('\n').filter(Boolean);
  const tail = lines.slice(Math.max(0, lines.length - limit));
  tail.reverse();
  return tail.map((line) => { try { return JSON.parse(line); } catch { return { at: null, invalid: true, raw: line }; } });
}
