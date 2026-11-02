// Pruebas de la lógica pura de la salida al modo cuidador (frontend/web/js/paciente/salida.js): teclado del PIN
// (P-16), indicadores, texto pegado y cuenta atrás del bloqueo (DESIGN D12). Sin DOM; PIN ficticio.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  lockRemainingSeconds,
  PIN_MAX_DIGITS,
  PIN_MIN_DIGITS,
  pastePinDigits,
  pinCanSubmit,
  pinSlotCount,
  typePinDigit,
} from '../../frontend/web/js/paciente/salida.js';

test('typePinDigit añade dígitos hasta seis y solo acepta cifras', () => {
  assert.equal(typePinDigit('12', '3'), '123');
  assert.equal(typePinDigit('123456', '7'), '123456');
  assert.equal(typePinDigit('', '12'), '');
  assert.equal(typePinDigit('1', 'a'), '1');
});

test('«Borrar» y Retroceso quitan el último dígito', () => {
  assert.equal(typePinDigit('12', 'Borrar'), '1');
  assert.equal(typePinDigit('12', 'Backspace'), '1');
  assert.equal(typePinDigit('', 'Backspace'), '');
});

test('pastePinDigits toma solo las cifras pegadas, hasta seis', () => {
  assert.equal(pastePinDigits(' 12-34 56 78 '), '123456');
  assert.equal(pastePinDigits('abc'), '');
  assert.equal(pastePinDigits(undefined), '');
});

test('pinSlotCount muestra cuatro indicadores y seis desde el quinto dígito', () => {
  assert.equal(pinSlotCount(0), 4);
  assert.equal(pinSlotCount(4), 4);
  assert.equal(pinSlotCount(5), 6);
  assert.equal(pinSlotCount(6), 6);
});

test('pinCanSubmit solo acepta entre cuatro y seis dígitos (DESIGN D12)', () => {
  assert.equal(PIN_MIN_DIGITS, 4);
  assert.equal(PIN_MAX_DIGITS, 6);
  assert.equal(pinCanSubmit('123'), false);
  assert.equal(pinCanSubmit('1234'), true);
  assert.equal(pinCanSubmit('123456'), true);
  assert.equal(pinCanSubmit('1234567'), false);
});

test('lockRemainingSeconds cuenta hacia arriba el segundo restante y no baja de cero', () => {
  assert.equal(lockRemainingSeconds(10000 + 45000, 10000), 45);
  assert.equal(lockRemainingSeconds(10000, 10000), 0);
  assert.equal(lockRemainingSeconds(10001, 10000), 1);
  assert.equal(lockRemainingSeconds(5000, 10000), 0);
  assert.equal(lockRemainingSeconds(null, 10000), 0);
});
