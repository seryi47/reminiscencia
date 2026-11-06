// Pruebas del modo sin conexión (node:test, sin navegador).
// Cubren la lógica pura de offline-core.js, la cobertura de la lista del shell (SHELL_ASSETS),
// el manifiesto y sus iconos, y el comportamiento de sw.js y pwa.js sobre cachés y red simuladas.
// Todos los datos son ficticios.
// Ejecución: node --test tests/web-unit/offline-core.test.mjs

import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { after, before, beforeEach, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  AUDIO_ORIGIN,
  AUDIO_HEADERS_TIMEOUT_MS,
  r2AudioUrl,
  remoteAudioUrls,
  WORKER_AUDIO_ORIGIN,
  audioCacheName,
  coverCacheName,
  formatBytes,
  isAudioRequest,
  isCoverRequest,
  isDataRequest,
  isShellRequest,
  listAudioUrls,
  localAudioId,
  parseRange,
  planOfflineDownload,
  SHELL_ASSETS,
  SHELL_VERSION,
  shellCacheName,
} from '../../frontend/web/js/offline-core.js';
import { cachedAudioPaths, registerPwa, removeOfflineSongs, saveLibraryOffline } from '../../frontend/web/js/pwa.js';
import { normalizeApiBase, WORKER_API_BASE } from '../../frontend/web/js/api-config.js';

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

const env = { stores: new Map(), routes: new Map(), offline: false, handlers: {}, requests: [] };

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

  async delete(input) {
    return this.entries.delete(urlOf(input));
  }

  async keys() {
    return [...this.entries.keys()].map((url) => ({ url }));
  }
}

function resetEnvironment() {
  env.stores = new Map();
  env.routes = new Map();
  env.offline = false;
  env.requests = [];
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
  globalThis.fetch = async (input, init = {}) => {
    // Se apunta cada petición con su modo de caché HTTP (el del init o el de la Request).
    env.requests.push({ url: urlOf(input), cache: init.cache ?? (typeof input === 'string' ? 'default' : input.cache) });
    if (env.offline) throw new TypeError('Sin conexión');
    const route = env.routes.get(urlOf(input));
    if (!route) return new Response('No encontrado', { status: 404 });
    const response = new Response(route.body, { status: route.status ?? 200, headers: route.headers ?? {} });
    // Como tras seguir una redirección en un fetch real (p. ej. /index.html → /).
    if (route.redirected) Object.defineProperty(response, 'redirected', { value: true });
    return response;
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

/** Devuelve a su valor original los globales que usan sw.js y pwa.js. Solo lo llaman los bloques
 *  que los preparan, así que al ejecutar todas las suites en un proceso (index.mjs) no afecta
 *  a las demás. */
function restoreGlobals() {
  globalThis.fetch = originals.fetch;
  if (originals.caches === undefined) delete globalThis.caches;
  else globalThis.caches = originals.caches;
  if (originals.self === undefined) delete globalThis.self;
  else globalThis.self = originals.self;
  restoreNavigator();
}

/** Rutas desde la raíz del sitio (p. ej. '/js/views/home.js') de los ficheros de una carpeta
 *  de frontend/web con una extensión, a cualquier profundidad. */
function sitePaths(folder, extension) {
  return readdirSync(join(WEB_DIR, folder), { recursive: true })
    .map((name) => name.split(sep).join('/'))
    .filter((name) => name.endsWith(extension))
    .map((name) => `/${folder}/${name}`);
}

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
      '/manifest.webmanifest',
      `${ORIGIN}js/app.js?v=3`,
      '/js/pwa.js',
      '/js/views/home.js',
      '/js/cuidador/subida-local.js',
      '/css/app.css',
      '/css/tokens.css',
      '/fonts/figtree-400.woff2',
      '/data/songs.json',
      '/icons/icon-512.png',
    ];
    for (const url of shellUrls) assert.equal(isShellRequest(url), true, url);
  });

  test('no trata como shell la API, el panel, el worker, el audio ni la página retirada de la raíz', () => {
    const notShell = [
      '/api/catalog',
      '/admin/index.html',
      '/lib/auth.js',
      '/sw.js',
      '/audio/demo-1.opus',
      '/app.js',
      '/styles.css',
      '/listen.css',
      '/gestion.js',
    ];
    for (const url of notShell) assert.equal(isShellRequest(url), false, url);
  });

  test('reconoce los datos y los audios por separado', () => {
    assert.equal(isDataRequest('/data/songs.json'), true);
    assert.equal(isDataRequest('/app.js'), false);
    assert.equal(isDataRequest('/data/notas.txt'), false);
    assert.equal(isAudioRequest('/audio/demo-1.opus'), true);
    assert.equal(isAudioRequest('/audio/demo-1.mp3'), false);
  });

  test('el audio de la biblioteca se pide a R2 y las canciones locales o ajenas no', () => {
    assert.equal(r2AudioUrl('/audio/S0123456789abcdef.opus'), `${AUDIO_ORIGIN}/audio/S0123456789abcdef.opus`);
    assert.equal(r2AudioUrl('https://reminiscencia.vercel.app/audio/Sabc.opus?x=1'), `${AUDIO_ORIGIN}/audio/Sabc.opus`);
    assert.equal(r2AudioUrl('/audio/L0011223344556677.opus'), null);
    assert.equal(r2AudioUrl('/audio/demo.mp3'), null);
    assert.equal(r2AudioUrl('/data/songs.json'), null);
  });

  test('el audio de la biblioteca se pide al Worker y luego a r2.dev; sin Worker, solo a r2.dev (ADR-0031)', () => {
    const W = 'https://reminiscencia-api.prueba.workers.dev';
    assert.deepEqual(remoteAudioUrls('/audio/S0123456789abcdef.opus', W), [
      `${W}/audio/S0123456789abcdef.opus`,
      `${AUDIO_ORIGIN}/audio/S0123456789abcdef.opus`,
    ]);
    assert.deepEqual(remoteAudioUrls('https://reminiscencia.vercel.app/audio/Sabc.opus?x=1', `${W}/`), [
      `${W}/audio/Sabc.opus`,
      `${AUDIO_ORIGIN}/audio/Sabc.opus`,
    ]);
    assert.deepEqual(remoteAudioUrls('/audio/S0123456789abcdef.opus', ''), [`${AUDIO_ORIGIN}/audio/S0123456789abcdef.opus`]);
    // Una dirección que no es un origen https válido no se usa (como WORKER_API_BASE en api-config.js).
    assert.deepEqual(remoteAudioUrls('/audio/S0123456789abcdef.opus', 'http://malo.example'), [`${AUDIO_ORIGIN}/audio/S0123456789abcdef.opus`]);
    assert.deepEqual(remoteAudioUrls('/audio/L0011223344556677.opus', W), []);
    assert.deepEqual(remoteAudioUrls('/audio/demo.mp3', W), []);
    assert.deepEqual(remoteAudioUrls('/data/songs.json', W), []);
  });

  test('el origen del audio es WORKER_API_BASE de js/api-config.js, sin otra copia de la dirección', () => {
    assert.equal(WORKER_AUDIO_ORIGIN, normalizeApiBase(WORKER_API_BASE));
    assert.deepEqual(remoteAudioUrls('/audio/S0123456789abcdef.opus')[0], `${WORKER_AUDIO_ORIGIN || AUDIO_ORIGIN}/audio/S0123456789abcdef.opus`);
    const address = /https:\/\/[^\s'"`]*\.(?:workers|r2)\.dev/;
    const core = readFileSync(join(WEB_DIR, 'js', 'offline-core.js'), 'utf8');
    assert.ok(!/https:\/\/[^\s'"`]*\.workers\.dev/.test(core), 'offline-core.js no debe repetir la dirección del Worker');
    const sw = readFileSync(join(WEB_DIR, 'sw.js'), 'utf8');
    assert.ok(!address.test(sw), 'sw.js toma las direcciones de offline-core.js');
  });

  test('el service worker prueba el Worker, después R2 y vuelve al propio origen si falla', () => {
    const sw = readFileSync(join(fileURLToPath(new URL('../../frontend/web/', import.meta.url)), 'sw.js'), 'utf8');
    assert.match(sw, /fetchAudio\(request, range\)/);
    assert.match(sw, /if \(response\.ok\) return response;/);
    assert.match(sw, /return fetch\(request\);\n\}/);
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

describe('portadas (covers/<id>.jpg)', () => {
  test('reconoce solo /covers/<id seguro>.jpg', () => {
    assert.equal(isCoverRequest('/covers/S0000000000000001.jpg'), true);
    assert.equal(isCoverRequest(`${ORIGIN}covers/F0123456789abcdef.jpg?v=2`), true);
    for (const url of ['/covers/x.png', '/covers/a/b.jpg', '/covers/../js/app.js', '/covers/.jpg', '/audio/x.jpg']) {
      assert.equal(isCoverRequest(url), false, url);
    }
    assert.equal(isShellRequest('/covers/S0000000000000001.jpg'), false, 'las portadas no van en la caché del shell');
  });

  test('tienen su propia caché, que no se borra al cambiar de shell', () => {
    assert.equal(coverCacheName(), 'reminiscencia-portadas-v1');
    assert.equal(coverCacheName().startsWith('reminiscencia-shell-'), false);
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
    assert.equal(manifest.background_color, '#000000');
    assert.equal(manifest.theme_color, '#000000');
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
// Cobertura de SHELL_ASSETS: lo que hay en frontend/web debe estar precargado
// ---------------------------------------------------------------------------------------------

describe('cobertura de SHELL_ASSETS', () => {
  test('incluye la página, el manifiesto, los datos y los iconos', () => {
    for (const path of ['/', '/index.html', '/manifest.webmanifest', '/data/songs.json', '/data/folders.json']) {
      assert.ok(SHELL_ASSETS.includes(path), path);
    }
  });

  test('incluye todas las hojas, fuentes, módulos (también los de js/ui, js/views y js/cuidador), datos e iconos', () => {
    const files = [
      ...sitePaths('css', '.css'),
      ...sitePaths('fonts', '.woff2'),
      ...sitePaths('js', '.js'),
      ...sitePaths('data', '.json'),
      ...sitePaths('icons', '.png'),
    ];
    assert.ok(files.includes('/js/views/home.js'), 'el recorrido debe entrar en las subcarpetas');
    assert.deepEqual(files.filter((path) => !SHELL_ASSETS.includes(path)), []);
  });

  test('incluye lo que carga la página (hojas, módulo de entrada, manifiesto e iconos)', () => {
    const html = readFileSync(join(WEB_DIR, 'index.html'), 'utf8');
    const refs = [...html.matchAll(/\b(?:href|src)="([^"#?:]+)"/g)].map((match) => `/${match[1]}`);
    assert.ok(refs.includes('/js/app.js'), 'la página debe cargar el módulo de entrada');
    assert.deepEqual(refs.filter((path) => !SHELL_ASSETS.includes(path)), []);
  });

  test('incluye lo que referencian las hojas con url(), como las fuentes', () => {
    const referenced = [];
    for (const sheet of sitePaths('css', '.css')) {
      const css = readFileSync(join(WEB_DIR, sheet), 'utf8');
      for (const [, ref] of css.matchAll(/url\(\s*["']?([^"')]+?)["']?\s*\)/g)) {
        if (/^(data:|https?:)/.test(ref)) continue;
        referenced.push(new URL(ref, `https://reminiscencia.test${sheet}`).pathname);
      }
    }
    assert.ok(referenced.includes('/fonts/figtree-400.woff2'), 'las hojas deben enlazar las fuentes');
    for (const weight of [400, 600, 700, 800]) assert.ok(referenced.includes(`/fonts/figtree-${weight}.woff2`), `peso ${weight}`);
    assert.deepEqual(referenced.filter((path) => !SHELL_ASSETS.includes(path)), []);
  });

  test('no vuelve a precargar los ficheros de la página de escucha retirada', () => {
    for (const path of ['/styles.css', '/listen.css', '/app.js', '/gestion.js']) {
      assert.equal(SHELL_ASSETS.includes(path), false, path);
    }
  });

  test('no repite rutas y la lista está congelada', () => {
    assert.equal(Object.isFrozen(SHELL_ASSETS), true);
    assert.equal(new Set(SHELL_ASSETS).size, SHELL_ASSETS.length);
  });
});

// ---------------------------------------------------------------------------------------------
// sw.js con cachés y red simuladas
// ---------------------------------------------------------------------------------------------

describe('service worker (sw.js)', () => {
  beforeEach(resetEnvironment);
  after(restoreGlobals);

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
    env.routes.set(`${ORIGIN}js/app.js`, { body: 'console.log(1);' });
    env.routes.set(`${ORIGIN}data/songs.json`, { body: '[]' });
    await runLifecycle('install');
    const urls = await urlsIn(SHELL);
    assert.ok(urls.includes(ORIGIN));
    assert.ok(urls.includes(`${ORIGIN}js/app.js`));
    assert.ok(urls.includes(`${ORIGIN}data/songs.json`));
    assert.equal(urls.includes(`${ORIGIN}css/base.css`), false);
  });

  test('install guarda todo el shell y, sin red, lo sirve desde la caché', async () => {
    for (const path of SHELL_ASSETS) env.routes.set(new URL(path, ORIGIN).href, { body: `contenido de ${path}` });
    await runLifecycle('install');
    assert.deepEqual(await urlsIn(SHELL), SHELL_ASSETS.map((path) => new URL(path, ORIGIN).href).sort());

    env.offline = true;
    for (const path of SHELL_ASSETS) {
      const { response } = dispatchFetch(new Request(new URL(path, ORIGIN)));
      assert.ok(response, `el worker no intercepta ${path}`);
      assert.equal(await (await response).text(), `contenido de ${path}`, path);
    }
  });

  test('install no guarda respuestas redirigidas, que el navegador no acepta como navegación', async () => {
    env.routes.set(ORIGIN, { body: '<!doctype html>' });
    env.routes.set(`${ORIGIN}index.html`, { body: '<!doctype html>', redirected: true });
    await runLifecycle('install');
    const urls = await urlsIn(SHELL);
    assert.ok(urls.includes(ORIGIN));
    assert.equal(urls.includes(`${ORIGIN}index.html`), false);
  });

  test('el shell responde con la copia guardada y la actualiza en segundo plano', async () => {
    env.routes.set(`${ORIGIN}js/app.js`, { body: 'version 1' });
    await runLifecycle('install');
    env.routes.set(`${ORIGIN}js/app.js`, { body: 'version 2' });

    const pending = dispatchFetch(new Request(`${ORIGIN}js/app.js`));
    assert.equal(await (await pending.response).text(), 'version 1');
    await Promise.all(pending.waits);

    const cache = await caches.open(SHELL);
    assert.equal(await (await cache.match(`${ORIGIN}js/app.js`)).text(), 'version 2');
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

  test('los datos nunca salen de una copia vieja: songs.json, folders.json y catalog.json van a la red sin caché HTTP', async () => {
    // Copia vieja en la caché del shell (la que dejó la instalación) y una versión nueva en el servidor.
    for (const name of ['songs', 'folders', 'catalog']) env.routes.set(`${ORIGIN}data/${name}.json`, { body: `vieja ${name}` });
    await runLifecycle('install');
    for (const name of ['songs', 'folders', 'catalog']) env.routes.set(`${ORIGIN}data/${name}.json`, { body: `nueva ${name}` });
    env.requests = [];
    for (const name of ['songs', 'folders', 'catalog']) {
      const url = `${ORIGIN}data/${name}.json`;
      const pending = dispatchFetch(new Request(url));
      assert.equal(await (await pending.response).text(), `nueva ${name}`, `${name}.json viene de la red`);
      await Promise.all(pending.waits);
      assert.deepEqual(env.requests.filter((item) => item.url === url).map((item) => item.cache), ['no-store'], `${name}.json sin caché HTTP`);
      const cache = await caches.open(SHELL);
      assert.equal(await (await cache.match(url)).text(), `nueva ${name}`, `la copia de respaldo de ${name}.json se actualiza`);
    }
    // Sin red, responde la última copia buena.
    env.offline = true;
    const offline = dispatchFetch(new Request(`${ORIGIN}data/songs.json`));
    assert.equal(await (await offline.response).text(), 'nueva songs');
  });

  test('un error del servidor en los datos no se guarda como copia de respaldo', async () => {
    env.routes.set(`${ORIGIN}data/songs.json`, { body: 'buena' });
    await Promise.all(dispatchFetch(new Request(`${ORIGIN}data/songs.json`)).waits);
    const first = dispatchFetch(new Request(`${ORIGIN}data/songs.json`));
    await first.response;
    await Promise.all(first.waits);
    env.routes.set(`${ORIGIN}data/songs.json`, { body: 'error', status: 500 });
    const failing = dispatchFetch(new Request(`${ORIGIN}data/songs.json`));
    assert.equal((await failing.response).status, 500);
    await Promise.all(failing.waits);
    const cache = await caches.open(SHELL);
    assert.equal(await (await cache.match(`${ORIGIN}data/songs.json`)).text(), 'buena');
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

  test('audio no guardado (ADR-0031): primero el Worker, con el Range y CORS; no toca r2.dev ni el origen', async () => {
    const W = `${WORKER_AUDIO_ORIGIN || AUDIO_ORIGIN}/audio/S0123456789abcdef.opus`;
    let seen = null;
    const fetchBase = globalThis.fetch;
    globalThis.fetch = async (input, init = {}) => {
      if (urlOf(input) === W) seen = init;
      return fetchBase(input, init);
    };
    env.routes.set(W, { body: '01', status: 206, headers: { 'Content-Range': 'bytes 0-1/10' } });
    const pending = dispatchFetch(new Request(`${ORIGIN}audio/S0123456789abcdef.opus`, { headers: { Range: 'bytes=0-1' } }));
    const response = await pending.response;
    assert.equal(response.status, 206);
    assert.equal(await response.text(), '01');
    assert.deepEqual(env.requests.map((item) => item.url), [W]);
    assert.deepEqual(seen.headers, { Range: 'bytes=0-1' });
    assert.equal(seen.mode, 'cors');
    assert.equal(seen.credentials, 'omit');
    assert.ok(seen.signal, 'cada intento tiene un tiempo máximo para empezar a responder');
    assert.ok(AUDIO_HEADERS_TIMEOUT_MS >= 5000);
  });

  test('audio no guardado: si el Worker falla (error, página que no es audio o red), R2; si R2 falla, el propio origen', async () => {
    const path = 'audio/S0123456789abcdef.opus';
    const order = remoteAudioUrls(`/${path}`);
    assert.equal(order.at(-1), `${AUDIO_ORIGIN}/${path}`);
    // El Worker responde con un error: se pasa a R2.
    if (order.length === 2) env.routes.set(order[0], { body: '<html>Error 1101</html>', status: 500 });
    env.routes.set(order.at(-1), { body: 'de-r2' });
    let response = await dispatchFetch(new Request(`${ORIGIN}${path}`)).response;
    assert.equal(await response.text(), 'de-r2');
    assert.deepEqual(env.requests.map((item) => item.url), order);
    // Ni el Worker ni R2: el propio origen (que vercel.json redirige al Worker).
    env.requests = [];
    env.routes.delete(order.at(-1));
    env.routes.set(`${ORIGIN}${path}`, { body: 'del-origen' });
    response = await dispatchFetch(new Request(`${ORIGIN}${path}`)).response;
    assert.equal(await response.text(), 'del-origen');
    assert.deepEqual(env.requests.map((item) => item.url), [...order, `${ORIGIN}${path}`]);
    // Un fallo de red del Worker también pasa al siguiente.
    env.requests = [];
    const fetchBase = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      if (order.length === 2 && urlOf(input) === order[0]) throw new TypeError('Failed to fetch');
      return fetchBase(input, init);
    };
    env.routes.set(order.at(-1), { body: 'de-r2' });
    response = await dispatchFetch(new Request(`${ORIGIN}${path}`)).response;
    assert.equal(await response.text(), 'de-r2');
  });

  test('un fallo al escribir en caché no rompe la respuesta de red', async () => {
    env.routes.set(`${ORIGIN}js/app.js`, { body: 'nuevo' });
    const cache = await caches.open(SHELL);
    cache.put = async () => {
      throw new Error('Cuota llena');
    };
    const pending = dispatchFetch(new Request(`${ORIGIN}js/app.js`));
    assert.equal(await (await pending.response).text(), 'nuevo');
    await Promise.all(pending.waits);
  });

  test('no intercepta otro origen, las peticiones POST ni la API', async () => {
    const foreign = dispatchFetch(new Request('https://otro.test/app.js'));
    const post = dispatchFetch(new Request(`${ORIGIN}js/app.js`, { method: 'POST', body: 'x' }));
    const api = dispatchFetch(new Request(`${ORIGIN}api/catalog`));
    assert.equal(foreign.response, undefined);
    assert.equal(post.response, undefined);
    assert.equal(api.response, undefined);
  });

  test('una canción subida a este navegador (audio/L….opus) se sirve desde IndexedDB, con rangos', async () => {
    const blob = new Blob(['0123456789'], { type: 'audio/ogg' });
    self.indexedDB = fakeLocalAudioDb(new Map([['L0011223344556677', { id: 'L0011223344556677', blob }]]));
    try {
      const whole = await dispatchFetch(new Request(`${ORIGIN}audio/L0011223344556677.opus`)).response;
      assert.equal(whole.status, 200);
      assert.equal(whole.headers.get('content-type'), 'audio/ogg; codecs=opus');
      assert.equal(await whole.text(), '0123456789');
      const part = await dispatchFetch(new Request(`${ORIGIN}audio/L0011223344556677.opus`, { headers: { Range: 'bytes=3-5' } })).response;
      assert.equal(part.status, 206);
      assert.equal(await part.text(), '345');
      const missing = await dispatchFetch(new Request(`${ORIGIN}audio/L8899aabbccddeeff.opus`)).response;
      assert.equal(missing.status, 404);
    } finally {
      delete self.indexedDB;
    }
  });

  test('una portada se guarda al verla y, sin red, se sirve desde su caché', async () => {
    env.routes.set(`${ORIGIN}covers/S0000000000000001.jpg`, { body: 'jpeg' });
    const online = dispatchFetch(new Request(`${ORIGIN}covers/S0000000000000001.jpg`));
    assert.equal(await (await online.response).text(), 'jpeg');
    await Promise.all(online.waits);
    assert.deepEqual(await urlsIn(coverCacheName()), [`${ORIGIN}covers/S0000000000000001.jpg`]);
    env.offline = true;
    const offline = dispatchFetch(new Request(`${ORIGIN}covers/S0000000000000001.jpg`));
    assert.equal(await (await offline.response).text(), 'jpeg');
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
  beforeEach(resetEnvironment);
  after(restoreGlobals);

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

  test('removeOfflineSongs quita de la caché solo las canciones indicadas', async () => {
    await putIn(AUDIO, '/audio/demo-1.opus', new Response('aaaa'));
    await putIn(AUDIO, '/audio/demo-2.opus', new Response('bbbb'));
    await removeOfflineSongs([{ id: 'demo-1' }, { id: 'L0011223344556677', local: true }]);
    assert.deepEqual(await urlsIn(AUDIO), [`${ORIGIN}audio/demo-2.opus`]);
  });

  test('cachedAudioPaths da las rutas relativas de lo descargado', async () => {
    await putIn(AUDIO, '/audio/demo-1.opus', new Response('aaaa'));
    await putIn(AUDIO, '/audio/demo-3.opus', new Response('cccc'));
    assert.deepEqual([...(await cachedAudioPaths())].sort(), ['audio/demo-1.opus', 'audio/demo-3.opus']);
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

/** IndexedDB mínimo con la base de audio local: solo open y get, lo que usa readLocalRecord. */
function fakeLocalAudioDb(records) {
  const db = {
    objectStoreNames: { contains: () => true },
    transaction() {
      const tx = { oncomplete: null, onerror: null, onabort: null };
      tx.objectStore = () => ({
        get(key) {
          const req = { onsuccess: null, result: undefined };
          setTimeout(() => {
            req.result = records.get(key);
            req.onsuccess?.();
            tx.oncomplete?.();
          }, 0);
          return req;
        },
      });
      return tx;
    },
    close() {},
  };
  return {
    open() {
      const request = { result: db, onupgradeneeded: null, onsuccess: null, onerror: null, onblocked: null };
      setTimeout(() => request.onsuccess?.(), 0);
      return request;
    },
  };
}

describe('localAudioId', () => {
  test('reconoce /audio/L<16 hex>.opus y nada más', () => {
    assert.equal(localAudioId(`${ORIGIN}audio/L0011223344556677.opus`), 'L0011223344556677');
    assert.equal(localAudioId('/audio/L0011223344556677.opus?x=1'), 'L0011223344556677');
    assert.equal(localAudioId('/audio/S0011223344556677.opus'), null);
    assert.equal(localAudioId('/audio/L00112233.opus'), null);
    assert.equal(localAudioId('/otra/L0011223344556677.opus'), null);
  });
});
