// Pruebas de la lógica pura de las pantallas de perfil del modo cuidador: formato de tarjetas, validación del
// asistente de primer perfil, opciones del paciente, filtros, agrupación por día del historial y exportación CSV.
// Sin DOM: las funciones que tocan la pantalla no se ejecutan aquí.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  aliasProblem,
  countText,
  familiarityAnchor,
  FAMILIARITY_ANCHORS,
  formatDateTime,
  lastSessionAt,
  memoryCountText,
  messageOf,
  mountProfiles,
  participantCodeProblem,
  PRESENTATION_OPTIONS,
  presentationOf,
  presentationShortText,
  presentationText,
  profileCodeText,
  profileFacts,
  profileInitial,
  preferenceLabel,
  selectedSongsText,
  songCountText,
  songRowsFor,
  unassociatedSongs,
  routes as profilesRoutes,
} from '../../frontend/web/js/cuidador/perfiles.js';
import {
  NO_PIN_WARNING,
  nextLabelFor,
  profileInputFrom,
  requestPersistence,
  routes as wizardRoutes,
  stepAfter,
  stepIndicatorText,
  validateStepOne,
  validateStepThree,
  WIZARD_STEPS,
} from '../../frontend/web/js/cuidador/asistente.js';
import {
  normalizePatientOptions,
  VOLUME_LIMIT_OPTIONS,
  volumeChoices,
} from '../../frontend/web/js/cuidador/opciones-paciente.js';
import {
  buildHistoryCsv,
  csvCell,
  finalText,
  formatDaySummary,
  HISTORY_CSV_HEADER,
  HISTORY_HEADERS,
  historyCsvFilename,
  historyDayHeading,
  historyFilters,
  historyRowCells,
  historySessionOptions,
  isoDay,
  originText,
  prepareHistoryDays,
  PROFILE_TABS,
  resolveTab,
  routes as profileRoutes,
  shortId,
  yesNoText,
} from '../../frontend/web/js/cuidador/perfil.js';

const SONG_A = 'S0123456789abcdef';
const SONG_B = 'Sfedcba9876543210';
const SESSION = 'sesion-prueba-0001';

// Escucha tal como la devuelve listListeningHistory (fila del día).
const row = (changes = {}) => ({
  id: 'evento-0001',
  at: '2026-11-02T18:30:00+01:00',
  time: '18:30',
  songId: SONG_A,
  seconds: 120,
  percent: 50,
  completed: false,
  photoShown: true,
  memoryShown: true,
  presentation: 'C2',
  origin: 'lista',
  condition: 'segun-cancion',
  sessionId: SESSION,
  ...changes,
});

test('las pestañas del perfil siguen el orden de DESIGN C-14 y la ruta cae en Canciones si no es válida', () => {
  assert.deepEqual(PROFILE_TABS.map((tab) => tab.id), ['canciones', 'recuerdos', 'listas', 'observaciones', 'historial']);
  assert.equal(resolveTab('historial'), 'historial');
  assert.equal(resolveTab('listas'), 'listas');
  assert.equal(resolveTab('inventada'), 'canciones');
  assert.equal(resolveTab(undefined), 'canciones');
});

test('las rutas exportadas corresponden a las pantallas del contrato 2.4', () => {
  assert.equal(profilesRoutes.perfiles, mountProfiles);
  assert.equal(typeof profilesRoutes.perfiles, 'function');
  assert.equal(typeof wizardRoutes.asistente, 'function');
  assert.equal(typeof profileRoutes.perfil, 'function');
  assert.deepEqual(Object.keys(profilesRoutes), ['perfiles']);
  assert.deepEqual(Object.keys(wizardRoutes), ['asistente']);
  assert.deepEqual(Object.keys(profileRoutes), ['perfil']);
});

test('el avatar usa la primera letra del alias en mayúscula y no parte caracteres compuestos', () => {
  assert.equal(profileInitial('  ana  '), 'A');
  assert.equal(profileInitial('élodie'), 'É');
  assert.equal(profileInitial(''), '?');
  assert.equal(profileInitial(undefined), '?');
});

test('los plurales de canciones, recuerdos y sesiones siguen la gramática castellana', () => {
  assert.equal(countText(1, 'escucha', 'escuchas'), '1 escucha');
  assert.equal(countText(0, 'escucha', 'escuchas'), '0 escuchas');
  assert.equal(songCountText(1), '1 canción asociada');
  assert.equal(songCountText(3), '3 canciones asociadas');
  assert.equal(memoryCountText(1), '1 recuerdo');
  assert.equal(memoryCountText(2), '2 recuerdos');
  assert.equal(selectedSongsText(1), '1 seleccionada');
  assert.equal(selectedSongsText(0), '0 seleccionadas');
});

test('la tarjeta de perfil resume canciones, recuerdos y última sesión (DESIGN C-15)', () => {
  assert.deepEqual(profileFacts({ songCount: 1, memoryCount: 0, lastSession: null }), [
    '1 canción asociada', '0 recuerdos', 'Sin sesiones todavía',
  ]);
  const facts = profileFacts({ songCount: 2, memoryCount: 3, lastSession: '2026-11-02T18:30:00+01:00' });
  assert.equal(facts[0], '2 canciones asociadas');
  assert.equal(facts[1], '3 recuerdos');
  assert.match(facts[2], /^Última sesión: .*2026/);
  assert.equal(profileCodeText('P-07'), 'Código: P-07');
  assert.equal(profileCodeText(''), 'Sin código de participante');
});

test('la última sesión es el inicio de sesión más reciente del registro', () => {
  const events = [
    { type: 'session-start', at: '2026-10-30T10:00:00+01:00' },
    { type: 'track-end', at: '2026-11-01T12:00:00+01:00' },
    { type: 'session-start', at: '2026-11-02T09:15:00+01:00' },
    { type: 'session-start', at: '2026-10-31T10:00:00+01:00' },
  ];
  assert.equal(lastSessionAt(events), '2026-11-02T09:15:00+01:00');
  assert.equal(lastSessionAt([{ type: 'track-end', at: '2026-11-01T12:00:00+01:00' }]), null);
  assert.equal(lastSessionAt(undefined), null);
});

test('formatDateTime devuelve vacío para una marca de tiempo que no es válida', () => {
  assert.equal(formatDateTime('no es una fecha'), '');
  assert.match(formatDateTime('2026-11-02T18:30:00+01:00'), /2026/);
});

test('las anclas y los textos de familiaridad, preferencia y presentación (C-5, C-6, C-7)', () => {
  assert.equal(FAMILIARITY_ANCHORS.length, 5);
  assert.equal(familiarityAnchor(0), 'Sin valorar');
  assert.equal(familiarityAnchor(1), 'No la reconoce');
  assert.equal(familiarityAnchor(5), 'La reconoce bien');
  assert.equal(familiarityAnchor(6), 'Sin valorar');
  assert.equal(familiarityAnchor(2.5), 'Sin valorar');
  assert.equal(preferenceLabel(-1), 'No le gusta');
  assert.equal(preferenceLabel(0), 'Le da igual');
  assert.equal(preferenceLabel(1), 'Le gusta');
  assert.equal(preferenceLabel(2), '');
  assert.equal(presentationText('C1'), 'Canción y recuerdo');
  assert.equal(presentationShortText('C2'), 'Foto y recuerdo');
  assert.equal(presentationText('C9'), '');
  assert.deepEqual(PRESENTATION_OPTIONS.map((option) => option.value), ['C0', 'C1', 'C2']);
});

test('una asociación sin presentación guardada usa C0, el valor inicial de DESIGN C-7', () => {
  assert.equal(presentationOf(undefined), 'C0');
  assert.equal(presentationOf({ familiarity: 3 }), 'C0');
  assert.equal(presentationOf({ presentation: 'C1' }), 'C1');
  assert.equal(presentationOf({ presentation: 'Z9' }), 'C0');
});

test('las canciones asociadas se ordenan por título y las que ya no están en el catálogo van al final', () => {
  const songs = [
    { id: SONG_A, title: 'Whispering', artist: '' },
    { id: SONG_B, title: 'Charleston Rag', artist: 'Anónimo' },
  ];
  const links = [
    { songId: SONG_A, familiarity: 3 },
    { songId: 'S00000000000000aa', familiarity: 1 },
    { songId: SONG_B, familiarity: 0 },
  ];
  const rows = songRowsFor(links, songs);
  assert.deepEqual(rows.map((item) => item.title), [
    'Charleston Rag', 'Whispering', 'Canción no disponible en el catálogo',
  ]);
  assert.equal(rows[0].artist, 'Anónimo');
  assert.equal(rows[2].known, false);
  assert.equal(rows[1].link.familiarity, 3);
});

test('la selección de canciones nuevas excluye las que ya están asociadas', () => {
  const songs = [{ id: SONG_A, title: 'A' }, { id: SONG_B, title: 'B' }];
  assert.deepEqual(unassociatedSongs(songs, [{ songId: SONG_A }]), [{ id: SONG_B, title: 'B' }]);
  assert.deepEqual(unassociatedSongs(songs, []), songs);
});

test('el código de participante admite hasta 40 caracteres y el alias las reglas del almacén', () => {
  assert.equal(participantCodeProblem(''), null);
  assert.equal(participantCodeProblem('P-07'), null);
  assert.equal(participantCodeProblem('x'.repeat(40)), null);
  assert.match(participantCodeProblem('x'.repeat(41)), /40 caracteres/);
  assert.match(participantCodeProblem(7), /debe ser texto/);
  assert.equal(aliasProblem('Ana'), null);
  assert.equal(aliasProblem(''), 'Escribe un alias para el perfil.');
  assert.equal(aliasProblem('   '), 'Escribe un alias para el perfil.');
  assert.match(aliasProblem('x'.repeat(61)), /60 caracteres/);
});

test('messageOf usa el mensaje del error o el texto de respaldo', () => {
  assert.equal(messageOf(new Error('Perfil no válido.')), 'Perfil no válido.');
  assert.equal(messageOf(new Error('')), 'No se pudo completar la operación.');
  assert.equal(messageOf('texto suelto', 'Respaldo'), 'Respaldo');
});

test('paso 1 del asistente: alias obligatorio y código opcional', () => {
  assert.deepEqual(validateStepOne({ alias: '', code: '' }), {
    alias: 'Escribe un alias para el perfil.',
    code: null,
  });
  assert.deepEqual(validateStepOne({ alias: 'Ana', code: 'P-07' }), { alias: null, code: null });
  assert.match(validateStepOne({ alias: 'Ana', code: 'x'.repeat(41) }).code, /40 caracteres/);
});

test('paso 3 del asistente: PIN de 4 a 6 dígitos, o sin PIN con «Ahora no», o con PIN ya configurado', () => {
  const pinMessage = 'El PIN debe tener entre 4 y 6 dígitos.';
  assert.equal(validateStepThree({ pin: '', skipped: false, hasPin: false }), pinMessage);
  assert.equal(validateStepThree({ pin: '12', skipped: false, hasPin: false }), pinMessage);
  assert.equal(validateStepThree({ pin: '1234567', skipped: false, hasPin: false }), pinMessage);
  assert.equal(validateStepThree({ pin: '12a4', skipped: false, hasPin: false }), pinMessage);
  assert.equal(validateStepThree({ pin: '1234', skipped: false, hasPin: false }), null);
  assert.equal(validateStepThree({ pin: ' 123456 ', skipped: false, hasPin: false }), null);
  assert.equal(validateStepThree({ pin: '', skipped: true, hasPin: false }), null);
  assert.equal(validateStepThree({ pin: '', skipped: false, hasPin: true }), null);
});

test('la navegación del asistente se queda entre el paso 1 y el 3', () => {
  assert.equal(WIZARD_STEPS, 3);
  assert.equal(stepAfter(1, -1), 1);
  assert.equal(stepAfter(1, 1), 2);
  assert.equal(stepAfter(2, 1), 3);
  assert.equal(stepAfter(3, 1), 3);
  assert.equal(stepIndicatorText(2), 'Paso 2 de 3');
  assert.equal(nextLabelFor(WIZARD_STEPS), 'Crear perfil');
  assert.equal(nextLabelFor(1), 'Siguiente');
});

test('los textos del aviso de «Ahora no» coinciden con DESIGN C-26', () => {
  assert.equal(NO_PIN_WARNING, 'Sin PIN, el paciente puede volver al modo cuidador sin código.');
});

test('los datos del perfil se recortan antes de enviarlos al almacén', () => {
  assert.deepEqual(profileInputFrom({ alias: '  Ana  ', code: ' P-07 ' }), { alias: 'Ana', code: 'P-07' });
  assert.deepEqual(profileInputFrom({}), { alias: '', code: '' });
});

test('requestPersistence devuelve lo que concede el navegador y nunca lanza', async () => {
  assert.equal(await requestPersistence({ persist: async () => true }), true);
  assert.equal(await requestPersistence({ persist: async () => false }), false);
  assert.equal(await requestPersistence({}), false);
  assert.equal(await requestPersistence(undefined), false);
  assert.equal(await requestPersistence({ persist: async () => { throw new Error('sin permiso'); } }), false);
});

test('las opciones de volumen van de 50 a 100 % en pasos de 10 % y admiten el valor guardado del perfil', () => {
  assert.deepEqual(VOLUME_LIMIT_OPTIONS, [50, 60, 70, 80, 90, 100]);
  assert.deepEqual(volumeChoices(100), [50, 60, 70, 80, 90, 100]);
  assert.deepEqual(volumeChoices(55), [50, 55, 60, 70, 80, 90, 100]);
  assert.deepEqual(volumeChoices(undefined), [50, 60, 70, 80, 90, 100]);
});

test('normalizePatientOptions valida las cuatro opciones del paciente (DESIGN C3f)', () => {
  const valid = normalizePatientOptions({
    volumeLimit: '80', repeatList: true, resumeOnOpen: false, seekOnTap: false,
  });
  assert.equal(valid.error, null);
  assert.deepEqual(valid.options, {
    volumeLimit: 80, repeatList: true, resumeOnOpen: false, seekOnTap: false,
  });
  assert.match(normalizePatientOptions({ volumeLimit: '40' }).error, /entre 50 % y 100 %/);
  assert.match(normalizePatientOptions({ volumeLimit: '' }).error, /entre 50 % y 100 %/);
  assert.equal(normalizePatientOptions({ volumeLimit: '100' }).options.repeatList, false);
});

test('las fechas del filtro del historial: vacías no filtran, las no válidas y las invertidas dan error', () => {
  assert.deepEqual(historyFilters({ profileId: 'perfil-01' }), { filters: { profileId: 'perfil-01' }, error: null });
  assert.deepEqual(
    historyFilters({ profileId: 'perfil-01', from: '2026-11-01', to: '2026-11-02', sessionId: SESSION, presentation: 'C1' }),
    {
      filters: {
        profileId: 'perfil-01', from: '2026-11-01', to: '2026-11-02', sessionId: SESSION, presentation: 'C1',
      },
      error: null,
    },
  );
  assert.match(historyFilters({ profileId: 'p', from: '2026-02-31' }).error, /inicial no es válida/);
  assert.match(historyFilters({ profileId: 'p', to: 'mañana' }).error, /final no es válida/);
  assert.match(historyFilters({ profileId: 'p', from: '2026-11-05', to: '2026-11-01' }).error, /posterior/);
});

test('el historial se agrupa por día: sin días vacíos, el más reciente primero, con su resumen', () => {
  const days = prepareHistoryDays([
    { day: '2026-10-30', summary: { listens: 1, minutes: 2, skipped: 0 }, rows: [row({ id: 'a' })] },
    { day: '2026-11-02', summary: { listens: 14, minutes: 42, skipped: 3 }, rows: [row({ id: 'b' })] },
    { day: '2026-11-01', summary: { listens: 0, minutes: 0, skipped: 0 }, rows: [] },
  ]);
  assert.deepEqual(days.map((day) => day.day), ['2026-11-02', '2026-10-30']);
  assert.equal(days[0].summary, '14 escuchas · 42 minutos · 3 saltadas');
  assert.equal(days[1].summary, '1 escucha · 2 minutos · 0 saltadas');
  assert.match(days[0].heading, /2 de noviembre de 2026/);
  assert.deepEqual(prepareHistoryDays(), []);
});

test('el resumen de un día usa el singular cuando procede', () => {
  assert.equal(formatDaySummary({ listens: 1, minutes: 1, skipped: 1 }), '1 escucha · 1 minuto · 1 saltada');
  assert.equal(formatDaySummary({}), '0 escuchas · 0 minutos · 0 saltadas');
});

test('el encabezado del día muestra la fecha en castellano y no se confunde por la zona horaria', () => {
  assert.equal(historyDayHeading('2026-11-02'), 'lunes, 2 de noviembre de 2026');
  assert.equal(historyDayHeading('no es un día'), 'no es un día');
});

test('una fila del historial se convierte en celdas con el orden de DESIGN C-24', () => {
  assert.equal(HISTORY_HEADERS.length, 9);
  const cells = historyRowCells(row(), (songId) => (songId === SONG_A ? 'Charleston Rag' : ''));
  assert.deepEqual(cells, [
    '18:30', 'Charleston Rag', '50 %', 'Saltada', 'Sí', 'Sí', 'Foto y recuerdo', 'Lista', 'sesion-p',
  ]);
  const unknown = historyRowCells(row({ songId: SONG_B, percent: null, completed: true }), () => '');
  assert.equal(unknown[1], 'Canción no disponible');
  assert.equal(unknown[2], '—');
  assert.equal(unknown[3], 'Completa');
});

test('los textos de final, sí o no, origen e identificador corto', () => {
  assert.equal(finalText(true), 'Completa');
  assert.equal(finalText(false), 'Saltada');
  assert.equal(finalText(null), '—');
  assert.equal(yesNoText(true), 'Sí');
  assert.equal(yesNoText(false), 'No');
  assert.equal(originText('busqueda'), 'Búsqueda');
  assert.equal(originText('carpeta'), 'Carpeta');
  assert.equal(originText('constructor'), '');
  assert.equal(shortId(SESSION), 'sesion-p');
});

test('las sesiones del filtro aparecen una vez, la más reciente primero, con su inicio y un identificador corto', () => {
  const options = historySessionOptions([
    { sessionId: 'sesion-antigua-01', at: '2026-10-30T10:00:00+01:00' },
    { sessionId: 'sesion-antigua-01', at: '2026-10-30T10:45:00+01:00' },
    { sessionId: 'sesion-reciente-02', at: '2026-11-02T09:15:00+01:00' },
    { sessionId: 'sin-fecha', at: 'no es fecha' },
  ]);
  assert.deepEqual(options.map((option) => option.value), ['sesion-reciente-02', 'sesion-antigua-01']);
  assert.match(options[0].text, /· sesion-r$/);
  assert.match(options[1].text, /2026/);
});

test('csvCell separa con «;», entrecomilla lo necesario y neutraliza fórmulas', () => {
  assert.equal(csvCell('texto simple'), 'texto simple');
  assert.equal(csvCell('a;b'), '"a;b"');
  assert.equal(csvCell('dice "hola"'), '"dice ""hola"""');
  assert.equal(csvCell('línea\nnueva'), '"línea\nnueva"');
  assert.equal(csvCell('=1+1'), "'=1+1");
  assert.equal(csvCell('-P7'), "'-P7");
  assert.equal(csvCell('+34'), "'+34");
  assert.equal(csvCell('@SUM(A1)'), "'@SUM(A1)");
  assert.equal(csvCell(-3), '-3');
  assert.equal(csvCell(12), '12');
  assert.equal(csvCell(null), '');
  assert.equal(csvCell(undefined), '');
});

test('el CSV del historial tiene BOM, cabecera en orden y una fila por escucha', () => {
  const groups = prepareHistoryDays([{
    day: '2026-11-02', summary: { listens: 1, minutes: 2, skipped: 1 }, rows: [row()],
  }]);
  const text = buildHistoryCsv(groups, {
    profileId: 'perfil-01',
    titleOf: () => 'Canción; "especial"',
    codeOf: () => '=P07',
  });
  assert.equal(text.charCodeAt(0), 0xfeff);
  const lines = text.slice(1).trimEnd().split('\r\n');
  assert.equal(lines[0], HISTORY_CSV_HEADER.join(';'));
  assert.equal(lines.length, 2);
  assert.equal(
    lines[1],
    `2026-11-02;18:30;evento-0001;perfil-01;'=P07;${SONG_A};"Canción; ""especial""";120;50;saltada;sí;sí;C2;lista;segun-cancion;${SESSION}`,
  );
});

test('el CSV sin escuchas lleva solo la cabecera y no incluye el alias', () => {
  const text = buildHistoryCsv([], { profileId: 'perfil-01' });
  assert.equal(text, `﻿${HISTORY_CSV_HEADER.join(';')}\r\n`);
  assert.equal(text.includes('Ana'), false);
});

test('el nombre del CSV usa el identificador de perfil y la fecha, sin caracteres raros', () => {
  assert.equal(historyCsvFilename('perfil_01', '2026-11-02'), 'reminiscencia-historial-perfil_01-2026-11-02.csv');
  assert.equal(historyCsvFilename('a/b c', '2026-11-02'), 'reminiscencia-historial-a_b_c-2026-11-02.csv');
});

test('isoDay usa la fecha local con dos cifras por mes y día', () => {
  assert.equal(isoDay(new Date(2026, 10, 2, 23, 30)), '2026-11-02');
  assert.equal(isoDay(new Date(2026, 0, 9)), '2026-01-09');
});

test('ningún módulo de perfil escribe HTML a partir de datos con innerHTML', () => {
  const modules = [
    '../../frontend/web/js/cuidador/perfiles.js',
    '../../frontend/web/js/cuidador/perfil.js',
    '../../frontend/web/js/cuidador/asistente.js',
    '../../frontend/web/js/cuidador/opciones-paciente.js',
  ];
  for (const file of modules) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /\.innerHTML\b|insertAdjacentHTML/, file);
  }
});
