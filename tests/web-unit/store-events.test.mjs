// Pruebas de las funciones puras del registro del estudio (store.js): normalización, filtros, orden,
// historial agrupado por día y plan de migraciones. Sin IndexedDB; el almacén real está en store-idb.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildListeningHistory,
  DB_VERSION,
  normalizeLastTrack,
  normalizeStudyEvent,
  normalizeStudyFilters,
  pendingMigrations,
  runMigrations,
  SCHEMA_MIGRATIONS,
  selectStudyEvents,
  studyDayOf,
} from '../../frontend/web/js/store.js';

const PROFILE_ID = 'perfil-prueba-01';
const SESSION_A = 'sesion-prueba-a';
const SESSION_B = 'sesion-prueba-b';
const SONG_A = 'S0123456789abcdef';
const SONG_B = 'Sfedcba9876543210';

// Fin de pista de ejemplo, tal como llega de la interfaz (sin identificador).
const trackEnd = (changes = {}) => ({
  type: 'track-end',
  at: '2026-11-02T18:30:00+01:00',
  sessionId: SESSION_A,
  profileId: PROFILE_ID,
  songId: SONG_A,
  presentation: 'C1',
  condition: 'segun-cancion',
  origin: 'lista',
  seconds: 120,
  completed: true,
  trackSeconds: 240,
  ...changes,
});

// Evento tal como lo devuelve el almacén: con clave local, identificador y día.
const stored = (changes = {}, extra = {}) => ({ ...trackEnd(changes), id: `id-${Math.random().toString(16).slice(2)}`, day: studyDayOf(trackEnd(changes).at), ...extra });

test('el día de un evento es la fecha tal como se registró, con su zona', () => {
  assert.equal(studyDayOf('2026-11-02T23:30:00-05:00'), '2026-11-02');
  assert.equal(studyDayOf('2026-11-03T00:10:00+02:00'), '2026-11-03');
});

test('normalizar un evento rellena con null lo que no aplica y redondea los segundos', () => {
  const normalized = normalizeStudyEvent({
    type: 'session-start',
    at: '2026-11-02T18:00:00+01:00',
    sessionId: SESSION_A,
    profileId: PROFILE_ID,
    condition: 'solo-audio',
    seconds: undefined,
  });
  assert.deepEqual(normalized, {
    type: 'session-start',
    at: '2026-11-02T18:00:00+01:00',
    sessionId: SESSION_A,
    profileId: PROFILE_ID,
    songId: null,
    presentation: null,
    condition: 'solo-audio',
    origin: null,
    seconds: null,
    completed: null,
    trackSeconds: null,
  });
  assert.equal(normalizeStudyEvent(trackEnd({ seconds: 119.6, trackSeconds: 240.4 })).seconds, 120);
  assert.equal(normalizeStudyEvent(trackEnd({ seconds: 119.6, trackSeconds: 240.4 })).trackSeconds, 240);
});

test('normalizar un evento rechaza lo inválido con el primer mensaje en español', () => {
  assert.throws(() => normalizeStudyEvent(trackEnd({ completed: undefined })), {
    message: 'Fin de pista: indica si se completó.',
  });
  assert.throws(() => normalizeStudyEvent(trackEnd({ type: 'clic' })), { message: 'Evento: el tipo no es válido.' });
  assert.throws(() => normalizeStudyEvent('no es un evento'), { message: 'El evento del estudio no es válido.' });
  assert.throws(() => normalizeStudyEvent(trackEnd({ seconds: 'mucho' })), { message: 'Evento: los segundos no son válidos.' });
});

test('normalizar la última pista redondea la posición y rechaza lo inválido', () => {
  const track = { songId: SONG_A, position: 41.7, origin: 'carpeta', at: '2026-11-02T18:30:00+01:00' };
  assert.deepEqual(normalizeLastTrack(track), { ...track, position: 42 });
  assert.throws(() => normalizeLastTrack({ ...track, position: null }), {
    message: 'Última pista: la posición no es válida.',
  });
  assert.throws(() => normalizeLastTrack(undefined), { message: 'La última pista no es válida.' });
});

test('los filtros aceptan días AAAA-MM-DD reales y rechazan rangos invertidos o fechas que no existen', () => {
  assert.deepEqual(
    normalizeStudyFilters({ from: '2026-11-01', to: '2026-11-02', profileId: PROFILE_ID, presentation: 'C2' }),
    { from: '2026-11-01', to: '2026-11-02', profileId: PROFILE_ID, presentation: 'C2' },
  );
  assert.deepEqual(normalizeStudyFilters(), {});
  assert.throws(() => normalizeStudyFilters({ from: '2026-02-31' }), {
    message: 'Las fechas del filtro deben tener el formato AAAA-MM-DD.',
  });
  assert.throws(() => normalizeStudyFilters({ from: '2026-11-03', to: '2026-11-01' }), {
    message: 'El rango de fechas no es válido.',
  });
  assert.throws(() => normalizeStudyFilters({ presentation: 'C3' }), { message: 'Presentación no válida.' });
  assert.throws(() => normalizeStudyFilters({ sessionId: 'con espacios' }), { message: 'Sesión no válida.' });
});

test('selectStudyEvents filtra por sesión, perfil, presentación y días, y ordena por hora', () => {
  const late = stored({ at: '2026-11-02T20:00:00+01:00', presentation: 'C1' }, { seq: 3 });
  const early = stored({ at: '2026-11-01T10:00:00+01:00', presentation: 'C0', sessionId: SESSION_B }, { seq: 1 });
  const middle = stored({ at: '2026-11-02T09:00:00+01:00', presentation: 'C2' }, { seq: 2 });
  const otherProfile = stored({ at: '2026-11-02T09:30:00+01:00', profileId: 'otro-perfil', presentation: 'C2' }, { seq: 4 });
  const records = [late, early, middle, otherProfile];

  // El orden es cronológico (hora del evento), no por la clave local.
  assert.deepEqual(selectStudyEvents(records, {}).map((r) => r.seq), [1, 2, 4, 3]);
  assert.deepEqual(selectStudyEvents(records, { sessionId: SESSION_A }).map((r) => r.seq), [2, 4, 3]);
  assert.deepEqual(selectStudyEvents(records, { presentation: 'C1' }).map((r) => r.seq), [3]);
  assert.deepEqual(selectStudyEvents(records, { presentation: 'C2' }).map((r) => r.seq), [2, 4]);
  assert.deepEqual(selectStudyEvents(records, { profileId: PROFILE_ID }).map((r) => r.seq), [1, 2, 3]);
  assert.deepEqual(selectStudyEvents(records, { from: '2026-11-02', to: '2026-11-02' }).map((r) => r.seq), [2, 4, 3]);
  assert.deepEqual(selectStudyEvents(records, { from: '2026-11-02' }).map((r) => r.seq), [2, 4, 3]);
  assert.deepEqual(selectStudyEvents(records, { to: '2026-11-01' }).map((r) => r.seq), [1]);
});

test('selectStudyEvents usa la fecha del propio evento cuando el registro no trae el día', () => {
  const withoutDay = { ...trackEnd({ at: '2026-11-05T12:00:00+01:00' }), id: 'sin-dia', seq: 9 };
  assert.deepEqual(selectStudyEvents([withoutDay], { from: '2026-11-05' }).map((r) => r.seq), [9]);
});

test('el historial agrupa las escuchas por día, el día más reciente primero, con resumen', () => {
  const events = [
    stored({ at: '2026-11-02T18:00:00+01:00', type: 'start', seconds: 0, completed: null }, { seq: 1 }),
    stored({ at: '2026-11-02T18:02:00+01:00', seconds: 120, trackSeconds: 240, completed: true, presentation: 'C2' }, { seq: 2 }),
    stored({ at: '2026-11-02T18:10:00+01:00', seconds: 30, trackSeconds: 200, completed: false, presentation: 'C0', origin: 'carpeta', songId: SONG_B }, { seq: 3 }),
    stored({ at: '2026-11-02T19:00:00+01:00', seconds: 200, trackSeconds: null, completed: true, presentation: 'C1' }, { seq: 4 }),
    stored({ at: '2026-11-01T10:00:00+01:00', seconds: 600, trackSeconds: 600, completed: true, presentation: 'C0' }, { seq: 5 }),
  ];
  const history = buildListeningHistory(events);

  assert.deepEqual(history.map((group) => group.day), ['2026-11-02', '2026-11-01']);
  assert.deepEqual(history[0].summary, { listens: 3, minutes: 6, skipped: 1 });
  assert.deepEqual(history[1].summary, { listens: 1, minutes: 10, skipped: 0 });
  assert.deepEqual(history[0].rows.map((row) => row.time), ['19:00', '18:10', '18:02']);

  const [evening, skipped, completed] = history[0].rows;
  assert.equal(evening.percent, null);
  assert.equal(evening.memoryShown, true);
  assert.equal(evening.photoShown, false);
  assert.equal(skipped.percent, 15);
  assert.equal(skipped.completed, false);
  assert.equal(skipped.photoShown, false);
  assert.equal(skipped.memoryShown, false);
  assert.equal(skipped.origin, 'carpeta');
  assert.equal(skipped.songId, SONG_B);
  assert.equal(completed.percent, 50);
  assert.equal(completed.photoShown, true);
  assert.equal(completed.memoryShown, true);
  assert.equal(history[1].rows[0].percent, 100);
});

test('el historial no cuenta eventos que no son fin de pista y sin escuchas no devuelve días', () => {
  assert.deepEqual(buildListeningHistory([]), []);
  assert.deepEqual(buildListeningHistory([stored({ type: 'pause', completed: null, seconds: 10 }, { seq: 1 })]), []);
});

test('las migraciones se numeran en orden y terminan en la versión de la base', () => {
  assert.deepEqual(SCHEMA_MIGRATIONS.map((migration) => migration.version), [1, 2]);
  assert.equal(SCHEMA_MIGRATIONS.at(-1).version, DB_VERSION);
});

test('migraciones pendientes: de una base nueva, de la versión 1 y ya al día', () => {
  assert.deepEqual(pendingMigrations(0).map((m) => m.version), [1, 2]);
  assert.deepEqual(pendingMigrations(1).map((m) => m.version), [2]);
  assert.deepEqual(pendingMigrations(2), []);
  assert.deepEqual(pendingMigrations(0, 1).map((m) => m.version), [1]);
});

// Base falsa: solo registra qué almacenes e índices se crean.
function fakeDatabase(existing = []) {
  const names = new Set(existing);
  const created = [];
  const indexes = [];
  return {
    created,
    indexes,
    objectStoreNames: { contains: (name) => names.has(name) },
    createObjectStore(name, options) {
      if (names.has(name)) throw new Error(`Ya existe el almacén ${name}`);
      names.add(name);
      created.push({ name, options });
      return { createIndex: (indexName, keyPath) => indexes.push({ store: name, indexName, keyPath }) };
    },
  };
}

const VERSION_1_STORES = ['meta', 'profiles', 'songLinks', 'memories', 'photos', 'playlists', 'observations', 'history'];

test('una base nueva recibe todos los almacenes de las dos versiones', () => {
  const db = fakeDatabase();
  runMigrations(db, 0);
  assert.deepEqual(db.created.map((c) => c.name), [...VERSION_1_STORES, 'studyEvents']);
  assert.deepEqual(db.created.find((c) => c.name === 'songLinks').options, { keyPath: ['profileId', 'songId'] });
  assert.deepEqual(db.created.find((c) => c.name === 'studyEvents').options, { keyPath: 'seq', autoIncrement: true });
});

test('desde la versión 1 solo se añade el registro del estudio y sus tres índices; no se recrea nada', () => {
  const db = fakeDatabase(VERSION_1_STORES);
  runMigrations(db, 1);
  assert.deepEqual(db.created.map((c) => c.name), ['studyEvents']);
  assert.deepEqual(db.indexes, [
    { store: 'studyEvents', indexName: 'bySession', keyPath: 'sessionId' },
    { store: 'studyEvents', indexName: 'byProfile', keyPath: 'profileId' },
    { store: 'studyEvents', indexName: 'byDay', keyPath: 'day' },
  ]);
});

test('una base ya en la última versión no cambia', () => {
  const db = fakeDatabase([...VERSION_1_STORES, 'studyEvents']);
  runMigrations(db, DB_VERSION);
  assert.deepEqual(db.created, []);
  assert.deepEqual(db.indexes, []);
});
