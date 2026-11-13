// Pruebas de la ingesta de Spotify (ADR-0044): interpretar enlaces/URIs y normalizar respuestas de la API de Spotify a
// la forma interna, respetando el tipo (canción/álbum/playlist) y el orden. Contra fixtures, sin red ni credenciales.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  parseSpotifyRef, normalizeTrack, normalizeAlbum, normalizePlaylist, normalizeSingleTrack, youtubeQueryFor,
  youtubeQueriesFor,
} from '../../frontend/web/server/spotify-core.js';

const TRACK_ID = '3n3Ppam7vgaVa1iaRUc9Lp'; // 22 base62

describe('parseSpotifyRef', () => {
  test('acepta URLs de canción, álbum y playlist (con intl y ?si=)', () => {
    assert.deepEqual(parseSpotifyRef(`https://open.spotify.com/track/${TRACK_ID}`), { type: 'track', id: TRACK_ID });
    assert.deepEqual(parseSpotifyRef(`https://open.spotify.com/intl-es/track/${TRACK_ID}?si=abc`),
      { type: 'track', id: TRACK_ID });
    assert.deepEqual(parseSpotifyRef(`open.spotify.com/album/${TRACK_ID}`), { type: 'album', id: TRACK_ID });
    assert.deepEqual(parseSpotifyRef(`https://open.spotify.com/playlist/${TRACK_ID}`), { type: 'playlist', id: TRACK_ID });
  });
  test('acepta URIs spotify:', () => {
    assert.deepEqual(parseSpotifyRef(`spotify:track:${TRACK_ID}`), { type: 'track', id: TRACK_ID });
    assert.deepEqual(parseSpotifyRef(`spotify:playlist:${TRACK_ID}`), { type: 'playlist', id: TRACK_ID });
  });
  test('rechaza lo que no es una referencia válida', () => {
    assert.equal(parseSpotifyRef('https://youtu.be/abc'), null);
    assert.equal(parseSpotifyRef('spotify:artist:' + TRACK_ID), null); // artista no se soporta
    assert.equal(parseSpotifyRef('texto suelto'), null);
    assert.equal(parseSpotifyRef(''), null);
  });
});

const fullTrack = {
  id: TRACK_ID,
  name: 'The Scientist',
  duration_ms: 309320,
  track_number: 7,
  disc_number: 1,
  artists: [{ name: 'Coldplay' }],
  album: { name: 'A Rush of Blood to the Head', release_date: '2002-08-26', images: [{ url: 'https://img/scientist.jpg' }] },
  external_ids: { isrc: 'GBAYE0200972' },
};

describe('normalizeTrack', () => {
  test('mapea el objeto track completo a la forma interna', () => {
    assert.deepEqual(normalizeTrack(fullTrack), {
      title: 'The Scientist',
      artists: ['Coldplay'],
      album: 'A Rush of Blood to the Head',
      durationMs: 309320,
      year: 2002,
      isrc: 'GBAYE0200972',
      trackNumber: 7,
      discNumber: 1,
      cover: 'https://img/scientist.jpg',
      spotifyId: TRACK_ID,
    });
  });
  test('ignora pistas locales y objetos sin nombre', () => {
    assert.equal(normalizeTrack({ ...fullTrack, is_local: true }), null);
    assert.equal(normalizeTrack({ id: 'x', name: '' }), null);
    assert.equal(normalizeTrack(null), null);
  });
  test('toma álbum/año/portada del contexto cuando el track viene simplificado (dentro de un álbum)', () => {
    const simplified = { id: 'a', name: 'Pista 1', duration_ms: 1000, track_number: 1, artists: [{ name: 'X' }] };
    const context = { name: 'Mi Álbum', release_date: '1999', images: [{ url: 'cover.jpg' }] };
    const result = normalizeTrack(simplified, context);
    assert.equal(result.album, 'Mi Álbum');
    assert.equal(result.year, 1999);
    assert.equal(result.cover, 'cover.jpg');
  });
});

describe('normalizeAlbum', () => {
  test('conserva el orden y propaga el contexto del álbum a cada pista', () => {
    const album = {
      id: 'alb1',
      name: 'A Rush of Blood to the Head',
      release_date: '2002-08-26',
      images: [{ url: 'alb.jpg' }],
      artists: [{ name: 'Coldplay' }],
      tracks: {
        items: [
          { id: 't1', name: 'Politik', duration_ms: 318000, track_number: 1, artists: [{ name: 'Coldplay' }] },
          { id: 't2', name: 'In My Place', duration_ms: 228000, track_number: 2, artists: [{ name: 'Coldplay' }] },
        ],
      },
    };
    const result = normalizeAlbum(album);
    assert.equal(result.type, 'album');
    assert.equal(result.artist, 'Coldplay');
    assert.equal(result.year, 2002);
    assert.deepEqual(result.tracks.map((t) => t.title), ['Politik', 'In My Place']);
    assert.equal(result.tracks[0].album, 'A Rush of Blood to the Head'); // contexto propagado
    assert.equal(result.tracks[0].cover, 'alb.jpg');
    assert.deepEqual(result.tracks.map((t) => t.trackNumber), [1, 2]);
  });
});

describe('normalizePlaylist', () => {
  // Esquema de 2026: paginado en `items` y cada entrada con la pista en `item` (antes `tracks`/`track`).
  test('esquema nuevo: conserva el orden y salta nulas, locales y episodios', () => {
    const playlist = {
      id: 'pl1',
      name: 'Mi lista',
      images: [{ url: 'pl.jpg' }],
      owner: { display_name: 'Sergio' },
      items: {
        items: [
          { item: { id: 'a', name: 'Uno', type: 'track', duration_ms: 1000, artists: [{ name: 'A' }], album: { name: 'AA', release_date: '2001' } } },
          { item: null }, // retirada
          { is_local: true, item: { id: 'b', name: 'Dos', type: 'track', duration_ms: 2000, artists: [{ name: 'B' }], album: { name: 'BB', release_date: '2002' } } }, // local (marcado en la entrada)
          { item: { id: 'ep', name: 'Un episodio', type: 'episode', duration_ms: 9999 } }, // episodio: fuera
          { item: { id: 'c', name: 'Tres', type: 'track', duration_ms: 3000, artists: [{ name: 'C' }], album: { name: 'CC', release_date: '2003' } } },
        ],
      },
    };
    const result = normalizePlaylist(playlist);
    assert.equal(result.type, 'playlist');
    assert.equal(result.owner, 'Sergio');
    assert.deepEqual(result.tracks.map((t) => t.title), ['Uno', 'Tres']); // local, nula y episodio se saltan
  });

  test('esquema antiguo (tracks/track) sigue funcionando', () => {
    const playlist = {
      id: 'pl1', name: 'Vieja',
      tracks: { items: [{ track: { id: 'a', name: 'Uno', duration_ms: 1000, artists: [{ name: 'A' }], album: { name: 'AA', release_date: '2001' } } }] },
    };
    assert.deepEqual(normalizePlaylist(playlist).tracks.map((t) => t.title), ['Uno']);
  });
});

describe('normalizeSingleTrack / youtubeQueryFor', () => {
  test('una canción suelta se trata como colección de un elemento', () => {
    const result = normalizeSingleTrack(fullTrack);
    assert.equal(result.type, 'track');
    assert.equal(result.tracks.length, 1);
    assert.equal(result.tracks[0].title, 'The Scientist');
  });
  test('la consulta de YouTube es «artista título» sin la cola de feat', () => {
    assert.equal(youtubeQueryFor({ title: 'Loyal (feat. Lil Wayne, Tyga)', artists: ['Chris Brown'] }), 'Chris Brown Loyal');
    assert.equal(youtubeQueryFor({ title: 'The Scientist', artists: ['Coldplay'] }), 'Coldplay The Scientist');
  });

  test('youtubeQueriesFor da variantes de la más precisa a la más amplia, sin duplicados', () => {
    // Un solo artista: primaria + «solo título» (la de feat coincide con la primaria y no se duplica).
    assert.deepEqual(youtubeQueriesFor({ title: 'The Scientist', artists: ['Coldplay'] }),
      ['Coldplay The Scientist', 'The Scientist']);
    // Colaboración: se añade la variante con TODOS los artistas, entre la primaria y la amplia.
    assert.deepEqual(youtubeQueriesFor({ title: 'Loyal (feat. Lil Wayne, Tyga)', artists: ['Chris Brown', 'Lil Wayne', 'Tyga'] }),
      ['Chris Brown Loyal', 'Chris Brown Lil Wayne Tyga Loyal', 'Loyal']);
    // Sin artista: queda solo el título.
    assert.deepEqual(youtubeQueriesFor({ title: 'Clocks', artists: [] }), ['Clocks']);
  });

  test('youtubeQueryFor es la primera variante de youtubeQueriesFor', () => {
    const track = { title: 'Dakiti', artists: ['Bad Bunny', 'Jhay Cortez'] };
    assert.equal(youtubeQueryFor(track), youtubeQueriesFor(track)[0]);
  });

  test('con guion o tilde añade una variante PLEGADA (sin guion/acento) para que YouTube la encuentre', () => {
    const hyphen = youtubeQueriesFor({ title: 'Peli-Culeo', artists: ['Cazzu', 'De La Ghetto'] });
    assert.equal(hyphen[0], 'Cazzu Peli-Culeo');
    assert.ok(hyphen.includes('cazzu peli culeo'), `falta la variante plegada: ${JSON.stringify(hyphen)}`);

    const accent = youtubeQueriesFor({ title: 'AMANECIÓ', artists: ['Quevedo'] });
    assert.equal(accent[0], 'Quevedo AMANECIÓ');
    assert.ok(accent.includes('quevedo amanecio'), `falta la variante plegada: ${JSON.stringify(accent)}`);
  });

  test('sin guion ni tilde NO añade variantes redundantes solo por mayúsculas/minúsculas', () => {
    // «Coldplay The Scientist» y su plegado «coldplay the scientist» son lo mismo para YouTube → una sola.
    assert.deepEqual(youtubeQueriesFor({ title: 'The Scientist', artists: ['Coldplay'] }),
      ['Coldplay The Scientist', 'The Scientist']);
  });
});
