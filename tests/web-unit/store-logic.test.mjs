// Pruebas de la lógica de store.js que no necesita IndexedDB: validación de alias y de PIN,
// apertura sin almacenamiento disponible, combinación de copias y constantes del contrato.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DB_NAME,
  DB_VERSION,
  DEFAULT_PATIENT_OPTIONS,
  DEFAULT_SETTINGS,
  openStore,
  planMerge,
  validateAlias,
  validatePin,
} from '../../frontend/web/js/store.js';
import { validatePatientOptions, validateSettings } from '../../frontend/web/js/schema.js';

test('constantes del contrato: base reminiscencia, versión 1', () => {
  assert.equal(DB_NAME, 'reminiscencia');
  assert.equal(DB_VERSION, 1);
});

test('alias: se valida igual que en el almacén (1–60 caracteres, sin vacíos ni saltos de línea)', () => {
  assert.deepEqual(validateAlias('Persona de prueba'), []);
  assert.deepEqual(validateAlias('a'), []);
  assert.deepEqual(validateAlias('a'.repeat(60)), []);
  assert.equal(validateAlias('a'.repeat(61)).length, 1);
  assert.equal(validateAlias('').length, 1);
  assert.equal(validateAlias('  \t ').length, 1);
  assert.equal(validateAlias('Persona\nde prueba').length, 1);
  assert.equal(validateAlias(undefined).length, 1);
});

test('PIN: 4 a 12 dígitos; cualquier otra cosa se rechaza con un mensaje en español', () => {
  assert.deepEqual(validatePin('0000'), []);
  assert.deepEqual(validatePin('123456789012'), []);
  assert.deepEqual(validatePin('123'), ['El PIN debe tener entre 4 y 12 dígitos.']);
  assert.equal(validatePin('1234567890123').length, 1);
  assert.equal(validatePin('12ab').length, 1);
  assert.equal(validatePin(null).length, 1);
});

test('sin IndexedDB, la apertura rechaza con un mensaje en español', async () => {
  await assert.rejects(openStore({ indexedDB: null }), {
    message: 'Este navegador no permite guardar datos en el dispositivo.',
  });
});

test('una fábrica que falla al abrir rechaza la apertura sin dejar promesas colgadas', async () => {
  const factory = {
    open() {
      const request = {};
      queueMicrotask(() => request.onerror?.());
      return request;
    },
  };
  await assert.rejects(openStore({ indexedDB: factory }), {
    message: 'No se pudo abrir el almacenamiento local.',
  });
});

test('una fábrica que lanza al abrir rechaza la apertura', async () => {
  const factory = { open() { throw new Error('acceso denegado'); } };
  await assert.rejects(openStore({ indexedDB: factory }), {
    message: 'No se pudo abrir el almacenamiento local.',
  });
});

test('una base bloqueada por otra pestaña avisa en español', async () => {
  const factory = {
    open() {
      const request = {};
      queueMicrotask(() => request.onblocked?.());
      return request;
    },
  };
  await assert.rejects(openStore({ indexedDB: factory }), /otra pestaña/);
});

test('valores por defecto: ajustes y opciones del paciente cumplen el esquema', () => {
  assert.deepEqual(validateSettings(DEFAULT_SETTINGS), []);
  assert.deepEqual(validatePatientOptions(DEFAULT_PATIENT_OPTIONS), []);
  assert.equal(DEFAULT_SETTINGS.theme, 'auto');
  assert.equal(DEFAULT_PATIENT_OPTIONS.volumeLimit, 100);
});

test('combinar: un registro nuevo se añade', () => {
  const incoming = [{ id: 'a', updatedAt: 10 }];
  assert.deepEqual(planMerge([], incoming), incoming);
});

test('combinar: gana el registro más reciente', () => {
  const local = [{ id: 'a', updatedAt: 10, title: 'local' }];
  const newer = { id: 'a', updatedAt: 20, title: 'copia' };
  assert.deepEqual(planMerge(local, [newer]), [newer]);
});

test('combinar: si el local es más reciente o tiene la misma fecha, se conserva el local', () => {
  const local = [{ id: 'a', updatedAt: 20 }];
  assert.deepEqual(planMerge(local, [{ id: 'a', updatedAt: 10 }]), []);
  assert.deepEqual(planMerge(local, [{ id: 'a', updatedAt: 20 }]), []);
});

test('combinar: los registros sin fecha de actualización usan la de escucha o creación', () => {
  const local = [{ id: 'h', at: 50 }];
  assert.deepEqual(planMerge(local, [{ id: 'h', at: 40 }]), []);
  assert.deepEqual(planMerge(local, [{ id: 'h', at: 60 }]), [{ id: 'h', at: 60 }]);
  const photos = [{ id: 'p', createdAt: 5 }];
  assert.deepEqual(planMerge(photos, [{ id: 'p', createdAt: 5 }]), []);
});

test('combinar: con clave compuesta (asociaciones perfil–canción)', () => {
  const keyFn = (record) => `${record.profileId}/${record.songId}`;
  const local = [{ profileId: 'p1', songId: 'S0123456789abcdef', updatedAt: 10 }];
  const incoming = [
    { profileId: 'p1', songId: 'S0123456789abcdef', updatedAt: 5 },
    { profileId: 'p1', songId: 'Sfedcba9876543210', updatedAt: 5 },
  ];
  const written = planMerge(local, incoming, keyFn);
  assert.deepEqual(written, [{ profileId: 'p1', songId: 'Sfedcba9876543210', updatedAt: 5 }]);
});
