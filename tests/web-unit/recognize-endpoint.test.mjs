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

  test('match: 6 hashes con delta coherente para S1 → 200 matched:true, con title/artist de songs', async () => {
    const db = mockDb({
      hashes: [
        { hash: 10, song_id: 'S1', offset: 100 },
        { hash: 11, song_id: 'S1', offset: 101 },
        { hash: 12, song_id: 'S1', offset: 102 },
        { hash: 13, song_id: 'S1', offset: 103 },
        { hash: 14, song_id: 'S1', offset: 104 },
        { hash: 15, song_id: 'S1', offset: 105 },
        { hash: 10, song_id: 'S2', offset: 500 },
      ],
      songs: [{ id: 'S1', title: 'La Raíz', artist: 'La Raíz' }],
    });
    const res = await handleRecognizeRequest(
      req({ hashes: [10, 11, 12, 13, 14, 15], offsets: [0, 1, 2, 3, 4, 5] }),
      { env: { RECOGNIZE_DB: db } },
    );
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.matched, true);
    assert.equal(data.songId, 'S1');
    assert.equal(data.title, 'La Raíz');
    assert.equal(data.artist, 'La Raíz');
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
});
