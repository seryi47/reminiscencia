// Bucket de R2 simulado en memoria con la forma del binding de un Worker (get, put, list; ADR-0029): ETag por versión,
// condiciones de put (onlyIf con { etagMatches, etagDoesNotMatch } o con cabeceras If-Match / If-None-Match, también
// «*»), put que devuelve null si la condición no se cumple, listado con prefijo y cursor, y un gancho beforePut para
// simular otra petición que escribe entre la lectura y la escritura. No es una suite: lo importan las pruebas.

const toBytes = (value) => {
  if (typeof value === 'string') return new TextEncoder().encode(value);
  if (value instanceof Uint8Array) return new Uint8Array(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  throw new TypeError('Valor no admitido en el bucket simulado.');
};

function objectOf(key, entry) {
  return {
    key,
    size: entry.bytes.length,
    etag: entry.etag,
    httpEtag: `"${entry.etag}"`,
    httpMetadata: { ...entry.httpMetadata },
    async arrayBuffer() {
      return entry.bytes.slice().buffer;
    },
    async text() {
      return new TextDecoder().decode(entry.bytes);
    },
  };
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
  const clean = (value) => value?.replace(/^"|"$/g, '');
  if (matches !== null && (!current || (matches !== '*' && clean(matches) !== current.etag))) return false;
  if (doesNotMatch !== null && current && (doesNotMatch === '*' || clean(doesNotMatch) === current.etag)) return false;
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
    async get(key) {
      calls.push({ op: 'get', key });
      fail('get', key);
      const entry = objects.get(key);
      return entry ? objectOf(key, entry) : null;
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
