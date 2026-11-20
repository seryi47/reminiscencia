import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { handleRecognizeRequest } from '../../frontend/web/server/recognize-endpoint.js';

/** Mock de D1 mínimo: prepare → bind → all / first + batch(). Soporta la unión con songs como el endpoint real. */
function mockDb({ hashes = [], songs = [] } = {}) {
  const songById = Object.fromEntries(songs.map((s) => [s.id, s]));
  const runStmt = async (sql, bound) => {
    if (/FROM hashes h JOIN songs s|FROM hashes h\s*JOIN songs s|FROM hashes WHERE hash IN/i.test(sql)) {
      const needles = new Set(bound.map((v) => Number(v)));
      const results = hashes
        .filter((h) => needles.has(h.hash))
        .map((h) => {
          const song = songById[h.song_id] ?? {};
          return { hash: h.hash, song_id: h.song_id, offset: h.offset, title: song.title ?? '', artist: song.artist ?? '' };
        });
      return { results };
    }
    return { results: [] };
  };
  return {
    prepare(sql) {
      let bound = [];
      return {
        bind(...values) { bound = values; return this; },
        async all() { return runStmt(sql, bound); },
        async first() {
          if (/FROM songs WHERE id/i.test(sql)) {
            const found = songById[String(bound[0])];
            return found ? { id: found.id, title: found.title, artist: found.artist } : null;
          }
          return null;
        },
        _sql: sql, _bound: () => bound,
      };
    },
    async batch(stmts) {
      // En el endpoint real, cada stmt lleva su propio sql y bound tras `.bind()`. En el mock devolvemos lo mismo que
      // haría llamar a `.all()` sobre cada uno (el endpoint prepara y hace bind antes de meterlos al array).
      return Promise.all(stmts.map((s) => runStmt(s._sql, s._bound())));
    },
  };
}

function req({ v = 1, hashes, offsets }) {
  return new Request('https://x/api/recognize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ v, hashes, offsets }),
  });
}

describe('handleRecognizeRequest con D1 simulado', () => {
  test('sin binding D1 → 200 matched:false reason:db_not_ready', async () => {
    const res = await handleRecognizeRequest(req({ hashes: [1, 2], offsets: [0, 1] }), { env: {} });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.matched, false);
    assert.equal(data.reason, 'db_not_ready');
  });

  test('método ≠ POST → 405', async () => {
    const r = new Request('https://x/api/recognize', { method: 'GET' });
    const res = await handleRecognizeRequest(r, { env: { RECOGNIZE_DB: mockDb() } });
    assert.equal(res.status, 405);
  });

  test('cuerpo no JSON → 400', async () => {
    const r = new Request('https://x/api/recognize', { method: 'POST', body: 'no json' });
    const res = await handleRecognizeRequest(r, { env: { RECOGNIZE_DB: mockDb() } });
    assert.equal(res.status, 400);
  });

  test('cuerpo inválido (sin hashes) → 400', async () => {
    const res = await handleRecognizeRequest(req({ hashes: [1], offsets: [0, 1] }), { env: { RECOGNIZE_DB: mockDb() } });
    assert.equal(res.status, 400);
  });

  test('match: 80 hashes con delta coherente para S1 → 200 matched:true, con title/artist de songs', async () => {
    // Umbral subido a 60 votos + ratio 1.5× y share 5 % para evitar falsos positivos con base D1 ruidosa. Un match sano
    // tiene cientos de votos alineados en un único delta; los falsos positivos en vivo tenían 26–45 votos repartidos.
    const dbHashes = [];
    for (let i = 10; i < 90; i++) dbHashes.push({ hash: i, song_id: 'S1', offset: i + 90 });
    dbHashes.push({ hash: 10, song_id: 'S2', offset: 500 });
    const db = mockDb({ hashes: dbHashes, songs: [{ id: 'S1', title: 'La Raíz', artist: 'La Raíz' }] });
    const res = await handleRecognizeRequest(
      req({
        hashes: Array.from({ length: 80 }, (_, i) => 10 + i),
        offsets: Array.from({ length: 80 }, (_, i) => i),
      }),
      { env: { RECOGNIZE_DB: db } },
    );
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.matched, true);
    assert.equal(data.songId, 'S1');
    assert.equal(data.title, 'La Raíz');
    assert.equal(data.artist, 'La Raíz');
  });

  test('26 vs 24 votos (patrón real de falso positivo) → 200 matched:false (ratio insuficiente)', async () => {
    // Replica el síntoma medido en producción el 2026-11-20: la canción falsa ganaba por 2 votos sobre la correcta.
    const dbHashes = [];
    // 26 hashes de S1 con delta 10
    for (let i = 0; i < 26; i++) dbHashes.push({ hash: i, song_id: 'S1', offset: i + 10 });
    // 24 hashes de S2 con delta 100 (reparte igual de bien que S1 pero con distinto delta)
    for (let i = 0; i < 24; i++) dbHashes.push({ hash: i, song_id: 'S2', offset: i + 100 });
    // Rellenamos con ruido para que share quede bajo
    const db = mockDb({ hashes: dbHashes, songs: [{ id: 'S1', title: 'X', artist: 'X' }] });
    const res = await handleRecognizeRequest(
      req({
        hashes: Array.from({ length: 1200 }, (_, i) => i < 26 ? i : 99999 + i),
        offsets: Array.from({ length: 1200 }, (_, i) => i),
      }),
      { env: { RECOGNIZE_DB: db } },
    );
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.matched, false, 'ratio 26/24=1.08 < 1.5 → no reconocido');
  });

  test('sin votos suficientes → 200 matched:false sin reason', async () => {
    const db = mockDb({ hashes: [{ hash: 1, song_id: 'S1', offset: 0 }] });
    const res = await handleRecognizeRequest(
      req({ hashes: [1, 2, 3], offsets: [0, 1, 2] }),
      { env: { RECOGNIZE_DB: db } },
    );
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.matched, false);
  });

  test('tope de hashes por consulta → 413', async () => {
    const hashes = new Array(60001).fill(1);
    const offsets = new Array(60001).fill(0);
    const res = await handleRecognizeRequest(req({ hashes, offsets }), { env: { RECOGNIZE_DB: mockDb() } });
    assert.equal(res.status, 413);
  });

  test('con >MAX_UNIQUE_HASHES hashes únicos, solo busca los primeros 1200 en D1 (cap de subrequests Workers)', async () => {
    // Replica el caso real del 2026-11-19: el cliente envía ~6000 hashes únicos → el Worker hacía 65 queries D1 y
    // devolvía 503 «exceeded resource limits». El cap de ~50 subrequests del plan gratuito obliga a limitar.
    let d1Calls = 0;
    const songRows = [];
    const total = 4500;
    for (let i = 1; i <= total; i++) songRows.push({ hash: i, song_id: 'S9', offset: 100 + i });
    const songs = [{ id: 'S9', title: 'Nueve', artist: 'A' }];
    const baseDb = mockDb({ hashes: songRows, songs });
    const db = {
      ...baseDb,
      prepare(sql) {
        if (/FROM hashes WHERE hash IN/i.test(sql)) d1Calls++;
        return baseDb.prepare(sql);
      },
    };
    const hashes = Array.from({ length: total }, (_, i) => i + 1);
    const offsets = Array.from({ length: total }, (_, i) => i);
    const res = await handleRecognizeRequest(req({ hashes, offsets }), { env: { RECOGNIZE_DB: db } });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.matched, true);
    assert.equal(body.songId, 'S9');
    // 2000 hashes únicos / 100 por batch = 20 queries (+1 para songs). Muy por debajo del cap.
    assert.ok(d1Calls <= 15, `queries D1 (${d1Calls}) deben ≤ 25 para respetar el cap de Workers`);
    assert.equal(d1Calls, 12);
  });
});
