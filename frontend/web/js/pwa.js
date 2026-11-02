// Registro del service worker y guardado de la biblioteca para escuchar sin conexión.
// Se ejecuta en el navegador; la lógica de nombres y rutas está en offline-core.js.
import { audioCacheName, planOfflineDownload } from './offline-core.js';

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

/** Borra la biblioteca guardada para escuchar sin conexión. Resuelve true si existía. */
export function clearOfflineLibrary() {
  return caches.delete(audioCacheName());
}

/** Estado de la biblioteca sin conexión. count son los temas guardados y audioBytes la suma
 *  de sus tamaños (Content-Length, o el tamaño real si falta). bytesEstimate es el uso del
 *  origen según navigator.storage.estimate() si existe (incluye el shell); si no, audioBytes. */
export async function offlineStatus() {
  const name = audioCacheName();
  let count = 0;
  let audioBytes = 0;
  if (await caches.has(name)) {
    const cache = await caches.open(name);
    const requests = await cache.keys();
    count = requests.length;
    for (const request of requests) {
      const response = await cache.match(request);
      if (!response) continue;
      const declared = Number(response.headers.get('content-length'));
      audioBytes += declared > 0 ? declared : (await response.blob()).size;
    }
  }
  let bytesEstimate = audioBytes;
  if (typeof navigator.storage?.estimate === 'function') {
    try {
      const { usage } = await navigator.storage.estimate();
      if (Number.isFinite(usage)) bytesEstimate = usage;
    } catch {
      // Sin estimación disponible: se usan los bytes de audio.
    }
  }
  return { count, audioBytes, bytesEstimate };
}
