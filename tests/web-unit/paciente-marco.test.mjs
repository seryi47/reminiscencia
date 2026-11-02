// Pruebas de la lógica pura del marco del paciente (frontend/web/js/paciente/shell.js): destinos de la
// navegación (DESIGN 3.1), visibilidad del mini reproductor (P-18), control de toques repetidos (DESIGN 7.1)
// y generación de identificadores. El DOM no se prueba aquí: se cubre en las pruebas de extremo a extremo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createTapGuard,
  miniPlayerVisible,
  nextId,
  NAV_DESTINATIONS,
  PIN_CHANGED_EVENT,
  TAP_GUARD_MS,
} from '../../frontend/web/js/paciente/shell.js';

test('la navegación del paciente tiene cuatro destinos fijos en orden (DESIGN 3.1)', () => {
  assert.deepEqual(NAV_DESTINATIONS.map((destination) => destination.key), ['escuchar', 'listas', 'carpetas', 'buscar']);
  assert.deepEqual(NAV_DESTINATIONS.map((destination) => destination.label), ['Escuchar', 'Listas', 'Carpetas', 'Buscar']);
});

test('el mini reproductor solo se ve con una pista, fuera de Escuchar y si la pantalla lo permite', () => {
  assert.equal(miniPlayerVisible({ allowed: true, hasTrack: true, activeKey: 'listas' }), true);
  assert.equal(miniPlayerVisible({ allowed: true, hasTrack: true, activeKey: 'escuchar' }), false);
  assert.equal(miniPlayerVisible({ allowed: true, hasTrack: false, activeKey: 'listas' }), false);
  assert.equal(miniPlayerVisible({ allowed: false, hasTrack: true, activeKey: 'buscar' }), false);
});

test('un segundo toque sobre el mismo control en 400 ms se ignora (DESIGN 7.1)', () => {
  let now = 0;
  const guard = createTapGuard(TAP_GUARD_MS, () => now);
  const button = {};
  assert.equal(guard.accept(button), true);
  now = 100;
  assert.equal(guard.accept(button), false);
  now = 450;
  assert.equal(guard.accept(button), true);
});

test('el control de toques es independiente para cada control', () => {
  let now = 0;
  const guard = createTapGuard(TAP_GUARD_MS, () => now);
  const first = {};
  const second = {};
  assert.equal(guard.accept(first), true);
  now = 10;
  assert.equal(guard.accept(second), true);
});

test('los identificadores generados no se repiten y llevan el prefijo', () => {
  const first = nextId('p1b');
  const second = nextId('p1b');
  assert.notEqual(first, second);
  assert.ok(first.startsWith('p1b-'));
});

test('el evento de cambio de PIN tiene nombre fijo para la cabecera y la salida', () => {
  assert.equal(PIN_CHANGED_EVENT, 'reminiscencia:pin-cambiado');
});
