// Parser del embed público de Spotify (ADR-0044): saca la lista de canciones de una playlist pública para poder importar
// listas que el usuario solo sigue (la API en dev mode las da vacías). Contra datos simulados, sin red.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { tracksFromEmbedData, fetchPublicPlaylistTracks } from '../../frontend/web/server/spotify-embed.js';

const embedData = (trackList) => ({ props: { pageProps: { state: { data: { entity: { trackList } } } } } });

describe('tracksFromEmbedData', () => {
  test('normaliza título, artista(s) y duración; ignora pistas sin título', () => {
    const tracks = tracksFromEmbedData(embedData([
      { uri: 'spotify:track:abc', title: 'Self Aware', subtitle: 'LUM!X', duration: 151741 },
      { uri: 'spotify:track:def', title: 'You Are', subtitle: 'Nic Johnston, Jape Enterprise', duration: 180000 },
      { uri: 'spotify:track:ghi', title: '', subtitle: 'Sin título', duration: 1000 },
    ]));
    assert.equal(tracks.length, 2);
    assert.deepEqual(tracks[0], {
      title: 'Self Aware', artists: ['LUM!X'], album: '', durationMs: 151741, year: null, isrc: null,
      trackNumber: null, discNumber: null, cover: null, spotifyId: 'abc',
    });
    assert.deepEqual(tracks[1].artists, ['Nic Johnston', 'Jape Enterprise']);
    assert.equal(tracks[1].spotifyId, 'def');
  });

  test('sin trackList devuelve []', () => {
    assert.deepEqual(tracksFromEmbedData({}), []);
    assert.deepEqual(tracksFromEmbedData({ props: {} }), []);
  });
});

describe('fetchPublicPlaylistTracks (fetch simulado)', () => {
  test('extrae la trackList del __NEXT_DATA__ de la página embed', async () => {
    const html = `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(
      embedData([{ uri: 'spotify:track:xyz', title: 'Tema', subtitle: 'Artista', duration: 200000 }]),
    )}</script></body></html>`;
    const fetchImpl = async () => ({ ok: true, text: async () => html });
    const tracks = await fetchPublicPlaylistTracks('PL1', fetchImpl);
    assert.equal(tracks.length, 1);
    assert.equal(tracks[0].title, 'Tema');
    assert.equal(tracks[0].durationMs, 200000);
  });

  test('si la página falla, devuelve [] (se cae a la búsqueda normal)', async () => {
    assert.deepEqual(await fetchPublicPlaylistTracks('PL1', async () => ({ ok: false })), []);
    assert.deepEqual(await fetchPublicPlaylistTracks('PL1', async () => { throw new Error('red'); }), []);
  });
});
