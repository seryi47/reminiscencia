// Pruebas de la hoja «Empezar sesión» (frontend/web/js/cuidador/sesion.js): opciones del formulario, punto de
// inicio, apagado automático y la petición que recibe enterPatientMode (DESIGN C4 y 8.2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STUDY_CONDITIONS } from '../../frontend/web/js/schema.js';
import {
  CONDITION_CHOICES,
  SLEEP_CHOICES,
  buildSessionRequest,
  parseStartPoint,
  sleepChoiceFor,
  sleepMinutesOf,
  startPointOptions,
  startPointValue,
} from '../../frontend/web/js/cuidador/sesion.js';

test('las condiciones son las dos del DESIGN 8.2 y usan los códigos del almacén', () => {
  assert.deepEqual(CONDITION_CHOICES.map((choice) => choice.label), ['Según cada canción', 'Solo audio']);
  assert.deepEqual(CONDITION_CHOICES.map((choice) => choice.value), [...STUDY_CONDITIONS]);
});

test('el apagado automático ofrece No, 15, 30 y 60 minutos', () => {
  assert.deepEqual(SLEEP_CHOICES.map((choice) => choice.label), ['No', '15 minutos', '30 minutos', '60 minutos']);
  assert.equal(sleepMinutesOf('no'), null);
  assert.equal(sleepMinutesOf('15'), 15);
  assert.equal(sleepMinutesOf('60'), 60);
  assert.equal(sleepMinutesOf('45'), null);
  assert.equal(sleepChoiceFor(null), 'no');
  assert.equal(sleepChoiceFor(30), '30');
  assert.equal(sleepChoiceFor(45), 'no');
});

test('el punto de inicio se lee de «lista:<id>» o «carpeta:<id>»; vacío significa sin punto de inicio', () => {
  assert.equal(parseStartPoint(''), null);
  assert.deepEqual(parseStartPoint('lista:L1'), { type: 'lista', id: 'L1' });
  assert.deepEqual(parseStartPoint('carpeta:f1'), { type: 'carpeta', id: 'f1' });
  assert.equal(parseStartPoint('otro:x'), null);
  assert.equal(parseStartPoint('lista:'), null);
  assert.equal(parseStartPoint('lista'), null);
  assert.equal(parseStartPoint(':x'), null);
  assert.equal(startPointValue({ type: 'lista', id: 'L1' }), 'lista:L1');
  assert.equal(startPointValue(null), '');
});

test('las opciones del punto de inicio salen de las listas del perfil y de las carpetas', () => {
  const groups = startPointOptions([{ id: 'L1', name: 'Boleros' }], [{ id: 'f1', name: 'Años 50' }]);
  assert.deepEqual(groups.lists, [{ value: 'lista:L1', label: 'Boleros' }]);
  assert.deepEqual(groups.folders, [{ value: 'carpeta:f1', label: 'Años 50' }]);
  assert.deepEqual(startPointOptions(), { lists: [], folders: [] });
});

test('la petición de sesión lleva perfil, condición, punto de inicio y apagado', () => {
  assert.deepEqual(buildSessionRequest({ profileId: 'p1', condition: 'segun-cancion' }), {
    profileId: 'p1',
    session: { condition: 'segun-cancion', startPoint: null, sleepMinutes: null },
  });
  assert.deepEqual(
    buildSessionRequest({
      profileId: 'p1',
      condition: 'solo-audio',
      startPoint: { type: 'carpeta', id: 'f1' },
      sleepMinutes: 30,
    }),
    {
      profileId: 'p1',
      session: { condition: 'solo-audio', startPoint: { type: 'carpeta', id: 'f1' }, sleepMinutes: 30 },
    },
  );
});

test('la petición rechaza perfil, condición, punto de inicio o apagado no válidos, con el mensaje en español', () => {
  assert.throws(() => buildSessionRequest({ profileId: '', condition: 'solo-audio' }), /Elige un perfil para empezar la sesión/);
  assert.throws(() => buildSessionRequest({ condition: 'solo-audio' }), /Elige un perfil para empezar la sesión/);
  assert.throws(() => buildSessionRequest({ profileId: 'p1', condition: 'otra' }), /La condición de la sesión no es válida/);
  assert.throws(
    () => buildSessionRequest({ profileId: 'p1', condition: 'solo-audio', startPoint: { type: 'x', id: '1' } }),
    /El punto de inicio no es válido/,
  );
  assert.throws(
    () => buildSessionRequest({ profileId: 'p1', condition: 'solo-audio', sleepMinutes: 45 }),
    /El apagado automático debe ser No, 15, 30 o 60 minutos/,
  );
});
