// Helper para subida directa a R2 con URL firmada (ADR-0052 ampliación 2026-11-26). El audio no pasa por el Worker:
// el cliente firma la URL en `/api/upload/presign`, sube el Blob con PUT, y confirma en `/api/upload/complete`.
//
// Uso típico desde el flujo de subida (sustituye a sendOpus del módulo subida-publica):
//
//   const upload = await sendOpusPresigned(converted.bytes, {
//     fileName: 'cancion.opus',
//     authFetch: (path, init) => auth.authorizedFetch(fetch)(path, init),
//   });
//   // upload = { r2Key, sha256, sizeBytes, mensaje } o lanza PresignedUploadError si falla.
//   // Si lanza porque el Worker responde 503 (secretos R2 no configurados), el caller debe caer al
//   // flujo /api/subir clásico (sendOpus de subida-publica.js).
//
// Si en el futuro se activa el cableado por defecto, basta con envolver sendOpus con try { presigned }
// catch { chunked } en frontend/web/js/cuidador/subida-publica.js.

const PRESIGN_PATH = '/api/upload/presign';
const COMPLETE_PATH = '/api/upload/complete';

export class PresignedUploadError extends Error {
  constructor(message, { status = 0, phase = 'unknown' } = {}) {
    super(message);
    this.name = 'PresignedUploadError';
    this.status = status;
    this.phase = phase;
  }
}

/** sha256 hexadecimal de un Uint8Array/ArrayBuffer. Usa Web Crypto. */
export async function sha256Hex(bytes) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const buf = await globalThis.crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Pide la URL firmada al Worker. authFetch debe añadir X-Auth (y X-Actor si aplica). */
async function requestPresign({ fileName, sizeBytes, authFetch }) {
  let response;
  try {
    response = await authFetch(PRESIGN_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: fileName, sizeBytes, contentType: 'audio/ogg' }),
    });
  } catch (error) {
    throw new PresignedUploadError(`No se ha podido contactar con /api/upload/presign (${error?.message || 'red'}).`, { phase: 'presign-network' });
  }
  if (response.status === 503) {
    throw new PresignedUploadError('Subida directa no configurada en el servidor.', { status: 503, phase: 'presign-503' });
  }
  if (response.status === 401) {
    throw new PresignedUploadError('Falta la contraseña del Worker.', { status: 401, phase: 'presign-auth' });
  }
  if (!response.ok) {
    let msg = `HTTP ${response.status}`;
    try { const data = await response.json(); if (data?.error) msg = data.error; } catch { /* ignore */ }
    throw new PresignedUploadError(msg, { status: response.status, phase: 'presign-http' });
  }
  const data = await response.json();
  if (!data?.ok) throw new PresignedUploadError(data?.error || 'Respuesta de presign sin ok.', { phase: 'presign-shape' });
  return data;
}

/** Hace PUT del Opus a la URL firmada. En modo multipart, sube cada parte en orden y guarda los ETag. */
async function putToR2({ bytes, presign, onProgress, fetchImpl = globalThis.fetch }) {
  if (presign.mode === 'simple') {
    const response = await fetchImpl(presign.uploadUrl, { method: 'PUT', body: bytes });
    if (!response.ok) {
      throw new PresignedUploadError(`PUT directo a R2 ha fallado (HTTP ${response.status}).`, { status: response.status, phase: 'put-simple' });
    }
    onProgress({ loaded: bytes.length, total: bytes.length });
    return { parts: [] };
  }
  // Multipart
  const parts = [];
  let uploaded = 0;
  const chunkSize = presign.chunkBytes;
  for (const partInfo of presign.parts) {
    const start = (partInfo.partNumber - 1) * chunkSize;
    const end = Math.min(start + chunkSize, bytes.length);
    const slice = bytes.subarray(start, end);
    const response = await fetchImpl(partInfo.uploadUrl, { method: 'PUT', body: slice });
    if (!response.ok) {
      throw new PresignedUploadError(`PUT multipart parte ${partInfo.partNumber} ha fallado (HTTP ${response.status}).`, { status: response.status, phase: 'put-multipart' });
    }
    const etag = response.headers.get('etag') || response.headers.get('ETag');
    if (!etag) throw new PresignedUploadError(`PUT multipart parte ${partInfo.partNumber} sin ETag.`, { phase: 'put-multipart-etag' });
    parts.push({ partNumber: partInfo.partNumber, etag });
    uploaded += slice.length;
    onProgress({ loaded: uploaded, total: bytes.length });
  }
  return { parts };
}

/** Confirma el multipart (si corresponde) ante el Worker. */
async function requestComplete({ presign, parts, authFetch }) {
  const body = { r2Key: presign.r2Key };
  if (presign.mode === 'multipart') {
    body.s3UploadId = presign.s3UploadId;
    body.parts = parts;
  }
  let response;
  try {
    response = await authFetch(COMPLETE_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (error) {
    throw new PresignedUploadError(`Error de red al confirmar la subida: ${error?.message || 'red'}.`, { phase: 'complete-network' });
  }
  if (!response.ok) {
    let msg = `HTTP ${response.status}`;
    try { const data = await response.json(); if (data?.error) msg = data.error; } catch { /* ignore */ }
    throw new PresignedUploadError(msg, { status: response.status, phase: 'complete-http' });
  }
  return response.json();
}

/**
 * Sube un Opus directo a R2 vía URL firmada. Devuelve { r2Key, sha256, sizeBytes, mensaje }.
 * Lanza PresignedUploadError si algún paso falla. El caller debe decidir si cae al flujo chunked clásico.
 */
export async function sendOpusPresigned(bytes, {
  fileName,
  authFetch,
  onProgress = () => {},
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!authFetch) throw new PresignedUploadError('Falta authFetch (con X-Auth).', { phase: 'config' });
  const sizeBytes = bytes.length;
  const sha256 = await sha256Hex(bytes);
  const presign = await requestPresign({ fileName, sizeBytes, authFetch });
  const { parts } = await putToR2({ bytes, presign, onProgress, fetchImpl });
  await requestComplete({ presign, parts, authFetch });
  return {
    r2Key: presign.r2Key,
    sha256,
    sizeBytes,
    mensaje: 'Subida al momento a la biblioteca.',
  };
}
