// Pruebas de la lógica del panel «Ahora suena» (frontend/web/js/cuidador/panel.js): valores iniciales,
// validación de lo que se guarda, navegación con flechas, recuerdos vinculados y textos fijos del contrato.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EMPTY_PANEL_TEXT,
  FAMILIARITY_LEGEND,
  FAMILIARITY_LABELS,
  FAMILIARITY_VALUES,
  PREFERENCE_OPTIONS,
  PRESENTATION_OPTIONS,
  linkValues,
  linkedMemories,
  nextRadioIndex,
  panelHeadingFor,
  songPatch,
  songViewModel,
} from '../../frontend/web/js/cuidador/panel.js';

test('los textos fijos del panel coinciden con el contrato (C-5, C-6, C-7 y C2b)', () => {
  assert.equal(
    FAMILIARITY_LEGEND,
    '1 No la reconoce · 2 Le suena poco · 3 Le suena algo · 4 La reconoce · 5 La reconoce bien',
  );
  assert.equal(EMPTY_PANEL_TEXT, 'No suena nada. Elige una canción en la biblioteca.');
  assert.deepEqual(FAMILIARITY_VALUES, [1, 2, 3, 4, 5]);
  assert.equal(FAMILIARITY_LABELS[3], 'Le suena algo');
  assert.deepEqual(PREFERENCE_OPTIONS.map((option) => [option.value, option.label]), [
    [-1, 'No le gusta'],
    [0, 'Le da igual'],
    [1, 'Le gusta'],
  ]);
  assert.deepEqual(PRESENTATION_OPTIONS.map((option) => [option.value, option.label]), [
    ['C0', 'Solo canción'],
    ['C1', 'Canción y recuerdo'],
    ['C2', 'Canción, foto y recuerdo'],
  ]);
});

test('una canción sin asociación empieza sin valorar, con preferencia 0 y presentación C0 (DESIGN D6, D9)', () => {
  assert.deepEqual(linkValues(null), { familiarity: 0, preference: 0, presentation: 'C0' });
  assert.deepEqual(linkValues({ familiarity: 4, preference: 1, presentation: 'C2' }), { familiarity: 4, preference: 1, presentation: 'C2' });
  // Valores que el almacén no admite aquí se tratan como los iniciales.
  assert.deepEqual(linkValues({ familiarity: 9, preference: 2, presentation: 'X' }), { familiarity: 0, preference: 0, presentation: 'C0' });
  assert.deepEqual(linkValues({ familiarity: 0, preference: -1, presentation: 'C1' }), { familiarity: 0, preference: -1, presentation: 'C1' });
});

test('lo que se guarda pasa por validación: familiaridad 1 a 5, preferencia −1, 0 o 1, presentación C0 a C2', () => {
  assert.deepEqual(songPatch('familiarity', 3), { familiarity: 3 });
  assert.throws(() => songPatch('familiarity', 0), /La familiaridad debe ser de 1 a 5/);
  assert.throws(() => songPatch('familiarity', 6), /La familiaridad debe ser de 1 a 5/);
  assert.throws(() => songPatch('familiarity', '3'), /La familiaridad debe ser de 1 a 5/);
  assert.deepEqual(songPatch('preference', -1), { preference: -1 });
  assert.throws(() => songPatch('preference', 2), /La preferencia debe ser/);
  assert.deepEqual(songPatch('presentation', 'C1'), { presentation: 'C1' });
  assert.throws(() => songPatch('presentation', 'C3'), /La presentación no es válida/);
  assert.throws(() => songPatch('notes', 'texto'), /Campo no válido/);
});

test('las flechas recorren un grupo con ajuste circular, y Inicio y Fin van a los extremos', () => {
  assert.equal(nextRadioIndex('ArrowRight', 0, 5), 1);
  assert.equal(nextRadioIndex('ArrowDown', 4, 5), 0);
  assert.equal(nextRadioIndex('ArrowLeft', 0, 5), 4);
  assert.equal(nextRadioIndex('ArrowUp', 2, 5), 1);
  assert.equal(nextRadioIndex('Home', 3, 5), 0);
  assert.equal(nextRadioIndex('End', 0, 5), 4);
  assert.equal(nextRadioIndex('Enter', 0, 5), null);
  assert.equal(nextRadioIndex('ArrowRight', 0, 0), null);
  assert.equal(nextRadioIndex('ArrowRight', -1, 3), 1);
});

test('se muestran como mucho dos recuerdos vinculados a la canción, en el orden recibido', () => {
  const memories = [
    { id: 'a', songIds: ['S1'] },
    { id: 'b', songIds: ['S2'] },
    { id: 'c', songIds: ['S1', 'S3'] },
    { id: 'd', songIds: ['S1'] },
  ];
  assert.deepEqual(linkedMemories(memories, 'S1').map((memory) => memory.id), ['a', 'c']);
  assert.deepEqual(linkedMemories(memories, 'S9'), []);
  assert.deepEqual(linkedMemories(undefined, 'S1'), []);
  assert.deepEqual(linkedMemories([{ id: 'x' }], 'S1'), []);
});

test('la ficha toma los datos del catálogo y, si falta, los de la pista; la fuente viene del catálogo', () => {
  assert.equal(songViewModel(null, null), null);
  assert.deepEqual(songViewModel({ title: 'Hold Me', artist: '', license: 'CC0' }, null), {
    title: 'Hold Me',
    artist: '',
    license: 'CC0',
    initial: 'H',
  });
  const fromTrack = songViewModel(null, { title: 'Track' });
  assert.equal(fromTrack.title, 'Track');
  assert.equal(fromTrack.license, '');
  assert.equal(songViewModel({ title: '   ' }, null).title, 'Sin título');
});

test('el encabezado dice «Ahora suena» si no hay selección o si la canción es la que suena', () => {
  assert.equal(panelHeadingFor(null, 'S1'), 'Ahora suena');
  assert.equal(panelHeadingFor('S1', 'S1'), 'Ahora suena');
  assert.equal(panelHeadingFor('S1', 'S2'), 'Ficha de la canción');
  assert.equal(panelHeadingFor('S1', null), 'Ficha de la canción');
});
