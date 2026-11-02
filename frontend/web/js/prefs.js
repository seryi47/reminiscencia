// Preferencias de pantalla de Reminiscencia: tamaño de texto, contraste, apariencia, movimiento y atajos.
// Se guardan en localStorage, en una sola clave con un objeto JSON, y no contienen datos personales.
// Todo acceso a localStorage va en try/catch: si el navegador no lo deja usar (modo privado, bloqueo de
// almacenamiento), el valor vale durante esta sesión y, al recargar, vuelve el valor por defecto.
// Apariencia: en cuidador, «auto» sigue al sistema; en paciente, la interfaz usa «claro» (contrato, sección 4).

import { isPlainObject } from './schema.js';

export const PREFS_STORAGE_KEY = 'reminiscencia.prefs';

export const PREF_DEFAULTS = Object.freeze({
  textScale: 1,
  contrast: 'normal',
  theme: 'auto',
  reduceMotion: 'sistema',
  shortcuts: 'activados',
});

export const PREF_VALUES = Object.freeze({
  textScale: Object.freeze([1, 1.25, 1.5, 1.75]),
  contrast: Object.freeze(['normal', 'alto']),
  theme: Object.freeze(['auto', 'claro', 'oscuro']),
  reduceMotion: Object.freeze(['sistema', 'si', 'no']),
  shortcuts: Object.freeze(['activados', 'desactivados']),
});

const PREF_KEYS = Object.freeze(Object.keys(PREF_DEFAULTS));

const PREF_MESSAGES = Object.freeze({
  textScale: 'El tamaño del texto debe ser 1, 1,25, 1,5 o 1,75.',
  contrast: 'El contraste debe ser normal o alto.',
  theme: 'La apariencia debe ser automática, clara u oscura.',
  reduceMotion: 'La reducción de movimiento debe ser según el sistema, sí o no.',
  shortcuts: 'Los atajos de una tecla deben estar activados o desactivados.',
});

// Devuelve el mensaje de error de una preferencia, o null si el valor es válido.
export function validatePref(key, value) {
  if (!PREF_KEYS.includes(key)) return 'Preferencia desconocida.';
  return PREF_VALUES[key].includes(value) ? null : PREF_MESSAGES[key];
}

// Obtiene localStorage sin lanzar: en algunos navegadores incluso leer la propiedad falla.
function storageOf(getStorage) {
  try {
    return getStorage() ?? null;
  } catch {
    return null;
  }
}

// Lee el objeto guardado. Cualquier fallo (sin almacenamiento, JSON roto) equivale a no tener nada guardado.
function readStored(storage) {
  try {
    const raw = storage ? storage.getItem(PREFS_STORAGE_KEY) : null;
    const parsed = raw === null || raw === undefined ? {} : JSON.parse(raw);
    return isPlainObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

// Crea el gestor de preferencias. getStorage devuelve localStorage (o null); se inyecta para las pruebas.
export function createPrefs(getStorage = () => globalThis.localStorage) {
  // Valores fijados en esta sesión: se ven aunque el navegador no guarde nada.
  const session = {};

  const get = (key) => {
    if (!PREF_KEYS.includes(key)) throw new Error('Preferencia desconocida.');
    if (session[key] !== undefined) return session[key];
    const stored = readStored(storageOf(getStorage))[key];
    return validatePref(key, stored) === null ? stored : PREF_DEFAULTS[key];
  };

  // Devuelve true si el valor quedó guardado en localStorage y false si solo vale durante la sesión.
  const set = (key, value) => {
    const problem = validatePref(key, value);
    if (problem !== null) throw new Error(problem);
    session[key] = value;
    const storage = storageOf(getStorage);
    if (!storage) return false;
    try {
      const current = readStored(storage);
      const next = {};
      for (const name of PREF_KEYS) {
        if (validatePref(name, current[name]) === null) next[name] = current[name];
      }
      next[key] = value;
      storage.setItem(PREFS_STORAGE_KEY, JSON.stringify(next));
      return true;
    } catch {
      return false;
    }
  };

  const all = () => Object.fromEntries(PREF_KEYS.map((key) => [key, get(key)]));

  return { get, set, all };
}

// Gestor compartido de la aplicación.
export const prefs = createPrefs();
