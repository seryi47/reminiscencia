// Snapshots del catálogo en R2 (ADR-0052). Dos capas idempotentes:
//
//   snapshots/YYYY-MM-DD.json        → el primer cambio del día guarda el catálogo (auditoría humana, "ayer"/"antes de
//                                      ayer"). No se pisa si ya existe.
//   snapshots/by-version/v<N>.json   → antes de cada escritura se guarda el catálogo en la versión N actual, para que
//                                      el rollback a esa versión sea una lectura directa. No se pisa si ya existe.

export const SNAPSHOT_PREFIX = 'snapshots/';
export const VERSION_SNAPSHOT_PREFIX = 'snapshots/by-version/';

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

/** Lee el snapshot correspondiente a una versión concreta. Devuelve el catálogo o null si no existe. */
export async function readVersionSnapshot(bucket, version) {
  const object = await bucket.get(versionKey(version));
  if (!object) return null;
  try { return JSON.parse(await object.text()); } catch { return null; }
}
