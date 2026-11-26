// Tests de la cache R2 de YouTube→Opus (ADR-0052 ampliación). Cubre:
//   extracción de videoId/playlistId desde las cuatro formas de URL que acepta YouTube;
//   cacheCheck con mezcla de hits/misses/invalid;
//   convert: HIT devuelve cached:<id> sin tocar yttowav; MISS llama al handler nativo;
//   status y download sintéticos (jobId=cached:<id>) sin depender de yttowav;
//   playlist: HIT respeta TTL y MISS guarda tras scraping.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractVideoId, extractPlaylistId, cachedVideoId,
  cacheGet, cacheGetOpus, cacheCheck, cachePut, cacheHas,
  playlistCacheGet, playlistCachePut,
  CACHE_JOB_PREFIX,
} from '../../worker/src/youtube-cache.js';
import {
  handleCachedConvert, handleCachedStatus, handleCachedDownload,
  handleCacheCheck,
} from '../../worker/src/youtube-cache-handlers.js';
import { fakeR2 } from './r2-falso.mjs';

describe('youtube-cache helpers', () => {
  test('extractVideoId acepta las cuatro formas de URL de YouTube', () => {
    assert.equal(extractVideoId('https://youtu.be/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
    assert.equal(extractVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
    assert.equal(extractVideoId('https://www.youtube.com/shorts/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
    assert.equal(extractVideoId('https://www.youtube.com/embed/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
    assert.equal(extractVideoId('https://youtu.be/dQw4w9WgXcQ?si=abc123'), 'dQw4w9WgXcQ');
    assert.equal(extractVideoId('https://ejemplo.com/watch?v=dQw4w9WgXcQ'), null);
    assert.equal(extractVideoId('not-a-url'), null);
    assert.equal(extractVideoId(null), null);
  });

  test('extractPlaylistId reconoce ?list= pero rechaza youtu.be', () => {
    assert.equal(extractPlaylistId('https://www.youtube.com/playlist?list=PLabc123'), 'PLabc123');
    assert.equal(extractPlaylistId('https://www.youtube.com/watch?v=xxxxxxxxxxx&list=PLabc'), 'PLabc');
    assert.equal(extractPlaylistId('https://youtu.be/dQw4w9WgXcQ'), null);
    assert.equal(extractPlaylistId('https://ejemplo.com/playlist?list=PL'), null);
  });

  test('cachedVideoId decodifica jobId "cached:<id>" sólo si es válido', () => {
    assert.equal(cachedVideoId(`${CACHE_JOB_PREFIX}dQw4w9WgXcQ`), 'dQw4w9WgXcQ');
    assert.equal(cachedVideoId(`${CACHE_JOB_PREFIX}xxx`), null);
    assert.equal(cachedVideoId('job-real-aaaa-bbbb-cccc'), null);
    assert.equal(cachedVideoId(null), null);
  });

  test('cachePut + cacheGet guarda y recupera la meta', async () => {
    const bucket = fakeR2();
    const ok = await cachePut(bucket, 'dQw4w9WgXcQ', {
      opusBytes: new Uint8Array([1, 2, 3, 4, 5]), title: 'Never Gonna', duration_s: 213, sha256: 'ff'.repeat(32),
    });
    assert.equal(ok, true);
    const meta = await cacheGet(bucket, 'dQw4w9WgXcQ');
    assert.equal(meta.videoId, 'dQw4w9WgXcQ');
    assert.equal(meta.duration_s, 213);
    assert.equal(meta.size_bytes, 5);
    assert.equal(meta.source, 'yttowav');
    assert.equal(await cacheHas(bucket, 'dQw4w9WgXcQ'), true);
    assert.equal(await cacheHas(bucket, 'no-existe-xx'), false);
  });

  test('cachePut no cachea vídeos > 15 min', async () => {
    const bucket = fakeR2();
    const ok = await cachePut(bucket, 'dQw4w9WgXcQ', {
      opusBytes: new Uint8Array([1, 2, 3]), duration_s: 20 * 60,
    });
    assert.equal(ok, false);
    assert.equal(await cacheHas(bucket, 'dQw4w9WgXcQ'), false);
  });
});

describe('youtube-cache /cache/check', () => {
  test('clasifica cada URL en hit/miss/invalid', async () => {
    const bucket = fakeR2();
    await cachePut(bucket, 'dQw4w9WgXcQ', { opusBytes: new Uint8Array([7, 7]), duration_s: 213, title: 'rick' });
    const out = await cacheCheck(bucket, [
      'https://youtu.be/dQw4w9WgXcQ',
      'https://www.youtube.com/watch?v=aaaaaaaaaaa',
      'not-a-url',
    ]);
    assert.equal(out.hits.length, 1);
    assert.equal(out.hits[0].videoId, 'dQw4w9WgXcQ');
    assert.equal(out.hits[0].cached, true);
    assert.equal(out.misses.length, 1);
    assert.equal(out.misses[0].videoId, 'aaaaaaaaaaa');
    assert.equal(out.invalid.length, 1);
  });

  test('deduplica el mismo videoId si aparece varias veces', async () => {
    const bucket = fakeR2();
    const out = await cacheCheck(bucket, [
      'https://youtu.be/dQw4w9WgXcQ',
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    ]);
    assert.equal(out.hits.length + out.misses.length, 1);
  });

  test('handleCacheCheck responde 200 con JSON válido', async () => {
    const bucket = fakeR2();
    await cachePut(bucket, 'dQw4w9WgXcQ', { opusBytes: new Uint8Array([1]), duration_s: 100 });
    const req = new Request('https://x/api/youtube/cache/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ urls: ['https://youtu.be/dQw4w9WgXcQ', 'https://youtu.be/aaaaaaaaaaa'] }),
    });
    const res = await handleCacheCheck(req, { PUBLIC_BUCKET: bucket });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.hits.length, 1);
    assert.equal(data.misses.length, 1);
  });

  test('handleCacheCheck 400 si falta "urls"', async () => {
    const req = new Request('https://x/api/youtube/cache/check', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    const res = await handleCacheCheck(req, { PUBLIC_BUCKET: fakeR2() });
    assert.equal(res.status, 400);
  });
});

describe('youtube-cache convert/status/download handlers', () => {
  test('convert HIT: cached:<id> sin llamar al nativo', async () => {
    const bucket = fakeR2();
    await cachePut(bucket, 'dQw4w9WgXcQ', { opusBytes: new Uint8Array([9, 9, 9]), duration_s: 213 });
    let nativeCalls = 0;
    const native = async () => { nativeCalls += 1; return new Response('{"jobId":"must-not-happen"}', { status: 200 }); };
    const req = new Request('https://x/api/youtube/convert', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://youtu.be/dQw4w9WgXcQ' }),
    });
    const res = await handleCachedConvert(req, { PUBLIC_BUCKET: bucket }, native);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.cached, true);
    assert.equal(body.jobId, `${CACHE_JOB_PREFIX}dQw4w9WgXcQ`);
    assert.equal(body.source, 'cache');
    assert.equal(nativeCalls, 0);
  });

  test('convert MISS: delega al handler nativo', async () => {
    const bucket = fakeR2();
    let nativeCalls = 0;
    const native = async () => { nativeCalls += 1; return new Response('{"jobId":"real-job-123"}', { status: 200, headers: { 'Content-Type': 'application/json' } }); };
    const req = new Request('https://x/api/youtube/convert', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://youtu.be/aaaaaaaaaaa' }),
    });
    const res = await handleCachedConvert(req, { PUBLIC_BUCKET: bucket }, native);
    assert.equal(res.status, 200);
    assert.equal(nativeCalls, 1);
  });

  test('status cached:<id> sin consultar yttowav', async () => {
    const bucket = fakeR2();
    const native = async () => { throw new Error('no debería llamarse'); };
    const req = new Request(`https://x/api/youtube/status?jobId=${CACHE_JOB_PREFIX}dQw4w9WgXcQ`);
    const res = await handleCachedStatus(req, { PUBLIC_BUCKET: bucket }, native);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'completed');
    assert.equal(body.cached, true);
  });

  test('download cached:<id> stream desde R2', async () => {
    const bucket = fakeR2();
    await cachePut(bucket, 'dQw4w9WgXcQ', { opusBytes: new Uint8Array([1, 2, 3, 4]), duration_s: 213, sha256: 'ab'.repeat(32) });
    const native = async () => { throw new Error('no debería llamarse'); };
    const req = new Request(`https://x/api/youtube/download?jobId=${CACHE_JOB_PREFIX}dQw4w9WgXcQ`);
    const res = await handleCachedDownload(req, { PUBLIC_BUCKET: bucket }, native);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('X-Cache'), 'HIT');
    assert.equal(res.headers.get('Content-Type'), 'audio/ogg');
    const bytes = new Uint8Array(await res.arrayBuffer());
    assert.deepEqual(Array.from(bytes), [1, 2, 3, 4]);
  });

  test('download cached:<id> pero sin R2 → 404', async () => {
    const bucket = fakeR2();
    const native = async () => { throw new Error('no debería llamarse'); };
    const req = new Request(`https://x/api/youtube/download?jobId=${CACHE_JOB_PREFIX}dQw4w9WgXcQ`);
    const res = await handleCachedDownload(req, { PUBLIC_BUCKET: bucket }, native);
    assert.equal(res.status, 404);
  });
});

describe('youtube-cache playlist', () => {
  test('playlistCacheGet respeta TTL', async () => {
    const bucket = fakeR2();
    const now = 1000;
    await playlistCachePut(bucket, 'PLabc', [{ url: 'https://y/1' }], { ttlMs: 500, now });
    assert.ok(await playlistCacheGet(bucket, 'PLabc', now + 100));
    assert.equal(await playlistCacheGet(bucket, 'PLabc', now + 600), null);
  });

  test('playlistCacheGet rechaza objetos sin items array', async () => {
    const bucket = fakeR2();
    await bucket.put('youtube-cache/playlist/PLx.json', JSON.stringify({ fetchedAt: Date.now() }));
    assert.equal(await playlistCacheGet(bucket, 'PLx'), null);
  });
});
