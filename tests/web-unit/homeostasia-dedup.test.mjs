// Tests del filtro de dedup de playlists de YouTube contra la biblioteca (ADR-0019 ampliado + ADR-0046).
// Es el espejo del mobile/test/homeostasia_dedup_test.dart.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { filterYoutubePlaylist } from '../../frontend/web/js/youtube-dedup.js';

const song = ({ id, title, artist = '', durationS = 180 }) => ({ id, title, artist, durationS });
const ytItem = ({ title, artist = '' }) => ({ url: `https://youtu.be/${title}`, title, artist });

describe('filterYoutubePlaylist (ADR-0019 + ADR-0046)', () => {
  test('sin biblioteca, todo es nuevo', () => {
    const tracks = [ytItem({ title: 'Averno', artist: 'Rayden' }), ytItem({ title: 'Meteorito', artist: 'Rayden' })];
    const res = filterYoutubePlaylist(tracks, []);
    assert.equal(res.total, 2);
    assert.equal(res.newCount, 2);
    assert.equal(res.alreadyCount, 0);
    assert.deepEqual(res.toDownload, tracks);
    assert.deepEqual(res.skipped, []);
  });

  test('título igual con artista exacto se considera ya en biblioteca (sin duración en YT)', () => {
    const library = [song({ id: 's1', title: 'Meteorito', artist: 'Rayden', durationS: 261 })];
    const tracks = [ytItem({ title: 'Meteorito', artist: 'Rayden' })];
    const res = filterYoutubePlaylist(tracks, library);
    assert.equal(res.alreadyCount, 1);
    assert.equal(res.newCount, 0);
  });

  test('tolerante a «feat»: feat extra en YouTube no impide marcar como ya en biblioteca', () => {
    const library = [song({ id: 's1', title: 'Itaboy!', artist: 'Rayden', durationS: 185 })];
    const tracks = [ytItem({ title: 'Itaboy! (feat. SFDK)', artist: 'Rayden ft SFDK' })];
    const res = filterYoutubePlaylist(tracks, library);
    assert.equal(res.alreadyCount, 1);
  });

  test('tolerante a «Remastered»: cuenta como ya en biblioteca si todo lo demás cuadra', () => {
    const library = [song({ id: 's1', title: 'Clocks', artist: 'Coldplay', durationS: 307 })];
    const tracks = [ytItem({ title: 'Clocks (Remastered 2021)', artist: 'Coldplay' })];
    const res = filterYoutubePlaylist(tracks, library);
    assert.equal(res.alreadyCount, 1);
  });

  test('«(Live)» NO cuenta como que ya la tienes: se marca como nueva', () => {
    const library = [song({ id: 's1', title: 'Clocks', artist: 'Coldplay', durationS: 307 })];
    const tracks = [ytItem({ title: 'Clocks (Live at Wembley)', artist: 'Coldplay' })];
    const res = filterYoutubePlaylist(tracks, library);
    assert.equal(res.alreadyCount, 0);
    assert.equal(res.newCount, 1);
  });

  test('mezcla preserva orden y cuenta correctamente', () => {
    const library = [
      song({ id: 's1', title: 'Pólvora mojada', artist: 'Rayden', durationS: 221 }),
      song({ id: 's2', title: 'Meteorito', artist: 'Rayden', durationS: 261 }),
    ];
    const tracks = [
      ytItem({ title: 'Averno', artist: 'Rayden y Tanxugueiras' }),
      ytItem({ title: 'Meteorito', artist: 'Rayden' }),
      ytItem({ title: 'Haz de luz', artist: 'Rayden' }),
      ytItem({ title: 'Pólvora mojada', artist: 'Rayden' }),
    ];
    const res = filterYoutubePlaylist(tracks, library);
    assert.equal(res.total, 4);
    assert.equal(res.alreadyCount, 2);
    assert.equal(res.newCount, 2);
    assert.deepEqual(res.toDownload.map((t) => t.title), ['Averno', 'Haz de luz']);
    assert.deepEqual(res.skipped.map((t) => t.title), ['Meteorito', 'Pólvora mojada']);
  });
});
