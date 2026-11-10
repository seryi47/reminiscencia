// Pruebas de los endpoints de «Transferir música» (ADR-0044): login/token/refresh/resolve/callback. `fetch` y la
// búsqueda de YouTube se inyectan; sin red ni credenciales.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  handleSpotifyLogin, handleSpotifyToken, handleSpotifyRefresh, handleSpotifyResolve, handleSpotifyCallback,
} from '../../frontend/web/server/spotify-endpoints.js';

const PL = '3n3Ppam7vgaVa1iaRUc9Lp';
const post = (body) => new Request('https://reminiscencia.cometia.es/api/spotify/x', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
const okJson = (data) => ({ ok: true, status: 200, json: async () => data });

const trackItem = (name, n) => ({ item: { id: `t${n}`, name, type: 'track', duration_ms: 200000, artists: [{ name: 'Coldplay' }], album: { name: 'Álbum', release_date: '2002' } } });
// La búsqueda simulada devuelve un candidato oficial que coincide con la consulta («artista título»).
const goodSearch = async (query) => [{ id: 'ok', url: 'https://youtu.be/ok', title: `${query} (Official Video)`, artist: 'Coldplay', durationS: 200, source: 'official' }];

describe('login', () => {
  test('devuelve url, verifier y state', async () => {
    const res = await handleSpotifyLogin(post({}), { env: {} });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.match(body.url, /accounts\.spotify\.com\/authorize/);
    assert.ok(body.verifier && body.state);
    assert.match(body.url, /client_id=cbf0af01b2e1415593923057e93bf48e/); // Client ID por defecto
  });
});

describe('token / refresh', () => {
  test('token cambia el código (fetch simulado)', async () => {
    const fetchImpl = async () => okJson({ access_token: 'AT', refresh_token: 'RT', scope: 's', expires_in: 3600 });
    const res = await handleSpotifyToken(post({ code: 'C', verifier: 'V' }), { env: {}, fetchImpl });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).accessToken, 'AT');
  });
  test('token sin code/verifier → 400', async () => {
    const res = await handleSpotifyToken(post({ code: 'C' }), { env: {}, fetchImpl: async () => okJson({}) });
    assert.equal(res.status, 400);
  });
  test('refresh devuelve sesión', async () => {
    const fetchImpl = async () => okJson({ access_token: 'AT2', scope: 's', expires_in: 3600 });
    const res = await handleSpotifyRefresh(post({ refreshToken: 'OLD' }), { env: {}, fetchImpl });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.accessToken, 'AT2');
    assert.equal(body.refreshToken, 'OLD'); // se conserva
  });
});

describe('resolve', () => {
  const playlist = {
    id: PL, name: 'Mi lista', images: [{ url: 'p.jpg' }],
    items: { items: [trackItem('Uno', 1), trackItem('Dos', 2), trackItem('Tres', 3)], next: null },
  };
  const fetchImpl = async (url) => (url.includes(`/v1/playlists/${PL}`) ? okJson(playlist) : okJson({}));

  test('resuelve la primera página y dice que hay más', async () => {
    const res = await handleSpotifyResolve(
      post({ url: `https://open.spotify.com/playlist/${PL}`, accessToken: 'AT', limit: 2 }),
      { search: goodSearch, fetchImpl },
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.total, 3);
    assert.equal(body.hasMore, true);
    assert.deepEqual(body.results.map((r) => r.index), [0, 1]);
    assert.equal(body.album.id, `spotify:playlist:${PL}`);
    assert.equal(body.results[0].tier, 'alta');
  });

  test('la segunda página trae el resto con índices globales', async () => {
    const res = await handleSpotifyResolve(
      post({ url: `https://open.spotify.com/playlist/${PL}`, accessToken: 'AT', offset: 2, limit: 2 }),
      { search: goodSearch, fetchImpl },
    );
    const body = await res.json();
    assert.deepEqual(body.results.map((r) => r.index), [2]);
    assert.equal(body.hasMore, false);
  });

  test('enlace inválido → 400; sin token → 401 needsAuth', async () => {
    assert.equal((await handleSpotifyResolve(post({ url: 'https://youtu.be/x', accessToken: 'AT' }), { search: goodSearch, fetchImpl })).status, 400);
    const noToken = await handleSpotifyResolve(post({ url: `https://open.spotify.com/playlist/${PL}` }), { search: goodSearch, fetchImpl });
    assert.equal(noToken.status, 401);
    assert.equal((await noToken.json()).needsAuth, true);
  });

  test('token caducado de Spotify → 401 needsAuth', async () => {
    const expired = async () => ({ ok: false, status: 401, json: async () => ({}) });
    const res = await handleSpotifyResolve(post({ url: `https://open.spotify.com/playlist/${PL}`, accessToken: 'AT' }),
      { search: goodSearch, fetchImpl: expired });
    assert.equal(res.status, 401);
    assert.equal((await res.json()).needsAuth, true);
  });
});

describe('callback', () => {
  test('sirve la página HTML que cierra el login', async () => {
    const res = handleSpotifyCallback();
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);
    const html = await res.text();
    assert.match(html, /\/api\/spotify\/token/);
    assert.match(html, /reminiscencia:\/\/spotify-callback/); // ruta de la APK
  });
});
