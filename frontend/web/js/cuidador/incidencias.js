// Incidencias de la biblioteca (ADR-0008). La web no escribe en el catálogo: cada cambio se prepara como una
// incidencia de GitHub con la etiqueta «biblioteca», y solo la procesa el propietario. El cuerpo cumple el
// contrato que lee el backend (backend/sonidos/issue_request.py): líneas «clave: valor» con las claves action,
// url, license, title y payload; el payload de organize es un objeto JSON en una sola línea.
//
// Las validaciones reproducen las del backend con dos restricciones más estrictas que fija el contrato de la
// interfaz: solo https, y en Internet Archive solo la forma archive.org/details/<identificador> (el backend
// también acepta download/<identificador>). Las funciones de este fichero no tocan el DOM, salvo
// openIncidentSheet, que abre la hoja con openDialog del marco (shell.js). Ese módulo se carga con import()
// dinámico para que las pruebas de lógica (tests/web-unit/cuidador-incidencias.test.mjs) no necesiten navegador.

export const REPO = 'seryi47/reminiscencia';
export const ISSUE_LABEL = 'biblioteca';

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

// Igual que BLOCKED_HOSTS en backend/sonidos/sources.py (ADR-0005). Cada entrada bloquea también sus subdominios.
export const BLOCKED_HOSTS = Object.freeze([
  'youtube.com', 'youtu.be', 'spotify.com', 'open.spotify.com', 'music.apple.com',
  'soundcloud.com', 'vimeo.com', 'tiktok.com', 'instagram.com', 'facebook.com', 'bandcamp.com',
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
// Espacios Unicode y caracteres de control: no pueden aparecer en una dirección.
const URL_SPACE_OR_CONTROL = /[\p{Zs}\p{Cc}\p{Zl}\p{Zp}\p{Cs}]/u;
// Caracteres que el backend rechaza en cualquier texto (_has_control en issue_request.py).
const CONTROL = /[\p{Cc}\p{Zl}\p{Zp}\p{Cs}]/u;

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
  urlOther: 'Admite un ítem de Internet Archive (archive.org/details/…) o un enlace directo a un fichero de audio (mp3, flac, ogg, opus, m4a o wav).',
  licenseRequired: 'Para un fichero directo indica la licencia de uso.',
  songIdEmpty: 'Escribe el identificador de la canción.',
  songIdFormat: 'El identificador de la canción es una S seguida de 16 caracteres hexadecimales (0 a 9 y a a f).',
  folderIdEmpty: 'Escribe el identificador de la carpeta.',
  folderIdFormat: 'El identificador de la carpeta tiene 10 caracteres hexadecimales (0 a 9 y a a f).',
  yearFormat: `El año debe ser un número entre ${REQUEST_LIMITS.yearMin} y ${REQUEST_LIMITS.yearMax}, o quedar vacío.`,
  tagsCount: `Admite como máximo ${REQUEST_LIMITS.tags} etiquetas.`,
  tagLength: `Cada etiqueta admite como máximo ${REQUEST_LIMITS.tag} caracteres.`,
  tagsControl: 'Las etiquetas no pueden tener caracteres de control.',
  noChanges: 'Indica al menos un campo que cambiar en la canción.',
  unknownAction: 'La acción no es válida: usa importar u organizar.',
  requestInvalid: 'La petición no es válida.',
  requestTooLong: `La petición no puede tener más de ${REQUEST_LIMITS.request} caracteres.`,
  payloadTooLong: `Los datos no pueden tener más de ${REQUEST_LIMITS.payload} caracteres.`,
  readyStatus: 'Lista. Pulsa «Abrir incidencia en GitHub» para confirmarla en GitHub.',
  fixStatus: 'Corrige los campos marcados para abrir la incidencia.',
  startStatus: 'Completa el formulario para preparar la incidencia.',
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

// Acepta la s minúscula y las letras hexadecimales en mayúscula: el resultado tiene la forma canónica o no se acepta.
export function normalizeSongId(text) {
  const clean = cleanText(text);
  return /^s/i.test(clean) ? `S${clean.slice(1).toLowerCase()}` : clean;
}

export function normalizeFolderId(text) {
  return cleanText(text).toLowerCase();
}

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

// Forma exacta /details/<identificador> (las barras sobrantes no cuentan, como strip('/') en el backend).
function isIaDetailsPath(path) {
  const parts = path.replace(/^\/+|\/+$/g, '').split('/');
  return parts.length === 2 && parts[0] === 'details' && IA_IDENTIFIER.test(parts[1]);
}

// Clasifica una dirección siguiendo el orden de sources.classify: primero las plataformas bloqueadas, después
// Internet Archive y por último la extensión de audio. Devuelve invalid, blocked, archive, archive-path,
// direct u other.
export function classifyUrl(url) {
  if (typeof url !== 'string' || !url.startsWith(HTTPS_PREFIX)) return 'invalid';
  const { authority, path } = splitUrl(url);
  const host = canonicalHost(authority);
  if (host === null) return 'invalid';
  if (BLOCKED_HOSTS.some((blocked) => host === blocked || host.endsWith(`.${blocked}`))) return 'blocked';
  if (host === IA_HOST) return isIaDetailsPath(path) ? 'archive' : 'archive-path';
  const lower = path.toLowerCase();
  return AUDIO_EXTENSIONS.some((ext) => lower.endsWith(ext)) ? 'direct' : 'other';
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
    case 'other': return MESSAGES.urlOther;
    default: return null;
  }
}

// Texto de una sola línea. Devuelve el motivo en español o null.
function textProblem(value, { name, max, required = false }) {
  if (typeof value !== 'string') return `${name} debe ser texto.`;
  const clean = value.trim();
  if (CONTROL.test(clean)) return `${name} no puede tener saltos de línea ni caracteres de control.`;
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

// ---------- comprobación de campos (texto de formulario) ----------

// Devuelve { value, message }: value es la canción normalizada o null, y message el motivo si no vale.
export function checkSongIdInput(text) {
  const value = normalizeSongId(text);
  if (value === '') return { value: null, message: MESSAGES.songIdEmpty };
  if (!isSongId(value)) return { value: null, message: MESSAGES.songIdFormat };
  return { value, message: null };
}

// La carpeta es opcional salvo que required sea true. Vacía y opcional significa «sin carpeta».
export function checkFolderInput(text, { required = false } = {}) {
  const value = normalizeFolderId(text);
  if (value === '') return { value: null, message: required ? MESSAGES.folderIdEmpty : null };
  if (!isFolderId(value)) return { value: null, message: MESSAGES.folderIdFormat };
  return { value, message: null };
}

export function checkTextInput(text, { name, max, required = false }) {
  const value = cleanText(text);
  return { value, message: textProblem(value, { name, max, required }) };
}

// Año: vacío significa sin año (null); si no, un entero entre el mínimo y el máximo del contrato.
export function checkYearInput(text) {
  const value = cleanText(text);
  if (value === '') return { value: null, message: null };
  if (!/^[0-9]{1,4}$/.test(value)) return { value: null, message: MESSAGES.yearFormat };
  const year = Number(value);
  if (year < REQUEST_LIMITS.yearMin || year > REQUEST_LIMITS.yearMax) return { value: null, message: MESSAGES.yearFormat };
  return { value: year, message: null };
}

// Etiquetas separadas por comas, normalizadas. Devuelve { value (lista), message }.
export function checkTagsInput(text) {
  const raw = cleanText(text);
  if (CONTROL.test(raw)) return { value: [], message: MESSAGES.tagsControl };
  const value = normalizeTags(raw === '' ? [] : raw.split(','));
  if (value.length > REQUEST_LIMITS.tags) return { value, message: MESSAGES.tagsCount };
  if (value.some((tag) => lengthOf(tag) > REQUEST_LIMITS.tag)) return { value, message: MESSAGES.tagLength };
  return { value, message: null };
}

// ---------- evaluación de formularios (lógica pura de la hoja) ----------
// Cada evaluación devuelve { request, errors, status }: request es null si el formulario no vale; errors
// asocia cada campo con su motivo; status es el mensaje general que se muestra si no hay campo concreto.

const fail = (errors = {}, status = '') => ({ request: null, errors, status });

function finishOrganize(payload) {
  const problem = validateOperation(payload);
  if (problem) return fail({}, problem);
  return { request: { action: 'organize', payload }, errors: {}, status: '' };
}

export function evaluateImportForm({ url = '', license = '', title = '' } = {}) {
  const raw = { url: cleanText(url), license: cleanText(license), title: cleanText(title) };
  const problem = validateImportRequest(raw);
  if (problem) return fail({ [problem.field]: problem.message });
  return { request: buildImportRequest(raw), errors: {}, status: '' };
}

export function evaluatePublishForm({ songId = '', published = true } = {}) {
  const check = checkSongIdInput(songId);
  if (check.message) return fail({ songId: check.message });
  return finishOrganize({ op: 'edit_song', song_id: check.value, public: published === true });
}

function sameList(a, b) {
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

// Campos que cambian respecto a la canción actual. Sin canción de referencia, solo se envían los campos con valor.
function changedSongFields(baseline, next) {
  const changes = {};
  if (baseline) {
    if (next.title !== cleanText(baseline.title)) changes.title = next.title;
    if (next.artist !== cleanText(baseline.artist)) changes.artist = next.artist;
    if (next.year !== (baseline.year ?? null)) changes.year = next.year;
    if (!sameList(next.tags, normalizeTags(baseline.tags))) changes.tags = next.tags;
    if (next.folder_id !== (baseline.folder_id ?? null)) changes.folder_id = next.folder_id;
  } else {
    if (next.title !== '') changes.title = next.title;
    if (next.artist !== '') changes.artist = next.artist;
    if (next.year !== null) changes.year = next.year;
    if (next.tags.length > 0) changes.tags = next.tags;
    if (next.folder_id !== null) changes.folder_id = next.folder_id;
  }
  return changes;
}

// baseline es la canción del catálogo (o null si no está): sus datos son los que aparecen en el formulario.
export function evaluateEditForm({ songId = '', baseline = null, title = '', artist = '', year = '', tags = '', folderId = '' } = {}) {
  const idCheck = checkSongIdInput(songId);
  if (idCheck.message) return fail({ songId: idCheck.message });
  const titleCheck = checkTextInput(title, { name: 'El título', max: REQUEST_LIMITS.title, required: baseline !== null });
  const artistCheck = checkTextInput(artist, { name: 'El artista', max: REQUEST_LIMITS.artist });
  const yearCheck = checkYearInput(year);
  const tagsCheck = checkTagsInput(tags);
  const folderCheck = checkFolderInput(folderId);
  const errors = {};
  if (titleCheck.message) errors.title = titleCheck.message;
  if (artistCheck.message) errors.artist = artistCheck.message;
  if (yearCheck.message) errors.year = yearCheck.message;
  if (tagsCheck.message) errors.tags = tagsCheck.message;
  if (folderCheck.message) errors.folderId = folderCheck.message;
  if (Object.keys(errors).length > 0) return fail(errors);

  const changes = changedSongFields(baseline, {
    title: titleCheck.value,
    artist: artistCheck.value,
    year: yearCheck.value,
    tags: tagsCheck.value,
    folder_id: folderCheck.value,
  });
  if (Object.keys(changes).length === 0) return fail({}, MESSAGES.noChanges);
  return finishOrganize({ op: 'edit_song', song_id: idCheck.value, ...changes });
}

export function evaluateFolderForm({ action = 'create', name = '', folderId = '' } = {}) {
  if (action === 'create') {
    const nameCheck = checkTextInput(name, { name: 'El nombre de la carpeta', max: REQUEST_LIMITS.folderName, required: true });
    if (nameCheck.message) return fail({ name: nameCheck.message });
    return finishOrganize({ op: 'create_folder', name: nameCheck.value, parent_id: null });
  }
  if (action === 'rename') {
    const idCheck = checkFolderInput(folderId, { required: true });
    const nameCheck = checkTextInput(name, { name: 'El nombre de la carpeta', max: REQUEST_LIMITS.folderName, required: true });
    const errors = {};
    if (idCheck.message) errors.folderId = idCheck.message;
    if (nameCheck.message) errors.name = nameCheck.message;
    if (Object.keys(errors).length > 0) return fail(errors);
    return finishOrganize({ op: 'rename_folder', folder_id: idCheck.value, name: nameCheck.value });
  }
  if (action === 'delete') {
    const idCheck = checkFolderInput(folderId, { required: true });
    if (idCheck.message) return fail({ folderId: idCheck.message });
    return finishOrganize({ op: 'delete_folder', folder_id: idCheck.value });
  }
  return fail({}, MESSAGES.unknownAction);
}

// ---------- hoja «Gestionar la biblioteca» (DOM) ----------

const OPTIONS = Object.freeze([
  Object.freeze({ key: 'add-url', label: 'Añadir audio por URL' }),
  Object.freeze({ key: 'publish', label: 'Publicar o despublicar una canción por su identificador' }),
  Object.freeze({ key: 'edit', label: 'Editar datos de una canción' }),
  Object.freeze({ key: 'folders', label: 'Carpetas' }),
]);
const FOLDER_ACTIONS = Object.freeze([
  Object.freeze({ key: 'create', label: 'Crear carpeta' }),
  Object.freeze({ key: 'rename', label: 'Renombrar carpeta' }),
  Object.freeze({ key: 'delete', label: 'Borrar carpeta' }),
]);

let formSeq = 0;

// Crea un elemento. Los textos entran como nodos de texto, nunca como HTML.
function el(tag, attrs = {}, ...children) {
  const doc = globalThis.document;
  const node = doc.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    node.setAttribute(name, value === true ? '' : String(value));
  }
  // Los hijos pueden llegar en listas (p. ej. map()): se aplanan antes de añadirlos.
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(typeof child === 'object' ? child : doc.createTextNode(String(child)));
  }
  return node;
}

// Campo con etiqueta visible, ayuda y error (DESIGN C-11). El error se enlaza con aria-describedby.
function createField(prefix, key, label, help = '', inputMode = 'text') {
  const id = `${prefix}${key}`;
  const helpId = `${id}-ayuda`;
  const errorId = `${id}-error`;
  const input = el('input', {
    id,
    type: 'text',
    class: 'c-campo-entrada',
    inputmode: inputMode,
    autocomplete: 'off',
    autocapitalize: 'off',
    autocorrect: 'off',
    spellcheck: 'false',
  });
  const errorText = el('span', { class: 'c-campo-error-texto' });
  const errorEl = el('p', { id: errorId, class: 'c-campo-error', hidden: true },
    el('span', { class: 'c-campo-error-icono', 'aria-hidden': 'true' }, '!'),
    errorText);
  const wrapper = el('div', { class: 'c-campo' },
    el('label', { class: 'c-campo-etiqueta', for: id }, label),
    input,
    help ? el('p', { id: helpId, class: 'c-campo-ayuda' }, help) : null,
    errorEl);
  return { key, input, wrapper, errorEl, errorText, helpId, errorId, hasHelp: Boolean(help), touched: false };
}

// Muestra u oculta el error de un campo. Solo se marca como no válido mientras hay un motivo.
function setFieldError(field, message) {
  if (message) {
    field.errorText.textContent = message;
    field.errorEl.hidden = false;
    field.input.setAttribute('aria-invalid', 'true');
    field.input.classList.add('c-campo-entrada--error');
    field.input.setAttribute('aria-describedby', [field.hasHelp ? field.helpId : '', field.errorId].filter(Boolean).join(' '));
    return;
  }
  field.errorText.textContent = '';
  field.errorEl.hidden = true;
  field.input.removeAttribute('aria-invalid');
  field.input.classList.remove('c-campo-entrada--error');
  if (field.hasHelp) field.input.setAttribute('aria-describedby', field.helpId);
  else field.input.removeAttribute('aria-describedby');
}

// Abre la hoja «Gestionar la biblioteca». Resuelve con la última URL de incidencia abierta, o null.
// options.option elige la opción inicial (add-url, publish, edit o folders); options.songId rellena la canción.
export async function openIncidentSheet(services, options = {}) {
  // Carga perezosa del marco: openDialog da el foco atrapado, Escape y la devolución del foco.
  const { openDialog } = await import('./shell.js');
  return openDialog({
    title: 'Gestionar la biblioteca',
    className: 'c-biblioteca-hoja',
    cancelValue: null,
    render: (body, close) => renderIncidentForm(body, close, services, options),
    initialFocus: (dialog) => dialog.querySelector('.c-hoja-opciones input:checked'),
  });
}

// Rellena el cuerpo de la hoja. Cada opción tiene su formulario; solo se muestra el activo.
function renderIncidentForm(body, close, services, options) {
  const songs = Array.isArray(services?.catalog?.songs) ? services.catalog.songs : [];
  const findSong = (songId) => songs.find((song) => song && song.id === songId) ?? null;
  const prefix = `c-biblioteca-inc-${++formSeq}-`;
  const optionKeys = OPTIONS.map((option) => option.key);
  let active = optionKeys.includes(options.option) ? options.option : 'add-url';
  let published = true;
  let folderAction = 'create';
  let prefilledSongId = null;
  let issueUrl = null;

  // ----- Formulario «Añadir audio por URL»
  const urlField = createField(prefix, 'url', 'Dirección del audio (URL)',
    'Internet Archive: archive.org/details/<identificador>. Enlace directo a un fichero de audio con licencia: mp3, flac, ogg, opus, m4a o wav.');
  const licenseField = createField(prefix, 'licencia', 'Licencia de uso',
    'Obligatoria en un fichero directo. Escríbela tal como figura en la fuente, por ejemplo CC BY 4.0.');
  const importTitleField = createField(prefix, 'titulo-url', 'Título (opcional)',
    'Si lo dejas vacío, se usa el título del ítem.');

  // ----- Formulario «Publicar o despublicar»
  const publishSongField = createField(prefix, 'publicar-id', 'Identificador de la canción',
    'S seguida de 16 caracteres hexadecimales (0 a 9 y a a f).');
  const publishHint = el('p', { class: 'c-hoja-pista', 'aria-live': 'polite' });
  const switchLabel = el('span', { id: `${prefix}publicada-etiqueta`, class: 'c-interruptor-etiqueta' }, 'Publicada en la web');
  const switchState = el('span', { id: `${prefix}publicada-estado`, class: 'c-interruptor-estado' }, 'Activado');
  const switchButton = el('button', {
    type: 'button',
    role: 'switch',
    class: 'c-interruptor',
    'aria-checked': 'true',
    'aria-labelledby': `${prefix}publicada-etiqueta`,
    'aria-describedby': `${prefix}publicada-estado`,
  }, el('span', { class: 'c-interruptor-pista', 'aria-hidden': 'true' }, el('span', { class: 'c-interruptor-pulgar' })));
  switchButton.addEventListener('click', () => {
    published = !published;
    switchButton.setAttribute('aria-checked', String(published));
    switchState.textContent = published ? 'Activado' : 'Desactivado';
    refresh();
  });
  const switchRow = el('div', { class: 'c-interruptor-fila' }, switchLabel, switchButton, switchState);
  const switchHelp = el('p', { class: 'c-campo-ayuda' }, 'Activado: la canción aparece en la web pública. Desactivado: se retira de la web.');

  // ----- Formulario «Editar datos»
  const editSongField = createField(prefix, 'editar-id', 'Identificador de la canción',
    'S seguida de 16 caracteres hexadecimales (0 a 9 y a a f).');
  const editHint = el('p', { class: 'c-hoja-pista', 'aria-live': 'polite' });
  const editTitleField = createField(prefix, 'editar-titulo', 'Título', 'Obligatorio. Máximo 200 caracteres.');
  const editArtistField = createField(prefix, 'editar-artista', 'Artista', 'Opcional. Déjalo vacío para quitarlo. Máximo 200 caracteres.');
  const editYearField = createField(prefix, 'editar-anio', 'Año', 'Entre 1000 y 2100. Déjalo vacío para quitarlo.', 'numeric');
  const editTagsField = createField(prefix, 'editar-etiquetas', 'Etiquetas',
    'Separadas por comas. Hasta 20, de 40 caracteres cada una.');
  const editFolderField = createField(prefix, 'editar-carpeta', 'Carpeta',
    '10 caracteres hexadecimales (0 a 9 y a a f). Déjalo vacío para quitar la carpeta.');

  // ----- Formulario «Carpetas»
  const folderActionRadios = FOLDER_ACTIONS.map((item) => {
    const input = el('input', { type: 'radio', name: `${prefix}accion-carpeta`, value: item.key, id: `${prefix}carpeta-${item.key}` });
    input.checked = item.key === folderAction;
    input.addEventListener('change', () => {
      if (input.checked) {
        folderAction = item.key;
        refresh();
      }
    });
    return el('label', { class: 'c-hoja-opcion', for: input.id }, input, el('span', {}, item.label));
  });
  const folderNameField = createField(prefix, 'carpeta-nombre', 'Nombre de la carpeta', 'Hasta 80 caracteres.');
  const folderIdField = createField(prefix, 'carpeta-id', 'Identificador de la carpeta', '10 caracteres hexadecimales (0 a 9 y a a f).');

  // Cada formulario de canción tiene su campo y su pista. Al reconocer una canción del catálogo, la ficha de
  // edición se rellena una sola vez con sus datos actuales (después, lo que escriba la persona manda).
  function syncSong() {
    const publishCheck = checkSongIdInput(publishSongField.input.value);
    const publishSong = publishCheck.value ? findSong(publishCheck.value) : null;
    publishHint.textContent = songHint(publishCheck.value, publishSong, 'publish');
    const editCheck = checkSongIdInput(editSongField.input.value);
    const editSong = editCheck.value ? findSong(editCheck.value) : null;
    editHint.textContent = songHint(editCheck.value, editSong, 'edit');
    if (active === 'edit' && editSong && prefilledSongId !== editSong.id) {
      prefilledSongId = editSong.id;
      fillEditFields(editSong);
    }
  }

  function fillEditFields(song) {
    editSongField.input.value = song.id;
    editTitleField.input.value = cleanText(song.title);
    editArtistField.input.value = cleanText(song.artist);
    editYearField.input.value = song.year === null || song.year === undefined ? '' : String(song.year);
    editTagsField.input.value = normalizeTags(song.tags).join(', ');
    editFolderField.input.value = song.folder_id ?? '';
    for (const field of [editTitleField, editArtistField, editYearField, editTagsField, editFolderField]) field.touched = false;
  }

  // Lo que muestra la pista de cada formulario de canción.
  function songHint(songId, song, kind) {
    if (song) {
      return kind === 'publish'
        ? `Canción: «${song.title}».`
        : 'Cambia solo lo que quieras corregir. Los campos muestran los datos actuales de la canción.';
    }
    if (!songId) return '';
    return kind === 'publish'
      ? 'Esta canción no aparece en el catálogo público de la web.'
      : 'Esta canción no aparece en el catálogo público. Escribe los datos que quieres enviar.';
  }

  // Cada formulario: sus campos, cómo se leen, cómo se evalúan y cuáles se muestran.
  const forms = {
    'add-url': {
      fields: { url: urlField, license: licenseField, title: importTitleField },
      read: () => ({ url: urlField.input.value, license: licenseField.input.value, title: importTitleField.input.value }),
      evaluate: (raw) => evaluateImportForm(raw),
      shown: (key, raw) => key !== 'license' || classifyUrl(cleanText(raw.url)) === 'direct',
    },
    publish: {
      fields: { songId: publishSongField },
      read: () => ({ songId: publishSongField.input.value, published }),
      evaluate: (raw) => evaluatePublishForm(raw),
      shown: () => true,
    },
    edit: {
      fields: {
        songId: editSongField, title: editTitleField, artist: editArtistField,
        year: editYearField, tags: editTagsField, folderId: editFolderField,
      },
      read: () => ({
        songId: editSongField.input.value,
        title: editTitleField.input.value,
        artist: editArtistField.input.value,
        year: editYearField.input.value,
        tags: editTagsField.input.value,
        folderId: editFolderField.input.value,
      }),
      evaluate: (raw) => {
        const check = checkSongIdInput(raw.songId);
        return evaluateEditForm({ ...raw, baseline: check.value ? findSong(check.value) : null });
      },
      shown: () => true,
    },
    folders: {
      fields: { name: folderNameField, folderId: folderIdField },
      read: () => ({ action: folderAction, name: folderNameField.input.value, folderId: folderIdField.input.value }),
      evaluate: (raw) => evaluateFolderForm(raw),
      shown: (key, raw) => (key === 'name' ? raw.action !== 'delete' : raw.action !== 'create'),
    },
  };

  // Secciones, una por opción. Solo la activa se ve; el formulario de añadir por URL tiene el testid de la tabla.
  const sections = {
    'add-url': el('div', { class: 'c-hoja-formulario', 'data-testid': 'c-biblioteca-add-url' },
      urlField.wrapper, licenseField.wrapper, importTitleField.wrapper),
    publish: el('div', { class: 'c-hoja-formulario' }, publishSongField.wrapper, publishHint, switchRow, switchHelp),
    edit: el('div', { class: 'c-hoja-formulario' }, editSongField.wrapper, editHint, editTitleField.wrapper,
      editArtistField.wrapper, editYearField.wrapper, editTagsField.wrapper, editFolderField.wrapper),
    folders: el('div', { class: 'c-hoja-formulario' },
      el('fieldset', { class: 'c-hoja-opciones c-hoja-opciones--carpeta' },
        el('legend', { class: 'c-hoja-leyenda' }, '¿Qué quieres hacer con las carpetas?'), ...folderActionRadios),
      folderNameField.wrapper, folderIdField.wrapper),
  };

  // Opciones principales: botones de radio nativos (las flechas los recorren).
  const optionInputs = OPTIONS.map((option) => {
    const input = el('input', { type: 'radio', name: `${prefix}opcion`, value: option.key, id: `${prefix}op-${option.key}` });
    input.checked = option.key === active;
    input.addEventListener('change', () => {
      if (input.checked) setOption(option.key);
    });
    return el('label', { class: 'c-hoja-opcion', for: input.id }, input, el('span', {}, option.label));
  });

  const statusEl = el('p', { id: `${prefix}estado`, class: 'c-hoja-estado', role: 'status', 'aria-live': 'polite' });
  const link = el('a', {
    class: 'c-biblioteca-boton c-biblioteca-boton--primario c-hoja-enlace',
    'data-testid': 'c-biblioteca-incident',
    target: '_blank',
    rel: 'noopener noreferrer',
    'aria-disabled': 'true',
  }, 'Abrir incidencia en GitHub', el('span', { class: 'visually-hidden' }, ' (se abre en otra pestaña)'));
  // Sin petición válida no hay enlace: el atributo href se quita y el clic se cancela.
  link.addEventListener('click', (event) => {
    if (link.getAttribute('aria-disabled') === 'true' || !link.getAttribute('href')) {
      event.preventDefault();
      focusFirstError();
      return;
    }
    issueUrl = link.getAttribute('href');
  });
  const closeButton = el('button', { type: 'button', class: 'c-biblioteca-boton c-biblioteca-boton--secundario' }, 'Cerrar');
  closeButton.addEventListener('click', () => close(issueUrl));

  body.append(
    el('p', { class: 'c-hoja-intro' }, 'Se abrirá GitHub para que confirmes la incidencia. Solo el propietario la procesa.'),
    el('fieldset', { class: 'c-hoja-opciones' }, el('legend', { class: 'c-hoja-leyenda' }, '¿Qué quieres hacer?'), ...optionInputs),
    ...Object.values(sections),
    statusEl,
    el('div', { class: 'c-hoja-pie' }, link, closeButton),
  );

  // Campos de canción prellenados por el disparador (la biblioteca pasa la canción seleccionada).
  const initialSong = normalizeSongId(options.songId ?? '');
  if (isSongId(initialSong)) {
    publishSongField.input.value = initialSong;
    editSongField.input.value = initialSong;
  }

  // Errores de campo: se muestran una vez tocado el campo o cuando ya tiene texto.
  function markErrors(form, raw, errors) {
    let any = false;
    for (const [key, field] of Object.entries(form.fields)) {
      const shown = form.shown(key, raw);
      field.wrapper.hidden = !shown;
      const filled = String(field.input.value ?? '').trim() !== '';
      const message = shown && errors[key] && (field.touched || filled) ? errors[key] : null;
      setFieldError(field, message);
      if (message) any = true;
    }
    return any;
  }

  function focusFirstError() {
    const form = forms[active];
    for (const field of Object.values(form.fields)) {
      if (!field.errorEl.hidden) {
        field.input.focus();
        return;
      }
    }
  }

  // Actualiza el enlace y el estado: el enlace solo existe si la petición es válida.
  function updateLink(request) {
    if (!request) {
      link.removeAttribute('href');
      link.setAttribute('aria-disabled', 'true');
      return null;
    }
    try {
      const href = buildIssueUrl(buildIssueTitle(request), buildIssueBody(request));
      link.setAttribute('href', href);
      link.setAttribute('aria-disabled', 'false');
      return null;
    } catch (error) {
      link.removeAttribute('href');
      link.setAttribute('aria-disabled', 'true');
      return error instanceof Error ? error.message : MESSAGES.requestInvalid;
    }
  }

  function refresh() {
    syncSong();
    const form = forms[active];
    const raw = form.read();
    const result = form.evaluate(raw);
    const anyShown = markErrors(form, raw, result.errors);
    const hasErrors = Object.keys(result.errors).length > 0;
    const linkProblem = updateLink(result.request);
    if (linkProblem) {
      statusEl.textContent = linkProblem;
      return;
    }
    if (result.request) statusEl.textContent = MESSAGES.readyStatus;
    else if (result.status) statusEl.textContent = result.status;
    else if (hasErrors && anyShown) statusEl.textContent = MESSAGES.fixStatus;
    else statusEl.textContent = MESSAGES.startStatus;
  }

  function setOption(key) {
    active = key;
    for (const option of OPTIONS) sections[option.key].hidden = option.key !== key;
    refresh();
  }

  // Cada campo marca «tocado» al perder el foco y se revisa con cada cambio.
  for (const form of Object.values(forms)) {
    for (const field of Object.values(form.fields)) {
      field.input.addEventListener('input', refresh);
      field.input.addEventListener('blur', () => {
        field.touched = true;
        refresh();
      });
    }
  }
  for (const input of folderActionRadios.map((label) => label.querySelector('input'))) input.addEventListener('blur', refresh);
  for (const input of optionInputs.map((label) => label.querySelector('input'))) input.addEventListener('blur', refresh);

  for (const option of OPTIONS) sections[option.key].hidden = option.key !== active;
  refresh();
}
