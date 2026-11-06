// Dirección del API (ADR-0029). Las peticiones de la web a /api/subir, /api/editar y /api/portada van al Worker de
// Cloudflare «reminiscencia-api» si WORKER_API_BASE tiene su dirección, y si no (o si el Worker no responde) a las
// funciones de Vercel del propio origen, como antes. La APK tiene su equivalente en mobile/lib/api_config.dart.
//
// ÚNICO SITIO QUE HAY QUE CAMBIAR al desplegar el Worker: WORKER_API_BASE, sin barra final, por ejemplo
// 'https://reminiscencia-api.<subdominio>.workers.dev'. Vacía = todo por Vercel. Añadir también ese origen a la CSP
// de vercel.json (connect-src); la prueba tests/web-unit/cabeceras.test.mjs lo comprueba.
//
// Lógica pura (fetch inyectable): tests/web-unit/api-config.test.mjs.

export const WORKER_API_BASE = 'https://reminiscencia-api.reminiscencia-app.workers.dev';

/**
 * Tamaño de trozo de /api/subir (y máximo que admite cada servidor; server/upload-core.js los usa): 4 MB en Vercel
 * (admite 4,5 MB por petición) y 32 MB en el Worker. Un Worker admite cuerpos de 100 MB en los planes Free y Pro (más
 * en Business y Enterprise) y 128 MB de memoria por petición: 32 MB deja sitio para comparar un trozo repetido con el
 * guardado. El backend (sonidos.entrada.MAX_PART_BYTES) admite el mayor de los dos.
 */
export const VERCEL_CHUNK_BYTES = 4 * 1024 * 1024;
export const WORKER_CHUNK_BYTES = 32 * 1024 * 1024;
/** Cabecera que el Worker pone en todas sus respuestas: sin ella, la respuesta no es suya (página de error, etc.). */
export const WORKER_HEADER = 'X-Reminiscencia-Api';
export const HEALTH_PATH = '/api/salud';
export const PROBE_TIMEOUT_MS = 4000;
/** Tras un fallo del Worker, cuánto tiempo se va directamente a Vercel antes de volver a probarlo. */
export const RETRY_WORKER_AFTER_MS = 5 * 60_000;

const VERCEL = Object.freeze({ base: '', worker: false, chunkBytes: VERCEL_CHUNK_BYTES });

/** Base válida del Worker (https, sin barra final ni ruta), o '' si no hay. */
export function normalizeApiBase(value) {
  const text = typeof value === 'string' ? value.trim().replace(/\/+$/, '') : '';
  if (text === '') return '';
  try {
    const url = new URL(text);
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) || url.pathname !== '/' || url.search || url.hash) return '';
    return url.origin;
  } catch {
    return '';
  }
}

/** True si la respuesta viene del Worker (y no de una página de error de Cloudflare o de otro sitio). */
export function isWorkerResponse(response) {
  return Boolean(response?.headers?.get?.(WORKER_HEADER));
}

/**
 * Cliente del API con respaldo en Vercel. Opciones (inyectables en las pruebas): base, fetchImpl, now, probeTimeoutMs.
 * - fetch(path, init): manda la petición al Worker; si no responde (fallo de red, CORS, tiempo agotado o una respuesta
 *   que no es suya), la repite en Vercel (path relativo) y, durante RETRY_WORKER_AFTER_MS, va directamente a Vercel.
 * - uploadTarget(): { base, worker, chunkBytes, fetch } para subir UN archivo entero por el mismo sitio (los trozos de
 *   32 MB del Worker no caben en Vercel): pregunta antes a /api/salud del Worker. Sin respaldo a mitad de archivo.
 */
export function createApiClient({
  base = WORKER_API_BASE,
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
  probeTimeoutMs = PROBE_TIMEOUT_MS,
} = {}) {
  const workerBase = normalizeApiBase(base);
  let downUntil = 0;
  const workerUsable = () => workerBase !== '' && now() >= downUntil;
  const markDown = () => { downUntil = now() + RETRY_WORKER_AFTER_MS; };

  async function viaWorker(path, init) {
    const response = await fetchImpl(`${workerBase}${path}`, init);
    if (!isWorkerResponse(response)) throw new Error('La respuesta no es del Worker.');
    return response;
  }

  async function apiFetch(path, init = {}) {
    if (workerUsable()) {
      try {
        return await viaWorker(path, init);
      } catch (error) {
        if (init?.signal?.aborted) throw error;
        markDown();
      }
    }
    return fetchImpl(path, init);
  }

  async function probe() {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), probeTimeoutMs) : null;
    try {
      const response = await viaWorker(HEALTH_PATH, { cache: 'no-store', ...(controller ? { signal: controller.signal } : {}) });
      const data = await response.json();
      return response.ok && data?.ok === true;
    } catch {
      return false;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function uploadTarget() {
    if (workerUsable()) {
      if (await probe()) {
        return {
          base: workerBase,
          worker: true,
          chunkBytes: WORKER_CHUNK_BYTES,
          fetch: (path, init) => fetchImpl(`${workerBase}${path}`, init),
        };
      }
      markDown();
    }
    return { ...VERCEL, fetch: (path, init) => fetchImpl(path, init) };
  }

  /** Solo el Worker (rutas que Vercel no tiene, como GET /api/portadas): lanza si no está o no responde. */
  async function workerFetch(path, init = {}) {
    if (!workerUsable()) throw new Error('Sin Worker.');
    try {
      return await viaWorker(path, init);
    } catch (error) {
      if (!init?.signal?.aborted) markDown();
      throw error;
    }
  }

  return {
    base: workerBase,
    fetch: apiFetch,
    workerFetch,
    uploadTarget,
    /** True si ahora mismo se usaría el Worker. */
    usesWorker: workerUsable,
  };
}

/** Cliente común de la web (con WORKER_API_BASE). */
export const api = createApiClient();
