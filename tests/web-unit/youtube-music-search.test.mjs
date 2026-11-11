// Parser de la búsqueda de YouTube Music (ADR-0044): extrae canciones oficiales (Topic) de la respuesta de
// /youtubei/v1/search, para mejorar la precisión del matcher de «Transferir música». Contra un fixture, sin red.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { extractMusicSearch, mergeCandidates } from '../../frontend/web/server/youtube-music.js';

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

describe('mergeCandidates', () => {
  test('une varias listas sin repetir ids, en orden (music primero)', () => {
    const music = [{ id: 'a', source: 'topic' }, { id: 'b', source: 'topic' }];
    const regular = [{ id: 'b', source: 'search' }, { id: 'c', source: 'search' }];
    assert.deepEqual(mergeCandidates(music, regular).map((c) => c.id), ['a', 'b', 'c']);
  });
});
