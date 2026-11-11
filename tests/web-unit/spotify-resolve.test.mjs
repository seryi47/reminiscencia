// Pruebas del resolver (ADR-0044): colección de Spotify → coincidencias de YouTube con nivel de confianza, en orden y
// con concurrencia. `searchYoutube` simulado.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { resolveCollection, reresolveTrack, albumOf } from '../../frontend/web/server/spotify-resolve.js';

const track = (title, artist, durationMs) => ({ title, artists: [artist], album: 'Álbum', durationMs });
const cand = (id, title, artist, durationS, source = 'search') =>
  ({ id, url: `https://youtu.be/${id}`, title, artist, durationS, source });

const collection = {
  type: 'playlist', id: 'PL1', name: 'Mi lista', cover: 'p.jpg', artist: null,
  tracks: [
    track('The Scientist', 'Coldplay', 309000),
    track('Clocks', 'Coldplay', 307000),
    track('Nada Encaja', 'Desconocido', 200000),
  ],
};

// Simula la búsqueda de YouTube según la consulta.
const searchYoutube = async (query) => {
  if (query.includes('The Scientist')) {
    return [cand('ok', 'The Scientist - Coldplay (Official Video)', 'Coldplay', 309, 'official'),
      cand('live', 'The Scientist (Live)', 'Coldplay', 345)];
  }
  if (query.includes('Clocks')) {
    return [cand('a', 'Clocks - Coldplay', 'Coldplay', 307, 'official'),
      cand('b', 'Clocks (Official Video) - Coldplay', 'ColdplayVEVO', 308, 'official')];
  }
  return [cand('x', 'Otra cosa totalmente distinta', 'Otro', 123)]; // nada encaja
};

describe('resolveCollection', () => {
  test('resuelve en orden, con tier por pista y resumen', async () => {
    const result = await resolveCollection(collection, { searchYoutube });
    assert.equal(result.type, 'playlist');
    assert.deepEqual(result.album, { id: 'spotify:playlist:PL1', name: 'Mi lista', cover: 'p.jpg', artist: null });
    assert.deepEqual(result.results.map((r) => r.index), [0, 1, 2]); // orden conservado
    assert.equal(result.results[0].tier, 'alta');
    assert.equal(result.results[0].best.candidate.id, 'ok');
    assert.equal(result.results[1].tier, 'alta'); // dos subidas de la misma canción: se autoacepta la primera
    assert.equal(result.results[1].best.candidate.id, 'a');
    assert.equal(result.results[2].tier, 'baja'); // nada encaja
    assert.equal(result.results[2].best, null);
    assert.deepEqual(result.summary, { total: 3, alta: 2, media: 0, baja: 1, error: 0 });
  });

  test('un fallo de búsqueda de una pista no tumba el resto', async () => {
    const flaky = async (query) => {
      if (query.includes('Clocks')) throw new Error('red caída');
      return searchYoutube(query);
    };
    const result = await resolveCollection(collection, { searchYoutube: flaky });
    assert.equal(result.results[1].tier, 'baja');
    assert.match(result.results[1].error, /red caída/);
    assert.equal(result.results[0].tier, 'alta'); // las demás siguen
    assert.equal(result.summary.error, 1);
  });

  test('exige colección y searchYoutube', async () => {
    await assert.rejects(() => resolveCollection(null, { searchYoutube }), /colección/);
    await assert.rejects(() => resolveCollection(collection, {}), /searchYoutube/);
  });
});

describe('albumOf', () => {
  test('playlist y álbum dan una carpeta; una canción suelta, no', () => {
    assert.equal(albumOf({ type: 'album', id: 'A1', name: 'X' }).id, 'spotify:album:A1');
    assert.equal(albumOf({ type: 'playlist', id: 'P1', name: 'Y' }).id, 'spotify:playlist:P1');
    assert.equal(albumOf({ type: 'track', id: 'T1' }), null);
  });
});

describe('reresolveTrack', () => {
  test('puntúa una lista nueva de candidatos (búsqueda manual)', () => {
    const match = reresolveTrack(track('The Scientist', 'Coldplay', 309000), [
      cand('ok', 'The Scientist - Coldplay', 'Coldplay', 309, 'official'),
    ]);
    assert.equal(match.best.candidate.id, 'ok');
  });
});
