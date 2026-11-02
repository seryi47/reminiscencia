// Pruebas de la lógica pura del contenido del perfil del cuidador: recuerdos, listas y observaciones.
// No hay navegador: las funciones que tocan el DOM no se ejecutan aquí. Los límites salen de DESIGN.md (C-11, C-12,
// C-22, 8.5) y de CONTRATO-UI.md (sección 3.2, C3b, C3c, C3d).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  charCount,
  compareIds,
  counterLine,
  describeCounter,
  fromDateTimeLocalValue,
  formatDuration,
  insertItemAt,
  matchesQuery,
  moveItem,
  normalizeSearch,
  observationTagLabel,
  OBSERVATION_LIMITS,
  OBSERVATION_TAGS,
  pluralize,
  removeItemAt,
  textLengthError,
  toDateTimeLocalValue,
  validateObservationDraft,
} from '../../frontend/web/js/cuidador/observacion-hoja.js';
import {
  assemblePhotoIds,
  computeResizedSize,
  MEMORY_LIMITS,
  planPhotoSave,
  parseMemoryYear,
  routes as memoryRoutes,
  snapshotMemory,
  validateMemoryText,
  validateMemoryTitle,
  validatePersonAlias,
  validatePhotoCaption,
  validatePhotoCount,
  validatePhotoFile,
} from '../../frontend/web/js/cuidador/recuerdo-editor.js';
import {
  filterSongs,
  listSnapshot,
  LIST_LIMITS,
  mergeSelection,
  routes as listRoutes,
  validateListName,
} from '../../frontend/web/js/cuidador/lista-editor.js';
import { describeMemory, formatMemoryYear, orderMemories } from '../../frontend/web/js/cuidador/recuerdos.js';
import {
  formatObservationTime,
  orderObservations,
  observationTagLabels,
  routes as observationRoutes,
} from '../../frontend/web/js/cuidador/observaciones.js';
import { songCountText } from '../../frontend/web/js/cuidador/listas-perfil.js';

const MB = 1024 * 1024;

test('el texto se mide sin espacios sobrantes y el mensaje de vacío solo aplica si es obligatorio', () => {
  assert.equal(textLengthError('   ', { max: 10 }), null);
  assert.equal(textLengthError('   ', { max: 10, required: true, emptyMessage: 'Falta el texto.' }), 'Falta el texto.');
  assert.equal(textLengthError(' abc ', { max: 3 }), null);
  assert.equal(textLengthError('abcd', { max: 3, tooLongMessage: 'Demasiado.' }), 'Demasiado.');
});

test('los caracteres de control se rechazan en una línea y se admiten en varias', () => {
  assert.equal(textLengthError('a\nb', { max: 10 }), 'El texto contiene caracteres no permitidos.');
  assert.equal(textLengthError('a\nb', { max: 10, multiline: true }), null);
  assert.equal(textLengthError('a\u0007b', { max: 10, multiline: true }), 'El texto contiene caracteres no permitidos.');
});

test('charCount cuenta un emoji como un carácter, como el almacén', () => {
  assert.equal(charCount('😀a'), 2);
  assert.equal(charCount(null), 0);
});

test('el contador avisa desde el 90 % y cuenta lo que queda', () => {
  assert.equal(describeCounter(812, 1000).nearText, null);
  assert.equal(describeCounter(899, 1000).nearText, null);
  assert.equal(describeCounter(900, 1000).nearText, 'Quedan 100 caracteres');
  assert.equal(describeCounter(999, 1000).nearText, 'Queda 1 carácter');
  assert.equal(describeCounter(1000, 1000).nearText, 'Has llegado al máximo de 1000 caracteres');
  const over = describeCounter(1003, 1000);
  assert.equal(over.over, true);
  assert.equal(over.nearText, 'Sobran 3 caracteres');
  assert.equal(describeCounter(812, 1000).text, '812 de 1000');
  assert.equal(counterLine(900, 1000), '900 de 1000 · Quedan 100 caracteres');
  assert.equal(counterLine(812, 1000), '812 de 1000');
});

test('la búsqueda ignora mayúsculas y tildes y exige todas las palabras', () => {
  assert.equal(normalizeSearch('  Canción  '), 'cancion');
  assert.equal(matchesQuery('Bésame mucho · Consuelo', 'besame CONSUELO'), true);
  assert.equal(matchesQuery('Bésame mucho', 'mucho bolero'), false);
  assert.equal(matchesQuery('cualquier cosa', ''), true);
});

test('la duración se muestra como minutos y segundos', () => {
  assert.equal(formatDuration(192.4), '3:12');
  assert.equal(formatDuration(59.6), '1:00');
  assert.equal(formatDuration(undefined), '');
  assert.equal(formatDuration(-1), '');
});

test('mover, quitar e insertar operan sobre copias y respetan los límites', () => {
  assert.deepEqual(moveItem(['a', 'b', 'c'], 0, 1), ['b', 'a', 'c']);
  assert.deepEqual(moveItem(['a', 'b'], 0, -1), ['a', 'b']);
  const removed = removeItemAt(['a', 'b', 'c'], 1);
  assert.deepEqual(removed.list, ['a', 'c']);
  assert.deepEqual(removed.removed, { item: 'b', index: 1 });
  assert.equal(removeItemAt(['a'], 4).removed, null);
  assert.deepEqual(insertItemAt(['a', 'c'], 1, 'b'), ['a', 'b', 'c']);
  assert.deepEqual(insertItemAt(['a'], 99, 'z'), ['a', 'z']);
});

test('pluralize y compareIds dan la forma y el orden esperados', () => {
  assert.equal(pluralize(1, 'canción', 'canciones'), '1 canción');
  assert.equal(pluralize(0, 'canción', 'canciones'), '0 canciones');
  assert.equal(compareIds('a', 'b'), -1);
  assert.equal(compareIds('b', 'a'), 1);
  assert.equal(compareIds('a', 'a'), 0);
});

test('el nombre de la lista es obligatorio y tiene 60 caracteres como máximo', () => {
  assert.equal(validateListName(''), 'Escribe un nombre para la lista.');
  assert.equal(validateListName('   '), 'Escribe un nombre para la lista.');
  assert.equal(validateListName('a'.repeat(60)), null);
  assert.equal(validateListName('a'.repeat(61)), 'El nombre no puede superar 60 caracteres.');
  assert.equal(LIST_LIMITS.name, 60);
  assert.equal(LIST_LIMITS.songs, 500);
});

test('el filtro de canciones busca por título y artista', () => {
  const songs = [
    { id: 'S1', title: 'Ay, Mariquita', artist: 'Antonio' },
    { id: 'S2', title: 'Bésame mucho', artist: 'Consuelo' },
  ];
  assert.deepEqual(filterSongs(songs, 'mucho consuelo').map((song) => song.id), ['S2']);
  assert.deepEqual(filterSongs(songs, 'antonio').map((song) => song.id), ['S1']);
  assert.equal(filterSongs(songs, 'inexistente').length, 0);
});

test('la selección de canciones conserva el orden existente y añade lo nuevo al final', () => {
  assert.deepEqual(mergeSelection(['a', 'b', 'c'], ['c', 'x', 'a']), ['a', 'c', 'x']);
  assert.deepEqual(mergeSelection(['a'], []), []);
});

test('la instantánea de la lista ignora los espacios del nombre', () => {
  assert.equal(listSnapshot(' Boleros ', ['S1']), listSnapshot('Boleros', ['S1']));
  assert.notEqual(listSnapshot('Boleros', ['S1']), listSnapshot('Boleros', ['S1', 'S2']));
});

test('el título del recuerdo es obligatorio y tiene 80 caracteres como máximo', () => {
  assert.equal(validateMemoryTitle(''), 'Escribe un título para guardar el recuerdo.');
  assert.equal(validateMemoryTitle('  '), 'Escribe un título para guardar el recuerdo.');
  assert.equal(validateMemoryTitle('a'.repeat(80)), null);
  assert.equal(validateMemoryTitle('a'.repeat(81)), 'El título no puede superar 80 caracteres.');
});

test('el texto del recuerdo admite 1000 caracteres y varias líneas, pero no es obligatorio', () => {
  assert.equal(validateMemoryText(''), null);
  assert.equal(validateMemoryText('línea\nsegunda'), null);
  assert.equal(validateMemoryText('a'.repeat(1000)), null);
  assert.equal(validateMemoryText('a'.repeat(1001)), 'El texto no puede superar 1000 caracteres.');
});

test('el año admite cuatro cifras o queda vacío', () => {
  assert.deepEqual(parseMemoryYear(''), { year: null, error: null });
  assert.deepEqual(parseMemoryYear('  '), { year: null, error: null });
  assert.deepEqual(parseMemoryYear('1974'), { year: 1974, error: null });
  assert.deepEqual(parseMemoryYear(' 1974 '), { year: 1974, error: null });
  assert.equal(parseMemoryYear('197').error, 'El año debe tener cuatro cifras, por ejemplo 1974.');
  assert.equal(parseMemoryYear('abcd').error, 'El año debe tener cuatro cifras, por ejemplo 1974.');
  assert.equal(parseMemoryYear('0999').error, 'El año debe tener cuatro cifras, por ejemplo 1974.');
  assert.equal(parseMemoryYear('19745').error, 'El año debe tener cuatro cifras, por ejemplo 1974.');
});

test('las personas se nombran por alias: máximo 60 caracteres, sin repetir y hasta 20', () => {
  assert.equal(validatePersonAlias('  ', []), 'Escribe el alias de la persona.');
  assert.equal(validatePersonAlias('a'.repeat(60), []), null);
  assert.equal(validatePersonAlias('a'.repeat(61), []), 'El alias no puede superar 60 caracteres.');
  assert.equal(validatePersonAlias('Hermana', ['hermana']), 'Esa persona ya está en la lista.');
  assert.equal(validatePersonAlias('Línea', ['linea']), 'Esa persona ya está en la lista.');
  const full = Array.from({ length: 20 }, (_, index) => `Persona ${index}`);
  assert.equal(validatePersonAlias('Otra', full), 'Un recuerdo admite hasta 20 personas.');
  assert.equal(validatePersonAlias('Otra', full.slice(0, 19)), null);
});

test('una fotografía debe ser JPEG, PNG o WebP, no estar vacía y pesar como mucho 10 MB', () => {
  assert.equal(validatePhotoFile({ type: 'image/gif', size: 1000 }), 'Solo se admiten fotografías JPEG, PNG o WebP.');
  assert.equal(validatePhotoFile({ type: 'image/png', size: 0 }), 'La fotografía está vacía.');
  assert.equal(validatePhotoFile({ type: 'image/webp', size: 10 * MB }), null);
  assert.equal(validatePhotoFile({ type: 'image/jpeg; charset=binary', size: 2 * MB }), null);
  assert.equal(
    validatePhotoFile({ type: 'image/jpeg', size: 10 * MB + 1 }),
    'La fotografía supera el tamaño máximo de 10 MB.',
  );
  assert.equal(MEMORY_LIMITS.photoBytes, 10 * MB);
});

test('un recuerdo admite como máximo 10 fotografías', () => {
  assert.equal(validatePhotoCount(9, 1), null);
  assert.equal(validatePhotoCount(10, 1), 'Un recuerdo admite hasta 10 fotografías.');
  assert.equal(validatePhotoCount(8, 3), 'Un recuerdo admite hasta 10 fotografías.');
  assert.equal(validatePhotoCount(7, 3), null);
  assert.equal(MEMORY_LIMITS.photos, 10);
});

test('la descripción de una fotografía admite 200 caracteres', () => {
  assert.equal(validatePhotoCaption(''), null);
  assert.equal(validatePhotoCaption('a'.repeat(200)), null);
  assert.equal(validatePhotoCaption('a'.repeat(201)), 'La descripción no puede superar 200 caracteres.');
});

test('la reducción conserva la proporción, lleva el lado mayor a 1600 px y nunca amplía', () => {
  assert.deepEqual(computeResizedSize(4000, 3000), { width: 1600, height: 1200 });
  assert.deepEqual(computeResizedSize(800, 600), { width: 800, height: 600 });
  assert.deepEqual(computeResizedSize(1000, 3000), { width: 533, height: 1600 });
  assert.deepEqual(computeResizedSize(1600, 1600), { width: 1600, height: 1600 });
  assert.deepEqual(computeResizedSize(1, 1), { width: 1, height: 1 });
  assert.throws(() => computeResizedSize(0, 100), RangeError);
});

test('el plan de guardado conserva, sube y retira las fotografías según lo que cambió', () => {
  const entries = [
    { key: 'a', id: 'p1', caption: 'Igual', originalCaption: 'Igual' },
    { key: 'b', id: null, caption: 'Nueva', originalCaption: null },
    { key: 'c', id: 'p3', caption: 'Cambiada', originalCaption: 'Antes' },
  ];
  const plan = planPhotoSave(entries, ['p1', 'p2', 'p3']);
  assert.deepEqual(plan.uploads, [
    { key: 'b', caption: 'Nueva', replaces: null },
    { key: 'c', caption: 'Cambiada', replaces: 'p3' },
  ]);
  assert.equal(plan.keeps.get('a'), 'p1');
  assert.deepEqual(plan.removedIds, ['p2', 'p3']);
  const ids = assemblePhotoIds(entries, plan, new Map([['b', 'p9'], ['c', 'p10']]));
  assert.deepEqual(ids, ['p1', 'p9', 'p10']);
});

test('la instantánea detecta los cambios que importan y no depende de los datos binarios', () => {
  const base = {
    title: 'Verano', text: '', yearText: '1974', yearApproximate: false, people: ['Hermana'], songIds: [],
    photos: [{ key: 's-p1', id: 'p1', caption: 'Playa', blob: { size: 1 }, previewUrl: 'blob:x' }],
  };
  const same = snapshotMemory({ ...base, photos: [{ key: 's-p1', id: 'p1', caption: 'Playa', blob: { size: 99 } }] });
  assert.equal(snapshotMemory(base), same);
  assert.notEqual(snapshotMemory({ ...base, title: 'Otoño' }), snapshotMemory(base));
  assert.notEqual(snapshotMemory({ ...base, yearApproximate: true }), snapshotMemory(base));
  assert.notEqual(snapshotMemory({ ...base, photos: [{ ...base.photos[0], caption: 'Mar' }] }), snapshotMemory(base));
  assert.notEqual(snapshotMemory({ ...base, people: [] }), snapshotMemory(base));
});

test('el año de un recuerdo se muestra con su aproximación', () => {
  assert.equal(formatMemoryYear({ year: null }), 'Sin año');
  assert.equal(formatMemoryYear({ year: 1974 }), 'Año 1974');
  assert.equal(formatMemoryYear({ year: 1974, yearApproximate: true }), 'Año aproximado: 1974');
});

test('los recuerdos se ordenan por año, luego por título, y los que no tienen año van al final', () => {
  const memories = [
    { id: 'b', year: null, title: 'Zeta' },
    { id: 'a', year: 1980, title: 'Mar' },
    { id: 'd', year: 1950, title: 'Bola' },
    { id: 'c', year: 1950, title: 'Árbol' },
  ];
  assert.deepEqual(orderMemories(memories).map((memory) => memory.id), ['c', 'd', 'a', 'b']);
  assert.equal(memories[0].id, 'b', 'la lista original no se modifica');
});

test('la fila del recuerdo resume su título, año, personas y recuentos con plural correcto', () => {
  const info = describeMemory({
    title: '', year: 1974, yearApproximate: false, people: ['Hermana', 'Abuelo'], songIds: ['S1'], photoIds: [],
  });
  assert.deepEqual(info, {
    title: 'Sin título',
    year: 'Año 1974',
    people: 'Personas: Hermana, Abuelo',
    songs: '1 canción',
    photos: '0 fotografías',
  });
  assert.equal(describeMemory({ title: 'X', people: [], songIds: ['S1', 'S2'], photoIds: ['p1'] }).songs, '2 canciones');
  assert.equal(describeMemory({ title: 'X', people: [] }).people, 'Sin personas');
});

test('las observaciones se muestran de la más reciente a la más antigua', () => {
  const observations = [{ id: 'x', at: 100 }, { id: 'z', at: 300 }, { id: 'y', at: 300 }];
  assert.deepEqual(orderObservations(observations).map((item) => item.id), ['y', 'z', 'x']);
});

test('las etiquetas de una observación se traducen y «Otra» muestra su texto', () => {
  assert.deepEqual(observationTagLabels(['sings', 'other'], 'Mira la ventana'), ['Canta o tararea', 'Otra: Mira la ventana']);
  assert.deepEqual(observationTagLabels(['other'], ''), ['Otra']);
  assert.deepEqual(observationTagLabels(['no-existe', 'calm']), ['Tranquilidad']);
  assert.deepEqual(observationTagLabels(undefined), []);
  assert.equal(observationTagLabel('unknown'), null);
});

test('la hora de la observación se muestra con año y hora local', () => {
  const at = new Date(2026, 10, 2, 10, 42).getTime();
  const text = formatObservationTime(at);
  assert.match(text, /2026/);
  assert.match(text, /10:42/);
});

test('la hoja tiene ocho etiquetas cerradas, con los textos de DESIGN 8.5', () => {
  assert.deepEqual(OBSERVATION_TAGS.map((tag) => tag.label), [
    'Reconoce la canción',
    'Canta o tararea',
    'Marca el ritmo',
    'Pide que se repita',
    'Inquietud',
    'Tranquilidad',
    'Pide cambiar de canción',
    'Otra',
  ]);
  assert.equal(OBSERVATION_LIMITS.note, 500);
});

test('el formulario de observación exige fecha, admite tiempo y valida la nota y «Otra»', () => {
  const nowMs = new Date(2026, 10, 2, 10, 42).getTime();
  const empty = validateObservationDraft({ atMs: nowMs, nowMs });
  assert.equal(empty.valid, false);
  assert.equal(empty.form, 'Marca al menos una etiqueta o escribe una nota.');

  const noDate = validateObservationDraft({ atMs: null, nowMs, tagCodes: ['calm'] });
  assert.equal(noDate.fields.at, 'Escribe la fecha y la hora de la observación.');

  const future = validateObservationDraft({ atMs: nowMs + 120_000, nowMs, tagCodes: ['calm'] });
  assert.equal(future.fields.at, 'La fecha no puede ser posterior a este momento.');

  const otherEmpty = validateObservationDraft({ atMs: nowMs, nowMs, tagCodes: ['other'], otherText: ' ' });
  assert.equal(otherEmpty.fields.otherTag, 'Escribe el texto de la etiqueta «Otra».');

  const unknown = validateObservationDraft({ atMs: nowMs, nowMs, tagCodes: ['nope'] });
  assert.equal(unknown.fields.tags, 'Hay una etiqueta que no existe.');

  const longNote = validateObservationDraft({ atMs: nowMs, nowMs, tagCodes: ['calm'], note: 'a'.repeat(501) });
  assert.equal(longNote.fields.note, 'La nota no puede superar 500 caracteres.');

  const noteOnly = validateObservationDraft({ atMs: nowMs, nowMs, note: 'Ha cantado el estribillo' });
  assert.equal(noteOnly.valid, true);

  const tagsOnly = validateObservationDraft({ atMs: nowMs, nowMs, tagCodes: ['restless'] });
  assert.equal(tagsOnly.valid, true);
});

test('la fecha de la hoja ida y vuelta por el campo datetime-local en hora local', () => {
  const ms = new Date(2026, 10, 2, 10, 42).getTime();
  assert.equal(toDateTimeLocalValue(ms), '2026-11-02T10:42');
  assert.equal(fromDateTimeLocalValue('2026-11-02T10:42'), ms);
  assert.equal(fromDateTimeLocalValue('2026-02-30T10:00'), null, 'un día que no existe no vale');
  assert.equal(fromDateTimeLocalValue('2026-11-02 10:42'), null, 'el formato debe ser el del campo');
  assert.equal(fromDateTimeLocalValue(''), null);
});

test('la lista de canciones del perfil cuenta sus canciones con el plural correcto', () => {
  assert.equal(songCountText(0), 'Sin canciones');
  assert.equal(songCountText(1), '1 canción');
  assert.equal(songCountText(3), '3 canciones');
});

test('cada módulo de pantalla exporta su ruta con el nombre del contrato (2.4)', () => {
  assert.deepEqual(Object.keys(memoryRoutes), ['recuerdo']);
  assert.deepEqual(Object.keys(listRoutes), ['lista']);
  assert.deepEqual(Object.keys(observationRoutes), ['observaciones']);
  assert.equal(typeof memoryRoutes.recuerdo, 'function');
  assert.equal(typeof listRoutes.lista, 'function');
  assert.equal(typeof observationRoutes.observaciones, 'function');
});
