// Cache-first del catálogo (ADR-0052). readStoredCatalog / writeStoredCatalog guardan el cuerpo entero en localStorage
// para que la próxima apertura muestre la biblioteca al instante antes incluso de hablar con el Worker.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readStoredCatalog, writeStoredCatalog, BODY_STORAGE_KEY } from '../../frontend/web/js/catalog-remote.js';

function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    _all: () => Object.fromEntries(map),
  };
}

describe('catálogo persistido en localStorage', () => {
  test('tras una escritura, la lectura siguiente devuelve el mismo catálogo', () => {
    const storage = fakeStorage();
    const cat = { version: 7, updated_at: '2026-11-26T00:00:00Z', folders: [{ id: 'F1', name: 'A' }], songs: [{ id: 'S1', title: 'Uno' }] };
    writeStoredCatalog(cat, storage);
    const read = readStoredCatalog(storage);
    assert.equal(read.version, 7);
    assert.equal(read.songs.length, 1);
    assert.equal(read.folders.length, 1);
  });

  test('si no hay nada guardado devuelve null sin lanzar', () => {
    const storage = fakeStorage();
    assert.equal(readStoredCatalog(storage), null);
  });

  test('null borra la entrada y JSON corrupto se trata como ausente', () => {
    const storage = fakeStorage();
    writeStoredCatalog({ version: 1, folders: [], songs: [] }, storage);
    assert.ok(storage.getItem(BODY_STORAGE_KEY));
    writeStoredCatalog(null, storage);
    assert.equal(storage.getItem(BODY_STORAGE_KEY), null);
    // Corrupto: guardamos a mano un JSON basura
    storage.setItem(BODY_STORAGE_KEY, 'basura-no-json');
    assert.equal(readStoredCatalog(storage), null);
  });

  test('un cuerpo demasiado grande no se guarda (corta antes de llenar el storage)', () => {
    const storage = fakeStorage();
    // Genera 4 MB de contenido sintético.
    const bigSongs = Array.from({ length: 4000 }, (_, i) => ({ id: `S${i}`, title: 'x'.repeat(1024), artist: 'a' }));
    const big = { version: 99, folders: [], songs: bigSongs };
    writeStoredCatalog(big, storage);
    // Por encima del umbral: no debe haber escrito el body (se borra también si antes había).
    assert.equal(storage.getItem(BODY_STORAGE_KEY), null);
  });
});
