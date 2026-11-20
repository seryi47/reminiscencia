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

  test('ratio top1/top2: si ambas tienen votos parecidos (26 vs 24) rechaza — era el patrón de los falsos positivos en vivo', () => {
    // top1 vota 10, top2 vota 9 → ratio 1.11. Con minRatio 1.5 rechaza aunque supere minVotes.
    const index = {
      1: [{ s: 'A', o: 0 }, { s: 'B', o: 0 }],
      2: [{ s: 'A', o: 1 }, { s: 'B', o: 1 }],
      3: [{ s: 'A', o: 2 }, { s: 'B', o: 2 }],
      4: [{ s: 'A', o: 3 }, { s: 'B', o: 3 }],
      5: [{ s: 'A', o: 4 }, { s: 'B', o: 4 }],
      6: [{ s: 'A', o: 5 }, { s: 'B', o: 5 }],
      7: [{ s: 'A', o: 6 }, { s: 'B', o: 6 }],
      8: [{ s: 'A', o: 7 }, { s: 'B', o: 7 }],
      9: [{ s: 'A', o: 8 }, { s: 'B', o: 8 }],
      10: [{ s: 'A', o: 9 }],
    };
    const parsed = parseFingerprintIndex(index);
    const q = { hashes: [1,2,3,4,5,6,7,8,9,10], offsets: [0,0,0,0,0,0,0,0,0,0] };
    const r = matchFingerprint(q, parsed, { minVotes: 5, minRatio: 1.5 });
    assert.equal(r.matched, false, 'top1 (A=10) vs top2 (B=9): ratio 1.11 < 1.5 → no match');
  });

  test('ratio top1/top2 suficiente sí matchea (top1 duplica top2)', () => {
    const index = {
      1: [{ s: 'A', o: 0 }, { s: 'B', o: 100 }],
      2: [{ s: 'A', o: 1 }],
      3: [{ s: 'A', o: 2 }],
      4: [{ s: 'A', o: 3 }],
      5: [{ s: 'A', o: 4 }, { s: 'B', o: 999 }],
      6: [{ s: 'A', o: 5 }],
    };
    const parsed = parseFingerprintIndex(index);
    const q = { hashes: [1,2,3,4,5,6], offsets: [0,1,2,3,4,5] };
    const r = matchFingerprint(q, parsed, { minVotes: 3, minRatio: 1.5 });
    assert.equal(r.matched, true);
    assert.equal(r.songId, 'A');
  });

  test('share bajo rechaza: 40 votos sobre 1200 hashes (3,3 %) es ruido', () => {
    // Fabricamos un escenario con top1 muy por debajo del 5 % del total.
    const hits = [];
    for (let i = 0; i < 40; i++) hits.push({ s: 'X', o: i });
    const index = { 1: hits };
    const parsed = parseFingerprintIndex(index);
    // Query con 1200 hashes, de los cuales solo el primero vota; el resto no está en el índice.
    const qh = new Array(1200).fill(0).map((_, i) => i === 0 ? 1 : 9000 + i);
    const qo = new Array(1200).fill(0).map((_, i) => i);
    const r = matchFingerprint({ hashes: qh, offsets: qo }, parsed, { minVotes: 10, minRatio: 1, minShare: 0.05 });
    assert.equal(r.matched, false, 'solo 1 voto no alcanza share 5 %');
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
