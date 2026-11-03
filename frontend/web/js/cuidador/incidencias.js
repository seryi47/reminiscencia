// Incidencias de la biblioteca (ADR-0008). La web no escribe en el catálogo: una importación se prepara como una
// incidencia de GitHub con la etiqueta «biblioteca», y la procesan las cuentas con permiso de escritura. El cuerpo
// cumple el contrato que lee el backend (backend/sonidos/issue_request.py): líneas «clave: valor» con las claves
// action, url, license, title y payload; el payload de organize es un objeto JSON en una sola línea.
//
// Las validaciones reproducen las del backend con dos restricciones más estrictas que fija el contrato de la
// interfaz: solo https, y en Internet Archive solo la forma archive.org/details/<identificador> (el backend
// también acepta download/<identificador>). Este módulo no toca el DOM: la hoja «Subir canciones» (js/views/upload.js)
// usa evaluateImportForm y buildIssueUrl. La carpeta js/cuidador/ conserva su nombre por las referencias de la
// documentación (CLAUDE.md, ADR-0005 y ADR-0008); ya no hay modo cuidador (ADR-0014).

export const REPO = 'seryi47/reminiscencia';
export const ISSUE_LABEL = 'biblioteca';
// Aviso de la hoja: quién procesa las incidencias.
export const PROCESSING_NOTE = 'Se abrirá GitHub para que confirmes la incidencia. Solo la procesan las cuentas con permiso de escritura en el repositorio.';

// Límites del backend (issue_request.py). Se miden en caracteres (puntos de código), como len() de Python.
export const REQUEST_LIMITS = Object.freeze({
  request: 8000,
  url: 2048,
  license: 300,
  title: 200,
  payload: 4000,
  folderName: 80,
  artist: 200,
  tags: 20,
  tag: 40,
  yearMin: 1000,
  yearMax: 2100,
  issueTitle: 120,
});

// Copia de BLOCKED_HOSTS en backend/sonidos/sources.py (ADR-0005), la misma lista que intake.js de main. Cada entrada
// bloquea también sus subdominios. Si la lista del backend cambia, hay que cambiarla aquí.
export const BLOCKED_HOSTS = Object.freeze([
  'youtube.com', 'youtu.be', 'youtube-nocookie.com', 'googlevideo.com', 'ytimg.com',
  'spotify.com', 'open.spotify.com', 'scdn.co', 'spotifycdn.com',
  'music.apple.com', 'itunes.apple.com', 'mzstatic.com',
  'soundcloud.com', 'sndcdn.com', 'vimeo.com', 'vimeocdn.com',
  'tiktok.com', 'tiktokcdn.com', 'instagram.com', 'cdninstagram.com',
  'facebook.com', 'fbcdn.net', 'bandcamp.com', 'bcbits.com',
  'deezer.com', 'dzcdn.net', 'tidal.com', 'mixcloud.com', 'dailymotion.com', 'dmcdn.net',
  'twitch.tv', 'jtvnw.net', 'ttvnw.net',
  'dai.ly', 'fb.watch', 'instagr.am', 'x.com', 'twitter.com', 'twimg.com', 'reddit.com', 'redd.it', 'rumble.com',
]);

export const AUDIO_EXTENSIONS = Object.freeze(['.mp3', '.flac', '.ogg', '.opus', '.m4a', '.wav']);

const FALLBACK_TITLE = 'Petición de la biblioteca';
const SONG_ID = /^S[0-9a-f]{16}$/;
const FOLDER_ID = /^[0-9a-f]{10}$/;
const HTTPS_PREFIX = 'https://';
const AUTHORITY = /^([A-Za-z0-9.-]+)(?::[0-9]*)?$/;
const IA_HOST = 'archive.org';
// Igual que IA_IDENTIFIER en sources.py: sin barras, y sin punto ni guion al principio.
const IA_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;
// IPv4 con cuatro decimales y sin ceros a la izquierda: la única forma que cuenta como dirección IP (igual que intake.js).
const IPV4_DOTTED = /^(?:25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])(?:\.(?:25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])){3}$/;
// Último segmento numérico, decimal o hexadecimal: una IP escrita de otra forma (127.1, 2130706433, 0x7f000001).
const NUMERIC_LABEL = /^(?:[0-9]+|0x[0-9a-f]*)$/;
// Rangos IPv4 que Python (ipaddress.is_global) no considera globales. Son los que el backend rechaza al descargar.
const NON_GLOBAL_IPV4 = Object.freeze([
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['240.0.0.0', 4], ['255.255.255.255', 32],
]);
// Dentro de 192.0.0.0/24, Python las considera globales.
const GLOBAL_IPV4_EXCEPTIONS = Object.freeze(['192.0.0.9', '192.0.0.10']);
// Espacios Unicode, caracteres de control y de formato (ancho cero, bidi): no pueden aparecer en una dirección.
const URL_SPACE_OR_CONTROL = /[\p{Zs}\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}]/u;
// Caracteres que el backend rechaza en cualquier texto (_has_control en issue_request.py): control, separadores de
// línea, surrogates y de formato (Cf).
const CONTROL = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}]/u;

// Operaciones de organize: campos obligatorios y opcionales, además de «op» (igual que OPERATIONS del backend).
const OPERATIONS = Object.freeze({
  create_folder: Object.freeze({ required: Object.freeze(['name']), optional: Object.freeze(['parent_id']) }),
  rename_folder: Object.freeze({ required: Object.freeze(['folder_id', 'name']), optional: Object.freeze([]) }),
  delete_folder: Object.freeze({ required: Object.freeze(['folder_id']), optional: Object.freeze([]) }),
  edit_song: Object.freeze({
    required: Object.freeze(['song_id']),
    optional: Object.freeze(['title', 'artist', 'year', 'tags', 'folder_id', 'public']),
  }),
});

// Textos de validación. Van junto al campo que los produce; ninguno repite lo que escribió la persona.
const MESSAGES = Object.freeze({
  urlEmpty: 'Escribe la dirección del audio.',
  urlLength: `La dirección no puede tener más de ${REQUEST_LIMITS.url} caracteres.`,
  urlSpaces: 'La dirección no puede tener espacios ni caracteres de control.',
  urlScheme: 'La dirección debe empezar por https://.',
  urlHost: 'La dirección no es válida: revisa el dominio (solo letras ASCII, cifras, puntos y guiones).',
  urlBlocked: 'Esta plataforma no se puede importar: sus condiciones de uso no permiten descargar el contenido. Usa un fichero de audio con licencia o un ítem de Internet Archive.',
  urlArchive: 'En Internet Archive usa archive.org/details/<identificador>.',
  urlArchiveFile: 'Un fichero de Internet Archive no se importa directamente: usa la página de su ítem, archive.org/details/<identificador>, donde figura la licencia.',
  urlPrivate: 'No se descarga desde una dirección de red privada, de bucle local o de enlace local.',
  urlOther: 'Admite un ítem de Internet Archive (archive.org/details/…) o un enlace directo a un fichero de audio (mp3, flac, ogg, opus, m4a o wav).',
  licenseRequired: 'Para un fichero directo indica la licencia de uso.',
  yearFormat: `El año debe ser un número entre ${REQUEST_LIMITS.yearMin} y ${REQUEST_LIMITS.yearMax}, o quedar vacío.`,
  tagsCount: `Admite como máximo ${REQUEST_LIMITS.tags} etiquetas.`,
  tagLength: `Cada etiqueta admite como máximo ${REQUEST_LIMITS.tag} caracteres.`,
  tagsControl: 'Las etiquetas no pueden tener caracteres de control.',
  noChanges: 'Indica al menos un campo que cambiar en la canción.',
  unknownAction: 'La acción no es válida: usa importar u organizar.',
  requestInvalid: 'La petición no es válida.',
  requestTooLong: `La petición no puede tener más de ${REQUEST_LIMITS.request} caracteres.`,
  payloadTooLong: `Los datos no pueden tener más de ${REQUEST_LIMITS.payload} caracteres.`,
});

// ---------- utilidades ----------

const lengthOf = (text) => [...text].length;
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const cleanText = (value) => (typeof value === 'string' ? value.trim() : '');

// JSON en una sola línea. JSON.stringify escapa los saltos de línea, pero no U+0085, U+2028 ni U+2029, que
// Python también trata como saltos: se escriben como escape para que la línea «payload:» siga siendo única.
function jsonLine(value) {
  return JSON.stringify(value).replace(/[\u0085\u2028\u2029]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

// Título de la incidencia: una sola línea, como mucho 120 caracteres.
function cleanIssueTitle(text) {
  const clean = String(text ?? '').replace(/[\s\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ').trim();
  if (clean === '') return FALLBACK_TITLE;
  const chars = [...clean];
  if (chars.length <= REQUEST_LIMITS.issueTitle) return clean;
  return `${chars.slice(0, REQUEST_LIMITS.issueTitle - 1).join('')}…`;
}

// ---------- identificadores ----------

export const isSongId = (value) => typeof value === 'string' && SONG_ID.test(value);
export const isFolderId = (value) => typeof value === 'string' && FOLDER_ID.test(value);

// ---------- direcciones ----------

// Host y ruta de una dirección https, partidos como urlsplit de Python (sin normalizar nada).
function splitUrl(url) {
  const rest = url.slice(HTTPS_PREFIX.length);
  const cut = rest.search(/[/?#]/);
  const authority = cut === -1 ? rest : rest.slice(0, cut);
  const tail = cut === -1 ? '' : rest.slice(cut);
  const end = tail.search(/[?#]/);
  return { authority, path: end === -1 ? tail : tail.slice(0, end) };
}

// Host canónico como lo resuelve el backend (canonical_host): minúsculas, sin punto final ni «www.».
// Devuelve null si el host no tiene una forma aceptable (vacío, etiquetas vacías o de 64 caracteres o más).
function canonicalHost(authority) {
  const match = AUTHORITY.exec(authority);
  if (!match) return null;
  const host = match[1].toLowerCase();
  const labels = host.split('.');
  const last = labels.length - 1;
  if (labels.some((label, index) => label.length > 63 || (label === '' && index < last))) return null;
  const bare = host.endsWith('.') ? host.slice(0, -1) : host;
  if (bare === '') return null;
  return bare.startsWith('www.') ? bare.slice(4) : bare;
}

// Identificador de ítem como en el backend (_is_plain_identifier): el patrón de IA_IDENTIFIER y sin "..".
const isPlainIdentifier = (identifier) => IA_IDENTIFIER.test(identifier) && !identifier.includes('..');

// Forma /details/<identificador> como en ia_identifier del backend: una barra final se tolera, pero una barra inicial
// de más o una final doble dan un segmento vacío y la forma no vale.
function isIaDetailsPath(path) {
  const segments = path.split('/');
  if (segments.length > 1 && segments[segments.length - 1] === '') segments.pop();
  return segments.length === 3 && segments[0] === '' && segments[1] === 'details' && isPlainIdentifier(segments[2]);
}

// IPv4 como número, para compararla con los rangos de NON_GLOBAL_IPV4.
const ipv4Value = (text) => text.split('.').reduce((value, octet) => value * 256 + Number(octet), 0);

// Igual que is_global de Python para una IPv4 que ya cumple IPV4_DOTTED.
function isIpv4Global(text) {
  const value = ipv4Value(text);
  if (GLOBAL_IPV4_EXCEPTIONS.some((exception) => ipv4Value(exception) === value)) return true;
  return !NON_GLOBAL_IPV4.some(([base, prefix]) => value >= ipv4Value(base) && value < ipv4Value(base) + 2 ** (32 - prefix));
}

// Tipo de un host que no es de Internet Archive, como hostKind en intake.js: público, privado (bucle local, red privada
// o enlace local) o no válido (una sola etiqueta, o una IP escrita de otra forma). Solo se decide lo que se ve sin DNS.
function hostKind(host) {
  if (host === 'localhost' || host.endsWith('.localhost')) return 'private';
  if (IPV4_DOTTED.test(host)) return isIpv4Global(host) ? 'public' : 'private';
  const labels = host.split('.');
  if (NUMERIC_LABEL.test(labels[labels.length - 1])) return 'invalid';
  return labels.length > 1 ? 'public' : 'invalid';
}

// Clasifica una dirección siguiendo el orden de sources.classify: primero las plataformas bloqueadas, después Internet
// Archive (un servidor de ficheros de Internet Archive no vale), después la extensión de audio y por último el host.
// Devuelve invalid, blocked, archive, archive-path, archive-file, direct, private u other.
export function classifyUrl(url) {
  if (typeof url !== 'string' || !url.startsWith(HTTPS_PREFIX)) return 'invalid';
  const { authority, path } = splitUrl(url);
  const host = canonicalHost(authority);
  if (host === null) return 'invalid';
  if (BLOCKED_HOSTS.some((blocked) => host === blocked || host.endsWith(`.${blocked}`))) return 'blocked';
  if (host === IA_HOST) return isIaDetailsPath(path) ? 'archive' : 'archive-path';
  if (host.endsWith(`.${IA_HOST}`)) return 'archive-file';
  const lower = path.toLowerCase();
  if (!AUDIO_EXTENSIONS.some((ext) => lower.endsWith(ext))) return 'other';
  const kind = hostKind(host);
  return kind === 'public' ? 'direct' : kind;
}

// Motivo en español si la dirección no sirve para importar, o null si sirve.
export function validateUrl(url) {
  const value = cleanText(url);
  if (value === '') return MESSAGES.urlEmpty;
  if (lengthOf(value) > REQUEST_LIMITS.url) return MESSAGES.urlLength;
  if (URL_SPACE_OR_CONTROL.test(value)) return MESSAGES.urlSpaces;
  if (!value.startsWith(HTTPS_PREFIX)) return MESSAGES.urlScheme;
  switch (classifyUrl(value)) {
    case 'invalid': return MESSAGES.urlHost;
    case 'blocked': return MESSAGES.urlBlocked;
    case 'archive-path': return MESSAGES.urlArchive;
    case 'archive-file': return MESSAGES.urlArchiveFile;
    case 'private': return MESSAGES.urlPrivate;
    case 'other': return MESSAGES.urlOther;
    default: return null;
  }
}

// Texto de una sola línea. Devuelve el motivo en español o null.
function textProblem(value, { name, max, required = false }) {
  if (typeof value !== 'string') return `${name} debe ser texto.`;
  // Como intake.js, el control se mira sobre el valor sin recortar: un BOM u otro carácter de formato al principio se rechaza.
  if (CONTROL.test(value)) return `${name} no puede tener saltos de línea ni caracteres de control.`;
  const clean = value.trim();
  if (required && clean === '') return `${name} no puede quedar en blanco.`;
  if (lengthOf(clean) > max) return `${name} no puede tener más de ${max} caracteres.`;
  return null;
}

// ---------- peticiones de importación y de organización ----------

// Comprueba una importación. Devuelve { field, message } o null. La licencia solo es obligatoria en un fichero
// directo: en Internet Archive la licencia viene de los metadatos del ítem.
export function validateImportRequest({ url, license, title } = {}) {
  const cleanUrl = cleanText(url);
  const urlProblem = validateUrl(cleanUrl);
  if (urlProblem) return { field: 'url', message: urlProblem };
  if (classifyUrl(cleanUrl) === 'direct') {
    const cleanLicense = cleanText(license);
    if (cleanLicense === '') return { field: 'license', message: MESSAGES.licenseRequired };
    const problem = textProblem(cleanLicense, { name: 'La licencia', max: REQUEST_LIMITS.license });
    if (problem) return { field: 'license', message: problem };
  }
  const cleanTitle = cleanText(title);
  if (cleanTitle !== '') {
    const problem = textProblem(cleanTitle, { name: 'El título', max: REQUEST_LIMITS.title });
    if (problem) return { field: 'title', message: problem };
  }
  return null;
}

// Petición de importación normalizada. La licencia solo se conserva en un fichero directo (contrato 2.4 de la UI).
export function buildImportRequest({ url, license, title } = {}) {
  const problem = validateImportRequest({ url, license, title });
  if (problem) throw new Error(problem.message);
  const cleanUrl = cleanText(url);
  const cleanTitle = cleanText(title);
  return {
    action: 'import',
    url: cleanUrl,
    license: classifyUrl(cleanUrl) === 'direct' ? cleanText(license) : null,
    title: cleanTitle === '' ? null : cleanTitle,
  };
}

function folderRefProblem(value, { nullable = false } = {}) {
  if (value === null && nullable) return null;
  return isFolderId(value) ? null : 'El identificador de la carpeta no es válido (10 caracteres hexadecimales en minúscula).';
}

function songRefProblem(value) {
  return isSongId(value) ? null : 'El identificador de la canción no es válido (S seguida de 16 caracteres hexadecimales en minúscula).';
}

// Normaliza las etiquetas como el catálogo: minúsculas, sin vacías ni repetidas.
export function normalizeTags(items) {
  const seen = new Set();
  const tags = [];
  for (const item of Array.isArray(items) ? items : []) {
    const tag = String(item ?? '').trim().toLowerCase();
    if (tag !== '' && !seen.has(tag)) {
      seen.add(tag);
      tags.push(tag);
    }
  }
  return tags;
}

// Comprobación de una operación de organize (validate_payload del backend). Devuelve el motivo o null.
export function validateOperation(payload) {
  if (!isObject(payload)) return 'Los datos deben ser un objeto JSON.';
  if (!('op' in payload)) return 'Falta la operación (op).';
  const op = payload.op;
  if (typeof op !== 'string' || !Object.prototype.hasOwnProperty.call(OPERATIONS, op)) return 'Operación desconocida.';
  const spec = OPERATIONS[op];
  const allowed = new Set([...spec.required, ...spec.optional]);
  for (const key of Object.keys(payload)) {
    if (key !== 'op' && !allowed.has(key)) return `El campo «${key}» no está permitido en esta operación.`;
  }
  const missing = spec.required.find((key) => !(key in payload));
  if (missing) return `Falta el campo ${missing} en ${op}.`;

  switch (op) {
    case 'create_folder': {
      const problem = textProblem(payload.name, { name: 'El nombre de la carpeta', max: REQUEST_LIMITS.folderName, required: true });
      if (problem) return problem;
      return 'parent_id' in payload ? folderRefProblem(payload.parent_id, { nullable: true }) : null;
    }
    case 'rename_folder':
      return folderRefProblem(payload.folder_id)
        ?? textProblem(payload.name, { name: 'El nombre de la carpeta', max: REQUEST_LIMITS.folderName, required: true });
    case 'delete_folder':
      return folderRefProblem(payload.folder_id);
    default: {
      const problem = songRefProblem(payload.song_id);
      if (problem) return problem;
      if (!spec.optional.some((key) => key in payload)) return MESSAGES.noChanges;
      if ('title' in payload) {
        const titleProblem = textProblem(payload.title, { name: 'El título', max: REQUEST_LIMITS.title, required: true });
        if (titleProblem) return titleProblem;
      }
      if ('artist' in payload) {
        const artistProblem = textProblem(payload.artist, { name: 'El artista', max: REQUEST_LIMITS.artist });
        if (artistProblem) return artistProblem;
      }
      if ('year' in payload) {
        const year = payload.year;
        if (year !== null && !(Number.isInteger(year) && year >= REQUEST_LIMITS.yearMin && year <= REQUEST_LIMITS.yearMax)) {
          return MESSAGES.yearFormat;
        }
      }
      if ('tags' in payload) {
        const tags = payload.tags;
        if (!Array.isArray(tags)) return 'Las etiquetas deben ser una lista.';
        if (tags.length > REQUEST_LIMITS.tags) return MESSAGES.tagsCount;
        for (const tag of tags) {
          if (typeof tag !== 'string') return 'Cada etiqueta debe ser texto.';
          if (CONTROL.test(tag)) return MESSAGES.tagsControl;
          if (lengthOf(tag.trim().toLowerCase()) > REQUEST_LIMITS.tag) return MESSAGES.tagLength;
        }
      }
      if ('folder_id' in payload) {
        const folderProblem = folderRefProblem(payload.folder_id, { nullable: true });
        if (folderProblem) return folderProblem;
      }
      if ('public' in payload && typeof payload.public !== 'boolean') return 'El campo «public» debe ser true o false.';
      return null;
    }
  }
}

// Comprobación completa de una petición (import u organize). Devuelve el motivo o null.
export function validateRequest(request) {
  if (!isObject(request)) return MESSAGES.requestInvalid;
  if (request.action === 'import') {
    const problem = validateImportRequest(request);
    return problem ? problem.message : null;
  }
  if (request.action === 'organize') {
    const problem = validateOperation(request.payload);
    if (problem) return problem;
    return lengthOf(jsonLine(request.payload)) > REQUEST_LIMITS.payload ? MESSAGES.payloadTooLong : null;
  }
  return MESSAGES.unknownAction;
}

function finishBody(lines) {
  const body = lines.join('\n');
  if (lengthOf(body) > REQUEST_LIMITS.request) throw new Error(MESSAGES.requestTooLong);
  return body;
}

// Cuerpo de la incidencia: líneas «clave: valor» que lee el backend. Lanza un error con el motivo si la petición no vale.
export function buildIssueBody(request) {
  if (isObject(request) && request.action === 'import') {
    const clean = buildImportRequest(request);
    const lines = ['action: import', `url: ${clean.url}`];
    if (clean.license) lines.push(`license: ${clean.license}`);
    if (clean.title) lines.push(`title: ${clean.title}`);
    return finishBody(lines);
  }
  const problem = validateRequest(request);
  if (problem) throw new Error(problem);
  return finishBody(['action: organize', `payload: ${jsonLine(request.payload)}`]);
}

// Título de la incidencia, según lo que pide.
export function buildIssueTitle(request) {
  if (isObject(request) && request.action === 'import') return cleanIssueTitle(`Importar audio: ${request.title || request.url}`);
  const payload = isObject(request?.payload) ? request.payload : {};
  switch (payload.op) {
    case 'create_folder':
      return cleanIssueTitle(`Crear la carpeta «${payload.name}»`);
    case 'rename_folder':
      return cleanIssueTitle(`Renombrar la carpeta ${payload.folder_id} como «${payload.name}»`);
    case 'delete_folder':
      return cleanIssueTitle(`Borrar la carpeta ${payload.folder_id}`);
    case 'edit_song':
      // Solo «public» en la operación: publicar o despublicar.
      if (typeof payload.public === 'boolean' && Object.keys(payload).length === 3) {
        return cleanIssueTitle(`${payload.public ? 'Publicar' : 'Despublicar'} la canción ${payload.song_id}`);
      }
      return cleanIssueTitle(`Editar la canción ${payload.song_id}`);
    default:
      return FALLBACK_TITLE;
  }
}

// Enlace para abrir una incidencia nueva con la etiqueta «biblioteca» y el texto ya escrito.
export function buildIssueUrl(title, body) {
  const issueTitle = encodeURIComponent(cleanIssueTitle(title));
  const issueBody = encodeURIComponent(String(body ?? ''));
  return `https://github.com/${REPO}/issues/new?labels=${encodeURIComponent(ISSUE_LABEL)}&title=${issueTitle}&body=${issueBody}`;
}

// ---------- evaluación del formulario de importación (lógica pura de la hoja) ----------
// Devuelve { request, errors }: request es null si el formulario no vale; errors asocia cada campo con su motivo.

export function evaluateImportForm({ url = '', license = '', title = '' } = {}) {
  const raw = { url: cleanText(url), license: cleanText(license), title: cleanText(title) };
  const problem = validateImportRequest(raw);
  if (problem) return { request: null, errors: { [problem.field]: problem.message } };
  return { request: buildImportRequest(raw), errors: {} };
}
