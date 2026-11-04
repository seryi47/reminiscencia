import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { describe, test } from 'node:test';

import { extractPlaylist, extractPlaylistHtml, extractVideoTitleHtml, handlePlaylist } from '../../frontend/web/server/youtube-playlist.js';
import { handleConvert } from '../../frontend/web/server/youtube-convert.js';
import { handleStatus } from '../../frontend/web/server/youtube-status.js';
import { handleDownload } from '../../frontend/web/server/youtube-download.js';

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

const playlistRequest = (url) => new Request(`https://reminiscencia.test/api/youtube/playlist?url=${encodeURIComponent(url)}`);
const videoUrl = 'https://www.youtube.com/watch?v=abcdefghijk';

describe('API del importador de YouTube', () => {
  test('valida playlists y ejecuta yt-dlp con argumentos separados', async () => {
    let invocation;
    const response = await handlePlaylist(playlistRequest('https://www.youtube.com/playlist?list=PL123'), {
      env: { YTDLP_PATH: '/opt/yt-dlp' },
      spawnImpl(command, args, options) {
        invocation = { command, args, options };
        return fakeProcess('abcdefghijk\tPrimera\nabcdefghijk\tDuplicada\nlmnopqrstuv\tSegunda\n');
      },
      fetchImpl: async () => new Response(JSON.stringify({ title: 'Nuestro desacato' }), { status: 200 }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      items: [
        { url: videoUrl, title: 'Primera' },
        { url: 'https://www.youtube.com/watch?v=lmnopqrstuv', title: 'Segunda' },
      ],
      playlist: { id: 'PL123', title: 'Nuestro desacato' },
    });
    assert.equal(invocation.command, '/opt/yt-dlp');
    assert.ok(invocation.args.includes('--flat-playlist'));
    assert.equal(invocation.args[invocation.args.indexOf('--print') + 1], '%(id)s\t%(title)s');
    assert.equal(invocation.args.at(-1), 'https://www.youtube.com/playlist?list=PL123');
    assert.equal(invocation.options.shell, undefined);
  });

  test('rechaza URLs que no sean playlists y oculta errores de yt-dlp', async () => {
    const invalid = await handlePlaylist(playlistRequest('https://example.com/?url=http://127.0.0.1'), { spawnImpl: () => fakeProcess('') });
    assert.equal(invalid.status, 400);
    const failed = await handlePlaylist(playlistRequest('https://www.youtube.com/playlist?list=PL123'), {
      spawnImpl: () => fakeProcess('', 1),
      fetchImpl: async () => new Response('', { status: 404 }),
    });
    assert.equal(failed.status, 502);
    assert.match((await failed.json()).error, /No se pudo leer/);
  });

  test('lee el título original de un vídeo individual, incluidos los enlaces cortos', async () => {
    let calls = 0;
    const response = await handlePlaylist(playlistRequest('https://youtu.be/abcdefghijk'), {
      spawnImpl: () => { throw new Error('No debe enumerar un vídeo individual'); },
      fetchImpl: async (url) => {
        calls += 1;
        const parsed = new URL(url);
        assert.equal(parsed.pathname, '/oembed');
        assert.equal(parsed.searchParams.get('url'), videoUrl);
        return new Response(JSON.stringify({ title: 'Título original & versión oficial' }), { status: 200 });
      },
    });
    assert.equal(response.status, 200);
    assert.equal(calls, 1);
    assert.deepEqual(await response.json(), { items: [
      { url: 'https://youtu.be/abcdefghijk', title: 'Título original & versión oficial' },
    ] });
  });

  test('usa los metadatos HTML si YouTube no ofrece oEmbed', async () => {
    const html = 'var ytInitialPlayerResponse = ' + JSON.stringify({
      videoDetails: { videoId: 'abcdefghijk', title: 'Título alternativo' },
    }) + ';';
    const response = await handlePlaylist(playlistRequest(videoUrl), {
      spawnImpl: () => { throw new Error('No debe necesitar yt-dlp si la página da el título'); },
      fetchImpl: async (url) => new URL(url).pathname === '/oembed'
        ? new Response('', { status: 404 })
        : new Response(html, { status: 200 }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { items: [
      { url: videoUrl, title: 'Título alternativo' },
    ] });
  });

  test('usa yt-dlp como último recurso para el título del vídeo individual', async () => {
    const response = await handlePlaylist(playlistRequest(videoUrl), {
      spawnImpl: () => fakeProcess('abcdefghijk\tTítulo de yt-dlp\n'),
      fetchImpl: async (url) => new URL(url).pathname === '/oembed'
        ? new Response('', { status: 404 })
        : new Response('<title>YouTube</title>', { status: 200 }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { items: [
      { url: videoUrl, title: 'Título de yt-dlp' },
    ] });
  });

  test('extrae título de vídeo desde metadatos HTML si falta ytInitialPlayerResponse', () => {
    assert.equal(
      extractVideoTitleHtml('<meta content="Título &amp; artista" property="og:title">'),
      'Título & artista',
    );
    assert.equal(extractVideoTitleHtml('<title>Vídeo original - YouTube</title>'), 'Vídeo original');
    assert.equal(extractVideoTitleHtml('<title>YouTube</title>'), null);
  });

  test('no sustituye un título inaccesible por el ID del vídeo', async () => {
    const response = await handlePlaylist(playlistRequest('https://youtu.be/abcdefghijk'), {
      spawnImpl: () => fakeProcess('', 1),
      fetchImpl: async (url) => new URL(url).pathname === '/oembed'
        ? new Response('{}', { status: 200 })
        : new Response('<title>YouTube</title>', { status: 200 }),
    });
    assert.equal(response.status, 502);
    assert.match((await response.json()).error, /título original/);
  });

  test('recupera una playlist desde ytInitialData si yt-dlp falla', async () => {
    const html = '<meta property="og:title" content="Playlist desde HTML">ytInitialData = ' + JSON.stringify({ contents: [
      { videoId: 'abcdefghijk', title: { runs: [{ text: 'Primera' }] } },
      { videoId: 'lmnopqrstuv', title: { simpleText: 'Segunda' } },
    ] }) + ';';
    assert.deepEqual(extractPlaylistHtml(html), [
      { url: videoUrl, title: 'Primera' },
      { url: 'https://www.youtube.com/watch?v=lmnopqrstuv', title: 'Segunda' },
    ]);

    const response = await handlePlaylist(playlistRequest('https://www.youtube.com/playlist?list=PL123'), {
      spawnImpl: () => fakeProcess('', 1),
      fetchImpl: async () => new Response(html, { status: 200 }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      items: [
        { url: videoUrl, title: 'Primera' },
        { url: 'https://www.youtube.com/watch?v=lmnopqrstuv', title: 'Segunda' },
      ],
      playlist: { id: 'PL123', title: 'Playlist desde HTML' },
    });
  });

  test('lee la playlist y sus continuaciones desde YouTube Music si yt-dlp falla', async () => {
    const requests = [];
    const page = '<meta property="og:title" content="Nuestro desacato">'
      + '<script>{"INNERTUBE_API_KEY":"test-key","INNERTUBE_CLIENT_VERSION":"1.2.3"}</script>';
    const renderer = (id, title) => ({
      musicResponsiveListItemRenderer: {
        playlistItemData: { videoId: id },
        flexColumns: [{
          musicResponsiveListItemFlexColumnRenderer: {
            text: { runs: [{ text: title }] },
          },
        }],
      },
    });
    const response = await handlePlaylist(playlistRequest('https://www.youtube.com/playlist?list=PL123'), {
      spawnImpl: () => fakeProcess('', 1),
      fetchImpl: async (target, init = {}) => {
        const url = new URL(target);
        requests.push({ url, init });
        assert.match(init.headers['User-Agent'], /^Mozilla\/5\.0 .*Chrome\//);
        if (url.pathname === '/oembed') return new Response('', { status: 404 });
        if (url.hostname === 'music.youtube.com' && url.pathname === '/playlist') {
          return new Response(page, { status: 200 });
        }
        assert.equal(url.hostname, 'music.youtube.com');
        assert.equal(url.pathname, '/youtubei/v1/browse');
        const body = JSON.parse(init.body);
        if (body.browseId) {
          assert.equal(body.browseId, 'VLPL123');
          return new Response(JSON.stringify({
            contents: {
              musicPlaylistShelfRenderer: {
                contents: [renderer('abcdefghijk', 'Primera')],
                continuations: [{ nextContinuationData: { continuation: 'NEXT' } }],
              },
            },
          }), { status: 200 });
        }
        assert.equal(body.continuation, 'NEXT');
        return new Response(JSON.stringify({
          continuationContents: { musicPlaylistShelfContinuation: { contents: [renderer('lmnopqrstuv', 'Segunda')] } },
        }), { status: 200 });
      },
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      items: [
        { url: videoUrl, title: 'Primera' },
        { url: 'https://www.youtube.com/watch?v=lmnopqrstuv', title: 'Segunda' },
      ],
      playlist: { id: 'PL123', title: 'Nuestro desacato' },
    });
    assert.equal(requests.filter(({ url }) => url.pathname === '/youtubei/v1/browse').length, 2);
  });

  test('no crea títulos de playlist usando solo el ID si YouTube no da título', async () => {
    assert.deepEqual(extractPlaylistHtml('{"videoId":"abcdefghijk"}'), []);
    assert.throws(
      () => extractPlaylist({
        url: new URL('https://www.youtube.com/playlist?list=PL123'),
        stdout: 'abcdefghijk\t\n',
        code: 0,
      }),
      /no devolvió el título original/,
    );
  });

  test('usa el fallback también si yt-dlp no llega a arrancar', async () => {
    const html = '<meta property="og:title" content="Playlist desde HTML">ytInitialData = ' + JSON.stringify({ contents: [
      { videoId: 'abcdefghijk', title: { simpleText: 'Primera' } },
    ] }) + ';';
    const response = await handlePlaylist(playlistRequest('https://www.youtube.com/playlist?list=PL123'), {
      spawnImpl: () => {
        const child = new EventEmitter();
        child.kill = () => {};
        queueMicrotask(() => child.emit('error', Object.assign(new Error('yt-dlp no disponible'), { code: 'EFAIL' })));
        return child;
      },
      fetchImpl: async () => new Response(html, { status: 200 }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      items: [{ url: videoUrl, title: 'Primera' }],
      playlist: { id: 'PL123', title: 'Playlist desde HTML' },
    });
  });

  test('fija WAV/original y solo devuelve el identificador del job', async () => {
    let body;
    const response = await handleConvert(new Request('https://reminiscencia.test/api/youtube/convert', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: videoUrl, title: 'Tema', format: 'mp3', quality: 'low' }),
    }), {
      fetchImpl: async (_url, init) => {
        body = JSON.parse(init.body);
        return new Response(JSON.stringify({ jobId: 'job_123' }), { status: 200 });
      },
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { jobId: 'job_123' });
    assert.deepEqual(body, { url: videoUrl, title: 'Tema', format: 'wav', quality: 'original' });
  });

  test('normaliza un enlace corto antes de enviarlo al conversor', async () => {
    let body;
    const response = await handleConvert(new Request('https://reminiscencia.test/api/youtube/convert', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://youtu.be/abcdefghijk?si=demo', title: '' }),
    }), {
      fetchImpl: async (_url, init) => {
        body = JSON.parse(init.body);
        return new Response(JSON.stringify({ jobId: 'job_123' }), { status: 200 });
      },
    });
    assert.equal(response.status, 200);
    assert.equal(body.url, videoUrl);
  });

  test('explica el código y el mensaje seguro cuando yttowav rechaza la conversión', async () => {
    const response = await handleConvert(new Request('https://reminiscencia.test/api/youtube/convert', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: videoUrl, title: 'Tema' }),
    }), {
      fetchImpl: async () => new Response(JSON.stringify({ error: 'Servicio temporalmente saturado' }), {
        status: 503,
        headers: { 'retry-after': '30' },
      }),
    });
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('retry-after'), '30');
    assert.deepEqual(await response.json(), {
      ok: false,
      error: 'El servicio de conversión rechazó la canción (HTTP 503): Servicio temporalmente saturado.',
    });
  });

  test('filtra el estado y transmite un WAV sin aceptar una URL de descarga externa', async () => {
    const status = await handleStatus(new Request('https://reminiscencia.test/api/youtube/status?jobId=job_123'), {
      fetchImpl: async () => new Response(JSON.stringify({ status: 'completed', downloadUrl: 'https://attacker.test/file' }), { status: 200 }),
    });
    assert.deepEqual(await status.json(), { status: 'completed' });

    const queuedStatus = await handleStatus(new Request('https://reminiscencia.test/api/youtube/status?jobId=job_123', {
      headers: { 'x-homeostasia-trace': '0123456789abcdef0123456789abcdef', 'x-homeostasia-poll': '1' },
    }), {
      fetchImpl: async () => new Response(JSON.stringify({
        status: 'queued',
        queuePosition: 37,
        queueLength: 50,
        progress: 0,
      }), { status: 200 }),
    });
    assert.deepEqual(await queuedStatus.json(), {
      status: 'queued',
      queuePosition: 37,
      queueLength: 50,
      progress: 0,
    });

    const expiredStatus = await handleStatus(new Request('https://reminiscencia.test/api/youtube/status?jobId=job_123'), {
      fetchImpl: async () => new Response(JSON.stringify({ error: 'Job not found.' }), { status: 404 }),
    });
    assert.equal(expiredStatus.status, 404);
    assert.deepEqual(await expiredStatus.json(), {
      ok: false,
      error: 'La conversión ya no está disponible.',
    });

    const invalidStatus = await handleStatus(new Request('https://reminiscencia.test/api/youtube/status?jobId=job_123'), {
      fetchImpl: async () => new Response(JSON.stringify({}), { status: 200 }),
    });
    assert.equal(invalidStatus.status, 502);
    assert.match((await invalidStatus.json()).error, /estado inválido/);

    const statusByUrl = await handleStatus(new Request('https://reminiscencia.test/api/youtube/status?jobId=job_123'), {
      fetchImpl: async () => new Response(JSON.stringify({ status: 'processing', downloadUrl: '/api/download/?jobId=job_123' }), { status: 200 }),
    });
    assert.deepEqual(await statusByUrl.json(), { status: 'completed' });

    const invalidQueueMetrics = await handleStatus(new Request('https://reminiscencia.test/api/youtube/status?jobId=job_123'), {
      fetchImpl: async () => new Response(JSON.stringify({
        status: 'queued',
        queuePosition: '37',
        queueLength: 50,
        progress: 101,
      }), { status: 200 }),
    });
    assert.deepEqual(await invalidQueueMetrics.json(), { status: 'queued', queueLength: 50 });

    const wav = new Uint8Array(48);
    wav.set(new TextEncoder().encode('RIFF'), 0);
    wav.set(new TextEncoder().encode('WAVE'), 8);
    const urls = [];
    const download = await handleDownload(new Request('https://reminiscencia.test/api/youtube/download?jobId=job_123'), {
      fetchImpl: async (url) => {
        urls.push(url);
        if (String(url).includes('/api/status')) return new Response(JSON.stringify({ status: 'completed' }), { status: 200 });
        return new Response(wav, { status: 200, headers: { 'content-type': 'audio/wav', 'content-length': '48' } });
      },
    });
    assert.equal(download.status, 200);
    assert.equal(download.headers.get('content-type'), 'audio/wav');
    assert.equal((await download.arrayBuffer()).byteLength, 48);
    assert.ok(urls.some((url) => String(url).startsWith('https://api.yttowav.org/api/download/')));
    assert.ok(!urls.some((url) => String(url).includes('attacker.test')));
  });
});
