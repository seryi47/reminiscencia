// Lógica pura del modo sin conexión: nombres de caché, rutas del shell y de audio,
// planificación de descargas, rangos de audio y formato de tamaños.
// No usa DOM ni APIs del navegador, así que se prueba directamente en node
// (tests/web-unit/offline-core.test.mjs).

/** Versión del shell (HTML, CSS, JS, fuentes, datos e iconos). Súbela cuando cambie el shell
 *  de forma que las copias guardadas dejen de servir: el service worker crea una
 *  caché nueva y borra las versiones anteriores al activarse. */
export const SHELL_VERSION = 2;

/** Prefijo de las cachés del shell; sirve para reconocer las antiguas al limpiar. */
export const SHELL_CACHE_PREFIX = 'reminiscencia-shell-';

const AUDIO_CACHE = 'reminiscencia-audio-v1';

// Base para resolver rutas relativas. Solo se usa el pathname.
const BASE = 'http://localhost/';

// Canciones: el id va en el nombre del fichero, así que solo se admiten caracteres seguros.
const SAFE_ID = /^[A-Za-z0-9_-]+$/;

const SHELL_PATHS = new Set(['/', '/index.html', '/manifest.webmanifest']);
const SHELL_PATTERNS = [
  /^\/js\/(?:[^/]+\/)*[^/]+\.js$/, // módulos, también los de js/paciente/ y js/cuidador/
  /^\/css\/[^/]+\.css$/,
  /^\/fonts\/[^/]+\.woff2$/,
  /^\/data\/[^/]+\.json$/,
  /^\/icons\/[^/]+\.png$/,
];
const DATA_PATTERN = /^\/data\/[^/]+\.json$/;
const AUDIO_PATTERN = /^\/audio\/[^/]+\.opus$/;

/** Rutas desde la raíz del sitio que el service worker precarga al instalarse. Las que
 *  no existen (por ejemplo, ficheros de otras ramas) se omiten sin error. Al añadir una hoja,
 *  una fuente, un módulo, un dato o un icono, añádelo aquí: la prueba de cobertura de
 *  tests/web-unit/offline-core.test.mjs falla si falta alguno. */
export const SHELL_ASSETS = Object.freeze([
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/css/tokens.css',
  '/css/base.css',
  '/css/paciente-shell.css',
  '/css/paciente-escuchar.css',
  '/css/paciente-listas.css',
  '/css/cuidador-shell.css',
  '/css/cuidador-biblioteca.css',
  '/css/cuidador-perfiles.css',
  '/css/cuidador-contenido.css',
  '/fonts/atkinson-next-400.woff2',
  '/fonts/atkinson-next-600.woff2',
  '/fonts/atkinson-next-700.woff2',
  '/js/app.js',
  '/js/offline-core.js',
  '/js/pwa.js',
  '/js/backup.js',
  '/js/crypto.js',
  '/js/player.js',
  '/js/prefs.js',
  '/js/schema.js',
  '/js/store.js',
  '/js/intake.js',
  '/data/catalog.json',
  '/js/paciente/buscar.js',
  '/js/paciente/carpetas.js',
  '/js/paciente/escuchar.js',
  '/js/paciente/listas.js',
  '/js/paciente/salida.js',
  '/js/paciente/shell.js',
  '/js/cuidador/ajustes.js',
  '/js/cuidador/asistente.js',
  '/js/cuidador/biblioteca.js',
  '/js/cuidador/incidencias.js',
  '/js/cuidador/inicio.js',
  '/js/cuidador/lista-editor.js',
  '/js/cuidador/listas-perfil.js',
  '/js/cuidador/observacion-hoja.js',
  '/js/cuidador/observaciones.js',
  '/js/cuidador/opciones-paciente.js',
  '/js/cuidador/panel.js',
  '/js/cuidador/perfil.js',
  '/js/cuidador/perfiles.js',
  '/js/cuidador/recuerdo-editor.js',
  '/js/cuidador/recuerdos.js',
  '/js/cuidador/sesion.js',
  '/js/cuidador/shell.js',
  '/data/songs.json',
  '/data/folders.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
]);

/** Nombre de la caché del shell para una versión: 'reminiscencia-shell-v<N>'. */
export function shellCacheName(version = SHELL_VERSION) {
  if (!Number.isInteger(version) || version < 1) {
    throw new RangeError(`Versión de shell no válida: ${version}`);
  }
  return `${SHELL_CACHE_PREFIX}v${version}`;
}

/** Nombre de la caché de audio guardado para escuchar sin conexión. */
export function audioCacheName() {
  return AUDIO_CACHE;
}

/** Ruta (sin origen ni query) de una URL o ruta, o null si no se puede interpretar. */
function pathOf(url) {
  try {
    return new URL(String(url), BASE).pathname;
  } catch {
    return null;
  }
}

/** ¿Es una petición del shell (páginas, CSS, fuentes, JS, datos o iconos)? Mira solo la ruta:
 *  el service worker filtra antes el origen. */
export function isShellRequest(url) {
  const path = pathOf(url);
  if (path === null) return false;
  return SHELL_PATHS.has(path) || SHELL_PATTERNS.some((pattern) => pattern.test(path));
}

/** ¿Es un fichero de datos (data/*.json)? Se pide primero a la red y, si falla, a la caché. */
export function isDataRequest(url) {
  const path = pathOf(url);
  return path !== null && DATA_PATTERN.test(path);
}

/** ¿Es un audio de la biblioteca (/audio/<id>.opus)? */
export function isAudioRequest(url) {
  const path = pathOf(url);
  return path !== null && AUDIO_PATTERN.test(path);
}

/** Rutas relativas 'audio/<id>.opus' de las canciones, sin repetir. Ignora entradas
 *  sin id válido. */
export function listAudioUrls(songs) {
  if (!Array.isArray(songs)) return [];
  const paths = new Set();
  for (const song of songs) {
    const id = song && typeof song === 'object' ? song.id : undefined;
    if (typeof id === 'string' && SAFE_ID.test(id)) {
      paths.add(`audio/${id}.opus`);
    }
  }
  return [...paths];
}

/** Separa las rutas de audio pendientes de descargar de las que ya están en caché.
 *  cachedUrls puede mezclar rutas relativas y URL absolutas. */
export function planOfflineDownload(songs, cachedUrls = []) {
  const cached = new Set();
  for (const url of cachedUrls ?? []) {
    const path = pathOf(url);
    if (path !== null) cached.add(path.replace(/^\//, ''));
  }
  const toDownload = [];
  const alreadyCached = [];
  for (const relative of listAudioUrls(songs)) {
    if (cached.has(relative)) alreadyCached.push(relative);
    else toDownload.push(relative);
  }
  return { toDownload, alreadyCached };
}

/** Interpreta una cabecera Range de un único tramo ('bytes=a-b', 'bytes=a-', 'bytes=-n').
 *  Devuelve null si no hay que atender un rango (cabecera ausente, mal formada, con varios
 *  tramos o invertida), 'unsatisfiable' si el rango queda fuera del fichero, o
 *  {start, end} con end inclusivo ya acotado a size - 1. */
export function parseRange(header, size) {
  if (typeof header !== 'string' || !header.startsWith('bytes=')) return null;
  const spec = header.slice('bytes='.length).trim();
  if (spec.includes(',')) return null;
  const match = /^(\d*)-(\d*)$/.exec(spec);
  if (!match || (match[1] === '' && match[2] === '')) return null;
  if (!(size > 0)) return 'unsatisfiable';

  const [, first, last] = match;
  if (first === '') {
    // Sufijo: los últimos n bytes del fichero.
    const suffix = Number(last);
    if (suffix === 0) return 'unsatisfiable';
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(first);
  const end = last === '' ? Infinity : Number(last);
  if (end < start) return null; // rango invertido: la cabecera se ignora
  if (start >= size) return 'unsatisfiable';
  return { start, end: Math.min(end, size - 1) };
}

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

/** Tamaño legible en español: '512 B', '1,5 KB', '12 MB'. Devuelve '—' si el valor
 *  no es un número finito no negativo. */
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  let text = formatNumber(value, unit);
  // Al redondear puede llegar a 1024 (por ejemplo 1023,9 KB): pasa a la unidad siguiente.
  if (Number(text.replace(',', '.')) >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
    text = formatNumber(value, unit);
  }
  return `${text} ${UNITS[unit]}`;
}

function formatNumber(value, unit) {
  const rounded = unit === 0 || value >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
  return String(rounded).replace('.', ',');
}
