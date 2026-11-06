// Lógica común de POST /api/subir (ADR-0017, ADR-0024 y ADR-0029). La usan la función de Vercel (api/subir.js, que
// habla con R2 por la API S3 con su firma SigV4 propia) y el Worker de Cloudflare (worker/src/index.js, que usa el
// binding de R2). Solo JavaScript estándar (sin node:, sin Buffer): corre igual en Node y en un Worker.
//
// Contrato (lo usan la web y la APK; no cambiarlo sin cambiar los dos):
//   POST /api/subir, cuerpo: los bytes del trozo (application/octet-stream). Cabeceras:
//     X-Nombre-Archivo  nombre original del archivo, con encodeURIComponent
//     X-Subida-Id       UUID del archivo (el mismo en todos sus trozos)
//     X-Parte           índice del trozo, desde 0
//     X-Partes          número total de trozos, de 1 a 1000
//     X-Album-Id, X-Album-Name, X-Artista-Cancion  opcionales (playlists de YouTube, ADR-0019)
//   Respuesta JSON: { ok, parte, partes, completa, repetido, nombre, mensaje } o { ok: false, error }.
//   Tamaño máximo del trozo: 4 MB en Vercel (VERCEL_MAX_CHUNK_BYTES; Vercel admite 4,5 MB por petición) y 32 MB en
//   el Worker (WORKER_MAX_CHUNK_BYTES; ver ADR-0029). El bucket y el backend (sonidos.entrada.MAX_PART_BYTES) admiten
//   el mayor de los dos.
//
// Almacenamiento (interfaz «storage», la implementa cada plataforma):
//   list(prefix) → Map(nombre → tamaño) de los objetos bajo prefix (sin el prefijo)
//   get(key) → Uint8Array
//   putNew(key, bytes, contentType) → true si lo escribió, false si ya existía (nunca sobrescribe)
// Cada trozo va a entrada/<id>/<índice>.part del bucket privado, en orden y sin sobrescribir. Con el último se escribe
// entrada/<id>/manifiesto.json y se lanza el workflow buzon con un repository_dispatch («subida-web», con el id). Si
// el aviso a GitHub falla, se responde 502: el cliente reintenta el último trozo, que ya está guardado, y solo se
// repite el aviso.

import { VERCEL_CHUNK_BYTES, WORKER_CHUNK_BYTES } from '../js/api-config.js';

export const REPOSITORY = 'seryi47/reminiscencia';
export const DISPATCH_EVENT = 'subida-web';
export const ENTRY_PREFIX = 'entrada';
export const MANIFEST_NAME = 'manifiesto.json';
// Los dos tamaños están en js/api-config.js, que también usa la web para cortar los trozos.
export const VERCEL_MAX_CHUNK_BYTES = VERCEL_CHUNK_BYTES;
export const WORKER_MAX_CHUNK_BYTES = WORKER_CHUNK_BYTES;
export const MAX_PARTS = 1000;
export const DONE_MESSAGE = 'Subida: llegará a todos en un par de minutos.';
// El buzón admite hasta 200 caracteres y 255 bytes por nombre; se deja sitio para « (NN)» y «.opus».
export const MAX_STEM_CHARS = 150;
export const MAX_STEM_BYTES = 180;
const GITHUB_API = 'https://api.github.com';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const INTEGER = /^(?:0|[1-9][0-9]{0,3})$/;
const PLAYLIST_ID = /^[A-Za-z0-9_-]{1,200}$/;
// La misma lista que backend/sonidos/buzon.py (_NAME_PUNCTUATION), además de letras, marcas y números.
const NAME_PUNCTUATION = new Set(" ._-()[]'’&,!¡¿+#");
const NAME_CHAR = /[\p{L}\p{M}\p{N}]/u;
const encoder = new TextEncoder();

/** Error con estado HTTP y mensaje en español para quien sube. */
export class UploadError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'UploadError';
    this.status = status;
  }
}

// ---------------------------------------------------------------------------------------------
// Validación (funciones puras)
// ---------------------------------------------------------------------------------------------

const utf8Length = (text) => encoder.encode(text).length;

/**
 * Nombre limpio, sin extensión: solo la última parte de la ruta, sin la última extensión, en NFC, con los caracteres
 * que el buzón no admite cambiados por espacios, sin punto, guion ni espacio iniciales ni punto o espacio finales y
 * acotado. Sin nada útil, «Sin título».
 */
export function cleanStem(raw) {
  const base = String(raw ?? '').split(/[\\/]/).pop() ?? '';
  const withoutExtension = base.includes('.') ? base.slice(0, base.lastIndexOf('.')) : base;
  let stem = Array.from(withoutExtension.normalize('NFC'), (char) => (NAME_CHAR.test(char) || NAME_PUNCTUATION.has(char) ? char : ' '))
    .join('')
    .replace(/ {2,}/g, ' ');
  stem = trimEdges(stem);
  let chars = Array.from(stem).slice(0, MAX_STEM_CHARS);
  while (chars.length > 0 && utf8Length(chars.join('')) > MAX_STEM_BYTES) chars.pop();
  stem = trimEdges(chars.join(''));
  return stem || 'Sin título';
}

function trimEdges(text) {
  return text.replace(/^[.\- ]+/, '').replace(/[. ]+$/, '');
}

/** Dice si los bytes empiezan por una página Ogg inicial cuyo primer paquete es una cabecera OpusHead. */
export function isOggOpus(bytes) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes ?? []);
  if (data.length < 27 + 1 + 19) return false;
  if (data[0] !== 0x4f || data[1] !== 0x67 || data[2] !== 0x67 || data[3] !== 0x53) return false; // "OggS"
  if (data[4] !== 0 || (data[5] & 0x02) === 0) return false; // versión 0 y página de inicio de flujo
  const segments = data[26];
  const start = 27 + segments;
  if (segments === 0 || data.length < start + 19) return false;
  return String.fromCharCode(...data.subarray(start, start + 8)) === 'OpusHead' && data[start + 8] === 1;
}

function header(headers, name) {
  const value = headers.get(name);
  return value === null ? '' : value.trim();
}

/** Lee y valida las cabeceras del contrato. Devuelve { fileName, uploadId, index, total }. */
export function parseUploadHeaders(headers) {
  const contentType = header(headers, 'content-type').toLowerCase();
  if (contentType.startsWith('multipart/')) {
    throw new UploadError(400, 'Envía un solo archivo por petición, como bytes del trozo (no como formulario).');
  }
  let fileName;
  try {
    fileName = decodeURIComponent(header(headers, 'x-nombre-archivo'));
  } catch {
    throw new UploadError(400, 'El nombre del archivo no está bien codificado.');
  }
  if (!fileName) throw new UploadError(400, 'Falta el nombre del archivo (cabecera X-Nombre-Archivo).');
  const uploadId = header(headers, 'x-subida-id').toLowerCase();
  if (!UUID.test(uploadId)) throw new UploadError(400, 'El identificador de la subida no es válido (X-Subida-Id debe ser un UUID).');
  const rawIndex = header(headers, 'x-parte');
  const rawTotal = header(headers, 'x-partes');
  if (!INTEGER.test(rawIndex) || !INTEGER.test(rawTotal)) {
    throw new UploadError(400, 'X-Parte y X-Partes deben ser números enteros.');
  }
  const index = Number(rawIndex);
  const total = Number(rawTotal);
  if (total < 1 || total > MAX_PARTS) throw new UploadError(400, `Un archivo se puede enviar en 1 a ${MAX_PARTS} trozos.`);
  if (index >= total) throw new UploadError(400, 'El número de trozo no cabe en el total de trozos.');
  const albumId = header(headers, 'x-album-id');
  let albumName = header(headers, 'x-album-name');
  try {
    albumName = albumName ? decodeURIComponent(albumName) : '';
  } catch {
    throw new UploadError(400, 'El nombre del álbum no está bien codificado.');
  }
  let album;
  if (albumId || albumName) {
    if (!PLAYLIST_ID.test(albumId) || !albumName) {
      throw new UploadError(400, 'El álbum de YouTube debe incluir un identificador y un nombre válidos.');
    }
    if ([...albumName].length > 200 || /[\u0000-\u001f\u007f]/u.test(albumName)) {
      throw new UploadError(400, 'El nombre del álbum no es válido.');
    }
    album = { id: albumId, name: albumName };
  }
  let artist = header(headers, 'x-artista-cancion');
  try {
    artist = artist ? decodeURIComponent(artist) : '';
  } catch {
    throw new UploadError(400, 'El nombre del artista no está bien codificado.');
  }
  if ([...artist].length > 200 || /[\u0000-\u001f\u007f]/u.test(artist)) {
    throw new UploadError(400, 'El nombre del artista no es válido.');
  }
  return { fileName, uploadId, index, total, ...(album ? { album } : {}), ...(artist ? { artist } : {}) };
}

/** Comprueba el cuerpo de un trozo: no vacío, hasta maxBytes y, el primero, Ogg Opus. */
export function checkChunk(bytes, index, maxBytes = VERCEL_MAX_CHUNK_BYTES) {
  if (!bytes || bytes.length === 0) throw new UploadError(400, 'El trozo llega vacío.');
  if (bytes.length > maxBytes) {
    const megabytes = Math.round(maxBytes / (1024 * 1024));
    throw new UploadError(413, `El trozo pasa de ${megabytes} MB, lo máximo que admite el servidor por petición. Envía el archivo en trozos más pequeños.`);
  }
  if (index === 0 && !isOggOpus(bytes)) {
    throw new UploadError(415, 'El archivo no es Ogg Opus. La web lo convierte antes de subirlo; vuelve a intentarlo desde la página.');
  }
}

export function partKey(uploadId, index) {
  return `${ENTRY_PREFIX}/${uploadId}/${index}.part`;
}

export function manifestKey(uploadId) {
  return `${ENTRY_PREFIX}/${uploadId}/${MANIFEST_NAME}`;
}

/** Contenido de manifiesto.json: lo que lee backend/sonidos/buzon.py (_leer_manifiesto), sin más claves. */
export function manifestText({ name, total, album, artist }) {
  return `${JSON.stringify({ nombre: name, partes: total, ...(album ? { album } : {}), ...(artist ? { artist } : {}) })}\n`;
}

/** True si los dos trozos tienen los mismos bytes. */
export function sameBytes(left, right) {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) if (left[index] !== right[index]) return false;
  return true;
}

// ---------------------------------------------------------------------------------------------
// GitHub y almacenamiento
// ---------------------------------------------------------------------------------------------

/** Avisa al workflow buzon (repository_dispatch). El token solo va a api.github.com en la cabecera Authorization. */
export async function dispatchWorkflow({ token, uploadId, fetchImpl }) {
  let response;
  try {
    response = await fetchImpl(`${GITHUB_API}/repos/${REPOSITORY}/dispatches`, {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'reminiscencia-subida',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ event_type: DISPATCH_EVENT, client_payload: { id: uploadId } }),
    });
  } catch {
    throw new UploadError(502, 'No se ha podido avisar a GitHub. Inténtalo de nuevo en un momento.');
  }
  if (response.status === 204 || response.status === 200) return;
  console.error(`subir: GitHub respondió ${response.status} al lanzar el workflow`);
  if (response.status === 401 || response.status === 403 || response.status === 404) {
    throw new UploadError(500, 'El servidor no tiene permiso para avisar a GitHub. Avisa a quien mantiene la web.');
  }
  throw new UploadError(502, 'GitHub no ha aceptado el aviso de la subida. Inténtalo de nuevo en un momento.');
}

/** Guarda un trozo en el bucket privado y, con el último, el manifiesto; después avisa al workflow. */
export async function storeChunk({ storage, token, fetchImpl, uploadId, index, total, stem, bytes, album, artist }) {
  const prefix = `${ENTRY_PREFIX}/${uploadId}/`;
  const stored = await storage.list(prefix);
  const name = `${index}.part`;
  const last = index === total - 1;
  const isSame = async () => sameBytes(await storage.get(partKey(uploadId, index)), bytes);

  if (stored.has(MANIFEST_NAME)) {
    // Una subida completa solo admite repetir su último trozo (el cliente reintenta si el aviso a GitHub falló).
    if (!last || !stored.has(name) || !(await isSame())) {
      throw new UploadError(409, 'Esta subida ya está completa. Para subir el archivo otra vez, elígelo de nuevo.');
    }
    let manifestName = null;
    try {
      manifestName = JSON.parse(new TextDecoder().decode(await storage.get(manifestKey(uploadId))))?.nombre ?? null;
    } catch (error) {
      if (error instanceof UploadError) throw error;
    }
    await dispatchWorkflow({ token, uploadId, fetchImpl });
    return { repeated: true, name: typeof manifestName === 'string' ? manifestName : null };
  }

  let repeated = false;
  if (stored.has(name)) {
    if (!(await isSame())) throw new UploadError(409, 'Ese trozo ya se había subido con otro contenido. Vuelve a elegir el archivo.');
    repeated = true;
  } else {
    for (let previous = 0; previous < index; previous += 1) {
      if (!stored.has(`${previous}.part`)) {
        throw new UploadError(409, 'Faltan trozos anteriores de este archivo. Vuelve a elegirlo para subirlo desde el principio.');
      }
    }
    if (!(await storage.putNew(partKey(uploadId, index), bytes, 'application/octet-stream'))) {
      // Otra petición lo escribió entre la lista y la escritura: vale si es igual.
      if (!(await isSame())) throw new UploadError(409, 'Ese trozo ya se había subido con otro contenido. Vuelve a elegir el archivo.');
      repeated = true;
    }
  }
  if (!last) return { repeated, name: null };

  // El nombre final lo decide el buzón (sufijo « (2)» si ya hay uno igual); aquí solo se limpia.
  const fileName = `${stem}.opus`;
  const manifest = encoder.encode(manifestText({ name: fileName, total, album, artist }));
  await storage.putNew(manifestKey(uploadId), manifest, 'application/json');
  await dispatchWorkflow({ token, uploadId, fetchImpl });
  return { repeated, name: fileName };
}

// ---------------------------------------------------------------------------------------------
// Petición
// ---------------------------------------------------------------------------------------------

export function jsonResponse(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}

/**
 * Atiende un POST /api/subir ya configurado. config(): { token, storage } o lanza UploadError (se llama después de
 * comprobar el método, para que un GET responda 405 aunque falte la configuración).
 */
export async function handleUploadRequest(request, { config, fetchImpl, maxChunkBytes = VERCEL_MAX_CHUNK_BYTES }) {
  try {
    if (request.method !== 'POST') throw new UploadError(405, 'Solo se admite POST.');
    const { token, storage } = config();
    const { fileName, uploadId, index, total, album, artist } = parseUploadHeaders(request.headers);
    const declared = Number(request.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > maxChunkBytes) checkChunk({ length: declared }, -1, maxChunkBytes);
    const bytes = new Uint8Array(await request.arrayBuffer());
    checkChunk(bytes, index, maxChunkBytes);
    const stem = cleanStem(fileName);
    const stored = await storeChunk({ storage, token, fetchImpl, uploadId, index, total, stem, bytes, album, artist });
    const complete = index === total - 1;
    return jsonResponse(200, {
      ok: true,
      parte: index,
      partes: total,
      completa: complete,
      repetido: stored.repeated,
      nombre: stored.name,
      mensaje: complete ? DONE_MESSAGE : `Trozo ${index + 1} de ${total} recibido.`,
    });
  } catch (error) {
    if (error instanceof UploadError) return jsonResponse(error.status, { ok: false, error: error.message });
    console.error('subir: fallo inesperado', error?.name ?? 'Error');
    return jsonResponse(500, { ok: false, error: 'No se ha podido completar la subida. Inténtalo de nuevo.' });
  }
}
