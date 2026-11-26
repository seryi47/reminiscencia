// Service worker de Reminiscencia (módulo, alcance '/'): shell sin conexión, portadas (covers/<id>.jpg, en su
// propia caché), canciones descargadas para escuchar sin conexión, canciones subidas a este navegador (audio/L….opus, desde IndexedDB; ADR-0012 y ADR-0015) y datos
// con respaldo de caché. Se registra desde js/pwa.js. Al cambiar el shell, sube SHELL_VERSION en js/offline-core.js.
import {
  AUDIO_HEADERS_TIMEOUT_MS,
  audioCacheName,
  coverCacheName,
  isAudioRequest,
  isCatalogApiRequest,
  isCoverRequest,
  isDataRequest,
  isShellRequest,
  isThumbRequest,
  localAudioId,
  parseRange,
  remoteAudioUrls,
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
      // ADR-0049: purga LRU de las cachés de portadas y audio para que no crezcan sin tope. El navegador puede
      // acabar guardando 500+ portadas y 100 canciones; con el tiempo son cientos de MB. Se programa como fire-and-
      // forget para no retrasar la activación: si se interrumpe, la siguiente activación lo intentará de nuevo.
      self.registration?.active?.postMessage?.({ type: 'prune-caches' });
      await self.clients.claim();
    })(),
  );
});

// Topes para las cachés que crecen con el uso (portadas vistas, audio descargado). Al superar el tope se purgan las
// entradas más antiguas (FIFO; las Cache API no exponen last-accessed, solo orden de inserción). ADR-0049.
const COVER_CACHE_MAX_ENTRIES = 300;
const AUDIO_CACHE_MAX_ENTRIES = 100;

async function pruneCache(name, maxEntries) {
  try {
    const cache = await caches.open(name);
    const keys = await cache.keys();
    if (keys.length <= maxEntries) return;
    // Borra las más antiguas (las primeras del array).
    for (let i = 0; i < keys.length - maxEntries; i++) {
      await cache.delete(keys[i]);
    }
  } catch (_) { /* nada: al próximo tick lo reintenta */ }
}

self.addEventListener('message', (event) => {
  if (event.data?.type === 'prune-caches') {
    event.waitUntil?.(Promise.all([
      pruneCache(COVER_CACHE, COVER_CACHE_MAX_ENTRIES),
      pruneCache(AUDIO_CACHE, AUDIO_CACHE_MAX_ENTRIES),
    ]));
  }
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (isAudioRequest(url.pathname)) {
    event.respondWith(audioResponse(request));
  } else if (isCoverRequest(url.pathname) || isThumbRequest(url.pathname)) {
    // ADR-0050: miniaturas (/thumbs/) y portadas (/covers/) comparten caché — son derivadas del mismo contenido
    // inmutable, no justifica una caché separada ni un contador de LRU aparte.
    event.respondWith(staleWhileRevalidate(event, COVER_CACHE));
  } else if (isDataRequest(url.pathname) || isCatalogApiRequest(url.pathname + url.search)) {
    // ADR-0052: la lectura del catálogo (/api/catalogo/latest) y del historial se trata igual que /data/*.json:
    // network-first con la copia guardada como respaldo cuando no hay red.
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
 *  si no hay red. Pasa el Request entero (no sólo la URL) para no perder los headers del cliente — en particular
 *  `If-None-Match`, que el Worker usa para responder 304 al catálogo (ADR-0052, cerraje de findings 2026-11-26). */
async function networkFirst(event) {
  const key = shellKey(event.request.url);
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetch(event.request, { cache: 'no-store' });
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

/** Audio fuera de la caché (ADR-0031): se pide al Worker (bucket público por binding, sin el límite de r2.dev); si
 *  falla, a r2.dev (ADR-0020), y si también falla, al propio origen, que vercel.json redirige al Worker. Sin Worker
 *  configurado (WORKER_API_BASE vacía en js/api-config.js) empieza en r2.dev, como antes. Se reenvía el Range para poder
 *  buscar dentro del tema. Cada intento tiene AUDIO_HEADERS_TIMEOUT_MS para empezar a responder. */
async function fetchAudio(request, range) {
  for (const url of remoteAudioUrls(request.url)) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), AUDIO_HEADERS_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        headers: range ? { Range: range } : {},
        mode: 'cors',
        credentials: 'omit',
        signal: controller.signal,
      });
      if (response.ok) return response;
      await response.body?.cancel().catch(() => {});
    } catch {
      // Se prueba el siguiente.
    } finally {
      clearTimeout(timer);
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
