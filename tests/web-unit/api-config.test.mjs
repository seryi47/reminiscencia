// Pruebas de la dirección del API con respaldo en Vercel (frontend/web/js/api-config.js; ADR-0029): constante vacía =
// todo por Vercel; con Worker, las peticiones van a él y, si no responde (red, tiempo, respuesta que no es suya), se
// repiten en Vercel y durante un rato se va directamente a Vercel; la subida elige el sitio por archivo con su tamaño de
// trozo. Ejecución: node --test tests/web-unit/api-config.test.mjs
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  createApiClient,
  normalizeApiBase,
  RETRY_WORKER_AFTER_MS,
  VERCEL_CHUNK_BYTES,
  WORKER_API_BASE,
  WORKER_CHUNK_BYTES,
  WORKER_HEADER,
} from '../../frontend/web/js/api-config.js';
import { CHUNK_BYTES, sendOpus } from '../../frontend/web/js/cuidador/subida-publica.js';
import { VERCEL_MAX_CHUNK_BYTES, WORKER_MAX_CHUNK_BYTES } from '../../frontend/web/server/upload-core.js';
import { buildOggOpus } from '../../frontend/web/js/cuidador/subida-local.js';

const BASE = 'https://reminiscencia-api.prueba.workers.dev';
const fromWorker = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { [WORKER_HEADER]: '1' } });
const plain = (body, status = 200) => new Response(JSON.stringify(body), { status });

function recorder(handler) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    return handler(url, init);
  };
  return { calls, fetchImpl };
}

describe('configuración', () => {
  test('una sola constante, vacía hasta desplegar el Worker; tamaños de trozo comunes con el servidor', () => {
    assert.equal(typeof WORKER_API_BASE, 'string');
    assert.equal(VERCEL_CHUNK_BYTES, 4 * 1024 * 1024);
    assert.equal(WORKER_CHUNK_BYTES, 32 * 1024 * 1024);
    assert.equal(VERCEL_MAX_CHUNK_BYTES, VERCEL_CHUNK_BYTES);
    assert.equal(WORKER_MAX_CHUNK_BYTES, WORKER_CHUNK_BYTES);
    assert.equal(CHUNK_BYTES, VERCEL_CHUNK_BYTES);
  });

  test('normalizeApiBase: solo un origen https (o http local), sin barra ni ruta', () => {
    assert.equal(normalizeApiBase(` ${BASE}/ `), BASE);
    assert.equal(normalizeApiBase('http://localhost:8787'), 'http://localhost:8787');
    assert.equal(normalizeApiBase('http://ejemplo.workers.dev'), '');
    assert.equal(normalizeApiBase(`${BASE}/api`), '');
    assert.equal(normalizeApiBase('no es una url'), '');
    assert.equal(normalizeApiBase(''), '');
    assert.equal(normalizeApiBase(null), '');
  });
});

describe('sin Worker', () => {
  test('todo va a Vercel (ruta relativa del propio origen) y la subida usa trozos de 4 MB', async () => {
    const { calls, fetchImpl } = recorder(() => plain({ ok: true }));
    const api = createApiClient({ base: '', fetchImpl });
    assert.equal(api.usesWorker(), false);
    await api.fetch('/api/editar', { method: 'POST' });
    assert.equal(calls[0].url, '/api/editar');
    const target = await api.uploadTarget();
    assert.deepEqual([target.worker, target.chunkBytes, target.base], [false, VERCEL_CHUNK_BYTES, '']);
    assert.equal(calls.length, 1, 'sin Worker no se pregunta a /api/salud');
    await assert.rejects(api.workerFetch('/api/portadas'));
  });
});

describe('con Worker', () => {
  test('las peticiones van al Worker si responde', async () => {
    const { calls, fetchImpl } = recorder(() => fromWorker({ ok: true }));
    const api = createApiClient({ base: `${BASE}/`, fetchImpl });
    const response = await api.fetch('/api/editar?incidencia=3', { cache: 'no-store' });
    assert.equal(response.status, 200);
    assert.deepEqual(calls.map((call) => call.url), [`${BASE}/api/editar?incidencia=3`]);
    assert.equal(calls[0].init.cache, 'no-store');
  });

  test('si el Worker no responde (red o CORS), se repite en Vercel y se sigue en Vercel un rato', async () => {
    let clock = 0;
    const { calls, fetchImpl } = recorder((url) => {
      if (url.startsWith(BASE)) throw new TypeError('Failed to fetch');
      return plain({ ok: true, de: 'vercel' });
    });
    const api = createApiClient({ base: BASE, fetchImpl, now: () => clock });
    assert.deepEqual(await (await api.fetch('/api/editar', { method: 'POST', body: '{}' })).json(), { ok: true, de: 'vercel' });
    assert.deepEqual(calls.map((call) => call.url), [`${BASE}/api/editar`, '/api/editar']);
    assert.equal(calls[1].init.body, '{}');
    assert.equal(api.usesWorker(), false);
    await api.fetch('/api/editar');
    assert.equal(calls.at(-1).url, '/api/editar');
    assert.equal(calls.length, 3);
    // Pasado el rato, se vuelve a probar el Worker.
    clock = RETRY_WORKER_AFTER_MS;
    assert.equal(api.usesWorker(), true);
    await api.fetch('/api/editar');
    assert.equal(calls[3].url, `${BASE}/api/editar`);
  });

  test('una respuesta sin la cabecera del Worker (página de error de Cloudflare) también pasa a Vercel', async () => {
    const { calls, fetchImpl } = recorder((url) => (url.startsWith(BASE) ? new Response('<html>error 1101</html>', { status: 500 }) : plain({ ok: true })));
    const api = createApiClient({ base: BASE, fetchImpl });
    const response = await api.fetch('/api/subir', { method: 'POST' });
    assert.equal(response.status, 200);
    assert.deepEqual(calls.map((call) => call.url), [`${BASE}/api/subir`, '/api/subir']);
  });

  test('un error del propio Worker (con su cabecera) se respeta: no se repite en Vercel', async () => {
    const { calls, fetchImpl } = recorder(() => fromWorker({ ok: false, error: 'No.' }, 400));
    const api = createApiClient({ base: BASE, fetchImpl });
    assert.equal((await api.fetch('/api/editar', { method: 'POST' })).status, 400);
    assert.equal(calls.length, 1);
  });

  test('uploadTarget pregunta a /api/salud: con el Worker vivo, trozos de 32 MB y todo el archivo a él', async () => {
    const { calls, fetchImpl } = recorder((url) => (url.endsWith('/api/salud') ? fromWorker({ ok: true, trozoMaximo: WORKER_CHUNK_BYTES }) : fromWorker({ ok: true, parte: 0, partes: 1, mensaje: 'Hecho.' })));
    const api = createApiClient({ base: BASE, fetchImpl });
    const target = await api.uploadTarget();
    assert.deepEqual([target.worker, target.chunkBytes, target.base], [true, WORKER_CHUNK_BYTES, BASE]);
    assert.equal(calls[0].url, `${BASE}/api/salud`);
    // sendOpus con ese destino: los trozos van al Worker con su tamaño.
    const opus = buildOggOpus({ packets: [{ data: new Uint8Array([0xf8, 0xff, 0xfe]), samples: 960 }], channels: 1 });
    await sendOpus(opus, { fileName: 'a.mp3', uploadId: '0f8fad5b-d9cb-469f-a165-70867728950e', fetchImpl: target.fetch, chunkBytes: target.chunkBytes });
    assert.equal(calls.at(-1).url, `${BASE}/api/subir`);
  });

  test('uploadTarget con el Worker caído (o lento): Vercel con trozos de 4 MB', async () => {
    const { fetchImpl } = recorder((url) => {
      if (url.startsWith(BASE)) throw new TypeError('Failed to fetch');
      return plain({ ok: true });
    });
    const api = createApiClient({ base: BASE, fetchImpl });
    const target = await api.uploadTarget();
    assert.deepEqual([target.worker, target.chunkBytes], [false, VERCEL_CHUNK_BYTES]);
    const slow = createApiClient({
      base: BASE,
      probeTimeoutMs: 20,
      fetchImpl: (url, init) => new Promise((resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('abort', 'AbortError')));
      }),
    });
    assert.equal((await slow.uploadTarget()).worker, false);
  });

  test('workerFetch solo usa el Worker y marca el fallo', async () => {
    const { fetchImpl } = recorder(() => plain({}));
    const api = createApiClient({ base: BASE, fetchImpl });
    await assert.rejects(api.workerFetch('/api/portadas'));
    assert.equal(api.usesWorker(), false);
  });
});
