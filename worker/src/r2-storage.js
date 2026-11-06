// Almacenamiento de las subidas (interfaz «storage» de frontend/web/server/upload-core.js) sobre el binding de R2 del
// Worker: sin firma SigV4 ni claves, el binding ya da acceso al bucket privado. ADR-0029.

import { UploadError } from '../../frontend/web/server/upload-core.js';

// «Solo si no existe»: el binding admite cabeceras condicionales en onlyIf (Workers API reference de R2, consultada el
// 2026-11-06). Si la condición no se cumple, put() devuelve null y no escribe.
export const ifAbsent = () => new Headers({ 'If-None-Match': '*' });
const MAX_LIST_PAGES = 20;

function storageFailure(what) {
  // Solo qué se hacía: nada de la respuesta del binding va al registro.
  console.error(`subir: R2 falló al ${what}`);
  return new UploadError(502, 'El almacenamiento no ha aceptado la subida. Inténtalo de nuevo en un momento.');
}

/** Adaptador del binding (env.PRIVATE_BUCKET) a { list, get, putNew }. */
export function bindingStorage(bucket) {
  return {
    async list(prefix) {
      const found = new Map();
      let cursor;
      for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
        let listing;
        try {
          listing = await bucket.list({ prefix, ...(cursor ? { cursor } : {}) });
        } catch {
          throw storageFailure('listar la subida');
        }
        for (const object of listing.objects ?? []) {
          if (object.key.startsWith(prefix)) found.set(object.key.slice(prefix.length), object.size);
        }
        if (!listing.truncated || !listing.cursor) return found;
        cursor = listing.cursor;
      }
      throw new UploadError(502, 'La subida tiene demasiados trozos guardados. Vuelve a elegir el archivo.');
    },
    async get(key) {
      let object;
      try {
        object = await bucket.get(key);
      } catch {
        throw storageFailure('leer un trozo');
      }
      if (!object) throw storageFailure('leer un trozo');
      return new Uint8Array(await object.arrayBuffer());
    },
    async putNew(key, bytes, contentType) {
      let written;
      try {
        written = await bucket.put(key, bytes, { httpMetadata: { contentType }, onlyIf: ifAbsent() });
      } catch {
        throw storageFailure('guardar un trozo');
      }
      return written !== null;
    },
  };
}
