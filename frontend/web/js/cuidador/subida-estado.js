// Estado de cada subida de «Subir canciones» (ADR-0017), de principio a fin, como en Spotify: cada archivo pasa por
// En cola → Convirtiendo a Opus… → Subiendo… 45 % (por trozos) → Guardada en GitHub → Publicándose… → Publicada, o
// acaba en «Error: <motivo>» (con Reintentar) o, si tarda más de 10 minutos, en «Sigue procesándose».
//
// «Publicada» es de verdad: tras guardarse en GitHub se lee /data/songs.json cada 15 s (sin caché) hasta que aparece
// una canción con un id que no estaba antes de subir y con el título de la subida (el nombre del archivo sin extensión
// o, si el buzón tuvo que cambiarlo, el que devolvió /api/subir).
//
// En cuanto termina la conversión, el Opus se guarda en este navegador (subida-local.js) para que la canción salga ya
// en la biblioteca, con la etiqueta «Publicándose…», y se pueda escuchar; al publicarse, la app la sustituye por la
// pública y borra la copia. Las subidas siguen aunque se cierre la hoja (el gestor vive en la app) y las pendientes
// se guardan en localStorage para seguir comprobándolas al volver a abrir la página.
//
// Este módulo no toca el DOM: la máquina de estados, los textos, la detección y el gestor (con sus dependencias
// inyectadas) se prueban en node (tests/web-unit/subida-estado.test.mjs).

export const POLL_MS = 15_000;
export const MAX_WAIT_MS = 10 * 60_000;
export const SAVED_PAUSE_MS = 2_000;
export const STORAGE_KEY = 'reminiscencia.subidas';
const STORAGE_VERSION = 1;

export const STATES = Object.freeze({
  QUEUED: 'cola',
  CONVERTING: 'convirtiendo',
  SENDING: 'subiendo',
  SAVED: 'guardada',
  PUBLISHING: 'publicandose',
  PUBLISHED: 'publicada',
  SLOW: 'tarde',
  ERROR: 'error',
});

const S = STATES;
/** Estados en los que la subida sigue en marcha (cuentan para el indicador de la barra lateral). */
export const ACTIVE_STATES = Object.freeze([S.QUEUED, S.CONVERTING, S.SENDING, S.SAVED, S.PUBLISHING]);
/** Estados en los que se espera a que la canción salga en /data/songs.json. */
const WAITING_STATES = [S.SAVED, S.PUBLISHING];

export const INTERRUPTED_TEXT = 'La subida se interrumpió al cerrar la página.';
export const LOST_FILE_TEXT = 'El archivo ya no está disponible. Vuelve a elegirlo.';
const NBSP = ' ';

// ---------------------------------------------------------------------------------------------
// Máquina de estados (funciones puras)
// ---------------------------------------------------------------------------------------------

/** Grupo de una subida (el ZIP del que sale) en una forma segura, o null. */
export function cleanGroup(group) {
  if (!group || typeof group.key !== 'string' || group.key === '' || typeof group.name !== 'string' || group.name === '') return null;
  const count = (value) => (Number.isInteger(value) && value >= 0 ? value : 0);
  return { key: group.key, name: group.name, songs: count(group.songs), ignored: count(group.ignored) };
}

/** Álbum de una playlist de YouTube, o null en una subida normal. */
export function cleanAlbum(album) {
  if (!album || typeof album.id !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(album.id)
    || typeof album.name !== 'string' || !album.name.trim() || [...album.name].length > 200
    || /[\u0000-\u001f\u007f]/u.test(album.name)) return null;
  return { id: album.id, name: album.name.trim() };
}

/** Subida nueva, en cola. group: el ZIP del que sale; album: la playlist de YouTube, si corresponde. */
export function createItem({ key, name, title, createdAt = 0, group = null, album = null }) {
  return {
    key: String(key),
    name: String(name ?? ''),
    title: String(title ?? ''),
    group: cleanGroup(group),
    album: cleanAlbum(album),
    state: S.QUEUED,
    fraction: 0,
    localId: null,
    serverName: null,
    knownIds: null,
    savedAt: null,
    songId: null,
    songTitle: null,
    error: null,
    retryable: false,
    createdAt,
  };
}

// Transiciones válidas: evento → estados desde los que se admite.
const FROM = Object.freeze({
  convert: [S.QUEUED, S.CONVERTING],
  converted: [S.QUEUED, S.CONVERTING],
  send: [S.SENDING],
  saved: [S.SENDING],
  publishing: [S.SAVED],
  published: [S.SAVED, S.PUBLISHING, S.SLOW],
  slow: [S.SAVED, S.PUBLISHING],
  fail: [S.QUEUED, S.CONVERTING, S.SENDING],
  retry: [S.ERROR],
});

const clamp01 = (value) => (Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0);

/**
 * Aplica un evento a una subida y devuelve la subida nueva (sin cambiar la original). Un evento que no vale en el
 * estado actual devuelve la misma subida (el mismo objeto). Eventos:
 * convert { fraction }, converted { localId }, send { fraction }, saved { serverName, at, knownIds }, publishing,
 * published { songId, songTitle }, slow, fail { message, retryable }, retry.
 */
export function transition(item, event) {
  const type = event?.type;
  if (!item || !FROM[type] || !FROM[type].includes(item.state)) return item;
  if (type === 'retry' && !item.retryable) return item;
  switch (type) {
    case 'convert':
      return { ...item, state: S.CONVERTING, fraction: clamp01(event.fraction) };
    case 'converted':
      return { ...item, state: S.SENDING, fraction: 0, localId: event.localId ?? item.localId ?? null };
    case 'send':
      return { ...item, fraction: Math.max(item.fraction, clamp01(event.fraction)) };
    case 'saved':
      return {
        ...item,
        state: S.SAVED,
        fraction: 1,
        serverName: typeof event.serverName === 'string' && event.serverName ? event.serverName : null,
        savedAt: Number.isFinite(event.at) ? event.at : 0,
        knownIds: Array.isArray(event.knownIds) ? [...event.knownIds] : (item.knownIds ?? []),
      };
    case 'publishing':
      return { ...item, state: S.PUBLISHING };
    case 'published':
      return { ...item, state: S.PUBLISHED, fraction: 1, songId: String(event.songId), songTitle: event.songTitle ?? item.title };
    case 'slow':
      return { ...item, state: S.SLOW };
    case 'fail':
      return { ...item, state: S.ERROR, error: String(event.message || 'No se ha podido subir este archivo.'), retryable: event.retryable !== false };
    case 'retry':
      return { ...item, state: S.QUEUED, fraction: 0, error: null };
    default:
      return item;
  }
}

/** Texto del estado de una subida, tal como se ve en su fila. */
export function statusText(item) {
  switch (item?.state) {
    case S.QUEUED: return 'En cola';
    case S.CONVERTING: return 'Convirtiendo a Opus…';
    case S.SENDING: return `Subiendo… ${Math.round(clamp01(item.fraction) * 100)}${NBSP}%`;
    case S.SAVED: return 'Guardada en GitHub';
    case S.PUBLISHING: return 'Publicándose… (suele tardar 2–3 minutos)';
    case S.PUBLISHED: return 'Publicada';
    case S.SLOW: return 'Sigue procesándose; aparecerá en la biblioteca cuando termine';
    case S.ERROR: return `Error: ${item.error ?? 'No se ha podido subir este archivo.'}`;
    default: return '';
  }
}

/**
 * Barra de progreso del paso actual: { value } de 0 a 100, { value: null } si no se puede medir (publicándose) y
 * { hidden: true } cuando ya no hay nada que esperar (error o «sigue procesándose»).
 */
export function progressOf(item) {
  switch (item?.state) {
    case S.QUEUED: return { value: 0, hidden: false };
    case S.CONVERTING:
    case S.SENDING: return { value: Math.round(clamp01(item.fraction) * 100), hidden: false };
    case S.SAVED:
    case S.PUBLISHED: return { value: 100, hidden: false };
    case S.PUBLISHING: return { value: null, hidden: false };
    default: return { value: null, hidden: true };
  }
}

/** Resumen de la hoja: «2 de 3 publicadas», con los errores y las que siguen procesándose si las hay. */
export function summaryText(items) {
  const list = Array.isArray(items) ? items : [];
  if (list.length === 0) return '';
  const count = (state) => list.filter((item) => item.state === state).length;
  const published = count(S.PUBLISHED);
  const parts = [`${published} de ${list.length} ${list.length === 1 ? 'publicada' : 'publicadas'}`];
  const errors = count(S.ERROR);
  if (errors > 0) parts.push(`${errors} con error`);
  const slow = count(S.SLOW);
  if (slow > 0) parts.push(slow === 1 ? '1 sigue procesándose' : `${slow} siguen procesándose`);
  return parts.join(' · ');
}

/** Subidas en marcha (para el indicador de la barra lateral). */
export function activeCount(items) {
  return (Array.isArray(items) ? items : []).filter((item) => ACTIVE_STATES.includes(item.state)).length;
}

/** Texto del indicador de la barra lateral: «Publicándose 1 canción». Vacío si no hay ninguna en marcha. */
export function indicatorText(count) {
  if (!(count > 0)) return '';
  return count === 1 ? 'Publicándose 1 canción' : `Publicándose ${count} canciones`;
}

/** Aviso al publicarse: «“<título>” ya está en la biblioteca». */
export function publishedNotice(titles) {
  const list = (Array.isArray(titles) ? titles : [titles]).filter(Boolean);
  if (list.length === 0) return '';
  if (list.length === 1) return `“${list[0]}” ya está en la biblioteca`;
  return `${list.length} canciones nuevas ya están en la biblioteca`;
}

// ---------------------------------------------------------------------------------------------
// Detección de la canción publicada (funciones puras)
// ---------------------------------------------------------------------------------------------

/** Título comparable: NFC, sin espacios a los lados ni repetidos y sin distinguir mayúsculas. */
export function normalizeTitle(title) {
  return String(title ?? '').normalize('NFC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('es');
}

/** Títulos con los que puede salir la subida: el del archivo y el del nombre que le dio el buzón (sin .opus). */
export function titleCandidates({ title, serverName } = {}) {
  const names = [title];
  if (typeof serverName === 'string' && serverName) names.push(serverName.replace(/\.opus$/i, ''));
  return [...new Set(names.map(normalizeTitle).filter(Boolean))];
}

/**
 * Canción nueva de songs: la primera con un id que no está en knownIds (los que había antes de subir y los ya
 * reconocidos para otras subidas) y con uno de los títulos. null si todavía no está.
 */
export function findNewSong(songs, { titles = [], knownIds = [] } = {}) {
  if (!Array.isArray(songs)) return null;
  const known = new Set(knownIds);
  const wanted = new Set(titles.map(normalizeTitle));
  return songs.find((song) => song && typeof song.id === 'string' && song.id !== '' && !known.has(song.id)
    && wanted.has(normalizeTitle(song.title))) ?? null;
}

/**
 * Función que lee /data/songs.json siempre de la red (cache: 'no-store'), para no confundir una copia vieja con
 * «todavía no está». Devuelve la lista o lanza si la respuesta no vale.
 */
export function songsFetcher(fetchImpl = globalThis.fetch, url = 'data/songs.json') {
  return async () => {
    const response = await fetchImpl(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`${url}: ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data)) throw new Error(`${url}: no es una lista`);
    return data;
  };
}

/** Ids de una lista de canciones (songs.json). */
export function idsOf(songs) {
  return Array.isArray(songs) ? songs.map((song) => song?.id).filter((id) => typeof id === 'string' && id !== '') : [];
}

// ---------------------------------------------------------------------------------------------
// Persistencia (localStorage)
// ---------------------------------------------------------------------------------------------

const PERSISTED_STATES = [S.SAVED, S.PUBLISHING, S.SLOW, S.ERROR, S.CONVERTING, S.SENDING, S.QUEUED];

/** Lo que se guarda: las subidas que hay que seguir al volver (las que esperan y las que tienen copia local). */
export function serializeItems(items) {
  const kept = (Array.isArray(items) ? items : [])
    .filter((item) => PERSISTED_STATES.includes(item.state))
    .filter((item) => WAITING_STATES.includes(item.state) || item.state === S.SLOW || item.localId)
    .map((item) => ({
      key: item.key, name: item.name, title: item.title, state: item.state, localId: item.localId,
      serverName: item.serverName, knownIds: item.knownIds, savedAt: item.savedAt, error: item.error, createdAt: item.createdAt,
      group: item.group ?? null,
      album: item.album ?? null,
    }));
  return JSON.stringify({ version: STORAGE_VERSION, items: kept });
}

const isText = (value) => typeof value === 'string' && value !== '';

/**
 * Lee lo guardado y lo deja listo para seguir: lo que esperaba vuelve a «Publicándose» (con su fecha, así que el
 * plazo de 10 minutos se respeta), lo que estaba a medias con copia local queda en error con Reintentar y lo demás
 * se descarta. Nunca lanza.
 */
export function parseItems(raw) {
  let data;
  try {
    data = JSON.parse(raw ?? 'null');
  } catch {
    return [];
  }
  if (!data || data.version !== STORAGE_VERSION || !Array.isArray(data.items)) return [];
  const result = [];
  for (const entry of data.items) {
    if (!entry || !isText(entry.key) || !isText(entry.title)) continue;
    const base = {
      ...createItem({
        key: entry.key,
        name: isText(entry.name) ? entry.name : entry.title,
        title: entry.title,
        createdAt: Number(entry.createdAt) || 0,
        group: entry.group,
        album: entry.album,
      }),
      localId: isText(entry.localId) ? entry.localId : null,
      serverName: isText(entry.serverName) ? entry.serverName : null,
      knownIds: Array.isArray(entry.knownIds) ? entry.knownIds.filter(isText) : [],
      savedAt: Number.isFinite(entry.savedAt) ? entry.savedAt : null,
    };
    if ((WAITING_STATES.includes(entry.state) || entry.state === S.SLOW) && base.savedAt !== null) {
      result.push({ ...base, state: entry.state === S.SLOW ? S.SLOW : S.PUBLISHING, fraction: 1 });
    } else if (base.localId) {
      const message = entry.state === S.ERROR && isText(entry.error) ? entry.error : INTERRUPTED_TEXT;
      result.push({ ...base, state: S.ERROR, error: message, retryable: true });
    }
  }
  return result;
}

function readStorage(storage) {
  try {
    return storage?.getItem(STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

function writeStorage(storage, value) {
  try {
    if (!storage) return;
    if (value === null) storage.removeItem(STORAGE_KEY);
    else storage.setItem(STORAGE_KEY, value);
  } catch {
    // Almacenamiento bloqueado o lleno: las subidas siguen durante esta visita.
  }
}

// ---------------------------------------------------------------------------------------------
// Gestor de subidas
// ---------------------------------------------------------------------------------------------

/**
 * Crea el gestor. Dependencias (todas inyectables para las pruebas):
 * - convert(file, { onProgress({ fraction }) }) → { bytes, durationS, channels, bitrate }. Si el archivo es una fuente
 *   perezosa (una canción de un ZIP, con open()), primero se abre (se descomprime) y solo vive mientras se convierte.
 * - saveCopy({ title, bytes, durationS, channels, bitrate }) → canción local ({ id, … }); su fallo no para la subida
 * - readCopy(localId) → Uint8Array | null (para reintentar tras recargar)
 * - send(bytes, { fileName, onChunk({ index, total }) }) → respuesta del último trozo ({ nombre, … })
 * - fetchSongs() → la lista de /data/songs.json, leída sin caché
 * - currentIds() → ids que ya conoce la app (si no se puede leer songs.json antes de subir)
 * - onCopy(song), onPublished([{ item, song }], songs), onChange(items)
 * - storage (localStorage), now, setTimer, clearTimer, newKey, pollMs, maxWaitMs, savedPauseMs
 */
export function createUploadTracker(deps = {}) {
  const {
    convert,
    saveCopy = async () => null,
    readCopy = async () => null,
    send,
    fetchSongs = async () => null,
    currentIds = () => [],
    onCopy = () => {},
    onPublished = () => {},
    storage = null,
    now = () => Date.now(),
    setTimer = (fn, ms) => setTimeout(fn, ms),
    clearTimer = (id) => clearTimeout(id),
    newKey = defaultKey,
    pollMs = POLL_MS,
    maxWaitMs = MAX_WAIT_MS,
    savedPauseMs = SAVED_PAUSE_MS,
  } = deps;

  const entries = []; // { item, file, bytes }
  const listeners = new Set();
  let pumping = false;
  let pollTimer = null;
  let polling = false;
  const pauseTimers = new Set();
  let disposed = false;
  let storedSignature = null;

  const snapshot = () => entries.map((entry) => ({ ...entry.item }));

  function emit() {
    if (disposed) return;
    const items = snapshot();
    // localStorage solo se escribe si cambia algo que se guarda (no con cada porcentaje).
    const signature = items.map((item) => `${item.key}:${item.state}:${item.localId}:${item.serverName}:${item.knownIds?.length ?? -1}:${item.error}`).join('|');
    if (signature !== storedSignature) {
      storedSignature = signature;
      writeStorage(storage, items.some((item) => PERSISTED_STATES.includes(item.state)) ? serializeItems(items) : null);
    }
    for (const listener of [...listeners]) {
      try {
        listener(items);
      } catch (error) {
        console.error('Reminiscencia: error al pintar el estado de una subida.', error);
      }
    }
  }

  function dispatch(entry, event) {
    const next = transition(entry.item, event);
    if (next === entry.item) return false;
    entry.item = next;
    emit();
    return true;
  }

  const find = (key) => entries.find((entry) => entry.item.key === key) ?? null;

  async function baselineIds() {
    try {
      const songs = await fetchSongs();
      if (Array.isArray(songs)) return idsOf(songs);
    } catch {
      // Sin red: valen los ids que ya tiene la app.
    }
    try {
      return [...(currentIds() ?? [])];
    } catch {
      return [];
    }
  }

  function failMessage(error) {
    if (error && typeof error.message === 'string' && error.message && ['PublicUploadError', 'LocalAudioError', 'ZipError'].includes(error.name)) {
      return error.message;
    }
    console.error('Reminiscencia: fallo al subir un archivo.', error);
    return 'No se ha podido subir este archivo.';
  }

  async function processEntry(entry) {
    const knownIds = await baselineIds();
    let bytes = entry.bytes;
    if (!entry.item.localId || !bytes) {
      if (entry.item.localId && !bytes) bytes = await readCopy(entry.item.localId).catch(() => null);
      if (!bytes) {
        if (!entry.file) throw Object.assign(new Error(LOST_FILE_TEXT), { name: 'LocalAudioError', lost: true });
        dispatch(entry, { type: 'convert', fraction: 0 });
        // Una canción de un ZIP se descomprime ahora, justo antes de convertirla, y se suelta al terminar.
        const source = typeof entry.file.open === 'function' ? await entry.file.open() : entry.file;
        const converted = await convert(source, { onProgress: ({ fraction }) => dispatch(entry, { type: 'convert', fraction }) });
        bytes = converted.bytes;
        if (!entry.item.localId) {
          try {
            const song = await saveCopy({ title: entry.item.title, ...converted });
            if (song?.id) {
              entry.item = { ...entry.item, localId: song.id };
              onCopy(song);
            }
          } catch (error) {
            console.warn('Reminiscencia: no se ha podido guardar la copia local de la subida.', error);
          }
        }
      }
    }
    entry.bytes = bytes;
    dispatch(entry, { type: 'converted', localId: entry.item.localId });
    const result = await send(bytes, {
      fileName: entry.item.name,
      album: entry.item.album,
      onChunk: ({ index, total }) => dispatch(entry, { type: 'send', fraction: (index + 1) / total }),
    });
    dispatch(entry, { type: 'saved', serverName: result?.nombre, at: now(), knownIds });
    // Ya está en GitHub: no hace falta conservar el archivo (ni el ZIP del que sale) ni los bytes.
    entry.file = null;
    entry.bytes = null;
    const timer = setTimer(() => {
      pauseTimers.delete(timer);
      dispatch(entry, { type: 'publishing' });
    }, savedPauseMs);
    pauseTimers.add(timer);
    schedulePoll(pollMs);
  }

  async function pump() {
    if (pumping) return;
    pumping = true;
    try {
      for (;;) {
        if (disposed) return;
        const entry = entries.find((candidate) => candidate.item.state === S.QUEUED);
        if (!entry) return;
        try {
          await processEntry(entry);
        } catch (error) {
          const message = failMessage(error);
          dispatch(entry, { type: 'fail', message, retryable: !error?.lost && !error?.permanent && Boolean(entry.file || entry.item.localId) });
          // Un error que no se arregla reintentando (por ejemplo, una canción cifrada en el ZIP) suelta el archivo.
          if (error?.permanent) entry.file = null;
          // Un fallo de configuración del servidor afectaría igual a las demás: no se intentan.
          if (error?.stop) {
            for (const other of entries) if (other.item.state === S.QUEUED) dispatch(other, { type: 'fail', message, retryable: true });
          }
        }
      }
    } finally {
      pumping = false;
    }
  }

  function schedulePoll(delay) {
    if (disposed || pollTimer !== null || polling) return;
    pollTimer = setTimer(() => {
      pollTimer = null;
      check();
    }, delay);
  }

  /** Comprueba songs.json una vez. Las que esperan y ya están pasan a «Publicada»; las que pasan del plazo, a «tarde». */
  async function check() {
    if (disposed || polling) return;
    const watched = entries.filter((entry) => WAITING_STATES.includes(entry.item.state) || entry.item.state === S.SLOW);
    if (watched.length === 0) return;
    polling = true;
    let songs = null;
    try {
      songs = await fetchSongs();
    } catch {
      songs = null;
    } finally {
      polling = false;
    }
    if (disposed) return;
    const found = [];
    if (Array.isArray(songs)) {
      const claimed = new Set(entries.map((entry) => entry.item.songId).filter(Boolean));
      const ordered = entries
        .filter((entry) => WAITING_STATES.includes(entry.item.state) || entry.item.state === S.SLOW)
        .sort((a, b) => (a.item.savedAt ?? 0) - (b.item.savedAt ?? 0));
      for (const entry of ordered) {
        const song = findNewSong(songs, { titles: titleCandidates(entry.item), knownIds: [...(entry.item.knownIds ?? []), ...claimed] });
        if (!song) continue;
        claimed.add(song.id);
        entry.item = transition(entry.item, { type: 'published', songId: song.id, songTitle: song.title });
        found.push({ item: { ...entry.item }, song });
      }
      // Una canción reconocida no vale para ninguna otra subida, tampoco tras recargar.
      if (found.length > 0) {
        for (const entry of entries) {
          if (entry.item.state !== S.PUBLISHED && entry.item.knownIds) {
            entry.item = { ...entry.item, knownIds: [...new Set([...entry.item.knownIds, ...found.map((hit) => hit.song.id)])] };
          }
        }
      }
    }
    const at = now();
    for (const entry of entries) {
      if (WAITING_STATES.includes(entry.item.state) && at - (entry.item.savedAt ?? at) >= maxWaitMs) {
        entry.item = transition(entry.item, { type: 'slow' });
      }
    }
    // La biblioteca se pone al día antes de pintar «Publicada»: así «Reproducir» ya encuentra la canción.
    if (found.length > 0) {
      try {
        await onPublished(found, songs);
      } catch (error) {
        console.error('Reminiscencia: fallo al poner al día la biblioteca.', error);
      }
    }
    if (disposed) return;
    emit();
    if (entries.some((entry) => WAITING_STATES.includes(entry.item.state))) schedulePoll(pollMs);
  }

  /**
   * Añade subidas ya preparadas (subida-zip.js): [{ file, name, title, group, error }]. Con error, la subida entra
   * directamente en «Error» sin Reintentar (por ejemplo, un ZIP dañado). Devuelve las claves.
   */
  function addSources(sources, { album = null } = {}) {
    const keys = [];
    for (const source of Array.from(sources ?? [])) {
      const key = newKey();
      const item = createItem({
        key,
        name: source?.name || 'Sin nombre',
        title: source?.title ?? '',
        createdAt: now(),
        group: source?.group,
        album: source?.album ?? album,
      });
      if (source?.error) {
        entries.push({ item: { ...item, state: S.ERROR, error: String(source.error), retryable: false }, file: null, bytes: null });
      } else {
        entries.push({ item, file: source?.file ?? null, bytes: null });
      }
      keys.push(key);
    }
    if (keys.length > 0) emit();
    pump();
    return keys;
  }

  return {
    /** Copia de las subidas, en el orden en que se eligieron. */
    items: snapshot,
    /** listener(items) tras cada cambio. Devuelve la función para dejar de escuchar. */
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    /** Añade archivos a la cola (se suben de uno en uno y en orden). Devuelve las claves. */
    add(files, { titleOf = (file) => file?.name ?? '', album = null } = {}) {
      return addSources(Array.from(files ?? []).map((file) => ({ file, name: file?.name, title: titleOf(file) })), { album });
    },
    addSources,
    /** Vuelve a poner en cola una subida con error. true si se ha podido. */
    retry(key) {
      const entry = find(key);
      if (!entry || !dispatch(entry, { type: 'retry' })) return false;
      pump();
      return true;
    },
    /**
     * Recupera lo guardado en localStorage y, para cada copia local pendiente sin subida conocida (por ejemplo, si
     * el almacenamiento estaba bloqueado), una subida en error con Reintentar. Comprueba songs.json enseguida.
     */
    restore({ pendingCopies = [] } = {}) {
      const restored = parseItems(readStorage(storage));
      const known = new Set(entries.map((entry) => entry.item.key));
      for (const item of restored) {
        if (known.has(item.key)) continue;
        entries.push({ item, file: null, bytes: null });
        known.add(item.key);
      }
      const withCopy = new Set(entries.map((entry) => entry.item.localId).filter(Boolean));
      for (const copy of pendingCopies) {
        if (!copy?.id || withCopy.has(copy.id)) continue;
        const item = { ...createItem({ key: newKey(), name: copy.title, title: copy.title, createdAt: copy.createdAt ?? 0 }), localId: copy.id };
        entries.push({ item: { ...item, state: S.ERROR, error: INTERRUPTED_TEXT, retryable: true }, file: null, bytes: null });
      }
      emit();
      if (entries.some((entry) => WAITING_STATES.includes(entry.item.state) || entry.item.state === S.SLOW)) check();
    },
    /** Estado de una subida por el id de su copia local, o null. */
    byLocalId(localId) {
      const entry = entries.find((candidate) => candidate.item.localId === localId);
      return entry ? { ...entry.item } : null;
    },
    /** ¿Hay archivos convirtiéndose o subiéndose? (perderlos al cerrar la página sí importa). */
    busy: () => entries.some((entry) => [S.QUEUED, S.CONVERTING, S.SENDING].includes(entry.item.state)),
    /** Comprueba songs.json ahora mismo (pruebas y vuelta a la pestaña). */
    checkNow: () => check(),
    dispose() {
      disposed = true;
      if (pollTimer !== null) clearTimer(pollTimer);
      for (const timer of pauseTimers) clearTimer(timer);
      pauseTimers.clear();
      listeners.clear();
    },
  };
}

let keySeq = 0;
function defaultKey() {
  try {
    if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  } catch {
    // Sin crypto: un contador basta para esta visita.
  }
  keySeq += 1;
  return `subida-${Date.now().toString(36)}-${keySeq}`;
}
