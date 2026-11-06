// Audio público por el Worker (ADR-0031): GET y HEAD /audio/<id>.opus desde el bucket público (binding PUBLIC_BUCKET),
// sin el límite de velocidad de r2.dev y sin dominio propio. Solo canciones de la biblioteca (S + 16 hex) y solo la
// carpeta audio/ del bucket: nada de rutas libres. Rangos de un tramo (206, o 416 si queda fuera; varios tramos o una
// cabecera mal formada se ignoran y se sirve entero, como permite RFC 9110), If-None-Match (304) e If-Range.
//
// El tramo lo lee R2 (opción range de get), así que un Worker nunca carga una canción entera en memoria: el cuerpo es
// el flujo del binding. Para validar el rango hace falta el tamaño: con Range (y en HEAD) primero se pide head().

import { parseRange } from '../../frontend/web/js/offline-core.js';

export const AUDIO_PATH = /^\/audio\/(S[0-9a-f]{16})\.opus$/;
export const AUDIO_CONTENT_TYPE = 'audio/ogg; codecs=opus';
/** El audio de un id no cambia nunca (el id sale del contenido; ADR-0020): caché de un año. */
export const AUDIO_CACHE_CONTROL = 'public, max-age=31536000, immutable';
/** Cabeceras que la web (service worker, fetch con CORS) necesita leer de una respuesta de audio. */
export const AUDIO_EXPOSE_HEADERS = Object.freeze(['Content-Range', 'Content-Length', 'Accept-Ranges', 'ETag']);

/** Clave del bucket para una ruta /audio/<id>.opus válida, o null. */
export function audioKeyOf(pathname) {
  const match = AUDIO_PATH.exec(pathname);
  return match ? `audio/${match[1]}.opus` : null;
}

const plain = (status, text, extra = {}) => new Response(text, {
  status,
  headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...extra },
});

/** ¿Alguna de las etiquetas de If-None-Match (lista separada por comas, W/ admitido, o «*») es la del objeto? */
export function etagListMatches(header, httpEtag) {
  if (typeof header !== 'string' || header.trim() === '' || !httpEtag) return false;
  const strip = (tag) => tag.trim().replace(/^W\//, '');
  const own = strip(httpEtag);
  return header.split(',').some((tag) => tag.trim() === '*' || strip(tag) === own);
}

function baseHeaders(object) {
  return {
    'Content-Type': AUDIO_CONTENT_TYPE,
    'Accept-Ranges': 'bytes',
    'Cache-Control': AUDIO_CACHE_CONTROL,
    ETag: object.httpEtag,
  };
}

const notModified = (object) => new Response(null, {
  status: 304,
  headers: { ETag: object.httpEtag, 'Cache-Control': AUDIO_CACHE_CONTROL, 'Accept-Ranges': 'bytes' },
});

/** If-Range con otra etiqueta (o con una fecha, que aquí no se usa): se ignora el Range y se sirve entero. */
function rangeApplies(request, object) {
  const ifRange = request.headers.get('if-range');
  if (ifRange === null) return true;
  return ifRange.trim() === object.httpEtag;
}

/**
 * Atiende /audio/<id>.opus. Devuelve null si la ruta no es de audio (la decide el resto del Worker). bucket es el
 * binding PUBLIC_BUCKET.
 */
export async function handleAudioRequest(request, bucket) {
  const { pathname } = new URL(request.url);
  if (!pathname.startsWith('/audio/')) return null;
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return plain(405, 'Solo se admite GET o HEAD.', { Allow: 'GET, HEAD' });
  }
  const key = audioKeyOf(pathname);
  if (key === null) return plain(404, 'No existe.');
  if (!bucket) {
    console.error('audio: falta el binding PUBLIC_BUCKET');
    return plain(503, 'El audio no está disponible ahora mismo.');
  }
  const head = request.method === 'HEAD';
  const ifNoneMatch = request.headers.get('if-none-match');
  const rangeHeader = request.headers.get('range');

  try {
    // Sin Range y por GET: una sola lectura; R2 resuelve If-None-Match (devuelve el objeto sin cuerpo → 304).
    if (!head && rangeHeader === null) {
      const object = await bucket.get(key, ifNoneMatch ? { onlyIf: new Headers({ 'If-None-Match': ifNoneMatch }) } : {});
      if (!object) return plain(404, 'No existe.');
      if (!object.body) return notModified(object);
      return new Response(object.body, {
        status: 200,
        headers: { ...baseHeaders(object), 'Content-Length': String(object.size) },
      });
    }

    // HEAD o Range: primero el tamaño y la etiqueta.
    const meta = await bucket.head(key);
    if (!meta) return plain(404, 'No existe.');
    if (etagListMatches(ifNoneMatch, meta.httpEtag)) return notModified(meta);
    const range = rangeHeader !== null && rangeApplies(request, meta) ? parseRange(rangeHeader, meta.size) : null;
    if (range === 'unsatisfiable') {
      return new Response(null, {
        status: 416,
        headers: { 'Content-Range': `bytes */${meta.size}`, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' },
      });
    }
    const status = range === null ? 200 : 206;
    const length = range === null ? meta.size : range.end - range.start + 1;
    const headers = {
      ...baseHeaders(meta),
      'Content-Length': String(length),
      ...(range === null ? {} : { 'Content-Range': `bytes ${range.start}-${range.end}/${meta.size}` }),
    };
    if (head) return new Response(null, { status, headers });

    // El tramo exacto, y solo si el objeto sigue siendo el mismo que dio head() (etagMatches).
    const object = await bucket.get(key, {
      ...(range === null ? {} : { range: { offset: range.start, length } }),
      onlyIf: { etagMatches: meta.etag },
    });
    if (!object) return plain(404, 'No existe.');
    if (!object.body) return plain(503, 'El audio ha cambiado mientras se leía. Inténtalo de nuevo.', { 'Retry-After': '1' });
    return new Response(object.body, { status, headers });
  } catch (error) {
    console.error('audio: R2 falló al leer', error?.name ?? 'Error');
    return plain(502, 'No se ha podido leer el audio. Inténtalo de nuevo.');
  }
}
