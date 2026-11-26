// Poda de snapshots por versión (ADR-0052). Cada escritura al catálogo guarda
// `snapshots/by-version/v<N>.json` para que el rollback sea O(1). Con el tiempo esto crece lineal con el número de
// versiones. Este módulo mantiene las últimas `keepLatest` snapshots completas y, de las más viejas, conserva una cada
// `snapshotEveryN` versiones como "milestones" para rollback a época. Las demás se borran.
//
// Se lanza desde el cron `[triggers] crons = ["0 3 * * 0"]` del Worker (domingo 3 AM UTC). Ejecutable también a mano
// desde tests y desde el handler `scheduled` de index.js.

import { gzipVersionSnapshot, VERSION_SNAPSHOT_PREFIX } from './snapshots.js';

/** Edad por defecto (días) a partir de la cual una snapshot por versión se comprime a `.json.gz`. */
export const GZIP_OLDER_THAN_DAYS = 30;

/** Extrae el entero N de una clave `snapshots/by-version/v<N>.json` (o `.json.gz`). null si no cuadra. */
export function versionFromKey(key) {
  if (!key.startsWith(VERSION_SNAPSHOT_PREFIX)) return null;
  const rest = key.slice(VERSION_SNAPSHOT_PREFIX.length);
  const match = /^v(\d+)\.json(\.gz)?$/.exec(rest);
  if (!match) return null;
  return Number(match[1]);
}

/** Lista TODAS las snapshots por versión del bucket (incluye `.json` y `.json.gz`). Devuelve
 *  `[{ version, key, uploaded, size, gz }]` ordenado por versión ascendente. */
async function listAllVersionObjects(bucket) {
  const objects = [];
  let cursor;
  do {
    const page = await bucket.list({ prefix: VERSION_SNAPSHOT_PREFIX, cursor });
    for (const obj of page.objects ?? []) {
      const n = versionFromKey(obj.key);
      if (n === null) continue;
      objects.push({
        version: n,
        key: obj.key,
        uploaded: obj.uploaded,
        size: obj.size,
        gz: obj.key.endsWith('.gz'),
      });
    }
    cursor = page.truncated ? page.cursor : null;
  } while (cursor);
  return objects.sort((a, b) => a.version - b.version);
}

/** Solo las versiones (desduplicadas, ordenadas asc). Útil para la lógica de poda. */
async function listAllVersions(bucket) {
  const seen = new Set();
  for (const o of await listAllVersionObjects(bucket)) seen.add(o.version);
  return [...seen].sort((a, b) => a - b);
}

/**
 * Poda snapshots por versión. No borra `catalog/catalog.json` ni `catalog/VERSION.txt` (no es su prefijo) ni la
 * snapshot de la versión 0 si existiera.
 *
 * Reglas:
 *  - Las últimas `keepLatest` versiones (por N más alto) se mantienen siempre.
 *  - De las anteriores, se mantiene una cada `snapshotEveryN` (v10, v20, v30, …).
 *  - La versión 0 nunca se borra (puede ser un seed que se queda como milestone absoluto).
 *  - El resto se borra.
 *
 * Idempotente: una segunda ejecución sobre el mismo estado no borra nada más.
 * Devuelve `{ kept: [versiones], pruned: [versiones] }` (ordenadas ascendentemente).
 */
export async function pruneOldVersionSnapshots(bucket, { keepLatest = 50, snapshotEveryN = 10 } = {}) {
  if (!bucket) return { kept: [], pruned: [] };
  const all = await listAllVersions(bucket);
  if (all.length === 0) return { kept: [], pruned: [] };
  const latest = all.slice(-keepLatest);
  const latestSet = new Set(latest);
  const kept = [];
  const pruned = [];
  for (const v of all) {
    if (latestSet.has(v)) { kept.push(v); continue; }
    if (v === 0) { kept.push(v); continue; }
    if (snapshotEveryN > 0 && v % snapshotEveryN === 0) { kept.push(v); continue; }
    pruned.push(v);
  }
  for (const v of pruned) {
    // Borramos ambas variantes (la actual + la comprimida si existiera) para dejar la versión limpia.
    await bucket.delete(`${VERSION_SNAPSHOT_PREFIX}v${v}.json`);
    await bucket.delete(`${VERSION_SNAPSHOT_PREFIX}v${v}.json.gz`);
  }
  kept.sort((a, b) => a - b);
  return { kept, pruned };
}

/** Comprime las snapshots por versión (`.json`) con `uploaded` más antiguo que `olderThanDays` días. Las versiones que
 *  ya tienen la variante `.json.gz` se dejan como están (idempotente). Devuelve `{ compressed: [versions], skipped: N }`.
 *  Pensado como fase previa de `pruneOldVersionSnapshots` en el cron semanal. */
export async function gzipOldVersionSnapshots(bucket, {
  olderThanDays = GZIP_OLDER_THAN_DAYS,
  now = Date.now(),
} = {}) {
  if (!bucket) return { compressed: [], skipped: 0 };
  const cutoff = now - olderThanDays * 24 * 60 * 60 * 1000;
  const objects = await listAllVersionObjects(bucket);
  const compressed = [];
  let skipped = 0;
  // Agrupamos por versión para saber si ya hay .gz y evitar trabajo.
  const byVersion = new Map();
  for (const o of objects) {
    const entry = byVersion.get(o.version) ?? { plain: null, gz: null };
    if (o.gz) entry.gz = o; else entry.plain = o;
    byVersion.set(o.version, entry);
  }
  for (const [version, { plain, gz }] of byVersion) {
    if (!plain) { skipped += 1; continue; }
    if (gz) {
      // Hay .gz y aún está el .json: lo borramos para ahorrar espacio (idempotencia del gzipVersionSnapshot ya lo haría,
      // pero lo cerramos aquí también para no depender de ello).
      await bucket.delete(plain.key);
      skipped += 1;
      continue;
    }
    const uploadedAt = plain.uploaded ? new Date(plain.uploaded).getTime() : 0;
    if (uploadedAt > cutoff) { skipped += 1; continue; }
    const res = await gzipVersionSnapshot(bucket, version);
    if (res?.ok) compressed.push(version);
    else skipped += 1;
  }
  return { compressed: compressed.sort((a, b) => a - b), skipped };
}
