// Parser de la búsqueda de YouTube Music (ADR-0044): extrae canciones oficiales (Topic) de la respuesta de
// /youtubei/v1/search, para mejorar la precisión del matcher de «Transferir música». Contra un fixture, sin red.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  extractMusicSearch, mergeCandidates, searchYoutubeMusic, resetMusicCredsCache,
} from '../../frontend/web/server/youtube-music.js';

const song = (videoId, title, artist, album, duration) => ({
  musicResponsiveListItemRenderer: {
    flexColumns: [
      { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: title, navigationEndpoint: { watchEndpoint: { videoId } } }] } } },
      { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: artist }, { text: ' • ' }, { text: album }, { text: ' • ' }, { text: duration }] } } },
    ],
  },
});

const response = (...songs) => ({
  contents: { tabbedSearchResultsRenderer: { tabs: [{ tabRenderer: { content: { sectionListRenderer: {
    contents: [{ musicShelfRenderer: { contents: songs } }],
  } } } }] } },
});

describe('extractMusicSearch', () => {
  test('saca id, título, artista y duración, marcando source=topic', () => {
    const items = extractMusicSearch(response(
      song('abcdefghijk', 'The Scientist', 'Coldplay', 'A Rush of Blood to the Head', '5:09'),
      song('HIJKLMNOPQR', 'Yellow', 'Coldplay', 'Parachutes', '4:29'),
    ));
    assert.deepEqual(items, [
      { id: 'abcdefghijk', url: 'https://www.youtube.com/watch?v=abcdefghijk', title: 'The Scientist', artist: 'Coldplay', durationS: 309, source: 'topic' },
      { id: 'HIJKLMNOPQR', url: 'https://www.youtube.com/watch?v=HIJKLMNOPQR', title: 'Yellow', artist: 'Coldplay', durationS: 269, source: 'topic' },
    ]);
  });

  test('ignora entradas sin videoId válido o sin duración', () => {
    assert.deepEqual(extractMusicSearch(response(song('corto', 'Mala', 'X', 'Y', '3:00'))), []); // id inválido
    assert.deepEqual(extractMusicSearch({}), []); // respuesta vacía
    assert.deepEqual(extractMusicSearch(response(song('abcdefghijk', 'Sin dur', 'X', 'Y', 'EN DIRECTO'))), []); // sin duración
  });
});

describe('searchYoutubeMusic (fetch simulado)', () => {
  const homeHtml = '"INNERTUBE_API_KEY":"KEY123","INNERTUBE_CLIENT_VERSION":"1.2026"';
  const searchJson = response(song('abcdefghijk', 'Mala Mujer', 'C. Tangana', 'El Madrileño', '3:43'));

  // Crea un fetch simulado que cuenta las recargas de la home y guarda el cuerpo de la última búsqueda.
  const makeFetch = () => {
    const calls = { home: 0, search: 0, lastBody: null };
    const fetchImpl = async (url, opts = {}) => {
      if (String(url).includes('/youtubei/v1/search')) {
        calls.search += 1;
        calls.lastBody = JSON.parse(opts.body);
        return { ok: true, status: 200, json: async () => searchJson };
      }
      calls.home += 1;
      return { ok: true, status: 200, text: async () => homeHtml };
    };
    return { fetchImpl, calls };
  };

  test('envía el filtro «Canciones» y extrae la canción oficial', async () => {
    resetMusicCredsCache();
    const { fetchImpl, calls } = makeFetch();
    const out = await searchYoutubeMusic('C. Tangana Mala Mujer', { fetchImpl });
    assert.equal(out.length, 1);
    assert.equal(out[0].title, 'Mala Mujer');
    assert.equal(out[0].source, 'topic');
    assert.ok(calls.lastBody.params, 'manda params (filtro de canciones)');
    assert.equal(calls.lastBody.context.client.clientName, 'WEB_REMIX');
  });

  test('cachea las credenciales de InnerTube: no recarga la home en cada búsqueda', async () => {
    resetMusicCredsCache();
    const { fetchImpl, calls } = makeFetch();
    await searchYoutubeMusic('uno', { fetchImpl });
    await searchYoutubeMusic('dos', { fetchImpl });
    await searchYoutubeMusic('tres', { fetchImpl });
    assert.equal(calls.home, 1, 'una sola recarga de la home para las tres búsquedas');
    assert.equal(calls.search, 3);
  });

  test('si la búsqueda da 403, olvida la caché y la siguiente recarga credenciales', async () => {
    resetMusicCredsCache();
    let status = 403;
    let home = 0;
    const fetchImpl = async (url) => {
      if (String(url).includes('/youtubei/v1/search')) {
        return { ok: status === 200, status, json: async () => searchJson };
      }
      home += 1;
      return { ok: true, status: 200, text: async () => homeHtml };
    };
    await searchYoutubeMusic('x', { fetchImpl }); // 403 → invalida caché
    status = 200;
    await searchYoutubeMusic('y', { fetchImpl }); // recarga home
    assert.equal(home, 2, 'tras el 403 vuelve a pedir la home');
  });
});

describe('mergeCandidates', () => {
  test('une varias listas sin repetir ids, en orden (music primero)', () => {
    const music = [{ id: 'a', source: 'topic' }, { id: 'b', source: 'topic' }];
    const regular = [{ id: 'b', source: 'search' }, { id: 'c', source: 'search' }];
    assert.deepEqual(mergeCandidates(music, regular).map((c) => c.id), ['a', 'b', 'c']);
  });
});
