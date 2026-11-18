import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { matchFingerprint, parseFingerprintIndex, enrichMatch } from '../../frontend/web/server/recognize-core.js';

describe('matchFingerprint', () => {
  test('sin consultas → no match', () => {
    const r = matchFingerprint({ hashes: [], offsets: [] }, {});
    assert.equal(r.matched, false);
    assert.equal(r.confidence, 0);
  });

  test('hashes y offsets de distinta longitud → no match', () => {
    const r = matchFingerprint({ hashes: [1, 2], offsets: [0] }, {});
    assert.equal(r.matched, false);
  });

  test('un fragmento desplazado +100 fotogramas respecto a S1 vota todo con el mismo delta=100', () => {
    const index = {
      1: [{ s: 'S1', o: 100 }, { s: 'S2', o: 500 }],
      2: [{ s: 'S1', o: 101 }, { s: 'S3', o: 20 }],
      3: [{ s: 'S1', o: 102 }],
      4: [{ s: 'S1', o: 103 }, { s: 'S2', o: 600 }],
      5: [{ s: 'S1', o: 104 }],
      6: [{ s: 'S1', o: 105 }],
    };
    const parsed = parseFingerprintIndex(index);
    const query = { hashes: [1, 2, 3, 4, 5, 6], offsets: [0, 1, 2, 3, 4, 5] };
    const r = matchFingerprint(query, parsed, { minVotes: 5 });
    assert.equal(r.matched, true);
    assert.equal(r.songId, 'S1');
    assert.equal(r.votes, 6);
    assert.ok(r.confidence > 0);
  });

  test('sin suficientes votos alineados → no match (umbral minVotes)', () => {
    const index = {
      1: [{ s: 'S1', o: 100 }],
      2: [{ s: 'S1', o: 101 }],
    };
    const parsed = parseFingerprintIndex(index);
    const r = matchFingerprint({ hashes: [1, 2], offsets: [0, 1] }, parsed, { minVotes: 5 });
    assert.equal(r.matched, false);
  });

  test('hits dispersos no ganan al candidato correcto: el delta coherente manda', () => {
    const index = {
      10: [{ s: 'A', o: 50 }, { s: 'B', o: 777 }, { s: 'B', o: 100 }],
      11: [{ s: 'A', o: 51 }, { s: 'B', o: 200 }, { s: 'B', o: 999 }],
      12: [{ s: 'A', o: 52 }, { s: 'B', o: 300 }],
      13: [{ s: 'A', o: 53 }, { s: 'B', o: 400 }],
      14: [{ s: 'A', o: 54 }, { s: 'B', o: 50 }],
    };
    const parsed = parseFingerprintIndex(index);
    const r = matchFingerprint({ hashes: [10, 11, 12, 13, 14], offsets: [0, 1, 2, 3, 4] }, parsed, { minVotes: 5 });
    assert.equal(r.matched, true);
    assert.equal(r.songId, 'A'); // todos los A caen en delta=50; los B dispersos aunque son más entradas, no concentran
  });
});

describe('enrichMatch', () => {
  test('no cambia si no hay match', () => {
    const r = enrichMatch({ matched: false }, { S1: { title: 'x' } });
    assert.equal(r.matched, false);
    assert.equal(r.title, undefined);
  });
  test('añade title/artist cuando hay match y meta', () => {
    const r = enrichMatch({ matched: true, songId: 'S1', confidence: 0.5 }, { S1: { title: 'Canción', artist: 'Grupo' } });
    assert.equal(r.title, 'Canción');
    assert.equal(r.artist, 'Grupo');
  });
  test('tolera falta de meta: title/artist vacíos (nunca null para no romper a los clientes)', () => {
    const r = enrichMatch({ matched: true, songId: 'S1' }, {});
    assert.equal(r.title, '');
    assert.equal(r.artist, '');
  });
});

describe('parseFingerprintIndex', () => {
  test('ignora entradas mal formadas', () => {
    const idx = parseFingerprintIndex({ foo: [], 1: 'bad', 2: [{ s: 'ok', o: 3 }], 3: [{ bad: 1 }] });
    assert.equal(idx.has(1), false);
    assert.deepEqual(idx.get(2), [{ songId: 'ok', offset: 3 }]);
    assert.equal(idx.has(3), false);
  });
});
