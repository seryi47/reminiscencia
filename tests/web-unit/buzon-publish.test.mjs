// Pruebas del endpoint del buzón publicando por el Worker (ADR-0052). fetchImpl inyectado.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { BUZON_PATH, sendBuzonPublish } from '../../frontend/web/js/catalog-remote.js';

describe('sendBuzonPublish', () => {
  test('manda songs + if_match al endpoint correcto', async () => {
    let seen;
    const fetchImpl = async (path, init) => {
      seen = { path, body: JSON.parse(init.body) };
      return new Response(JSON.stringify({ ok: true, version: 11, event: { kind: 'buzon' } }), { status: 200 });
    };
    const authorizedFetch = (path, init) => fetchImpl(path, init);
    const songs = [
      { sha256: 'a'.repeat(64), title: 'Uno', artist: 'A' },
      { sha256: 'b'.repeat(64), title: 'Dos', artist: 'B' },
    ];
    const result = await sendBuzonPublish({ songs, ifMatch: 10 }, { authorizedFetch });
    assert.equal(seen.path, BUZON_PATH);
    assert.deepEqual(seen.body, { songs, if_match: 10 });
    assert.equal(result.version, 11);
    assert.equal(result.event.kind, 'buzon');
  });

  test('un 412 se reintenta tras recargar la versión actual', async () => {
    let calls = 0;
    const authorizedFetch = async (_path, init) => {
      calls += 1;
      const body = JSON.parse(init.body);
      if (calls === 1) {
        assert.equal(body.if_match, 10);
        return new Response(JSON.stringify({ ok: false, error: 'conflicto', current_version: 12 }), { status: 412 });
      }
      assert.equal(body.if_match, 12);
      return new Response(JSON.stringify({ ok: true, version: 13 }), { status: 200 });
    };
    const result = await sendBuzonPublish(
      { songs: [{ sha256: 'a'.repeat(64), title: 'X', artist: 'Y' }], ifMatch: 10 },
      { authorizedFetch, reloadLatest: async () => ({ version: 12 }) },
    );
    assert.equal(result.version, 13);
    assert.equal(calls, 2);
  });
});
