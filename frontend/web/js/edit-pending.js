// Ediciones pendientes de la biblioteca común (ADR-0027). Cada cambio enviado a /api/editar se guarda aquí como
// «pendiente» (con su número de incidencia), se ve al momento encima del catálogo real (sin tocarlo), se confirma
// cuando el catálogo ya lo refleja y se deshace con aviso si la incidencia acaba con la etiqueta «error» o si tarda
// demasiado. Las reglas son las de tests/contrato/ediciones-pendientes.json, las mismas que lib/pending_edits.dart.
//
// Este módulo no toca el DOM: la lógica pura y el gestor (con sus dependencias inyectadas) se prueban en node
// (tests/web-unit/edit-pending.test.mjs). Trabaja sobre los datos tal como vienen de data/songs.json y data/folders.json
// (folder_id, track, name…), antes de buildCatalog.

export const CHECK_DELAYS_S = Object.freeze([20, 30, 45, 60, 90, 120, 180]);
export const MAX_PENDING_MS = 30 * 60_000;
export const CLOSED_GRACE_MS = 10 * 60_000;
export const COVER_ASSUME_MS = 10 * 60_000;
export const STORAGE_KEY = 'reminiscencia.ediciones';
const STORAGE_VERSION = 1;
// Vista previa de una portada (data:image/jpeg;base64,…): solo se guarda si cabe holgadamente en localStorage.
export const MAX_STORED_PREVIEW_CHARS = 400_000;

export const STATES = Object.freeze({ PENDING: 'pendiente', ERROR: 'error' });
export const OUTCOMES = Object.freeze({ PENDING: 'pendiente', CONFIRMED: 'confirmada', FAILED: 'fallida' });
export const SERVER_STATES = Object.freeze(['abierta', 'cerrada', 'error']);

export const failedText = (label) => `No se ha podido guardar «${label}». Inténtalo de nuevo.`;
export const duplicateText = (label) => `Ya está pendiente: «${label}».`;
export const confirmedText = (label) => `Ya está guardado: «${label}».`;
export const TIMEOUT_REASON = 'No se ha confirmado en 30 minutos.';
export const SERVER_ERROR_REASON = 'El servidor no ha podido aplicar el cambio.';

// ---------------------------------------------------------------------------------------------
// Textos y comparación
// ---------------------------------------------------------------------------------------------

/** Texto comparable: sin espacios al principio ni al final y con espacios simples. null y undefined son ''. */
export function cleanEditText(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

/** Etiquetas como las guarda el catálogo: recortadas, en minúsculas, sin vacías ni repetidas. */
export function normalizeEditTags(items) {
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

// JSON con las claves ordenadas: la misma operación con las claves en otro orden da el mismo texto.
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

/** Clave de una edición para detectar duplicados: la operación con sus datos, o la portada con su imagen. */
export function editKey(edit) {
  if (edit?.kind === 'cover') return `cover:${edit.targetId}:${edit.preview ?? ''}`;
  return `organize:${canonical(edit?.payload ?? null)}`;
}

/** True si [a] y [b] son la misma petición (misma operación y mismos datos). */
export function isDuplicateEdit(a, b) {
  return editKey(a) === editKey(b);
}

// Edición de campos sobre una canción o un álbum: { entity, id, fields } o null.
function fieldEdit(edit) {
  const payload = edit?.payload;
  if (edit?.kind !== 'organize' || !payload) return null;
  const fields = Object.keys(payload).filter((key) => !['op', 'song_id', 'folder_id'].includes(key));
  if (payload.op === 'edit_song') {
    if ('folder_id' in payload) fields.push('folder_id');
    return { entity: 'song', id: payload.song_id, fields };
  }
  if (payload.op === 'edit_folder' || payload.op === 'rename_folder') return { entity: 'folder', id: payload.folder_id, fields };
  return null;
}

/**
 * True si [newer] deja sin efecto a [older] (pendiente): cambia todos sus campos sobre la misma canción o el mismo
 * álbum, ordena el mismo álbum o pone otra portada al mismo elemento. move_songs y create_folder nunca sustituyen.
 */
export function supersedesEdit(newer, older) {
  if (!newer || !older || older.state === STATES.ERROR) return false;
  if (newer.kind === 'cover' || older.kind === 'cover') {
    return newer.kind === 'cover' && older.kind === 'cover' && newer.targetId === older.targetId;
  }
  if (newer.payload?.op === 'order_album' || older.payload?.op === 'order_album') {
    return newer.payload?.op === 'order_album' && older.payload?.op === 'order_album' && newer.payload.folder_id === older.payload.folder_id;
  }
  const a = fieldEdit(newer);
  const b = fieldEdit(older);
  if (!a || !b || a.entity !== b.entity || a.id !== b.id) return false;
  return b.fields.every((field) => a.fields.includes(field));
}

// ---------------------------------------------------------------------------------------------
// Vista optimista
// ---------------------------------------------------------------------------------------------

const isPending = (edit) => edit && edit.state !== STATES.ERROR;

// Pone la canción en [folderId] (o la saca): al entrar recibe el número siguiente si el álbum usa números.
function moveSong(songs, song, folderId) {
  const current = song.folder_id ?? null;
  if (current === folderId) return song;
  let track = null;
  if (folderId !== null) {
    const tracks = songs.filter((item) => item.folder_id === folderId && Number.isInteger(item.track)).map((item) => item.track);
    if (tracks.length > 0) track = Math.max(...tracks) + 1;
  }
  const next = { ...song, folder_id: folderId };
  if (track === null) delete next.track;
  else next.track = track;
  return next;
}

/**
 * Catálogo con las ediciones pendientes aplicadas, en orden de envío. Devuelve copias (no cambia [songs] ni
 * [folders]) y los ids marcados como «Pendiente»: { songs, folders, songIds, folderIds }. Las fallidas no se aplican;
 * create_folder no se puede previsualizar (el id lo pone el backend); las portadas solo se marcan.
 */
export function applyPendingEdits(songs, folders, edits) {
  let songList = Array.isArray(songs) ? [...songs] : [];
  let folderList = Array.isArray(folders) ? [...folders] : [];
  const songIds = new Set();
  const folderIds = new Set();
  const songIndex = (id) => songList.findIndex((song) => song?.id === id);
  const folderIndex = (id) => folderList.findIndex((folder) => folder?.id === id);
  const replaceSong = (index, song) => { songList = songList.map((item, i) => (i === index ? song : item)); };

  for (const edit of Array.isArray(edits) ? edits : []) {
    if (!isPending(edit)) continue;
    if (edit.kind === 'cover') {
      if (songIndex(edit.targetId) >= 0) songIds.add(edit.targetId);
      else if (folderIndex(edit.targetId) >= 0) folderIds.add(edit.targetId);
      continue;
    }
    const payload = edit.payload ?? {};
    switch (payload.op) {
      case 'edit_song': {
        const index = songIndex(payload.song_id);
        if (index < 0) break;
        let song = { ...songList[index] };
        if ('title' in payload) song.title = cleanEditText(payload.title);
        if ('artist' in payload) song.artist = cleanEditText(payload.artist);
        if ('year' in payload) song.year = payload.year ?? null;
        if ('tags' in payload) song.tags = normalizeEditTags(payload.tags);
        if ('folder_id' in payload) song = moveSong(songList, song, payload.folder_id ?? null);
        replaceSong(index, song);
        songIds.add(song.id);
        break;
      }
      case 'move_songs': {
        for (const id of Array.isArray(payload.song_ids) ? payload.song_ids : []) {
          const index = songIndex(id);
          if (index < 0) continue;
          replaceSong(index, moveSong(songList, songList[index], payload.folder_id ?? null));
          songIds.add(id);
        }
        break;
      }
      case 'order_album': {
        if (folderIndex(payload.folder_id) < 0) break;
        let track = 0;
        for (const id of Array.isArray(payload.song_ids) ? payload.song_ids : []) {
          const index = songIndex(id);
          if (index < 0 || songList[index].folder_id !== payload.folder_id) continue;
          track += 1;
          replaceSong(index, { ...songList[index], track });
        }
        folderIds.add(payload.folder_id);
        break;
      }
      case 'edit_folder':
      case 'rename_folder': {
        const index = folderIndex(payload.folder_id);
        if (index < 0) break;
        const folder = { ...folderList[index] };
        if ('name' in payload) folder.name = cleanEditText(payload.name);
        if ('artist' in payload) folder.artist = cleanEditText(payload.artist);
        folderList = folderList.map((item, i) => (i === index ? folder : item));
        folderIds.add(folder.id);
        break;
      }
      default:
        break;
    }
  }
  return { songs: songList, folders: folderList, songIds, folderIds };
}

// ---------------------------------------------------------------------------------------------
// Confirmación
// ---------------------------------------------------------------------------------------------

const sameText = (a, b) => cleanEditText(a) === cleanEditText(b);

/** True si el catálogo ([songs], [folders]) ya refleja la edición, o si lo editado ya no existe (nada que esperar). */
export function isEditReflected(edit, songs, folders) {
  const songList = Array.isArray(songs) ? songs : [];
  const folderList = Array.isArray(folders) ? folders : [];
  const songById = (id) => songList.find((song) => song?.id === id) ?? null;
  const folderById = (id) => folderList.find((folder) => folder?.id === id) ?? null;
  if (edit?.kind === 'cover') {
    const target = songById(edit.targetId) ?? folderById(edit.targetId);
    if (!target) return true;
    return !edit.hadCover && typeof target.cover === 'string' && target.cover !== '';
  }
  const payload = edit?.payload ?? {};
  switch (payload.op) {
    case 'edit_song': {
      const song = songById(payload.song_id);
      if (!song) return true;
      if ('title' in payload && !sameText(song.title, payload.title)) return false;
      if ('artist' in payload && !sameText(song.artist, payload.artist)) return false;
      if ('year' in payload && (song.year ?? null) !== (payload.year ?? null)) return false;
      if ('tags' in payload && canonical(normalizeEditTags(song.tags)) !== canonical(normalizeEditTags(payload.tags))) return false;
      if ('folder_id' in payload && (song.folder_id ?? null) !== (payload.folder_id ?? null)) return false;
      return true;
    }
    case 'move_songs':
      return (payload.song_ids ?? []).every((id) => {
        const song = songById(id);
        return !song || (song.folder_id ?? null) === (payload.folder_id ?? null);
      });
    case 'order_album': {
      if (!folderById(payload.folder_id)) return true;
      const inFolder = new Map(songList.filter((song) => song?.folder_id === payload.folder_id).map((song) => [song.id, song]));
      const wanted = (payload.song_ids ?? []).filter((id) => inFolder.has(id));
      if (!wanted.every((id) => Number.isInteger(inFolder.get(id).track))) return false;
      const actual = [...wanted].sort((a, b) => inFolder.get(a).track - inFolder.get(b).track);
      return actual.every((id, index) => id === wanted[index]);
    }
    case 'edit_folder':
    case 'rename_folder': {
      const folder = folderById(payload.folder_id);
      if (!folder) return true;
      if ('name' in payload && !sameText(folder.name, payload.name)) return false;
      if ('artist' in payload && !sameText(folder.artist, payload.artist)) return false;
      return true;
    }
    case 'create_folder': {
      const known = new Set(Array.isArray(edit.knownFolderIds) ? edit.knownFolderIds : []);
      return folderList.some((folder) => folder && !known.has(folder.id) && sameText(folder.name, payload.name)
        && (!('artist' in payload) || sameText(folder.artist, payload.artist)));
    }
    default:
      return false;
  }
}

/**
 * Qué hacer con una edición pendiente tras una revisión. status: el estado del servidor ('abierta', 'cerrada',
 * 'error') o null si no se sabe; reflected: si el catálogo leído la refleja; catalogOk: si se pudo leer el catálogo.
 * Devuelve { outcome, closedAt } (closedAt: cuándo se vio cerrada por primera vez).
 */
export function reviewEdit(edit, { now, status = null, reflected = false, catalogOk = false }) {
  if (reflected) return { outcome: OUTCOMES.CONFIRMED, closedAt: edit.closedAt ?? null };
  if (status === 'error') return { outcome: OUTCOMES.FAILED, closedAt: edit.closedAt ?? null };
  const closedAt = edit.closedAt ?? (status === 'cerrada' ? now : null);
  const age = now - (edit.createdAt ?? now);
  if (closedAt !== null && now - closedAt >= CLOSED_GRACE_MS) return { outcome: OUTCOMES.CONFIRMED, closedAt };
  if (edit.kind === 'cover' && edit.hadCover && age >= COVER_ASSUME_MS) return { outcome: OUTCOMES.CONFIRMED, closedAt };
  if (catalogOk && closedAt === null && age >= MAX_PENDING_MS) return { outcome: OUTCOMES.FAILED, closedAt };
  return { outcome: OUTCOMES.PENDING, closedAt };
}

/** Espera antes de la revisión número [n] (desde 0): 20, 30, 45, 60, 90, 120 s y después cada 180 s. */
export function checkDelayMs(n) {
  const index = Math.min(Math.max(0, Number.isInteger(n) ? n : 0), CHECK_DELAYS_S.length - 1);
  return CHECK_DELAYS_S[index] * 1000;
}

// ---------------------------------------------------------------------------------------------
// Descripción
// ---------------------------------------------------------------------------------------------

/** Nombre de lo editado y qué se hizo, con el catálogo que se ve: { label, action }. */
export function describeEdit(payload, songs, folders) {
  const songTitle = (id) => (Array.isArray(songs) ? songs : []).find((song) => song?.id === id)?.title ?? 'Canción';
  const folderName = (id) => (Array.isArray(folders) ? folders : []).find((folder) => folder?.id === id)?.name ?? 'Álbum';
  switch (payload?.op) {
    case 'edit_song': {
      const label = 'title' in payload ? cleanEditText(payload.title) : songTitle(payload.song_id);
      if ('folder_id' in payload) {
        return { label, action: payload.folder_id === null ? 'Quitar del álbum' : `Añadir a «${folderName(payload.folder_id)}»` };
      }
      return { label, action: 'Detalles de la canción' };
    }
    case 'move_songs': {
      const ids = Array.isArray(payload.song_ids) ? payload.song_ids : [];
      return {
        label: ids.length === 1 ? songTitle(ids[0]) : `${ids.length} canciones`,
        action: payload.folder_id === null ? 'Quitar del álbum' : `Mover a «${folderName(payload.folder_id)}»`,
      };
    }
    case 'order_album':
      return { label: folderName(payload.folder_id), action: 'Orden de las canciones' };
    case 'edit_folder':
    case 'rename_folder':
      return { label: 'name' in payload ? cleanEditText(payload.name) : folderName(payload.folder_id), action: 'Detalles del álbum' };
    case 'create_folder':
      return { label: cleanEditText(payload.name), action: 'Álbum nuevo' };
    default:
      return { label: 'Cambio', action: 'Cambio' };
  }
}

/** Nombre de la canción o del álbum de una portada. */
export function coverLabel(id, songs, folders) {
  return (Array.isArray(songs) ? songs : []).find((song) => song?.id === id)?.title
    ?? (Array.isArray(folders) ? folders : []).find((folder) => folder?.id === id)?.name
    ?? 'Portada';
}

/** Texto del botón de Tu biblioteca, o null si no hay nada: «1 cambio pendiente», «No se ha podido guardar 2 cambios». */
export function indicatorText(items) {
  const list = Array.isArray(items) ? items : [];
  const failed = list.filter((item) => item.state === STATES.ERROR).length;
  const pending = list.length - failed;
  if (failed > 0) return failed === 1 ? 'No se ha podido guardar 1 cambio' : `No se ha podido guardar ${failed} cambios`;
  if (pending > 0) return pending === 1 ? '1 cambio pendiente' : `${pending} cambios pendientes`;
  return null;
}

// ---------------------------------------------------------------------------------------------
// Persistencia (localStorage)
// ---------------------------------------------------------------------------------------------

const PERSISTED_FIELDS = ['key', 'kind', 'payload', 'targetId', 'issue', 'label', 'action', 'createdAt', 'closedAt', 'state', 'error', 'hadCover', 'preview', 'knownFolderIds'];

/** Lo que se guarda. Una vista previa demasiado grande no se guarda (la edición sí). */
export function serializeEdits(items) {
  const kept = (Array.isArray(items) ? items : []).map((item) => {
    const copy = Object.fromEntries(PERSISTED_FIELDS.filter((field) => item[field] !== undefined).map((field) => [field, item[field]]));
    if (typeof copy.preview === 'string' && copy.preview.length > MAX_STORED_PREVIEW_CHARS) delete copy.preview;
    return copy;
  });
  return JSON.stringify({ version: STORAGE_VERSION, items: kept });
}

const PREVIEW = /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/;

/** Ediciones guardadas, ya comprobadas. Lo que no vale se descarta. Nunca lanza. */
export function parseEdits(raw) {
  let data;
  try {
    data = JSON.parse(raw ?? 'null');
  } catch {
    return [];
  }
  if (!data || data.version !== STORAGE_VERSION || !Array.isArray(data.items)) return [];
  const items = [];
  for (const item of data.items) {
    if (!item || typeof item !== 'object' || typeof item.key !== 'string' || item.key === '') continue;
    if (!Number.isFinite(item.createdAt)) continue;
    const base = {
      key: item.key,
      issue: Number.isInteger(item.issue) && item.issue > 0 ? item.issue : null,
      label: typeof item.label === 'string' ? item.label : 'Cambio',
      action: typeof item.action === 'string' ? item.action : 'Cambio',
      createdAt: item.createdAt,
      closedAt: Number.isFinite(item.closedAt) ? item.closedAt : null,
      state: item.state === STATES.ERROR ? STATES.ERROR : STATES.PENDING,
      error: typeof item.error === 'string' ? item.error : null,
    };
    if (item.kind === 'cover' && typeof item.targetId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(item.targetId)) {
      items.push({ ...base, kind: 'cover', targetId: item.targetId, hadCover: item.hadCover === true, preview: typeof item.preview === 'string' && PREVIEW.test(item.preview) ? item.preview : null });
    } else if (item.kind === 'organize' && item.payload && typeof item.payload === 'object' && typeof item.payload.op === 'string') {
      items.push({ ...base, kind: 'organize', payload: item.payload, ...(Array.isArray(item.knownFolderIds) ? { knownFolderIds: item.knownFolderIds.filter((id) => typeof id === 'string') } : {}) });
    }
  }
  return items;
}

function readStorage(storage) {
  try {
    return storage?.getItem(STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

function writeStorage(storage, items) {
  if (!storage) return;
  try {
    if (items.length === 0) storage.removeItem(STORAGE_KEY);
    else storage.setItem(STORAGE_KEY, serializeEdits(items));
  } catch {
    // Sin espacio o almacenamiento bloqueado: se intenta sin las vistas previas; si tampoco, vale durante la visita.
    try {
      storage.setItem(STORAGE_KEY, serializeEdits(items.map(({ preview, ...rest }) => rest)));
    } catch {
      // Nada más que hacer.
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Gestor
// ---------------------------------------------------------------------------------------------

const defaultKey = () => `e${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/**
 * Gestor de las ediciones pendientes. Dependencias (todas inyectables en las pruebas):
 * - sendOrganize(payload) → { message, issue }; sendCover(id, bytes) → { message }; lanzan Error con el motivo
 * - fetchStatus(issue) → 'abierta' | 'cerrada' | 'error' (lanza si no se sabe)
 * - fetchCatalog() → { songs, folders } leídos sin caché (lanza si no se puede)
 * - catalog() → { songs, folders }: el catálogo real que tiene la app ahora
 * - previewBytes(dataUrl) → Uint8Array (para reintentar una portada)
 * - onCatalog(songs, folders): catálogo nuevo leído en una revisión (la app se pone al día)
 * - onNotice({ type: 'confirmed' | 'failed', edit, text }), storage, now, setTimer, clearTimer, newKey
 */
export function createEditTracker(deps = {}) {
  const {
    sendOrganize,
    sendCover,
    fetchStatus = async () => { throw new Error('Sin estado'); },
    fetchCatalog = async () => { throw new Error('Sin catálogo'); },
    catalog = () => ({ songs: [], folders: [] }),
    previewBytes = () => null,
    onCatalog = () => {},
    onNotice = () => {},
    storage = null,
    now = () => Date.now(),
    setTimer = (fn, ms) => setTimeout(fn, ms),
    clearTimer = (id) => clearTimeout(id),
    newKey = defaultKey,
  } = deps;

  let items = [];
  const listeners = new Set();
  let timer = null;
  let checking = false;
  let rounds = 0;
  let disposed = false;

  const snapshot = () => items.map((item) => ({ ...item }));

  function emit() {
    if (disposed) return;
    writeStorage(storage, items);
    const copy = snapshot();
    for (const listener of [...listeners]) {
      try {
        listener(copy);
      } catch (error) {
        console.error('Reminiscencia: error al pintar las ediciones pendientes.', error);
      }
    }
  }

  function schedule(delay = checkDelayMs(rounds)) {
    if (disposed) return;
    if (timer !== null) clearTimer(timer);
    timer = null;
    if (!items.some((item) => item.state === STATES.PENDING)) return;
    timer = setTimer(() => {
      timer = null;
      check();
    }, delay);
  }

  /** Vista del catálogo real con las pendientes aplicadas (para describir una edición nueva). */
  function view() {
    const { songs, folders } = catalog();
    return applyPendingEdits(songs, folders, items);
  }

  function register(edit) {
    items = items.filter((item) => !supersedesEdit(edit, item) && !(item.state === STATES.ERROR && isDuplicateEdit(item, edit)));
    items.push(edit);
    rounds = 0;
    emit();
    schedule();
    return edit;
  }

  function findDuplicate(edit) {
    return items.find((item) => item.state === STATES.PENDING && isDuplicateEdit(item, edit)) ?? null;
  }

  /** Envía una operación de organizar. Devuelve el mensaje para el usuario o lanza Error con el motivo. */
  async function submit(payload) {
    const shown = view();
    const { label, action } = describeEdit(payload, shown.songs, shown.folders);
    const draft = { kind: 'organize', payload, state: STATES.PENDING };
    if (findDuplicate(draft)) return duplicateText(label);
    const { folders } = catalog();
    const receipt = await sendOrganize(payload);
    register({
      ...draft,
      key: newKey(),
      issue: Number.isInteger(receipt?.issue) && receipt.issue > 0 ? receipt.issue : null,
      label,
      action,
      createdAt: now(),
      closedAt: null,
      error: null,
      ...(payload.op === 'create_folder' ? { knownFolderIds: (folders ?? []).map((folder) => folder?.id).filter(Boolean) } : {}),
    });
    return receipt?.message;
  }

  /** Envía la portada de una canción o un álbum (bytes JPEG y su vista previa en data:). */
  async function submitCover({ id, bytes, dataUrl }) {
    const shown = view();
    const label = coverLabel(id, shown.songs, shown.folders);
    const draft = { kind: 'cover', targetId: id, preview: dataUrl ?? null, state: STATES.PENDING };
    if (findDuplicate(draft)) return duplicateText(label);
    const { songs, folders } = catalog();
    const target = (songs ?? []).find((song) => song?.id === id) ?? (folders ?? []).find((folder) => folder?.id === id);
    const receipt = await sendCover(id, bytes);
    register({
      ...draft,
      key: newKey(),
      issue: null,
      label,
      action: 'Portada nueva',
      createdAt: now(),
      closedAt: null,
      error: null,
      hadCover: Boolean(target?.cover),
    });
    return receipt?.message;
  }

  function finish(item, outcome, reason = null) {
    if (outcome === OUTCOMES.CONFIRMED) {
      items = items.filter((entry) => entry.key !== item.key);
      onNotice({ type: 'confirmed', edit: { ...item }, text: confirmedText(item.label) });
    } else if (outcome === OUTCOMES.FAILED) {
      items = items.map((entry) => (entry.key === item.key ? { ...entry, state: STATES.ERROR, error: reason } : entry));
      onNotice({ type: 'failed', edit: { ...item }, text: failedText(item.label) });
    }
  }

  /** Revisa ahora: lee el catálogo y el estado de cada incidencia, y confirma o da por fallidas. */
  async function check() {
    if (disposed || checking) return;
    if (!items.some((item) => item.state === STATES.PENDING)) return;
    checking = true;
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
    try {
      let fresh = null;
      try {
        fresh = await fetchCatalog();
      } catch {
        fresh = null;
      }
      const catalogOk = Boolean(fresh && Array.isArray(fresh.songs));
      if (catalogOk) onCatalog(fresh.songs, Array.isArray(fresh.folders) ? fresh.folders : catalog().folders);
      const current = catalogOk ? { songs: fresh.songs, folders: Array.isArray(fresh.folders) ? fresh.folders : catalog().folders } : catalog();
      for (const item of items.filter((entry) => entry.state === STATES.PENDING)) {
        const reflected = catalogOk && isEditReflected(item, current.songs, current.folders);
        let status = null;
        if (!reflected && item.issue !== null) {
          try {
            const value = await fetchStatus(item.issue);
            status = SERVER_STATES.includes(value) ? value : null;
          } catch {
            status = null;
          }
        }
        if (disposed) return;
        const at = now();
        const result = reviewEdit(item, { now: at, status, reflected, catalogOk });
        if (result.closedAt !== item.closedAt) {
          items = items.map((entry) => (entry.key === item.key ? { ...entry, closedAt: result.closedAt } : entry));
        }
        const reason = status === 'error' ? SERVER_ERROR_REASON : TIMEOUT_REASON;
        finish(item, result.outcome, reason);
      }
    } finally {
      checking = false;
    }
    if (disposed) return;
    rounds += 1;
    emit();
    schedule();
  }

  /**
   * Catálogo nuevo cargado por la app (al abrir o al publicarse una subida): confirma lo que ya refleja, sin consultar
   * el servidor ni dar nada por fallido.
   */
  function reconcile(songs, folders) {
    const before = items.length;
    for (const item of items.filter((entry) => entry.state === STATES.PENDING)) {
      if (isEditReflected(item, songs, folders)) finish(item, OUTCOMES.CONFIRMED);
    }
    if (items.length !== before) emit();
  }

  /** Vuelve a enviar una edición fallida (la misma operación o la misma portada). */
  async function retry(key) {
    const item = items.find((entry) => entry.key === key);
    if (!item || item.state !== STATES.ERROR) return null;
    let receipt;
    if (item.kind === 'cover') {
      const bytes = item.preview ? previewBytes(item.preview) : null;
      if (!bytes) throw new Error('La imagen ya no está disponible. Vuelve a elegirla en «Cambiar portada».');
      receipt = await sendCover(item.targetId, bytes);
    } else {
      receipt = await sendOrganize(item.payload);
    }
    items = items.map((entry) => (entry.key === key ? {
      ...entry,
      state: STATES.PENDING,
      error: null,
      issue: item.kind === 'cover' ? null : (Number.isInteger(receipt?.issue) && receipt.issue > 0 ? receipt.issue : null),
      createdAt: now(),
      closedAt: null,
    } : entry));
    rounds = 0;
    emit();
    schedule();
    return receipt?.message;
  }

  /** Quita una edición fallida de la lista. */
  function discard(key) {
    const before = items.length;
    items = items.filter((entry) => !(entry.key === key && entry.state === STATES.ERROR));
    if (items.length !== before) emit();
  }

  /** Lee las ediciones guardadas (al abrir la página) y las revisa enseguida. */
  function restore() {
    items = parseEdits(readStorage(storage));
    rounds = 0;
    emit();
    if (items.some((item) => item.state === STATES.PENDING)) schedule(0);
  }

  return {
    items: snapshot,
    restore,
    submit,
    submitCover,
    retry,
    discard,
    check,
    reconcile,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      disposed = true;
      if (timer !== null) clearTimer(timer);
      timer = null;
      listeners.clear();
    },
  };
}
