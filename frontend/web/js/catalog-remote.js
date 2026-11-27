// Cliente del catálogo en R2 (ADR-0052): lee del Worker el catálogo actual y manda ediciones, publicaciones del buzón y
// rollbacks. El Worker guarda cada escritura con `If-Match` (versión actual del catálogo) y el historial append-only en
// R2. Si otro cambia el catálogo entre el fetch y el POST, el Worker responde 412 y este cliente vuelve a leer y
// reintenta una vez. Si otra operación tiene el lock, responde 423 con Retry-After y espera ese tiempo (máximo 15 s).
//
// Módulo puro: fetchImpl y authHeaders se inyectan en las pruebas (tests/web-unit/edit-flow.test.mjs y
// catalog-fetch.test.mjs). El diseño del Worker vive en docs/decisions/ADR-0052.

import { api } from './api-config.js';

export const CATALOG_PATH = '/api/catalogo/latest';
export const WAIT_PATH = '/api/catalogo/wait';
export const EDIT_PATH = '/api/catalogo/edit';
export const BUZON_PATH = '/api/buzon/publish';
export const HISTORIAL_PATH = '/api/catalogo/historial';
export const ROLLBACK_PATH = '/api/catalogo/rollback';
export const ETAG_STORAGE_KEY = 'reminiscencia.catalog.etag';
export const BODY_STORAGE_KEY = 'reminiscencia.catalog.body';
/** Umbral de tamaño del catálogo guardable en localStorage. Por encima, no se guarda el cuerpo (algunos navegadores
 *  tienen un tope duro de ~5 MB por origen y guardar un catálogo gigante llenaría el storage e impediría guardar
 *  otras cosas). El ETag sigue guardándose siempre. */
const MAX_STORED_BODY_BYTES = 3 * 1024 * 1024;

/** Ventana del long-poll que pedimos al Worker en cada iteración (segundos). 25 s está por debajo del tope del
 * Worker (30 s) y por debajo de cualquier timeout razonable de proxy intermedio. */
export const WATCH_WAIT_TIMEOUT_S = 25;
/** Fallback por si la conexión long-poll se cae sin aviso (ms). Hace un ping con If-None-Match al /latest; la
 * respuesta 304 pesa ~100 bytes y no gasta CPU del Worker. */
export const WATCH_FALLBACK_INTERVAL_MS = 60_000;

/** Interruptor general del camino nuevo (ADR-0052). true = la web lee y escribe contra el Worker/R2; false = camino
 *  viejo por /data/*.json + /api/editar + GitHub Actions. Si en producción algo no cuadra, basta con poner
 *  window.FEATURE_CATALOGO_R2 = false en la consola o fijarlo aquí a false y redeployar. */
export const FEATURE_CATALOGO_R2 = (() => {
  try {
    if (typeof globalThis !== 'undefined' && 'FEATURE_CATALOGO_R2' in globalThis) {
      return globalThis.FEATURE_CATALOGO_R2 !== false;
    }
  } catch {
    // Sin acceso a globalThis: por defecto encendido.
  }
  return true;
})();
try {
  if (typeof globalThis !== 'undefined' && !('FEATURE_CATALOGO_R2' in globalThis)) {
    globalThis.FEATURE_CATALOGO_R2 = FEATURE_CATALOGO_R2;
  }
} catch {
  // Sandbox restringido: no se expone.
}

export const SAVED_TEXT = 'Guardado al momento en el catálogo.';
const NETWORK_TEXT = 'No se ha podido conectar con el servidor. Comprueba la conexión e inténtalo de nuevo.';
const CONFLICT_TEXT = 'El catálogo lo editó otra persona justo ahora. Vuelve a probar.';
const AUTH_TEXT = 'La contraseña del catálogo no vale. Vuelve a ponerla.';

const apiFetch = (path, init) => api.fetch(path, init);

/** ¿Es un ETag débil con la forma W/"v<N>"? Devuelve N o null. */
export function parseVersionEtag(value) {
  if (typeof value !== 'string') return null;
  const match = /^W\/"v(\d+)"$/.exec(value.trim());
  if (!match) return null;
  const version = Number(match[1]);
  return Number.isInteger(version) && version >= 0 ? version : null;
}

/** Lee el catálogo actual (versión + songs + folders + updated_at). Devuelve { catalog, etag, status, fromCache }. */
export async function fetchLatestCatalog({
  fetchImpl = apiFetch,
  etag = null,
  signal = undefined,
} = {}) {
  const headers = {};
  if (typeof etag === 'string' && etag !== '') headers['If-None-Match'] = etag;
  let response;
  try {
    response = await fetchImpl(CATALOG_PATH, { cache: 'no-store', headers, ...(signal ? { signal } : {}) });
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    throw new Error(NETWORK_TEXT);
  }
  if (response.status === 304) {
    return { catalog: null, etag: response.headers?.get?.('ETag') ?? etag, status: 304, notModified: true };
  }
  if (response.status === 503) {
    // Catálogo aún no migrado (el Worker lo dice): vista vacía hasta que se migre.
    return { catalog: { version: 0, folders: [], songs: [], updated_at: null }, etag: null, status: 503, notMigrated: true };
  }
  if (!response.ok) throw new Error(`El catálogo no se ha podido leer (código ${response.status}).`);
  const data = await response.json();
  if (!data || !Array.isArray(data.folders) || !Array.isArray(data.songs)) {
    throw new Error('El catálogo recibido no tiene el formato esperado.');
  }
  return { catalog: data, etag: response.headers?.get?.('ETag') ?? null, status: 200 };
}

/** Lee el ETag guardado en localStorage (útil para 304 en la siguiente visita). */
export function readStoredEtag(storage = (() => { try { return globalThis.localStorage; } catch { return null; } })()) {
  if (!storage) return null;
  try { return storage.getItem(ETAG_STORAGE_KEY); } catch { return null; }
}

/** Guarda el ETag en localStorage; null o '' lo borra. */
export function writeStoredEtag(etag, storage = (() => { try { return globalThis.localStorage; } catch { return null; } })()) {
  if (!storage) return;
  try {
    if (etag === null || etag === '' || etag === undefined) storage.removeItem(ETAG_STORAGE_KEY);
    else storage.setItem(ETAG_STORAGE_KEY, String(etag));
  } catch {
    // Almacenamiento bloqueado: no pasa nada.
  }
}

/** Lee el catálogo completo guardado en localStorage. Devuelve `{version, folders, songs, updated_at}` o null si no hay o
 *  no es válido. Sirve para pintar la biblioteca al instante al arrancar antes de que llegue la respuesta del Worker. */
export function readStoredCatalog(storage = (() => { try { return globalThis.localStorage; } catch { return null; } })()) {
  if (!storage) return null;
  try {
    const raw = storage.getItem(BODY_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.folders) || !Array.isArray(parsed.songs)) return null;
    if (typeof parsed.version !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Guarda el catálogo completo en localStorage (si cabe). null lo borra. Idempotente: no re-serializa el mismo body. */
export function writeStoredCatalog(catalog, storage = (() => { try { return globalThis.localStorage; } catch { return null; } })()) {
  if (!storage) return;
  try {
    if (catalog === null || catalog === undefined) { storage.removeItem(BODY_STORAGE_KEY); return; }
    const body = JSON.stringify(catalog);
    if (body.length > MAX_STORED_BODY_BYTES) { storage.removeItem(BODY_STORAGE_KEY); return; }
    storage.setItem(BODY_STORAGE_KEY, body);
  } catch {
    // Almacenamiento lleno o bloqueado: no pasa nada, la red seguirá sirviendo.
  }
}

// ---------- IndexedDB (ADR-0052 ampliación) ----------
// Lee/escribe el catálogo prefiriendo IndexedDB sobre localStorage: más espacio (50 MB+) y no bloquea el hilo.
// Fallback transparente a localStorage si el navegador no lo soporta. Compatibilidad: migra una vez lo que haya
// en localStorage[BODY_STORAGE_KEY] a IndexedDB y después limpia localStorage.
import {
  readStoredCatalogAsync, writeStoredCatalogAsync, migrateFromLocalStorageOnce, isIndexedDbAvailable,
} from './idb-catalog-store.js';

let _migratedOnce = false;

export async function readStoredCatalogPreferIdb() {
  if (isIndexedDbAvailable()) {
    if (!_migratedOnce) {
      try { await migrateFromLocalStorageOnce(BODY_STORAGE_KEY); } catch { /* nada */ }
      _migratedOnce = true;
    }
    const idb = await readStoredCatalogAsync();
    if (idb) return idb;
  }
  return readStoredCatalog();
}

export async function writeStoredCatalogPreferIdb(catalog) {
  if (isIndexedDbAvailable()) {
    await writeStoredCatalogAsync(catalog);
    return;
  }
  writeStoredCatalog(catalog);
}

/** Interpreta el 'Retry-After' (segundos entero o fecha) y lo convierte a ms. Máximo 15 s. */
function retryAfterMs(response) {
  const raw = response?.headers?.get?.('Retry-After');
  if (typeof raw !== 'string' || raw === '') return 1000;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(15_000, Math.max(0, Math.floor(seconds * 1000)));
  const when = Date.parse(raw);
  if (Number.isFinite(when)) return Math.min(15_000, Math.max(0, when - Date.now()));
  return 1000;
}

/**
 * POST genérico al Worker con auth, if_match, 412/423/401 manejados.
 * Opciones:
 * - authorizedFetch(path, init): fetch con X-Auth + X-Actor añadidos (createAuthClient().authorizedFetch(fetchImpl)).
 * - reloadLatest(): lee el catálogo actual para recalcular if_match en un 412, devuelve { version } o null si no se puede.
 * - adjustBody(previous, latest): opcional, ajusta el cuerpo con los datos nuevos (por defecto cambia solo if_match).
 * - sleep(ms): para esperar Retry-After en 423 (inyectable en pruebas).
 * - maxRetries: reintentos ante 412 (por defecto 1) y 423 (por defecto 2).
 */
async function postWithIfMatch(path, {
  body,
  authorizedFetch,
  reloadLatest,
  adjustBody = (previous, latest) => ({ ...previous, if_match: latest.version }),
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  maxConflictRetries = 1,
  maxLockRetries = 2,
}) {
  let currentBody = body;
  let conflicts = 0;
  let locks = 0;
  while (true) {
    let response;
    try {
      response = await authorizedFetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(currentBody),
      });
    } catch (error) {
      throw new Error(NETWORK_TEXT);
    }
    if (response.status === 401) throw Object.assign(new Error(AUTH_TEXT), { name: 'AuthError', status: 401 });
    if (response.status === 423) {
      if (locks >= maxLockRetries) throw new Error('El catálogo está siendo editado por otra persona.');
      locks += 1;
      await sleep(retryAfterMs(response));
      continue;
    }
    if (response.status === 409) {
      // El Worker rechaza la canción por sha256 duplicado (ya está en el catálogo). No es un error del cliente:
      // la canción ya está publicada, el upload tracker debe tratarlo como éxito "ya estaba".
      let data = null;
      try { data = await response.json(); } catch { data = null; }
      throw Object.assign(new Error(typeof data?.error === 'string' && data.error ? data.error : 'La canción ya está en la biblioteca.'), { name: 'BuzonDuplicateError', status: 409 });
    }
    if (response.status === 412) {
      if (conflicts >= maxConflictRetries) {
        throw Object.assign(new Error(CONFLICT_TEXT), { name: 'ConflictError', status: 412 });
      }
      conflicts += 1;
      const latest = typeof reloadLatest === 'function' ? await reloadLatest() : null;
      if (!latest || !Number.isInteger(latest.version)) throw new Error(CONFLICT_TEXT);
      currentBody = adjustBody(currentBody, latest);
      continue;
    }
    let data = null;
    try { data = await response.json(); } catch { data = null; }
    if (!response.ok || data?.ok !== true) {
      throw new Error(typeof data?.error === 'string' && data.error ? data.error : `El servidor no ha aceptado el cambio (código ${response.status}).`);
    }
    return { version: Number.isInteger(data.version) ? data.version : null, event: data.event ?? null };
  }
}

/** Envía una acción simple (ADR-0052). action + params + if_match (versión actual del catálogo). */
export async function sendCatalogEdit({ action, params, ifMatch }, deps = {}) {
  return postWithIfMatch(EDIT_PATH, {
    body: { action, params: params ?? {}, if_match: ifMatch },
    ...deps,
  });
}

/** Publica canciones del buzón (ya subidas a R2) en una sola operación. */
export async function sendBuzonPublish({ songs, ifMatch }, deps = {}) {
  return postWithIfMatch(BUZON_PATH, {
    body: { songs: Array.isArray(songs) ? songs : [], if_match: ifMatch },
    ...deps,
  });
}

/** Rollback del catálogo a una versión anterior (lee la snapshot por versión). */
export async function sendRollback({ toVersion }, deps = {}) {
  return postWithIfMatch(ROLLBACK_PATH, {
    body: { to_version: toVersion },
    ...deps,
  });
}

/**
 * Long-poll al Worker para enterarse de cambios del catálogo al instante (ADR-0052, tiempo real sin coste).
 *
 * Mantiene un bucle `while (!stopped)` que llama a `/api/catalogo/wait?if_version=<v>&timeout=25` con `fetch`
 * cancelable (AbortController). Si el Worker devuelve 200 → `onUpdate(catalog)`. Si 204 → reintenta sin esperar.
 * Si hay un error de red → backoff exponencial 1s, 2s, 4s, …, tope 30s.
 *
 * Se pausa cuando la pestaña queda en background (`document.visibilityState === 'hidden'`) para no mantener
 * conexiones abiertas inútiles, y se reanuda al volver. Además, cada [WATCH_FALLBACK_INTERVAL_MS] el bucle hace
 * un ping con `If-None-Match` a `/latest` por si la conexión long-poll se queda colgada en algún proxy
 * intermedio (una respuesta 304 pesa ~100 bytes).
 *
 * Devuelve un objeto `{ stop() }` para que `start()` pueda detenerlo en shutdown.
 *
 * Parámetros inyectables para pruebas: `fetchImpl`, `now`, `sleep`, `doc` (document), `getVersion`.
 */
export function watchCatalog({
  getVersion,
  onUpdate,
  onError,
  fetchImpl = apiFetch,
  doc = (() => { try { return globalThis.document ?? null; } catch { return null; } })(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = () => Date.now(),
  waitTimeoutS = WATCH_WAIT_TIMEOUT_S,
  fallbackIntervalMs = WATCH_FALLBACK_INTERVAL_MS,
} = {}) {
  if (typeof getVersion !== 'function') throw new TypeError('watchCatalog: falta getVersion.');
  if (typeof onUpdate !== 'function') throw new TypeError('watchCatalog: falta onUpdate.');
  let stopped = false;
  let currentController = null;
  let failures = 0;
  let paused = false;
  let wakeResolve = null;
  let loopDone;
  const waitForWake = () => new Promise((resolve) => { wakeResolve = resolve; });
  const wake = () => { if (wakeResolve) { const r = wakeResolve; wakeResolve = null; r(); } };
  // Yield real al event loop (macrotask) para no monopolizar la CPU cuando fetch y sleep inyectados resuelven inmediato.
  const yieldMacrotask = () => new Promise((resolve) => setTimeout(resolve, 0));

  // Visibilidad: pausar en background para no mantener conexión.
  let visibilityHandler = null;
  if (doc && typeof doc.addEventListener === 'function') {
    visibilityHandler = () => {
      const hidden = doc.visibilityState === 'hidden';
      if (hidden && !paused) {
        paused = true;
        if (currentController) currentController.abort();
      } else if (!hidden && paused) {
        paused = false;
        wake();
      }
    };
    doc.addEventListener('visibilitychange', visibilityHandler);
  }

  const loop = async () => {
    let lastFallbackAt = now();
    while (!stopped) {
      // Yield real al event loop (macrotask) al inicio de cada iteración. Así los setTimeouts externos pueden
      // dispararse y stop() se puede atender aunque el fetch y sleep inyectados resuelvan inmediato.
      await yieldMacrotask();
      if (stopped) break;
      if (paused) { await waitForWake(); continue; }
      const version = Math.max(0, Number(getVersion()) || 0);
      currentController = new AbortController();
      const url = `${WAIT_PATH}?if_version=${encodeURIComponent(version)}&timeout=${encodeURIComponent(waitTimeoutS)}`;
      let response;
      try {
        response = await fetchImpl(url, { cache: 'no-store', signal: currentController.signal });
      } catch (error) {
        if (stopped || paused) continue;
        if (error?.name === 'AbortError') continue;
        failures += 1;
        if (typeof onError === 'function') { try { onError(error); } catch { /* el callback se come sus errores */ } }
        const backoff = Math.min(30_000, 1000 * Math.pow(2, Math.min(failures - 1, 5)));
        await sleep(backoff);
        continue;
      } finally {
        currentController = null;
      }
      if (response.status === 200) {
        failures = 0;
        let catalog;
        try { catalog = await response.json(); } catch { catalog = null; }
        if (catalog && Array.isArray(catalog.folders) && Array.isArray(catalog.songs)) {
          try { await onUpdate(catalog); } catch (error) {
            if (typeof onError === 'function') { try { onError(error); } catch { /* idem */ } }
          }
          lastFallbackAt = now();
        }
        continue;
      }
      if (response.status === 204) {
        failures = 0;
        // Oportunidad: si llevamos más de fallbackIntervalMs sin respuesta real, hacemos un ping /latest para
        // detectar cambios que el long-poll pudiera estar perdiendo (proxy que cortó el stream sin avisar).
        if (now() - lastFallbackAt >= fallbackIntervalMs) {
          lastFallbackAt = now();
          try {
            const ping = await fetchImpl(CATALOG_PATH, {
              cache: 'no-store',
              headers: { 'If-None-Match': `W/"v${version}"` },
            });
            if (ping.status === 200) {
              let catalog;
              try { catalog = await ping.json(); } catch { catalog = null; }
              if (catalog && Array.isArray(catalog.folders) && Array.isArray(catalog.songs)) {
                try { await onUpdate(catalog); } catch { /* idem */ }
              }
            }
          } catch { /* errores aquí también suben a backoff del bucle principal */ }
        }
        continue;
      }
      // Otras respuestas (503, 500, …): tratar como error con backoff.
      failures += 1;
      if (typeof onError === 'function') {
        try { onError(new Error(`wait HTTP ${response.status}`)); } catch { /* idem */ }
      }
      const backoff = Math.min(30_000, 1000 * Math.pow(2, Math.min(failures - 1, 5)));
      await sleep(backoff);
    }
  };

  loopDone = loop().catch(() => { /* loop ya absorbe */ });

  return {
    stop() {
      stopped = true;
      if (currentController) currentController.abort();
      if (doc && visibilityHandler && typeof doc.removeEventListener === 'function') {
        doc.removeEventListener('visibilitychange', visibilityHandler);
      }
      wake();
      return loopDone;
    },
  };
}

/** Lee el historial append-only del Worker. limit: hasta 1000. */
export async function fetchHistorial({ fetchImpl = apiFetch, limit = 100, signal } = {}) {
  const url = `${HISTORIAL_PATH}?limit=${encodeURIComponent(Number.isInteger(limit) && limit > 0 ? Math.min(limit, 1000) : 100)}`;
  let response;
  try {
    response = await fetchImpl(url, { cache: 'no-store', ...(signal ? { signal } : {}) });
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    throw new Error(NETWORK_TEXT);
  }
  if (!response.ok) throw new Error(`No se ha podido leer el historial (código ${response.status}).`);
  const data = await response.json();
  if (!data || !Array.isArray(data.events)) throw new Error('El historial no tiene el formato esperado.');
  return { events: data.events, limit: Number.isInteger(data.limit) ? data.limit : limit };
}

// ---------------------------------------------------------------------------
// Adaptador: operaciones de la UI (ADR-0027) → acciones del Worker (ADR-0052)
// ---------------------------------------------------------------------------

/**
 * Reparte un payload de edición de la UI en una o varias acciones del Worker (que son atómicas por campo). Cada acción
 * es { action, params }. Devuelve [] si el payload no tiene sitio en el Worker (ninguna rama cae a legacy desde el
 * commit de fixes críticos del ADR-0052: /api/editar devuelve 410).
 *
 * Nombres de params: el Worker exige `new_title` (rename_song), `new_name` (rename_folder) y `name` (create_folder).
 * Para `edit_song` se usa `set_song_fields` atómico: un único POST que aplica title/artist/year/tags a la vez; así se
 * evita el problema de "primer campo aplicado, segundo 412 persistente, UI inconsistente".
 */
export function payloadToActions(payload) {
  if (!payload || typeof payload !== 'object') return [];
  switch (payload.op) {
    case 'edit_song': {
      const songId = payload.song_id;
      const fields = {};
      if ('title' in payload) fields.title = payload.title;
      if ('artist' in payload) fields.artist = payload.artist;
      if ('year' in payload) fields.year = payload.year;
      if ('tags' in payload) fields.tags = Array.isArray(payload.tags) ? payload.tags : [];
      const actions = [];
      if (Object.keys(fields).length > 0) {
        actions.push({ action: 'set_song_fields', params: { song_id: songId, fields } });
      }
      if ('folder_id' in payload) {
        actions.push({ action: 'move_song', params: { song_id: songId, folder_id: payload.folder_id ?? null } });
      }
      return actions;
    }
    case 'unpublish_song':
      return [{ action: 'unpublish_song', params: { song_id: payload.song_id } }];
    case 'edit_folder':
    case 'rename_folder': {
      // rename_folder del Worker (ADR-0052) acepta `new_name` obligatorio + `artist` opcional en el mismo paso.
      // Si solo se cambia el artist (sin renombrar), se emite con el nombre actual para no violar la validación: no
      // ocurre hoy desde la UI (edit_folder siempre trae nombre), pero si pasara, se cae a [] y la UI avisa.
      const params = { folder_id: payload.folder_id };
      if ('name' in payload) params.new_name = payload.name;
      if ('artist' in payload) params.artist = payload.artist ?? '';
      if (!('new_name' in params)) return [];
      return [{ action: 'rename_folder', params }];
    }
    case 'delete_folder':
      return [{ action: 'delete_folder', params: { folder_id: payload.folder_id } }];
    case 'move_songs':
      return (Array.isArray(payload.song_ids) ? payload.song_ids : []).map((id) => ({
        action: 'move_song',
        params: { song_id: id, folder_id: payload.folder_id ?? null },
      }));
    case 'create_folder':
      return [{ action: 'create_folder', params: {
        name: payload.name,
        ...(payload.artist ? { artist: payload.artist } : {}),
        ...(payload.parent_id ? { parent_id: payload.parent_id } : {}),
      } }];
    case 'order_album':
      return [{ action: 'reorder_folder', params: { folder_id: payload.folder_id, order: Array.isArray(payload.song_ids) ? payload.song_ids : [] } }];
    default:
      return [];
  }
}
