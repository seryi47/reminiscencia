// ZIP mínimo para las pruebas de extremo a extremo de «Subir canciones»: entradas «stored» (method 0) o «deflate»
// (method 8, por defecto) y carpetas (rutas que acaban en «/»), con nombres en UTF-8. Datos ficticios.
import { crc32, deflateRawSync } from "node:zlib";

const u16 = (value) => { const b = Buffer.alloc(2); b.writeUInt16LE(value); return b; };
const u32 = (value) => { const b = Buffer.alloc(4); b.writeUInt32LE(value >>> 0); return b; };

/** files: [{ path, data, method }]. Devuelve el ZIP como Buffer. */
export function buildZip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const file of files) {
    const data = Buffer.from(file.data ?? []);
    const method = file.method ?? (file.path.endsWith("/") ? 0 : 8);
    const body = method === 8 ? deflateRawSync(data) : data;
    const name = Buffer.from(file.path, "utf8");
    const crc = crc32(data);
    const common = [u16(0x0800), u16(method), u16(0), u16(0x21), u32(crc), u32(body.length), u32(data.length), u16(name.length), u16(0)];
    const local = Buffer.concat([u32(0x04034b50), u16(20), ...common, name, body]);
    centrals.push(Buffer.concat([u32(0x02014b50), u16(0x031e), u16(20), ...common, u16(0), u16(0), u16(0), u32(0), u32(offset), name]));
    locals.push(local);
    offset += local.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.concat([u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length), u32(cd.length), u32(offset), u16(0)]);
  return Buffer.concat([...locals, cd, end]);
}
