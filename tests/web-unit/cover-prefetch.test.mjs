import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { prefetchImage, prefetchBatch, createCoverPrefetcher } from '../../frontend/web/js/cover-prefetch.js';

describe('cover-prefetch (ADR-0052)', () => {
  let imagesCreated;
  beforeEach(() => {
    imagesCreated = [];
    globalThis.Image = class {
      constructor() { imagesCreated.push(this); }
      set src(v) { this._src = v; }
      get src() { return this._src; }
    };
  });

  test('prefetchImage ignora entradas vacías o no-string', () => {
    prefetchImage(null);
    prefetchImage('');
    prefetchImage(undefined);
    assert.equal(imagesCreated.length, 0);
  });

  test('prefetchImage crea un new Image con src', () => {
    prefetchImage('/thumbs/S1.jpg');
    assert.equal(imagesCreated.length, 1);
    assert.equal(imagesCreated[0].src, '/thumbs/S1.jpg');
  });

  test('prefetchBatch no re-precarga lo ya visto', () => {
    const seen = new Set();
    prefetchBatch(['/a.jpg', '/b.jpg'], seen);
    prefetchBatch(['/a.jpg', '/c.jpg'], seen);
    assert.equal(imagesCreated.length, 3);
  });

  test('createCoverPrefetcher sin IntersectionObserver prefetcha inmediato', () => {
    const pf = createCoverPrefetcher({ IOClass: null });
    pf.observe({}, () => ['/x.jpg', '/y.jpg']);
    assert.equal(imagesCreated.length, 2);
  });

  test('stop() es idempotente', () => {
    const pf = createCoverPrefetcher({ IOClass: null });
    pf.stop();
    pf.stop();
  });
});
