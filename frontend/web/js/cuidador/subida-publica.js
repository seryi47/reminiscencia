// Subida para todos desde la web (ADR-0017): cada archivo que se elige se convierte a Ogg Opus en este navegador
// (convertToOpus de subida-local.js, sin límites de tamaño ni de duración) y se envía, de uno en uno y en orden, a la
// función del propio origen POST /api/subir, en trozos de hasta 4 MB (Vercel admite 4,5 MB por petición). La función
// lo guarda en el buzón del repositorio y el workflow buzon lo publica para todos. El título de la canción es el
// nombre del archivo sin extensión. Este módulo no conoce ningún token: solo habla con /api/subir.
//
// Las funciones puras (trozos, cabeceras, lectura de la respuesta) van exportadas para las pruebas
// (tests/web-unit/subida-publica.test.mjs). Lo que usa el navegador se resuelve dentro de las funciones.

import { convertToOpus, LocalAudioError, opusSupport, titleFromFileName, UNSUPPORTED_TEXT } from './subida-local.js';

export const UPLOAD_ENDPOINT = '/api/subir';
export const CHUNK_BYTES = 4 * 1024 * 1024;
export const PUBLIC_AUDIO_ACCEPT = 'audio/*,.wav,.mp3,.m4a,.flac,.ogg,.opus';
export const RIGHTS_TEXT = 'Al subir, declaras que tienes derecho a publicar estos archivos.';
export const DONE_TEXT = 'Subida: llegará a todos en un par de minutos.';
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
export function chunkHeaders({ fileName, uploadId, index, total, album }) {
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
  fetchImpl = globalThis.fetch,
  chunkBytes = CHUNK_BYTES,
  onChunk = () => {},
} = {}) {
  const chunks = splitChunks(bytes, chunkBytes);
  let last = null;
  for (let index = 0; index < chunks.length; index += 1) {
    last = await sendChunk(chunks[index], chunkHeaders({ fileName, uploadId, index, total: chunks.length, album }), fetchImpl);
    onChunk({ index, total: chunks.length });
  }
  return last;
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
