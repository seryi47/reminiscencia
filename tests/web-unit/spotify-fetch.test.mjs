// Pruebas del transporte de Spotify (ADR-0044): trae canción/álbum/playlist con paginación y los normaliza. `fetch`
// simulado por URL, sin red ni credenciales.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { fetchCollection, listMine, SpotifyApiError } from '../../frontend/web/server/spotify-fetch.js';

const ID = '3n3Ppam7vgaVa1iaRUc9Lp';
const okJson = (data) => ({ ok: true, status: 200, json: async () => data });

const trackObj = (name, n) => ({ id: `t${n}`, name, duration_ms: n * 1000, track_number: n, artists: [{ name: 'A' }] });

// Router de fetch simulado: responde según la URL pedida.
function router(routes) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    for (const [pattern, response] of routes) {
      if (url.includes(pattern)) return typeof response === 'function' ? response(url) : response;
    }
    return { ok: false, status: 404, json: async () => ({ error: { message: 'no ruta' } }) };
  };
  return { fetchImpl, calls };
}

describe('fetchCollection', () => {
  test('canción suelta', async () => {
    const { fetchImpl } = router([
      [`/v1/tracks/${ID}`, okJson({ id: ID, name: 'The Scientist', duration_ms: 309000, artists: [{ name: 'Coldplay' }],
        album: { name: 'A Rush', release_date: '2002', images: [{ url: 'c.jpg' }] }, external_ids: { isrc: 'X' } })],
    ]);
    const col = await fetchCollection({ ref: { type: 'track', id: ID }, accessToken: 'AT' }, fetchImpl);
    assert.equal(col.type, 'track');
    assert.equal(col.tracks.length, 1);
    assert.equal(col.tracks[0].title, 'The Scientist');
    assert.equal(col.tracks[0].isrc, 'X');
  });

  test('álbum con paginación de pistas, en orden', async () => {
    const { fetchImpl, calls } = router([
      [`/v1/albums/${ID}`, okJson({
        id: ID, name: 'Álbum', release_date: '2002', images: [{ url: 'a.jpg' }], artists: [{ name: 'A' }],
        tracks: { items: [trackObj('Uno', 1), trackObj('Dos', 2)], next: 'https://api.spotify.com/next-album' },
      })],
      ['/next-album', okJson({ items: [trackObj('Tres', 3)], next: null })],
    ]);
    const col = await fetchCollection({ ref: { type: 'album', id: ID }, accessToken: 'AT' }, fetchImpl);
    assert.equal(col.type, 'album');
    assert.deepEqual(col.tracks.map((t) => t.title), ['Uno', 'Dos', 'Tres']);
    assert.equal(col.tracks[0].album, 'Álbum'); // contexto propagado
    assert.ok(calls.some((u) => u.includes('/next-album')), 'siguió la paginación');
  });

  test('playlist con paginación (esquema 2026 items/item), saltando nulas, en orden', async () => {
    const { fetchImpl } = router([
      [`/v1/playlists/${ID}`, okJson({
        id: ID, name: 'Lista', images: [{ url: 'p.jpg' }], owner: { display_name: 'S' },
        items: {
          items: [{ item: { ...trackObj('A', 1), type: 'track', album: { name: 'AA', release_date: '2001' } } }, { item: null }],
          next: 'https://api.spotify.com/next-pl',
        },
      })],
      ['/next-pl', okJson({ items: [{ item: { ...trackObj('B', 2), type: 'track', album: { name: 'BB', release_date: '2002' } } }], next: null })],
    ]);
    const col = await fetchCollection({ ref: { type: 'playlist', id: ID }, accessToken: 'AT' }, fetchImpl);
    assert.equal(col.type, 'playlist');
    assert.deepEqual(col.tracks.map((t) => t.title), ['A', 'B']);
  });

  test('maxTracks limita playlists enormes', async () => {
    const items = Array.from({ length: 5 }, (_, i) => ({ item: { ...trackObj(`S${i}`, i + 1), type: 'track', album: { name: 'X', release_date: '2000' } } }));
    const { fetchImpl } = router([[`/v1/playlists/${ID}`, okJson({ id: ID, name: 'L', items: { items, next: null } })]]);
    const col = await fetchCollection({ ref: { type: 'playlist', id: ID }, accessToken: 'AT' }, fetchImpl, { maxTracks: 2 });
    assert.equal(col.tracks.length, 2);
  });

  test('401 y 429 salen como SpotifyApiError con su estado', async () => {
    const make = (status) => router([[`/v1/tracks/${ID}`, { status, ok: false, json: async () => ({}) }]]).fetchImpl;
    await assert.rejects(() => fetchCollection({ ref: { type: 'track', id: ID }, accessToken: 'AT' }, make(401)),
      (e) => e instanceof SpotifyApiError && e.status === 401);
    await assert.rejects(() => fetchCollection({ ref: { type: 'track', id: ID }, accessToken: 'AT' }, make(429)),
      (e) => e instanceof SpotifyApiError && e.status === 429);
  });

  test('exige referencia y token', async () => {
    await assert.rejects(() => fetchCollection({ ref: null, accessToken: 'AT' }, async () => okJson({})), /referencia/);
    await assert.rejects(() => fetchCollection({ ref: { type: 'track', id: ID } }, async () => okJson({})), /token/);
  });

  test('liked (Me gusta) trae las canciones guardadas', async () => {
    const { fetchImpl } = router([
      ['/v1/me/tracks', okJson({ items: [{ added_at: 'x', track: { ...trackObj('Fav', 1), album: { name: 'A', release_date: '2001' } } }], next: null, total: 1 })],
    ]);
    const col = await fetchCollection({ ref: { type: 'liked' }, accessToken: 'AT' }, fetchImpl);
    assert.equal(col.type, 'liked');
    assert.deepEqual(col.tracks.map((t) => t.title), ['Fav']);
  });
});

describe('listMine', () => {
  test('lista las playlists y el número de «Me gusta»', async () => {
    const { fetchImpl } = router([
      ['/v1/me/playlists', okJson({ items: [{ id: 'p1', name: 'Fiesta', tracks: { total: 10 }, images: [{ url: 'i.jpg' }], owner: { id: 'u', display_name: 'S' } }], next: null })],
      ['/v1/me/tracks', okJson({ items: [], total: 42 })],
    ]);
    const mine = await listMine({ accessToken: 'AT' }, fetchImpl);
    assert.equal(mine.playlists[0].name, 'Fiesta');
    assert.equal(mine.playlists[0].total, 10);
    assert.equal(mine.playlists[0].image, 'i.jpg');
    assert.equal(mine.liked, 42);
  });

  test('401 de /v1/me se propaga (no lo traga el catch): el cliente refresca (ADR-0044 ampliado 2026-11-24)', async () => {
    // Antes: /v1/me con 401 se tragaba silenciosamente → me=null → /v1/me/playlists daba 403 sin fallback (requiere `me`)
    // → envoltorio 502 y el cliente no refrescaba el token. Ahora el 401 sube limpio al handler, que devuelve 401 +
    // needsAuth para disparar el refresh.
    const fetchImpl = async (url) => {
      if (url.includes('/v1/me')) return { ok: false, status: 401, json: async () => ({ error: { message: 'token caducado' } }) };
      throw new Error('no debería llegar aquí');
    };
    await assert.rejects(
      () => listMine({ accessToken: 'AT' }, fetchImpl),
      (error) => error instanceof SpotifyApiError && error.status === 401,
    );
  });

  test('403 de /v1/me/playlists SIN `me` devuelve lista vacía con publicOnly (no 502)', async () => {
    // Antes, cuando /v1/me daba 403 (dev-mode sin Extended Quota) `me` quedaba null; /v1/me/playlists daba 403 también,
    // y como el fallback público necesita `me`, se lanzaba el error → envoltorio 502 y pantalla en blanco. Ahora cae a
    // lista vacía con publicOnly=true: el cliente muestra la ayuda de pegar enlaces en vez de reventar.
    const fetchImpl = async (url) => {
      if (url.includes('/v1/me/playlists')) return { ok: false, status: 403, json: async () => ({ error: { message: 'Insufficient client scope' } }) };
      if (url.endsWith('/v1/me')) return { ok: false, status: 403, json: async () => ({ error: { message: 'User not registered in the Developer Dashboard' } }) };
      if (url.includes('/v1/me/tracks')) return { ok: false, status: 403, json: async () => ({ error: { message: 'Insufficient client scope' } }) };
      return { ok: false, status: 404, json: async () => ({}) };
    };
    const mine = await listMine({ accessToken: 'AT' }, fetchImpl);
    assert.deepEqual(mine.playlists, []);
    assert.equal(mine.publicOnly, true);
    assert.equal(mine.me, null);
  });
});
