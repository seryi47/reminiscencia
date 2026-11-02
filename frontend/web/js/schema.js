// Validación de datos de Reminiscencia: alias, PIN, ajustes, registros y copias.
// Cada validador devuelve una lista de mensajes en español; lista vacía = válido.
// Los mensajes no repiten el contenido escrito por la persona usuaria (privacidad).
// Los límites de texto se cuentan en caracteres (un emoji cuenta como uno).

export const LIMITS = Object.freeze({
  alias: 60,
  code: 40,
  memoryTitle: 80,
  memoryText: 1000,
  memoryPeople: 20,
  personAlias: 60,
  memorySongs: 50,
  memoryPhotos: 10,
  caption: 200,
  playlistName: 80,
  playlistSongs: 500,
  observationText: 1000,
  notes: 500,
  listenedMaxS: 86400,
});

export const PHOTO_TYPES = Object.freeze(['image/jpeg', 'image/png', 'image/webp']);
export const PHOTO_MAX_BYTES = 8 * 1024 * 1024;
export const THEMES = Object.freeze(['dark', 'light', 'auto']);
export const SLEEP_TIMER_MINUTES = Object.freeze([15, 30, 60]);
export const BACKUP_PAYLOAD_VERSION = 1;
export const SETTING_KEYS = Object.freeze([
  'textScale', 'highContrast', 'reduceMotion', 'theme', 'sleepTimerMinutes', 'alwaysPatientMode',
]);
export const PATIENT_OPTION_KEYS = Object.freeze(['volumeLimit', 'repeatList', 'resumeOnOpen', 'seekOnTap']);

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const SONG_ID_PATTERN = /^S[0-9a-f]{16}$/;
// Una línea: ningún carácter de control. Varias líneas: se admiten tabulador, salto de línea y retorno.
const CONTROL_SINGLE_LINE = /[\u0000-\u001F\u007F]/;
const CONTROL_MULTI_LINE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const MAX_PHOTO_BASE64 = Math.ceil(PHOTO_MAX_BYTES / 3) * 4;
const MAX_BACKUP_ERRORS = 20;

export const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
export const isId = (value) => typeof value === 'string' && ID_PATTERN.test(value);
// Identificador de canción del catálogo: S seguido de 16 caracteres hexadecimales.
export const isSongId = (value) => typeof value === 'string' && SONG_ID_PATTERN.test(value);

const isBoolean = (value) => typeof value === 'boolean';
const isTimestamp = (value) => Number.isSafeInteger(value) && value >= 0;
const isIntegerIn = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
const isList = (value, max, predicate) => Array.isArray(value) && value.length <= max && value.every(predicate);
const charCount = (text) => Array.from(text).length;

// Devuelve el problema de un texto (con su etiqueta al inicio) o null si es válido.
function textProblem(value, label, { min = 0, max, multiline = false }) {
  if (typeof value !== 'string') return `${label} debe ser texto.`;
  const text = value.trim();
  const count = charCount(text);
  if (count < min) return `${label} no puede estar vacío.`;
  if (count > max) return `${label} no puede superar ${max} caracteres.`;
  const forbidden = multiline ? CONTROL_MULTI_LINE : CONTROL_SINGLE_LINE;
  if (forbidden.test(text)) return `${label} contiene caracteres no permitidos.`;
  return null;
}

// Alias de perfil: entre 1 y 60 caracteres, sin saltos de línea.
export function validateAlias(alias) {
  if (typeof alias !== 'string' || alias.trim() === '') return ['Escribe un alias para el perfil.'];
  const text = alias.trim();
  if (charCount(text) > LIMITS.alias) return [`El alias no puede superar ${LIMITS.alias} caracteres.`];
  if (CONTROL_SINGLE_LINE.test(text)) return ['El alias contiene caracteres no permitidos.'];
  return [];
}

// PIN: solo dígitos, de 4 a 12.
export function validatePin(pin) {
  if (typeof pin !== 'string' || !/^[0-9]{4,12}$/.test(pin)) {
    return ['El PIN debe tener entre 4 y 12 dígitos.'];
  }
  return [];
}

const SETTING_RULES = {
  textScale: [(v) => typeof v === 'number' && v >= 1 && v <= 1.6, 'El tamaño del texto debe estar entre 1,0 y 1,6.'],
  highContrast: [isBoolean, 'El contraste alto debe ser sí o no.'],
  reduceMotion: [isBoolean, 'La reducción de movimiento debe ser sí o no.'],
  theme: [(v) => THEMES.includes(v), 'La apariencia debe ser oscura, clara o automática.'],
  sleepTimerMinutes: [
    (v) => v === null || SLEEP_TIMER_MINUTES.includes(v),
    'El apagado automático debe ser No, 15, 30 o 60 minutos.',
  ],
  alwaysPatientMode: [isBoolean, 'Abrir siempre en modo paciente debe ser sí o no.'],
};

// Ajustes del cuidador y del dispositivo. Con { partial: true } se validan solo los campos presentes.
export function validateSettings(settings, { partial = false } = {}) {
  if (!isPlainObject(settings)) return ['Los ajustes deben ser un objeto.'];
  const errors = [];
  for (const key of Object.keys(settings)) {
    if (!SETTING_KEYS.includes(key)) errors.push(`Ajuste desconocido: ${key}.`);
  }
  for (const key of SETTING_KEYS) {
    if (!Object.hasOwn(settings, key)) {
      if (!partial) errors.push(`Falta el ajuste ${key}.`);
    } else if (!SETTING_RULES[key][0](settings[key])) {
      errors.push(SETTING_RULES[key][1]);
    }
  }
  return errors;
}

const PATIENT_RULES = {
  volumeLimit: [(v) => isIntegerIn(v, 50, 100), 'El límite de volumen debe estar entre 50 % y 100 %.'],
  repeatList: [isBoolean, 'Repetir la lista debe ser sí o no.'],
  resumeOnOpen: [isBoolean, 'Reanudar al abrir debe ser sí o no.'],
  seekOnTap: [isBoolean, 'Saltar al tocar la barra debe ser sí o no.'],
};

// Opciones del paciente, por perfil. Con { partial: true } se validan solo los campos presentes.
export function validatePatientOptions(options, { partial = false } = {}) {
  if (!isPlainObject(options)) return ['Las opciones del paciente deben ser un objeto.'];
  const errors = [];
  for (const key of Object.keys(options)) {
    if (!PATIENT_OPTION_KEYS.includes(key)) errors.push(`Opción del paciente desconocida: ${key}.`);
  }
  for (const key of PATIENT_OPTION_KEYS) {
    if (!Object.hasOwn(options, key)) {
      if (!partial) errors.push(`Falta la opción del paciente ${key}.`);
    } else if (!PATIENT_RULES[key][0](options[key])) {
      errors.push(PATIENT_RULES[key][1]);
    }
  }
  return errors;
}

export function validateProfile(profile) {
  if (!isPlainObject(profile)) return ['El perfil no es válido.'];
  const errors = [];
  const add = (problem) => { if (problem) errors.push(problem); };
  if (!isId(profile.id)) errors.push('Perfil: identificador no válido.');
  add(textProblem(profile.alias, 'El alias', { min: 1, max: LIMITS.alias }));
  add(textProblem(profile.code, 'El código del participante', { max: LIMITS.code }));
  errors.push(...validatePatientOptions(profile.options));
  if (!isTimestamp(profile.createdAt) || !isTimestamp(profile.updatedAt)) errors.push('Perfil: fechas no válidas.');
  return errors;
}

export function validateMemory(memory) {
  if (!isPlainObject(memory)) return ['El recuerdo no es válido.'];
  const errors = [];
  const add = (problem) => { if (problem) errors.push(problem); };
  const personOk = (person) => textProblem(person, 'Una persona', { min: 1, max: LIMITS.personAlias }) === null;
  if (!isId(memory.id)) errors.push('Recuerdo: identificador no válido.');
  if (!isId(memory.profileId)) errors.push('Recuerdo: perfil no válido.');
  add(textProblem(memory.title, 'Recuerdo: el título', { min: 1, max: LIMITS.memoryTitle }));
  add(textProblem(memory.text, 'Recuerdo: el texto', { max: LIMITS.memoryText, multiline: true }));
  if (!(memory.year === null || isIntegerIn(memory.year, 1000, 9999))) {
    errors.push('Recuerdo: el año debe tener cuatro cifras o quedar vacío.');
  }
  if (!isList(memory.people, LIMITS.memoryPeople, personOk)) errors.push('Recuerdo: la lista de personas no es válida.');
  if (!isList(memory.songIds, LIMITS.memorySongs, isSongId)) errors.push('Recuerdo: la lista de canciones no es válida.');
  if (!isList(memory.photoIds, LIMITS.memoryPhotos, isId)) errors.push('Recuerdo: la lista de fotografías no es válida.');
  if (!isTimestamp(memory.createdAt) || !isTimestamp(memory.updatedAt)) errors.push('Recuerdo: fechas no válidas.');
  return errors;
}

export function validatePlaylist(playlist) {
  if (!isPlainObject(playlist)) return ['La lista no es válida.'];
  const errors = [];
  const add = (problem) => { if (problem) errors.push(problem); };
  if (!isId(playlist.id)) errors.push('Lista: identificador no válido.');
  if (!isId(playlist.profileId)) errors.push('Lista: perfil no válido.');
  add(textProblem(playlist.name, 'Lista: el nombre', { min: 1, max: LIMITS.playlistName }));
  if (!isList(playlist.songIds, LIMITS.playlistSongs, isSongId)) errors.push('Lista: las canciones no son válidas.');
  if (!isTimestamp(playlist.createdAt) || !isTimestamp(playlist.updatedAt)) errors.push('Lista: fechas no válidas.');
  return errors;
}

// Relación entre una persona y una canción: familiaridad 0–5, preferencia −2 a 2.
export function validateSongLink(link) {
  if (!isPlainObject(link)) return ['La asociación no es válida.'];
  const errors = [];
  const add = (problem) => { if (problem) errors.push(problem); };
  if (!isId(link.profileId)) errors.push('Canción: perfil no válido.');
  if (!isSongId(link.songId)) errors.push('Canción: identificador no válido.');
  if (!isIntegerIn(link.familiarity, 0, 5)) errors.push('Canción: la familiaridad debe ser un número entero del 0 al 5.');
  if (!isIntegerIn(link.preference, -2, 2)) errors.push('Canción: la preferencia debe ser un número entero de −2 a 2.');
  add(textProblem(link.notes, 'Canción: las notas', { max: LIMITS.notes, multiline: true }));
  if (!isTimestamp(link.updatedAt)) errors.push('Canción: fecha no válida.');
  return errors;
}

export function validateObservation(observation) {
  if (!isPlainObject(observation)) return ['La observación no es válida.'];
  const errors = [];
  const add = (problem) => { if (problem) errors.push(problem); };
  if (!isId(observation.id)) errors.push('Observación: identificador no válido.');
  if (!isId(observation.profileId)) errors.push('Observación: perfil no válido.');
  if (!isTimestamp(observation.at)) errors.push('Observación: fecha no válida.');
  add(textProblem(observation.text, 'Observación: el texto', { min: 1, max: LIMITS.observationText, multiline: true }));
  if (!(observation.songId === null || isSongId(observation.songId))) errors.push('Observación: canción no válida.');
  return errors;
}

export function validateHistoryEntry(entry) {
  if (!isPlainObject(entry)) return ['La escucha no es válida.'];
  const errors = [];
  if (!isId(entry.id)) errors.push('Escucha: identificador no válido.');
  if (!isId(entry.profileId)) errors.push('Escucha: perfil no válido.');
  if (!isSongId(entry.songId)) errors.push('Escucha: canción no válida.');
  if (!isTimestamp(entry.at)) errors.push('Escucha: fecha no válida.');
  if (!isIntegerIn(entry.listenedS, 0, LIMITS.listenedMaxS)) errors.push('Escucha: los segundos escuchados no son válidos.');
  if (!isBoolean(entry.completed)) errors.push('Escucha: el indicador de final debe ser sí o no.');
  return errors;
}

// Metadatos de una fotografía (sin el contenido binario).
export function validatePhotoMeta(photo) {
  if (!isPlainObject(photo)) return ['La fotografía no es válida.'];
  const errors = [];
  const add = (problem) => { if (problem) errors.push(problem); };
  if (!isId(photo.id)) errors.push('Fotografía: identificador no válido.');
  if (!isId(photo.profileId)) errors.push('Fotografía: perfil no válido.');
  if (!PHOTO_TYPES.includes(photo.mime)) errors.push('Fotografía: el formato debe ser JPEG, PNG o WebP.');
  add(textProblem(photo.caption, 'Fotografía: la descripción', { max: LIMITS.caption }));
  if (!isTimestamp(photo.createdAt)) errors.push('Fotografía: fecha no válida.');
  return errors;
}

function validatePhotoEntry(photo) {
  const errors = validatePhotoMeta(photo);
  if (errors.length === 0 && (typeof photo.data !== 'string' || photo.data.length > MAX_PHOTO_BASE64)) {
    errors.push('Fotografía: los datos no son válidos o superan el tamaño máximo.');
  }
  return errors;
}

const BACKUP_COLLECTIONS = [
  ['profiles', validateProfile],
  ['songLinks', validateSongLink],
  ['memories', validateMemory],
  ['photos', validatePhotoEntry],
  ['playlists', validatePlaylist],
  ['observations', validateObservation],
  ['history', validateHistoryEntry],
];

// Valida el contenido descifrado de una copia: formato de cada registro, duplicados,
// perfiles existentes para cada registro y fotografías referenciadas por los recuerdos.
export function validateBackup(payload) {
  if (!isPlainObject(payload)) return ['El contenido de la copia no es válido.'];
  const errors = [];
  if (payload.payloadVersion !== BACKUP_PAYLOAD_VERSION) {
    errors.push('La versión del contenido de la copia no es compatible.');
  }
  if (!isTimestamp(payload.exportedAt)) errors.push('La fecha de la copia no es válida.');
  const collections = {};
  for (const [name, validate] of BACKUP_COLLECTIONS) {
    const list = payload[name];
    if (!Array.isArray(list)) {
      errors.push(`Falta la lista de ${name} en la copia.`);
      continue;
    }
    collections[name] = list;
    list.forEach((record, index) => {
      const problems = validate(record);
      if (problems.length > 0 && errors.length < MAX_BACKUP_ERRORS) {
        errors.push(`${name}, registro ${index + 1}: ${problems[0]}`);
      }
    });
  }
  if (errors.length > 0) return errors.slice(0, MAX_BACKUP_ERRORS);

  const profileIds = new Set(collections.profiles.map((profile) => profile.id));
  const addDuplicates = (name, keys) => {
    if (new Set(keys).size !== keys.length) errors.push(`Hay registros duplicados en ${name}.`);
  };
  addDuplicates('profiles', collections.profiles.map((p) => p.id));
  addDuplicates('songLinks', collections.songLinks.map((l) => `${l.profileId}/${l.songId}`));
  for (const name of ['memories', 'photos', 'playlists', 'observations', 'history']) {
    addDuplicates(name, collections[name].map((record) => record.id));
  }
  for (const name of ['songLinks', 'memories', 'photos', 'playlists', 'observations', 'history']) {
    if (collections[name].some((record) => !profileIds.has(record.profileId))) {
      errors.push(`Hay registros de ${name} que pertenecen a un perfil que no está en la copia.`);
    }
  }
  const photoProfiles = new Map(collections.photos.map((photo) => [photo.id, photo.profileId]));
  for (const memory of collections.memories) {
    const linked = memory.photoIds.every((photoId) => photoProfiles.get(photoId) === memory.profileId);
    if (!linked) {
      errors.push('Hay recuerdos que referencian una fotografía que no está en la copia.');
      break;
    }
  }
  return errors.slice(0, MAX_BACKUP_ERRORS);
}
