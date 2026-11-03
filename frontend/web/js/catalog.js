// Lógica pura de la biblioteca: lectura del catálogo público (data/songs.json y data/folders.json), álbumes (las
// carpetas del catálogo, que la interfaz llama «Álbumes»), portadas, búsqueda, saludo según la hora, duraciones y
// colores de portada. No usa el DOM ni APIs del navegador, así que se
// prueba en Node (tests/web-unit/catalog.test.mjs).

// Identificadores seguros: van en rutas (audio/<id>.opus) y en el hash de la página.
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_TEXT = 200;
// Portada publicada por el backend: "covers/<id>.jpg" (data/songs.json y data/folders.json). Cualquier otra forma se
// ignora y la portada se genera con un color y un icono.
const COVER_PATH = /^covers\/[A-Za-z0-9_-]{1,64}\.jpg$/;

/** Ruta de portada válida ("covers/<id>.jpg") o null. */
export function normalizeCoverPath(value) {
  return typeof value === 'string' && COVER_PATH.test(value) ? value : null;
}

/** Colores de portada. Todos dan un contraste de 6:1 o más con texto blanco (WCAG 1.4.3). */
export const COVER_COLORS = Object.freeze([
  '#8d2a3f', '#27467a', '#2e6b52', '#6a3fa0', '#8a4a14', '#1f6a78', '#7b2d5b', '#55601f', '#6b4232', '#3d4c8f',
]);
/** Colores fijos de las colecciones propias del navegador. */
export const LIKED_COLOR = '#4b2bd6';
export const ALL_SONGS_COLOR = '#1d5c4a';
export const LOCAL_COLOR = '#5b4636';

const cleanText = (value, fallback = '') => {
  if (typeof value !== 'string') return fallback;
  const text = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return text === '' ? fallback : Array.from(text).slice(0, MAX_TEXT).join('');
};

const finiteOrNull = (value) => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null);

/** Canción con la forma que usa la interfaz, o null si no es válida (sin id seguro o sin audio). */
export function normalizeSong(raw, index = 0) {
  if (!raw || typeof raw !== 'object') return null;
  const id = typeof raw.id === 'string' && SAFE_ID.test(raw.id) ? raw.id : null;
  const audio = typeof raw.audio === 'string' && raw.audio !== '' ? raw.audio : null;
  if (!id || !audio) return null;
  const addedAt = typeof raw.added_at === 'string' && Number.isFinite(Date.parse(raw.added_at))
    ? Date.parse(raw.added_at)
    : (Number.isFinite(raw.createdAt) ? raw.createdAt : null);
  return {
    id,
    title: cleanText(raw.title, 'Sin título'),
    artist: cleanText(raw.artist),
    year: Number.isInteger(raw.year) ? raw.year : null,
    tags: Array.isArray(raw.tags) ? raw.tags.filter((tag) => typeof tag === 'string').map((tag) => cleanText(tag)).filter(Boolean) : [],
    folderId: typeof raw.folder_id === 'string' && SAFE_ID.test(raw.folder_id) ? raw.folder_id : null,
    durationS: finiteOrNull(raw.duration_s),
    audio,
    cover: raw.local === true ? null : normalizeCoverPath(raw.cover),
    local: raw.local === true,
    // Subida para todos que todavía se está publicando (su copia local suena mientras tanto).
    pending: raw.local === true && raw.pending === true,
    addedAt,
    order: index,
  };
}

/** Álbum (carpeta del catálogo) con la forma que usa la interfaz, o null si no es válido. */
export function normalizeFolder(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = typeof raw.id === 'string' && SAFE_ID.test(raw.id) ? raw.id : null;
  if (!id) return null;
  return {
    id,
    name: cleanText(raw.name, 'Álbum sin nombre'),
    artist: cleanText(raw.artist),
    cover: normalizeCoverPath(raw.cover),
    parentId: typeof raw.parent_id === 'string' && SAFE_ID.test(raw.parent_id) && raw.parent_id !== id ? raw.parent_id : null,
  };
}

/**
 * Catálogo en memoria: canciones públicas, canciones subidas a este navegador y carpetas. Las canciones con un id
 * repetido se descartan (manda la primera) y una carpeta que apunta a una carpeta que no existe pasa a la raíz.
 */
export function buildCatalog(songs = [], folders = [], localSongs = []) {
  const songById = new Map();
  const list = [];
  const all = [...(Array.isArray(songs) ? songs : []), ...(Array.isArray(localSongs) ? localSongs : [])];
  all.forEach((raw, index) => {
    const song = normalizeSong(raw, index);
    if (song && !songById.has(song.id)) {
      songById.set(song.id, song);
      list.push(song);
    }
  });
  const folderById = new Map();
  for (const raw of Array.isArray(folders) ? folders : []) {
    const folder = normalizeFolder(raw);
    if (folder && !folderById.has(folder.id)) folderById.set(folder.id, folder);
  }
  for (const folder of folderById.values()) {
    if (folder.parentId && !folderById.has(folder.parentId)) folder.parentId = null;
  }
  for (const song of list) {
    if (song.folderId && !folderById.has(song.folderId)) song.folderId = null;
  }
  return { songs: list, folders: [...folderById.values()], songById, folderById };
}

/** Portada de una canción: la suya o, si no tiene, la de su álbum. null si no hay ninguna. */
export function songCover(catalog, song) {
  if (!song) return null;
  if (song.cover) return song.cover;
  return song.folderId ? catalog.folderById.get(song.folderId)?.cover ?? null : null;
}

/** Año de un álbum: el más repetido entre sus canciones (con empate, el más antiguo), o null. */
export function albumYear(songs) {
  const counts = new Map();
  for (const song of songs) if (Number.isInteger(song.year)) counts.set(song.year, (counts.get(song.year) ?? 0) + 1);
  let best = null;
  for (const [year, count] of counts) {
    if (best === null || count > best.count || (count === best.count && year < best.year)) best = { year, count };
  }
  return best ? best.year : null;
}

/** Canciones de una carpeta (solo las que están directamente en ella), en el orden del catálogo. */
export function songsInFolder(catalog, folderId) {
  return catalog.songs.filter((song) => song.folderId === folderId);
}

/** Subcarpetas directas de una carpeta (null: las de la raíz). */
export function childFolders(catalog, parentId = null) {
  return catalog.folders.filter((folder) => folder.parentId === parentId);
}

const newestFirst = (a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0) || a.order - b.order;

/** Canciones subidas antes solo a este navegador (ADR-0012), de la más reciente a la más antigua. */
export function localSongsOf(catalog) {
  return catalog.songs.filter((song) => song.local && !song.pending).sort(newestFirst);
}

/** Subidas para todos que se están publicando (copias locales), de la más reciente a la más antigua. */
export function pendingSongsOf(catalog) {
  return catalog.songs.filter((song) => song.pending).sort(newestFirst);
}

/**
 * «Añadidas recientemente»: primero las que tienen fecha (las subidas a este navegador o, si el catálogo la
 * publica, added_at), de la más reciente a la más antigua; después el resto en orden inverso al del catálogo.
 */
export function recentSongs(catalog, limit = 20) {
  const dated = catalog.songs.filter((song) => song.addedAt !== null).sort((a, b) => b.addedAt - a.addedAt || b.order - a.order);
  const undated = catalog.songs.filter((song) => song.addedAt === null).sort((a, b) => b.order - a.order);
  return [...dated, ...undated].slice(0, limit);
}

// ---------------------------------------------------------------------------
// Textos
// ---------------------------------------------------------------------------

/** Saludo según la hora local: de 6 a 13 «Buenos días», de 14 a 20 «Buenas tardes», el resto «Buenas noches». */
export function greetingFor(date = new Date()) {
  const hour = date.getHours();
  if (hour >= 6 && hour < 14) return 'Buenos días';
  if (hour >= 14 && hour < 21) return 'Buenas tardes';
  return 'Buenas noches';
}

/** Duración de una canción: «3:07», o «1:02:05» si pasa de una hora. Sin duración, «—». */
export function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** Duración de una colección: «1 h 5 min», «12 min 30 s» o «45 s». */
export function formatTotalDuration(seconds) {
  const total = Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds) : 0;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h} h ${m} min`;
  if (m > 0) return s > 0 ? `${m} min ${s} s` : `${m} min`;
  return `${s} s`;
}

/** «1 canción», «12 canciones». */
export function songCountText(count) {
  return count === 1 ? '1 canción' : `${count} canciones`;
}

/** Suma de las duraciones conocidas. */
export function totalDuration(songs) {
  return songs.reduce((sum, song) => sum + (song.durationS ?? 0), 0);
}

/** Tamaño del título grande de una colección según su longitud (hasta 96 px en escritorio). */
export function titleSize(text) {
  const length = Array.from(String(text ?? '')).length;
  if (length <= 14) return 'xl';
  if (length <= 24) return 'l';
  if (length <= 40) return 'm';
  return 's';
}

// ---------------------------------------------------------------------------
// Portadas
// ---------------------------------------------------------------------------

/** Hash FNV-1a de 32 bits de un texto. */
function hashText(text) {
  let hash = 0x811c9dc5;
  for (const char of String(text)) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** Color de portada estable para un identificador. */
export function coverColor(id) {
  return COVER_COLORS[hashText(id) % COVER_COLORS.length];
}

// ---------------------------------------------------------------------------
// Búsqueda
// ---------------------------------------------------------------------------

/** Texto comparable: minúsculas, sin tildes ni diéresis y con espacios simples. */
export function normalizeText(text) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// Puntuación de un texto frente a la consulta: igual, empieza por, alguna palabra empieza por, contiene.
function scoreText(text, query) {
  const value = normalizeText(text);
  if (value === '' || query === '') return 0;
  if (value === query) return 100;
  if (value.startsWith(query)) return 80;
  if (value.split(' ').some((word) => word.startsWith(query))) return 60;
  if (value.includes(query)) return 40;
  return 0;
}

function scoreSong(song, query, catalog) {
  const folderName = song.folderId ? catalog.folderById.get(song.folderId)?.name : '';
  return Math.max(
    scoreText(song.title, query),
    scoreText(song.artist, query) * 0.75,
    scoreText(folderName, query) * 0.5,
    ...song.tags.map((tag) => scoreText(tag, query) * 0.5),
    song.year !== null && String(song.year) === query ? 50 : 0,
  );
}

/**
 * Busca en canciones, álbumes (por nombre y artista) y listas propias. Devuelve { top, songs, folders, playlists }: top es el resultado
 * principal ({ kind: 'song' | 'folder' | 'playlist', item }) o null; con la misma puntuación gana una carpeta o
 * una lista sobre una canción. Sin texto, todo vacío.
 */
export function searchCatalog(catalog, rawQuery, playlists = []) {
  const query = normalizeText(rawQuery);
  if (query === '') return { query, top: null, songs: [], folders: [], playlists: [] };
  const rank = (items, score) => items
    .map((item) => ({ item, score: score(item) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);
  const songs = rank(catalog.songs, (song) => scoreSong(song, query, catalog));
  const folders = rank(catalog.folders, (folder) => Math.max(scoreText(folder.name, query), scoreText(folder.artist, query) * 0.75));
  const lists = rank(playlists, (list) => scoreText(list.name, query));
  const candidates = [
    folders[0] && { kind: 'folder', ...folders[0] },
    lists[0] && { kind: 'playlist', ...lists[0] },
    songs[0] && { kind: 'song', ...songs[0] },
  ].filter(Boolean);
  // sort es estable: con empate se conserva el orden carpeta, lista, canción.
  candidates.sort((a, b) => b.score - a.score);
  const top = candidates[0] ? { kind: candidates[0].kind, item: candidates[0].item } : null;
  return {
    query,
    top,
    songs: songs.map((entry) => entry.item),
    folders: folders.map((entry) => entry.item),
    playlists: lists.map((entry) => entry.item),
  };
}
