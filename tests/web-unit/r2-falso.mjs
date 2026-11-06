// Bucket de R2 simulado en memoria con la forma del binding de un Worker (get, head, put, list; ADR-0029 y ADR-0031):
// ETag por versión, condiciones de put y de get (onlyIf con { etagMatches, etagDoesNotMatch } o con cabeceras If-Match /
// If-None-Match, también «*», listas y W/), put que devuelve null si la condición no se cumple, get que devuelve el
// objeto SIN cuerpo (sin body) si no se cumple, como el binding real, get con range ({ offset, length }, { offset },
// { suffix }; un tramo fuera del objeto lanza, como R2), listado con prefijo y cursor, y un gancho beforePut para
// simular otra petición que escribe entre la lectura y la escritura. No es una suite: lo importan las pruebas.

const toBytes = (value) => {
  if (typeof value === 'string') return new TextEncoder().encode(value);
  if (value instanceof Uint8Array) return new Uint8Array(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  throw new TypeError('Valor no admitido en el bucket simulado.');
};

/** Metadatos de un objeto (lo que devuelve head(), o get() cuando falla la condición): sin cuerpo. */
function metaOf(key, entry) {
  return {
    key,
    size: entry.bytes.length,
    etag: entry.etag,
    httpEtag: `"${entry.etag}"`,
    httpMetadata: { ...entry.httpMetadata },
  };
}

function objectOf(key, entry, range = null) {
  const bytes = range ? entry.bytes.slice(range.offset, range.offset + range.length) : entry.bytes;
  return {
    ...metaOf(key, entry),
    ...(range ? { range: { offset: range.offset, length: range.length } } : {}),
    get body() {
      return new ReadableStream({
        start(controller) {
          controller.enqueue(bytes.slice());
          controller.close();
        },
      });
    },
    async arrayBuffer() {
      return bytes.slice().buffer;
    },
    async text() {
      return new TextDecoder().decode(bytes);
    },
  };
}

/** Tramo de get({ range }) acotado al objeto; lanza si queda fuera, como R2. */
function resolveRange(range, size) {
  if (!range) return null;
  if (range instanceof Headers) throw new TypeError('El bucket simulado no admite range como cabeceras.');
  if (range.suffix !== undefined) {
    const length = Math.min(range.suffix, size);
    return { offset: size - length, length };
  }
  const offset = range.offset ?? 0;
  if (offset >= size) throw new Error('fallo simulado de R2: rango fuera del objeto');
  const length = Math.min(range.length ?? size - offset, size - offset);
  return { offset, length };
}

function conditionHolds(onlyIf, current) {
  if (!onlyIf) return true;
  let matches = null;
  let doesNotMatch = null;
  if (onlyIf instanceof Headers) {
    matches = onlyIf.get('if-match');
    doesNotMatch = onlyIf.get('if-none-match');
  } else {
    matches = onlyIf.etagMatches ?? null;
    doesNotMatch = onlyIf.etagDoesNotMatch ?? null;
  }
  const tags = (value) => value.split(',').map((tag) => tag.trim().replace(/^W\//, '').replace(/^"|"$/g, ''));
  if (matches !== null && (!current || !tags(matches).some((tag) => tag === '*' || tag === current.etag))) return false;
  if (doesNotMatch !== null && current && tags(doesNotMatch).some((tag) => tag === '*' || tag === current.etag)) return false;
  return true;
}

export function fakeR2({ pageSize = 1000, failOn = null } = {}) {
  const objects = new Map();
  const calls = [];
  let version = 0;
  const hooks = { beforePut: null };
  const fail = (operation, key) => {
    if (failOn && failOn(operation, key)) throw new Error(`fallo simulado de R2 (${operation})`);
  };
  const bucket = {
    objects,
    calls,
    hooks,
    /** Escribe directamente (sin condición ni registro de llamada): para preparar el estado. */
    seed(key, value, httpMetadata = {}) {
      version += 1;
      objects.set(key, { bytes: toBytes(value), etag: `v${version}`, httpMetadata });
    },
    text(key) {
      const entry = objects.get(key);
      return entry ? new TextDecoder().decode(entry.bytes) : null;
    },
    async get(key, options = {}) {
      calls.push({ op: 'get', key, options });
      fail('get', key);
      const entry = objects.get(key);
      if (!entry) return null;
      if (!conditionHolds(options.onlyIf, entry)) return metaOf(key, entry);
      return objectOf(key, entry, resolveRange(options.range, entry.bytes.length));
    },
    async head(key) {
      calls.push({ op: 'head', key });
      fail('head', key);
      const entry = objects.get(key);
      return entry ? metaOf(key, entry) : null;
    },
    async put(key, value, options = {}) {
      calls.push({ op: 'put', key, options });
      fail('put', key);
      if (hooks.beforePut) await hooks.beforePut(key, bucket);
      const current = objects.get(key) ?? null;
      if (!conditionHolds(options.onlyIf, current)) return null;
      version += 1;
      const entry = { bytes: toBytes(value), etag: `v${version}`, httpMetadata: { ...(options.httpMetadata ?? {}) } };
      objects.set(key, entry);
      return objectOf(key, entry);
    },
    async list({ prefix = '', cursor, limit = pageSize } = {}) {
      calls.push({ op: 'list', prefix });
      fail('list', prefix);
      const keys = [...objects.keys()].filter((key) => key.startsWith(prefix)).sort();
      const start = cursor ? Number(cursor) : 0;
      const page = keys.slice(start, start + limit);
      const truncated = start + limit < keys.length;
      return {
        objects: page.map((key) => objectOf(key, objects.get(key))),
        truncated,
        ...(truncated ? { cursor: String(start + limit) } : {}),
      };
    },
  };
  return bucket;
}
