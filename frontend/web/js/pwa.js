// Registro del service worker y descarga de canciones para escuchar sin conexión.
// Se ejecuta en el navegador; la lógica de nombres y rutas está en offline-core.js.
import { audioCacheName, listAudioUrls, planOfflineDownload } from './offline-core.js';

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

/** Guarda en la caché de audio las canciones que aún no están. Descarga en serie y un fallo
 *  no detiene el resto. onProgress recibe tras cada tema { done, total, url, ok, error? }.
 *  Devuelve { added, skipped, failed: [{ url, error }] }. */
export async function saveLibraryOffline(songs, onProgress = () => {}) {
  const cache = await caches.open(audioCacheName());
  const requests = await cache.keys();
  const { toDownload, alreadyCached } = planOfflineDownload(
    songs,
    requests.map((request) => request.url),
  );
  const total = toDownload.length;
  const failed = [];
  let done = 0;
  for (const url of toDownload) {
    try {
      await cache.add(`/${url}`);
      done += 1;
      onProgress({ done, total, url, ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      done += 1;
      failed.push({ url, error: message });
      onProgress({ done, total, url, ok: false, error: message });
    }
  }
  return { added: total - failed.length, skipped: alreadyCached.length, failed };
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
