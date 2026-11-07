// Pruebas del gestor de descargas sin conexión (frontend/web/js/offline-downloads.js, ADR-0033): concurrencia con
// límite, lo ya guardado no se baja, una canción compartida se baja una vez, progreso «n de N» y bytes, cancelar,
// reintentos y continuar tras recargar sin duplicar. Red y caché simuladas; datos ficticios.
// Ejecución: node --test tests/web-unit/offline-downloads.test.mjs

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  createOfflineDownloads,
  downloadResultText,
  downloadStatusText,
  OFFLINE_CONCURRENCY,
  OFFLINE_JOBS_KEY,
  parseJobs,
} from '../../frontend/web/js/offline-downloads.js';

const songs = (...ids) => ids.map((id) => ({ id }));
const path = (id) => `audio/${id}.opus`;

class MemoryStorage {
  constructor() {
    this.data = new Map();
  }

  getItem(key) {
    return this.data.has(key) ? this.data.get(key) : null;
  }

  setItem(key, value) {
    this.data.set(key, String(value));
  }

  removeItem(key) {
    this.data.delete(key);
  }
}

/** Red simulada: cada canción espera hasta que la prueba la deja terminar (finish) o fallar (fail). */
function fakeNetwork() {
  const pending = new Map();
  const calls = [];
  let active = 0;
  let maxActive = 0;
  const saved = new Set();
  const download = (url, { signal, onBytes }) => {
    calls.push(url);
    active += 1;
    maxActive = Math.max(maxActive, active);
    return new Promise((resolve, reject) => {
      const done = (fn) => (value) => {
        if (!pending.has(url)) return;
        pending.delete(url);
        active -= 1;
        fn(value);
      };
      const entry = {
        finish: done((bytes = 1000) => {
          onBytes(bytes);
          saved.add(url);
          resolve();
        }),
        fail: done((message = 'HTTP 503') => reject(new Error(message))),
        abort: done(() => reject(Object.assign(new Error('Descarga cancelada.'), { name: 'AbortError' }))),
      };
      pending.set(url, entry);
      signal.addEventListener('abort', () => entry.abort());
    });
  };
  return {
    download,
    calls,
    saved,
    pending: () => [...pending.keys()],
    finish: (url, bytes) => pending.get(url)?.finish(bytes),
    fail: (url, message) => pending.get(url)?.fail(message),
    maxActive: () => maxActive,
  };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));
async function settle() {
  for (let i = 0; i < 5; i += 1) await tick();
}

function setup({ cached = [], storage = new MemoryStorage(), concurrency, retries = 0 } = {}) {
  const net = fakeNetwork();
  const savedEvents = [];
  const manager = createOfflineDownloads({
    listCached: async () => new Set([...cached, ...net.saved]),
    download: net.download,
    storage,
    concurrency,
    retries,
    onSaved: (url) => savedEvents.push(url),
    // Los avisos de bytes se juntan con un temporizador; en las pruebas, al momento.
    setTimer: (fn) => {
      queueMicrotask(fn);
      return 1;
    },
    clearTimer: () => {},
  });
  return { net, manager, storage, savedEvents };
}

describe('gestor de descargas sin conexión (ADR-0033)', () => {
  test('baja varias canciones a la vez, nunca más del límite, y en el orden de la colección', async () => {
    const { net, manager } = setup();
    const ids = Array.from({ length: 10 }, (_, index) => `S${index}`);
    const done = manager.start('canciones', songs(...ids));
    await settle();
    assert.equal(OFFLINE_CONCURRENCY, 4);
    assert.deepEqual(net.pending(), ids.slice(0, 4).map(path));
    while (net.pending().length > 0) {
      net.finish(net.pending()[0]);
      await settle();
    }
    const result = await done;
    assert.equal(net.maxActive(), 4);
    assert.deepEqual(net.calls, ids.map(path));
    assert.equal(result.added, 10);
    assert.deepEqual(result.failed, []);
    assert.equal(manager.isRunning('canciones'), false);
  });

  test('lo ya guardado no se vuelve a bajar y cuenta como hecho en «n de N»', async () => {
    const { net, manager } = setup({ cached: [path('S1'), path('S3')] });
    const done = manager.start('album:F1', songs('S1', 'S2', 'S3', 'S4'));
    await settle();
    assert.deepEqual(manager.progress('album:F1'), { done: 2, total: 4, failed: 0, bytes: 0 });
    assert.equal(downloadStatusText(manager.progress('album:F1')), 'Descargando 2 de 4');
    net.finish(path('S2'), 2_621_440);
    await settle();
    assert.deepEqual(manager.progress('album:F1'), { done: 3, total: 4, failed: 0, bytes: 2_621_440 });
    assert.equal(downloadStatusText(manager.progress('album:F1')), 'Descargando 3 de 4 · 2,5 MB');
    net.finish(path('S4'));
    const result = await done;
    assert.deepEqual([result.added, result.skipped, result.total], [2, 2, 4]);
    assert.deepEqual(net.calls, [path('S2'), path('S4')]);
  });

  test('el progreso nunca retrocede y cada canción guardada se avisa', async () => {
    const { net, manager, savedEvents } = setup();
    const seen = [];
    manager.subscribe(() => {
      const progress = manager.progress('lista:1');
      if (progress) seen.push(progress.done);
    });
    const done = manager.start('lista:1', songs('A', 'B', 'C', 'D', 'E', 'F'));
    await settle();
    for (const url of [path('B'), path('A'), path('D'), path('C'), path('E'), path('F')]) {
      net.finish(url);
      await settle();
    }
    await done;
    assert.deepEqual(seen, [...seen].sort((a, b) => a - b), `sin saltos atrás: ${seen.join(', ')}`);
    assert.deepEqual(savedEvents.sort(), ['A', 'B', 'C', 'D', 'E', 'F'].map(path));
  });

  test('una canción que piden dos descargas a la vez se baja una sola vez y cuenta en las dos', async () => {
    const { net, manager } = setup();
    const album = manager.start('album:F1', songs('S1', 'S2'));
    const all = manager.start('canciones', songs('S1', 'S2', 'S3'));
    await settle();
    for (const url of [path('S1'), path('S2'), path('S3')]) {
      net.finish(url);
      await settle();
    }
    const [a, b] = await Promise.all([album, all]);
    assert.deepEqual(net.calls, [path('S1'), path('S2'), path('S3')]);
    assert.equal(a.added, 2);
    assert.equal(b.added, 3);
  });

  test('pulsar dos veces no duplica: devuelve la descarga que ya está en marcha', async () => {
    const { net, manager } = setup();
    const first = manager.start('album:F1', songs('S1'));
    const second = manager.start('album:F1', songs('S1'));
    assert.equal(first, second);
    await settle();
    net.finish(path('S1'));
    await first;
    assert.deepEqual(net.calls, [path('S1')]);
  });

  test('cancelar corta lo suyo, conserva lo guardado y no toca lo que otra descarga también necesita', async () => {
    const { net, manager } = setup({ concurrency: 2 });
    const album = manager.start('album:F1', songs('S1', 'S2', 'S3'));
    const other = manager.start('lista:1', songs('S2'));
    await settle();
    net.finish(path('S1'));
    await settle();
    // S2 (compartida) y S3 se están bajando.
    assert.deepEqual(net.pending(), [path('S2'), path('S3')]);
    assert.equal(manager.cancel('album:F1'), true);
    await settle();
    const result = await album;
    assert.equal(result.cancelled, true);
    assert.equal(result.added, 1, 'S1 ya estaba guardada y se queda');
    assert.deepEqual(net.pending(), [path('S2')], 'S3 se corta; S2 sigue para la lista');
    assert.equal(manager.isRunning('album:F1'), false);
    net.finish(path('S2'));
    assert.equal((await other).added, 1);
    assert.equal(downloadResultText(result), 'Se ha cancelado la descarga. Lo ya descargado se queda en este dispositivo.');
  });

  test('cancelar antes de empezar no baja nada', async () => {
    const { net, manager } = setup({ concurrency: 1 });
    const first = manager.start('album:F1', songs('S1'));
    const second = manager.start('album:F2', songs('S2', 'S3'));
    await settle();
    manager.cancel('album:F2');
    net.finish(path('S1'));
    await first;
    await second;
    await settle();
    assert.deepEqual(net.calls, [path('S1')]);
  });

  test('una canción que falla se reintenta; si sigue fallando, las demás terminan y se cuenta el fallo', async () => {
    const { net, manager } = setup({ retries: 1 });
    const done = manager.start('album:F1', songs('S1', 'S2'));
    await settle();
    net.fail(path('S1'));
    await settle();
    assert.deepEqual(net.pending(), [path('S2'), path('S1')], 'S1 vuelve a pedirse');
    net.fail(path('S1'), 'HTTP 404');
    net.finish(path('S2'));
    const result = await done;
    assert.equal(result.added, 1);
    assert.deepEqual(result.failed, [{ url: path('S1'), error: 'HTTP 404' }]);
    assert.equal(downloadResultText(result), 'No se han podido descargar 1 de 2 canciones. Vuelve a pulsar para reintentarlo.');
  });

  test('los bytes de un intento fallido no cuentan', async () => {
    const net = fakeNetwork();
    let attempt = 0;
    const manager = createOfflineDownloads({
      download: async (url, { onBytes }) => {
        attempt += 1;
        onBytes(500);
        if (attempt === 1) throw new Error('corte');
      },
      retries: 1,
      setTimer: (fn) => {
        queueMicrotask(fn);
        return 1;
      },
    });
    const result = await manager.start('album:F1', songs('S1'));
    assert.equal(result.added, 1);
    assert.equal(attempt, 2);
    assert.equal(net.calls.length, 0);
  });

  test('se guarda en localStorage y, al volver a abrir, sigue sin bajar otra vez lo ya guardado', async () => {
    const storage = new MemoryStorage();
    const first = setup({ storage });
    first.manager.start('album:F1', songs('S1', 'S2', 'S3'));
    await settle();
    first.net.finish(path('S1'));
    await settle();
    assert.deepEqual(parseJobs(storage.getItem(OFFLINE_JOBS_KEY)), [{ contextId: 'album:F1', urls: ['S1', 'S2', 'S3'].map(path) }]);
    // Se cierra la página con S2 y S3 a medias: otra instancia con la misma caché (S1 guardada).
    const second = setup({ storage, cached: [path('S1')] });
    const resumed = second.manager.resume();
    assert.deepEqual([...resumed.keys()], ['album:F1']);
    await settle();
    assert.deepEqual(second.manager.progress('album:F1'), { done: 1, total: 3, failed: 0, bytes: 0 });
    assert.deepEqual(second.net.pending(), [path('S2'), path('S3')]);
    assert.equal(second.manager.resume().size, 0, 'retomar otra vez no duplica');
    second.net.finish(path('S2'));
    second.net.finish(path('S3'));
    const result = await resumed.get('album:F1');
    assert.equal(result.added, 2);
    assert.equal(storage.getItem(OFFLINE_JOBS_KEY), null, 'al terminar no queda nada pendiente');
  });

  test('lo guardado mal formado se ignora sin lanzar', () => {
    assert.deepEqual(parseJobs('no es json'), []);
    assert.deepEqual(parseJobs(JSON.stringify({ version: 9, jobs: [] })), []);
    assert.deepEqual(parseJobs(JSON.stringify({ version: 1, jobs: [
      { contextId: 'album:F1', urls: ['audio/S1.opus', '../x', 'audio/S1.opus', 7] },
      { contextId: '', urls: ['audio/S2.opus'] },
      { contextId: 'lista:2', urls: [] },
    ] })), [{ contextId: 'album:F1', urls: ['audio/S1.opus'] }]);
  });

  test('las canciones subidas a este navegador no se descargan y una colección sin nada que bajar termina enseguida', async () => {
    const { net, manager } = setup();
    const result = await manager.start('locales', [{ id: 'L0011223344556677', local: true }]);
    assert.deepEqual([result.total, result.added], [0, 0]);
    assert.deepEqual(net.calls, []);
  });
});
