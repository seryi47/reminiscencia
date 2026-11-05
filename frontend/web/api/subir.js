// Función de Vercel POST /api/subir (ADR-0017, revisada por ADR-0024): guarda por trozos, en el bucket PRIVADO de
// Cloudflare R2, el Ogg Opus que la web (js/cuidador/subida-publica.js) o la APK (lib/shared_upload.dart) ya han
// convertido, y al terminar lanza el workflow buzon de GitHub. Nada pasa por Git hasta que el workflow publica la
// canción. Node, sin dependencias: solo fetch y node:crypto (firma AWS SigV4 propia, como backend/sonidos/r2.py).
//
// Contrato (lo usan la web y la APK; no cambiarlo sin cambiar los dos; no ha cambiado con ADR-0024):
//   POST /api/subir, cuerpo: los bytes del trozo (application/octet-stream), hasta 4 MB (Vercel admite 4,5 MB por
//   petición). Cabeceras:
//     X-Nombre-Archivo  nombre original del archivo, con encodeURIComponent
//     X-Subida-Id       UUID del archivo (el mismo en todos sus trozos)
//     X-Parte           índice del trozo, desde 0
//     X-Partes          número total de trozos, de 1 a 1000
//     X-Album-Id, X-Album-Name, X-Artista-Cancion  opcionales (playlists de YouTube, ADR-0019)
//   Respuesta JSON: { ok, parte, partes, completa, repetido, nombre, mensaje } o { ok: false, error }.
//
// Almacenamiento: cada trozo va a entrada/<id>/<índice>.part del bucket privado (R2_PRIVATE_BUCKET), en orden (un trozo
// solo se acepta si ya están todos los anteriores) y sin sobrescribir nunca (PUT con If-None-Match: *). Con el último se
// escribe entrada/<id>/manifiesto.json, {"nombre": "<nombre>.opus", "partes": N} (y álbum y artista si llegan), y se
// lanza el workflow buzon con un repository_dispatch (tipo «subida-web», con el id) usando GITHUB_TOKEN (basta
// «Contents: write»). El workflow recoge las subidas completas del bucket (job 'recoger'), las une, las convierte y las
// publica con la licencia de la web (backend/sonidos/buzon.py, WEB_LICENSE), y después las borra de entrada/.
// Si el aviso a GitHub falla, se responde 502: el cliente reintenta el último trozo, que ya está guardado, y solo se
// repite el aviso.
//
// Protecciones: el primer trozo debe empezar por una página Ogg con la cabecera OpusHead; el nombre se limpia (sin
// rutas, sin caracteres de control ni fuera de la lista del buzón, longitud acotada, extensión .opus); solo se escribe
// en entrada/<UUID>/; un trozo repetido con el mismo contenido se da por bueno y uno distinto se rechaza. Las claves de
// R2 y el token solo salen de process.env, solo van a sus servicios (firma de R2; cabecera Authorization de GitHub) y
// nunca van en los registros (solo el estado HTTP) ni en las respuestas.

import { createHash, createHmac } from 'node:crypto';

export const REPOSITORY = 'seryi47/reminiscencia';
export const DISPATCH_EVENT = 'subida-web';
export const ENTRY_PREFIX = 'entrada';
export const MANIFEST_NAME = 'manifiesto.json';
export const MAX_CHUNK_BYTES = 4 * 1024 * 1024;
export const MAX_PARTS = 1000;
export const DONE_MESSAGE = 'Subida: llegará a todos en un par de minutos.';
// El buzón admite hasta 200 caracteres y 255 bytes por nombre; se deja sitio para « (NN)» y «.opus».
export const MAX_STEM_CHARS = 150;
export const MAX_STEM_BYTES = 180;
const GITHUB_API = 'https://api.github.com';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const INTEGER = /^(?:0|[1-9][0-9]{0,3})$/;
const PLAYLIST_ID = /^[A-Za-z0-9_-]{1,200}$/;
const ACCOUNT_ID = /^[0-9a-f]{32}$/;
const BUCKET_NAME = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;
// La misma lista que backend/sonidos/buzon.py (_NAME_PUNCTUATION), además de letras, marcas y números.
const NAME_PUNCTUATION = new Set(" ._-()[]'’&,!¡¿+#");
const NAME_CHAR = /[\p{L}\p{M}\p{N}]/u;
const NOT_CONFIGURED = 'La subida no está configurada en el servidor (falta GITHUB_TOKEN o alguna variable de R2). Avisa a quien mantiene la web.';

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
  while (chars.length > 0 && Buffer.byteLength(chars.join(''), 'utf8') > MAX_STEM_BYTES) chars.pop();
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
  return Buffer.from(data.subarray(start, start + 8)).toString('latin1') === 'OpusHead' && data[start + 8] === 1;
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

/** Comprueba el cuerpo de un trozo: no vacío, hasta 4 MB y, el primero, Ogg Opus. */
export function checkChunk(bytes, index) {
  if (!bytes || bytes.length === 0) throw new UploadError(400, 'El trozo llega vacío.');
  if (bytes.length > MAX_CHUNK_BYTES) {
    throw new UploadError(413, 'El trozo pasa de 4 MB, lo máximo que admite el servidor por petición. Envía el archivo en trozos más pequeños.');
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

// ---------------------------------------------------------------------------------------------
// Firma AWS Signature Version 4 (la misma que sign_v4 de backend/sonidos/r2.py; vectores comunes en
// tests/fixtures/sigv4-vectores.json)
// ---------------------------------------------------------------------------------------------

function sha256Hex(data) {
  return createHash('sha256').update(data).digest('hex');
}

function hmac(key, data) {
  return createHmac('sha256', key).update(data).digest();
}

/** Codificación de RFC 3986: como urllib.parse.quote de Python (encodeURIComponent deja sin codificar !'()*). */
export function rfc3986(text, { keepSlash = false } = {}) {
  const encoded = encodeURIComponent(text).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  return keepSlash ? encoded.replace(/%2F/g, '/') : encoded;
}

/** Query canónica de SigV4: claves ordenadas y todo codificado según RFC 3986 (como canonical_query de Python). */
export function canonicalQuery(query) {
  return Object.keys(query)
    .sort()
    .map((name) => `${rfc3986(name)}=${rfc3986(String(query[name]))}`)
    .join('&');
}

function amzDate(when) {
  return when.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/**
 * Cabeceras de la firma (x-amz-date, x-amz-content-sha256 y Authorization). path y query ya van codificados.
 * extraHeaders: cabeceras que también se firman, en minúsculas.
 */
export function signV4({ method, host, path, query = '', payload = new Uint8Array(0), accessKeyId, secretAccessKey, region, service, when, extraHeaders = {} }) {
  const date = amzDate(when);
  const day = date.slice(0, 8);
  const payloadHash = sha256Hex(payload);
  const toSign = { host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': date, ...extraHeaders };
  const names = Object.keys(toSign).sort();
  const canonicalHeaders = names.map((name) => `${name}:${String(toSign[name]).trim()}\n`).join('');
  const signedHeaders = names.join(';');
  const canonicalRequest = [method, path, query, canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${day}/${region}/${service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', date, scope, sha256Hex(canonicalRequest)].join('\n');
  let key = Buffer.from(`AWS4${secretAccessKey}`, 'utf8');
  for (const part of [day, region, service, 'aws4_request']) key = hmac(key, part);
  const signature = createHmac('sha256', key).update(stringToSign).digest('hex');
  return {
    'x-amz-date': date,
    'x-amz-content-sha256': payloadHash,
    Authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

// ---------------------------------------------------------------------------------------------
// R2 (API S3) y GitHub
// ---------------------------------------------------------------------------------------------

/** Configuración desde el entorno, o null si falta algo. */
export function readConfig(env) {
  const value = (name) => (typeof env[name] === 'string' ? env[name].trim() : '');
  const config = {
    token: value('GITHUB_TOKEN'),
    accountId: value('R2_ACCOUNT_ID'),
    accessKeyId: value('R2_ACCESS_KEY_ID'),
    secretAccessKey: value('R2_SECRET_ACCESS_KEY'),
    bucket: value('R2_PRIVATE_BUCKET'),
  };
  if (Object.values(config).some((item) => !item)) return null;
  // El id de la cuenta forma parte del host y el bucket, de la ruta: solo sus formatos (nunca otro host).
  if (!ACCOUNT_ID.test(config.accountId) || !BUCKET_NAME.test(config.bucket)) return null;
  return config;
}

function storageError(status, what) {
  // Solo el estado: ni la respuesta de R2 ni las cabeceras firmadas van al registro.
  console.error(`subir: R2 respondió ${status} al ${what}`);
  if (status === 401 || status === 403) {
    return new UploadError(500, 'El servidor no tiene permiso para guardar la subida. Avisa a quien mantiene la web.');
  }
  return new UploadError(502, 'El almacenamiento no ha aceptado la subida. Inténtalo de nuevo en un momento.');
}

function decodeXml(text) {
  return text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

function r2Client(config, fetchImpl, now) {
  const host = `${config.accountId}.r2.cloudflarestorage.com`;
  const request = async (method, key, { query = {}, body, headers = {}, what }) => {
    const path = `/${rfc3986(config.bucket)}${key ? `/${rfc3986(key, { keepSlash: true })}` : ''}`;
    const queryString = canonicalQuery(query);
    const payload = body ?? new Uint8Array(0);
    const lower = Object.fromEntries(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]));
    const signed = signV4({
      method, host, path, query: queryString, payload, accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey, region: 'auto', service: 's3', when: now(),
      extraHeaders: 'if-none-match' in lower ? { 'if-none-match': lower['if-none-match'] } : {},
    });
    try {
      return await fetchImpl(`https://${host}${path}${queryString ? `?${queryString}` : ''}`, {
        method,
        headers: { ...headers, ...signed },
        body: method === 'PUT' ? payload : undefined,
      });
    } catch {
      console.error(`subir: no se pudo conectar con R2 al ${what}`);
      throw new UploadError(502, 'No se ha podido conectar con el almacenamiento. Inténtalo de nuevo en un momento.');
    }
  };
  return {
    /** Nombres y tamaños de los objetos bajo entrada/<id>/ (sin el prefijo). */
    async list(prefix) {
      const found = new Map();
      let token = '';
      for (let page = 0; page < 20; page += 1) {
        const query = { 'list-type': '2', prefix, ...(token ? { 'continuation-token': token } : {}) };
        const response = await request('GET', '', { query, what: 'listar la subida' });
        if (response.status !== 200) throw storageError(response.status, 'listar la subida');
        const xml = await response.text();
        for (const [, item] of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
          const key = decodeXml(/<Key>([\s\S]*?)<\/Key>/.exec(item)?.[1] ?? '');
          const size = Number(/<Size>(\d+)<\/Size>/.exec(item)?.[1] ?? NaN);
          if (key.startsWith(prefix)) found.set(key.slice(prefix.length), size);
        }
        token = /<IsTruncated>true<\/IsTruncated>/.test(xml) ? decodeXml(/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/.exec(xml)?.[1] ?? '') : '';
        if (!token) return found;
      }
      throw new UploadError(502, 'La subida tiene demasiados trozos guardados. Vuelve a elegir el archivo.');
    },
    async get(key) {
      const response = await request('GET', key, { what: 'leer un trozo' });
      if (response.status !== 200) throw storageError(response.status, 'leer un trozo');
      return new Uint8Array(await response.arrayBuffer());
    },
    /** Escribe sin sobrescribir nunca: true si lo escribió, false si ya existía (412). */
    async putNew(key, bytes, contentType) {
      const response = await request('PUT', key, {
        body: bytes, headers: { 'Content-Type': contentType, 'If-None-Match': '*' }, what: 'guardar un trozo',
      });
      if (response.status === 200) return true;
      if (response.status === 412) return false;
      throw storageError(response.status, 'guardar un trozo');
    },
  };
}

/** Avisa al workflow buzon (repository_dispatch). El token solo va a api.github.com en la cabecera Authorization. */
async function dispatchWorkflow({ token, uploadId, fetchImpl }) {
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

function sameBytes(left, right) {
  return left.length === right.length && Buffer.compare(Buffer.from(left), Buffer.from(right)) === 0;
}

/** Guarda un trozo en el bucket privado y, con el último, el manifiesto; después avisa al workflow. */
async function storeChunk({ r2, config, fetchImpl, uploadId, index, total, stem, bytes, album, artist }) {
  const prefix = `${ENTRY_PREFIX}/${uploadId}/`;
  const stored = await r2.list(prefix);
  const name = `${index}.part`;
  const last = index === total - 1;
  const isSame = async () => sameBytes(await r2.get(partKey(uploadId, index)), bytes);

  if (stored.has(MANIFEST_NAME)) {
    // Una subida completa solo admite repetir su último trozo (el cliente reintenta si el aviso a GitHub falló).
    if (!last || !stored.has(name) || !(await isSame())) {
      throw new UploadError(409, 'Esta subida ya está completa. Para subir el archivo otra vez, elígelo de nuevo.');
    }
    let manifestName = null;
    try {
      manifestName = JSON.parse(new TextDecoder().decode(await r2.get(manifestKey(uploadId))))?.nombre ?? null;
    } catch (error) {
      if (error instanceof UploadError) throw error;
    }
    await dispatchWorkflow({ token: config.token, uploadId, fetchImpl });
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
    if (!(await r2.putNew(partKey(uploadId, index), bytes, 'application/octet-stream'))) {
      // Otra petición lo escribió entre la lista y la escritura: vale si es igual.
      if (!(await isSame())) throw new UploadError(409, 'Ese trozo ya se había subido con otro contenido. Vuelve a elegir el archivo.');
      repeated = true;
    }
  }
  if (!last) return { repeated, name: null };

  // El nombre final lo decide el buzón (sufijo « (2)» si ya hay uno igual); aquí solo se limpia.
  const fileName = `${stem}.opus`;
  const manifest = new TextEncoder().encode(manifestText({ name: fileName, total, album, artist }));
  await r2.putNew(manifestKey(uploadId), manifest, 'application/json');
  await dispatchWorkflow({ token: config.token, uploadId, fetchImpl });
  return { repeated, name: fileName };
}

// ---------------------------------------------------------------------------------------------
// Petición
// ---------------------------------------------------------------------------------------------

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

/** Atiende una petición. env, fetchImpl y now se inyectan en las pruebas (tests/web-unit/api-subir.test.mjs). */
export async function handleUpload(request, { env = {}, fetchImpl = globalThis.fetch, now = () => new Date() } = {}) {
  try {
    if (request.method !== 'POST') throw new UploadError(405, 'Solo se admite POST.');
    const config = readConfig(env);
    if (!config) {
      console.error('subir: faltan variables de entorno (GITHUB_TOKEN, R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY o R2_PRIVATE_BUCKET) o no tienen el formato esperado');
      throw new UploadError(500, NOT_CONFIGURED);
    }
    const { fileName, uploadId, index, total, album, artist } = parseUploadHeaders(request.headers);
    const declared = Number(request.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > MAX_CHUNK_BYTES) checkChunk({ length: declared }, -1);
    const bytes = new Uint8Array(await request.arrayBuffer());
    checkChunk(bytes, index);
    const stem = cleanStem(fileName);
    const r2 = r2Client(config, fetchImpl, now);
    const stored = await storeChunk({ r2, config, fetchImpl, uploadId, index, total, stem, bytes, album, artist });
    const complete = index === total - 1;
    return json(200, {
      ok: true,
      parte: index,
      partes: total,
      completa: complete,
      repetido: stored.repeated,
      nombre: stored.name,
      mensaje: complete ? DONE_MESSAGE : `Trozo ${index + 1} de ${total} recibido.`,
    });
  } catch (error) {
    if (error instanceof UploadError) return json(error.status, { ok: false, error: error.message });
    console.error('subir: fallo inesperado', error?.name ?? 'Error');
    return json(500, { ok: false, error: 'No se ha podido completar la subida. Inténtalo de nuevo.' });
  }
}

/** Punto de entrada de Vercel (firma web: Request → Response). */
export function POST(request) {
  return handleUpload(request, { env: process.env, fetchImpl: globalThis.fetch });
}
