// Guardar cambios de la biblioteca desde la web. Hay dos caminos según el flag FEATURE_CATALOGO_R2 (ADR-0052):
//
// 1) Camino nuevo (por defecto): POST /api/catalogo/edit al Worker, que escribe el catálogo y el historial append-only
//    en R2 al momento. Las portadas van por POST /api/catalogo/edit con action set_cover (el fichero se guarda antes en
//    el bucket público por /api/portada). Se autoriza con X-Auth (js/auth.js). Sin GitHub.
//
// 2) Camino viejo (fallback si el flag está apagado o un payload que el Worker aún no soporta, p. ej. order_album):
//    POST /api/editar, que abre la incidencia «biblioteca» o guarda la portada con el token del servidor (ADR-0022 /
//    ADR-0029). Lo seguimos usando mientras no se hayan retirado los workflows.
//
// Pruebas: tests/web-unit/edit-remote.test.mjs (camino viejo) y tests/web-unit/edit-flow.test.mjs (camino nuevo).

import { api } from './api-config.js';
import { isCoverKey } from './cover-index.js';
import {
  FEATURE_CATALOGO_R2,
  fetchLatestCatalog,
  payloadToActions,
  sendBuzonPublish,
  sendCatalogEdit,
} from './catalog-remote.js';

export const EDIT_ENDPOINT = '/api/editar';
export const COVER_ENDPOINT = '/api/portada';
const apiFetch = (...args) => api.fetch(...args);
export const SAVED_TEXT = 'Guardado al momento en el catálogo.';
export const SAVED_TEXT_FAST = 'Guardado al momento en el catálogo.';
const NETWORK_TEXT = 'No se ha podido conectar con el servidor. Comprueba la conexión e inténtalo de nuevo.';

// Hook que el arranque (app.js) enlaza para los caminos nuevos: trae el cliente con X-Auth y el "versión actual del
// catálogo" que el Worker exige con if_match. Si no hay cliente, el camino nuevo se desactiva (fallback).
let liveWorker = null;

/** Enlaza el cliente autenticado + el proveedor de versión. Lo llama app.js al arrancar. */
export function bindCatalogWorker({
  authorizedFetch,
  getVersion,
  reloadLatest,
  publicFetch = apiFetch,
} = {}) {
  liveWorker = { authorizedFetch, getVersion, reloadLatest, publicFetch };
}

/** Quita el enlace (para pruebas y para poder volver al camino viejo). */
export function unbindCatalogWorker() {
  liveWorker = null;
}

/** ¿Vamos por el Worker? Hay enlace y el flag está activo. */
function useWorker() {
  return FEATURE_CATALOGO_R2 && liveWorker !== null;
}

/** Bytes de una imagen en data: (la portada ya recortada por resizeCoverFile). */
export function dataUrlToBytes(dataUrl) {
  const match = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl ?? ''));
  if (!match) throw new Error('La portada no se ha podido preparar.');
  const binary = atob(match[1]);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

// ---------------------------------------------------------------------------
// Camino viejo (compat con el flujo de GitHub mientras no se retiren los workflows)
// ---------------------------------------------------------------------------

async function postLegacyReceipt(init, fetchImpl, coverId = null) {
  let response;
  try {
    response = await fetchImpl(EDIT_ENDPOINT, { method: 'POST', ...init });
  } catch {
    throw new Error(NETWORK_TEXT);
  }
  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  if (response.ok && data?.ok === true) {
    return {
      message: typeof data.mensaje === 'string' ? data.mensaje : SAVED_TEXT,
      issue: Number.isInteger(data.incidencia) && data.incidencia > 0 ? data.incidencia : null,
      cover: coverId !== null && isCoverKey(data.portada, coverId) ? data.portada : null,
    };
  }
  throw new Error(typeof data?.error === 'string' && data.error ? data.error : `El servidor no ha aceptado el cambio (código ${response.status}).`);
}

// ---------------------------------------------------------------------------
// Camino nuevo: todo contra el Worker (R2)
// ---------------------------------------------------------------------------

async function sendOrganizeWorker(payload) {
  const actions = payloadToActions(payload);
  if (actions.length === 0) {
    // El Worker no soporta esta operación (p. ej. order_album): cae al camino viejo.
    const err = new Error('Esta acción no la soporta el camino nuevo.');
    err.name = 'FallbackLegacy';
    throw err;
  }
  const deps = {
    authorizedFetch: liveWorker.authorizedFetch,
    reloadLatest: liveWorker.reloadLatest,
  };
  let lastVersion = liveWorker.getVersion();
  let lastEvent = null;
  for (const action of actions) {
    const result = await sendCatalogEdit({ action: action.action, params: action.params, ifMatch: lastVersion }, deps);
    lastVersion = result.version ?? lastVersion;
    lastEvent = result.event;
  }
  return {
    message: SAVED_TEXT_FAST,
    issue: null,
    cover: null,
    version: lastVersion,
    event: lastEvent,
  };
}

async function sendCoverWorker(id, jpegBytes) {
  // Primero guardamos el fichero en el bucket público (/api/portada; ya existe, sin GitHub). Luego apuntamos el catálogo
  // a ese fichero con la acción set_cover.
  let response;
  try {
    response = await apiFetch(COVER_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'image/jpeg', 'X-Portada-Id': id },
      body: jpegBytes,
    });
  } catch {
    throw new Error(NETWORK_TEXT);
  }
  let data = null;
  try { data = await response.json(); } catch { data = null; }
  if (!response.ok || data?.ok !== true || !isCoverKey(data.portada, id)) {
    throw new Error(typeof data?.error === 'string' && data.error ? data.error : `No se ha podido guardar la portada (código ${response.status}).`);
  }
  const coverKey = data.portada;
  const params = id.startsWith('F') ? { folder_id: id, cover: coverKey } : { song_id: id, cover: coverKey };
  const deps = {
    authorizedFetch: liveWorker.authorizedFetch,
    reloadLatest: liveWorker.reloadLatest,
  };
  const result = await sendCatalogEdit({ action: 'set_cover', params, ifMatch: liveWorker.getVersion() }, deps);
  return {
    message: SAVED_TEXT_FAST,
    issue: null,
    cover: coverKey,
    version: result.version,
    event: result.event,
  };
}

// ---------------------------------------------------------------------------
// API pública (misma firma que antes)
// ---------------------------------------------------------------------------

/** Envía una operación de organizar ({ op, … }). Devuelve { message, issue, cover }. */
export async function sendOrganize(payload, fetchImpl = apiFetch) {
  if (useWorker()) {
    try {
      return await sendOrganizeWorker(payload);
    } catch (error) {
      if (error?.name !== 'FallbackLegacy') throw error;
      // Payload no soportado: se delega al camino viejo (p. ej. order_album).
    }
  }
  return postLegacyReceipt(
    { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'organize', payload }) },
    fetchImpl,
  );
}

/** Envía la portada (JPEG) de una canción (S…) o de un álbum (F…). */
export async function sendCover(id, jpegBytes, fetchImpl = apiFetch) {
  if (useWorker()) {
    return sendCoverWorker(id, jpegBytes);
  }
  return postLegacyReceipt(
    { headers: { 'Content-Type': 'image/jpeg', 'X-Portada-Id': id }, body: jpegBytes },
    fetchImpl,
    id,
  );
}

/** Publica un lote del buzón (ya subido a R2) en el catálogo. Devuelve { version, event } o lanza. */
export async function publishBuzon(songs) {
  if (!useWorker()) throw new Error('Camino nuevo del buzón no está activado.');
  return sendBuzonPublish(
    { songs, ifMatch: liveWorker.getVersion() },
    { authorizedFetch: liveWorker.authorizedFetch, reloadLatest: liveWorker.reloadLatest },
  );
}

/** Como sendOrganize, pero solo devuelve el mensaje de éxito. */
export async function saveOrganize(payload, fetchImpl = apiFetch) {
  return (await sendOrganize(payload, fetchImpl)).message;
}

/** Como sendCover, pero solo devuelve el mensaje de éxito. */
export async function saveCover(id, jpegBytes, fetchImpl = apiFetch) {
  return (await sendCover(id, jpegBytes, fetchImpl)).message;
}

export const STATUS_TIMEOUT_MS = 15_000;

/**
 * Estado de una edición ya enviada (ADR-0027): GET /api/editar?incidencia=N. En el camino nuevo no hay incidencias, pero
 * el gestor de ediciones pendientes la llama con el número de incidencia que guardó (null tras pasar al Worker). Si
 * issue es null, devolvemos 'cerrada': el cambio del Worker se confirma leyendo el catálogo, no la incidencia.
 */
export async function fetchEditStatus(issue, fetchImpl = apiFetch, timeoutMs = STATUS_TIMEOUT_MS) {
  if (!Number.isInteger(issue) || issue < 1) {
    // En el camino nuevo no hay incidencia: el cambio ya se confirma por catálogo; damos "cerrada" para que la
    // revisión mire solo si el catálogo lo refleja.
    if (useWorker()) return 'cerrada';
    throw new Error('Número de incidencia no válido.');
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${EDIT_ENDPOINT}?incidencia=${issue}`, { cache: 'no-store', signal: controller.signal });
    const data = await response.json();
    if (!response.ok || data?.ok !== true || !['abierta', 'cerrada', 'error'].includes(data.estado)) {
      throw new Error(`Estado desconocido (código ${response.status}).`);
    }
    return data.estado;
  } finally {
    clearTimeout(timeout);
  }
}

// Reexport práctico para que app.js tenga una sola importación centralizada.
export { fetchLatestCatalog };
