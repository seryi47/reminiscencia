// Pruebas del bloqueo del PIN (DESIGN D12): cinco fallos bloquean 60 s, un acierto reinicia el recuento
// y el bloqueo caduca solo. Funciones puras de store.js; el almacenamiento real está en store-idb.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  activePinLockout,
  nextPinLockout,
  PIN_LOCK_MS,
  PIN_MAX_FAILURES,
} from '../../frontend/web/js/store.js';

const NOW = 1_700_000_000_000;

test('constantes del bloqueo: cinco fallos y 60 segundos', () => {
  assert.equal(PIN_MAX_FAILURES, 5);
  assert.equal(PIN_LOCK_MS, 60_000);
});

test('sin estado guardado no hay fallos ni bloqueo', () => {
  assert.deepEqual(activePinLockout(undefined, NOW), { failures: 0, lockedUntil: null });
  assert.deepEqual(activePinLockout(null, NOW), { failures: 0, lockedUntil: null });
  assert.deepEqual(activePinLockout({ failures: -1, lockedUntil: null }, NOW), { failures: 0, lockedUntil: null });
});

test('cuatro fallos no bloquean; el quinto bloquea 60 s desde ese momento', () => {
  let state = null;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    state = nextPinLockout(state, false, NOW);
    assert.deepEqual(state, { failures: attempt, lockedUntil: null });
  }
  state = nextPinLockout(state, false, NOW);
  assert.deepEqual(state, { failures: 5, lockedUntil: NOW + 60_000 });
});

test('un acierto antes del quinto fallo reinicia el recuento', () => {
  let state = null;
  for (let i = 0; i < 3; i += 1) state = nextPinLockout(state, false, NOW);
  assert.equal(state.failures, 3);
  assert.deepEqual(nextPinLockout(state, true, NOW + 1000), { failures: 0, lockedUntil: null });
});

test('durante el bloqueo, ni los fallos ni los aciertos cambian el estado', () => {
  const locked = { failures: 5, lockedUntil: NOW + 60_000 };
  assert.deepEqual(nextPinLockout(locked, false, NOW + 10_000), locked);
  assert.deepEqual(nextPinLockout(locked, true, NOW + 10_000), locked);
});

test('el bloqueo caduca justo en su marca de tiempo y el recuento vuelve a empezar', () => {
  const locked = { failures: 5, lockedUntil: NOW + 60_000 };
  assert.deepEqual(activePinLockout(locked, NOW + 59_999), locked);
  assert.deepEqual(activePinLockout(locked, NOW + 60_000), { failures: 0, lockedUntil: null });
  assert.deepEqual(nextPinLockout(locked, false, NOW + 60_000), { failures: 1, lockedUntil: null });
});

test('el resultado del intento debe ser sí o no: cualquier otro valor se rechaza', () => {
  assert.throws(() => nextPinLockout(null, 'si', NOW), { message: 'El resultado del intento no es válido.' });
  assert.throws(() => nextPinLockout(null, undefined, NOW), { message: 'El resultado del intento no es válido.' });
});
