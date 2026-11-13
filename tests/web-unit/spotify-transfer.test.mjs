// Pruebas de la lógica de cliente de «Transferir música» (ADR-0044), sin DOM: sesión, API (401 → needsAuth), resolución
// por páginas con refresco de token, dedup y selección.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  readSession, writeSession, clearSession, isConnected, createTransferApi, beginConnect,
  resolveCollection, listLibrary, markDuplicates, selectedTracks, buildTransferPlan, transferStats, compareCollection,
  transferTrackKey, SESSION_KEY, PKCE_KEY,
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
    return { album: { id: 'spotify_playlist_P', name: 'Lista' }, total: 4, hasMore, summary, results };
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
    assert.equal(out.album.id, 'spotify_playlist_P');
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

describe('listLibrary', () => {
  test('devuelve la biblioteca (playlists + Me gusta)', async () => {
    const storage = fakeStorage();
    writeSession({ accessToken: 'AT', refreshToken: 'RT', expiresAt: Date.now() + 3_600_000 }, storage);
    const api = { mine: async (token) => ({ playlists: [{ id: 'p1', name: 'X', total: 1 }], liked: 2, token }) };
    const lib = await listLibrary({ api, storage });
    assert.equal(lib.liked, 2);
    assert.equal(lib.playlists[0].name, 'X');
  });

  test('refresca el token si está caducado', async () => {
    const storage = fakeStorage();
    writeSession({ accessToken: 'OLD', refreshToken: 'RT', expiresAt: Date.now() - 1 }, storage); // caducado
    const api = {
      refresh: async () => ({ accessToken: 'NEW', refreshToken: 'RT', expiresAt: Date.now() + 3_600_000 }),
      mine: async (token) => ({ playlists: [], liked: 0, token }),
    };
    const lib = await listLibrary({ api, storage });
    assert.equal(lib.token, 'NEW');
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

  test('detecta el duplicado por título+artista aunque la duración difiera mucho', () => {
    const results = markDuplicates(makeResults(), [{ title: 'Uno', artist: 'A', durationS: 240 }]); // +40 s
    assert.equal(results[0].inLibrary, true); // «Uno» de «A» ya está, aunque dure distinto
  });

  test('buildTransferPlan no repite una misma canción entre colecciones ni dentro de la tanda', () => {
    const mk = (index, title, url) => ({ index, tier: 'alta', best: { candidate: { url } }, track: { title, artists: ['A'], durationMs: 200000 } });
    const colA = { album: { id: 'a' }, results: [mk(0, 'Song X', 'x')], excluded: new Set(), overrides: new Map() };
    const colB = { album: { id: 'b' }, results: [mk(0, 'Song X', 'x2'), mk(1, 'Otra', 'o')], excluded: new Set(), overrides: new Map() };
    const plan = buildTransferPlan([colA, colB]);
    assert.deepEqual(plan.map((p) => p.tracks.map((t) => t.title)), [['Song X'], ['Otra']]); // Song X no se repite en colB
  });

  test('las excluidas, las duplicadas y las de baja-sin-elección quedan fuera; el override manda', () => {
    const results = markDuplicates(makeResults(), [{ title: 'YaEstá', artist: 'A', durationS: 203 }]);
    const chosen = selectedTracks(results, {
      excluded: new Set([0]), // el usuario quitó la 0 (alta)
      overrides: new Map([[1, { candidate: { url: 'alt1' } }]]), // eligió una alternativa para la 1 (media)
    });
    // 0 excluida, 1 por override, 2 baja sin candidato (fuera), 3 inLibrary (fuera)
    assert.deepEqual(chosen.map((t) => [t.index, t.url]), [[1, 'alt1']]);
  });

  test('alta y media entran solas con la mejor pre-elegida; la baja no (sin elección)', () => {
    const chosen = selectedTracks(makeResults()); // ninguna marcada inLibrary ni excluida
    // 0 alta (u0), 1 media (u1, su mejor), 3 alta (u3); la 2 es baja (best null) y queda fuera
    assert.deepEqual(chosen.map((t) => [t.index, t.url]), [[0, 'u0'], [1, 'u1'], [3, 'u3']]);
  });
});

describe('compareCollection (comparación al abrir, sin resolver YouTube)', () => {
  const comparePage = (titles) => ({
    album: { id: 'spotify_album_A', name: 'Álbum' }, total: titles.length, hasMore: false,
    summary: { total: titles.length, baja: titles.length }, // compareOnly: todo «baja», sin best
    results: titles.map((t, i) => ({ index: i, tier: 'baja', best: null, track: { title: t, artists: ['A'] } })),
  });

  test('cuenta total/tengo/faltan comparando con la biblioteca y pide compareOnly', async () => {
    const storage = fakeStorage();
    writeSession({ accessToken: 'AT', refreshToken: 'RT', expiresAt: Date.now() + 3_600_000 }, storage);
    let askedCompareOnly = false;
    const api = { resolve: async (params) => { askedCompareOnly = params.compareOnly === true; return comparePage(['Uno', 'Dos', 'Tres']); } };
    const out = await compareCollection({ api, ref: { type: 'album', id: 'A' }, storage, songs: [{ title: 'Uno', artist: 'A', durationS: 200 }] });
    assert.ok(askedCompareOnly, 'pide compareOnly (no resuelve YouTube)');
    assert.deepEqual([out.total, out.have, out.missing], [3, 1, 2]);
  });

  test('el conjunto «owned» (recién transferidas, aún sin publicar) cuenta como que ya la tienes', async () => {
    const storage = fakeStorage();
    writeSession({ accessToken: 'AT', refreshToken: 'RT', expiresAt: Date.now() + 3_600_000 }, storage);
    const api = { resolve: async () => comparePage(['Uno', 'Dos']) };
    const owned = new Set([transferTrackKey({ title: 'Dos', artists: ['A'] })]);
    const out = await compareCollection({ api, ref: { type: 'album', id: 'A' }, storage, songs: [], owned });
    assert.deepEqual([out.total, out.have, out.missing], [2, 1, 1]);
  });
});

describe('transferStats (contador total/tengo/faltan)', () => {
  const res = (title, inLibrary) => ({ track: { title, artists: ['A'] }, inLibrary });

  test('por álbum da total, cuántas tienes y cuántas faltan (ejemplo del usuario: 15, 11, 4)', () => {
    const results = [];
    for (let i = 0; i < 15; i += 1) results.push(res(`Tema ${i}`, i < 11));
    const stats = transferStats([{ name: 'Mi álbum', results }]);
    assert.deepEqual(stats.perAlbum, [{ name: 'Mi álbum', total: 15, have: 11, missing: 4 }]);
    assert.equal(stats.uniqueMissing, 4);
    assert.equal(stats.totalHave, 11);
  });

  test('el total global de «faltan» no cuenta dos veces la misma canción en dos listas', () => {
    const colA = { name: 'A', results: [res('Compartida', false), res('Solo A', false)] };
    const colB = { name: 'B', results: [res('Compartida', false), res('Solo B', false)] };
    const stats = transferStats([colA, colB]);
    // 4 pistas en total, pero «Compartida» cuenta una sola vez → 3 únicas por transferir
    assert.equal(stats.uniqueMissing, 3);
    assert.deepEqual(stats.perAlbum.map((a) => a.missing), [2, 2]);
  });

  test('«ya tienes» global tampoco cuenta dos veces la misma canción (consistente con faltan)', () => {
    const colA = { name: 'A', results: [res('Tengo', true), res('Falta A', false)] };
    const colB = { name: 'B', results: [res('Tengo', true), res('Falta B', false)] };
    const stats = transferStats([colA, colB]);
    assert.equal(stats.totalHave, 1, '«Tengo» está en las dos listas pero cuenta una vez');
    assert.equal(stats.uniqueMissing, 2);
    assert.deepEqual(stats.perAlbum.map((a) => a.have), [1, 1], 'por álbum sí se ve en cada una');
  });
});
