// Snapshots del catálogo en R2 (ADR-0052). Dos capas idempotentes:
//
//   snapshots/YYYY-MM-DD.json        → el primer cambio del día guarda el catálogo (auditoría humana, "ayer"/"antes de
//                                      ayer"). No se pisa si ya existe.
//   snapshots/by-version/v<N>.json   → antes de cada escritura se guarda el catálogo en la versión N actual, para que
//                                      el rollback a esa versión sea una lectura directa. No se pisa si ya existe.

export const SNAPSHOT_PREFIX = 'snapshots/';
export const VERSION_SNAPSHOT_PREFIX = 'snapshots/by-version/';

/** Comprime texto a Uint8Array con gzip. Devuelve null si no hay CompressionStream disponible. */
export async function gzipText(text) {
  if (typeof CompressionStream !== 'function') return null;
  try {
    const stream = new Response(new Blob([text])).body.pipeThrough(new CompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch { return null; }
}

/** Descomprime un ArrayBuffer gzip a string. Si no hay DecompressionStream, lanza. */
async function gunzipBuffer(buffer) {
  if (typeof DecompressionStream !== 'function') throw new Error('DecompressionStream no disponible');
  const stream = new Response(new Blob([buffer])).body.pipeThrough(new DecompressionStream('gzip'));
  return await new Response(stream).text();
}

function dayKey(now) {
  const d = new Date(now);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${SNAPSHOT_PREFIX}${yyyy}-${mm}-${dd}.json`;
}

/** Si no existe snapshot del día, guarda el catálogo. Idempotente: no pisa si ya hay. Devuelve el key escrito o null. */
export async function ensureDailySnapshot(bucket, catalog, { now = Date.now() } = {}) {
  const key = dayKey(now);
  const existing = await bucket.head(key);
  if (existing) return null;
  await bucket.put(key, JSON.stringify(catalog), { httpMetadata: { contentType: 'application/json; charset=utf-8' } });
  return key;
}

/** Lee un snapshot por fecha (YYYY-MM-DD) para un posible rollback manual. Devuelve null si no existe. */
export async function readSnapshot(bucket, date) {
  const key = `${SNAPSHOT_PREFIX}${date}.json`;
  const object = await bucket.get(key);
  if (!object) return null;
  try { return JSON.parse(await object.text()); } catch { return null; }
}

function versionKey(version) {
  return `${VERSION_SNAPSHOT_PREFIX}v${version}.json`;
}

/** Guarda el catálogo bajo snapshots/by-version/v<N>.json. Idempotente: no pisa si ya existe. */
export async function ensureVersionSnapshot(bucket, catalog) {
  const key = versionKey(catalog.version);
  const existing = await bucket.head(key);
  if (existing) return null;
  await bucket.put(key, JSON.stringify(catalog), { httpMetadata: { contentType: 'application/json; charset=utf-8' } });
  return key;
}

/** Lee el snapshot correspondiente a una versión concreta. Devuelve el catálogo o null si no existe.
 *  Prueba primero `v<N>.json` (snapshots recientes) y si no existe prueba `v<N>.json.gz` (snapshots antiguas comprimidas
 *  por el cron de gc semanal, ADR-0052 "Políticas de retención"). La descompresión es transparente. */
export async function readVersionSnapshot(bucket, version) {
  const object = await bucket.get(versionKey(version));
  if (object) {
    try { return JSON.parse(await object.text()); } catch { return null; }
  }
  const gz = await bucket.get(`${versionKey(version)}.gz`);
  if (!gz) return null;
  try {
    const buffer = await gz.arrayBuffer();
    const text = await gunzipBuffer(buffer);
    return JSON.parse(text);
  } catch { return null; }
}

/** Comprime y sustituye `snapshots/by-version/v<N>.json` por su versión `.json.gz`. Idempotente: si ya existe `.gz`
 *  no hace nada. Pensado para el cron semanal: snapshots viejas que casi nadie lee ocupan mucho menos. */
export async function gzipVersionSnapshot(bucket, version) {
  const srcKey = versionKey(version);
  const dstKey = `${srcKey}.gz`;
  const src = await bucket.get(srcKey);
  if (!src) return { skipped: 'not-found' };
  const existing = await bucket.head(dstKey);
  if (existing) {
    await bucket.delete(srcKey);
    return { skipped: 'already-gz', src: srcKey };
  }
  const text = await src.text();
  const gz = await gzipText(text);
  if (!gz) return { skipped: 'no-compression-stream' };
  await bucket.put(dstKey, gz, {
    httpMetadata: { contentType: 'application/json; charset=utf-8', contentEncoding: 'gzip' },
  });
  await bucket.delete(srcKey);
  return { ok: true, src: srcKey, dst: dstKey, originalBytes: text.length, compressedBytes: gz.byteLength };
}
