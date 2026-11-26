// Acciones declarativas sobre el catálogo (ADR-0052). FUNCIONES PURAS: reciben un catálogo y devuelven uno nuevo + un
// evento que describe el cambio. No tocan R2 ni esperan nada; su único trabajo es validar y aplicar.
//
// Un 'id' nuevo para canciones/folders se crea con `nextId('S' | 'F')` (16 hex aleatorios). Las validaciones son las
// mínimas que mantienen la integridad referencial (no admite folder_id que no existe, no admite borrar un folder con
// hijos, no admite subir dos canciones con el mismo sha256).

const HEX = '0123456789abcdef';

/** Genera `S` o `F` + 16 hex (compatible con el formato histórico del catálogo). */
export function nextId(kind) {
  const prefix = kind === 'S' ? 'S' : 'F';
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let hex = '';
  for (const b of bytes) hex += HEX[b >>> 4] + HEX[b & 0x0f];
  return prefix + hex;
}

class ActionError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Devuelve una copia honda ligera (solo lo que vamos a tocar: arrays de folders/songs). */
function cloneCatalog(catalog) {
  return {
    version: catalog.version,
    updated_at: catalog.updated_at,
    folders: catalog.folders.map((f) => ({ ...f })),
    songs: catalog.songs.map((s) => ({ ...s, tags: Array.isArray(s.tags) ? [...s.tags] : [] })),
  };
}

function findSong(catalog, songId) {
  const song = catalog.songs.find((s) => s.id === songId);
  if (!song) throw new ActionError(404, `No existe la canción ${songId}.`);
  return song;
}

function findFolder(catalog, folderId) {
  const folder = catalog.folders.find((f) => f.id === folderId);
  if (!folder) throw new ActionError(404, `No existe el álbum ${folderId}.`);
  return folder;
}

const trimmed = (value) => (typeof value === 'string' ? value.trim() : '');

const ACTIONS = {
  rename_song(catalog, params) {
    const title = trimmed(params?.new_title);
    if (!title) throw new ActionError(400, 'rename_song: falta new_title.');
    const song = findSong(catalog, params?.song_id);
    song.title = title;
    return { kind: 'rename_song', song_id: song.id, new_title: title };
  },
  rename_folder(catalog, params) {
    const name = trimmed(params?.new_name);
    if (!name) throw new ActionError(400, 'rename_folder: falta new_name.');
    const folder = findFolder(catalog, params?.folder_id);
    folder.name = name;
    const event = { kind: 'rename_folder', folder_id: folder.id, new_name: name };
    if (typeof params?.artist === 'string') {
      const artist = params.artist.trim();
      if (artist) folder.artist = artist;
      else delete folder.artist;
      event.artist = artist;
    }
    return event;
  },
  move_song(catalog, params) {
    const folderId = params?.folder_id;
    if (folderId !== null && folderId !== undefined) findFolder(catalog, folderId);
    const song = findSong(catalog, params?.song_id);
    song.folder_id = folderId ?? null;
    return { kind: 'move_song', song_id: song.id, folder_id: song.folder_id };
  },
  move_folder(catalog, params) {
    const folder = findFolder(catalog, params?.folder_id);
    const parentId = params?.parent_id ?? null;
    if (parentId === folder.id) throw new ActionError(400, 'move_folder: un álbum no puede ser su propio padre.');
    if (parentId !== null) findFolder(catalog, parentId);
    folder.parent_id = parentId;
    return { kind: 'move_folder', folder_id: folder.id, parent_id: parentId };
  },
  set_cover(catalog, params) {
    const song = findSong(catalog, params?.song_id);
    const coverId = typeof params?.cover_id === 'string' ? params.cover_id : null;
    // Validación mínima del cover_id: 64 chars hex (sha256) o 1-128 chars sin separadores raros. null borra la portada.
    if (coverId !== null && !/^[A-Za-z0-9_.-]{1,128}$/.test(coverId)) {
      throw new ActionError(400, 'set_cover: cover_id no válido.');
    }
    song.cover_id = coverId;
    return { kind: 'set_cover', song_id: song.id, cover_id: coverId };
  },
  delete_song(catalog, params) {
    const song = findSong(catalog, params?.song_id);
    catalog.songs = catalog.songs.filter((s) => s.id !== song.id);
    return { kind: 'delete_song', song_id: song.id };
  },
  unpublish_song(catalog, params) {
    const song = findSong(catalog, params?.song_id);
    song.public = false;
    return { kind: 'unpublish_song', song_id: song.id };
  },
  delete_folder(catalog, params) {
    const folder = findFolder(catalog, params?.folder_id);
    const hasSongs = catalog.songs.some((s) => s.folder_id === folder.id);
    const hasFolders = catalog.folders.some((f) => f.parent_id === folder.id);
    if (hasSongs || hasFolders) throw new ActionError(409, `delete_folder: el álbum ${folder.id} aún tiene contenido.`);
    catalog.folders = catalog.folders.filter((f) => f.id !== folder.id);
    return { kind: 'delete_folder', folder_id: folder.id };
  },
  create_folder(catalog, params) {
    const name = trimmed(params?.name);
    if (!name) throw new ActionError(400, 'create_folder: falta name.');
    const parentId = params?.parent_id ?? null;
    if (parentId !== null) findFolder(catalog, parentId);
    const folder = { id: nextId('F'), name, parent_id: parentId };
    const artistParam = typeof params?.artist === 'string' ? params.artist.trim() : undefined;
    if (artistParam) folder.artist = artistParam;
    if (typeof params?.youtube_playlist_id === 'string') folder.youtube_playlist_id = params.youtube_playlist_id;
    catalog.folders.push(folder);
    const event = { kind: 'create_folder', folder_id: folder.id, name: folder.name, parent_id: parentId };
    if (artistParam) event.artist = artistParam;
    return event;
  },
  set_year(catalog, params) {
    const year = Number(params?.year);
    if (!Number.isInteger(year) || year < 1800 || year > 2200) throw new ActionError(400, 'set_year: año fuera de rango.');
    const song = findSong(catalog, params?.song_id);
    song.year = year;
    return { kind: 'set_year', song_id: song.id, year };
  },
  set_artist(catalog, params) {
    const artist = trimmed(params?.artist);
    if (!artist) throw new ActionError(400, 'set_artist: falta artist.');
    const song = findSong(catalog, params?.song_id);
    song.artist = artist;
    return { kind: 'set_artist', song_id: song.id, artist };
  },
  set_tags(catalog, params) {
    if (!Array.isArray(params?.tags)) throw new ActionError(400, 'set_tags: tags debe ser una lista.');
    const tags = params.tags.map((t) => trimmed(t)).filter(Boolean);
    const song = findSong(catalog, params?.song_id);
    song.tags = tags;
    return { kind: 'set_tags', song_id: song.id, tags };
  },
  set_track_index(catalog, params) {
    const song = findSong(catalog, params?.song_id);
    if (song.folder_id === null || song.folder_id === undefined) {
      throw new ActionError(400, 'La canción no pertenece a un álbum');
    }
    const rawIndex = Number(params?.index);
    if (!Number.isInteger(rawIndex)) throw new ActionError(400, 'set_track_index: index debe ser un entero.');
    const siblings = catalog.songs.filter((s) => s.folder_id === song.folder_id);
    const siblingIds = siblings.map((s) => s.id);
    const currentPos = siblingIds.indexOf(song.id);
    const maxIndex = siblings.length - 1;
    const targetIndex = Math.max(0, Math.min(rawIndex, maxIndex));
    const ordered = siblingIds.filter((id) => id !== song.id);
    ordered.splice(targetIndex, 0, song.id);
    for (let pos = 0; pos < ordered.length; pos += 1) {
      const target = catalog.songs.find((s) => s.id === ordered[pos]);
      target.track_index = pos;
    }
    return {
      kind: 'set_track_index',
      song_id: song.id,
      folder_id: song.folder_id,
      from: currentPos,
      to: targetIndex,
    };
  },
  reorder_folder(catalog, params) {
    const folder = findFolder(catalog, params?.folder_id);
    if (!Array.isArray(params?.order)) throw new ActionError(400, 'reorder_folder: order debe ser una lista de ids.');
    const order = params.order;
    const actual = catalog.songs.filter((s) => s.folder_id === folder.id).map((s) => s.id);
    if (order.length !== actual.length || !sameSet(order, actual)) {
      throw new ActionError(400, 'order no coincide con las canciones del álbum');
    }
    for (let pos = 0; pos < order.length; pos += 1) {
      const target = catalog.songs.find((s) => s.id === order[pos]);
      target.track_index = pos;
    }
    return { kind: 'reorder_folder', folder_id: folder.id, order: [...order] };
  },
  set_song_fields(catalog, params) {
    const song = findSong(catalog, params?.song_id);
    const fields = params?.fields;
    if (!fields || typeof fields !== 'object') throw new ActionError(400, 'set_song_fields: falta fields.');
    const changes = {};
    if ('title' in fields) {
      const title = trimmed(fields.title);
      if (!title) throw new ActionError(400, 'set_song_fields: title no puede estar vacío.');
      song.title = title;
      changes.title = title;
    }
    if ('artist' in fields) {
      const artist = trimmed(fields.artist);
      if (!artist) throw new ActionError(400, 'set_song_fields: artist no puede estar vacío.');
      song.artist = artist;
      changes.artist = artist;
    }
    if ('year' in fields) {
      const year = Number(fields.year);
      if (!Number.isInteger(year) || year < 1800 || year > 2200) {
        throw new ActionError(400, 'set_song_fields: año fuera de rango.');
      }
      song.year = year;
      changes.year = year;
    }
    if ('tags' in fields) {
      if (!Array.isArray(fields.tags)) throw new ActionError(400, 'set_song_fields: tags debe ser una lista.');
      const tags = fields.tags.map((t) => trimmed(t)).filter(Boolean);
      song.tags = tags;
      changes.tags = tags;
    }
    if (Object.keys(changes).length === 0) throw new ActionError(400, 'set_song_fields: no hay campos que actualizar.');
    return { kind: 'set_song_fields', song_id: song.id, changes };
  },
};

function sameSet(left, right) {
  if (left.length !== right.length) return false;
  const seen = new Set(left);
  for (const id of right) if (!seen.has(id)) return false;
  return true;
}

/** Aplica una acción a una copia del catálogo. Devuelve { catalog: nuevo, event }. No muta la entrada. */
export function applyAction(catalog, action, params) {
  const fn = ACTIONS[action];
  if (typeof fn !== 'function') throw new ActionError(400, `Acción no soportada: ${action}`);
  const next = cloneCatalog(catalog);
  const event = fn(next, params);
  return { catalog: next, event };
}

/** Lista las acciones soportadas (para introspección y pruebas). */
export function supportedActions() {
  return Object.keys(ACTIONS);
}

/** Añade una serie de canciones del buzón al catálogo. Rechaza duplicados por sha256. */
/** Tope duro de canciones por petición al buzón (ADR-0052). Un payload más grande probablemente es un error del
 * cliente o un abuso, y escribirlo haría crecer el catálogo a muchos MB en una sola transacción. El Worker rechaza
 * con 400 claro; la UI debería subir en lotes más pequeños si de verdad necesita publicar tanto. */
const BUZON_MAX_SONGS_PER_CALL = 250;

export function addBuzonSongs(catalog, songs) {
  if (!Array.isArray(songs) || songs.length === 0) throw new ActionError(400, 'buzon: falta la lista de canciones.');
  if (songs.length > BUZON_MAX_SONGS_PER_CALL) {
    throw new ActionError(400, `buzon: demasiadas canciones en una sola llamada (${songs.length}); el máximo es ${BUZON_MAX_SONGS_PER_CALL}.`);
  }
  const next = cloneCatalog(catalog);
  const existingBySha = new Map(next.songs.filter((s) => s.sha256).map((s) => [s.sha256, s.id]));
  const added = [];
  for (const incoming of songs) {
    const title = trimmed(incoming?.title);
    if (!title) throw new ActionError(400, 'buzon: una canción no tiene título.');
    if (incoming?.sha256 && existingBySha.has(incoming.sha256)) {
      throw new ActionError(409, `buzon: la canción ${title} ya existía (sha256 duplicado).`);
    }
    const folderId = incoming?.folder_id ?? null;
    if (folderId !== null && !next.folders.some((f) => f.id === folderId)) {
      throw new ActionError(404, `buzon: no existe el álbum ${folderId}.`);
    }
    const song = {
      id: nextId('S'),
      title,
      artist: trimmed(incoming?.artist) || 'Desconocido',
      year: Number.isInteger(incoming?.year) ? incoming.year : null,
      tags: Array.isArray(incoming?.tags) ? incoming.tags.filter((t) => typeof t === 'string') : [],
      folder_id: folderId,
      sha256: incoming?.sha256 ?? null,
      duration_s: Number.isFinite(incoming?.duration_s) ? incoming.duration_s : null,
      codec: typeof incoming?.codec === 'string' ? incoming.codec : 'opus',
      size_bytes: Number.isInteger(incoming?.size_bytes) ? incoming.size_bytes : null,
      added_at: new Date().toISOString(),
      public: incoming?.public === true,
    };
    if (incoming?.cover_id) song.cover_id = incoming.cover_id;
    if (incoming?.source) song.source = incoming.source;
    if (incoming?.license) song.license = incoming.license;
    next.songs.push(song);
    if (song.sha256) existingBySha.set(song.sha256, song.id);
    added.push({ id: song.id, title: song.title });
  }
  const event = { kind: 'buzon_publish', added };
  return { catalog: next, event };
}

export { ActionError };
