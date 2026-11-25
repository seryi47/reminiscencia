// Fallback Web Player (ADR-0044 ampliado 2026-11-25): el navegador del usuario lee la playlist entera con el token
// del reproductor web público (`open.spotify.com/get_access_token` + cookies de sesión del usuario) para saltar
// el tope de 100 pistas que Spotify aplica a listas ajenas en Dev Mode.

import assert from 'node:assert/strict';
import { describe, test, beforeEach } from 'node:test';

import {
  getWebPlayerToken, fetchPlaylistFromWebPlayer, _resetWebPlayerTokenCache,
} from '../../frontend/web/js/spotify-webplayer.js';

const ok = (data, init = {}) => ({ ok: true, status: 200, json: async () => data, ...init });
const fail = (status) => ({ ok: false, status, json: async () => ({}) });

beforeEach(() => _resetWebPlayerTokenCache());

describe('getWebPlayerToken', () => {
  test('obtiene y cachea un token de usuario (con sesión abierta)', async () => {
    let calls = 0;
    const fetchImpl = async (url, init) => {
      calls += 1;
      assert.ok(url.startsWith('https://open.spotify.com/get_access_token'));
      assert.equal(init.credentials, 'include', 'manda las cookies de Spotify');
      return ok({ accessToken: 'USER_TOK', accessTokenExpirationTimestampMs: Date.now() + 60_000, isAnonymous: false });
    };
    const t1 = await getWebPlayerToken({ fetchImpl });
    const t2 = await getWebPlayerToken({ fetchImpl });
    assert.equal(t1, 'USER_TOK');
    assert.equal(t2, 'USER_TOK');
    assert.equal(calls, 1, 'se cachea entre llamadas');
  });

  test('devuelve null si el token viene como anónimo (usuario no logueado en Spotify)', async () => {
    const fetchImpl = async () => ok({ accessToken: 'ANON_TOK', isAnonymous: true });
    const t = await getWebPlayerToken({ fetchImpl });
    assert.equal(t, null);
  });

  test('devuelve null si el endpoint responde error o lanza (CORS, red)', async () => {
    assert.equal(await getWebPlayerToken({ fetchImpl: async () => fail(403) }), null);
    _resetWebPlayerTokenCache();
    assert.equal(await getWebPlayerToken({ fetchImpl: async () => { throw new Error('CORS'); } }), null);
  });
});

describe('fetchPlaylistFromWebPlayer', () => {
  test('pagina hasta cubrir la playlist (304 pistas = 4 páginas)', async () => {
    const page = (offset, size) => ({
      items: Array.from({ length: size }, (_, i) => ({ track: { id: `T${offset + i}`, name: `S${offset + i}`, type: 'track' } })),
    });
    const calls = [];
    const fetchImpl = async (url, init = {}) => {
      calls.push(url);
      if (url.includes('get_access_token')) return ok({ accessToken: 'TOK', accessTokenExpirationTimestampMs: Date.now() + 60_000, isAnonymous: false });
      assert.ok(init.headers.Authorization.startsWith('Bearer '));
      if (url.includes('offset=0')) return ok(page(0, 100));
      if (url.includes('offset=100')) return ok(page(100, 100));
      if (url.includes('offset=200')) return ok(page(200, 100));
      if (url.includes('offset=300')) return ok(page(300, 4));
      return ok({ items: [] });
    };
    const items = await fetchPlaylistFromWebPlayer('PL', { fetchImpl });
    assert.equal(items.length, 304);
    assert.equal(items[0].track.id, 'T0');
    assert.equal(items[303].track.id, 'T303');
    assert.ok(calls.some((u) => u.includes('offset=300')));
  });

  test('sin token (usuario no logueado): devuelve null sin pegarle a api.spotify.com', async () => {
    let hitApi = false;
    const fetchImpl = async (url) => {
      if (url.includes('get_access_token')) return ok({ accessToken: 'TOK', isAnonymous: true });
      if (url.includes('api.spotify.com')) hitApi = true;
      return ok({ items: [] });
    };
    const items = await fetchPlaylistFromWebPlayer('PL', { fetchImpl });
    assert.equal(items, null);
    assert.equal(hitApi, false, 'no se llama a api.spotify.com sin token');
  });

  test('un 401 a mitad de paginación olvida el token y devuelve lo acumulado', async () => {
    const fetchImpl = async (url) => {
      if (url.includes('get_access_token')) return ok({ accessToken: 'TOK', accessTokenExpirationTimestampMs: Date.now() + 60_000, isAnonymous: false });
      if (url.includes('offset=0')) return ok({ items: Array.from({ length: 100 }, (_, i) => ({ track: { id: `T${i}`, type: 'track' } })) });
      if (url.includes('offset=100')) return fail(401);
      return ok({ items: [] });
    };
    const items = await fetchPlaylistFromWebPlayer('PL', { fetchImpl });
    assert.equal(items.length, 100, 'conserva las 100 primeras aunque la 2ª página sea 401');
  });
});
