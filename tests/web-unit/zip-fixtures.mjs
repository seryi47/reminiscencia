// ZIP generados en las pruebas (no es una suite: index.mjs solo carga *.test.mjs). Escribe la estructura a mano para
// poder probar lo que un compresor normal no deja hacer: entradas cifradas, CRC mal, métodos raros, ZIP64 con
// archivos pequeños, nombres en la página de códigos 437 o un ZIP «en varias partes». Datos ficticios.
import { crc32, deflateRawSync } from 'node:zlib';

const u16 = (value) => { const b = Buffer.alloc(2); b.writeUInt16LE(value); return b; };
const u32 = (value) => { const b = Buffer.alloc(4); b.writeUInt32LE(value >>> 0); return b; };
const u64 = (value) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(value)); return b; };

/**
 * files: [{ path, data, method (0 o 8; por defecto 8), raw (bytes comprimidos a mano), crc, encrypted, nameBytes
 * (nombre en bytes, sin la marca de UTF-8), directory }]. Opciones: zip64 (todo por los registros ZIP64), comment,
 * disk (número de disco del registro de fin).
 */
export function buildZip(files, { zip64 = false, comment = '', disk = 0 } = {}) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const file of files) {
    const data = Buffer.from(file.data ?? []);
    const method = file.method ?? (file.directory ? 0 : 8);
    const compressed = Buffer.from(file.raw ?? (method === 8 ? deflateRawSync(data) : data));
    const name = file.nameBytes ? Buffer.from(file.nameBytes) : Buffer.from(file.path, 'utf8');
    let flags = file.nameBytes ? 0 : 0x0800;
    if (file.encrypted) flags |= 0x0001;
    const crc = file.crc ?? crc32(data);
    const version = zip64 ? 45 : 20;
    const localExtra = zip64 ? Buffer.concat([u16(1), u16(16), u64(data.length), u64(compressed.length)]) : Buffer.alloc(0);
    const local = Buffer.concat([
      u32(0x04034b50), u16(version), u16(flags), u16(method), u16(0), u16(0x21), u32(crc),
      u32(zip64 ? 0xffffffff : compressed.length), u32(zip64 ? 0xffffffff : data.length),
      u16(name.length), u16(localExtra.length), name, localExtra, compressed,
    ]);
    const centralExtra = zip64 ? Buffer.concat([u16(1), u16(24), u64(data.length), u64(compressed.length), u64(offset)]) : Buffer.alloc(0);
    const central = Buffer.concat([
      u32(0x02014b50), u16(0x031e), u16(version), u16(flags), u16(method), u16(0), u16(0x21), u32(crc),
      u32(zip64 ? 0xffffffff : compressed.length), u32(zip64 ? 0xffffffff : data.length),
      u16(name.length), u16(centralExtra.length), u16(0), u16(0), u16(0), u32(file.directory ? 0x10 : 0),
      u32(zip64 ? 0xffffffff : offset), name, centralExtra,
    ]);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const cd = Buffer.concat(centrals);
  const parts = [...locals, cd];
  const commentBytes = Buffer.from(comment, 'utf8');
  if (zip64) {
    const recordAt = offset + cd.length;
    parts.push(Buffer.concat([
      u32(0x06064b50), u64(44), u16(45), u16(45), u32(0), u32(0),
      u64(files.length), u64(files.length), u64(cd.length), u64(offset),
    ]));
    parts.push(Buffer.concat([u32(0x07064b50), u32(0), u64(recordAt), u32(1)]));
    parts.push(Buffer.concat([u32(0x06054b50), u16(0xffff), u16(0xffff), u16(0xffff), u16(0xffff), u32(0xffffffff), u32(0xffffffff), u16(commentBytes.length), commentBytes]));
  } else {
    parts.push(Buffer.concat([u32(0x06054b50), u16(disk), u16(disk), u16(files.length), u16(files.length), u32(cd.length), u32(offset), u16(commentBytes.length), commentBytes]));
  }
  return new Uint8Array(Buffer.concat(parts));
}

/** Bytes de audio ficticios (no hace falta que sean audio de verdad: el lector no los mira). */
export function fakeAudio(seed, length = 4096) {
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i += 1) bytes[i] = (i * 31 + seed * 7) & 0xff;
  return bytes;
}

/** El ZIP como File, como llega del campo de archivo. */
export const zipFile = (bytes, name = 'Álbum.zip') => new File([bytes], name, { type: 'application/zip' });
