// Lector mínimo de archivos ZIP para «Subir canciones», sin dependencias. Lee el directorio central (también ZIP64)
// leyendo solo trozos del archivo (Blob.slice), así que abrir un ZIP grande no lo carga entero en memoria. Cada
// entrada se descomprime aparte, cuando se pide: «stored» (sin comprimir) o «deflate» con
// DecompressionStream('deflate-raw'), comprobando el CRC-32 y el tamaño. Lo cifrado, los métodos que no son esos dos,
// los ZIP en varias partes y los datos dañados lanzan ZipError con un mensaje para la persona.
//
// Las rutas del ZIP nunca se usan para escribir nada: solo sirven para descartar carpetas, __MACOSX/ y ocultos, y
// para sacar el nombre base del archivo. Este módulo no toca el DOM ni la red; se prueba en node
// (tests/web-unit/zip.test.mjs) con ZIP generados en la propia prueba.

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const SIG_ZIP64_LOCATOR = 0x07064b50;
const SIG_ZIP64_EOCD = 0x06064b50;
const EOCD_BYTES = 22;
const MAX_COMMENT = 0xffff;
const LOCAL_HEADER_BYTES = 30;
const CENTRAL_HEADER_BYTES = 46;
const U16_MAX = 0xffff;
const U32_MAX = 0xffffffff;
const FLAG_ENCRYPTED = 0x0001;
const FLAG_UTF8 = 0x0800;
const METHOD_STORED = 0;
const METHOD_DEFLATE = 8;
const METHOD_AES = 99;
const EXTRA_ZIP64 = 0x0001;
const EXTRA_UNICODE_PATH = 0x7075;

export const DAMAGED_TEXT = 'El archivo ZIP está dañado o no es un ZIP válido.';
export const SPLIT_TEXT = 'Este ZIP está dividido en varias partes y no se puede abrir. Vuelve a crearlo en un solo archivo.';
export const ENCRYPTED_TEXT = 'Está cifrada con contraseña dentro del ZIP y no se puede abrir.';
export const ENTRY_DAMAGED_TEXT = 'Está dañada dentro del ZIP y no se puede abrir.';
export const NO_INFLATE_TEXT = 'Este navegador no puede descomprimir archivos ZIP. Usa Chrome o Edge actualizados.';

/** Extensiones de audio que se sacan de un ZIP (las mismas que admite «Subir canciones»). */
export const ZIP_AUDIO_TYPES = Object.freeze({
  wav: 'audio/wav',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  flac: 'audio/flac',
  ogg: 'audio/ogg',
  opus: 'audio/ogg',
});

/** Error de un ZIP o de una entrada, con el mensaje para la persona. permanent: reintentar no lo arregla. */
export class ZipError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ZipError';
    this.permanent = true;
  }
}

// ---------------------------------------------------------------------------------------------
// CRC-32 y nombres
// ---------------------------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** Actualiza un CRC-32 (estado sin invertir) con bytes. Empieza con 0xffffffff y se invierte al final. */
function crcUpdate(state, bytes) {
  let c = state;
  for (let i = 0; i < bytes.length; i += 1) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return c >>> 0;
}

/** CRC-32 de unos bytes (el de ZIP y gzip). */
export function crc32(bytes) {
  return (crcUpdate(0xffffffff, bytes) ^ 0xffffffff) >>> 0;
}

// Página de códigos 437 (la de los ZIP antiguos sin la marca de UTF-8), de 0x80 a 0xFF.
const CP437_HIGH = 'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ';

/** Nombre de una entrada: UTF-8 si lo marca el ZIP o si es UTF-8 válido; si no, página de códigos 437. */
export function decodeName(bytes, utf8Flag = false) {
  if (utf8Flag) return new TextDecoder('utf-8').decode(bytes);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    let text = '';
    for (const byte of bytes) text += byte < 0x80 ? String.fromCharCode(byte) : CP437_HIGH[byte - 0x80];
    return text;
  }
}

/** Partes de una ruta del ZIP, con «/» o «\» como separador y sin las vacías ni «.». */
function segmentsOf(path) {
  return String(path ?? '').split(/[\\/]/).filter((part) => part !== '' && part !== '.');
}

/**
 * Nombre base de una ruta del ZIP: la última parte, sin caracteres de control y sin espacios a los lados. Es lo
 * único de la ruta que se usa (nunca para escribir en disco).
 */
export function zipBaseName(path) {
  const last = segmentsOf(path).pop() ?? '';
  return last.replace(/[\u0000-\u001f\u007f]/g, '').trim();
}

/** Extensión en minúsculas del nombre base, sin el punto ('' si no tiene). */
function extensionOf(name) {
  const match = /\.([^.]+)$/.exec(name);
  return match ? match[1].toLowerCase() : '';
}

/**
 * Por qué se ignora una entrada, o null si es una canción: 'carpeta', 'sistema' (__MACOSX/ o algo oculto, que empieza
 * por «.», en cualquier parte de la ruta) o 'no-audio'.
 */
export function ignoreReason(entry) {
  if (entry.isDirectory) return 'carpeta';
  const parts = segmentsOf(entry.path);
  if (parts.length === 0) return 'no-audio';
  if (parts.some((part) => part.toLowerCase() === '__macosx' || part.startsWith('.'))) return 'sistema';
  const name = zipBaseName(entry.path);
  if (!name || name.startsWith('.') || !Object.hasOwn(ZIP_AUDIO_TYPES, extensionOf(name))) return 'no-audio';
  return null;
}

/**
 * Separa las canciones del resto. Devuelve { songs, ignored }: songs son las entradas de audio con su nombre base en
 * name (en el orden del ZIP) e ignored cuántos archivos se han dejado fuera (las carpetas no cuentan).
 */
export function audioEntries(entries) {
  const songs = [];
  let ignored = 0;
  for (const entry of entries ?? []) {
    const reason = ignoreReason(entry);
    if (reason === null) songs.push({ ...entry, name: zipBaseName(entry.path) });
    else if (reason !== 'carpeta') ignored += 1;
  }
  return { songs, ignored };
}

// ---------------------------------------------------------------------------------------------
// Lectura del directorio central
// ---------------------------------------------------------------------------------------------

async function readRange(blob, start, end) {
  if (start < 0 || end > blob.size || end < start) throw new ZipError(DAMAGED_TEXT);
  return new DataView(await blob.slice(start, end).arrayBuffer());
}

function u64(view, offset) {
  const value = view.getBigUint64(offset, true);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new ZipError(DAMAGED_TEXT);
  return Number(value);
}

/** Busca el registro de fin del directorio central desde el final. Devuelve su posición absoluta y la vista. */
async function findEnd(blob) {
  if (blob.size < EOCD_BYTES) throw new ZipError(DAMAGED_TEXT);
  const tailStart = Math.max(0, blob.size - EOCD_BYTES - MAX_COMMENT);
  const tail = await readRange(blob, tailStart, blob.size);
  for (let pos = tail.byteLength - EOCD_BYTES; pos >= 0; pos -= 1) {
    if (tail.getUint32(pos, true) !== SIG_EOCD) continue;
    const commentLength = tail.getUint16(pos + 20, true);
    if (pos + EOCD_BYTES + commentLength > tail.byteLength) continue;
    return { at: tailStart + pos, view: new DataView(tail.buffer, tail.byteOffset + pos, EOCD_BYTES) };
  }
  throw new ZipError(DAMAGED_TEXT);
}

/** Datos del directorio central: { count, size, offset }, leyendo el registro ZIP64 si lo hay. */
async function centralDirectory(blob) {
  const end = await findEnd(blob);
  const v = end.view;
  const disk = v.getUint16(4, true);
  const cdDisk = v.getUint16(6, true);
  let count = v.getUint16(10, true);
  let size = v.getUint32(12, true);
  let offset = v.getUint32(16, true);
  // 0xFFFF en los números de disco quiere decir «ver el registro ZIP64» (algunos programas lo escriben así).
  const oneDisk = (value) => value === 0 || value === U16_MAX;
  if (!oneDisk(disk) || !oneDisk(cdDisk) || v.getUint16(8, true) !== count) throw new ZipError(SPLIT_TEXT);

  // ZIP64: el localizador va justo antes del registro de fin.
  if (end.at >= 20) {
    const locator = await readRange(blob, end.at - 20, end.at);
    if (locator.getUint32(0, true) === SIG_ZIP64_LOCATOR) {
      if (locator.getUint32(4, true) !== 0 || locator.getUint32(16, true) > 1) throw new ZipError(SPLIT_TEXT);
      const recordAt = u64(locator, 8);
      const record = await readRange(blob, recordAt, recordAt + 56);
      if (record.getUint32(0, true) !== SIG_ZIP64_EOCD) throw new ZipError(DAMAGED_TEXT);
      if (record.getUint32(16, true) !== 0 || record.getUint32(20, true) !== 0) throw new ZipError(SPLIT_TEXT);
      count = u64(record, 32);
      size = u64(record, 40);
      offset = u64(record, 48);
    } else if (count === U16_MAX || size === U32_MAX || offset === U32_MAX) {
      throw new ZipError(DAMAGED_TEXT);
    }
  }
  if (offset + size > end.at) throw new ZipError(DAMAGED_TEXT);
  return { count, size, offset };
}

/** Lee los campos extra de una cabecera: Map de id → DataView. */
function extraFields(view, start, length) {
  const fields = new Map();
  let pos = start;
  const stop = start + length;
  while (pos + 4 <= stop) {
    const id = view.getUint16(pos, true);
    const size = view.getUint16(pos + 2, true);
    if (pos + 4 + size > stop) break;
    if (!fields.has(id)) fields.set(id, new DataView(view.buffer, view.byteOffset + pos + 4, size));
    pos += 4 + size;
  }
  return fields;
}

/**
 * Lee el directorio central de un ZIP (un Blob o File). Devuelve las entradas en su orden:
 * { path, isDirectory, encrypted, method, crc32, compressedSize, size, localOffset }.
 * Lanza ZipError si no es un ZIP, está dañado o va en varias partes.
 */
export async function readZipDirectory(blob) {
  const { count, size, offset } = await centralDirectory(blob);
  const view = await readRange(blob, offset, offset + size);
  const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  const entries = [];
  let pos = 0;
  for (let index = 0; index < count; index += 1) {
    if (pos + CENTRAL_HEADER_BYTES > size || view.getUint32(pos, true) !== SIG_CENTRAL) throw new ZipError(DAMAGED_TEXT);
    const flags = view.getUint16(pos + 8, true);
    const method = view.getUint16(pos + 10, true);
    const crc = view.getUint32(pos + 16, true);
    let compressedSize = view.getUint32(pos + 20, true);
    let uncompressedSize = view.getUint32(pos + 24, true);
    const nameLength = view.getUint16(pos + 28, true);
    const extraLength = view.getUint16(pos + 30, true);
    const commentLength = view.getUint16(pos + 32, true);
    const diskStart = view.getUint16(pos + 34, true);
    let localOffset = view.getUint32(pos + 42, true);
    const nameStart = pos + CENTRAL_HEADER_BYTES;
    const next = nameStart + nameLength + extraLength + commentLength;
    if (next > size) throw new ZipError(DAMAGED_TEXT);
    const nameBytes = bytes.subarray(nameStart, nameStart + nameLength);
    let path = decodeName(nameBytes, Boolean(flags & FLAG_UTF8));
    const extras = extraFields(view, nameStart + nameLength, extraLength);

    // ZIP64: los valores que no caben en 32 bits van en el extra 0x0001, en este orden y solo los que faltan.
    const zip64 = extras.get(EXTRA_ZIP64);
    if (uncompressedSize === U32_MAX || compressedSize === U32_MAX || localOffset === U32_MAX || diskStart === U16_MAX) {
      if (!zip64) throw new ZipError(DAMAGED_TEXT);
      let at = 0;
      const take = () => {
        if (at + 8 > zip64.byteLength) throw new ZipError(DAMAGED_TEXT);
        const value = u64(zip64, at);
        at += 8;
        return value;
      };
      if (uncompressedSize === U32_MAX) uncompressedSize = take();
      if (compressedSize === U32_MAX) compressedSize = take();
      if (localOffset === U32_MAX) localOffset = take();
    }
    if (diskStart !== 0 && diskStart !== U16_MAX) throw new ZipError(SPLIT_TEXT);

    // Nombre en UTF-8 de Info-ZIP (0x7075), si corresponde al nombre de la cabecera.
    const unicode = extras.get(EXTRA_UNICODE_PATH);
    if (unicode && unicode.byteLength > 5 && unicode.getUint8(0) === 1 && unicode.getUint32(1, true) === crc32(nameBytes)) {
      try {
        path = new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(unicode.buffer, unicode.byteOffset + 5, unicode.byteLength - 5));
      } catch {
        // Nombre Unicode inválido: vale el de la cabecera.
      }
    }

    entries.push({
      path,
      isDirectory: /[\\/]$/.test(path),
      encrypted: Boolean(flags & FLAG_ENCRYPTED) || method === METHOD_AES,
      method,
      crc32: crc,
      compressedSize,
      size: uncompressedSize,
      localOffset,
    });
    pos = next;
  }
  return entries;
}

// ---------------------------------------------------------------------------------------------
// Lectura de una entrada
// ---------------------------------------------------------------------------------------------

/** Tipo MIME de un nombre de audio por su extensión ('' si no es de audio). */
export function audioType(name) {
  return ZIP_AUDIO_TYPES[extensionOf(String(name ?? ''))] ?? '';
}

/**
 * Descomprime una entrada del ZIP y la devuelve como File (con el nombre base y su tipo de audio). Comprueba el
 * CRC-32 y el tamaño. Lanza ZipError si está cifrada, usa otro método o está dañada.
 */
export async function readZipEntry(blob, entry, { env = globalThis } = {}) {
  if (entry.encrypted) throw new ZipError(ENCRYPTED_TEXT);
  if (entry.method !== METHOD_STORED && entry.method !== METHOD_DEFLATE) {
    throw new ZipError(`Usa una compresión que no se puede abrir (método ${entry.method}). Vuelve a crear el ZIP con la compresión normal.`);
  }
  if (entry.method === METHOD_DEFLATE && typeof env.DecompressionStream !== 'function') throw new ZipError(NO_INFLATE_TEXT);

  let header;
  try {
    header = await readRange(blob, entry.localOffset, entry.localOffset + LOCAL_HEADER_BYTES);
  } catch {
    throw new ZipError(ENTRY_DAMAGED_TEXT);
  }
  if (header.getUint32(0, true) !== SIG_LOCAL) throw new ZipError(ENTRY_DAMAGED_TEXT);
  const start = entry.localOffset + LOCAL_HEADER_BYTES + header.getUint16(26, true) + header.getUint16(28, true);
  const end = start + entry.compressedSize;
  if (end > blob.size) throw new ZipError(ENTRY_DAMAGED_TEXT);

  let stream = blob.slice(start, end).stream();
  if (entry.method === METHOD_DEFLATE) stream = stream.pipeThrough(new env.DecompressionStream('deflate-raw'));
  const reader = stream.getReader();
  const chunks = [];
  let total = 0;
  let crc = 0xffffffff;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      // Más bytes de los que declara el ZIP: está dañado (y así no se llena la memoria sin fin).
      if (total > entry.size) throw new ZipError(ENTRY_DAMAGED_TEXT);
      crc = crcUpdate(crc, value);
      chunks.push(value);
    }
  } catch (error) {
    reader.cancel().catch(() => {});
    if (error instanceof ZipError) throw error;
    throw new ZipError(ENTRY_DAMAGED_TEXT);
  }
  if (total !== entry.size || ((crc ^ 0xffffffff) >>> 0) !== entry.crc32) throw new ZipError(ENTRY_DAMAGED_TEXT);
  const name = zipBaseName(entry.path);
  return new File(chunks, name, { type: audioType(name) });
}
