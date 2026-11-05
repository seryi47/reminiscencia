// Service worker de Reminiscencia (módulo, alcance '/'): shell sin conexión, portadas (covers/<id>.jpg, en su
// propia caché), canciones descargadas para escuchar sin conexión, canciones subidas a este navegador (audio/L….opus, desde IndexedDB; ADR-0012 y ADR-0015) y datos
// con respaldo de caché. Se registra desde js/pwa.js. Al cambiar el shell, sube SHELL_VERSION en js/offline-core.js.
import {
  audioCacheName,
  coverCacheName,
  isAudioRequest,
  isCoverRequest,
  isDataRequest,
  isShellRequest,
  localAudioId,
  parseRange,
  r2AudioUrl,
  SHELL_ASSETS,
  SHELL_CACHE_PREFIX,
  shellCacheName,
  SHELL_VERSION,
} from './js/offline-core.js';
import { readLocalRecord } from './js/cuidador/subida-local.js';

const SHELL_CACHE = shellCacheName(SHELL_VERSION);
const AUDIO_CACHE = audioCacheName();
const COVER_CACHE = coverCacheName();

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
  } else if (isCoverRequest(url.pathname)) {
    event.respondWith(staleWhileRevalidate(event, COVER_CACHE));
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

/** Shell (páginas, CSS, JS e iconos) y portadas (en su propia caché): responde con la copia guardada y
 *  actualiza la copia en segundo plano. Sin copia previa, espera a la red. */
async function staleWhileRevalidate(event, cacheName = SHELL_CACHE) {
  const key = shellKey(event.request.url);
  const cache = await caches.open(cacheName);
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

/** Datos (data/songs.json, folders.json y catalog.json): siempre a la red primero y sin la caché HTTP del navegador
 *  (cache: 'no-store'), para que una canción recién publicada se vea al recargar; la copia guardada solo responde
 *  si no hay red. */
async function networkFirst(event) {
  const key = shellKey(event.request.url);
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetch(event.request.url, { cache: 'no-store', credentials: 'same-origin' });
    if (isCacheable(response)) event.waitUntil(cache.put(key, response.clone()).catch(() => {}));
    return response;
  } catch (error) {
    const cached = await cache.match(key);
    if (cached) return cached;
    throw error;
  }
}

/** Audio: una canción subida a este navegador se lee de IndexedDB. Si está descargada se sirve desde la
 *  caché (con rangos, para poder buscar dentro del tema). Si no, va a la red sin guardarla. */
async function audioResponse(request) {
  const range = request.headers.get('range');
  const localId = localAudioId(request.url);
  if (localId) {
    const record = await readLocalRecord(localId, self);
    if (!record) return new Response(null, { status: 404 });
    return sliceResponse(record.blob, 'audio/ogg; codecs=opus', range);
  }
  const cache = await caches.open(AUDIO_CACHE);
  const cached = await cache.match(request);
  if (!cached) return fetchAudio(request, range);
  if (!range) return cached;
  return sliceResponse(await cached.blob(), cached.headers.get('content-type') || 'audio/ogg', range);
}

/** Audio fuera de la caché: primero R2 (no cobra la salida de datos; ADR-0020) y, si falla o no tiene la canción, el
 *  propio origen (Vercel). Se reenvía el Range para poder buscar dentro del tema. */
async function fetchAudio(request, range) {
  const r2 = r2AudioUrl(request.url);
  if (r2) {
    try {
      const response = await fetch(r2, {
        headers: range ? { Range: range } : {},
        mode: 'cors',
        credentials: 'omit',
      });
      if (response.ok) return response;
    } catch {
      // Sin R2 se usa el origen propio.
    }
  }
  return fetch(request);
}

/** Responde con el fichero entero (200) o con el tramo de la cabecera Range (206, o 416 si queda fuera). */
function sliceResponse(blob, type, rangeHeader) {
  const range = rangeHeader ? parseRange(rangeHeader, blob.size) : null;
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
