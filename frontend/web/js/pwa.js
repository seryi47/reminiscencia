// Registro del service worker y descarga de canciones para escuchar sin conexión.
// Se ejecuta en el navegador; la lógica de nombres y rutas está en offline-core.js.
import { audioCacheName, listAudioUrls } from './offline-core.js';

const SW_URL = '/sw.js';
const SW_SCOPE = '/';

/** ¿Está sonando algo? El audio de la biblioteca o el vídeo de «Escuchar» de YouTube. */
function isPlayingMedia() {
  const audio = typeof document !== 'undefined' ? document.getElementById('audio') : null;
  const playing = Boolean(audio && !audio.paused && !audio.ended);
  return playing || Boolean(document.querySelector('.yt-dock'));
}

/** Recarga para estrenar la versión nueva, pero sin cortar lo que suena: espera a que pare. */
function reloadWhenIdle() {
  if (!isPlayingMedia()) {
    window.location.reload();
    return;
  }
  const timer = setInterval(() => {
    if (isPlayingMedia()) return;
    clearInterval(timer);
    window.location.reload();
  }, 3000);
}

/** Registra sw.js como módulo con alcance '/'. Si el navegador no tiene service workers
 *  o el registro falla, devuelve null y la web sigue funcionando en línea.
 *  Cuando una versión nueva toma el control de una página que ya tenía una anterior, la página se recarga
 *  una vez: así nadie se queda viendo la interfaz vieja guardada en caché. En la primera visita no recarga. */
export async function registerPwa() {
  if (!('serviceWorker' in navigator)) return null;
  const hadController = Boolean(navigator.serviceWorker.controller);
  let reloaded = false;
  if (typeof navigator.serviceWorker.addEventListener === 'function') {
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || reloaded) return;
      reloaded = true;
      reloadWhenIdle();
    });
  }
  try {
    const registration = await navigator.serviceWorker.register(SW_URL, { scope: SW_SCOPE, type: 'module' });
    if (typeof registration?.update === 'function') registration.update().catch(() => {});
    return registration;
  } catch (error) {
    console.warn('Reminiscencia: el modo sin conexión no está disponible.', error);
    return null;
  }
}

/**
 * Baja una canción ('audio/<id>.opus') y la guarda en la caché de audio para escucharla sin conexión. La petición pasa
 * por el service worker, que la pide al Worker (o a sus respaldos; ADR-0031). Se lee entera, contando los bytes
 * (onBytes), y solo entonces se guarda: nunca queda una canción a medias. Con signal se puede cortar. Lanza si la
 * respuesta no es correcta. La usa el gestor de descargas (js/offline-downloads.js, ADR-0033).
 */
export async function downloadAudioToCache(path, { signal, onBytes = () => {}, fetchImpl = globalThis.fetch } = {}) {
  const response = await fetchImpl(`/${path}`, { signal, credentials: 'same-origin' });
  if (!response.ok || response.status !== 200) {
    await response.body?.cancel?.().catch(() => {});
    throw new Error(`${path}: HTTP ${response.status}`);
  }
  const type = response.headers.get('content-type') || 'audio/ogg';
  const chunks = [];
  if (response.body && typeof response.body.getReader === 'function') {
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      onBytes(value.byteLength);
    }
  } else {
    const buffer = new Uint8Array(await response.arrayBuffer());
    chunks.push(buffer);
    onBytes(buffer.byteLength);
  }
  if (signal?.aborted) throw Object.assign(new Error('Descarga cancelada.'), { name: 'AbortError' });
  const blob = new Blob(chunks, { type });
  const cache = await caches.open(audioCacheName());
  await cache.put(`/${path}`, new Response(blob, {
    status: 200,
    headers: { 'Content-Type': type, 'Content-Length': String(blob.size) },
  }));
}

/** Quita de la caché de audio las canciones indicadas (la descarga de una carpeta o una lista). */
export async function removeOfflineSongs(songs) {
  if (typeof caches === 'undefined') return;
  const cache = await caches.open(audioCacheName());
  await Promise.all(listAudioUrls(songs).map((url) => cache.delete(`/${url}`)));
}

/** Rutas relativas ('audio/<id>.opus') de las canciones guardadas para escuchar sin conexión. */
export async function cachedAudioPaths() {
  if (typeof caches === 'undefined') return new Set();
  try {
    const cache = await caches.open(audioCacheName());
    const requests = await cache.keys();
    return new Set(requests.map((request) => new URL(request.url).pathname.replace(/^\//, '')));
  } catch {
    return new Set();
  }
}
