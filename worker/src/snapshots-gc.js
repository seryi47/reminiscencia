// Poda de snapshots por versión (ADR-0052). Cada escritura al catálogo guarda
// `snapshots/by-version/v<N>.json` para que el rollback sea O(1). Con el tiempo esto crece lineal con el número de
// versiones. Este módulo mantiene las últimas `keepLatest` snapshots completas y, de las más viejas, conserva una cada
// `snapshotEveryN` versiones como "milestones" para rollback a época. Las demás se borran.
//
// Se lanza desde el cron `[triggers] crons = ["0 3 * * 0"]` del Worker (domingo 3 AM UTC). Ejecutable también a mano
// desde tests y desde el handler `scheduled` de index.js.

import { VERSION_SNAPSHOT_PREFIX } from './snapshots.js';

/** Extrae el entero N de una clave `snapshots/by-version/v<N>.json`. null si no cuadra. */
export function versionFromKey(key) {
  if (!key.startsWith(VERSION_SNAPSHOT_PREFIX)) return null;
  const rest = key.slice(VERSION_SNAPSHOT_PREFIX.length);
  const match = /^v(\d+)\.json$/.exec(rest);
  if (!match) return null;
  return Number(match[1]);
}

/** Lista TODAS las claves `snapshots/by-version/v<N>.json` del bucket (pagina si hace falta). */
async function listAllVersions(bucket) {
  const versions = [];
  let cursor;
  do {
    const page = await bucket.list({ prefix: VERSION_SNAPSHOT_PREFIX, cursor });
    for (const obj of page.objects ?? []) {
      const n = versionFromKey(obj.key);
      if (n !== null) versions.push(n);
    }
    cursor = page.truncated ? page.cursor : null;
  } while (cursor);
  return versions.sort((a, b) => a - b);
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
    await bucket.delete(`${VERSION_SNAPSHOT_PREFIX}v${v}.json`);
  }
  kept.sort((a, b) => a - b);
  return { kept, pruned };
}
