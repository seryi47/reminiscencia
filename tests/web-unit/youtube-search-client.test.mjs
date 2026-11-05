import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  embedUrl,
  formatClock,
  normalizeResults,
  searchYoutube,
  shouldSearchAutomatically,
  youtubeQuery,
} from '../../frontend/web/js/youtube-search.js';

const reply = (status, body) => async () => ({ ok: status < 400, status, json: async () => body });

describe('cliente de búsqueda en YouTube', () => {
  it('limpia el texto y exige entre 3 y 100 letras', () => {
    assert.equal(youtubeQuery('  bad   bunny '), 'bad bunny');
    assert.equal(youtubeQuery('ab'), null);
    assert.equal(youtubeQuery('x'.repeat(101)), null);
    assert.equal(youtubeQuery(undefined), null);
  });

  it('solo busca solo si la biblioteca no tiene coincidencias', () => {
    assert.equal(shouldSearchAutomatically(0), true);
    assert.equal(shouldSearchAutomatically(2), false);
  });

  it('formatea duraciones', () => {
    assert.equal(formatClock(225), '3:45');
    assert.equal(formatClock(3723), '1:02:03');
    assert.equal(formatClock(null), '0:00');
  });

  it('solo admite identificadores válidos en el reproductor incrustado', () => {
    assert.match(embedUrl('dQw4w9WgXcQ'), /^https:\/\/www\.youtube-nocookie\.com\/embed\/dQw4w9WgXcQ\?autoplay=1/);
    assert.throws(() => embedUrl('../x'), TypeError);
  });

  it('descarta resultados mal formados o repetidos', () => {
    const items = normalizeResults({ items: [
      { id: 'dQw4w9WgXcQ', title: ' A ', artist: 'B', durationS: 10 },
      { id: 'dQw4w9WgXcQ', title: 'repetido' },
      { id: 'corto', title: 'x' },
      { id: 'aaaaaaaaaaa', title: '' },
    ] });
    assert.deepEqual(items, [{ id: 'dQw4w9WgXcQ', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', title: 'A', artist: 'B', durationS: 10 }]);
    assert.throws(() => normalizeResults({}), /no es válida/);
  });

  it('busca por el proxy y devuelve los resultados', async () => {
    let called = '';
    const items = await searchYoutube('bad bunny', {
      fetchImpl: async (url) => { called = url; return reply(200, { items: [{ id: 'dQw4w9WgXcQ', title: 'T' }] })(); },
    });
    assert.equal(called, '/api/youtube/search?q=bad%20bunny');
    assert.equal(items.length, 1);
  });

  it('explica los errores del servidor y de la red', async () => {
    await assert.rejects(searchYoutube('bad bunny', { fetchImpl: reply(503, { error: 'Sin yt-dlp' }) }), /Sin yt-dlp/);
    await assert.rejects(searchYoutube('bad bunny', { fetchImpl: reply(500, null) }), /No se pudo buscar/);
    await assert.rejects(searchYoutube('bad bunny', { fetchImpl: async () => { throw new TypeError('x'); } }), /conexión/);
    await assert.rejects(searchYoutube('ab'), /tres letras/);
  });
});
