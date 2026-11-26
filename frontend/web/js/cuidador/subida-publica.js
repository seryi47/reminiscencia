// Subida para todos desde la web (ADR-0017): cada archivo que se elige se convierte a Ogg Opus en este navegador
// (convertToOpus de subida-local.js, sin límites de tamaño ni de duración) y se envía, de uno en uno y en orden, a
// POST /api/subir, en trozos de hasta 4 MB por la función de Vercel del propio origen (admite 4,5 MB por petición) o
// de hasta 32 MB por el Worker de Cloudflare (ADR-0029). Quién recibe cada archivo lo decide js/api-config.js
// (uploadTarget, en js/app.js): la dirección y el tamaño de trozo llegan en fetchImpl y chunkBytes. La función lo
// guarda en el bucket privado y el workflow buzon lo publica para todos. El título de la canción es el
// nombre del archivo sin extensión. Este módulo no conoce ningún token: solo habla con /api/subir.
//
// Las funciones puras (trozos, cabeceras, lectura de la respuesta) van exportadas para las pruebas
// (tests/web-unit/subida-publica.test.mjs). Lo que usa el navegador se resuelve dentro de las funciones.

import { convertToOpus, LocalAudioError, opusSupport, titleFromFileName, UNSUPPORTED_TEXT } from './subida-local.js';
import { VERCEL_CHUNK_BYTES, WORKER_CHUNK_BYTES } from '../api-config.js';
import { PresignedUploadError, sendOpusPresigned } from './subida-presigned.js';

/** Ruta del contrato; la base (Worker o el propio origen) la pone el fetchImpl de js/api-config.js. */
export const UPLOAD_ENDPOINT = '/api/subir';
/** Trozo por defecto (Vercel). Con el Worker, WORKER_CHUNK_BYTES (32 MB). */
export const CHUNK_BYTES = VERCEL_CHUNK_BYTES;
export { WORKER_CHUNK_BYTES };
export const PUBLIC_AUDIO_ACCEPT = 'audio/*,.wav,.mp3,.m4a,.flac,.ogg,.opus';
export const RIGHTS_TEXT = 'Al subir, declaras que tienes derecho a publicar estos archivos.';
export const DONE_TEXT = 'Subida al momento a la biblioteca.';

/** Activar/desactivar presigned-first. true por defecto desde ADR-0052 (2026-11-26) cuando el Worker tiene los
 *  secretos R2_* configurados. Si `false`, se usa siempre el flujo clásico de trozos por /api/subir. */
export const FEATURE_PRESIGNED_UPLOAD = true;
export const PUBLIC_UNSUPPORTED_TEXT = UNSUPPORTED_TEXT;
const NETWORK_TEXT = 'No se ha podido conectar con el servidor. Comprueba la conexión e inténtalo de nuevo.';
const RETRIES = 2; // reintentos de un trozo ante un fallo de red o un error temporal del servidor
const RETRY_STATUSES = new Set([502, 503, 504]);

/** Error de subida con el mensaje para la persona. stop: no tiene sentido seguir con los demás archivos. */
export class PublicUploadError extends Error {
  constructor(message, { stop = false } = {}) {
    super(message);
    this.name = 'PublicUploadError';
    this.stop = stop;
  }
}

/** Corta los bytes en trozos de hasta size bytes (vistas, sin copiar). Siempre al menos uno. */
export function splitChunks(bytes, size = CHUNK_BYTES) {
  if (!(size > 0)) throw new RangeError('El tamaño del trozo debe ser positivo.');
  const chunks = [];
  for (let start = 0; start < bytes.length; start += size) chunks.push(bytes.subarray(start, start + size));
  return chunks.length > 0 ? chunks : [bytes.subarray(0, 0)];
}

/** Cabeceras de un trozo según el contrato de /api/subir (frontend/web/api/subir.js). */
export function chunkHeaders({ fileName, uploadId, index, total, album, artist }) {
  return {
    'Content-Type': 'audio/ogg',
    'X-Nombre-Archivo': encodeURIComponent(String(fileName ?? '')),
    'X-Subida-Id': uploadId,
    'X-Parte': String(index),
    'X-Partes': String(total),
    ...(album ? {
      'X-Album-Id': album.id,
      'X-Album-Name': encodeURIComponent(album.name),
    } : {}),
    ...(artist ? { 'X-Artista-Cancion': encodeURIComponent(artist) } : {}),
  };
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/** Envía un trozo y devuelve la respuesta JSON. Reintenta los fallos de red y los errores temporales. */
async function sendChunk(chunk, headers, fetchImpl) {
  for (let attempt = 0; ; attempt += 1) {
    let response;
    try {
      response = await fetchImpl(UPLOAD_ENDPOINT, { method: 'POST', headers, body: chunk });
    } catch {
      if (attempt < RETRIES) continue;
      throw new PublicUploadError(NETWORK_TEXT, { stop: true });
    }
    const data = await readJson(response);
    if (response.ok && data?.ok) return data;
    if (RETRY_STATUSES.has(response.status) && attempt < RETRIES) continue;
    const message = typeof data?.error === 'string' && data.error ? data.error : `El servidor no ha aceptado la subida (error ${response.status}).`;
    // Sin configuración o sin permiso en el servidor, los demás archivos fallarían igual.
    throw new PublicUploadError(message, { stop: response.status === 500 || response.status === 404 });
  }
}

/**
 * Envía unos bytes Ogg Opus ya convertidos, trozo a trozo y en orden. onChunk recibe { index, total } tras cada
 * trozo. Devuelve la respuesta del último trozo.
 */
export async function sendOpus(bytes, {
  fileName,
  uploadId,
  album,
  artist,
  fetchImpl = globalThis.fetch,
  chunkBytes = CHUNK_BYTES,
  onChunk = () => {},
} = {}) {
  const chunks = splitChunks(bytes, chunkBytes);
  let last = null;
  for (let index = 0; index < chunks.length; index += 1) {
    last = await sendChunk(chunks[index], chunkHeaders({ fileName, uploadId, index, total: chunks.length, album, artist }), fetchImpl);
    onChunk({ index, total: chunks.length });
  }
  return last;
}

/**
 * Sube el Opus intentando primero el flujo presigned directo a R2 (ADR-0052). Si falla por 503 (secretos no
 * configurados), 401 (auth) o fallo de red en cualquier paso presigned, cae al flujo clásico `sendOpus` por
 * trozos. Si `FEATURE_PRESIGNED_UPLOAD` está desactivado o no hay `authFetch`, va directo al clásico.
 * Devuelve el mismo contrato que `sendOpus` (un objeto `{ok:true, mensaje, …}`).
 */
export async function sendOpusSmart(bytes, {
  fileName,
  uploadId,
  album,
  artist,
  authFetch = null,
  fetchImpl = globalThis.fetch,
  chunkBytes = CHUNK_BYTES,
  onChunk = () => {},
} = {}) {
  const canPresign = FEATURE_PRESIGNED_UPLOAD && typeof authFetch === 'function';
  if (canPresign) {
    try {
      const result = await sendOpusPresigned(bytes, {
        fileName,
        authFetch,
        fetchImpl,
        onProgress: ({ loaded, total }) => {
          // La máquina de estados espera { index, total } con index 0-based al terminar cada trozo. Simulamos
          // "un trozo = el 100 %" al acabar, y progreso intermedio para mostrar la barra avanzando.
          const totalParts = Math.max(1, Math.ceil(total / Math.max(1, chunkBytes)));
          const partsDone = Math.min(totalParts, Math.max(0, Math.floor((loaded / Math.max(1, total)) * totalParts)));
          onChunk({ index: Math.max(0, partsDone - 1), total: totalParts });
        },
      });
      return {
        ok: true,
        mensaje: result.mensaje,
        completa: true,
        repetido: false,
        nombre: fileName,
        r2Key: result.r2Key,
        sha256: result.sha256,
        tamanio: result.sizeBytes,
        via: 'presigned',
      };
    } catch (error) {
      const phase = error?.phase || '';
      const retryable = error instanceof PresignedUploadError && (
        phase === 'presign-503'
        || phase === 'presign-auth'
        || phase === 'presign-network'
        || phase === 'put-simple'
        || phase === 'put-multipart'
        || phase === 'put-multipart-etag'
        || phase === 'complete-network'
      );
      if (!retryable) throw error;
      // Fallback silencioso al flujo viejo. El caller no se entera; la subida sigue.
    }
  }
  const last = await sendOpus(bytes, { fileName, uploadId, album, artist, fetchImpl, chunkBytes, onChunk });
  return { ...(last ?? {}), via: 'chunked' };
}

function newUploadId(env) {
  return env.crypto.randomUUID();
}

/**
 * Sube varios archivos, de uno en uno y en orden. Cada uno se convierte y se envía por separado: un fallo no para los
 * demás (salvo uno del servidor que afectaría a todos). onProgress recibe { index, total, name, stage, fraction }, con
 * stage 'convertir' o 'enviar' y fraction de 0 a 1 para ese archivo.
 * Devuelve { sent: [{ name, title, message }], failed: [{ name, message }], results } con results en el orden de
 * los archivos: [{ name, ok, message }].
 */
export async function uploadFiles(files, {
  onProgress = () => {},
  fetchImpl = globalThis.fetch,
  convert = convertToOpus,
  env = globalThis,
  chunkBytes = CHUNK_BYTES,
} = {}) {
  const list = Array.from(files ?? []);
  const support = await opusSupport(env);
  if (!support.ok) throw new PublicUploadError(PUBLIC_UNSUPPORTED_TEXT);
  const sent = [];
  const failed = [];
  const results = [];
  let stopped = null;
  for (let index = 0; index < list.length; index += 1) {
    const file = list[index];
    const name = file?.name || 'Sin nombre';
    const title = titleFromFileName(file?.name);
    if (stopped) {
      failed.push({ name, message: stopped });
      results.push({ name, ok: false, message: stopped });
      continue;
    }
    const report = (stage, fraction) => onProgress({ index, total: list.length, name: title, stage, fraction });
    try {
      const converted = await convert(file, {
        env,
        limits: false,
        checkStorage: false,
        onProgress: ({ fraction }) => report('convertir', fraction * 0.5),
      });
      const result = await sendOpus(converted.bytes, {
        fileName: name,
        uploadId: newUploadId(env),
        fetchImpl,
        chunkBytes,
        onChunk: ({ index: part, total }) => report('enviar', 0.5 + ((part + 1) / total) * 0.5),
      });
      const message = result?.mensaje || DONE_TEXT;
      sent.push({ name, title, message });
      results.push({ name, ok: true, message });
    } catch (error) {
      const known = error instanceof PublicUploadError || error instanceof LocalAudioError;
      if (!known) console.error('Reminiscencia: fallo al subir un archivo.', error);
      const message = known ? error.message : 'No se ha podido subir este archivo.';
      if (error instanceof PublicUploadError && error.stop) stopped = message;
      failed.push({ name, message });
      results.push({ name, ok: false, message });
    }
  }
  return { sent, failed, results };
}
