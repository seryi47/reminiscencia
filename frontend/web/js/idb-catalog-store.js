// Catálogo persistido en IndexedDB (ADR-0052 ampliación). Mayor capacidad que localStorage (>50 MB típico vs 5 MB) y
// no bloquea el hilo principal. Fallback transparente a localStorage si el navegador no soporta IndexedDB.
//
// API:
//   await readStoredCatalogAsync() → {version, folders, songs, updated_at} | null
//   await writeStoredCatalogAsync(catalog)   → void
//   await clearStoredCatalogAsync()          → void
//   await migrateFromLocalStorageOnce(oldKey) → bool (true si migró algo)

const DB_NAME = 'reminiscencia';
const DB_VERSION = 1;
const STORE_NAME = 'catalog';
const CATALOG_KEY = 'current';

function hasIndexedDB() {
  try { return typeof globalThis.indexedDB !== 'undefined' && globalThis.indexedDB !== null; }
  catch { return false; }
}

function openDb() {
  return new Promise((resolve, reject) => {
    if (!hasIndexedDB()) { reject(new Error('IndexedDB no disponible')); return; }
    const req = globalThis.indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IDB open fail'));
    req.onblocked = () => reject(new Error('IDB bloqueado'));
  });
}

async function withStore(mode, fn) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, mode);
      const store = tx.objectStore(STORE_NAME);
      let result;
      try { result = fn(store); } catch (err) { reject(err); return; }
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error ?? new Error('IDB tx error'));
      tx.onabort = () => reject(tx.error ?? new Error('IDB tx abort'));
    });
  } finally {
    try { db.close(); } catch { /* nada */ }
  }
}

function getKey(store) {
  return new Promise((resolve, reject) => {
    const req = store.get(CATALOG_KEY);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

/** Lee el catálogo de IndexedDB. Si falla o no hay, devuelve null. */
export async function readStoredCatalogAsync() {
  if (!hasIndexedDB()) return null;
  try {
    const value = await withStore('readonly', (store) => getKey(store));
    const parsed = await value;
    if (!parsed || typeof parsed !== 'object') return null;
    if (!Array.isArray(parsed.folders) || !Array.isArray(parsed.songs)) return null;
    if (typeof parsed.version !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Guarda el catálogo en IndexedDB. null borra. Idempotente: no lanza si hay error. */
export async function writeStoredCatalogAsync(catalog) {
  if (!hasIndexedDB()) return;
  try {
    await withStore('readwrite', (store) => {
      if (catalog === null || catalog === undefined) {
        store.delete(CATALOG_KEY);
      } else {
        store.put(catalog, CATALOG_KEY);
      }
    });
  } catch {
    // Quota lleno o navegador raro: no pasa nada, la red seguirá sirviendo.
  }
}

/** Borra el catálogo guardado. */
export async function clearStoredCatalogAsync() {
  await writeStoredCatalogAsync(null);
}

/** Migra lo que haya en localStorage[oldKey] a IndexedDB (una vez), después borra localStorage[oldKey].
 *  Devuelve true si migró algo utilizable. Idempotente. */
export async function migrateFromLocalStorageOnce(oldKey) {
  if (!hasIndexedDB()) return false;
  let storage = null;
  try { storage = globalThis.localStorage; } catch { return false; }
  if (!storage) return false;
  let raw;
  try { raw = storage.getItem(oldKey); } catch { return false; }
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.folders) && Array.isArray(parsed.songs) && typeof parsed.version === 'number') {
      await writeStoredCatalogAsync(parsed);
      try { storage.removeItem(oldKey); } catch { /* nada */ }
      return true;
    }
  } catch { /* nada */ }
  try { storage.removeItem(oldKey); } catch { /* nada */ }
  return false;
}

/** ¿Está disponible IndexedDB? Útil para tests y para la capa cliente que decide si entrar en el fallback. */
export function isIndexedDbAvailable() {
  return hasIndexedDB();
}
