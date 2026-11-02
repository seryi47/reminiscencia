// Reminiscencia · contrato de peticiones de la biblioteca (lado web).
// Módulo ES sin DOM. Lo usan js/gestion.js y tests/web-unit/intake.test.mjs.
//
// Una petición es un texto con líneas "clave: valor". Claves: action, url, license, title y payload.
// La web no acepta nada que el backend rechace (backend/sonidos/issue_request.py y sources.py): si este módulo
// acepta una petición, el backend también la acepta. Las plataformas bloqueadas son las de sources.py (ADR-0005).
// Las longitudes se miden en caracteres (puntos de código), como len() en Python.

export const REPO = "seryi47/reminiscencia";
export const LABEL = "biblioteca";

export const LIMITS = Object.freeze({
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

// Igual que BLOCKED_HOSTS en backend/sonidos/sources.py (ADR-0005): plataformas de vídeo y de streaming, y los dominios
// de sus ficheros. Cada entrada bloquea también sus subdominios. Si una lista cambia, hay que cambiar la otra.
export const BLOCKED_HOSTS = Object.freeze([
  "youtube.com", "youtu.be", "youtube-nocookie.com", "googlevideo.com", "ytimg.com",
  "spotify.com", "open.spotify.com", "scdn.co", "spotifycdn.com",
  "music.apple.com", "itunes.apple.com", "mzstatic.com",
  "soundcloud.com", "sndcdn.com", "vimeo.com", "vimeocdn.com",
  "tiktok.com", "tiktokcdn.com", "instagram.com", "cdninstagram.com",
  "facebook.com", "fbcdn.net", "bandcamp.com", "bcbits.com",
  "deezer.com", "dzcdn.net", "tidal.com", "mixcloud.com", "dailymotion.com", "dmcdn.net",
  "twitch.tv", "jtvnw.net", "ttvnw.net",
]);

export const AUDIO_EXTENSIONS = Object.freeze([".mp3", ".flac", ".ogg", ".opus", ".m4a", ".wav"]);

const FOLDER_ID = /^[0-9a-f]{10}$/;
const SONG_ID = /^S[0-9a-f]{16}$/;
const HTTP_URL = /^https?:\/\//;
// Igual que IA_IDENTIFIER en sources.py: sin barras, y sin punto ni guion al principio.
const IA_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;
const IA_HOST = "archive.org";
const IA_KINDS = Object.freeze(["details", "download"]);
// Host en ASCII con puerto opcional. Lo que no encaja (IPv6, usuario, caracteres codificados) se rechaza.
const AUTHORITY = /^([A-Za-z0-9.-]+)(?::[0-9]*)?$/;
// Espacios Unicode (los que Python llama isspace) y caracteres de control: no pueden estar en una dirección.
const URL_SPACE_OR_CONTROL = /[\p{Zs}\p{Cc}\p{Zl}\p{Zp}\p{Cs}]/u;
// Caracteres que el backend rechaza en cualquier texto (issue_request.py, _has_control).
const CONTROL = /[\p{Cc}\p{Zl}\p{Zp}\p{Cs}]/u;
// Lo que Python (str.splitlines) trata como salto de línea.
const LINE_BREAK = /[\n\r\v\f\u001c-\u001e\u0085\u2028\u2029]/;
// Propietario/nombre. "." y ".." no sirven: la URL de la incidencia los resolvería como rutas.
const REPO_NAME = /^(?!\.\.?\/)[A-Za-z0-9_.-]+\/(?!\.\.?$)[A-Za-z0-9_.-]+$/;

const BLOCKED_MESSAGE = "Esta plataforma no se puede importar: sus condiciones de uso no permiten descargar el contenido. Usa un fichero de audio con licencia o un ítem de Internet Archive.";
const IA_FORM_MESSAGE = "En Internet Archive usa archive.org/details/<identificador> o archive.org/download/<identificador>.";
// Igual que el backend (sources.py, IA_FILE_SERVER_MESSAGE): un fichero de ia800100.us.archive.org no es un fichero directo.
const IA_FILE_SERVER_MESSAGE = "Un fichero de Internet Archive se importa desde la página de su ítem (archive.org/details/<identificador>), donde figura la licencia.";
const HOST_MESSAGE = "La dirección no es válida: revisa el dominio (solo letras ASCII, cifras, puntos y guiones).";
const PRIVATE_MESSAGE = "No se descarga desde una dirección de red privada, de bucle local o de enlace local.";

// Campos permitidos por operación (además de "op"). Cualquier otro campo es un error.
const OPERATIONS = Object.freeze({
  create_folder: ["name", "parent_id"],
  rename_folder: ["folder_id", "name"],
  delete_folder: ["folder_id"],
  edit_song: ["song_id", "title", "artist", "year", "tags", "folder_id", "public"],
});

const len = (text) => [...text].length;
const hasText = (value) => typeof value === "string" && value.trim() !== "";
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
// Espacios que Python quita con str.strip() (los de str.isspace). No incluye U+FEFF, que trim() sí quita.
function isPySpace(char) {
  const code = char.charCodeAt(0);
  return (code >= 0x09 && code <= 0x0d) || code === 0x20 || (code >= 0x1c && code <= 0x1f) || code === 0x85 || code === 0xa0
    || code === 0x1680 || (code >= 0x2000 && code <= 0x200a) || code === 0x2028 || code === 0x2029 || code === 0x202f
    || code === 0x205f || code === 0x3000;
}
// Longitud de una etiqueta como la mide el backend (_tags): sin espacios de los extremos y en minúsculas. Se recorre desde
// los extremos: una expresión regular con $ sobre una cadena de espacios interiores tarda en cuadrático.
function tagLength(tag) {
  let start = 0;
  let end = tag.length;
  while (start < end && isPySpace(tag[start])) start += 1;
  while (end > start && isPySpace(tag[end - 1])) end -= 1;
  return len(tag.slice(start, end).toLowerCase());
}

export const isFolderId = (value) => typeof value === "string" && FOLDER_ID.test(value);
export const isSongId = (value) => typeof value === "string" && SONG_ID.test(value);

// Canciones que la sección muestra y cuenta: publicadas (ADR-0008) y con un identificador de canción válido.
export const selectableSongs = (songs) => songs.filter((song) => song && song.public === true && isSongId(song.id));

// JSON en una sola línea. JSON.stringify escapa los saltos de línea, pero no U+0085, U+2028 ni U+2029,
// que Python también trata como saltos: se escapan para que la línea de "payload" siga siendo única.
const jsonLine = (value) =>
  JSON.stringify(value).replace(/[\u0085\u2028\u2029]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);

function requestText(text) {
  if (len(text) > LIMITS.request) throw new Error(`La petición no puede tener más de ${LIMITS.request} caracteres.`);
  return text;
}

// ---------- importación por URL ----------

// Texto de la dirección tras el esquema, partido como urlsplit de Python: host y ruta, sin normalizar nada.
function splitUrl(url) {
  const rest = url.replace(HTTP_URL, "");
  const cut = rest.search(/[/?#]/);
  const authority = cut === -1 ? rest : rest.slice(0, cut);
  const tail = cut === -1 ? "" : rest.slice(cut);
  const end = tail.search(/[?#]/);
  return { authority, path: end === -1 ? tail : tail.slice(0, end) };
}

// Ruta sin parámetros, como urlparse(url).path del backend: el primer ";" del último segmento empieza los parámetros.
function pathWithoutParams(path) {
  const semicolon = path.indexOf(";", Math.max(path.lastIndexOf("/"), 0));
  return semicolon === -1 ? path : path.slice(0, semicolon);
}

// Host en minúsculas como lo canoniza el backend (canonical_host): sin punto final ni "www.".
// Devuelve null si el host no tiene la forma que el backend acepta: vacío, con etiquetas vacías
// (solo se admite una al final, el punto final) o de 64 caracteres o más.
function canonicalHost(authority) {
  const match = AUTHORITY.exec(authority);
  if (!match) return null;
  const host = match[1].toLowerCase();
  const labels = host.split(".");
  const last = labels.length - 1;
  const malformed = labels.some((label, index) => label.length > 63 || (label === "" && index < last));
  if (malformed) return null;
  const bare = host.endsWith(".") ? host.slice(0, -1) : host;
  return bare.startsWith("www.") ? bare.slice(4) : bare;
}

const isBlockedHost = (host) => BLOCKED_HOSTS.some((blocked) => host === blocked || host.endsWith(`.${blocked}`));

// Ruta de un ítem de Internet Archive: exactamente /details/<identificador> o /download/<identificador>.
// Las barras al principio y al final no cuentan, como strip("/") en el backend.
function isIaItemPath(path) {
  const parts = path.replace(/^\/+|\/+$/g, "").split("/");
  return parts.length === 2 && IA_KINDS.includes(parts[0]) && IA_IDENTIFIER.test(parts[1]);
}

// Rangos IPv4 que Python (ipaddress, is_global) no considera globales: privados, de bucle local, de enlace local, de
// metadatos, reservados y de CGNAT (100.64.0.0/10). Son los que el backend rechaza al descargar (_check_public_host).
const NON_GLOBAL_IPV4 = Object.freeze([
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["240.0.0.0", 4], ["255.255.255.255", 32],
]);
// Dentro de 192.0.0.0/24, Python las considera globales.
const GLOBAL_IPV4_EXCEPTIONS = Object.freeze(["192.0.0.9", "192.0.0.10"]);
// IPv4 con cuatro decimales y sin ceros a la izquierda: la única forma que Python acepta como dirección IP.
const IPV4_DOTTED = /^(?:25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])(?:\.(?:25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])){3}$/;
// Último segmento numérico, decimal o hexadecimal: una IP escrita de otra forma (127.1, 2130706433, 0x7f000001).
const NUMERIC_LABEL = /^(?:[0-9]+|0x[0-9a-f]*)$/;

const ipv4Value = (text) => text.split(".").reduce((value, octet) => value * 256 + Number(octet), 0);
const inIpv4Range = (value, [base, prefix]) => value >= ipv4Value(base) && value < ipv4Value(base) + 2 ** (32 - prefix);
// Igual que is_global de ipaddress.IPv4Address, para una dirección que ya cumple IPV4_DOTTED.
function isGlobalIpv4(text) {
  const value = ipv4Value(text);
  if (GLOBAL_IPV4_EXCEPTIONS.some((exception) => ipv4Value(exception) === value)) return true;
  return !NON_GLOBAL_IPV4.some((range) => inIpv4Range(value, range));
}

// Clasifica un host ya canonizado: "public", "private" (localhost o una IPv4 no global) o "invalid" (una forma numérica que
// no es una IPv4 canónica, o un nombre de una sola etiqueta). Solo se decide lo que se sabe sin DNS: el backend además mira a
// qué IP resuelve cada nombre (_check_public_host).
function hostKind(host) {
  if (host === "localhost" || host.endsWith(".localhost")) return "private";
  if (IPV4_DOTTED.test(host)) return isGlobalIpv4(host) ? "public" : "private";
  const labels = host.split(".");
  if (NUMERIC_LABEL.test(labels[labels.length - 1])) return "invalid";
  return labels.length > 1 ? "public" : "invalid";
}

// "blocked", "archive", "archive-path", "archive-file", "direct", "private", "other" o "invalid". Sigue el orden de
// sources.classify: primero las plataformas, después Internet Archive (un ítem no admite parámetros en la ruta, aunque el
// backend los ignore), después la extensión de audio, leída sin los parámetros de la ruta, y por último el host.
function classify(url) {
  const { authority, path } = splitUrl(url);
  const host = canonicalHost(authority);
  if (host === null) return "invalid";
  if (isBlockedHost(host)) return "blocked";
  if (host === IA_HOST) return isIaItemPath(path) ? "archive" : "archive-path";
  if (host.endsWith(`.${IA_HOST}`)) return "archive-file";
  const lower = pathWithoutParams(path).toLowerCase();
  if (!AUDIO_EXTENSIONS.some((ext) => lower.endsWith(ext))) return "other";
  const kind = hostKind(host);
  return kind === "public" ? "direct" : kind;
}

// Verdadero si la dirección apunta a un fichero de audio directo, que exige licencia.
export function needsLicense(url) {
  return typeof url === "string" && HTTP_URL.test(url) && classify(url) === "direct";
}

// Texto de una sola línea. Con required, no puede quedar en blanco.
function checkText(value, { name, max, required = false, measure = len }) {
  if (typeof value !== "string") return `${name} debe ser texto.`;
  if (CONTROL.test(value)) return `${name} no puede tener saltos de línea ni caracteres de control.`;
  if (required && value.trim() === "") return `${name} no puede quedar en blanco.`;
  if (measure(value) > max) return `${name} no puede tener más de ${max} caracteres.`;
  return null;
}

// Devuelve el motivo en español si la petición no es válida, o null si lo es.
export function validateImport({ url, license, title } = {}) {
  if (typeof url !== "string" || url === "") return "Escribe la dirección del audio.";
  if (len(url) > LIMITS.url) return `La dirección no puede tener más de ${LIMITS.url} caracteres.`;
  if (URL_SPACE_OR_CONTROL.test(url)) return "La dirección no puede tener espacios ni caracteres de control.";
  if (!HTTP_URL.test(url)) return "La dirección debe empezar por https:// (o http://).";
  const kind = classify(url);
  if (kind === "invalid") return HOST_MESSAGE;
  if (kind === "blocked") return BLOCKED_MESSAGE;
  if (kind === "archive-path") return IA_FORM_MESSAGE;
  if (kind === "archive-file") return IA_FILE_SERVER_MESSAGE;
  if (kind === "private") return PRIVATE_MESSAGE;
  if (kind === "other") {
    return "Admite un ítem de Internet Archive (archive.org/details/…) o un enlace directo a un fichero de audio (mp3, flac, ogg, opus, m4a o wav).";
  }
  if (license !== undefined && license !== null) {
    const problem = checkText(license, { name: "La licencia", max: LIMITS.license });
    if (problem) return problem;
  }
  if (kind === "direct" && !hasText(license)) return "Para un fichero directo indica la licencia de uso.";
  if (title !== undefined && title !== null) {
    const problem = checkText(title, { name: "El título", max: LIMITS.title });
    if (problem) return problem;
  }
  return null;
}

// Texto de una petición de importación: líneas action, url y, si las hay, license y title.
export function buildImportBody({ url, license, title } = {}) {
  const problem = validateImport({ url, license, title });
  if (problem) throw new Error(problem);
  const lines = ["action: import", `url: ${url}`];
  if (hasText(license)) lines.push(`license: ${license.trim()}`);
  if (hasText(title)) lines.push(`title: ${title.trim()}`);
  return requestText(lines.join("\n"));
}

// ---------- operaciones sobre el catálogo ----------

// Etiquetas como las guarda el catálogo: en minúsculas, sin vacías ni repetidas.
export function normalizeTags(value) {
  const items = typeof value === "string" ? value.split(",") : Array.isArray(value) ? value : [];
  const seen = new Set();
  const tags = [];
  for (const item of items) {
    const tag = String(item ?? "").trim().toLowerCase();
    if (tag !== "" && !seen.has(tag)) {
      seen.add(tag);
      tags.push(tag);
    }
  }
  return tags;
}

const checkFolderName = (value) => checkText(value, { name: "El nombre de la carpeta", max: LIMITS.folderName, required: true });

function checkFolderRef(value) {
  if (value === undefined) return "Falta la carpeta.";
  return isFolderId(value) ? null : "El identificador de la carpeta no es válido.";
}

function checkParentRef(value) {
  if (value === undefined) return "Falta la carpeta padre (parent_id; null si va en la raíz).";
  return value === null || isFolderId(value) ? null : "La carpeta padre no es válida.";
}

function checkSongRef(value) {
  if (value === undefined) return "Falta la canción.";
  return isSongId(value) ? null : "El identificador de la canción no es válido.";
}

function checkEditFields(data) {
  if (data.title !== undefined) {
    const problem = checkText(data.title, { name: "El título", max: LIMITS.title, required: true });
    if (problem) return problem;
  }
  if (data.artist !== undefined) {
    const problem = checkText(data.artist, { name: "El artista", max: LIMITS.artist });
    if (problem) return problem;
  }
  if (data.year !== undefined && data.year !== null) {
    const valid = Number.isInteger(data.year) && data.year >= LIMITS.yearMin && data.year <= LIMITS.yearMax;
    if (!valid) return `El año debe ser un número entero entre ${LIMITS.yearMin} y ${LIMITS.yearMax}, o null.`;
  }
  if (data.tags !== undefined) {
    if (!Array.isArray(data.tags)) return "Las etiquetas deben ser una lista.";
    if (data.tags.length > LIMITS.tags) return `No puede haber más de ${LIMITS.tags} etiquetas.`;
    for (const tag of data.tags) {
      const problem = checkText(tag, { name: "Cada etiqueta", max: LIMITS.tag, required: true, measure: tagLength });
      if (problem) return problem;
    }
  }
  if (data.folder_id !== undefined && data.folder_id !== null && !isFolderId(data.folder_id)) {
    return "El identificador de la carpeta no es válido.";
  }
  if (data.public !== undefined && typeof data.public !== "boolean") return "El campo «public» debe ser true o false.";
  return null;
}

// Una canción se edita con al menos un campo que cambiar: sin ninguno, el backend rechaza la petición.
const checkSomeChange = (data) =>
  Object.keys(data).some((key) => key !== "op" && key !== "song_id" && data[key] !== undefined)
    ? null
    : "Indica al menos un campo que cambiar en la canción.";

function checkOperation(data) {
  switch (data.op) {
    case "create_folder":
      return checkFolderName(data.name) ?? checkParentRef(data.parent_id);
    case "rename_folder":
      return checkFolderRef(data.folder_id) ?? checkFolderName(data.name);
    case "delete_folder":
      return checkFolderRef(data.folder_id);
    default:
      return checkSongRef(data.song_id) ?? checkEditFields(data) ?? checkSomeChange(data);
  }
}

// Devuelve el motivo en español si el payload no es válido, o null. Acepta el objeto o su texto JSON. Con texto se aplican
// las mismas reglas, pero buildOrganizeBody envía siempre la forma normalizada (JSON.stringify): claves repetidas o números
// como 1E3 pueden pasar aquí y no llegan al backend tal como se escribieron.
export function validatePayload(payload) {
  let data = payload;
  if (typeof payload === "string") {
    if (len(payload) > LIMITS.payload) return `Los datos no pueden tener más de ${LIMITS.payload} caracteres.`;
    if (LINE_BREAK.test(payload)) return "Los datos deben ocupar una sola línea.";
    if (CONTROL.test(payload)) return "Los datos no pueden tener caracteres de control.";
    try {
      data = JSON.parse(payload);
    } catch {
      return "Los datos no son JSON válido.";
    }
  }
  if (!isObject(data)) return "Los datos deben ser un objeto JSON.";
  if (data.op === undefined) return "Falta la operación (op).";
  const fields = Object.keys(OPERATIONS).includes(data.op) ? OPERATIONS[data.op] : null;
  if (!fields) return "Operación desconocida.";
  for (const key of Object.keys(data)) {
    if (key !== "op" && data[key] !== undefined && !fields.includes(key)) {
      return `El campo «${key}» no está permitido en esta operación.`;
    }
  }
  const problem = checkOperation(data);
  if (problem) return problem;
  let text;
  try {
    text = jsonLine(data);
  } catch {
    return "Los datos no se pueden convertir a JSON.";
  }
  return len(text) > LIMITS.payload ? `Los datos no pueden tener más de ${LIMITS.payload} caracteres.` : null;
}

// Texto de una petición de organización: una línea "action: organize" y otra "payload: <JSON en una línea>".
export function buildOrganizeBody(payload) {
  const problem = validatePayload(payload);
  if (problem) throw new Error(problem);
  const data = typeof payload === "string" ? JSON.parse(payload) : payload;
  return requestText(`action: organize\npayload: ${jsonLine(data)}`);
}

// ---------- incidencia de GitHub ----------

// Título corto de la incidencia: una línea, como mucho 120 caracteres.
export function buildIssueTitle(text) {
  const clean = String(text ?? "").replace(/[\s\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, " ").trim();
  if (clean === "") return "Petición de la biblioteca";
  const chars = [...clean];
  if (chars.length <= LIMITS.issueTitle) return clean;
  return `${chars.slice(0, LIMITS.issueTitle - 1).join("")}…`;
}

// Enlace para abrir una incidencia nueva con la etiqueta "biblioteca" y el texto ya escrito.
export function buildIssueUrl(body, title, repo = REPO) {
  if (!REPO_NAME.test(repo)) throw new Error("El repositorio debe tener la forma propietario/nombre.");
  const issueTitle = encodeURIComponent(buildIssueTitle(title));
  const issueBody = encodeURIComponent(String(body ?? ""));
  return `https://github.com/${repo}/issues/new?labels=${encodeURIComponent(LABEL)}&title=${issueTitle}&body=${issueBody}`;
}
