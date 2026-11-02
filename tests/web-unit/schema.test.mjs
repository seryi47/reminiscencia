// Pruebas de schema.js: casos válidos e inválidos, límites de texto, rangos, fechas, última pista,
// registro del estudio y copias (versiones 1 y 2). Datos ficticios.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BACKUP_PAYLOAD_VERSION,
  isCalendarDay,
  isIsoWithZone,
  LIMITS,
  validateAlias,
  validateBackup,
  validateHistoryEntry,
  validateLastTrack,
  validateMemory,
  validateObservation,
  validatePatientOptions,
  validatePhotoMeta,
  validatePin,
  validatePlaylist,
  validateProfile,
  validateSettings,
  validateSongLink,
  validateStudyEvent,
  validateStudyRecord,
} from '../../frontend/web/js/schema.js';

const SONG = 'S0123456789abcdef';
const SONG_B = 'Sfedcba9876543210';
const PROFILE_ID = 'perfil-prueba-01';
const SESSION_ID = 'sesion-prueba-01';
const T0 = 1700000000000;

const PROFILE = {
  id: PROFILE_ID,
  alias: 'Persona de prueba',
  code: 'CP-001',
  options: { volumeLimit: 100, repeatList: true, resumeOnOpen: false, seekOnTap: false },
  createdAt: T0,
  updatedAt: T0,
};
const MEMORY = {
  id: 'recuerdo-prueba-01',
  profileId: PROFILE_ID,
  title: 'Recuerdo de prueba',
  text: 'Texto ficticio para pruebas.',
  year: 1975,
  people: ['Persona de prueba'],
  songIds: [SONG],
  photoIds: ['foto-prueba-01'],
  createdAt: T0,
  updatedAt: T0,
};
const PLAYLIST = {
  id: 'lista-prueba-01',
  profileId: PROFILE_ID,
  name: 'Lista de prueba',
  songIds: [SONG],
  createdAt: T0,
  updatedAt: T0,
};
const SONG_LINK = { profileId: PROFILE_ID, songId: SONG, familiarity: 3, preference: 1, notes: 'Nota de prueba', updatedAt: T0 };
const OBSERVATION = { id: 'obs-prueba-01', profileId: PROFILE_ID, at: T0, text: 'Observación ficticia', songId: SONG };
const HISTORY = { id: 'hist-prueba-01', profileId: PROFILE_ID, songId: SONG, at: T0, listenedS: 42, completed: true };
const PHOTO_META = { id: 'foto-prueba-01', profileId: PROFILE_ID, mime: 'image/png', caption: 'Imagen de prueba', createdAt: T0 };
const LAST_TRACK = { songId: SONG, position: 42, origin: 'lista', at: '2026-11-02T18:30:00+01:00' };
// Evento de fin de pista (sin identificador: así llega desde la interfaz).
const TRACK_END = {
  type: 'track-end',
  at: '2026-11-02T18:30:00+01:00',
  sessionId: SESSION_ID,
  profileId: PROFILE_ID,
  songId: SONG,
  presentation: 'C1',
  condition: 'segun-cancion',
  origin: 'lista',
  seconds: 120,
  completed: true,
  trackSeconds: 240,
};
// Mismo evento tal como viaja en una copia: con su identificador y el código del participante.
const STUDY_RECORD = { ...TRACK_END, id: 'evento-prueba-01', participantCode: 'CP-001' };

const withChanges = (base, changes) => ({ ...base, ...changes });
const songIds = (count) => Array.from({ length: count }, (_, i) => `S${i.toString(16).padStart(16, '0')}`);
const repeat = (char, count) => char.repeat(count);

test('alias: acepta de 1 a 60 caracteres y rechaza vacío, espacios y saltos de línea', () => {
  assert.deepEqual(validateAlias('Persona de prueba'), []);
  assert.deepEqual(validateAlias(repeat('a', 60)), []);
  assert.equal(validateAlias(repeat('a', 61)).length, 1);
  assert.equal(validateAlias('').length, 1);
  assert.equal(validateAlias('   ').length, 1);
  assert.equal(validateAlias('Persona\nde prueba').length, 1);
  assert.equal(validateAlias(42).length, 1);
});

test('alias: cuenta caracteres, no bytes ni unidades de código (un emoji cuenta como uno)', () => {
  assert.deepEqual(validateAlias(repeat('😀', 60)), []);
  assert.equal(validateAlias(repeat('😀', 61)).length, 1);
  assert.deepEqual(validateAlias(`  ${repeat('ñ', 60)}  `), []);
});

test('alias: el mensaje está en español y no repite el alias', () => {
  const [message] = validateAlias(repeat('Persona', 20));
  assert.equal(message, 'El alias no puede superar 60 caracteres.');
});

test('PIN: acepta de 4 a 6 dígitos y rechaza el resto', () => {
  assert.deepEqual(validatePin('1234'), []);
  assert.deepEqual(validatePin('123456'), []);
  assert.deepEqual(validatePin('123'), ['El PIN debe tener entre 4 y 6 dígitos.']);
  assert.equal(validatePin('1234567').length, 1);
  assert.equal(validatePin('12a4').length, 1);
  assert.equal(validatePin('12 34').length, 1);
  assert.equal(validatePin('').length, 1);
  assert.equal(validatePin(1234).length, 1);
});

test('ajustes del dispositivo: la lista completa es válida y los valores se respetan', () => {
  const full = { sleepTimerMinutes: null, alwaysPatientMode: false, wakeLock: true };
  assert.deepEqual(validateSettings(full), []);
  assert.deepEqual(validateSettings(withChanges(full, { sleepTimerMinutes: 30, alwaysPatientMode: true, wakeLock: false })), []);
  assert.equal(validateSettings(withChanges(full, { wakeLock: 'sí' })).length, 1);
  assert.equal(validateSettings(withChanges(full, { alwaysPatientMode: 1 })).length, 1);
});

test('ajustes: el apagado automático solo admite No, 15, 30 o 60 minutos', () => {
  const base = { alwaysPatientMode: false, wakeLock: true };
  for (const sleepTimerMinutes of [null, 15, 30, 60]) {
    assert.deepEqual(validateSettings({ ...base, sleepTimerMinutes }), []);
  }
  for (const sleepTimerMinutes of [45, 0, '15', 16]) {
    assert.equal(validateSettings({ ...base, sleepTimerMinutes }).length, 1);
  }
});

test('ajustes: en parcial solo se validan los campos presentes; claves desconocidas y faltantes se marcan', () => {
  assert.deepEqual(validateSettings({ wakeLock: false }, { partial: true }), []);
  assert.equal(validateSettings({ wakeLock: false }).length > 0, true);
  assert.equal(validateSettings({ volumen: 3 }, { partial: true }).length, 1);
  assert.equal(validateSettings(null).length, 1);
});

test('ajustes de pantalla (texto, contraste, apariencia) ya no son ajustes del dispositivo', () => {
  assert.deepEqual(validateSettings({ textScale: 1.5 }, { partial: true }), ['Ajuste desconocido: textScale.']);
  assert.deepEqual(validateSettings({ theme: 'auto' }, { partial: true }), ['Ajuste desconocido: theme.']);
  assert.deepEqual(validateSettings({ highContrast: true }, { partial: true }), ['Ajuste desconocido: highContrast.']);
});

test('opciones del paciente: volumen de 50 a 100 y casillas sí o no', () => {
  const base = { volumeLimit: 100, repeatList: true, resumeOnOpen: false, seekOnTap: false };
  assert.deepEqual(validatePatientOptions(base), []);
  assert.deepEqual(validatePatientOptions({ ...base, volumeLimit: 50 }), []);
  assert.equal(validatePatientOptions({ ...base, volumeLimit: 49 }).length, 1);
  assert.equal(validatePatientOptions({ ...base, volumeLimit: 101 }).length, 1);
  assert.equal(validatePatientOptions({ ...base, volumeLimit: 75.5 }).length, 1);
  assert.equal(validatePatientOptions({ ...base, repeatList: 'sí' }).length, 1);
  assert.deepEqual(validatePatientOptions({ seekOnTap: true }, { partial: true }), []);
});

test('perfil: válido con alias, código y opciones; rechaza alias largo, código largo y fechas negativas', () => {
  assert.deepEqual(validateProfile(PROFILE), []);
  assert.equal(validateProfile(withChanges(PROFILE, { alias: repeat('a', 61) })).length > 0, true);
  assert.equal(validateProfile(withChanges(PROFILE, { code: repeat('c', 41) })).length > 0, true);
  assert.equal(validateProfile(withChanges(PROFILE, { createdAt: -1 })).length > 0, true);
  assert.equal(validateProfile(withChanges(PROFILE, { id: 'no válido con espacios' })).length > 0, true);
  const { options, ...withoutOptions } = PROFILE;
  assert.equal(validateProfile(withoutOptions).length > 0, true);
});

test('perfil: la última pista es opcional, pero si existe debe ser correcta', () => {
  assert.deepEqual(validateProfile(withChanges(PROFILE, { lastTrack: LAST_TRACK })), []);
  assert.deepEqual(validateProfile(withChanges(PROFILE, { lastTrack: null })), []);
  assert.equal(validateProfile(withChanges(PROFILE, { lastTrack: { ...LAST_TRACK, position: -5 } })).length > 0, true);
});

test('recuerdo: título de 1 a 80 caracteres', () => {
  assert.deepEqual(validateMemory(MEMORY), []);
  assert.deepEqual(validateMemory(withChanges(MEMORY, { title: repeat('t', 80) })), []);
  assert.equal(validateMemory(withChanges(MEMORY, { title: repeat('t', 81) })).length, 1);
  assert.equal(validateMemory(withChanges(MEMORY, { title: '   ' })).length, 1);
});

test('recuerdo: texto de hasta 1000 caracteres, con saltos de línea, sin caracteres de control', () => {
  assert.deepEqual(validateMemory(withChanges(MEMORY, { text: repeat('x', 1000) })), []);
  assert.equal(validateMemory(withChanges(MEMORY, { text: repeat('x', 1001) })).length, 1);
  assert.deepEqual(validateMemory(withChanges(MEMORY, { text: 'Primera línea.\nSegunda línea.' })), []);
  assert.equal(validateMemory(withChanges(MEMORY, { text: 'Texto\u0007con timbre' })).length, 1);
  assert.deepEqual(validateMemory(withChanges(MEMORY, { text: '' })), []);
});

test('recuerdo: año de cuatro cifras o nulo', () => {
  assert.deepEqual(validateMemory(withChanges(MEMORY, { year: null })), []);
  assert.deepEqual(validateMemory(withChanges(MEMORY, { year: 1000 })), []);
  assert.deepEqual(validateMemory(withChanges(MEMORY, { year: 9999 })), []);
  for (const year of [999, 10000, '1950', 1975.5]) {
    assert.equal(validateMemory(withChanges(MEMORY, { year })).length, 1, `año ${year}`);
  }
});

test('recuerdo: personas (hasta 20, de 1 a 60 caracteres) y límites de canciones y fotografías', () => {
  assert.deepEqual(validateMemory(withChanges(MEMORY, { people: Array(20).fill('Persona de prueba') })), []);
  assert.equal(validateMemory(withChanges(MEMORY, { people: Array(21).fill('Persona de prueba') })).length, 1);
  assert.equal(validateMemory(withChanges(MEMORY, { people: [''] })).length, 1);
  assert.equal(validateMemory(withChanges(MEMORY, { people: [repeat('p', 61)] })).length, 1);
  assert.equal(validateMemory(withChanges(MEMORY, { songIds: ['S123'] })).length, 1);
  assert.equal(validateMemory(withChanges(MEMORY, { songIds: songIds(50) })).length, 0);
  assert.equal(validateMemory(withChanges(MEMORY, { songIds: songIds(51) })).length, 1);
  assert.deepEqual(validateMemory(withChanges(MEMORY, { photoIds: Array.from({ length: 10 }, (_, i) => `foto-${i}`) })), []);
  assert.equal(validateMemory(withChanges(MEMORY, { photoIds: Array.from({ length: 11 }, (_, i) => `foto-${i}`) })).length, 1);
});

test('recuerdo: exige identificadores válidos, perfil y fechas', () => {
  assert.equal(validateMemory(withChanges(MEMORY, { id: '' })).length > 0, true);
  assert.equal(validateMemory(withChanges(MEMORY, { profileId: undefined })).length > 0, true);
  assert.equal(validateMemory(withChanges(MEMORY, { createdAt: 1.5 })).length > 0, true);
  assert.equal(validateMemory('no es un objeto').length, 1);
});

test('lista: nombre de 1 a 80 caracteres y hasta 500 canciones', () => {
  assert.deepEqual(validatePlaylist(PLAYLIST), []);
  assert.equal(validatePlaylist(withChanges(PLAYLIST, { name: repeat('n', 81) })).length, 1);
  assert.equal(validatePlaylist(withChanges(PLAYLIST, { name: '' })).length, 1);
  assert.deepEqual(validatePlaylist(withChanges(PLAYLIST, { songIds: songIds(500) })), []);
  assert.equal(validatePlaylist(withChanges(PLAYLIST, { songIds: songIds(501) })).length, 1);
  assert.equal(validatePlaylist(withChanges(PLAYLIST, { songIds: [SONG_B, 'no es canción'] })).length, 1);
});

test('asociación canción: familiaridad 0–5 y preferencia −2 a 2, enteros', () => {
  assert.deepEqual(validateSongLink(SONG_LINK), []);
  for (const familiarity of [0, 5]) assert.deepEqual(validateSongLink(withChanges(SONG_LINK, { familiarity })), []);
  for (const familiarity of [-1, 6, 2.5, '3']) assert.equal(validateSongLink(withChanges(SONG_LINK, { familiarity })).length, 1);
  for (const preference of [-2, 2]) assert.deepEqual(validateSongLink(withChanges(SONG_LINK, { preference })), []);
  for (const preference of [-3, 3, 0.5]) assert.equal(validateSongLink(withChanges(SONG_LINK, { preference })).length, 1);
});

test('asociación canción: notas de hasta 500 caracteres y canción obligatoria', () => {
  assert.deepEqual(validateSongLink(withChanges(SONG_LINK, { notes: repeat('n', 500) })), []);
  assert.equal(validateSongLink(withChanges(SONG_LINK, { notes: repeat('n', 501) })).length, 1);
  assert.equal(validateSongLink(withChanges(SONG_LINK, { songId: 'S123' })).length, 1);
  assert.equal(validateSongLink(withChanges(SONG_LINK, { updatedAt: undefined })).length > 0, true);
});

test('observación: texto de 1 a 1000 caracteres y canción opcional (nula o válida)', () => {
  assert.deepEqual(validateObservation(OBSERVATION), []);
  assert.deepEqual(validateObservation(withChanges(OBSERVATION, { songId: null })), []);
  assert.equal(validateObservation(withChanges(OBSERVATION, { songId: 'no es canción' })).length, 1);
  assert.equal(validateObservation(withChanges(OBSERVATION, { text: '' })).length, 1);
  assert.deepEqual(validateObservation(withChanges(OBSERVATION, { text: repeat('o', 1000) })), []);
  assert.equal(validateObservation(withChanges(OBSERVATION, { text: repeat('o', 1001) })).length, 1);
});

test('escucha: segundos de 0 a 86400, indicador de final booleano y canción válida', () => {
  assert.deepEqual(validateHistoryEntry(HISTORY), []);
  assert.deepEqual(validateHistoryEntry(withChanges(HISTORY, { listenedS: 0 })), []);
  assert.deepEqual(validateHistoryEntry(withChanges(HISTORY, { listenedS: 86400 })), []);
  assert.equal(validateHistoryEntry(withChanges(HISTORY, { listenedS: -1 })).length, 1);
  assert.equal(validateHistoryEntry(withChanges(HISTORY, { listenedS: 86401 })).length, 1);
  assert.equal(validateHistoryEntry(withChanges(HISTORY, { completed: 'sí' })).length, 1);
  assert.equal(validateHistoryEntry(withChanges(HISTORY, { songId: 'X' })).length, 1);
});

test('fotografía: solo JPEG, PNG o WebP; descripción de hasta 200 caracteres', () => {
  assert.deepEqual(validatePhotoMeta(PHOTO_META), []);
  for (const mime of ['image/jpeg', 'image/png', 'image/webp']) {
    assert.deepEqual(validatePhotoMeta(withChanges(PHOTO_META, { mime })), []);
  }
  assert.equal(validatePhotoMeta(withChanges(PHOTO_META, { mime: 'image/gif' })).length, 1);
  assert.deepEqual(validatePhotoMeta(withChanges(PHOTO_META, { caption: repeat('d', 200) })), []);
  assert.equal(validatePhotoMeta(withChanges(PHOTO_META, { caption: repeat('d', 201) })).length, 1);
  assert.deepEqual(validatePhotoMeta(withChanges(PHOTO_META, { caption: '' })), []);
});

test('fecha de calendario: rechaza días que no existen y acepta el 29 de febrero de un año bisiesto', () => {
  assert.equal(isCalendarDay('2026-11-02'), true);
  assert.equal(isCalendarDay('2026-02-31'), false);
  assert.equal(isCalendarDay('2028-02-29'), true);
  assert.equal(isCalendarDay('2027-02-29'), false);
  assert.equal(isCalendarDay('02-11-2026'), false);
  assert.equal(isCalendarDay(20261102), false);
});

test('fecha ISO con zona: acepta Z, desplazamiento y milisegundos; rechaza lo que no tiene zona o está fuera de rango', () => {
  assert.equal(isIsoWithZone('2026-11-02T18:30:00+01:00'), true);
  assert.equal(isIsoWithZone('2026-11-02T18:30:00Z'), true);
  assert.equal(isIsoWithZone('2026-11-02T18:30:00.250-03:30'), true);
  assert.equal(isIsoWithZone('2026-11-02T18:30:00'), false);
  assert.equal(isIsoWithZone('2026-11-02T25:30:00Z'), false);
  assert.equal(isIsoWithZone('2026-11-02T18:30:00+24:00'), false);
  assert.equal(isIsoWithZone('2026-02-31T10:00:00Z'), false);
  assert.equal(isIsoWithZone('no es una fecha'), false);
  assert.equal(isIsoWithZone(42), false);
});

test('última pista: válida con datos completos; rechaza canción, posición, origen y fecha sin zona', () => {
  assert.deepEqual(validateLastTrack(LAST_TRACK), []);
  assert.equal(validateLastTrack({ ...LAST_TRACK, songId: 'X' })[0], 'Última pista: canción no válida.');
  assert.equal(validateLastTrack({ ...LAST_TRACK, position: -1 })[0], 'Última pista: la posición no es válida.');
  assert.equal(validateLastTrack({ ...LAST_TRACK, position: 1.5 })[0], 'Última pista: la posición no es válida.');
  assert.equal(validateLastTrack({ ...LAST_TRACK, origin: 'aleatorio' })[0], 'Última pista: el origen no es válido.');
  assert.equal(validateLastTrack({ ...LAST_TRACK, at: '2026-11-02T18:30:00' })[0],
    'Última pista: la fecha debe ser ISO 8601 con zona horaria.');
  assert.deepEqual(validateLastTrack(null), ['La última pista no es válida.']);
});

test('evento del estudio: una pista exige canción, presentación, condición y origen', () => {
  assert.deepEqual(validateStudyEvent(TRACK_END), []);
  assert.ok(validateStudyEvent({ ...TRACK_END, songId: null }).includes('Evento: falta la canción.'));
  assert.ok(validateStudyEvent({ ...TRACK_END, presentation: null }).includes('Evento: falta la presentación.'));
  assert.ok(validateStudyEvent({ ...TRACK_END, condition: null }).includes('Evento: falta la condición.'));
  assert.ok(validateStudyEvent({ ...TRACK_END, origin: null }).includes('Evento: falta el origen.'));
  assert.ok(validateStudyEvent({ ...TRACK_END, presentation: 'C3' }).includes('Evento: presentación no válida.'));
  assert.ok(validateStudyEvent({ ...TRACK_END, condition: 'azar' }).includes('Evento: condición no válida.'));
  assert.ok(validateStudyEvent({ ...TRACK_END, origin: 'aleatorio' }).includes('Evento: origen no válido.'));
  assert.ok(validateStudyEvent({ ...TRACK_END, origin: 'continuous' }).includes('Evento: origen no válido.'));
});

test('evento del estudio: un fin de pista exige si se completó y los segundos escuchados', () => {
  assert.ok(validateStudyEvent({ ...TRACK_END, completed: null }).includes('Fin de pista: indica si se completó.'));
  assert.ok(validateStudyEvent({ ...TRACK_END, seconds: null }).includes('Fin de pista: faltan los segundos escuchados.'));
  assert.deepEqual(validateStudyEvent({ ...TRACK_END, completed: false, seconds: 0 }), []);
});

test('evento del estudio: tipos desconocidos, fecha sin zona e identificadores no válidos se rechazan', () => {
  assert.ok(validateStudyEvent({ ...TRACK_END, type: 'clic' }).includes('Evento: el tipo no es válido.'));
  assert.ok(validateStudyEvent({ ...TRACK_END, at: '2026-11-02T18:30:00' })
    .includes('Evento: la fecha debe ser ISO 8601 con zona horaria.'));
  assert.ok(validateStudyEvent({ ...TRACK_END, sessionId: 'sesión con espacios' }).includes('Evento: sesión no válida.'));
  assert.ok(validateStudyEvent({ ...TRACK_END, profileId: '' }).includes('Evento: perfil no válido.'));
  assert.ok(validateStudyEvent({ ...TRACK_END, completed: 'sí' })
    .includes('Evento: el indicador de final debe ser sí, no o vacío.'));
});

test('evento del estudio: segundos y duración de la pista dentro de rango; el inicio de sesión no lleva canción', () => {
  assert.ok(validateStudyEvent({ ...TRACK_END, seconds: 86401 }).includes('Evento: los segundos no son válidos.'));
  assert.ok(validateStudyEvent({ ...TRACK_END, seconds: -1 }).includes('Evento: los segundos no son válidos.'));
  assert.ok(validateStudyEvent({ ...TRACK_END, trackSeconds: 0 }).includes('Evento: la duración de la pista no es válida.'));
  assert.deepEqual(validateStudyEvent({
    type: 'session-start',
    at: '2026-11-02T18:00:00+01:00',
    sessionId: SESSION_ID,
    profileId: PROFILE_ID,
    songId: null,
    presentation: null,
    condition: 'segun-cancion',
    origin: null,
    seconds: null,
    completed: null,
    trackSeconds: null,
  }), []);
});

test('registro del estudio en una copia: exige un identificador propio y el código del participante', () => {
  assert.deepEqual(validateStudyRecord(STUDY_RECORD), []);
  assert.deepEqual(validateStudyRecord(TRACK_END), [
    'Evento: identificador no válido.',
    'Evento: el código del participante no es válido.',
  ]);
  assert.deepEqual(validateStudyRecord({ ...STUDY_RECORD, participantCode: repeat('c', 41) }), [
    'Evento: el código del participante no es válido.',
  ]);
  assert.deepEqual(validateStudyRecord({ ...STUDY_RECORD, participantCode: '' }), []);
  assert.deepEqual(validateStudyRecord(null), ['El evento del estudio no es válido.']);
});

test('copia: el contenido completo y coherente es válido', () => {
  assert.deepEqual(validateBackup(validPayload()), []);
});

test('copia: la versión 1 (sin registro del estudio) es válida; la versión 2 con eventos también', () => {
  assert.deepEqual(validateBackup(validPayload({ payloadVersion: 1 })), []);
  assert.deepEqual(validateBackup(validPayload({ studyEvents: [STUDY_RECORD] })), []);
  assert.equal(BACKUP_PAYLOAD_VERSION, 2);
});

test('copia: rechaza una versión de contenido desconocida, listas que faltan y contenido que no es objeto', () => {
  assert.equal(validateBackup(validPayload({ payloadVersion: 3 })).length, 1);
  assert.equal(validateBackup(validPayload({ payloadVersion: 0 })).length, 1);
  const { playlists, ...withoutPlaylists } = validPayload();
  assert.equal(validateBackup(withoutPlaylists).length, 1);
  assert.equal(validateBackup('texto').length, 1);
});

test('copia: un registro con datos fuera de rango se señala con su lista y su posición', () => {
  const errors = validateBackup(validPayload({ memories: [MEMORY, withChanges(MEMORY, { year: 123 })] }));
  assert.equal(errors.length, 1);
  assert.match(errors[0], /^memories, registro 2: /);
});

test('copia: los registros deben pertenecer a un perfil que está en la copia', () => {
  const orphan = withChanges(MEMORY, { profileId: 'otro-perfil', photoIds: [] });
  assert.equal(validateBackup(validPayload({ memories: [orphan] })).length, 1);
});

test('copia: no admite registros duplicados (también en el registro del estudio)', () => {
  assert.equal(validateBackup(validPayload({ profiles: [PROFILE, PROFILE] })).length, 1);
  assert.equal(validateBackup(validPayload({ songLinks: [SONG_LINK, SONG_LINK] })).length, 1);
  assert.deepEqual(
    validateBackup(validPayload({ studyEvents: [STUDY_RECORD, STUDY_RECORD] })),
    ['Hay registros duplicados en studyEvents.'],
  );
});

test('copia: un evento del estudio debe pertenecer a un perfil de la copia y ser válido', () => {
  const orphan = { ...STUDY_RECORD, profileId: 'otro-perfil' };
  assert.deepEqual(
    validateBackup(validPayload({ studyEvents: [orphan] })),
    ['Hay registros de studyEvents que pertenecen a un perfil que no está en la copia.'],
  );
  const errors = validateBackup(validPayload({ studyEvents: [STUDY_RECORD, { ...STUDY_RECORD, id: 'evento-prueba-02', type: 'clic' }] }));
  assert.equal(errors.length, 1);
  assert.match(errors[0], /^studyEvents, registro 2: Evento: el tipo no es válido\.$/);
});

test('copia: un recuerdo solo puede referenciar fotografías del mismo perfil incluidas en la copia', () => {
  assert.equal(validateBackup(validPayload({ photos: [] })).length, 1);
  const otherProfilePhoto = { ...PHOTO_META, profileId: 'otro-perfil', data: 'AAAA' };
  assert.equal(validateBackup(validPayload({ photos: [otherProfilePhoto] })).length > 0, true);
});

test('copia: los datos de cada fotografía tienen tamaño máximo y el formato debe ser válido', () => {
  const tooLarge = 'A'.repeat(11184813);
  assert.equal(validateBackup(validPayload({ photos: [{ ...PHOTO_META, data: tooLarge }] })).length, 1);
  assert.equal(validateBackup(validPayload({ photos: [{ ...PHOTO_META, mime: 'image/gif', data: 'AAAA' }] })).length, 1);
  assert.equal(validateBackup(validPayload({ photos: [{ ...PHOTO_META }] })).length, 1);
});

test('copia: la lista de errores no supera 20 mensajes', () => {
  const broken = Array.from({ length: 30 }, (_, i) => withChanges(MEMORY, { id: `r-${i}`, year: 1 }));
  assert.ok(validateBackup(validPayload({ memories: broken })).length <= 20);
});

test('límites exportados coinciden con los documentados', () => {
  assert.equal(LIMITS.alias, 60);
  assert.equal(LIMITS.memoryTitle, 80);
  assert.equal(LIMITS.memoryText, 1000);
  assert.equal(LIMITS.memoryPhotos, 10);
  assert.equal(LIMITS.listenedMaxS, 86400);
});

function validPayload(changes = {}) {
  return {
    payloadVersion: BACKUP_PAYLOAD_VERSION,
    exportedAt: T0,
    profiles: [PROFILE],
    songLinks: [SONG_LINK],
    memories: [MEMORY],
    photos: [{ ...PHOTO_META, data: 'AAAA' }],
    playlists: [PLAYLIST],
    observations: [OBSERVATION],
    history: [HISTORY],
    ...changes,
  };
}
