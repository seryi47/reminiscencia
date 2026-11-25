// Pruebas de los endpoints de «Transferir música» (ADR-0044): login/token/refresh/resolve/callback. `fetch` y la
// búsqueda de YouTube se inyectan; sin red ni credenciales.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  handleSpotifyLogin, handleSpotifyToken, handleSpotifyRefresh, handleSpotifyMine, handleSpotifyResolve, handleSpotifyRecent, handleSpotifyCallback,
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
    assert.equal(body.album.id, `spotify_playlist_${PL}`);
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

  test('compareOnly lista las pistas SIN resolver YouTube (ni siquiera necesita search)', async () => {
    // Sin `search` en las dependencias: con compareOnly no debe fallar (ADR-0046).
    const res = await handleSpotifyResolve(
      post({ url: `https://open.spotify.com/playlist/${PL}`, accessToken: 'AT', compareOnly: true }),
      { fetchImpl },
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.total, 3);
    assert.deepEqual(body.results.map((r) => r.index), [0, 1, 2]);
    assert.ok(body.results.every((r) => r.best === null), 'no trae candidatos de YouTube');
    assert.ok(body.results[0].track, 'sí trae la pista para comparar');
    assert.equal(body.album.id, `spotify_playlist_${PL}`);
  });

  test('sin compareOnly y sin search → 500', async () => {
    const res = await handleSpotifyResolve(post({ url: `https://open.spotify.com/playlist/${PL}`, accessToken: 'AT' }), { fetchImpl });
    assert.equal(res.status, 500);
  });

  test('tracks explícitos del cliente (fallback Web Player): el server no llama a Spotify, solo matchea YouTube', async () => {
    // Camino nuevo (ADR-0044 ampliado 2026-11-25): el cliente lee las 304 pistas con su sesión del Web Player y
    // nos envía las que faltan. El server NO toca api.spotify.com (si lo hiciera, el fetchImpl de abajo lanzaría).
    let touchedSpotify = false;
    const explodingFetch = async (url) => { if (url.includes('spotify.com')) { touchedSpotify = true; throw new Error('no tocar spotify'); } return okJson({}); };
    const rawTracks = [
      { id: 't100', name: 'Pista 101', type: 'track', duration_ms: 200000, artists: [{ name: 'Coldplay' }], album: { name: 'X', release_date: '2024' } },
      { id: 't101', name: 'Pista 102', type: 'track', duration_ms: 205000, artists: [{ name: 'Coldplay' }], album: { name: 'X', release_date: '2024' } },
    ];
    const res = await handleSpotifyResolve(
      post({ tracks: rawTracks, accessToken: 'AT', albumRef: { type: 'playlist', id: PL }, name: 'Mix', limit: 2 }),
      { search: goodSearch, fetchImpl: explodingFetch },
    );
    assert.equal(res.status, 200);
    assert.equal(touchedSpotify, false, 'no se ha ido a api.spotify.com');
    const body = await res.json();
    assert.equal(body.total, 2);
    assert.equal(body.results.length, 2);
    assert.equal(body.results[0].tier, 'alta');
  });

  test('tracks + indexOffset: los índices salen globales (ADR-0044 ampliado 2026-11-25)', async () => {
    // Regresión del bug encontrado en la auditoría: el cliente ya pagina las pistas (manda solo 25) y pasa
    // `indexOffset: 100` para la ventana 100-124. El server NO debe re-paginar: devuelve esas 25 con
    // index = 100..124. Antes el server hacía slice(100, 125) sobre una ventana de 25 → vacío.
    const rawTracks = Array.from({ length: 25 }, (_, i) => ({
      id: `t${100 + i}`, name: `S${100 + i}`, type: 'track', duration_ms: 200000,
      artists: [{ name: 'Coldplay' }], album: { name: 'X', release_date: '2024' },
    }));
    const res = await handleSpotifyResolve(
      post({ tracks: rawTracks, accessToken: 'AT', albumRef: { type: 'playlist', id: PL }, indexOffset: 100, offset: 0, limit: 25 }),
      { search: goodSearch, fetchImpl },
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.results.length, 25, 'las 25 pistas llegan, no 0');
    assert.equal(body.results[0].index, 100, 'indexOffset se aplica');
    assert.equal(body.results[24].index, 124);
    assert.equal(body.hasMore, false, 'el camino tracks SIEMPRE devuelve hasMore:false (lo pagina el cliente)');
  });

  test('tracks vacíos → 400', async () => {
    const res = await handleSpotifyResolve(post({ tracks: [], accessToken: 'AT' }), { search: goodSearch, fetchImpl });
    assert.equal(res.status, 400);
  });
});

describe('recent (ADR-0044 ampliado 2026-11-25)', () => {
  test('devuelve las pistas crudas del historial del usuario', async () => {
    const page1 = { items: [{ track: { id: 'a', name: 'A', type: 'track' } }, { track: { id: 'b', name: 'B', type: 'track' } }], cursors: { before: '100' } };
    const page2 = { items: [{ track: { id: 'c', name: 'C', type: 'track' } }], cursors: {} };
    const fetchImpl = async (url) => {
      if (url.includes('before=100')) return okJson(page2);
      if (url.includes('/v1/me/player/recently-played')) return okJson(page1);
      return okJson({});
    };
    const res = await handleSpotifyRecent(post({ accessToken: 'AT', cap: 100 }), { fetchImpl });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.tracks.length, 3);
    assert.deepEqual(body.tracks.map((t) => t.id), ['a', 'b', 'c']);
  });

  test('sin token -> 401 needsAuth', async () => {
    const res = await handleSpotifyRecent(post({}), { fetchImpl: async () => okJson({}) });
    assert.equal(res.status, 401);
    assert.equal((await res.json()).needsAuth, true);
  });

  test('403 de Spotify (sin scope) -> 403 needsReconnect', async () => {
    const fetchImpl = async () => ({ ok: false, status: 403, json: async () => ({ error: { message: 'Insufficient client scope' } }) });
    const res = await handleSpotifyRecent(post({ accessToken: 'AT' }), { fetchImpl });
    assert.equal(res.status, 403);
    assert.equal((await res.json()).needsReconnect, true);
  });
});

describe('mine / resolve liked', () => {
  test('mine lista la biblioteca del usuario', async () => {
    const fetchImpl = async (url) => (url.includes('/v1/me/playlists')
      ? okJson({ items: [{ id: 'p1', name: 'Fiesta', tracks: { total: 3 }, images: [], owner: {} }], next: null })
      : okJson({ items: [], total: 5 }));
    const res = await handleSpotifyMine(post({ accessToken: 'AT' }), { fetchImpl });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.liked, 5);
    assert.equal(body.playlists[0].name, 'Fiesta');
  });
  test('mine sin token → 401 needsAuth', async () => {
    const res = await handleSpotifyMine(post({}), { fetchImpl: async () => okJson({}) });
    assert.equal(res.status, 401);
    assert.equal((await res.json()).needsAuth, true);
  });
  test('resolve con source=liked resuelve las favoritas', async () => {
    const fetchImpl = async (url) => (url.includes('/v1/me/tracks')
      ? okJson({ items: [{ track: { id: 't', name: 'Fav', type: 'track', duration_ms: 200000, artists: [{ name: 'Coldplay' }], album: { name: 'X', release_date: '2001' } } }], next: null })
      : okJson({}));
    const res = await handleSpotifyResolve(post({ source: 'liked', accessToken: 'AT' }), { search: goodSearch, fetchImpl });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).results.length, 1);
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
