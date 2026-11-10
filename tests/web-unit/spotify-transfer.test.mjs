// Pruebas de la lógica de cliente de «Transferir música» (ADR-0044), sin DOM: sesión, API (401 → needsAuth), resolución
// por páginas con refresco de token, dedup y selección.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  readSession, writeSession, clearSession, isConnected, createTransferApi, beginConnect,
  resolveCollection, markDuplicates, selectedTracks, SESSION_KEY, PKCE_KEY,
} from '../../frontend/web/js/spotify-transfer.js';

const fakeStorage = () => {
  const map = new Map();
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k) };
};
const okRes = (status, data) => ({ ok: status >= 200 && status < 300, status, json: async () => data });

describe('sesión', () => {
  test('escribe, lee y borra; isConnected', () => {
    const s = fakeStorage();
    assert.equal(isConnected(s), false);
    writeSession({ accessToken: 'AT', refreshToken: 'RT', expiresAt: 1 }, s);
    assert.equal(readSession(s).accessToken, 'AT');
    assert.equal(isConnected(s), true);
    clearSession(s);
    assert.equal(readSession(s), null);
  });
});

describe('createTransferApi', () => {
  test('401 o needsAuth se convierte en error con needsAuth', async () => {
    const api = createTransferApi(async () => okRes(401, { error: 'caducado' }));
    await assert.rejects(() => api.resolve({ url: 'u', accessToken: 'x' }), (e) => e.needsAuth === true);
  });
  test('llama a los endpoints correctos', async () => {
    const calls = [];
    const api = createTransferApi(async (path, init) => { calls.push([path, JSON.parse(init.body)]); return okRes(200, { ok: true }); });
    await api.token('C', 'V');
    await api.resolve({ url: 'u', accessToken: 'AT', offset: 0, limit: 25 });
    assert.deepEqual(calls[0], ['/api/spotify/token', { code: 'C', verifier: 'V' }]);
    assert.equal(calls[1][0], '/api/spotify/resolve');
  });
});

describe('beginConnect', () => {
  test('guarda verifier+state y devuelve la URL', async () => {
    const pkce = fakeStorage();
    const api = { login: async () => ({ url: 'https://accounts.spotify.com/authorize?x', verifier: 'V', state: 'S' }) };
    const url = await beginConnect({ api, returnTo: '/#transferir', pkceStore: pkce });
    assert.match(url, /authorize/);
    assert.deepEqual(JSON.parse(pkce.getItem(PKCE_KEY)), { verifier: 'V', state: 'S', returnTo: '/#transferir' });
  });
});

describe('resolveCollection', () => {
  // `tierList` da el tier de cada pista de la página; los índices son secuenciales desde `offset`.
  const page = (offset, hasMore, tierList) => {
    const results = tierList.map((tier, i) => ({
      index: offset + i, tier, best: tier === 'baja' ? null : { candidate: { url: `u${offset + i}` } },
      track: { title: `T${offset + i}`, artists: ['A'] },
    }));
    const summary = {};
    for (const t of ['alta', 'media', 'baja', 'error']) summary[t] = tierList.filter((x) => x === t).length;
    return { album: { id: 'spotify:playlist:P', name: 'Lista' }, total: 4, hasMore, summary, results };
  };

  test('acumula páginas en orden y suma el resumen', async () => {
    const storage = fakeStorage();
    writeSession({ accessToken: 'AT', refreshToken: 'RT', expiresAt: Date.now() + 3_600_000 }, storage);
    let call = 0;
    const api = { resolve: async ({ offset }) => { call += 1; return offset === 0 ? page(0, true, ['alta', 'alta']) : page(2, false, ['media', 'baja']); } };
    const out = await resolveCollection({ api, url: 'spotify:playlist:P', storage, pageLimit: 2 });
    assert.equal(call, 2);
    assert.equal(out.total, 4);
    assert.deepEqual(out.results.map((r) => r.index), [0, 1, 2, 3]);
    assert.deepEqual(out.summary, { total: 4, alta: 2, media: 1, baja: 1, error: 0 });
    assert.equal(out.album.id, 'spotify:playlist:P');
  });

  test('refresca el token y reintenta si caduca a mitad', async () => {
    const storage = fakeStorage();
    writeSession({ accessToken: 'OLD', refreshToken: 'RT', expiresAt: Date.now() + 3_600_000 }, storage);
    let refreshed = false;
    let threw = false;
    const api = {
      refresh: async () => { refreshed = true; return { accessToken: 'NEW', refreshToken: 'RT2', expiresAt: Date.now() + 3_600_000 }; },
      resolve: async ({ accessToken }) => {
        if (accessToken === 'OLD' && !threw) { threw = true; throw Object.assign(new Error('x'), { needsAuth: true }); }
        return page(0, false, ['alta']);
      },
    };
    const out = await resolveCollection({ api, url: 'u', storage });
    assert.ok(refreshed);
    assert.equal(readSession(storage).accessToken, 'NEW');
    assert.equal(out.results.length, 1);
  });

  test('sin sesión lanza needsAuth', async () => {
    await assert.rejects(() => resolveCollection({ api: {}, url: 'u', storage: fakeStorage() }), (e) => e.needsAuth === true);
  });
});

describe('markDuplicates / selectedTracks', () => {
  const makeResults = () => ([
    { index: 0, tier: 'alta', best: { candidate: { url: 'u0' } }, track: { title: 'Uno', artists: ['A'], durationMs: 200000 } },
    { index: 1, tier: 'media', best: { candidate: { url: 'u1' } }, alternatives: [{ candidate: { url: 'alt1' } }], track: { title: 'Dos', artists: ['A'], durationMs: 201000 } },
    { index: 2, tier: 'baja', best: null, track: { title: 'Tres', artists: ['A'], durationMs: 202000 } },
    { index: 3, tier: 'alta', best: { candidate: { url: 'u3' } }, track: { title: 'YaEstá', artists: ['A'], durationMs: 203000 } },
  ]);

  test('marca las que ya están en la biblioteca', () => {
    const results = markDuplicates(makeResults(), [{ title: 'YaEstá', artist: 'A', durationS: 203 }]);
    assert.equal(results[3].inLibrary, true);
    assert.equal(results[0].inLibrary, false);
  });

  test('alta se acepta sola; media/baja solo con override; se saltan excluidas y las de biblioteca', () => {
    const results = markDuplicates(makeResults(), [{ title: 'YaEstá', artist: 'A', durationS: 203 }]);
    const chosen = selectedTracks(results, {
      excluded: new Set([0]), // el usuario quitó la 0
      overrides: new Map([[1, { candidate: { url: 'alt1' } }]]), // eligió una alternativa para la 1
    });
    // 0 excluida, 1 por override, 2 baja sin override (fuera), 3 inLibrary (fuera)
    assert.deepEqual(chosen.map((t) => [t.index, t.url]), [[1, 'alt1']]);
  });

  test('sin exclusiones, las de confianza alta entran solas', () => {
    const chosen = selectedTracks(makeResults()); // ninguna marcada inLibrary
    assert.deepEqual(chosen.map((t) => t.index), [0, 3]);
  });
});
