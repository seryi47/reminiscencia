// Portadas al instante (ADR-0029): el JPEG ya validado (frontend/web/server/edit-core.js, readCover) se guarda en el
// bucket PÚBLICO con un nombre inmutable, portadas/<id>-<hash>.jpg (hash: los 16 primeros hexadecimales del SHA-256 del
// contenido), y el índice portadas/indice.json ({ id: fichero }) pasa a apuntar a él. El índice se escribe con
// condición (ETag con If-Match, o «solo si no existe» la primera vez) y se reintenta si otra petición lo cambió entre
// la lectura y la escritura: dos portadas a la vez nunca se pisan. Nunca se borra nada: una portada sustituida deja de
// estar en el índice, pero su fichero sigue (es pequeño y alguien puede tenerlo en caché).

import { EditError } from '../../frontend/web/server/edit-core.js';
import {
  COVER_INDEX_KEY,
  coverKeyFor,
  coverUrl,
  parseCoverIndex,
  serializeCoverIndex,
} from '../../frontend/web/js/cover-index.js';
import { ifAbsent } from './r2-storage.js';

/** Las imágenes no cambian nunca (el nombre lleva el hash): un año en caché. */
export const IMAGE_CACHE_CONTROL = 'public, max-age=31536000, immutable';
/** El índice cambia con cada portada: siempre se revalida (la web y la APK lo piden además sin caché). */
export const INDEX_CACHE_CONTROL = 'no-cache';
export const INDEX_ATTEMPTS = 6;

/** Los 16 primeros hexadecimales del SHA-256 de los bytes. */
export async function contentHash(bytes) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest.subarray(0, 8), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function bucketFailure(what) {
  console.error(`portada: R2 falló al ${what}`);
  return new EditError(502, 'El almacenamiento no ha aceptado la portada. Inténtalo de nuevo en un momento.');
}

/** Índice actual del bucket: { index: Map, etag } (etag null si aún no existe). */
export async function readCoverIndex(bucket) {
  let object;
  try {
    object = await bucket.get(COVER_INDEX_KEY);
  } catch {
    throw bucketFailure('leer el índice');
  }
  if (!object) return { index: new Map(), etag: null };
  return { index: parseCoverIndex(await object.text()), etag: object.etag };
}

/**
 * Pone [id] → [key] en el índice con escritura condicional. Si otra petición lo cambió entre medias (put devuelve
 * null), vuelve a leer y a intentarlo, hasta [attempts] veces con una espera corta y creciente. Devuelve el índice
 * escrito.
 */
export async function updateCoverIndex(bucket, id, key, { attempts = INDEX_ATTEMPTS, sleep = defaultSleep } = {}) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const { index, etag } = await readCoverIndex(bucket);
    if (index.get(id) === key) return index;
    index.set(id, key);
    let written;
    try {
      written = await bucket.put(COVER_INDEX_KEY, serializeCoverIndex(index), {
        httpMetadata: { contentType: 'application/json; charset=utf-8', cacheControl: INDEX_CACHE_CONTROL },
        onlyIf: etag === null ? ifAbsent() : { etagMatches: etag },
      });
    } catch {
      throw bucketFailure('guardar el índice');
    }
    if (written !== null) return index;
    await sleep(50 * (attempt + 1) + Math.floor(Math.random() * 50));
  }
  throw new EditError(503, 'Hay muchas portadas cambiándose a la vez. Inténtalo de nuevo en un momento.');
}

/**
 * Guarda la portada [bytes] (JPEG ya validado) de [id] en el bucket público y la apunta en el índice. Devuelve los
 * campos que se añaden a la respuesta: { portada: fichero, url }.
 */
export async function saveCoverToBucket(bucket, { id, bytes }, options = {}) {
  const key = coverKeyFor(id, await contentHash(bytes));
  try {
    // El mismo contenido da el mismo nombre: escribirlo otra vez es inofensivo.
    await bucket.put(key, bytes, { httpMetadata: { contentType: 'image/jpeg', cacheControl: IMAGE_CACHE_CONTROL } });
  } catch {
    throw bucketFailure('guardar la imagen');
  }
  await updateCoverIndex(bucket, id, key, options);
  return { portada: key, url: coverUrl(key) };
}
