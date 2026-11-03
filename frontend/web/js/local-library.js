// Listas propias y «Me gusta», guardadas solo en este navegador (IndexedDB), sin cuenta ni servidor (ADR-0015).
// Base «reminiscencia-biblioteca», versión 1: almacén «playlists» (clave id) y almacén «likes» (clave songId).
// Una lista guarda { id, name, description, cover, songIds, createdAt, updatedAt }: description es texto de una línea
// (puede faltar en las listas antiguas) y cover, una portada propia JPEG/PNG/WebP en data: (js/cover-image.js) o null.
// Las funciones puras van exportadas para las pruebas (tests/web-unit/local-library.test.mjs). Si el navegador no
// deja abrir IndexedDB (modo privado estricto, almacenamiento bloqueado), los datos viven solo en memoria mientras la
// página está abierta y persistent vale false para que la interfaz lo avise.

export const LIBRARY_DB_NAME = 'reminiscencia-biblioteca';
export const LIBRARY_DB_VERSION = 1;
export const PLAYLIST_NAME_MAX = 100;
export const PLAYLIST_SONGS_MAX = 2000;
export const PLAYLIST_DESCRIPTION_MAX = 300;
/** Tamaño máximo de la portada propia en data: (una JPEG de 640 × 640 ocupa unos 100 KB). */
export const PLAYLIST_COVER_MAX_CHARS = 2_000_000;
const COVER_DATA_URL = /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
const PLAYLISTS = 'playlists';
const LIKES = 'likes';
const CONTROL = /[\u0000-\u001f\u007f\u2028\u2029]/;

// ---------------------------------------------------------------------------
// Funciones puras
// ---------------------------------------------------------------------------

/** Motivo en español si el nombre de una lista no vale, o null. */
export function validatePlaylistName(name) {
  if (typeof name !== 'string') return 'El nombre debe ser texto.';
  if (CONTROL.test(name)) return 'El nombre no puede tener saltos de línea ni caracteres de control.';
  const clean = name.trim();
  if (clean === '') return 'Escribe un nombre para la lista.';
  if (Array.from(clean).length > PLAYLIST_NAME_MAX) return `El nombre no puede tener más de ${PLAYLIST_NAME_MAX} caracteres.`;
  return null;
}

/** Descripción de una lista en una sola línea: los saltos de línea y los espacios repetidos pasan a un espacio. */
export function normalizeDescription(text) {
  return typeof text === 'string' ? text.replace(/[\t\n\r\u2028\u2029]+/g, ' ').replace(/ {2,}/g, ' ').trim() : '';
}

/** Motivo en español si la descripción no vale, o null. Vacía vale. */
export function validatePlaylistDescription(text) {
  if (typeof text !== 'string') return 'La descripción debe ser texto.';
  const clean = normalizeDescription(text);
  if (CONTROL.test(clean)) return 'La descripción no puede tener caracteres de control.';
  if (Array.from(clean).length > PLAYLIST_DESCRIPTION_MAX) return `La descripción no puede tener más de ${PLAYLIST_DESCRIPTION_MAX} caracteres.`;
  return null;
}

/** ¿Es una portada propia válida? (imagen JPEG, PNG o WebP en data: base64, de tamaño razonable) */
export function isValidCoverDataUrl(value) {
  return typeof value === 'string' && value.length <= PLAYLIST_COVER_MAX_CHARS && COVER_DATA_URL.test(value);
}

/** Nombre de una lista nueva: «Mi lista n.º N», con el primer N libre a partir del número de listas + 1. */
export function defaultPlaylistName(existingNames = []) {
  const taken = new Set(existingNames.map((name) => String(name).trim().toLowerCase()));
  let number = existingNames.length + 1;
  while (taken.has(`mi lista n.º ${number}`)) number += 1;
  return `Mi lista n.º ${number}`;
}

/** Añade canciones al final de una lista sin repetir las que ya tiene. Devuelve la lista nueva de ids y cuántas entraron. */
export function addSongIds(current, songIds) {
  const list = [...current];
  const seen = new Set(list);
  let added = 0;
  for (const id of songIds) {
    if (typeof id !== 'string' || seen.has(id) || list.length >= PLAYLIST_SONGS_MAX) continue;
    seen.add(id);
    list.push(id);
    added += 1;
  }
  return { songIds: list, added };
}

/** Quita una canción de una lista. */
export function removeSongId(current, songId) {
  return current.filter((id) => id !== songId);
}

/** Identificador de lista: «P» + 16 hexadecimales aleatorios. */
export function newPlaylistId(randomBytes) {
  if (!randomBytes || randomBytes.length !== 8) throw new RangeError('Hacen falta 8 bytes aleatorios.');
  return `P${Array.from(randomBytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

const byCreation = (a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1);

// ---------------------------------------------------------------------------
// Almacenes: IndexedDB o memoria
// ---------------------------------------------------------------------------

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function openDatabase(factory) {
  return new Promise((resolve, reject) => {
    let request;
    try {
      request = factory.open(LIBRARY_DB_NAME, LIBRARY_DB_VERSION);
    } catch (error) {
      reject(error);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PLAYLISTS)) db.createObjectStore(PLAYLISTS, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(LIKES)) db.createObjectStore(LIKES, { keyPath: 'songId' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('La base de datos está abierta en otra pestaña con otra versión.'));
  });
}

function idbBackend(db) {
  const run = (name, mode, work) => new Promise((resolve, reject) => {
    const tx = db.transaction(name, mode);
    work(tx.objectStore(name));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Transacción cancelada.'));
  });
  return {
    getAll: (name) => requestResult(db.transaction(name, 'readonly').objectStore(name).getAll()),
    put: (name, record) => run(name, 'readwrite', (store) => { store.put(record); }),
    delete: (name, key) => run(name, 'readwrite', (store) => { store.delete(key); }),
    close: () => db.close(),
  };
}

function memoryBackend() {
  const stores = new Map([[PLAYLISTS, new Map()], [LIKES, new Map()]]);
  const keyOf = (name, record) => (name === PLAYLISTS ? record.id : record.songId);
  return {
    getAll: async (name) => [...stores.get(name).values()].map((record) => structuredClone(record)),
    put: async (name, record) => { stores.get(name).set(keyOf(name, record), structuredClone(record)); },
    delete: async (name, key) => { stores.get(name).delete(key); },
    close: () => {},
  };
}

/**
 * Abre la biblioteca local. env.indexedDB permite inyectar una base falsa en las pruebas; env.now y env.random,
 * el reloj y los bytes aleatorios. Nunca falla: sin IndexedDB devuelve una biblioteca en memoria.
 */
export async function openLocalLibrary(env = {}) {
  const factory = 'indexedDB' in env ? env.indexedDB : globalThis.indexedDB;
  const now = env.now ?? (() => Date.now());
  const random = env.random ?? ((length) => globalThis.crypto.getRandomValues(new Uint8Array(length)));
  let backend;
  let persistent = true;
  try {
    if (!factory) throw new Error('Sin IndexedDB');
    backend = idbBackend(await openDatabase(factory));
  } catch (error) {
    console.warn('Reminiscencia: las listas y «Me gusta» no se pueden guardar en este navegador.', error);
    backend = memoryBackend();
    persistent = false;
  }

  async function listPlaylists() {
    return (await backend.getAll(PLAYLISTS)).sort(byCreation);
  }

  async function getPlaylist(id) {
    return (await listPlaylists()).find((list) => list.id === id) ?? null;
  }

  async function savePlaylist(list) {
    await backend.put(PLAYLISTS, list);
    return list;
  }

  async function requirePlaylist(id) {
    const list = await getPlaylist(id);
    if (!list) throw new Error('Esa lista ya no existe.');
    return list;
  }

  /**
   * Cambia los detalles de una lista: name, description y cover (data: o null para quitarla). Los campos que no
   * se pasan se conservan. Lanza el motivo si alguno no vale y entonces no guarda nada.
   */
  async function updatePlaylist(id, { name, description, cover } = {}) {
    const changes = {};
    if (name !== undefined) {
      const problem = validatePlaylistName(name);
      if (problem) throw new Error(problem);
      changes.name = name.trim();
    }
    if (description !== undefined) {
      const problem = validatePlaylistDescription(description);
      if (problem) throw new Error(problem);
      changes.description = normalizeDescription(description);
    }
    if (cover !== undefined) {
      if (cover !== null && !isValidCoverDataUrl(cover)) throw new Error('La portada no es una imagen válida.');
      changes.cover = cover;
    }
    const list = await requirePlaylist(id);
    return savePlaylist({ ...list, ...changes, updatedAt: now() });
  }

  return {
    persistent,
    listPlaylists,
    getPlaylist,
    async createPlaylist(name = null, songIds = []) {
      const existing = await listPlaylists();
      const finalName = name === null ? defaultPlaylistName(existing.map((list) => list.name)) : name;
      const problem = validatePlaylistName(finalName);
      if (problem) throw new Error(problem);
      const stamp = now();
      const list = {
        id: newPlaylistId(random(8)),
        name: finalName.trim(),
        description: '',
        cover: null,
        songIds: addSongIds([], songIds).songIds,
        createdAt: stamp,
        updatedAt: stamp,
      };
      return savePlaylist(list);
    },
    async renamePlaylist(id, name) {
      return updatePlaylist(id, { name });
    },
    updatePlaylist,
    async deletePlaylist(id) {
      await backend.delete(PLAYLISTS, id);
    },
    async addToPlaylist(id, songIds) {
      const list = await requirePlaylist(id);
      const { songIds: next, added } = addSongIds(list.songIds, songIds);
      await savePlaylist({ ...list, songIds: next, updatedAt: now() });
      return added;
    },
    async removeFromPlaylist(id, songId) {
      const list = await requirePlaylist(id);
      await savePlaylist({ ...list, songIds: removeSongId(list.songIds, songId), updatedAt: now() });
    },
    /** «Me gusta»: Map de songId a la fecha en que se marcó. */
    async listLikes() {
      return new Map((await backend.getAll(LIKES)).map((record) => [record.songId, record.likedAt]));
    },
    async setLiked(songId, liked) {
      if (liked) await backend.put(LIKES, { songId, likedAt: now() });
      else await backend.delete(LIKES, songId);
    },
    /** Quita una canción de «Me gusta» y de todas las listas (por ejemplo, al borrar una canción local). */
    async forgetSong(songId) {
      await backend.delete(LIKES, songId);
      for (const list of await listPlaylists()) {
        if (list.songIds.includes(songId)) await savePlaylist({ ...list, songIds: removeSongId(list.songIds, songId), updatedAt: now() });
      }
    },
    close: () => backend.close(),
  };
}
