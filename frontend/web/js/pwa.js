// Registro del service worker y descarga de canciones para escuchar sin conexión.
// Se ejecuta en el navegador; la lógica de nombres y rutas está en offline-core.js.
import { audioCacheName, listAudioUrls } from './offline-core.js';

const SW_URL = '/sw.js';
const SW_SCOPE = '/';

/** Aviso de versión nueva cuando hay algo cargado en el reproductor (va con el botón «Recargar»). */
export const UPDATE_NOTICE = 'Hay una versión nueva de Reminiscencia.';

/** ¿Hay algo cargado en la página? Una canción en el elemento de audio (sonando o en pausa) o el vídeo de «Escuchar»
 *  de YouTube. */
export function pageHasMedia(doc = globalThis.document) {
  if (!doc) return false;
  const audio = doc.getElementById('audio');
  return Boolean(audio?.getAttribute('src')) || Boolean(doc.querySelector('.yt-dock'));
}

/**
 * Qué hacer cuando una versión nueva del service worker toma el control de la página: 'none' en la primera visita
 * (no había versión anterior) o si ya se ha decidido; 'reload' si no se ha cargado nada todavía (nada que perder); y
 * 'notice' si hay una canción cargada, sonando o en pausa: recargar perdería la canción, la cola y la posición, así que
 * solo se avisa y la persona recarga cuando quiera.
 */
export function updateAction({ hadController, handled = false, hasMedia }) {
  if (!hadController || handled) return 'none';
  return hasMedia ? 'notice' : 'reload';
}

/** Registra sw.js como módulo con alcance '/'. Si el navegador no tiene service workers
 *  o el registro falla, devuelve null y la web sigue funcionando en línea.
 *  Cuando una versión nueva toma el control de una página que ya tenía una anterior (updateAction): sin nada cargado,
 *  la página se recarga para que nadie se quede con la interfaz vieja; con algo cargado, se llama a onUpdate (el aviso
 *  «Hay una versión nueva…» con «Recargar») y no se recarga sola. En la primera visita no hace nada.
 *  hasMedia, onUpdate y reload se pueden sustituir (la app pasa su reproductor; las pruebas, dobles). */
export async function registerPwa({ hasMedia = () => pageHasMedia(), onUpdate = () => {}, reload = () => window.location.reload() } = {}) {
  if (!('serviceWorker' in navigator)) return null;
  const hadController = Boolean(navigator.serviceWorker.controller);
  let handled = false;
  if (typeof navigator.serviceWorker.addEventListener === 'function') {
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      let loaded = true;
      try {
        loaded = Boolean(hasMedia());
      } catch {
        // Ante la duda, no se recarga: se avisa.
      }
      const action = updateAction({ hadController, handled, hasMedia: loaded });
      if (action === 'none') return;
      handled = true;
      if (action === 'reload') reload();
      else onUpdate();
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
 * Pide al navegador que no borre lo guardado aquí (canciones descargadas, listas, subidas) cuando le falte espacio:
 * sin esto, un móvil puede vaciar la caché de audio y una canción «descargada» volvería a pedirse por la red.
 * Devuelve 'granted', 'denied' o 'unsupported' y nunca lanza. No muestra nada: Chrome lo concede o lo niega solo,
 * según el uso de la web, y un aviso cada vez que lo niega sería ruido.
 */
export async function requestPersistentStorage(storage = globalThis.navigator?.storage) {
  if (!storage || typeof storage.persist !== 'function') return 'unsupported';
  try {
    if (typeof storage.persisted === 'function' && (await storage.persisted())) return 'granted';
    return (await storage.persist()) ? 'granted' : 'denied';
  } catch {
    return 'denied';
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
