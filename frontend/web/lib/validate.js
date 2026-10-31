// Validación de lo que llega de la web. Refleja backend/sonidos/sources.py (ADR-0005).
const BLOCKED = [
  "youtube.com", "youtu.be", "spotify.com", "music.apple.com", "soundcloud.com",
  "vimeo.com", "tiktok.com", "instagram.com", "facebook.com", "bandcamp.com",
];
const AUDIO_EXT = [".mp3", ".flac", ".ogg", ".opus", ".m4a", ".wav"];
const OPS = ["create_folder", "rename_folder", "delete_folder", "edit_song"];
const SONG_ID = /^S[0-9a-f]{16}$/;

function hostOf(url) {
  return new URL(url).hostname.replace(/^www\./, "");
}

function validateImport({ url, license, title }) {
  if (typeof url !== "string" || url.length < 8 || url.length > 2048) return "Escribe una dirección completa.";
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return "La dirección no es válida.";
  }
  if (!["http:", "https:"].includes(parsed.protocol)) return "La dirección debe empezar por https://";
  const host = hostOf(url);
  if (BLOCKED.some((blocked) => host === blocked || host.endsWith("." + blocked))) {
    return "Esta plataforma no se puede importar: sus condiciones de uso no permiten descargar el contenido.";
  }
  const isArchive = host === "archive.org" && /^\/(details|download)\/[^/]+/.test(parsed.pathname);
  const isDirect = AUDIO_EXT.some((ext) => parsed.pathname.toLowerCase().endsWith(ext));
  if (!isArchive && !isDirect) {
    return "Admite un ítem de Internet Archive (archive.org/details/…) o un enlace directo a un fichero de audio.";
  }
  if (isDirect && !isArchive && (typeof license !== "string" || !license.trim())) {
    return "Para un fichero directo indica la licencia de uso.";
  }
  if (license && String(license).length > 300) return "La licencia es demasiado larga.";
  if (title && String(title).length > 200) return "El título es demasiado largo.";
  return null;
}

function validateOrganize(payload) {
  if (!payload || typeof payload !== "object") return "Operación no válida.";
  if (!OPS.includes(payload.op)) return "Operación desconocida.";
  if (payload.op === "create_folder" && !String(payload.name || "").trim()) return "La carpeta necesita un nombre.";
  if (payload.op === "rename_folder" && !String(payload.name || "").trim()) return "Escribe el nuevo nombre.";
  if (payload.op !== "create_folder" && payload.op !== "edit_song" && !payload.folder_id) return "Falta la carpeta.";
  if (payload.op === "edit_song" && !SONG_ID.test(String(payload.song_id || ""))) return "Canción no válida.";
  const serialized = JSON.stringify(payload);
  if (serialized.length > 4000) return "Los datos son demasiado grandes.";
  return null;
}

module.exports = { validateImport, validateOrganize, SONG_ID };
