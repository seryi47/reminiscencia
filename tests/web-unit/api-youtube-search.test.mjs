import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { describe, test } from 'node:test';

import {
  MAX_DURATION_S,
  MAX_RESULTS,
  artistFromChannel,
  cleanQuery,
  extractSearchHtml,
  extractSearchYtdlp,
  handleSearch,
  parseClock,
} from '../../frontend/web/server/youtube-search.js';

function fakeProcess(stdout, code = 0) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => {};
  queueMicrotask(() => {
    if (stdout) child.stdout.emit('data', stdout);
    child.emit('close', code);
  });
  return child;
}

const request = (query, method = 'GET') => new Request(`https://reminiscencia.test/api/youtube/search?q=${encodeURIComponent(query)}`, { method });

const video = (id, title, channel, clock) => ({
  videoRenderer: {
    videoId: id,
    title: { runs: [{ text: title }] },
    ownerText: { runs: [{ text: channel }] },
    ...(clock ? { lengthText: { simpleText: clock } } : {}),
  },
});

const page = (...renderers) => '<html><script>var ytInitialData = ' + JSON.stringify({
  contents: { section: [{ itemSectionRenderer: { contents: [{ shelfRenderer: { items: renderers } }, { channelRenderer: { channelId: 'x' } }] } }] },
}) + ';</script></html>';

describe('búsqueda de YouTube', () => {
  test('limpia y valida el texto buscado', () => {
    assert.equal(cleanQuery('  Bad   Bunny \n Tití '), 'Bad Bunny Tití');
    assert.equal(cleanQuery('a'), null);
    assert.equal(cleanQuery('x'.repeat(101)), null);
    assert.equal(cleanQuery(undefined), null);
    assert.equal(cleanQuery('   '), null);
  });

  test('convierte relojes y canales automáticos', () => {
    assert.equal(parseClock('3:45'), 225);
    assert.equal(parseClock('1:02:03'), 3723);
    assert.equal(parseClock(''), null);
    assert.equal(parseClock('EN DIRECTO'), null);
    assert.equal(artistFromChannel('Bad Bunny - Topic'), 'Bad Bunny');
    assert.equal(artistFromChannel('Rauw Alejandro'), 'Rauw Alejandro');
  });

  test('lee los vídeos de la página y descarta directos, mezclas largas, repetidos e ids inválidos', () => {
    const items = extractSearchHtml(page(
      video('abcdefghijk', 'Tití Me Preguntó', 'Bad Bunny - Topic', '4:03'),
      video('abcdefghijk', 'Repetido', 'Otro', '4:03'),
      video('lmnopqrstuv', 'Directo', 'Canal', null),
      video('wxyzABCDEFG', 'Mezcla', 'Canal', '2:10:00'),
      video('corto', 'Id corto', 'Canal', '3:00'),
      video('HIJKLMNOPQR', 'Segunda', 'Rauw Alejandro', '3:21'),
    ));
    assert.deepEqual(items, [
      { id: 'abcdefghijk', url: 'https://www.youtube.com/watch?v=abcdefghijk', title: 'Tití Me Preguntó', artist: 'Bad Bunny', durationS: 243 },
      { id: 'HIJKLMNOPQR', url: 'https://www.youtube.com/watch?v=HIJKLMNOPQR', title: 'Segunda', artist: 'Rauw Alejandro', durationS: 201 },
    ]);
    assert.ok(MAX_DURATION_S >= 600);
  });

  test('devuelve como mucho el máximo de resultados', () => {
    const renderers = Array.from({ length: 12 }, (_, i) => video(`abcdefghi${String(i).padStart(2, '0')}`, `Canción ${i}`, 'Canal', '3:00'));
    assert.equal(extractSearchHtml(page(...renderers)).length, MAX_RESULTS);
  });

  test('lee la salida de yt-dlp', () => {
    const items = extractSearchYtdlp(
      'abcdefghijk\tPrimera\tArtista - Topic\t200.0\nlmnopqrstuv\tSin canal\tNA\t180\nwxyzABCDEFG\tDirecto\tCanal\tNA\n\n',
    );
    assert.deepEqual(items.map((item) => [item.id, item.artist, item.durationS]), [
      ['abcdefghijk', 'Artista', 200],
      ['lmnopqrstuv', '', 180],
    ]);
  });

  test('responde con la página de resultados, sin yt-dlp, y permite guardar la respuesta en caché', async () => {
    let requested;
    const response = await handleSearch(request('tití me preguntó'), {
      spawnImpl: () => { throw new Error('No debe usar yt-dlp si la página da resultados'); },
      fetchImpl: async (url) => {
        requested = new URL(url);
        return new Response(page(video('abcdefghijk', 'Tití Me Preguntó', 'Bad Bunny', '4:03')), { status: 200 });
      },
    });
    assert.equal(response.status, 200);
    assert.equal(requested.hostname, 'www.youtube.com');
    assert.equal(requested.searchParams.get('search_query'), 'tití me preguntó');
    assert.match(response.headers.get('cache-control'), /s-maxage=3600/);
    assert.equal((await response.json()).items[0].artist, 'Bad Bunny');
  });

  test('usa yt-dlp con el texto detrás de ytsearch si la página falla o no da resultados', async () => {
    for (const fetchImpl of [
      async () => new Response('', { status: 429 }),
      async () => { throw new Error('sin red'); },
      async () => new Response('<html>consent</html>', { status: 200 }),
    ]) {
      let invocation;
      const response = await handleSearch(request('--exec evil'), {
        env: { YTDLP_PATH: '/opt/yt-dlp' },
        fetchImpl,
        spawnImpl(command, args, options) {
          invocation = { command, args, options };
          return fakeProcess('abcdefghijk\tTítulo\tCanal\t200\n');
        },
      });
      assert.equal(response.status, 200);
      assert.equal(invocation.command, '/opt/yt-dlp');
      assert.equal(invocation.args.at(-1), 'ytsearch14:--exec evil');
      assert.equal(invocation.options.shell, undefined);
      assert.equal((await response.json()).items.length, 1);
    }
  });

  test('rechaza textos inválidos y métodos que no son GET, y oculta los errores internos', async () => {
    const options = { spawnImpl: () => fakeProcess(''), fetchImpl: async () => new Response('', { status: 500 }) };
    assert.equal((await handleSearch(request('a'), options)).status, 400);
    assert.equal((await handleSearch(request('x'.repeat(200)), options)).status, 400);
    const post = await handleSearch(request('música', 'POST'), options);
    assert.equal(post.status, 405);
    assert.equal(post.headers.get('allow'), 'GET');
    const failed = await handleSearch(request('música'), { ...options, spawnImpl: () => fakeProcess('', 1) });
    assert.equal(failed.status, 502);
    assert.match((await failed.json()).error, /No se pudo buscar/);
    const missing = await handleSearch(request('música'), {
      ...options,
      spawnImpl: () => { const child = new EventEmitter(); queueMicrotask(() => child.emit('error', Object.assign(new Error('x'), { code: 'ENOENT' }))); return child; },
    });
    assert.equal(missing.status, 503);
  });
});
