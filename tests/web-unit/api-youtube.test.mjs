import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { describe, test } from 'node:test';

import { handlePlaylist } from '../../frontend/web/server/youtube-playlist.js';
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
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { items: [
      { url: videoUrl, title: 'Primera' },
      { url: 'https://www.youtube.com/watch?v=lmnopqrstuv', title: 'Segunda' },
    ] });
    assert.equal(invocation.command, '/opt/yt-dlp');
    assert.ok(invocation.args.includes('--flat-playlist'));
    assert.equal(invocation.args[invocation.args.indexOf('--print') + 1], '%(id)s\t%(title)s');
    assert.equal(invocation.args.at(-1), 'https://www.youtube.com/playlist?list=PL123');
    assert.equal(invocation.options.shell, undefined);
  });

  test('rechaza URLs que no sean playlists y oculta errores de yt-dlp', async () => {
    const invalid = await handlePlaylist(playlistRequest('https://example.com/?url=http://127.0.0.1'), { spawnImpl: () => fakeProcess('') });
    assert.equal(invalid.status, 400);
    const failed = await handlePlaylist(playlistRequest('https://www.youtube.com/playlist?list=PL123'), { spawnImpl: () => fakeProcess('', 1) });
    assert.equal(failed.status, 502);
    assert.match((await failed.json()).error, /No se pudo leer/);
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

  test('filtra el estado y transmite un WAV sin aceptar una URL de descarga externa', async () => {
    const status = await handleStatus(new Request('https://reminiscencia.test/api/youtube/status?jobId=job_123'), {
      fetchImpl: async () => new Response(JSON.stringify({ status: 'completed', downloadUrl: 'https://attacker.test/file' }), { status: 200 }),
    });
    assert.deepEqual(await status.json(), { status: 'completed' });

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
