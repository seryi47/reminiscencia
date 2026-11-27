import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  readStoredCatalogAsync, writeStoredCatalogAsync, clearStoredCatalogAsync,
  migrateFromLocalStorageOnce, isIndexedDbAvailable,
} from '../../frontend/web/js/idb-catalog-store.js';

// Mock minimalista de IndexedDB. Timings con setTimeout(..., 0) para simular que los callbacks de request
// se disparan ANTES de tx.oncomplete (orden real de IDB).
function fakeIDB() {
  const state = { data: new Map(), stores: new Set() };
  return {
    open() {
      const req = {};
      setTimeout(() => {
        const db = {
          objectStoreNames: { contains: (s) => state.stores.has(s) },
          createObjectStore: (s) => state.stores.add(s),
          transaction() {
            const tx = { oncomplete: null, onerror: null, onabort: null };
            let openRequests = 0;
            let schedulingComplete = false;
            const scheduleComplete = () => {
              if (schedulingComplete) return;
              if (openRequests === 0) {
                schedulingComplete = true;
                setTimeout(() => tx.oncomplete?.(), 0);
              }
            };
            const makeReq = (operation) => {
              openRequests += 1;
              const r = {};
              setTimeout(() => {
                try { operation(r); r.onsuccess?.(); }
                finally { openRequests -= 1; scheduleComplete(); }
              }, 0);
              return r;
            };
            const store = {
              get: (key) => makeReq((r) => { r.result = state.data.get(key); }),
              put: (value, key) => makeReq(() => state.data.set(key, value)),
              delete: (key) => makeReq(() => state.data.delete(key)),
            };
            // Si en el próximo tick no hay requests, igualmente cerramos.
            setTimeout(scheduleComplete, 0);
            tx.objectStore = () => store;
            return tx;
          },
          close: () => {},
        };
        req.result = db;
        if (!state.stores.has('catalog')) req.onupgradeneeded?.();
        req.onsuccess?.();
      }, 0);
      return req;
    },
  };
}

describe('idb-catalog-store (ADR-0052)', () => {
  let originalIDB, originalLS;
  beforeEach(() => {
    originalIDB = globalThis.indexedDB;
    originalLS = globalThis.localStorage;
    globalThis.indexedDB = fakeIDB();
  });
  afterEach(() => {
    globalThis.indexedDB = originalIDB;
    globalThis.localStorage = originalLS;
  });

  test('write + read round-trip', async () => {
    const cat = { version: 7, folders: [], songs: [{ id: 'S1', title: 'X' }], updated_at: 't' };
    await writeStoredCatalogAsync(cat);
    const out = await readStoredCatalogAsync();
    assert.equal(out?.version, 7);
    assert.equal(out?.songs[0].id, 'S1');
  });

  test('read sin nada devuelve null', async () => {
    const out = await readStoredCatalogAsync();
    assert.equal(out, null);
  });

  test('clear borra', async () => {
    await writeStoredCatalogAsync({ version: 1, folders: [], songs: [] });
    await clearStoredCatalogAsync();
    const out = await readStoredCatalogAsync();
    assert.equal(out, null);
  });

  test('migración desde localStorage borra la clave vieja', async () => {
    const store = new Map();
    globalThis.localStorage = {
      getItem: (k) => store.get(k) ?? null,
      setItem: (k, v) => store.set(k, v),
      removeItem: (k) => store.delete(k),
    };
    store.set('reminiscencia.catalog.body', JSON.stringify({ version: 3, folders: [], songs: [] }));
    const migrated = await migrateFromLocalStorageOnce('reminiscencia.catalog.body');
    assert.equal(migrated, true);
    assert.equal(store.has('reminiscencia.catalog.body'), false);
    const out = await readStoredCatalogAsync();
    assert.equal(out?.version, 3);
  });

  test('isIndexedDbAvailable refleja el estado global', () => {
    assert.equal(isIndexedDbAvailable(), true);
    globalThis.indexedDB = null;
    assert.equal(isIndexedDbAvailable(), false);
  });
});
