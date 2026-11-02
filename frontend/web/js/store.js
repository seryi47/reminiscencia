// Almacén local de Reminiscencia sobre IndexedDB (base 'reminiscencia', versión 2).
// Los datos no salen del navegador. Cada escritura se valida con schema.js antes de tocar la base,
// y los cambios que afectan a varios almacenes van en una sola transacción: o se hacen todos o ninguno.
// Dentro de una transacción solo se espera a peticiones de IndexedDB. El cifrado y los hashes se calculan
// antes de abrirla, porque la transacción se cierra sola si se espera a otra cosa.
// Las preferencias de pantalla no están aquí: van en prefs.js (localStorage).

import { hashPin, randomId, verifyPin } from './crypto.js';
import {
  isCalendarDay,
  isId,
  isPlainObject,
  isSongId,
  PHOTO_MAX_BYTES,
  PHOTO_TYPES,
  SETTING_KEYS,
  STUDY_PRESENTATIONS,
  validateAlias,
  validateHistoryEntry,
  validateLastTrack,
  validateMemory,
  validateObservation,
  validatePatientOptions,
  validatePhotoMeta,
  validatePin as validatePinFormat,
  validatePlaylist,
  validateProfile,
  validateSettings,
  validateSongLink,
  validateStudyEvent,
  validateStudyRecord,
} from './schema.js';
import { buildBackup, previewBackup as previewBackupFile, restoreBackup } from './backup.js';

export { validateAlias } from './schema.js';

// Contrato 2.3: null si el PIN es válido (de 4 a 6 dígitos) o el mensaje en español.
export function validatePin(pin) {
  return validatePinFormat(pin)[0] ?? null;
}

export const DB_NAME = 'reminiscencia';
export const DB_VERSION = 2;

// Bloqueo del PIN (DESIGN D12): cinco fallos seguidos bloquean 60 segundos. El bloqueo no borra nada.
export const PIN_MAX_FAILURES = 5;
export const PIN_LOCK_MS = 60 * 1000;

// Ajustes del dispositivo (IndexedDB). Las preferencias de pantalla están en prefs.js.
export const DEFAULT_SETTINGS = Object.freeze({
  sleepTimerMinutes: null,
  alwaysPatientMode: false,
  wakeLock: true,
});

export const DEFAULT_PATIENT_OPTIONS = Object.freeze({
  volumeLimit: 100,
  repeatList: true,
  resumeOnOpen: false,
  seekOnTap: false,
});

const DATA_STORES = Object.freeze([
  'profiles', 'songLinks', 'memories', 'photos', 'playlists', 'observations', 'history', 'studyEvents',
]);
const CHILD_STORES = Object.freeze([
  'songLinks', 'memories', 'photos', 'playlists', 'observations', 'history', 'studyEvents',
]);
// Almacenes que una copia anterior a su creación no trae: se importan vacíos.
const OPTIONAL_STORES = Object.freeze(['studyEvents']);
const RECORD_VALIDATORS = Object.freeze({
  profiles: validateProfile,
  songLinks: validateSongLink,
  memories: validateMemory,
  photos: validatePhotoMeta,
  playlists: validatePlaylist,
  observations: validateObservation,
  history: validateHistoryEntry,
  studyEvents: validateStudyRecord,
});
const SONG_LINK_FIELDS = Object.freeze(['familiarity', 'preference', 'notes']);
const MEMORY_FIELDS = Object.freeze(['title', 'text', 'year', 'people', 'songIds', 'photoIds']);
const PLAYLIST_FIELDS = Object.freeze(['name', 'songIds']);
const FIRST_DAY = '0000-01-01';
const LAST_DAY = '9999-12-31';

// Fecha que decide qué versión gana al combinar copias: la más reciente.
const defaultStamp = (record) => record.updatedAt ?? record.at ?? record.createdAt ?? 0;

// Clave de cada registro al combinar. songLinks usa la clave compuesta [profileId, songId].
const keyOf = (storeName) => (storeName === 'songLinks'
  ? (record) => `${record.profileId}/${record.songId}`
  : (record) => record.id);

// Decide qué registros entrantes se escriben al combinar. Gana el más reciente;
// en empate, o si el local es más nuevo, se conserva el local. Función pura, sin IndexedDB.
export function planMerge(existing, incoming, keyFn = (record) => record.id, stampFn = defaultStamp) {
  const local = new Map(existing.map((record) => [keyFn(record), record]));
  return incoming.filter((record) => {
    const current = local.get(keyFn(record));
    return !current || stampFn(record) > stampFn(current);
  });
}

const compareText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const byId = (a, b) => compareText(a.id, b.id);
const oldestFirst = (field) => (a, b) => a[field] - b[field] || byId(a, b);
const newestFirst = (field) => (a, b) => b[field] - a[field] || byId(a, b);

const normalizeMime = (type) => String(type ?? '').split(';')[0].trim().toLowerCase();

// Copia solo los campos presentes (los undefined se ignoran).
function pickChanges(source, fields) {
  const changes = {};
  for (const field of fields) {
    if (source[field] !== undefined) changes[field] = source[field];
  }
  return changes;
}

// Cambios permitidos: rechaza cualquier campo que no esté en la lista.
function allowedChanges(patch, allowed) {
  if (!isPlainObject(patch)) throw new Error('Los cambios no son válidos.');
  const unknown = Object.keys(patch).find((key) => !allowed.includes(key));
  if (unknown !== undefined) throw new Error('Hay un campo que no se puede cambiar así.');
  return pickChanges(patch, allowed);
}

// Limpia lo que escribe una persona en el editor de recuerdos antes de validarlo.
function normalizeMemoryChanges(input) {
  const changes = pickChanges(input, MEMORY_FIELDS);
  if (typeof changes.title === 'string') changes.title = changes.title.trim();
  if (typeof changes.text === 'string') changes.text = changes.text.trim();
  if (changes.year === '') changes.year = null;
  if (typeof changes.year === 'string' && /^[0-9]+$/.test(changes.year)) changes.year = Number(changes.year);
  if (Array.isArray(changes.people)) {
    changes.people = changes.people
      .map((person) => (typeof person === 'string' ? person.trim() : person))
      .filter((person) => person !== '');
  }
  return changes;
}

// Solo las claves de ajustes del dispositivo: los restos de versiones anteriores se ignoran.
const pickSettings = (source) => Object.fromEntries(
  SETTING_KEYS.filter((key) => source[key] !== undefined).map((key) => [key, source[key]]),
);

// ---------------------------------------------------------------------------
// Registro del estudio: funciones puras (sin IndexedDB), probadas por separado.
// ---------------------------------------------------------------------------

// Día de un evento: la fecha tal como se registró, con su zona (AAAA-MM-DD).
export const studyDayOf = (at) => at.slice(0, 10);

const orNull = (value) => (value === undefined ? null : value);
const roundIfNumber = (value) => (typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : value);

// Prepara un evento que llega de la interfaz: rellena con null lo que no aplica y redondea los segundos.
// Lanza el primer error de validación si el evento no es válido.
export function normalizeStudyEvent(event) {
  if (!isPlainObject(event)) throw new Error('El evento del estudio no es válido.');
  const normalized = {
    type: event.type,
    at: event.at,
    sessionId: event.sessionId,
    profileId: event.profileId,
    songId: orNull(event.songId),
    presentation: orNull(event.presentation),
    condition: orNull(event.condition),
    origin: orNull(event.origin),
    seconds: event.seconds === undefined || event.seconds === null ? null : roundIfNumber(event.seconds),
    completed: orNull(event.completed),
    trackSeconds: event.trackSeconds === undefined || event.trackSeconds === null
      ? null
      : roundIfNumber(event.trackSeconds),
  };
  const errors = validateStudyEvent(normalized);
  if (errors.length > 0) throw new Error(errors[0]);
  return normalized;
}

// Última pista de un perfil: redondea la posición y valida el conjunto.
export function normalizeLastTrack(track) {
  if (!isPlainObject(track)) throw new Error('La última pista no es válida.');
  const normalized = {
    songId: track.songId,
    position: roundIfNumber(track.position),
    origin: track.origin,
    at: track.at,
  };
  const errors = validateLastTrack(normalized);
  if (errors.length > 0) throw new Error(errors[0]);
  return normalized;
}

// Filtros del registro. Las fechas son días AAAA-MM-DD e incluyen el día inicial y el final.
export function normalizeStudyFilters(filters = {}) {
  if (!isPlainObject(filters)) throw new Error('El filtro del registro no es válido.');
  const query = {};
  for (const key of ['from', 'to']) {
    if (filters[key] !== undefined) {
      if (!isCalendarDay(filters[key])) throw new Error('Las fechas del filtro deben tener el formato AAAA-MM-DD.');
      query[key] = filters[key];
    }
  }
  if (query.from !== undefined && query.to !== undefined && query.from > query.to) {
    throw new Error('El rango de fechas no es válido.');
  }
  if (filters.sessionId !== undefined) {
    if (!isId(filters.sessionId)) throw new Error('Sesión no válida.');
    query.sessionId = filters.sessionId;
  }
  if (filters.profileId !== undefined) {
    if (!isId(filters.profileId)) throw new Error('Perfil no válido.');
    query.profileId = filters.profileId;
  }
  if (filters.presentation !== undefined) {
    if (!STUDY_PRESENTATIONS.includes(filters.presentation)) throw new Error('Presentación no válida.');
    query.presentation = filters.presentation;
  }
  return query;
}

// Orden cronológico: por hora, luego por clave local y por identificador.
const byTime = (a, b) => Date.parse(a.at) - Date.parse(b.at)
  || (a.seq ?? 0) - (b.seq ?? 0)
  || compareText(a.id ?? '', b.id ?? '');

// Filtra y ordena los eventos. Función pura: los filtros de sesión, perfil y presentación se aplican aquí
// aunque el índice ya haya acotado la lectura, para que el resultado no dependa de qué índice se usó.
export function selectStudyEvents(records, query = {}) {
  return records
    .filter((record) => {
      const day = record.day ?? studyDayOf(record.at);
      return (query.from === undefined || day >= query.from)
        && (query.to === undefined || day <= query.to)
        && (query.sessionId === undefined || record.sessionId === query.sessionId)
        && (query.profileId === undefined || record.profileId === query.profileId)
        && (query.presentation === undefined || record.presentation === query.presentation);
    })
    .sort(byTime);
}

// Una fila del historial (DESIGN C-24). «Fotografía mostrada» y «recuerdo mostrado» salen de la presentación
// efectiva: C2 muestra foto y recuerdo; C1, solo recuerdo; C0, nada.
function toHistoryRow(event) {
  const percent = event.trackSeconds
    ? Math.min(100, Math.round(((event.seconds ?? 0) / event.trackSeconds) * 100))
    : null;
  return {
    id: event.id,
    at: event.at,
    time: event.at.slice(11, 16),
    songId: event.songId,
    seconds: event.seconds,
    percent,
    completed: event.completed,
    photoShown: event.presentation === 'C2',
    memoryShown: event.presentation === 'C1' || event.presentation === 'C2',
    presentation: event.presentation,
    origin: event.origin,
    condition: event.condition,
    sessionId: event.sessionId,
  };
}

// Historial de escuchas agrupado por día, el más reciente primero. Cada fin de pista es una escucha.
// El resumen cuenta escuchas, minutos (redondeados) y saltadas (final no completo). Función pura.
export function buildListeningHistory(events) {
  const byDay = new Map();
  for (const event of events) {
    if (event.type !== 'track-end') continue;
    const day = event.day ?? studyDayOf(event.at);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(event);
  }
  return [...byDay.keys()].sort(compareText).reverse().map((day) => {
    const plays = byDay.get(day).sort(byTime).reverse();
    const rows = plays.map(toHistoryRow);
    const seconds = plays.reduce((total, play) => total + (play.seconds ?? 0), 0);
    return {
      day,
      summary: {
        listens: rows.length,
        minutes: Math.round(seconds / 60),
        skipped: rows.filter((row) => row.completed === false).length,
      },
      rows,
    };
  });
}

// ---------------------------------------------------------------------------
// Bloqueo del PIN: funciones puras. El estado es { failures, lockedUntil } (lockedUntil en milisegundos o null).
// ---------------------------------------------------------------------------

// Estado vigente: un bloqueo que ya caducó se trata como si no hubiera existido, y el recuento empieza de cero.
export function activePinLockout(state, now) {
  const failures = isPlainObject(state) && Number.isSafeInteger(state.failures) && state.failures >= 0
    ? state.failures
    : 0;
  const lockedUntil = isPlainObject(state) && typeof state.lockedUntil === 'number' ? state.lockedUntil : null;
  if (lockedUntil === null) return { failures, lockedUntil: null };
  if (lockedUntil > now) return { failures, lockedUntil };
  return { failures: 0, lockedUntil: null };
}

// Estado siguiente tras un intento. Durante el bloqueo el intento no cuenta y no cambia nada.
export function nextPinLockout(state, ok, now) {
  if (typeof ok !== 'boolean') throw new Error('El resultado del intento no es válido.');
  const current = activePinLockout(state, now);
  if (current.lockedUntil !== null) return current;
  if (ok) return { failures: 0, lockedUntil: null };
  const failures = current.failures + 1;
  return failures >= PIN_MAX_FAILURES
    ? { failures, lockedUntil: now + PIN_LOCK_MS }
    : { failures, lockedUntil: null };
}

// ---------------------------------------------------------------------------
// Migraciones de esquema: cada versión solo crea lo que falta y nunca borra ni recrea almacenes con datos.
// ---------------------------------------------------------------------------

const INDEX_KEY_PATHS = Object.freeze({ byProfile: 'profileId', bySession: 'sessionId', byDay: 'day' });

function createStoreIfMissing(db, name, options, indexNames = []) {
  if (db.objectStoreNames.contains(name)) return;
  const store = db.createObjectStore(name, options);
  for (const indexName of indexNames) store.createIndex(indexName, INDEX_KEY_PATHS[indexName]);
}

// Versión 1: el esquema original.
function createBaseSchema(db) {
  createStoreIfMissing(db, 'meta', { keyPath: 'key' });
  createStoreIfMissing(db, 'profiles', { keyPath: 'id' });
  createStoreIfMissing(db, 'songLinks', { keyPath: ['profileId', 'songId'] }, ['byProfile']);
  for (const name of ['memories', 'photos', 'playlists', 'observations', 'history']) {
    createStoreIfMissing(db, name, { keyPath: 'id' }, ['byProfile']);
  }
}

// Versión 2: registro del estudio. La clave local (seq) es autoincremental; el identificador (id) une copias sin duplicar.
function createStudySchema(db) {
  createStoreIfMissing(db, 'studyEvents', { keyPath: 'seq', autoIncrement: true }, ['bySession', 'byProfile', 'byDay']);
}

export const SCHEMA_MIGRATIONS = Object.freeze([
  Object.freeze({ version: 1, apply: createBaseSchema }),
  Object.freeze({ version: 2, apply: createStudySchema }),
]);

// Migraciones que faltan para pasar de una versión a otra. Función pura sobre la tabla de migraciones.
export function pendingMigrations(oldVersion, newVersion = DB_VERSION) {
  return SCHEMA_MIGRATIONS.filter((migration) => migration.version > oldVersion && migration.version <= newVersion);
}

// Aplica en orden las migraciones pendientes sobre la base (se llama desde onupgradeneeded).
export function runMigrations(db, oldVersion, newVersion = DB_VERSION) {
  for (const migration of pendingMigrations(oldVersion, newVersion)) migration.apply(db);
}

function storageError(error) {
  if (error?.name === 'QuotaExceededError') {
    return new Error('No hay espacio suficiente en el dispositivo para guardar los datos.');
  }
  return new Error('No se pudo completar la operación en el almacenamiento local.');
}

// Espera el resultado de una petición de IndexedDB.
function request(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(storageError(req.error));
  });
}

// Espera a que una transacción se confirme o falle.
function finished(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(storageError(tx.error));
    tx.onabort = () => reject(storageError(tx.error));
  });
}

// Ejecuta trabajo sobre una transacción. Si el trabajo falla, la transacción se aborta
// y no queda ninguna escritura a medias.
async function inTransaction(db, names, mode, work) {
  let tx;
  try {
    tx = db.transaction(names, mode);
  } catch (error) {
    throw storageError(error);
  }
  const done = finished(tx);
  done.catch(() => {});
  try {
    const result = await work(tx);
    await done;
    return result;
  } catch (error) {
    try {
      tx.abort();
    } catch {
      // La transacción ya había terminado: no hay nada que abortar.
    }
    throw error;
  }
}

// Abre (o crea) el almacén. La fábrica de IndexedDB se puede inyectar para pruebas.
export function openStore({ indexedDB: factory = globalThis.indexedDB, name = DB_NAME } = {}) {
  return new Promise((resolve, reject) => {
    if (!factory) {
      reject(new Error('Este navegador no permite guardar datos en el dispositivo.'));
      return;
    }
    let settled = false;
    let opening;
    try {
      opening = factory.open(name, DB_VERSION);
    } catch {
      reject(new Error('No se pudo abrir el almacenamiento local.'));
      return;
    }
    opening.onupgradeneeded = (event) => {
      runMigrations(opening.result, event.oldVersion, DB_VERSION);
    };
    opening.onsuccess = () => {
      const db = opening.result;
      if (settled) {
        // Ya se había rechazado por bloqueo: no dejamos la conexión abierta.
        db.close();
        return;
      }
      settled = true;
      resolve(createStore(db));
    };
    opening.onerror = () => {
      if (!settled) {
        settled = true;
        reject(new Error('No se pudo abrir el almacenamiento local.'));
      }
    };
    opening.onblocked = () => {
      if (!settled) {
        settled = true;
        reject(new Error('El almacenamiento está abierto en otra pestaña. Ciérrala e inténtalo de nuevo.'));
      }
    };
  });
}

function createStore(db) {
  db.onversionchange = () => db.close();

  const run = (names, mode, work) => inTransaction(db, names, mode, work);
  const metaValue = (key) => run(['meta'], 'readonly', async (t) => {
    const record = await request(t.objectStore('meta').get(key));
    return record ? record.value : null;
  });
  const listByProfile = (storeName, profileId) => run([storeName], 'readonly',
    (t) => request(t.objectStore(storeName).index('byProfile').getAll(profileId)));
  const getAllRecords = (storeName) => run([storeName], 'readonly',
    (t) => request(t.objectStore(storeName).getAll()));
  const ensureProfile = async (t, profileId) => {
    const profile = await request(t.objectStore('profiles').get(profileId));
    if (!profile) throw new Error('El perfil no existe.');
    return profile;
  };
  const assertProfileId = (profileId) => {
    if (!isId(profileId)) throw new Error('Perfil no válido.');
  };
  const assertSongLinkKey = (profileId, songId) => {
    assertProfileId(profileId);
    if (!isSongId(songId)) throw new Error('Canción no válida.');
  };

  // Lee los candidatos con el índice más útil; el filtro completo se aplica después en memoria.
  const readStudyCandidates = (t, query) => {
    const store = t.objectStore('studyEvents');
    if (query.sessionId !== undefined) return request(store.index('bySession').getAll(query.sessionId));
    if (query.profileId !== undefined) return request(store.index('byProfile').getAll(query.profileId));
    if (query.from !== undefined || query.to !== undefined) {
      return request(store.index('byDay').getAll(IDBKeyRange.bound(query.from ?? FIRST_DAY, query.to ?? LAST_DAY)));
    }
    return request(store.getAll());
  };
  const readStudyEvents = async (filters) => {
    const query = normalizeStudyFilters(filters);
    const records = await run(['studyEvents'], 'readonly', (t) => readStudyCandidates(t, query));
    return selectStudyEvents(records, query);
  };

  const api = {
    // Ajustes del dispositivo (IndexedDB). Las preferencias de pantalla están en prefs.js.
    async getSettings() {
      return { ...DEFAULT_SETTINGS, ...pickSettings((await metaValue('settings')) ?? {}) };
    },

    async saveSettings(patch) {
      const errors = validateSettings(patch, { partial: true });
      if (errors.length > 0) throw new Error(errors[0]);
      return run(['meta'], 'readwrite', async (t) => {
        const meta = t.objectStore('meta');
        const record = await request(meta.get('settings'));
        const next = { ...DEFAULT_SETTINGS, ...pickSettings(record?.value ?? {}), ...patch };
        meta.put({ key: 'settings', value: next });
        return next;
      });
    },

    getLastBackupAt() {
      return metaValue('lastBackupAt');
    },

    // Perfil activo.
    getActiveProfileId() {
      return metaValue('activeProfile');
    },

    async setActiveProfileId(profileId) {
      if (profileId !== null) assertProfileId(profileId);
      await run(['meta', 'profiles'], 'readwrite', async (t) => {
        if (profileId !== null) await ensureProfile(t, profileId);
        t.objectStore('meta').put({ key: 'activeProfile', value: profileId });
      });
    },

    // Perfiles. Opciones del paciente y código de participante viven dentro del perfil.
    async listProfiles() {
      return (await getAllRecords('profiles')).sort(oldestFirst('createdAt'));
    },

    async createProfile(input) {
      const { alias, code = '' } = isPlainObject(input) ? input : {};
      const aliasErrors = validateAlias(alias);
      if (aliasErrors.length > 0) throw new Error(aliasErrors[0]);
      if (typeof code !== 'string') throw new Error('El código del participante debe ser texto.');
      const now = Date.now();
      const profile = {
        id: randomId(),
        alias: alias.trim(),
        code: code.trim(),
        options: { ...DEFAULT_PATIENT_OPTIONS },
        createdAt: now,
        updatedAt: now,
      };
      const errors = validateProfile(profile);
      if (errors.length > 0) throw new Error(errors[0]);
      await run(['profiles'], 'readwrite', (t) => {
        t.objectStore('profiles').put(profile);
      });
      return profile;
    },

    async renameProfile(profileId, alias) {
      assertProfileId(profileId);
      const errors = validateAlias(alias);
      if (errors.length > 0) throw new Error(errors[0]);
      return run(['profiles'], 'readwrite', async (t) => {
        const current = await ensureProfile(t, profileId);
        const next = { ...current, alias: alias.trim(), updatedAt: Date.now() };
        t.objectStore('profiles').put(next);
        return next;
      });
    },

    // Cambia el código del participante y/o las opciones del paciente (parciales).
    async updateProfile(profileId, patch) {
      assertProfileId(profileId);
      const changes = allowedChanges(patch, ['code', 'options']);
      if (changes.options !== undefined) {
        const errors = validatePatientOptions(changes.options, { partial: true });
        if (errors.length > 0) throw new Error(errors[0]);
      }
      if (typeof changes.code === 'string') changes.code = changes.code.trim();
      return run(['profiles'], 'readwrite', async (t) => {
        const current = await ensureProfile(t, profileId);
        const next = {
          ...current,
          ...(changes.code !== undefined ? { code: changes.code } : {}),
          options: { ...current.options, ...(changes.options ?? {}) },
          updatedAt: Date.now(),
        };
        const errors = validateProfile(next);
        if (errors.length > 0) throw new Error(errors[0]);
        t.objectStore('profiles').put(next);
        return next;
      });
    },

    // Última pista del perfil (en el propio registro del perfil). null la quita.
    // No cambia updatedAt: guardar la pista no debe ganar a una edición del perfil al combinar copias.
    async saveLastTrack(profileId, track) {
      assertProfileId(profileId);
      const next = track === null ? null : normalizeLastTrack(track);
      return run(['profiles'], 'readwrite', async (t) => {
        const store = t.objectStore('profiles');
        const current = await ensureProfile(t, profileId);
        const updated = { ...current };
        if (next === null) delete updated.lastTrack;
        else updated.lastTrack = next;
        const errors = validateProfile(updated);
        if (errors.length > 0) throw new Error(errors[0]);
        store.put(updated);
        return next;
      });
    },

    async getLastTrack(profileId) {
      assertProfileId(profileId);
      return run(['profiles'], 'readonly', async (t) => {
        const profile = await request(t.objectStore('profiles').get(profileId));
        return profile?.lastTrack ?? null;
      });
    },

    // Borra el perfil y todo lo que cuelga de él (en cascada), en una sola transacción.
    async deleteProfile(profileId) {
      if (!isId(profileId)) return;
      await run([...DATA_STORES, 'meta'], 'readwrite', async (t) => {
        t.objectStore('profiles').delete(profileId);
        for (const name of CHILD_STORES) {
          const store = t.objectStore(name);
          const keys = await request(store.index('byProfile').getAllKeys(profileId));
          for (const key of keys) store.delete(key);
        }
        const meta = t.objectStore('meta');
        const active = await request(meta.get('activeProfile'));
        if (active?.value === profileId) meta.put({ key: 'activeProfile', value: null });
      });
    },

    // Asociación perfil–canción: familiaridad 0–5, preferencia −2 a 2 y notas.
    async getSongLink(profileId, songId) {
      assertSongLinkKey(profileId, songId);
      return run(['songLinks'], 'readonly',
        async (t) => (await request(t.objectStore('songLinks').get([profileId, songId]))) ?? null);
    },

    async setSongLink(profileId, songId, patch = {}) {
      assertSongLinkKey(profileId, songId);
      const changes = allowedChanges(patch, SONG_LINK_FIELDS);
      if (typeof changes.notes === 'string') changes.notes = changes.notes.trim();
      return run(['profiles', 'songLinks'], 'readwrite', async (t) => {
        await ensureProfile(t, profileId);
        const store = t.objectStore('songLinks');
        const current = await request(store.get([profileId, songId]));
        const next = {
          familiarity: 0,
          preference: 0,
          notes: '',
          ...(current ?? {}),
          ...changes,
          profileId,
          songId,
          updatedAt: Date.now(),
        };
        const errors = validateSongLink(next);
        if (errors.length > 0) throw new Error(errors[0]);
        store.put(next);
        return next;
      });
    },

    async listSongLinks(profileId) {
      assertProfileId(profileId);
      return (await listByProfile('songLinks', profileId)).sort(newestFirst('updatedAt'));
    },

    // Recuerdos: crea o actualiza. Al actualizar se conserva createdAt y se pone updatedAt.
    async listMemories(profileId) {
      assertProfileId(profileId);
      return (await listByProfile('memories', profileId)).sort(newestFirst('createdAt'));
    },

    async saveMemory(input) {
      if (!isPlainObject(input)) throw new Error('El recuerdo no es válido.');
      assertProfileId(input.profileId);
      const id = input.id ?? randomId();
      if (!isId(id)) throw new Error('Recuerdo: identificador no válido.');
      const changes = normalizeMemoryChanges(input);
      return run(['profiles', 'memories', 'photos'], 'readwrite', async (t) => {
        await ensureProfile(t, input.profileId);
        const memories = t.objectStore('memories');
        const existing = await request(memories.get(id));
        if (existing && existing.profileId !== input.profileId) {
          throw new Error('Ese recuerdo pertenece a otro perfil.');
        }
        const now = Date.now();
        const next = {
          title: '',
          text: '',
          year: null,
          people: [],
          songIds: [],
          photoIds: [],
          ...(existing ?? {}),
          ...changes,
          id,
          profileId: input.profileId,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        };
        const errors = validateMemory(next);
        if (errors.length > 0) throw new Error(errors[0]);
        const photos = t.objectStore('photos');
        for (const photoId of next.photoIds) {
          const photo = await request(photos.get(photoId));
          if (!photo || photo.profileId !== input.profileId) {
            throw new Error('Una de las fotografías del recuerdo ya no existe.');
          }
        }
        memories.put(next);
        return next;
      });
    },

    async deleteMemory(memoryId) {
      if (!isId(memoryId)) return;
      await run(['memories'], 'readwrite', (t) => {
        t.objectStore('memories').delete(memoryId);
      });
    },

    // Fotografías: JPEG, PNG o WebP, hasta 8 MB. La reducción a 1600 px la hace la interfaz antes.
    async addPhoto(profileId, blob, { caption = '' } = {}) {
      assertProfileId(profileId);
      if (!(blob instanceof Blob)) throw new Error('La fotografía no es un fichero válido.');
      const mime = normalizeMime(blob.type);
      if (!PHOTO_TYPES.includes(mime)) throw new Error('Solo se admiten fotografías JPEG, PNG o WebP.');
      if (blob.size === 0) throw new Error('La fotografía está vacía.');
      if (blob.size > PHOTO_MAX_BYTES) throw new Error('La fotografía supera el tamaño máximo de 8 MB.');
      if (typeof caption !== 'string') throw new Error('La descripción de la fotografía debe ser texto.');
      const photo = { id: randomId(), profileId, blob, mime, caption: caption.trim(), createdAt: Date.now() };
      const errors = validatePhotoMeta(photo);
      if (errors.length > 0) throw new Error(errors[0]);
      await run(['profiles', 'photos'], 'readwrite', async (t) => {
        await ensureProfile(t, profileId);
        t.objectStore('photos').put(photo);
      });
      return photo;
    },

    async listPhotos(profileId) {
      assertProfileId(profileId);
      return (await listByProfile('photos', profileId)).sort(oldestFirst('createdAt'));
    },

    // URL temporal para mostrar la fotografía. El llamador la libera con revokePhotoUrl.
    getPhotoUrl(photo) {
      if (!photo || !(photo.blob instanceof Blob)) throw new Error('La fotografía no tiene datos.');
      return URL.createObjectURL(photo.blob);
    },

    revokePhotoUrl(url) {
      if (typeof url === 'string' && url.startsWith('blob:')) URL.revokeObjectURL(url);
    },

    // Borra la fotografía y quita su referencia de los recuerdos del mismo perfil.
    async deletePhoto(photoId) {
      if (!isId(photoId)) return;
      await run(['photos', 'memories'], 'readwrite', async (t) => {
        const photos = t.objectStore('photos');
        const photo = await request(photos.get(photoId));
        if (!photo) return;
        photos.delete(photoId);
        const memories = t.objectStore('memories');
        const rows = await request(memories.index('byProfile').getAll(photo.profileId));
        const now = Date.now();
        for (const memory of rows) {
          if (memory.photoIds.includes(photoId)) {
            memories.put({
              ...memory,
              photoIds: memory.photoIds.filter((id) => id !== photoId),
              updatedAt: now,
            });
          }
        }
      });
    },

    // Listas de canciones del perfil.
    async listPlaylists(profileId) {
      assertProfileId(profileId);
      return (await listByProfile('playlists', profileId)).sort(oldestFirst('createdAt'));
    },

    async savePlaylist(input) {
      if (!isPlainObject(input)) throw new Error('La lista no es válida.');
      assertProfileId(input.profileId);
      const id = input.id ?? randomId();
      if (!isId(id)) throw new Error('Lista: identificador no válido.');
      const changes = pickChanges(input, PLAYLIST_FIELDS);
      if (typeof changes.name === 'string') changes.name = changes.name.trim();
      return run(['profiles', 'playlists'], 'readwrite', async (t) => {
        await ensureProfile(t, input.profileId);
        const playlists = t.objectStore('playlists');
        const existing = await request(playlists.get(id));
        if (existing && existing.profileId !== input.profileId) {
          throw new Error('Esa lista pertenece a otro perfil.');
        }
        const now = Date.now();
        const next = {
          name: '',
          songIds: [],
          ...(existing ?? {}),
          ...changes,
          id,
          profileId: input.profileId,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        };
        const errors = validatePlaylist(next);
        if (errors.length > 0) throw new Error(errors[0]);
        playlists.put(next);
        return next;
      });
    },

    async deletePlaylist(playlistId) {
      if (!isId(playlistId)) return;
      await run(['playlists'], 'readwrite', (t) => {
        t.objectStore('playlists').delete(playlistId);
      });
    },

    // Observaciones del cuidador, con canción opcional.
    async addObservation(profileId, input) {
      assertProfileId(profileId);
      if (!isPlainObject(input)) throw new Error('La observación no es válida.');
      const record = {
        id: randomId(),
        profileId,
        at: Date.now(),
        text: typeof input.text === 'string' ? input.text.trim() : input.text,
        songId: input.songId ?? null,
      };
      const errors = validateObservation(record);
      if (errors.length > 0) throw new Error(errors[0]);
      await run(['profiles', 'observations'], 'readwrite', async (t) => {
        await ensureProfile(t, profileId);
        t.objectStore('observations').put(record);
      });
      return record;
    },

    async listObservations(profileId) {
      assertProfileId(profileId);
      return (await listByProfile('observations', profileId)).sort(newestFirst('at'));
    },

    // Historial de escuchas (almacén history, previo al registro del estudio). Orden descendente por fecha; límite por defecto 200.
    async addHistory(profileId, input) {
      assertProfileId(profileId);
      if (!isPlainObject(input)) throw new Error('La escucha no es válida.');
      const record = {
        id: randomId(),
        profileId,
        songId: input.songId,
        at: Date.now(),
        listenedS: typeof input.listenedS === 'number' ? Math.round(input.listenedS) : NaN,
        completed: input.completed,
      };
      const errors = validateHistoryEntry(record);
      if (errors.length > 0) throw new Error(errors[0]);
      await run(['profiles', 'history'], 'readwrite', async (t) => {
        await ensureProfile(t, profileId);
        t.objectStore('history').put(record);
      });
      return record;
    },

    async listHistory(profileId, { limit = 200 } = {}) {
      assertProfileId(profileId);
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100000) {
        throw new Error('El límite del historial no es válido.');
      }
      return (await listByProfile('history', profileId)).sort(newestFirst('at')).slice(0, limit);
    },

    // Registro del estudio: un evento por cada hecho de la escucha. Devuelve la clave local (número).
    // El código del participante se copia al evento: si después cambia en el perfil, el evento conserva el suyo.
    async recordStudyEvent(event) {
      const normalized = normalizeStudyEvent(event);
      return run(['profiles', 'studyEvents'], 'readwrite', async (t) => {
        const profile = await ensureProfile(t, normalized.profileId);
        const record = {
          ...normalized,
          participantCode: profile.code,
          id: randomId(),
          day: studyDayOf(normalized.at),
        };
        return request(t.objectStore('studyEvents').add(record));
      });
    },

    // Eventos del registro, en orden cronológico. Filtros opcionales: from, to (AAAA-MM-DD, incluidos),
    // sessionId, profileId y presentation.
    listStudyEvents(filters = {}) {
      return readStudyEvents(filters);
    },

    // Historial de escuchas para la pantalla de historial (C-24): agrupado por día. Requiere perfil.
    async listListeningHistory(filters = {}) {
      if (!isPlainObject(filters)) throw new Error('El filtro del historial no es válido.');
      assertProfileId(filters.profileId);
      return buildListeningHistory(await readStudyEvents(filters));
    },

    // PIN: solo se guarda el hash PBKDF2 (nunca el PIN).
    async setPin(pin) {
      const errors = validatePinFormat(pin);
      if (errors.length > 0) throw new Error(errors[0]);
      const record = await hashPin(pin);
      await run(['meta'], 'readwrite', (t) => {
        const meta = t.objectStore('meta');
        meta.put({ key: 'pin', value: record });
        // Un PIN nuevo empieza sin fallos ni bloqueo.
        meta.delete('pinLockout');
      });
    },

    // Verifica el PIN. Durante el bloqueo devuelve false sin comprobar nada.
    async checkPin(pin) {
      if (validatePinFormat(pin).length > 0) return false;
      const lockout = activePinLockout(await metaValue('pinLockout'), Date.now());
      if (lockout.lockedUntil !== null) return false;
      const record = await metaValue('pin');
      return record ? verifyPin(pin, record) : false;
    },

    async hasPin() {
      return (await metaValue('pin')) !== null;
    },

    // Registra un intento (true = acierto). Cinco fallos bloquean 60 s. Devuelve el estado resultante.
    async registerPinAttempt(ok) {
      if (typeof ok !== 'boolean') throw new Error('El resultado del intento no es válido.');
      return run(['meta'], 'readwrite', async (t) => {
        const meta = t.objectStore('meta');
        const record = await request(meta.get('pinLockout'));
        const next = nextPinLockout(record?.value, ok, Date.now());
        meta.put({ key: 'pinLockout', value: next });
        return next;
      });
    },

    // Estado del bloqueo: { failures, lockedUntil }. lockedUntil es null o una marca de tiempo en milisegundos.
    async getPinLockout() {
      return activePinLockout(await metaValue('pinLockout'), Date.now());
    },

    // Quita solo el PIN (y su bloqueo). Los datos se conservan.
    async removePin() {
      await run(['meta'], 'readwrite', (t) => {
        const meta = t.objectStore('meta');
        meta.delete('pin');
        meta.delete('pinLockout');
      });
    },

    // Copias cifradas. La copia no incluye el hash del PIN ni los ajustes del dispositivo.
    // options.maxBytes: límite de tamaño (por defecto 300 MB; el valor no definido usa ese defecto).
    async exportBackup(passphrase, options) {
      const file = await buildBackup(api, passphrase, options);
      await run(['meta'], 'readwrite', (t) => {
        t.objectStore('meta').put({ key: 'lastBackupAt', value: Date.now() });
      });
      return file;
    },

    importBackup(file, passphrase, { mode = 'merge', maxBytes } = {}) {
      return restoreBackup(api, file, passphrase, { mode, maxBytes });
    },

    previewBackup(file, passphrase, { maxBytes } = {}) {
      return previewBackupFile(file, passphrase, { maxBytes });
    },

    // Contenido completo de los almacenes de datos, leído en una sola transacción.
    exportAll() {
      return run(DATA_STORES, 'readonly', async (t) => {
        const content = {};
        for (const name of DATA_STORES) content[name] = await request(t.objectStore(name).getAll());
        return content;
      });
    },

    // Escribe un contenido ya descifrado y validado (lo usa backup.js). Todo o nada.
    async importAll(content, { mode = 'merge' } = {}) {
      if (mode !== 'merge' && mode !== 'replace') throw new Error('Modo de importación no válido.');
      if (!isPlainObject(content)) throw new Error('El contenido a importar no es válido.');
      const incomingByStore = {};
      for (const name of DATA_STORES) {
        const records = content[name] ?? (OPTIONAL_STORES.includes(name) ? [] : undefined);
        if (!Array.isArray(records)) throw new Error(`Falta la lista de ${name} en el contenido a importar.`);
        for (const record of records) {
          const errors = RECORD_VALIDATORS[name](record);
          if (errors.length > 0) throw new Error(errors[0]);
          if (name === 'photos' && !(record.blob instanceof Blob)) throw new Error('Una fotografía no tiene datos.');
        }
        incomingByStore[name] = records;
      }
      return run([...DATA_STORES, 'meta'], 'readwrite', async (t) => {
        const written = {};
        const skipped = {};
        for (const name of DATA_STORES) {
          const store = t.objectStore(name);
          const incoming = incomingByStore[name];
          let existing = [];
          if (mode === 'replace') {
            store.clear();
          } else {
            existing = await request(store.getAll());
          }
          if (name === 'studyEvents') {
            // Los eventos no se corrigen: se añaden los que no existen (por identificador) y el resto se descarta.
            // La clave local (seq) la asigna el almacén; la de la copia no se usa.
            const known = new Set(existing.map((record) => record.id));
            let count = 0;
            for (const record of incoming) {
              if (known.has(record.id)) continue;
              known.add(record.id);
              const fields = { ...record, day: studyDayOf(record.at) };
              delete fields.seq;
              store.add(fields);
              count += 1;
            }
            written[name] = count;
            skipped[name] = incoming.length - count;
            continue;
          }
          const toWrite = planMerge(existing, incoming, keyOf(name));
          for (const record of toWrite) store.put(record);
          written[name] = toWrite.length;
          skipped[name] = incoming.length - toWrite.length;
        }
        // Si el perfil activo ya no existe tras la importación, se desactiva.
        const meta = t.objectStore('meta');
        const active = await request(meta.get('activeProfile'));
        if (active?.value) {
          const profile = await request(t.objectStore('profiles').get(active.value));
          if (!profile) meta.put({ key: 'activeProfile', value: null });
        }
        return { mode, written, skipped };
      });
    },

    close() {
      db.close();
    },
  };
  return api;
}
