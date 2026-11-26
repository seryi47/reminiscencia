// Tests del cliente de preflight de cache R2 (ADR-0052). El fetch se mockea con una función.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { youtubeCacheCheck, concurrencyFor } from '../../frontend/web/js/youtube-cache-client.js';

describe('youtubeCacheCheck preflight', () => {
  test('llama al endpoint con POST y la lista de urls', async () => {
    let seen = null;
    const fetchImpl = async (url, init) => {
      seen = { url, method: init.method, body: JSON.parse(init.body) };
      return new Response(JSON.stringify({ hits: [{ url: 'https://y/1', videoId: 'a'.repeat(11) }], misses: [], invalid: [] }), { status: 200 });
    };
    const out = await youtubeCacheCheck(['https://y/1', 'https://y/2'], { fetchImpl });
    assert.equal(seen.url, '/api/youtube/cache/check');
    assert.equal(seen.method, 'POST');
    assert.deepEqual(seen.body.urls, ['https://y/1', 'https://y/2']);
    assert.equal(out.hits.length, 1);
    assert.equal(out.hitRate, 1);
  });

  test('resultado vacío si no hay urls', async () => {
    const out = await youtubeCacheCheck([], { fetchImpl: () => { throw new Error('nunca'); } });
    assert.deepEqual(out.hits, []);
    assert.deepEqual(out.misses, []);
    assert.equal(out.hitRate, 0);
  });

  test('si el fetch falla, trata todo como miss sin romper el flujo', async () => {
    const fetchImpl = async () => { throw new Error('red muerta'); };
    const out = await youtubeCacheCheck(['https://y/1'], { fetchImpl });
    assert.equal(out.hits.length, 0);
    assert.equal(out.misses.length, 1);
    assert.equal(out.misses[0].url, 'https://y/1');
  });

  test('si el servidor responde != 2xx, tampoco bloquea', async () => {
    const fetchImpl = async () => new Response('no', { status: 503 });
    const out = await youtubeCacheCheck(['https://y/1'], { fetchImpl });
    assert.equal(out.hits.length, 0);
    assert.equal(out.misses.length, 1);
  });

  test('hitRate correcto en una mezcla', async () => {
    const fetchImpl = async () => new Response(JSON.stringify({
      hits: [{ url: 'h1', videoId: 'a'.repeat(11) }, { url: 'h2', videoId: 'b'.repeat(11) }, { url: 'h3', videoId: 'c'.repeat(11) }],
      misses: [{ url: 'm1', videoId: 'd'.repeat(11) }],
      invalid: [],
    }), { status: 200 });
    const out = await youtubeCacheCheck(['h1', 'h2', 'h3', 'm1'], { fetchImpl });
    assert.equal(out.hitRate, 0.75);
  });

  test('concurrencyFor recomienda 8 para cache y 2 para yttowav', () => {
    assert.equal(concurrencyFor('cache'), 8);
    assert.equal(concurrencyFor('yttowav'), 2);
    assert.equal(concurrencyFor(''), 2);
  });
});
