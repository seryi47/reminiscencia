// Incidencias de la biblioteca (ADR-0008). La web no escribe en el catálogo: una importación se prepara como una
// incidencia de GitHub con la etiqueta «biblioteca», y la procesan las cuentas con permiso de escritura. El cuerpo
// cumple el contrato que lee el backend (backend/sonidos/issue_request.py): líneas «clave: valor» con las claves
// action, url, license, title y payload; el payload de organize es un objeto JSON en una sola línea.
//
// Las validaciones reproducen las del backend con dos restricciones más estrictas que fija el contrato de la
// interfaz: solo https, y en Internet Archive solo la forma archive.org/details/<identificador> (el backend
// también acepta download/<identificador>). Este módulo no toca el DOM: la hoja «Subir canciones» (js/views/upload.js)
// usa evaluateImportForm y buildIssueUrl, y las hojas de edición (js/views/edit.js) usan buildOrganizeIssueUrl para
// «Editar detalles» de una canción o de un álbum, «Añadir a un álbum», «Quitar de este álbum», «Añadir canciones» a
// un álbum y «Quitar del álbum» o «Mover a otro álbum» de la selección múltiple (move_songs, varias canciones en una
// sola petición), «Ordenar canciones» (order_album, la lista completa del álbum en el orden nuevo; ADR-0026) y
// «Crear álbum». clean_titles (limpiar títulos y artistas con la regla del backend, ADR-0032) no tiene hoja: se valida
// aquí para que /api/editar la admita. Las carpetas del catálogo se
// llaman «Álbumes» en toda la interfaz; el contrato conserva sus nombres (create_folder, edit_folder, folder_id).
// La carpeta js/cuidador/ conserva su nombre por las referencias de la documentación (CLAUDE.md, ADR-0005 y
// ADR-0008); ya no hay modo cuidador (ADR-0015).

export const REPO = 'seryi47/reminiscencia';
export const ISSUE_LABEL = 'biblioteca';
// Aviso de la hoja: quién procesa las incidencias.
export const PROCESSING_NOTE = 'Se abrirá GitHub para que confirmes la incidencia. Solo la procesan las cuentas con permiso de escritura en el repositorio.';
// Aviso de las hojas de edición (detalles, álbum y portada).
export const EDIT_NOTE = 'Hace falta permiso de escritura en el repositorio. El cambio llega a todos en un par de minutos.';
// Buzón de portadas: la imagen se sube con el ID de la canción o del álbum como nombre de archivo.
export const COVER_UPLOAD_URL = `https://github.com/seryi47/reminiscencia/upload/main/audio-library/buzon/portadas`;
export const COVER_RULES = Object.freeze({ formats: 'JPG, PNG o WebP', maxMb: 10, size: 640 });

// Límites del backend (issue_request.py). Se miden en caracteres (puntos de código), como len() de Python.
export const REQUEST_LIMITS = Object.freeze({
  request: 8000,
  url: 2048,
  license: 300,
  title: 200,
  payload: 4000,
  folderName: 80,
  folderArtist: 80,
  artist: 200,
  tags: 20,
  tag: 40,
  yearMin: 1000,
  yearMax: 2100,
  issueTitle: 120,
  // move_songs: canciones distintas por petición (de 1 a 100).
  moveSongs: 100,
  // order_album: canciones de un álbum que se pueden ordenar en una petición (de 1 a 190; caben en los 4000
  // caracteres del payload, ADR-0026).
  orderSongs: 190,
  // clean_titles con song_ids: canciones distintas por petición (de 1 a 100; sin song_ids, todas; ADR-0032).
  cleanTitles: 100,
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
// Álbum (carpeta del catálogo): «F» + 16 hexadecimales (las nuevas, las únicas que admiten portada) o 10
// hexadecimales (las antiguas). El backend acepta las dos formas.
const FOLDER_ID = /^(?:F[0-9a-f]{16}|[0-9a-f]{10})$/;
const COVER_FOLDER_ID = /^F[0-9a-f]{16}$/;
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

// Espacios que el backend quita al principio y al final de un texto (str.strip de Python). No es lo mismo que trim()
// de JavaScript: Python quita además U+001C a U+001F y no quita U+FEFF. Lo comprueba tests/contrato/peticiones.json.
const BACKEND_SPACES = new Set([
  0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x1c, 0x1d, 0x1e, 0x1f, 0x20, 0x85, 0xa0, 0x1680,
  0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a,
  0x2028, 0x2029, 0x202f, 0x205f, 0x3000,
].map((code) => String.fromCharCode(code)));

/** El texto sin los espacios que quita el backend al principio y al final (str.strip de Python). */
export function stripLikeBackend(text) {
  const chars = [...String(text ?? '')];
  let start = 0;
  let end = chars.length;
  while (start < end && BACKEND_SPACES.has(chars[start])) start += 1;
  while (end > start && BACKEND_SPACES.has(chars[end - 1])) end -= 1;
  return chars.slice(start, end).join('');
}

// Operaciones de organize: campos obligatorios y opcionales, además de «op» (igual que OPERATIONS del backend).
const OPERATIONS = Object.freeze({
  create_folder: Object.freeze({ required: Object.freeze(['name']), optional: Object.freeze(['parent_id', 'artist']) }),
  // Como en el backend, «Editar detalles» de un álbum lleva siempre el nombre; el artista es opcional.
  edit_folder: Object.freeze({ required: Object.freeze(['folder_id', 'name']), optional: Object.freeze(['artist']) }),
  rename_folder: Object.freeze({ required: Object.freeze(['folder_id', 'name']), optional: Object.freeze([]) }),
  delete_folder: Object.freeze({ required: Object.freeze(['folder_id']), optional: Object.freeze([]) }),
  edit_song: Object.freeze({
    required: Object.freeze(['song_id']),
    optional: Object.freeze(['title', 'artist', 'year', 'tags', 'folder_id', 'public']),
  }),
  // Varias canciones a un álbum (o fuera de su álbum, con folder_id null) en una sola incidencia.
  move_songs: Object.freeze({ required: Object.freeze(['song_ids', 'folder_id']), optional: Object.freeze([]) }),
  // El orden nuevo de un álbum: la lista completa y exacta de sus canciones (el backend lo comprueba al aplicarla).
  order_album: Object.freeze({ required: Object.freeze(['folder_id', 'song_ids']), optional: Object.freeze([]) }),
  // Títulos y artistas limpios (ADR-0032): sin campos, todas las canciones; con song_ids, solo esas.
  clean_titles: Object.freeze({ required: Object.freeze([]), optional: Object.freeze(['song_ids']) }),
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
/** ¿Admite portada este álbum? Solo los de la forma nueva (F + 16 hexadecimales). */
export const isCoverFolderId = (value) => typeof value === 'string' && COVER_FOLDER_ID.test(value);

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

// Problemas de una operación de organize: { code, field, message }. code y field son los del backend (RequestError de
// issue_request.py) y los que comparan los casos comunes de tests/contrato/peticiones.json; message es el texto en
// español que ve la persona.
const issue = (code, field, message) => ({ code, field: field ?? null, message });

const FOLDER_ID_MESSAGE = 'El identificador del álbum no es válido (F seguida de 16 caracteres hexadecimales en minúscula, o 10 hexadecimales).';
const SONG_ID_MESSAGE = 'El identificador de la canción no es válido (S seguida de 16 caracteres hexadecimales en minúscula).';

function folderRefIssue(value, field, { nullable = false } = {}) {
  if (value === null && nullable) return null;
  return isFolderId(value) ? null : issue('invalid_folder_id', field, FOLDER_ID_MESSAGE);
}

function songRefIssue(value, field = 'song_id') {
  return isSongId(value) ? null : issue('invalid_song_id', field, SONG_ID_MESSAGE);
}

// Texto de una operación, como _text del backend: se quitan los espacios de los lados (stripLikeBackend), y lo que
// queda no puede tener caracteres de control, ni quedar vacío si es obligatorio, ni pasar de max caracteres.
function textIssue(value, { field, name, max, required = false }) {
  if (typeof value !== 'string') return issue('not_text', field, `${name} debe ser texto.`);
  const clean = stripLikeBackend(value);
  if (CONTROL.test(clean)) return issue('control_chars', field, `${name} no puede tener saltos de línea ni caracteres de control.`);
  if (required && clean === '') return issue('empty_text', field, `${name} no puede quedar en blanco.`);
  if (lengthOf(clean) > max) return issue('too_long', field, `${name} no puede tener más de ${max} caracteres.`);
  return null;
}

const folderNameIssue = (value) => textIssue(value, { field: 'name', name: 'El nombre del álbum', max: REQUEST_LIMITS.folderName, required: true });
const folderArtistIssue = (value) => textIssue(value, { field: 'artist', name: 'El artista del álbum', max: REQUEST_LIMITS.folderArtist });
const songTitleIssue = (value) => textIssue(value, { field: 'title', name: 'El título', max: REQUEST_LIMITS.title, required: true });
const songArtistIssue = (value) => textIssue(value, { field: 'artist', name: 'El artista', max: REQUEST_LIMITS.artist });

// Normaliza las etiquetas como el catálogo (catalog.normalize_tags): sin espacios a los lados, minúsculas, sin vacías
// ni repetidas.
export function normalizeTags(items) {
  const seen = new Set();
  const tags = [];
  for (const item of Array.isArray(items) ? items : []) {
    const tag = stripLikeBackend(String(item ?? '')).toLowerCase();
    if (tag !== '' && !seen.has(tag)) {
      seen.add(tag);
      tags.push(tag);
    }
  }
  return tags;
}

// Campos de texto de las operaciones, por separado para marcar el campo que falla en las hojas de edición.
// Álbum: nombre de 1 a 80 caracteres y artista de 0 a 80; canción: título de 1 a 200 y artista de 0 a 200. Una línea.
export const folderNameProblem = (value) => folderNameIssue(value)?.message ?? null;
export const folderArtistProblem = (value) => folderArtistIssue(value)?.message ?? null;
export const songTitleProblem = (value) => songTitleIssue(value)?.message ?? null;
export const songArtistProblem = (value) => songArtistIssue(value)?.message ?? null;

// Lista de ids de canción de move_songs y order_album (_song_ids del backend): de 1 a max, válidos y sin repetir.
function songIdsIssue(ids, max, { emptyMessage, tooManyMessage, repeatedMessage }) {
  if (!Array.isArray(ids)) return issue('song_ids_not_list', 'song_ids', 'Las canciones (song_ids) deben ser una lista.');
  if (ids.length === 0) return issue('song_ids_empty', 'song_ids', emptyMessage);
  if (ids.length > max) return issue('song_ids_too_many', 'song_ids', tooManyMessage);
  for (const id of ids) {
    const problem = songRefIssue(id, 'song_ids');
    if (problem) return problem;
  }
  return new Set(ids).size === ids.length ? null : issue('duplicate_song_ids', 'song_ids', repeatedMessage);
}

function tagsIssue(tags) {
  if (!Array.isArray(tags)) return issue('tags_not_list', 'tags', 'Las etiquetas deben ser una lista.');
  if (tags.length > REQUEST_LIMITS.tags) return issue('too_many_tags', 'tags', MESSAGES.tagsCount);
  for (const tag of tags) {
    if (typeof tag !== 'string') return issue('not_text', 'tags', 'Cada etiqueta debe ser texto.');
    if (CONTROL.test(tag)) return issue('control_chars', 'tags', MESSAGES.tagsControl);
    if (lengthOf(stripLikeBackend(tag).toLowerCase()) > REQUEST_LIMITS.tag) return issue('too_long', 'tags', MESSAGES.tagLength);
  }
  return null;
}

/**
 * Comprobación de una operación de organize, en el mismo orden que validate_payload del backend. Devuelve
 * { code, field, message } o null.
 */
export function operationIssue(payload) {
  if (!isObject(payload)) return issue('payload_not_object', null, 'Los datos deben ser un objeto JSON.');
  if (!('op' in payload)) return issue('missing_op', null, 'Falta la operación (op).');
  const op = payload.op;
  if (typeof op !== 'string' || !Object.prototype.hasOwnProperty.call(OPERATIONS, op)) return issue('unknown_op', null, 'Operación desconocida.');
  const spec = OPERATIONS[op];
  const allowed = new Set([...spec.required, ...spec.optional]);
  const unknown = Object.keys(payload).filter((key) => key !== 'op' && !allowed.has(key)).sort();
  if (unknown.length > 0) return issue('unknown_field', unknown[0], `El campo «${unknown[0]}» no está permitido en esta operación.`);
  const missing = spec.required.filter((key) => !(key in payload)).sort();
  if (missing.length > 0) return issue('missing_field', missing[0], `Falta el campo ${missing[0]} en ${op}.`);

  switch (op) {
    case 'create_folder':
      return folderNameIssue(payload.name)
        ?? ('parent_id' in payload ? folderRefIssue(payload.parent_id, 'parent_id', { nullable: true }) : null)
        ?? ('artist' in payload ? folderArtistIssue(payload.artist) : null);
    case 'edit_folder':
      return folderRefIssue(payload.folder_id, 'folder_id')
        ?? folderNameIssue(payload.name)
        ?? ('artist' in payload ? folderArtistIssue(payload.artist) : null);
    case 'rename_folder':
      return folderRefIssue(payload.folder_id, 'folder_id') ?? folderNameIssue(payload.name);
    case 'delete_folder':
      return folderRefIssue(payload.folder_id, 'folder_id');
    case 'move_songs':
      return songIdsIssue(payload.song_ids, REQUEST_LIMITS.moveSongs, {
        emptyMessage: 'Elige al menos una canción.',
        tooManyMessage: `Como mucho ${REQUEST_LIMITS.moveSongs} canciones en cada petición.`,
        repeatedMessage: 'Hay canciones repetidas en la lista.',
      }) ?? folderRefIssue(payload.folder_id, 'folder_id', { nullable: true });
    case 'order_album':
      return folderRefIssue(payload.folder_id, 'folder_id')
        ?? songIdsIssue(payload.song_ids, REQUEST_LIMITS.orderSongs, {
          emptyMessage: 'El álbum no tiene canciones que ordenar.',
          tooManyMessage: `Se pueden ordenar ${REQUEST_LIMITS.orderSongs} canciones como mucho.`,
          repeatedMessage: 'Hay canciones repetidas en el orden.',
        });
    case 'clean_titles':
      return 'song_ids' in payload
        ? songIdsIssue(payload.song_ids, REQUEST_LIMITS.cleanTitles, {
          emptyMessage: 'Elige al menos una canción, o ninguna lista para limpiar todas.',
          tooManyMessage: `Como mucho ${REQUEST_LIMITS.cleanTitles} canciones en cada petición; sin lista se limpian todas.`,
          repeatedMessage: 'Hay canciones repetidas en la lista.',
        })
        : null;
    default: {
      const problem = songRefIssue(payload.song_id)
        ?? ('title' in payload ? songTitleIssue(payload.title) : null)
        ?? ('artist' in payload ? songArtistIssue(payload.artist) : null);
      if (problem) return problem;
      if ('year' in payload) {
        const year = payload.year;
        if (year !== null && !(Number.isInteger(year) && year >= REQUEST_LIMITS.yearMin && year <= REQUEST_LIMITS.yearMax)) {
          return issue('invalid_year', 'year', MESSAGES.yearFormat);
        }
      }
      const rest = ('tags' in payload ? tagsIssue(payload.tags) : null)
        ?? ('folder_id' in payload ? folderRefIssue(payload.folder_id, 'folder_id', { nullable: true }) : null);
      if (rest) return rest;
      if ('public' in payload && typeof payload.public !== 'boolean') return issue('not_bool', 'public', 'El campo «public» debe ser true o false.');
      return spec.optional.some((key) => key in payload) ? null : issue('no_changes', null, MESSAGES.noChanges);
    }
  }
}

// Comprobación de una operación de organize (validate_payload del backend). Devuelve el motivo o null.
export function validateOperation(payload) {
  return operationIssue(payload)?.message ?? null;
}

/**
 * La operación tal como la guarda el backend en sus campos de texto: título, nombre y artista sin espacios a los lados y
 * etiquetas normalizadas. Es lo que va en el cuerpo de la incidencia. No comprueba nada: antes, operationIssue.
 */
export function normalizeOperation(payload) {
  const clean = { ...payload };
  for (const key of ['name', 'title', 'artist']) {
    if (typeof clean[key] === 'string') clean[key] = stripLikeBackend(clean[key]);
  }
  if (Array.isArray(clean.tags)) clean.tags = normalizeTags(clean.tags);
  return clean;
}

// Problema de una petición completa (import u organize): { code, field, message } o null.
export function requestIssue(request) {
  if (!isObject(request)) return issue('invalid', null, MESSAGES.requestInvalid);
  if (request.action === 'import') {
    const problem = validateImportRequest(request);
    return problem ? issue('invalid', problem.field, problem.message) : null;
  }
  if (request.action === 'organize') {
    const problem = operationIssue(request.payload);
    if (problem) return problem;
    return lengthOf(jsonLine(normalizeOperation(request.payload))) > REQUEST_LIMITS.payload
      ? issue('payload_too_long', null, MESSAGES.payloadTooLong)
      : null;
  }
  return issue('unknown_action', null, MESSAGES.unknownAction);
}

// Comprobación completa de una petición (import u organize). Devuelve el motivo o null.
export function validateRequest(request) {
  return requestIssue(request)?.message ?? null;
}

function finishBody(lines) {
  const body = lines.join('\n');
  if (lengthOf(body) > REQUEST_LIMITS.request) throw new Error(MESSAGES.requestTooLong);
  return body;
}

// Cuerpo de la incidencia: líneas «clave: valor» que lee el backend. Lanza un error con el motivo si la petición no vale.
// En organize, el payload va normalizado (normalizeOperation), en JSON compacto y en una sola línea, como LibraryRequest.body
// de la APK: «action: organize\npayload: {…}» (tests/contrato/peticiones.json).
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
  return finishBody(['action: organize', `payload: ${jsonLine(normalizeOperation(request.payload))}`]);
}

// Título de la incidencia, según lo que pide.
export function buildIssueTitle(request) {
  if (isObject(request) && request.action === 'import') return cleanIssueTitle(`Importar audio: ${request.title || request.url}`);
  const payload = isObject(request?.payload) ? request.payload : {};
  switch (payload.op) {
    case 'create_folder':
      return cleanIssueTitle(`Crear el álbum «${payload.name}»`);
    case 'edit_folder':
      return cleanIssueTitle(`Editar el álbum ${payload.folder_id}`);
    case 'rename_folder':
      return cleanIssueTitle(`Renombrar el álbum ${payload.folder_id} como «${payload.name}»`);
    case 'delete_folder':
      return cleanIssueTitle(`Borrar el álbum ${payload.folder_id}`);
    case 'edit_song': {
      const keys = Object.keys(payload).filter((key) => key !== 'op' && key !== 'song_id');
      // Solo «public» en la operación: publicar o despublicar.
      if (keys.length === 1 && typeof payload.public === 'boolean') {
        return cleanIssueTitle(`${payload.public ? 'Publicar' : 'Despublicar'} la canción ${payload.song_id}`);
      }
      // Solo «folder_id»: mover a un álbum o sacarla de su álbum.
      if (keys.length === 1 && 'folder_id' in payload) {
        return cleanIssueTitle(payload.folder_id === null
          ? `Quitar la canción ${payload.song_id} de su álbum`
          : `Añadir la canción ${payload.song_id} al álbum ${payload.folder_id}`);
      }
      return cleanIssueTitle(`Editar la canción ${payload.song_id}`);
    }
    case 'move_songs': {
      const count = Array.isArray(payload.song_ids) ? payload.song_ids.length : 0;
      const songs = `${count} ${count === 1 ? 'canción' : 'canciones'}`;
      return cleanIssueTitle(payload.folder_id === null
        ? `Quitar ${songs} de su álbum`
        : `Añadir ${songs} al álbum ${payload.folder_id}`);
    }
    case 'order_album':
      return cleanIssueTitle(`Ordenar el álbum ${payload.folder_id}`);
    case 'clean_titles': {
      if (!Array.isArray(payload.song_ids)) return 'Limpiar los títulos de todas las canciones';
      const count = payload.song_ids.length;
      return cleanIssueTitle(`Limpiar los títulos de ${count} ${count === 1 ? 'canción' : 'canciones'}`);
    }
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

// Enlace de la incidencia de una operación de organize ({ op, … }). Lanza el motivo si el backend la rechazaría.
export function buildOrganizeIssueUrl(payload) {
  const request = { action: 'organize', payload };
  return buildIssueUrl(buildIssueTitle(request), buildIssueBody(request));
}

// ---------- evaluación del formulario de importación (lógica pura de la hoja) ----------
// Devuelve { request, errors }: request es null si el formulario no vale; errors asocia cada campo con su motivo.

export function evaluateImportForm({ url = '', license = '', title = '' } = {}) {
  const raw = { url: cleanText(url), license: cleanText(license), title: cleanText(title) };
  const problem = validateImportRequest(raw);
  if (problem) return { request: null, errors: { [problem.field]: problem.message } };
  return { request: buildImportRequest(raw), errors: {} };
}
