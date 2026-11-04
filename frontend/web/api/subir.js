// Función de Vercel POST /api/subir (ADR-0017): sube al buzón del repositorio de GitHub, por trozos, el Ogg Opus que
// la web (js/cuidador/subida-publica.js) o la APK ya han convertido. Node, sin dependencias: solo fetch y node:crypto.
//
// Contrato (lo usan la web y la APK; no cambiarlo sin cambiar los dos):
//   POST /api/subir, cuerpo: los bytes del trozo (application/octet-stream), hasta 4 MB (Vercel admite 4,5 MB por
//   petición). Cabeceras:
//     X-Nombre-Archivo  nombre original del archivo, con encodeURIComponent
//     X-Subida-Id       UUID del archivo (el mismo en todos sus trozos)
//     X-Parte           índice del trozo, desde 0
//     X-Partes          número total de trozos, de 1 a 1000
//   Cada trozo se guarda con un commit en main en audio-library/buzon/.partes/<id>/<índice>.part, en orden (un trozo
//   solo se acepta si ya están todos los anteriores). Con el último se escribe también
//   audio-library/buzon/.partes/<id>/manifiesto.json, {"nombre": "<nombre>.opus", "partes": N}, en un commit con la
//   línea «Licencia: …». Ese push lanza el workflow buzon, que une las partes, convierte, cataloga y publica
//   (backend/sonidos/buzon.py). Respuesta JSON: { ok, parte, partes, completa, nombre, mensaje } o { ok: false, error }.
//
// Protecciones: el primer trozo debe empezar por una página Ogg con la cabecera OpusHead; el nombre se limpia (sin
// rutas, sin caracteres de control ni fuera de la lista del buzón, longitud acotada, extensión .opus); solo se escribe
// en audio-library/buzon/.partes/; nunca se sobrescribe (un trozo repetido con el mismo contenido se da por bueno y uno
// distinto se rechaza; el nombre final lleva un sufijo si ya existe). El token solo sale de process.env.GITHUB_TOKEN y
// nunca va en los registros ni en las respuestas.

import { createHash } from 'node:crypto';

export const REPOSITORY = 'seryi47/reminiscencia';
export const BRANCH = 'main';
export const BUZON_DIRECTORY = 'audio-library/buzon';
export const PARTS_DIRECTORY = `${BUZON_DIRECTORY}/.partes`;
export const MANIFEST_NAME = 'manifiesto.json';
export const MAX_CHUNK_BYTES = 4 * 1024 * 1024;
export const MAX_PARTS = 1000;
export const LICENSE_TEXT = 'Subida desde la web pública; quien la sube declara tener derecho a publicarla';
export const DONE_MESSAGE = 'Subida: llegará a todos en un par de minutos.';
// El buzón admite hasta 200 caracteres y 255 bytes por nombre; se deja sitio para « (NN)» y «.opus».
export const MAX_STEM_CHARS = 150;
export const MAX_STEM_BYTES = 180;
const MAX_ATTEMPTS = 5;
const API = 'https://api.github.com';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const INTEGER = /^(?:0|[1-9][0-9]{0,3})$/;
const PLAYLIST_ID = /^[A-Za-z0-9_-]{1,200}$/;
// La misma lista que backend/sonidos/buzon.py (_NAME_PUNCTUATION), además de letras, marcas y números.
const NAME_PUNCTUATION = new Set(" ._-()[]'’&,!¡¿+#");
const NAME_CHAR = /[\p{L}\p{M}\p{N}]/u;

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

/** Nombre .opus que no está ya en existing (nombres del buzón, sin distinguir mayúsculas): con « (2)», « (3)»... */
export function uniqueName(stem, existing = []) {
  const taken = new Set(Array.from(existing, (name) => String(name).toLowerCase()));
  if (!taken.has(`${stem}.opus`.toLowerCase())) return `${stem}.opus`;
  for (let number = 2; number < 10000; number += 1) {
    const candidate = `${stem} (${number}).opus`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  throw new UploadError(409, 'No hay un nombre libre para este archivo en el buzón.');
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
  return { fileName, uploadId, index, total, ...(album ? { album } : {}) };
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

export function partPath(uploadId, index) {
  return `${PARTS_DIRECTORY}/${uploadId}/${index}.part`;
}

export function manifestPath(uploadId) {
  return `${PARTS_DIRECTORY}/${uploadId}/${MANIFEST_NAME}`;
}

/** SHA-1 de git de un blob: así se reconoce un trozo repetido sin descargarlo. */
export function gitBlobSha(bytes) {
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

/** Mensaje del commit de un trozo. El del último lleva la línea «Licencia: …» que lee el workflow buzon. */
export function commitMessage({ name, index, total }) {
  if (index === total - 1) return `Subida desde la web: ${name}\n\nLicencia: ${LICENSE_TEXT}\n`;
  return `Subida desde la web: ${name} (trozo ${index + 1} de ${total})\n`;
}

// ---------------------------------------------------------------------------------------------
// GitHub
// ---------------------------------------------------------------------------------------------

function githubClient(token, fetchImpl) {
  return async (method, path, body) => {
    let response;
    try {
      response = await fetchImpl(`${API}/repos/${REPOSITORY}${path}`, {
        method,
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'reminiscencia-subida',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new UploadError(502, 'No se ha podido conectar con GitHub. Inténtalo de nuevo en un momento.');
    }
    let data = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }
    return { status: response.status, data };
  };
}

function expect(result, statuses, what) {
  if (statuses.includes(result.status)) return result.data;
  // Solo el estado: ni la respuesta de GitHub ni las cabeceras (con el token) van al registro.
  console.error(`subir: GitHub respondió ${result.status} al ${what}`);
  if (result.status === 401 || result.status === 403) {
    throw new UploadError(500, 'El servidor no tiene permiso para escribir en el repositorio. Avisa a quien mantiene la web.');
  }
  throw new UploadError(502, 'GitHub no ha aceptado la subida. Inténtalo de nuevo en un momento.');
}

async function listDirectory(github, path, ref) {
  const result = await github('GET', `/contents/${encodePath(path)}?ref=${ref}`);
  if (result.status === 404) return [];
  const data = expect(result, [200], 'listar una carpeta');
  return Array.isArray(data) ? data : [];
}

function encodePath(path) {
  return path.split('/').map(encodeURIComponent).join('/');
}

/** Guarda un trozo con un commit en main. Reintenta si main cambia entre la lectura y la actualización. */
async function storeChunk({ github, uploadId, index, total, stem, bytes, album }) {
  const blobSha = gitBlobSha(bytes);
  let blobCreated = false;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const ref = expect(await github('GET', `/git/ref/heads/${BRANCH}`), [200], 'leer main');
    const headSha = ref?.object?.sha;
    const head = expect(await github('GET', `/git/commits/${headSha}`), [200], 'leer el último commit');
    const parts = await listDirectory(github, `${PARTS_DIRECTORY}/${uploadId}`, headSha);
    const byName = new Map(parts.map((item) => [item.name, item]));
    if (byName.has(MANIFEST_NAME)) {
      throw new UploadError(409, 'Esta subida ya está completa. Para subir el archivo otra vez, elígelo de nuevo.');
    }
    const existing = byName.get(`${index}.part`);
    if (existing) {
      if (existing.sha === blobSha) return { repeated: true, name: null };
      throw new UploadError(409, 'Ese trozo ya se había subido con otro contenido. Vuelve a elegir el archivo.');
    }
    for (let previous = 0; previous < index; previous += 1) {
      if (!byName.has(`${previous}.part`)) {
        throw new UploadError(409, 'Faltan trozos anteriores de este archivo. Vuelve a elegirlo para subirlo desde el principio.');
      }
    }
    const last = index === total - 1;
    let name = `${stem}.opus`;
    if (last) {
      const buzon = await listDirectory(github, BUZON_DIRECTORY, headSha);
      name = uniqueName(stem, buzon.map((item) => item.name));
    }
    if (!blobCreated) {
      expect(await github('POST', '/git/blobs', { content: Buffer.from(bytes).toString('base64'), encoding: 'base64' }), [201], 'crear el trozo');
      blobCreated = true;
    }
    const entries = [{ path: partPath(uploadId, index), mode: '100644', type: 'blob', sha: blobSha }];
    if (last) {
      entries.push({
        path: manifestPath(uploadId),
        mode: '100644',
        type: 'blob',
        content: `${JSON.stringify({ nombre: name, partes: total, ...(album ? { album } : {}) })}\n`,
      });
    }
    const tree = expect(await github('POST', '/git/trees', { base_tree: head?.tree?.sha, tree: entries }), [201], 'crear el árbol');
    const commit = expect(
      await github('POST', '/git/commits', { message: commitMessage({ name, index, total }), tree: tree?.sha, parents: [headSha] }),
      [201],
      'crear el commit',
    );
    const update = await github('PATCH', `/git/refs/heads/${BRANCH}`, { sha: commit?.sha, force: false });
    if (update.status === 200) return { repeated: false, name };
    if (update.status !== 422 && update.status !== 409) expect(update, [200], 'actualizar main');
    // main ha cambiado (otra subida u otro workflow): se vuelve a leer y se rehace el commit encima.
  }
  throw new UploadError(503, 'Hay muchas subidas a la vez. Inténtalo de nuevo en un momento.');
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

/** Atiende una petición. env y fetchImpl se inyectan en las pruebas (tests/web-unit/api-subir.test.mjs). */
export async function handleUpload(request, { env = {}, fetchImpl = globalThis.fetch } = {}) {
  try {
    if (request.method !== 'POST') throw new UploadError(405, 'Solo se admite POST.');
    const token = typeof env.GITHUB_TOKEN === 'string' ? env.GITHUB_TOKEN.trim() : '';
    if (!token) {
      console.error('subir: falta la variable de entorno GITHUB_TOKEN');
      throw new UploadError(500, 'La subida no está configurada en el servidor (falta GITHUB_TOKEN). Avisa a quien mantiene la web.');
    }
    const { fileName, uploadId, index, total, album } = parseUploadHeaders(request.headers);
    const declared = Number(request.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > MAX_CHUNK_BYTES) checkChunk({ length: declared }, -1);
    const bytes = new Uint8Array(await request.arrayBuffer());
    checkChunk(bytes, index);
    const stem = cleanStem(fileName);
    const github = githubClient(token, fetchImpl);
    const stored = await storeChunk({ github, uploadId, index, total, stem, bytes, album });
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
