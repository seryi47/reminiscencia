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

// Igual que BLOCKED_HOSTS en backend/sonidos/sources.py. Cada entrada bloquea también sus subdominios.
export const BLOCKED_HOSTS = Object.freeze([
  "youtube.com", "youtu.be", "spotify.com", "open.spotify.com", "music.apple.com",
  "soundcloud.com", "vimeo.com", "tiktok.com", "instagram.com", "facebook.com", "bandcamp.com",
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
const REPO_NAME = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

const BLOCKED_MESSAGE = "Esta plataforma no se puede importar: sus condiciones de uso no permiten descargar el contenido. Usa un fichero de audio con licencia o un ítem de Internet Archive.";
const IA_FORM_MESSAGE = "En Internet Archive usa archive.org/details/<identificador> o archive.org/download/<identificador>.";
const HOST_MESSAGE = "La dirección no es válida: revisa el dominio (solo letras ASCII, cifras, puntos y guiones).";

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

export const isFolderId = (value) => typeof value === "string" && FOLDER_ID.test(value);
export const isSongId = (value) => typeof value === "string" && SONG_ID.test(value);

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

// "blocked", "archive", "archive-path", "direct", "other" o "invalid". Sigue el orden de sources.classify:
// primero las plataformas, después Internet Archive y por último la extensión de audio.
function classify(url) {
  const { authority, path } = splitUrl(url);
  const host = canonicalHost(authority);
  if (host === null) return "invalid";
  if (isBlockedHost(host)) return "blocked";
  if (host === IA_HOST) return isIaItemPath(path) ? "archive" : "archive-path";
  const lower = path.toLowerCase();
  return AUDIO_EXTENSIONS.some((ext) => lower.endsWith(ext)) ? "direct" : "other";
}

// Verdadero si la dirección apunta a un fichero de audio directo, que exige licencia.
export function needsLicense(url) {
  return typeof url === "string" && HTTP_URL.test(url) && classify(url) === "direct";
}

// Texto de una sola línea. Con required, no puede quedar en blanco.
function checkText(value, { name, max, required = false }) {
  if (typeof value !== "string") return `${name} debe ser texto.`;
  if (CONTROL.test(value)) return `${name} no puede tener saltos de línea ni caracteres de control.`;
  if (required && value.trim() === "") return `${name} no puede quedar en blanco.`;
  if (len(value) > max) return `${name} no puede tener más de ${max} caracteres.`;
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
      const problem = checkText(tag, { name: "Cada etiqueta", max: LIMITS.tag, required: true });
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

// Devuelve el motivo en español si el payload no es válido, o null. Acepta el objeto o su texto JSON.
export function validatePayload(payload) {
  let data = payload;
  if (typeof payload === "string") {
    if (len(payload) > LIMITS.payload) return `Los datos no pueden tener más de ${LIMITS.payload} caracteres.`;
    if (LINE_BREAK.test(payload)) return "Los datos deben ocupar una sola línea.";
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
