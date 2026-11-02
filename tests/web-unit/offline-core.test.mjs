// Pruebas del modo sin conexión (node:test, sin navegador).
// Cubren la lógica pura de offline-core.js, el manifiesto y sus iconos, y el comportamiento de
// sw.js y pwa.js sobre cachés y red simuladas. Todos los datos son ficticios.
// Ejecución: node --test tests/web-unit/offline-core.test.mjs

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, beforeEach, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  audioCacheName,
  formatBytes,
  isAudioRequest,
  isDataRequest,
  isShellRequest,
  listAudioUrls,
  parseRange,
  planOfflineDownload,
  SHELL_ASSETS,
  SHELL_VERSION,
  shellCacheName,
} from '../../frontend/web/js/offline-core.js';
import { clearOfflineLibrary, offlineStatus, registerPwa, saveLibraryOffline } from '../../frontend/web/js/pwa.js';

const WEB_DIR = fileURLToPath(new URL('../../frontend/web/', import.meta.url));
const SW_MODULE_URL = new URL('../../frontend/web/sw.js', import.meta.url).href;
const ORIGIN = 'https://reminiscencia.test/';
const SHELL = shellCacheName(SHELL_VERSION);
const AUDIO = audioCacheName();

const originals = {
  fetch: globalThis.fetch,
  caches: globalThis.caches,
  self: globalThis.self,
  navigator: Object.getOwnPropertyDescriptor(globalThis, 'navigator'),
};

// ---------------------------------------------------------------------------------------------
// Entorno simulado: cachés en memoria, red controlada y listeners del service worker.
// ---------------------------------------------------------------------------------------------

const env = { stores: new Map(), routes: new Map(), offline: false, handlers: {} };

/** URL absoluta de una petición (cadena o Request). */
function urlOf(input) {
  return new URL(typeof input === 'string' ? input : input.url, ORIGIN).href;
}

class FakeCache {
  constructor() {
    this.entries = new Map();
  }

  async match(input) {
    const hit = this.entries.get(urlOf(input));
    return hit ? hit.clone() : undefined;
  }

  async put(input, response) {
    this.entries.set(urlOf(input), response);
  }

  async add(input) {
    const response = await fetch(input);
    if (!response.ok) throw new TypeError(`No se pudo guardar ${urlOf(input)} (${response.status})`);
    this.entries.set(urlOf(input), response);
  }

  async keys() {
    return [...this.entries.keys()].map((url) => ({ url }));
  }
}

function resetEnvironment() {
  env.stores = new Map();
  env.routes = new Map();
  env.offline = false;
  globalThis.caches = {
    async open(name) {
      if (!env.stores.has(name)) env.stores.set(name, new FakeCache());
      return env.stores.get(name);
    },
    async has(name) {
      return env.stores.has(name);
    },
    async delete(name) {
      return env.stores.delete(name);
    },
    async keys() {
      return [...env.stores.keys()];
    },
  };
  globalThis.fetch = async (input) => {
    if (env.offline) throw new TypeError('Sin conexión');
    const route = env.routes.get(urlOf(input));
    if (!route) return new Response('No encontrado', { status: 404 });
    return new Response(route.body, { status: route.status ?? 200, headers: route.headers ?? {} });
  };
}

async function putIn(cacheName, path, response) {
  const cache = await caches.open(cacheName);
  await cache.put(new URL(path, ORIGIN).href, response);
}

async function urlsIn(cacheName) {
  const cache = await caches.open(cacheName);
  return (await cache.keys()).map((request) => request.url).sort();
}

/** Lanza un evento fetch simulado y recoge la respuesta y las promesas de waitUntil. */
function dispatchFetch(request) {
  const result = { response: undefined, waits: [] };
  env.handlers.fetch({
    request,
    respondWith(promise) {
      result.response = promise;
    },
    waitUntil(promise) {
      result.waits.push(promise);
    },
  });
  return result;
}

/** Lanza install o activate y espera a que terminen las promesas de waitUntil. */
async function runLifecycle(type) {
  const waits = [];
  env.handlers[type]({
    waitUntil(promise) {
      waits.push(promise);
    },
  });
  await Promise.all(waits);
}

/** Tamaño de un PNG leído de su cabecera IHDR. Falla si la firma o el primer chunk no encajan. */
function readPngSize(buffer) {
  assert.equal(buffer.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'firma PNG');
  assert.equal(buffer.subarray(12, 16).toString('latin1'), 'IHDR', 'chunk IHDR');
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function readManifest() {
  return JSON.parse(readFileSync(join(WEB_DIR, 'manifest.webmanifest'), 'utf8'));
}

function setNavigator(value) {
  Object.defineProperty(globalThis, 'navigator', { value, configurable: true, writable: true });
}

function restoreNavigator() {
  if (originals.navigator) Object.defineProperty(globalThis, 'navigator', originals.navigator);
}

beforeEach(resetEnvironment);

after(() => {
  globalThis.fetch = originals.fetch;
  if (originals.caches === undefined) delete globalThis.caches;
  else globalThis.caches = originals.caches;
  if (originals.self === undefined) delete globalThis.self;
  else globalThis.self = originals.self;
  restoreNavigator();
});

// ---------------------------------------------------------------------------------------------
// offline-core.js: lógica pura
// ---------------------------------------------------------------------------------------------

describe('nombres de caché', () => {
  test('la caché del shell va versionada: reminiscencia-shell-v<N>', () => {
    assert.equal(shellCacheName(1), 'reminiscencia-shell-v1');
    assert.equal(shellCacheName(12), 'reminiscencia-shell-v12');
    assert.equal(shellCacheName(), `reminiscencia-shell-v${SHELL_VERSION}`);
  });

  test('shellCacheName rechaza versiones que no son enteros positivos', () => {
    for (const version of [0, -1, 1.5, 'uno', Number.NaN]) {
      assert.throws(() => shellCacheName(version), RangeError, `versión ${version}`);
    }
  });

  test('la caché de audio tiene nombre fijo y versionado, distinto del shell', () => {
    assert.equal(audioCacheName(), 'reminiscencia-audio-v1');
    assert.notEqual(audioCacheName(), shellCacheName(1));
  });
});

describe('clasificación de peticiones', () => {
  test('reconoce el shell por su ruta, con origen o con query', () => {
    const shellUrls = [
      '/',
      '/index.html',
      '/app.js',
      `${ORIGIN}styles.css?v=3`,
      '/js/pwa.js',
      '/data/songs.json',
      '/icons/icon-512.png',
      '/manifest.webmanifest',
    ];
    for (const url of shellUrls) assert.equal(isShellRequest(url), true, url);
  });

  test('no trata como shell la API, el panel, el propio worker ni el audio', () => {
    const notShell = ['/api/catalog', '/admin/index.html', '/lib/auth.js', '/sw.js', '/audio/demo-1.opus'];
    for (const url of notShell) assert.equal(isShellRequest(url), false, url);
  });

  test('reconoce los datos y los audios por separado', () => {
    assert.equal(isDataRequest('/data/songs.json'), true);
    assert.equal(isDataRequest('/app.js'), false);
    assert.equal(isDataRequest('/data/notas.txt'), false);
    assert.equal(isAudioRequest('/audio/demo-1.opus'), true);
    assert.equal(isAudioRequest('/audio/demo-1.mp3'), false);
  });

  test('no toma por audio las rutas con subcarpetas o recorridos', () => {
    for (const url of ['/audio/sub/demo-1.opus', '/audio/../app.js', '/audio/.opus']) {
      assert.equal(isAudioRequest(url), false, url);
    }
  });

  test('las funciones de ruta no lanzan con entradas inválidas', () => {
    assert.equal(isShellRequest('http://['), false);
    assert.equal(isAudioRequest('http://['), false);
    assert.equal(isDataRequest(undefined), false);
  });
});

describe('lista de audios y planificación', () => {
  test('listAudioUrls genera audio/<id>.opus sin repetir ni ids inválidos', () => {
    const songs = [
      { id: 'demo-1' },
      { id: 'demo-2' },
      { id: 'demo-1' },
      { id: 'mal/id' },
      { id: '../secreto' },
      { id: '' },
      { id: 42 },
      { title: 'Persona de prueba' },
      null,
    ];
    assert.deepEqual(listAudioUrls(songs), ['audio/demo-1.opus', 'audio/demo-2.opus']);
  });

  test('listAudioUrls devuelve lista vacía si no recibe una lista', () => {
    assert.deepEqual(listAudioUrls(null), []);
    assert.deepEqual(listAudioUrls({ id: 'demo-1' }), []);
  });

  test('planOfflineDownload separa lo pendiente de lo ya guardado', () => {
    const songs = [{ id: 'demo-1' }, { id: 'demo-2' }, { id: 'demo-3' }];
    const cached = ['/audio/demo-2.opus', 'https://reminiscencia.test/audio/demo-9.opus'];
    assert.deepEqual(planOfflineDownload(songs, cached), {
      toDownload: ['audio/demo-1.opus', 'audio/demo-3.opus'],
      alreadyCached: ['audio/demo-2.opus'],
    });
  });

  test('planOfflineDownload sin caché previa descarga todo y sin repetir', () => {
    const songs = [{ id: 'demo-1' }, { id: 'demo-1' }];
    assert.deepEqual(planOfflineDownload(songs), { toDownload: ['audio/demo-1.opus'], alreadyCached: [] });
    assert.deepEqual(planOfflineDownload(songs, null), { toDownload: ['audio/demo-1.opus'], alreadyCached: [] });
  });
});

describe('formato de tamaños', () => {
  test('formatBytes usa unidades y coma decimal', () => {
    const cases = [
      [0, '0 B'],
      [999, '999 B'],
      [1024, '1 KB'],
      [1536, '1,5 KB'],
      [10 * 1024, '10 KB'],
      [5 * 1024 * 1024, '5 MB'],
      [1.5 * 1024 ** 3, '1,5 GB'],
    ];
    for (const [bytes, text] of cases) assert.equal(formatBytes(bytes), text, String(bytes));
  });

  test('formatBytes pasa a la unidad siguiente si el redondeo llega a 1024', () => {
    assert.equal(formatBytes(1024 * 1024 - 1), '1 MB');
  });

  test('formatBytes devuelve un guion para valores no válidos', () => {
    for (const value of [Number.NaN, -1, Number.POSITIVE_INFINITY, undefined]) {
      assert.equal(formatBytes(value), '—');
    }
  });
});

describe('rangos de audio', () => {
  test('parseRange resuelve los formatos de un único tramo', () => {
    assert.deepEqual(parseRange('bytes=0-', 100), { start: 0, end: 99 });
    assert.deepEqual(parseRange('bytes=10-19', 100), { start: 10, end: 19 });
    assert.deepEqual(parseRange('bytes=-5', 100), { start: 95, end: 99 });
    assert.deepEqual(parseRange('bytes=90-200', 100), { start: 90, end: 99 });
  });

  test('parseRange marca como no atendible un rango fuera del fichero', () => {
    assert.equal(parseRange('bytes=100-', 100), 'unsatisfiable');
    assert.equal(parseRange('bytes=-0', 100), 'unsatisfiable');
    assert.equal(parseRange('bytes=0-', 0), 'unsatisfiable');
  });

  test('parseRange ignora cabeceras ausentes, múltiples o mal formadas', () => {
    for (const header of [undefined, null, 'bytes=5-2', 'bytes=200-100', 'bytes=0-1,5-6', 'items=0-1', 'bytes=abc', 'bytes=']) {
      assert.equal(parseRange(header, 100), null, String(header));
    }
  });
});

// ---------------------------------------------------------------------------------------------
// Manifiesto e iconos
// ---------------------------------------------------------------------------------------------

describe('manifiesto e iconos', () => {
  test('el manifiesto es JSON válido con los campos acordados', () => {
    const manifest = readManifest();
    assert.equal(manifest.name, 'Reminiscencia');
    assert.equal(manifest.short_name, 'Reminiscencia');
    assert.equal(manifest.lang, 'es');
    assert.equal(manifest.start_url, '/');
    assert.equal(manifest.display, 'standalone');
    assert.equal(manifest.background_color, '#0c0d10');
    assert.equal(manifest.theme_color, '#0c0d10');
  });

  test('cada icono del manifiesto existe, es PNG y tiene el tamaño declarado', () => {
    const manifest = readManifest();
    assert.ok(manifest.icons.length >= 3);
    for (const icon of manifest.icons) {
      const file = join(WEB_DIR, icon.src);
      assert.equal(existsSync(file), true, `falta ${icon.src}`);
      const { width, height } = readPngSize(readFileSync(file));
      assert.equal(icon.sizes, `${width}x${height}`, icon.src);
      assert.equal(icon.type, 'image/png', icon.src);
    }
  });

  test('hay iconos normales de 192 y 512 y un maskable de 512', () => {
    const icons = readManifest().icons;
    assert.ok(icons.some((icon) => icon.sizes === '192x192' && icon.purpose === 'any'));
    assert.ok(icons.some((icon) => icon.sizes === '512x512' && icon.purpose === 'any'));
    assert.ok(icons.some((icon) => icon.sizes === '512x512' && icon.purpose === 'maskable'));
  });

  test('el shell precarga el manifiesto y todos sus iconos', () => {
    assert.ok(SHELL_ASSETS.includes('/manifest.webmanifest'));
    for (const icon of readManifest().icons) {
      assert.ok(SHELL_ASSETS.includes(`/${icon.src}`), icon.src);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// sw.js con cachés y red simuladas
// ---------------------------------------------------------------------------------------------

describe('service worker (sw.js)', () => {
  before(async () => {
    globalThis.self = {
      location: new URL(ORIGIN),
      addEventListener(type, listener) {
        env.handlers[type] = listener;
      },
      skipWaiting() {
        return Promise.resolve();
      },
      clients: {
        claim() {
          return Promise.resolve();
        },
      },
    };
    await import(SW_MODULE_URL);
  });

  test('install precarga el shell y omite los recursos que no existen', async () => {
    env.routes.set(ORIGIN, { body: '<!doctype html>' });
    env.routes.set(`${ORIGIN}app.js`, { body: 'console.log(1);' });
    env.routes.set(`${ORIGIN}data/songs.json`, { body: '[]' });
    await runLifecycle('install');
    const urls = await urlsIn(SHELL);
    assert.ok(urls.includes(ORIGIN));
    assert.ok(urls.includes(`${ORIGIN}app.js`));
    assert.ok(urls.includes(`${ORIGIN}data/songs.json`));
    assert.equal(urls.includes(`${ORIGIN}gestion.js`), false);
  });

  test('el shell responde con la copia guardada y la actualiza en segundo plano', async () => {
    env.routes.set(`${ORIGIN}app.js`, { body: 'version 1' });
    await runLifecycle('install');
    env.routes.set(`${ORIGIN}app.js`, { body: 'version 2' });

    const pending = dispatchFetch(new Request(`${ORIGIN}app.js`));
    assert.equal(await (await pending.response).text(), 'version 1');
    await Promise.all(pending.waits);

    const cache = await caches.open(SHELL);
    assert.equal(await (await cache.match(`${ORIGIN}app.js`)).text(), 'version 2');
  });

  test('la raíz del sitio se sirve desde la copia del shell', async () => {
    env.routes.set(ORIGIN, { body: '<html>inicio</html>' });
    await runLifecycle('install');
    const pending = dispatchFetch(new Request(ORIGIN));
    assert.equal(await (await pending.response).text(), '<html>inicio</html>');
  });

  test('los datos van primero a la red y, sin red, a la última copia', async () => {
    env.routes.set(`${ORIGIN}data/songs.json`, { body: '[{"id":"demo-1"}]' });
    const online = dispatchFetch(new Request(`${ORIGIN}data/songs.json`));
    assert.equal(await (await online.response).text(), '[{"id":"demo-1"}]');
    await Promise.all(online.waits);

    env.routes.set(`${ORIGIN}data/songs.json`, { body: '[{"id":"demo-2"}]' });
    const newer = dispatchFetch(new Request(`${ORIGIN}data/songs.json`));
    assert.equal(await (await newer.response).text(), '[{"id":"demo-2"}]');
    await Promise.all(newer.waits);

    env.offline = true;
    const offline = dispatchFetch(new Request(`${ORIGIN}data/songs.json`));
    assert.equal(await (await offline.response).text(), '[{"id":"demo-2"}]');
  });

  test('sin red y sin copia, los datos fallan', async () => {
    env.offline = true;
    const pending = dispatchFetch(new Request(`${ORIGIN}data/folders.json`));
    await assert.rejects(pending.response);
  });

  test('el audio guardado se sirve con rangos para poder buscar dentro del tema', async () => {
    await putIn(AUDIO, '/audio/demo-1.opus', new Response('0123456789', { headers: { 'Content-Type': 'audio/ogg; codecs=opus' } }));
    const pending = dispatchFetch(new Request(`${ORIGIN}audio/demo-1.opus`, { headers: { Range: 'bytes=2-4' } }));
    const response = await pending.response;
    assert.equal(response.status, 206);
    assert.equal(response.headers.get('content-range'), 'bytes 2-4/10');
    assert.equal(response.headers.get('content-length'), '3');
    assert.equal(await response.text(), '234');
  });

  test('el audio guardado sin cabecera Range devuelve el fichero completo', async () => {
    await putIn(AUDIO, '/audio/demo-1.opus', new Response('0123456789'));
    const pending = dispatchFetch(new Request(`${ORIGIN}audio/demo-1.opus`));
    const response = await pending.response;
    assert.equal(response.status, 200);
    assert.equal(await response.text(), '0123456789');
  });

  test('un rango fuera del fichero responde 416', async () => {
    await putIn(AUDIO, '/audio/demo-1.opus', new Response('0123456789'));
    const pending = dispatchFetch(new Request(`${ORIGIN}audio/demo-1.opus`, { headers: { Range: 'bytes=50-60' } }));
    const response = await pending.response;
    assert.equal(response.status, 416);
    assert.equal(response.headers.get('content-range'), 'bytes */10');
  });

  test('el audio no guardado va a la red y no se guarda solo', async () => {
    env.routes.set(`${ORIGIN}audio/demo-2.opus`, { body: 'xyz' });
    const pending = dispatchFetch(new Request(`${ORIGIN}audio/demo-2.opus`));
    assert.equal(await (await pending.response).text(), 'xyz');
    await Promise.all(pending.waits);
    assert.equal(await (await caches.open(AUDIO)).match(`${ORIGIN}audio/demo-2.opus`), undefined);
  });

  test('un fallo al escribir en caché no rompe la respuesta de red', async () => {
    env.routes.set(`${ORIGIN}app.js`, { body: 'nuevo' });
    const cache = await caches.open(SHELL);
    cache.put = async () => {
      throw new Error('Cuota llena');
    };
    const pending = dispatchFetch(new Request(`${ORIGIN}app.js`));
    assert.equal(await (await pending.response).text(), 'nuevo');
    await Promise.all(pending.waits);
  });

  test('no intercepta otro origen, las peticiones POST ni la API', async () => {
    const foreign = dispatchFetch(new Request('https://otro.test/app.js'));
    const post = dispatchFetch(new Request(`${ORIGIN}app.js`, { method: 'POST', body: 'x' }));
    const api = dispatchFetch(new Request(`${ORIGIN}api/catalog`));
    assert.equal(foreign.response, undefined);
    assert.equal(post.response, undefined);
    assert.equal(api.response, undefined);
  });

  test('activate elimina las cachés de shell antiguas y conserva el audio', async () => {
    await putIn('reminiscencia-shell-v0', '/app.js', new Response('antiguo'));
    await putIn(AUDIO, '/audio/demo-1.opus', new Response('audio'));
    await runLifecycle('activate');
    const names = await caches.keys();
    assert.equal(names.includes('reminiscencia-shell-v0'), false);
    assert.equal(names.includes(AUDIO), true);
  });
});

// ---------------------------------------------------------------------------------------------
// pwa.js: registro y biblioteca sin conexión
// ---------------------------------------------------------------------------------------------

describe('guardado sin conexión (pwa.js)', () => {
  test('saveLibraryOffline descarga solo lo pendiente e informa del progreso', async () => {
    env.routes.set(`${ORIGIN}audio/demo-1.opus`, { body: 'aaaa' });
    env.routes.set(`${ORIGIN}audio/demo-3.opus`, { body: 'cccc' });
    await putIn(AUDIO, '/audio/demo-2.opus', new Response('bbbb'));

    const events = [];
    const result = await saveLibraryOffline(
      [{ id: 'demo-1' }, { id: 'demo-2' }, { id: 'demo-3' }],
      (event) => events.push(event),
    );

    assert.deepEqual(result, { added: 2, skipped: 1, failed: [] });
    assert.deepEqual(
      events.map((event) => [event.done, event.total, event.url, event.ok]),
      [
        [1, 2, 'audio/demo-1.opus', true],
        [2, 2, 'audio/demo-3.opus', true],
      ],
    );
    assert.deepEqual(await urlsIn(AUDIO), [
      `${ORIGIN}audio/demo-1.opus`,
      `${ORIGIN}audio/demo-2.opus`,
      `${ORIGIN}audio/demo-3.opus`,
    ]);
  });

  test('un tema que falla no detiene la descarga del resto', async () => {
    env.routes.set(`${ORIGIN}audio/demo-1.opus`, { body: 'aaaa' });
    env.routes.set(`${ORIGIN}audio/demo-3.opus`, { body: 'cccc' });

    const events = [];
    const result = await saveLibraryOffline(
      [{ id: 'demo-1' }, { id: 'demo-2' }, { id: 'demo-3' }],
      (event) => events.push(event),
    );

    assert.equal(result.added, 2);
    assert.equal(result.failed.length, 1);
    assert.equal(result.failed[0].url, 'audio/demo-2.opus');
    assert.deepEqual(events.map((event) => event.ok), [true, false, true]);
    assert.equal(events.at(-1).done, 3);
    assert.deepEqual(await urlsIn(AUDIO), [`${ORIGIN}audio/demo-1.opus`, `${ORIGIN}audio/demo-3.opus`]);
  });

  test('clearOfflineLibrary borra la biblioteca guardada', async () => {
    await putIn(AUDIO, '/audio/demo-1.opus', new Response('aaaa'));
    assert.equal(await clearOfflineLibrary(), true);
    assert.equal(await caches.has(AUDIO), false);
    assert.equal(await clearOfflineLibrary(), false);
  });

  test('offlineStatus cuenta los temas y suma sus bytes de audio', async () => {
    await putIn(AUDIO, '/audio/demo-1.opus', new Response('xx', { headers: { 'Content-Length': '100' } }));
    await putIn(AUDIO, '/audio/demo-2.opus', new Response('abcd'));
    assert.deepEqual(await offlineStatus(), { count: 2, audioBytes: 104, bytesEstimate: 104 });
  });

  test('offlineStatus usa navigator.storage.estimate cuando existe', async () => {
    await putIn(AUDIO, '/audio/demo-1.opus', new Response('abcd'));
    setNavigator({ storage: { estimate: async () => ({ usage: 5000, quota: 1e9 }) } });
    try {
      assert.deepEqual(await offlineStatus(), { count: 1, audioBytes: 4, bytesEstimate: 5000 });
    } finally {
      restoreNavigator();
    }
  });

  test('registerPwa devuelve null sin API de service worker', async () => {
    assert.equal(await registerPwa(), null);
  });

  test('registerPwa registra sw.js como módulo con alcance raíz', async () => {
    const calls = [];
    setNavigator({
      serviceWorker: {
        async register(url, options) {
          calls.push({ url, options });
          return { scope: options.scope };
        },
      },
    });
    try {
      const registration = await registerPwa();
      assert.deepEqual(calls, [{ url: '/sw.js', options: { scope: '/', type: 'module' } }]);
      assert.equal(registration.scope, '/');
    } finally {
      restoreNavigator();
    }
  });

  test('registerPwa no lanza si el registro falla', async () => {
    const warn = console.warn;
    console.warn = () => {};
    setNavigator({
      serviceWorker: {
        async register() {
          throw new TypeError('Registro rechazado');
        },
      },
    });
    try {
      assert.equal(await registerPwa(), null);
    } finally {
      console.warn = warn;
      restoreNavigator();
    }
  });
});
