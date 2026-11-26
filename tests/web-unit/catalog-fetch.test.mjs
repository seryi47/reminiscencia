// Pruebas de la lectura del catálogo contra el Worker (frontend/web/js/catalog-remote.js, ADR-0052). Solo fetchImpl
// inyectado — no toca red ni DOM.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  CATALOG_PATH,
  fetchHistorial,
  fetchLatestCatalog,
  parseVersionEtag,
  readStoredEtag,
  writeStoredEtag,
} from '../../frontend/web/js/catalog-remote.js';

function makeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    _map: map,
  };
}

const okCatalog = () => ({
  version: 3,
  updated_at: '2026-11-26T12:00:00Z',
  folders: [{ id: 'F000000000000001', name: 'Álbum', parent_id: null }],
  songs: [{ id: 'S000000000000001', title: 'X', folder_id: 'F000000000000001' }],
});

describe('catalog-remote fetch', () => {
  test('parseVersionEtag solo acepta W/"v<N>"', () => {
    assert.equal(parseVersionEtag('W/"v3"'), 3);
    assert.equal(parseVersionEtag('v3'), null);
    assert.equal(parseVersionEtag(null), null);
  });

  test('fetchLatestCatalog: 200 → devuelve catálogo + ETag; sin If-None-Match', async () => {
    let seen;
    const fetchImpl = async (path, init) => {
      seen = { path, init };
      return new Response(JSON.stringify(okCatalog()), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ETag: 'W/"v3"' },
      });
    };
    const { catalog, etag, status, notModified } = await fetchLatestCatalog({ fetchImpl });
    assert.equal(seen.path, CATALOG_PATH);
    assert.equal(seen.init.cache, 'no-store');
    assert.equal(seen.init.headers['If-None-Match'], undefined);
    assert.equal(status, 200);
    assert.equal(etag, 'W/"v3"');
    assert.equal(notModified, undefined);
    assert.equal(catalog.version, 3);
    assert.equal(catalog.songs.length, 1);
    assert.equal(catalog.folders.length, 1);
  });

  test('fetchLatestCatalog: con etag previo manda If-None-Match', async () => {
    let headers;
    const fetchImpl = async (_path, init) => {
      headers = init.headers;
      return new Response(JSON.stringify(okCatalog()), { status: 200, headers: { ETag: 'W/"v3"' } });
    };
    await fetchLatestCatalog({ fetchImpl, etag: 'W/"v2"' });
    assert.equal(headers['If-None-Match'], 'W/"v2"');
  });

  test('fetchLatestCatalog: 304 → devuelve notModified con el etag refrescado', async () => {
    const fetchImpl = async () => new Response(null, { status: 304, headers: { ETag: 'W/"v2"' } });
    const result = await fetchLatestCatalog({ fetchImpl, etag: 'W/"v2"' });
    assert.equal(result.notModified, true);
    assert.equal(result.catalog, null);
    assert.equal(result.etag, 'W/"v2"');
    assert.equal(result.status, 304);
  });

  test('fetchLatestCatalog: 503 → marcador notMigrated con catálogo vacío', async () => {
    const fetchImpl = async () => new Response(JSON.stringify({ ok: false, error: 'catálogo no migrado' }), { status: 503 });
    const { catalog, notMigrated, status } = await fetchLatestCatalog({ fetchImpl });
    assert.equal(status, 503);
    assert.equal(notMigrated, true);
    assert.equal(catalog.version, 0);
    assert.deepEqual(catalog.songs, []);
    assert.deepEqual(catalog.folders, []);
  });

  test('fetchLatestCatalog: red caída lanza mensaje en español', async () => {
    const fetchImpl = async () => { throw new TypeError('fetch failed'); };
    await assert.rejects(fetchLatestCatalog({ fetchImpl }), /No se ha podido conectar/);
  });

  test('fetchLatestCatalog: respuesta sin arrays songs/folders se rechaza', async () => {
    const fetchImpl = async () => new Response(JSON.stringify({ version: 1 }), { status: 200 });
    await assert.rejects(fetchLatestCatalog({ fetchImpl }), /formato esperado/);
  });

  test('readStoredEtag / writeStoredEtag usan localStorage con la clave reservada', () => {
    const storage = makeStorage();
    assert.equal(readStoredEtag(storage), null);
    writeStoredEtag('W/"v5"', storage);
    assert.equal(readStoredEtag(storage), 'W/"v5"');
    writeStoredEtag(null, storage);
    assert.equal(readStoredEtag(storage), null);
  });

  test('fetchHistorial pide /api/catalogo/historial con límite en la query', async () => {
    let path;
    const fetchImpl = async (p) => {
      path = p;
      return new Response(JSON.stringify({ ok: true, events: [{ id: 1 }], limit: 10 }), { status: 200 });
    };
    const { events, limit } = await fetchHistorial({ fetchImpl, limit: 10 });
    assert.equal(path, '/api/catalogo/historial?limit=10');
    assert.equal(events.length, 1);
    assert.equal(limit, 10);
  });
});
