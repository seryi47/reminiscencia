import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { editDistance, filterSongs, fuzzyScore } from '../../frontend/web/js/catalog.js';

const songs = [
  { id: 'a', title: 'SUPERSTARS', artist: 'Kidd Keo' },
  { id: 'b', title: 'Olvídate', artist: 'Kidd Keo' },
  { id: 'c', title: 'Charleston', artist: 'Orquesta' },
];

describe('búsqueda tolerante', () => {
  test('distancia de edición con letras intercambiadas', () => {
    assert.equal(editDistance('keo', 'keo'), 0);
    assert.equal(editDistance('kid', 'kidd'), 1);
    assert.equal(editDistance('keo', 'koe'), 1);
  });

  test('«kid keo» encuentra «Kidd Keo»', () => {
    assert.ok(fuzzyScore('SUPERSTARS Kidd Keo', 'kid keo') > 0);
  });

  test('perdona una errata en palabras de 4 o más letras y no en las cortas', () => {
    assert.ok(fuzzyScore('Charleston Orquesta', 'charlston') > 0);
    assert.ok(fuzzyScore('Charleston Orquesta', 'orqeusta') > 0);
    assert.equal(fuzzyScore('Charleston Orquesta', 'xyz'), 0);
    assert.equal(fuzzyScore('Kidd Keo', 'kxo'), 0);
  });

  test('todas las palabras deben coincidir', () => {
    assert.equal(fuzzyScore('Kidd Keo', 'kid pepe'), 0);
  });

  test('filterSongs filtra por título, artista y álbum y conserva el orden', () => {
    assert.deepEqual(filterSongs(songs, 'kid keo').map((s) => s.id), ['a', 'b']);
    assert.deepEqual(filterSongs(songs, 'olvidate').map((s) => s.id), ['b']);
    assert.deepEqual(filterSongs(songs, 'jazz', (s) => (s.id === 'c' ? 'Jazz antiguo' : '')).map((s) => s.id), ['c']);
    assert.equal(filterSongs(songs, '  '), songs);
    assert.deepEqual(filterSongs(songs, 'zzzzzz'), []);
  });
});
