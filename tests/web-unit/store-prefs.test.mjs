// Pruebas de prefs.js: preferencias de pantalla en localStorage con try/catch.
// Usa un almacenamiento falso inyectado; no toca localStorage real.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createPrefs,
  PREF_DEFAULTS,
  PREF_VALUES,
  PREFS_STORAGE_KEY,
  prefs,
  validatePref,
} from '../../frontend/web/js/prefs.js';

// Almacenamiento en memoria con la misma interfaz que localStorage.
function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => { data.set(key, String(value)); },
  };
}

// Almacenamiento que falla siempre, como un navegador con el almacenamiento bloqueado.
const brokenStorage = {
  getItem() { throw new Error('acceso denegado'); },
  setItem() { throw new Error('cuota llena'); },
};

test('valores por defecto: tamaño 1, contraste normal, apariencia automática, movimiento del sistema y atajos activados', () => {
  assert.deepEqual(PREF_DEFAULTS, {
    textScale: 1,
    contrast: 'normal',
    theme: 'auto',
    reduceMotion: 'sistema',
    shortcuts: 'activados',
  });
  assert.deepEqual(PREF_VALUES.textScale, [1, 1.25, 1.5, 1.75]);
  assert.deepEqual(PREF_VALUES.theme, ['auto', 'claro', 'oscuro']);
});

test('sin nada guardado, todas las preferencias valen lo de por defecto', () => {
  const p = createPrefs(() => memoryStorage());
  assert.deepEqual(p.all(), PREF_DEFAULTS);
});

test('set guarda el valor en localStorage y get lo devuelve; set informa de que quedó guardado', () => {
  const storage = memoryStorage();
  const p = createPrefs(() => storage);
  assert.equal(p.set('textScale', 1.5), true);
  assert.equal(p.get('textScale'), 1.5);
  assert.equal(JSON.parse(storage.data.get(PREFS_STORAGE_KEY)).textScale, 1.5);
  // Otra instancia (otra carga de la página) lee lo mismo.
  assert.equal(createPrefs(() => storage).get('textScale'), 1.5);
});

test('cada preferencia admite sus valores y conserva las demás al cambiar una', () => {
  const storage = memoryStorage();
  const p = createPrefs(() => storage);
  p.set('contrast', 'alto');
  p.set('theme', 'claro');
  p.set('reduceMotion', 'si');
  p.set('shortcuts', 'desactivados');
  assert.deepEqual(p.all(), {
    textScale: 1, contrast: 'alto', theme: 'claro', reduceMotion: 'si', shortcuts: 'desactivados',
  });
  assert.deepEqual(Object.keys(JSON.parse(storage.data.get(PREFS_STORAGE_KEY))).sort(),
    ['contrast', 'reduceMotion', 'shortcuts', 'theme']);
});

test('un valor no permitido se rechaza con un mensaje en español y no se guarda', () => {
  const storage = memoryStorage();
  const p = createPrefs(() => storage);
  assert.throws(() => p.set('textScale', 1.6), { message: 'El tamaño del texto debe ser 1, 1,25, 1,5 o 1,75.' });
  assert.throws(() => p.set('theme', 'azul'), { message: 'La apariencia debe ser automática, clara u oscura.' });
  assert.throws(() => p.set('contrast', true), { message: 'El contraste debe ser normal o alto.' });
  assert.equal(storage.data.has(PREFS_STORAGE_KEY), false);
  assert.equal(p.get('textScale'), 1);
});

test('una clave desconocida se rechaza al leer y al escribir', () => {
  const p = createPrefs(() => memoryStorage());
  assert.throws(() => p.get('volumen'), { message: 'Preferencia desconocida.' });
  assert.throws(() => p.set('volumen', 3), { message: 'Preferencia desconocida.' });
  assert.equal(validatePref('volumen', 3), 'Preferencia desconocida.');
});

test('validatePref devuelve null para valores válidos y el mensaje para los demás', () => {
  assert.equal(validatePref('textScale', 1.75), null);
  assert.equal(validatePref('reduceMotion', 'sistema'), null);
  assert.equal(validatePref('shortcuts', 'activados'), null);
  assert.equal(validatePref('textScale', '1.5'), 'El tamaño del texto debe ser 1, 1,25, 1,5 o 1,75.');
});

test('un valor guardado a mano no válido se ignora y vuelve el valor por defecto', () => {
  const storage = memoryStorage({
    [PREFS_STORAGE_KEY]: JSON.stringify({ textScale: 9, contrast: 'alto', theme: 'verde' }),
  });
  const p = createPrefs(() => storage);
  assert.equal(p.get('textScale'), 1);
  assert.equal(p.get('theme'), 'auto');
  assert.equal(p.get('contrast'), 'alto');
});

test('un JSON roto en localStorage equivale a no tener nada guardado, y set lo repara', () => {
  const storage = memoryStorage({ [PREFS_STORAGE_KEY]: '{no es json' });
  const p = createPrefs(() => storage);
  assert.deepEqual(p.all(), PREF_DEFAULTS);
  assert.equal(p.set('textScale', 1.25), true);
  assert.equal(JSON.parse(storage.data.get(PREFS_STORAGE_KEY)).textScale, 1.25);
});

test('si localStorage falla al leer o al escribir, get devuelve lo de por defecto y set no lanza', () => {
  const p = createPrefs(() => brokenStorage);
  assert.deepEqual(p.all(), PREF_DEFAULTS);
  assert.equal(p.set('textScale', 1.5), false);
});

test('sin almacenamiento, el valor fijado vale durante la sesión; una nueva carga vuelve al valor por defecto', () => {
  const session = createPrefs(() => null);
  assert.equal(session.set('contrast', 'alto'), false);
  assert.equal(session.get('contrast'), 'alto');
  assert.equal(createPrefs(() => null).get('contrast'), 'normal');
});

test('si acceder a localStorage lanza una excepción, se usan los valores por defecto sin fallar', () => {
  const p = createPrefs(() => { throw new Error('bloqueado por el navegador'); });
  assert.deepEqual(p.all(), PREF_DEFAULTS);
  assert.equal(p.set('theme', 'oscuro'), false);
  assert.equal(p.get('theme'), 'oscuro');
});

test('el gestor compartido de la aplicación existe y responde a get, set y all', () => {
  assert.equal(typeof prefs.get, 'function');
  assert.equal(typeof prefs.set, 'function');
  assert.equal(typeof prefs.all, 'function');
});
