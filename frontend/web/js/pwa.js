// Registro del service worker y descarga de canciones para escuchar sin conexión.
// Se ejecuta en el navegador; la lógica de nombres y rutas está en offline-core.js.
import { audioCacheName, listAudioUrls, planOfflineDownload } from './offline-core.js';

const SW_URL = '/sw.js';
const SW_SCOPE = '/';

/** Registra sw.js como módulo con alcance '/'. Si el navegador no tiene service workers
 *  o el registro falla, devuelve null y la web sigue funcionando en línea. */
export async function registerPwa() {
  if (!('serviceWorker' in navigator)) return null;
  try {
    return await navigator.serviceWorker.register(SW_URL, { scope: SW_SCOPE, type: 'module' });
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
