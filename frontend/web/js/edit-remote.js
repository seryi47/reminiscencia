// Guardar cambios de la biblioteca desde la web sin pasar por GitHub (ADR-0022): se envían a POST /api/editar, que abre
// la incidencia «biblioteca» (textos y álbumes) o guarda la portada con el token del servidor. Este módulo no conoce
// ningún token. Pruebas: tests/web-unit/edit-remote.test.mjs.

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

async function post(init, fetchImpl) {
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
  if (response.ok && data?.ok === true) return typeof data.mensaje === 'string' ? data.mensaje : SAVED_TEXT;
  throw new Error(typeof data?.error === 'string' && data.error ? data.error : `El servidor no ha aceptado el cambio (código ${response.status}).`);
}

/** Envía una operación de organizar ({ op, … }). Devuelve el mensaje de éxito o lanza un Error con el motivo. */
export function saveOrganize(payload, fetchImpl = globalThis.fetch) {
  return post({ headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'organize', payload }) }, fetchImpl);
}

/** Envía la portada (JPEG) de una canción (S…) o de un álbum (F…). */
export function saveCover(id, jpegBytes, fetchImpl = globalThis.fetch) {
  return post({ headers: { 'Content-Type': 'image/jpeg', 'X-Portada-Id': id }, body: jpegBytes }, fetchImpl);
}
