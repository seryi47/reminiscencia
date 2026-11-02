// Service worker de Reminiscencia (módulo, alcance '/'): shell sin conexión, biblioteca de
// audio que guarda el usuario y datos con respaldo de caché. Se registra desde js/pwa.js.
// Al cambiar el shell, sube SHELL_VERSION en js/offline-core.js.
import {
  audioCacheName,
  isAudioRequest,
  isDataRequest,
  isShellRequest,
  parseRange,
  SHELL_ASSETS,
  SHELL_CACHE_PREFIX,
  shellCacheName,
  SHELL_VERSION,
} from './js/offline-core.js';

const SHELL_CACHE = shellCacheName(SHELL_VERSION);
const AUDIO_CACHE = audioCacheName();

self.addEventListener('install', (event) => {
  event.waitUntil(precacheShell().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith(SHELL_CACHE_PREFIX) && name !== SHELL_CACHE)
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (isAudioRequest(url.pathname)) {
    event.respondWith(audioResponse(request));
  } else if (isDataRequest(url.pathname)) {
    event.respondWith(networkFirst(event));
  } else if (isShellRequest(url.pathname)) {
    event.respondWith(staleWhileRevalidate(event));
  }
});

/** Clave de caché del shell: la URL sin query, para tener una sola entrada por recurso. */
function shellKey(url) {
  const { origin, pathname } = new URL(url, self.location.href);
  return `${origin}${pathname}`;
}

/** Solo se guarda lo correcto y sin redirigir: el navegador no acepta una respuesta redirigida
 *  como respuesta a una navegación (p. ej. /index.html si el hosting lo redirige a /). */
function isCacheable(response) {
  return response.ok && !response.redirected;
}

/** Guarda el shell en la caché de la versión actual. Un recurso que falle (no existe todavía
 *  o no hay red) se omite: la siguiente visita lo completa. */
async function precacheShell() {
  const cache = await caches.open(SHELL_CACHE);
  await Promise.all(
    SHELL_ASSETS.map(async (path) => {
      try {
        const response = await fetch(path, { cache: 'reload' });
        if (isCacheable(response)) await cache.put(shellKey(path), response);
      } catch {
        // Sin red durante la instalación: se completa en la siguiente visita.
      }
    }),
  );
}

/** Shell (páginas, CSS, JS e iconos): responde con la copia guardada y actualiza la copia en
 *  segundo plano. Sin copia previa, espera a la red. */
async function staleWhileRevalidate(event) {
  const key = shellKey(event.request.url);
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(key);
  const network = fetch(event.request).then(async (response) => {
    // Un fallo al escribir en caché (p. ej. cuota llena) no debe romper la respuesta.
    if (isCacheable(response)) await cache.put(key, response.clone()).catch(() => {});
    return response;
  });
  if (cached) {
    event.waitUntil(network.catch(() => {}));
    return cached;
  }
  return network;
}

/** Datos (data/*.json): red primero; si no hay red, la última copia guardada. */
async function networkFirst(event) {
  const key = shellKey(event.request.url);
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetch(event.request);
    if (isCacheable(response)) event.waitUntil(cache.put(key, response.clone()).catch(() => {}));
    return response;
  } catch (error) {
    const cached = await cache.match(key);
    if (cached) return cached;
    throw error;
  }
}

/** Audio: si está guardado se sirve desde la caché (con rangos, para poder buscar dentro del
 *  tema). Si no está guardado va a la red sin guardarlo. */
async function audioResponse(request) {
  const cache = await caches.open(AUDIO_CACHE);
  const cached = await cache.match(request);
  if (!cached) return fetch(request);
  const range = request.headers.get('range');
  return range ? sliceResponse(cached, range) : cached;
}

/** Responde a una cabecera Range con 206 (o 416 si queda fuera del fichero). */
async function sliceResponse(cached, rangeHeader) {
  const blob = await cached.blob();
  const type = cached.headers.get('content-type') || 'audio/ogg';
  const range = parseRange(rangeHeader, blob.size);
  if (range === 'unsatisfiable') {
    return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${blob.size}` } });
  }
  if (range === null) {
    return new Response(blob, {
      status: 200,
      headers: { 'Content-Type': type, 'Content-Length': String(blob.size), 'Accept-Ranges': 'bytes' },
    });
  }
  const part = blob.slice(range.start, range.end + 1, type);
  return new Response(part, {
    status: 206,
    headers: {
      'Content-Type': type,
      'Content-Length': String(part.size),
      'Content-Range': `bytes ${range.start}-${range.end}/${blob.size}`,
      'Accept-Ranges': 'bytes',
    },
  });
}
