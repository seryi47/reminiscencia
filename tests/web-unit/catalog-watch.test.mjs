// watchCatalog (long-poll del catálogo, ADR-0052 tiempo real sin coste).

import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';

import { watchCatalog, WAIT_PATH, CATALOG_PATH } from '../../frontend/web/js/catalog-remote.js';

function makeDoc() {
  let state = 'visible';
  const listeners = [];
  return {
    get visibilityState() { return state; },
    set(value) {
      state = value;
      for (const l of listeners.slice()) l();
    },
    addEventListener(name, l) { if (name === 'visibilitychange') listeners.push(l); },
    removeEventListener(name, l) { if (name === 'visibilitychange') {
      const i = listeners.indexOf(l);
      if (i !== -1) listeners.splice(i, 1);
    } },
  };
}

function jsonResponse(status, body, headers = {}) {
  const payload = body === null ? null : JSON.stringify(body);
  return new Response(payload, { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers } });
}

describe('watchCatalog (ADR-0052)', () => {
  test('al recibir 200 con v8 llama onUpdate con el catálogo nuevo y guarda la versión', async () => {
    let version = 7;
    const updates = [];
    const calls = [];
    const fetchImpl = async (url) => {
      calls.push(url);
      if (url.startsWith(WAIT_PATH)) {
        if (version === 7) { version = 8; return jsonResponse(200, { version: 8, folders: [], songs: [{ id: 'a' }] }); }
        // Siguiente iteración: devolver 204 para que el bucle quede en espera y las pruebas puedan parar.
        return new Response(null, { status: 204 });
      }
      throw new Error('fetch inesperado ' + url);
    };
    const watcher = watchCatalog({
      getVersion: () => version,
      onUpdate: (catalog) => { updates.push(catalog); },
      fetchImpl,
      doc: makeDoc(),
      sleep: () => Promise.resolve(),
      waitTimeoutS: 1,
      fallbackIntervalMs: 60_000,
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    await watcher.stop();
    assert.ok(updates.length >= 1, `debía haber al menos un update, hubo ${updates.length}`);
    assert.equal(updates[0].version, 8);
    assert.equal(updates[0].songs.length, 1);
  });

  test('en error de red hace backoff y reintenta sin propagar la excepción', async () => {
    const errors = [];
    let callCount = 0;
    const sleeps = [];
    const fetchImpl = async () => {
      callCount += 1;
      if (callCount <= 2) {
        const err = new Error('boom');
        err.name = 'TypeError';
        throw err;
      }
      return new Response(null, { status: 204 });
    };
    const watcher = watchCatalog({
      getVersion: () => 0,
      onUpdate: () => {},
      onError: (e) => errors.push(e),
      fetchImpl,
      doc: makeDoc(),
      sleep: (ms) => { sleeps.push(ms); return Promise.resolve(); },
      waitTimeoutS: 1,
      fallbackIntervalMs: 60_000,
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    await watcher.stop();
    assert.ok(errors.length >= 2, 'onError debía dispararse en los dos errores');
    assert.ok(sleeps.length >= 2, 'tiene que haber al menos dos sleeps de backoff');
    assert.ok(sleeps[0] >= 1000, 'primer backoff >= 1000 ms');
    assert.ok(sleeps[1] >= 2000, 'segundo backoff >= 2000 ms');
  });

  test('cuando visibilityState es "hidden" el bucle se pausa y aborta el fetch en curso', async () => {
    let aborted = false;
    const doc = makeDoc();
    const fetchImpl = async (_url, { signal }) => new Promise((resolve, reject) => {
      signal?.addEventListener('abort', () => { aborted = true; reject(Object.assign(new Error('aborted'), { name: 'AbortError' })); });
    });
    const watcher = watchCatalog({
      getVersion: () => 0,
      onUpdate: () => {},
      fetchImpl,
      doc,
      sleep: () => Promise.resolve(),
      waitTimeoutS: 1,
      fallbackIntervalMs: 60_000,
    });
    // Deja que arranque y se quede esperando (poll hasta 500 ms para robustez en CI con carga).
    for (let i = 0; i < 50 && !aborted; i++) {
      if (i === 10) doc.set('hidden'); // al cabo de ~100 ms, cuando el loop seguro está dentro del fetch.
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(aborted, true, 'el fetch en curso debía abortar al ocultarse la pestaña');
    await watcher.stop();
  });

  test('cada WATCH_FALLBACK_INTERVAL_MS, tras un 204, hace ping a /latest con If-None-Match', async () => {
    const urls = [];
    let timeNow = 0;
    const fetchImpl = async (url, { headers } = {}) => {
      urls.push({ url, headers });
      if (url.startsWith(WAIT_PATH)) return new Response(null, { status: 204 });
      if (url === CATALOG_PATH) return new Response(null, { status: 304 });
      return new Response(null, { status: 500 });
    };
    const watcher = watchCatalog({
      getVersion: () => 7,
      onUpdate: () => {},
      fetchImpl,
      doc: makeDoc(),
      sleep: () => Promise.resolve(),
      now: () => (timeNow += 100_000), // cada llamada avanza mucho tiempo → fuerza fallback en iteraciones sucesivas
      waitTimeoutS: 1,
      fallbackIntervalMs: 60_000,
    });
    await new Promise((resolve) => setTimeout(resolve, 60));
    await watcher.stop();
    const pings = urls.filter((entry) => entry.url === CATALOG_PATH);
    assert.ok(pings.length >= 1, `debía hacer al menos un ping a /latest, hizo ${pings.length}`);
    assert.equal(pings[0].headers?.['If-None-Match'], 'W/"v7"');
  });
});
