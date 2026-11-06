// Guardar cambios de la biblioteca desde la web sin pasar por GitHub (ADR-0022): se envían a POST /api/editar, que abre
// la incidencia «biblioteca» (textos y álbumes) o guarda la portada con el token del servidor. Este módulo no conoce
// ningún token. También pregunta el estado de una edición enviada (ADR-0027). Pruebas: tests/web-unit/edit-remote.test.mjs.

export const EDIT_ENDPOINT = '/api/editar';
export const SAVED_TEXT = 'Guardado: llegará a todos en un par de minutos.';
const NETWORK_TEXT = 'No se ha podido conectar con el servidor. Comprueba la conexión e inténtalo de nuevo.';

/** Bytes de una imagen en data: (la portada ya recortada por resizeCoverFile). */
export function dataUrlToBytes(dataUrl) {
  const match = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl ?? ''));
  if (!match) throw new Error('La portada no se ha podido preparar.');
  const binary = atob(match[1]);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

// Respuesta aceptada de /api/editar: { message, issue } (issue: número de incidencia, o null en las portadas).
async function postReceipt(init, fetchImpl) {
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
    };
  }
  throw new Error(typeof data?.error === 'string' && data.error ? data.error : `El servidor no ha aceptado el cambio (código ${response.status}).`);
}

/** Envía una operación de organizar ({ op, … }). Devuelve { message, issue } o lanza un Error con el motivo. */
export function sendOrganize(payload, fetchImpl = globalThis.fetch) {
  return postReceipt({ headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'organize', payload }) }, fetchImpl);
}

/** Envía la portada (JPEG) de una canción (S…) o de un álbum (F…). Devuelve { message, issue: null }. */
export function sendCover(id, jpegBytes, fetchImpl = globalThis.fetch) {
  return postReceipt({ headers: { 'Content-Type': 'image/jpeg', 'X-Portada-Id': id }, body: jpegBytes }, fetchImpl);
}

/** Como sendOrganize, pero solo devuelve el mensaje de éxito. */
export async function saveOrganize(payload, fetchImpl = globalThis.fetch) {
  return (await sendOrganize(payload, fetchImpl)).message;
}

/** Como sendCover, pero solo devuelve el mensaje de éxito. */
export async function saveCover(id, jpegBytes, fetchImpl = globalThis.fetch) {
  return (await sendCover(id, jpegBytes, fetchImpl)).message;
}

export const STATUS_TIMEOUT_MS = 15_000;

/**
 * Estado de una edición ya enviada (ADR-0027): GET /api/editar?incidencia=N → 'abierta', 'cerrada' o 'error'. Lanza
 * si no se sabe (sin conexión, respuesta rara): quien pregunta lo trata como «desconocido».
 */
export async function fetchEditStatus(issue, fetchImpl = globalThis.fetch, timeoutMs = STATUS_TIMEOUT_MS) {
  if (!Number.isInteger(issue) || issue < 1) throw new Error('Número de incidencia no válido.');
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
