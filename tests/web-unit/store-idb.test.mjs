// Pruebas del almacén real (store.js) sobre un IndexedDB en memoria mínimo, sin dependencias.
// La base falsa simula lo que usa el almacén: almacenes con clave, claves autoincrementales, índices,
// rangos de IDBKeyRange, transacciones con deshacer si fallan y el orden de peticiones del navegador.
// Cubre el registro del estudio, el historial, el bloqueo del PIN, la última pista, los ajustes del
// dispositivo, la combinación y la copia, y la migración de la versión 1 a la 2 sin perder datos.
// Datos ficticios.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decryptJson } from '../../frontend/web/js/crypto.js';
import { DB_VERSION, openStore } from '../../frontend/web/js/store.js';

// Rangos de claves, como los crea IndexedDB (solo lo que usa el almacén).
if (!globalThis.IDBKeyRange) {
  globalThis.IDBKeyRange = { bound: (lower, upper) => ({ isRange: true, lower, upper }) };
}

const PASSPHRASE = 'frase de prueba 2026';
const NAME = 'reminiscencia-prueba';
const SESSION = 'sesion-prueba-01';
const SONG = 'S0123456789abcdef';
const SONG_B = 'Sfedcba9876543210';
const NOW = 1_700_000_000_000;

function fail(name, message) {
  return Object.assign(new Error(message), { name });
}

// Copia profunda: IndexedDB guarda copias, no referencias.
const clone = (value) => (value === undefined ? undefined : structuredClone(value));
const keyText = (key) => JSON.stringify(key);
const valueAt = (record, keyPath) => (Array.isArray(keyPath) ? keyPath.map((part) => record[part]) : record[keyPath]);

function inQuery(value, query) {
  if (query === undefined) return true;
  if (query.isRange) {
    return (query.lower === undefined || value >= query.lower) && (query.upper === undefined || value <= query.upper);
  }
  return value === query;
}

// Estado de una base: almacenes con sus registros e índices.
function snapshot(db) {
  return new Map([...db.stores].map(([name, data]) => [name, {
    records: new Map([...data.records].map(([key, value]) => [key, clone(value)])),
    counter: data.counter,
  }]));
}

function restore(db, saved) {
  for (const [name, state] of saved) {
    const data = db.stores.get(name);
    data.records = new Map([...state.records].map(([key, value]) => [key, clone(value)]));
    data.counter = state.counter;
  }
}

function write(data, value, isAdd) {
  const record = clone(value);
  let key = valueAt(record, data.keyPath);
  if (key === undefined && data.autoIncrement) {
    data.counter += 1;
    key = data.counter;
    record[data.keyPath] = key;
  } else if (data.autoIncrement && typeof key === 'number') {
    data.counter = Math.max(data.counter, key);
  }
  if (isAdd && data.records.has(keyText(key))) throw fail('ConstraintError', 'Clave duplicada');
  data.records.set(keyText(key), record);
  return key;
}

// Transacción: las peticiones se ejecutan en tareas propias y en orden, como en el navegador.
class FakeTransaction {
  constructor(db, names, mode) {
    this.db = db;
    this.names = names;
    this.finished = false;
    this.pending = 0;
    this.error = null;
    this.oncomplete = null;
    this.onerror = null;
    this.onabort = null;
    this.backup = mode === 'readwrite' ? snapshot(db) : null;
    this.scheduleCompletion();
  }

  objectStore(name) {
    if (!this.names.includes(name)) throw fail('NotFoundError', `El almacén ${name} no está en la transacción`);
    return new FakeObjectStore(this, name);
  }

  enqueue(operation) {
    if (this.finished) throw fail('TransactionInactiveError', 'La transacción ya ha terminado');
    const request = { result: undefined, error: null, onsuccess: null, onerror: null };
    this.pending += 1;
    setTimeout(() => {
      this.pending -= 1;
      if (this.finished) return;
      try {
        request.result = operation();
      } catch (error) {
        request.error = error;
        request.onerror?.({ target: request });
        this.fail(error);
        return;
      }
      request.onsuccess?.({ target: request });
      this.scheduleCompletion();
    }, 0);
    return request;
  }

  // La transacción se confirma cuando no quedan peticiones pendientes.
  scheduleCompletion() {
    setTimeout(() => {
      if (this.finished || this.pending > 0) return;
      this.finished = true;
      this.oncomplete?.({ target: this });
    }, 0);
  }

  // Deshace lo escrito: ninguna escritura queda a medias.
  fail(error) {
    if (this.finished) return;
    this.finished = true;
    this.error = error;
    if (this.backup) restore(this.db, this.backup);
    setTimeout(() => this.onabort?.({ target: this }), 0);
  }

  abort() {
    this.fail(null);
  }
}

class FakeObjectStore {
  constructor(tx, name) {
    this.tx = tx;
    this.name = name;
  }

  get data() {
    return this.tx.db.stores.get(this.name);
  }

  get(key) {
    return this.tx.enqueue(() => clone(this.data.records.get(keyText(key))));
  }

  getAll() {
    return this.tx.enqueue(() => [...this.data.records.values()].map(clone));
  }

  put(value) {
    return this.tx.enqueue(() => write(this.data, value, false));
  }

  add(value) {
    return this.tx.enqueue(() => write(this.data, value, true));
  }

  delete(key) {
    return this.tx.enqueue(() => {
      this.data.records.delete(keyText(key));
    });
  }

  clear() {
    return this.tx.enqueue(() => {
      this.data.records.clear();
    });
  }

  index(name) {
    const data = this.data;
    const keyPath = data.indexes.get(name);
    if (keyPath === undefined) throw fail('NotFoundError', `No existe el índice ${name}`);
    const matching = (query) => [...data.records.values()].filter((record) => {
      const value = valueAt(record, keyPath);
      return value !== undefined && inQuery(value, query);
    });
    return {
      getAll: (query) => this.tx.enqueue(() => matching(query).map(clone)),
      getAllKeys: (query) => this.tx.enqueue(() => matching(query).map((record) => valueAt(record, data.keyPath))),
    };
  }
}

class FakeDatabase {
  constructor(name) {
    this.name = name;
    this.version = 0;
    this.stores = new Map();
    this.closed = false;
    this.onversionchange = null;
  }

  get objectStoreNames() {
    return { contains: (name) => this.stores.has(name) };
  }

  createObjectStore(name, options = {}) {
    if (this.stores.has(name)) throw fail('ConstraintError', `Ya existe el almacén ${name}`);
    const data = {
      keyPath: options.keyPath,
      autoIncrement: options.autoIncrement === true,
      records: new Map(),
      indexes: new Map(),
      counter: 0,
    };
    this.stores.set(name, data);
    return { createIndex: (indexName, keyPath) => { data.indexes.set(indexName, keyPath); } };
  }

  transaction(names, mode) {
    if (this.closed) throw fail('InvalidStateError', 'La base de datos está cerrada');
    for (const name of names) {
      if (!this.stores.has(name)) throw fail('NotFoundError', `No existe el almacén ${name}`);
    }
    return new FakeTransaction(this, names, mode);
  }

  close() {
    this.closed = true;
  }

  // Prepara una base antigua para las pruebas de migración.
  seed(storeName, record) {
    const data = this.stores.get(storeName);
    data.records.set(keyText(valueAt(record, data.keyPath)), clone(record));
  }
}

// Fábrica de bases: open() crea o abre y lanza onupgradeneeded cuando sube la versión.
class FakeFactory {
  constructor() {
    this.databases = new Map();
  }

  open(name, version) {
    const request = { result: undefined, error: null, onupgradeneeded: null, onsuccess: null, onerror: null, onblocked: null };
    setTimeout(() => {
      const db = this.databases.get(name) ?? new FakeDatabase(name);
      this.databases.set(name, db);
      db.closed = false;
      const oldVersion = db.version;
      request.result = db;
      if (version > oldVersion) {
        request.onupgradeneeded?.({ oldVersion, newVersion: version, target: request });
        db.version = version;
      }
      request.onsuccess?.({ target: request });
    }, 0);
    return request;
  }
}

// Base como la dejaba la versión 1 del almacén: mismos almacenes e índices, sin registro del estudio.
function createVersion1Database(factory, name) {
  const db = new FakeDatabase(name);
  db.createObjectStore('meta', { keyPath: 'key' });
  db.createObjectStore('profiles', { keyPath: 'id' });
  db.createObjectStore('songLinks', { keyPath: ['profileId', 'songId'] }).createIndex('byProfile', 'profileId');
  for (const storeName of ['memories', 'photos', 'playlists', 'observations', 'history']) {
    db.createObjectStore(storeName, { keyPath: 'id' }).createIndex('byProfile', 'profileId');
  }
  db.version = 1;
  factory.databases.set(name, db);
  return db;
}

async function openFresh(name = NAME) {
  const factory = new FakeFactory();
  const store = await openStore({ indexedDB: factory, name });
  return { factory, store, db: factory.databases.get(name) };
}

// Ejecuta el cuerpo con un reloj controlado (Date.now) y lo restaura al terminar.
async function withClock(startMs, body) {
  const realNow = Date.now;
  let current = startMs;
  Date.now = () => current;
  try {
    await body((ms) => { current += ms; });
  } finally {
    Date.now = realNow;
  }
}

const trackEnd = (profileId, changes = {}) => ({
  type: 'track-end',
  at: '2026-11-02T18:30:00+01:00',
  sessionId: SESSION,
  profileId,
  songId: SONG,
  presentation: 'C1',
  condition: 'segun-cancion',
  origin: 'lista',
  seconds: 120,
  completed: true,
  trackSeconds: 240,
  ...changes,
});

// Marca de fecha y hora de cada evento, sin segundos ni zona: para comparar el orden.
const stampsOf = (events) => events.map((event) => event.at.slice(0, 16));

test('base nueva: versión de la base 2, todos los almacenes y los tres índices del registro del estudio', async () => {
  const { db, store } = await openFresh();
  assert.equal(DB_VERSION, 2);
  assert.equal(db.version, 2);
  assert.deepEqual([...db.stores.keys()].sort(), [
    'history', 'memories', 'meta', 'observations', 'photos', 'playlists', 'profiles', 'songLinks', 'studyEvents',
  ]);
  assert.deepEqual([...db.stores.get('studyEvents').indexes.keys()].sort(), ['byDay', 'byProfile', 'bySession']);
  store.close();
});

test('migración: una base de la versión 1 con datos conserva perfiles y perfil activo, y recibe el registro del estudio', async () => {
  const factory = new FakeFactory();
  const v1 = createVersion1Database(factory, NAME);
  v1.seed('profiles', {
    id: 'perfil-antiguo-01',
    alias: 'Persona antigua',
    code: 'CP-OLD',
    options: { volumeLimit: 100, repeatList: true, resumeOnOpen: false, seekOnTap: false },
    createdAt: 1,
    updatedAt: 1,
  });
  v1.seed('meta', { key: 'activeProfile', value: 'perfil-antiguo-01' });
  const store = await openStore({ indexedDB: factory, name: NAME });
  assert.equal(v1.version, 2);
  assert.deepEqual((await store.listProfiles()).map((profile) => profile.alias), ['Persona antigua']);
  assert.equal(await store.getActiveProfileId(), 'perfil-antiguo-01');
  const key = await store.recordStudyEvent(trackEnd('perfil-antiguo-01'));
  assert.equal(typeof key, 'number');
  assert.equal((await store.listStudyEvents({ profileId: 'perfil-antiguo-01' })).length, 1);
  store.close();
});

test('recordStudyEvent guarda el evento con identificador y día, y devuelve la clave local', async () => {
  const { store } = await openFresh();
  const profile = await store.createProfile({ alias: 'Persona de prueba', code: 'CP-001' });
  const key = await store.recordStudyEvent(trackEnd(profile.id));
  const [saved] = await store.listStudyEvents({ profileId: profile.id });
  assert.equal(saved.seq, key);
  assert.equal(saved.day, '2026-11-02');
  assert.match(saved.id, /^[0-9a-f]{32}$/);
  assert.equal(saved.presentation, 'C1');
  assert.equal(saved.trackSeconds, 240);
  assert.equal(saved.participantCode, 'CP-001');
  // El evento conserva el código con el que se registró, aunque el perfil cambie después.
  await store.updateProfile(profile.id, { code: 'CP-999' });
  const [after] = await store.listStudyEvents({ profileId: profile.id });
  assert.equal(after.participantCode, 'CP-001');
  store.close();
});

test('recordStudyEvent rechaza eventos inválidos y perfiles inexistentes, sin escribir nada', async () => {
  const { store } = await openFresh();
  const profile = await store.createProfile({ alias: 'Persona de prueba', code: 'CP-001' });
  await assert.rejects(store.recordStudyEvent(trackEnd(profile.id, { type: 'clic' })), {
    message: 'Evento: el tipo no es válido.',
  });
  await assert.rejects(store.recordStudyEvent(trackEnd(profile.id, { at: '2026-11-02T18:30:00' })), {
    message: 'Evento: la fecha debe ser ISO 8601 con zona horaria.',
  });
  await assert.rejects(store.recordStudyEvent(trackEnd('perfil-que-no-existe')), { message: 'El perfil no existe.' });
  assert.deepEqual(await store.listStudyEvents(), []);
  store.close();
});

test('listStudyEvents filtra por sesión, presentación y días, y devuelve el orden cronológico', async () => {
  const { store } = await openFresh();
  const profile = await store.createProfile({ alias: 'Persona de prueba', code: 'CP-001' });
  await store.recordStudyEvent(trackEnd(profile.id, { at: '2026-11-02T20:00:00+01:00', presentation: 'C1', sessionId: 'sesion-b' }));
  await store.recordStudyEvent(trackEnd(profile.id, { at: '2026-11-01T10:00:00+01:00', presentation: 'C0', sessionId: 'sesion-a' }));
  await store.recordStudyEvent(trackEnd(profile.id, { at: '2026-11-02T09:00:00+01:00', presentation: 'C2', sessionId: 'sesion-a' }));

  assert.deepEqual(stampsOf(await store.listStudyEvents({ profileId: profile.id })),
    ['2026-11-01T10:00', '2026-11-02T09:00', '2026-11-02T20:00']);
  assert.deepEqual(stampsOf(await store.listStudyEvents({ sessionId: 'sesion-a' })),
    ['2026-11-01T10:00', '2026-11-02T09:00']);
  assert.deepEqual(stampsOf(await store.listStudyEvents({ presentation: 'C1' })), ['2026-11-02T20:00']);
  assert.deepEqual(stampsOf(await store.listStudyEvents({ from: '2026-11-02', to: '2026-11-02' })),
    ['2026-11-02T09:00', '2026-11-02T20:00']);
  assert.deepEqual(stampsOf(await store.listStudyEvents({ from: '2026-11-02' })),
    ['2026-11-02T09:00', '2026-11-02T20:00']);
  assert.deepEqual(stampsOf(await store.listStudyEvents({ to: '2026-11-01' })), ['2026-11-01T10:00']);
  await assert.rejects(store.listStudyEvents({ from: '2026-11-03', to: '2026-11-01' }), {
    message: 'El rango de fechas no es válido.',
  });
  store.close();
});

test('listListeningHistory agrupa las escuchas por día con resumen y filas, y exige perfil', async () => {
  const { store } = await openFresh();
  const profile = await store.createProfile({ alias: 'Persona de prueba', code: 'CP-001' });
  const other = await store.createProfile({ alias: 'Otra persona de prueba', code: 'CP-002' });
  await store.recordStudyEvent({
    type: 'start',
    at: '2026-11-02T18:00:00+01:00',
    sessionId: 'sesion-a',
    profileId: profile.id,
    songId: SONG,
    presentation: 'C2',
    condition: 'segun-cancion',
    origin: 'lista',
    seconds: 0,
    completed: null,
    trackSeconds: 240,
  });
  await store.recordStudyEvent(trackEnd(profile.id, { at: '2026-11-02T18:02:00+01:00', sessionId: 'sesion-a', presentation: 'C2', seconds: 120, completed: true, trackSeconds: 240 }));
  await store.recordStudyEvent(trackEnd(profile.id, { at: '2026-11-02T18:10:00+01:00', sessionId: 'sesion-b', songId: SONG_B, presentation: 'C0', origin: 'carpeta', seconds: 30, completed: false, trackSeconds: 200 }));
  await store.recordStudyEvent(trackEnd(other.id, { at: '2026-11-02T18:20:00+01:00', seconds: 60, completed: true }));

  const history = await store.listListeningHistory({ profileId: profile.id });
  assert.deepEqual(history.map((day) => day.day), ['2026-11-02']);
  assert.deepEqual(history[0].summary, { listens: 2, minutes: 3, skipped: 1 });
  assert.deepEqual(history[0].rows.map((row) => row.time), ['18:10', '18:02']);
  assert.equal(history[0].rows[0].percent, 15);
  assert.equal(history[0].rows[1].photoShown, true);
  assert.equal(history[0].rows[1].percent, 50);

  const sessionB = await store.listListeningHistory({ profileId: profile.id, sessionId: 'sesion-b' });
  assert.deepEqual(sessionB[0].rows.map((row) => row.time), ['18:10']);
  await assert.rejects(store.listListeningHistory({}), { message: 'Perfil no válido.' });
  store.close();
});

test('deleteProfile borra también los eventos del estudio del perfil y no los de otro', async () => {
  const { store } = await openFresh();
  const profile = await store.createProfile({ alias: 'Persona de prueba', code: 'CP-001' });
  const other = await store.createProfile({ alias: 'Otra persona de prueba', code: 'CP-002' });
  await store.recordStudyEvent(trackEnd(profile.id));
  await store.recordStudyEvent(trackEnd(other.id));
  await store.deleteProfile(profile.id);
  const left = await store.listStudyEvents();
  assert.equal(left.length, 1);
  assert.equal(left[0].profileId, other.id);
  store.close();
});

test('PIN: se rechazan 3 y 7 dígitos; con 6 dígitos se guarda y se verifica', async () => {
  const { store } = await openFresh();
  await assert.rejects(store.setPin('123'), { message: 'El PIN debe tener entre 4 y 6 dígitos.' });
  await assert.rejects(store.setPin('1234567'), { message: 'El PIN debe tener entre 4 y 6 dígitos.' });
  await store.setPin('246810');
  assert.equal(await store.hasPin(), true);
  assert.equal(await store.checkPin('246810'), true);
  assert.equal(await store.checkPin('246811'), false);
  store.close();
});

test('bloqueo del PIN: cinco fallos bloquean 60 s sin borrar nada; el acierto durante el bloqueo no lo levanta', async () => {
  const { store } = await openFresh();
  await store.createProfile({ alias: 'Persona de prueba', code: 'CP-001' });
  await store.setPin('2468');
  await withClock(NOW, async (advance) => {
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      assert.deepEqual(await store.registerPinAttempt(false), { failures: attempt, lockedUntil: null });
    }
    assert.deepEqual(await store.registerPinAttempt(false), { failures: 5, lockedUntil: NOW + 60_000 });
    assert.deepEqual(await store.getPinLockout(), { failures: 5, lockedUntil: NOW + 60_000 });
    assert.equal(await store.checkPin('2468'), false, 'durante el bloqueo no se verifica el PIN');
    assert.deepEqual(await store.registerPinAttempt(true), { failures: 5, lockedUntil: NOW + 60_000 });
    assert.equal((await store.listProfiles()).length, 1, 'el bloqueo no borra datos');
    advance(59_999);
    assert.equal((await store.getPinLockout()).lockedUntil, NOW + 60_000);
    advance(1);
    assert.deepEqual(await store.getPinLockout(), { failures: 0, lockedUntil: null });
    assert.equal(await store.checkPin('2468'), true);
  });
  store.close();
});

test('bloqueo del PIN: un acierto reinicia el recuento; quitar el PIN quita el bloqueo y conserva los datos', async () => {
  const { store } = await openFresh();
  await store.createProfile({ alias: 'Persona de prueba', code: 'CP-001' });
  await withClock(NOW, async () => {
    await store.registerPinAttempt(false);
    await store.registerPinAttempt(false);
    assert.deepEqual(await store.registerPinAttempt(true), { failures: 0, lockedUntil: null });
    for (let i = 0; i < 5; i += 1) await store.registerPinAttempt(false);
    assert.equal((await store.getPinLockout()).lockedUntil, NOW + 60_000);
    await store.removePin();
    assert.equal(await store.hasPin(), false);
    assert.deepEqual(await store.getPinLockout(), { failures: 0, lockedUntil: null });
    assert.equal((await store.listProfiles()).length, 1);
  });
  store.close();
});

test('un PIN nuevo empieza sin fallos ni bloqueo', async () => {
  const { store } = await openFresh();
  await withClock(NOW, async () => {
    for (let i = 0; i < 5; i += 1) await store.registerPinAttempt(false);
    assert.equal((await store.getPinLockout()).lockedUntil, NOW + 60_000);
    await store.setPin('1357');
    assert.deepEqual(await store.getPinLockout(), { failures: 0, lockedUntil: null });
  });
  store.close();
});

test('última pista: se guarda en el perfil, se lee, se reemplaza y se quita sin cambiar la edición del perfil', async () => {
  const { store } = await openFresh();
  const profile = await store.createProfile({ alias: 'Persona de prueba', code: 'CP-001' });
  assert.equal(await store.getLastTrack(profile.id), null);
  const saved = await store.saveLastTrack(profile.id, { songId: SONG, position: 41.6, origin: 'lista', at: '2026-11-02T18:30:00+01:00' });
  assert.deepEqual(saved, { songId: SONG, position: 42, origin: 'lista', at: '2026-11-02T18:30:00+01:00' });
  assert.deepEqual(await store.getLastTrack(profile.id), saved);
  const [current] = await store.listProfiles();
  assert.equal(current.updatedAt, profile.updatedAt);
  assert.equal(current.alias, 'Persona de prueba');
  await store.saveLastTrack(profile.id, { songId: SONG_B, position: 5, origin: 'carpeta', at: '2026-11-02T18:40:00+01:00' });
  assert.equal((await store.getLastTrack(profile.id)).songId, SONG_B);
  await store.saveLastTrack(profile.id, null);
  assert.equal(await store.getLastTrack(profile.id), null);
  store.close();
});

test('última pista: rechaza datos inválidos y perfiles inexistentes', async () => {
  const { store } = await openFresh();
  const profile = await store.createProfile({ alias: 'Persona de prueba', code: 'CP-001' });
  await assert.rejects(store.saveLastTrack(profile.id, { songId: SONG, position: -3, origin: 'lista', at: '2026-11-02T18:30:00+01:00' }), {
    message: 'Última pista: la posición no es válida.',
  });
  await assert.rejects(store.saveLastTrack(profile.id, { songId: SONG, position: 3, origin: 'azar', at: '2026-11-02T18:30:00+01:00' }), {
    message: 'Última pista: el origen no es válido.',
  });
  await assert.rejects(store.saveLastTrack('perfil-que-no-existe', { songId: SONG, position: 3, origin: 'lista', at: '2026-11-02T18:30:00+01:00' }), {
    message: 'El perfil no existe.',
  });
  assert.equal(await store.getLastTrack(profile.id), null);
  store.close();
});

test('ajustes del dispositivo: valores por defecto, guardado parcial y rechazo de claves de pantalla', async () => {
  const { db, store } = await openFresh();
  assert.deepEqual(await store.getSettings(), { sleepTimerMinutes: null, alwaysPatientMode: false, wakeLock: true });
  assert.deepEqual(await store.saveSettings({ wakeLock: false, sleepTimerMinutes: 30 }), {
    sleepTimerMinutes: 30, alwaysPatientMode: false, wakeLock: false,
  });
  assert.equal((await store.getSettings()).wakeLock, false);
  await assert.rejects(store.saveSettings({ textScale: 1.5 }), { message: 'Ajuste desconocido: textScale.' });
  store.close();

  // Una versión anterior guardó claves de pantalla en los ajustes: se ignoran al leer.
  const legacy = await openFresh('ajustes-antiguos');
  legacy.db.seed('meta', { key: 'settings', value: { textScale: 1.5, wakeLock: false } });
  const settings = await legacy.store.getSettings();
  assert.equal('textScale' in settings, false);
  assert.equal(settings.wakeLock, false);
  legacy.store.close();
  assert.equal(db.version, 2);
});

test('importar: combina los eventos por identificador sin duplicarlos y, en sustituir, los reemplaza', async () => {
  const source = await openFresh('origen-prueba');
  const profile = await source.store.createProfile({ alias: 'Persona de prueba', code: 'CP-001' });
  await source.store.recordStudyEvent(trackEnd(profile.id, { at: '2026-11-02T18:02:00+01:00' }));
  await source.store.recordStudyEvent(trackEnd(profile.id, { at: '2026-11-02T18:10:00+01:00', completed: false }));
  const content = await source.store.exportAll();

  const target = await openFresh('destino-prueba');
  const first = await target.store.importAll(content, { mode: 'merge' });
  assert.equal(first.written.studyEvents, 2);
  assert.equal((await target.store.listStudyEvents()).length, 2);

  const second = await target.store.importAll(content, { mode: 'merge' });
  assert.equal(second.written.studyEvents, 0);
  assert.equal(second.skipped.studyEvents, 2);
  assert.equal((await target.store.listStudyEvents()).length, 2);

  const replaced = await target.store.importAll({ ...content, studyEvents: [] }, { mode: 'replace' });
  assert.equal(replaced.written.studyEvents, 0);
  assert.equal((await target.store.listStudyEvents()).length, 0);

  // Una copia sin la lista de eventos (versión 1) también se importa.
  const { studyEvents, ...withoutEvents } = content;
  const old = await target.store.importAll(withoutEvents, { mode: 'merge' });
  assert.equal(old.written.studyEvents, 0);
  source.store.close();
  target.store.close();
});

test('copia cifrada: exportar e importar conserva los eventos, y el fichero no lleva claves locales', async () => {
  const source = await openFresh('origen-copia');
  const profile = await source.store.createProfile({ alias: 'Persona de prueba', code: 'CP-001' });
  await source.store.recordStudyEvent(trackEnd(profile.id, { at: '2026-11-02T18:02:00+01:00' }));
  await source.store.recordStudyEvent(trackEnd(profile.id, { at: '2026-11-02T18:10:00+01:00', completed: false }));
  const file = await source.store.exportBackup(PASSPHRASE);
  assert.equal((await source.store.previewBackup(file, PASSPHRASE)).studyEvents, 2);
  assert.notEqual(await source.store.getLastBackupAt(), null);

  const payload = await decryptJson(JSON.parse(await file.text()), PASSPHRASE);
  assert.equal(payload.payloadVersion, 2);
  for (const event of payload.studyEvents) {
    assert.equal('seq' in event, false);
    assert.equal('day' in event, false);
  }

  const target = await openFresh('destino-copia');
  const summary = await target.store.importBackup(file, PASSPHRASE, { mode: 'replace' });
  assert.equal(summary.written.studyEvents, 2);
  const restored = await target.store.listStudyEvents({ profileId: profile.id });
  assert.equal(restored.length, 2);
  assert.equal(restored[0].at, '2026-11-02T18:02:00+01:00');
  assert.equal(restored[0].day, '2026-11-02');
  source.store.close();
  target.store.close();
});
