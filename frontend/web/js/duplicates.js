// Regla común de «posible duplicado» (ADR-0026), igual que el backend (backend/sonidos/duplicados.py) y la APK
// (mobile/lib/duplicates.dart). Los datos (pliegue de letras, etiquetas entre paréntesis o corchetes y marcas de
// featuring) y los casos de prueba están en tests/contrato/duplicados.json, que comprueba
// tests/web-unit/duplicados.test.mjs. Sin DOM: lo usa la hoja «Subir canciones» antes de poner archivos en la cola.
//
// Dos canciones son un posible duplicado si su título normalizado es igual y no está vacío y, además: si las dos tienen
// duración (un número mayor que 0), se diferencian como mucho en DUPLICATE_TOLERANCE_S segundos; si a alguna le falta,
// su artista normalizado es igual. Solo avisa: nunca impide subir.

import { formatDuration } from './catalog.js';

export const DUPLICATE_TOLERANCE_S = 2;
export const FOLD_FROM = 'áàäâãåāéèëêēíìïîīóòöôõøōúùüûūñçýÿ';
export const FOLD_TO = 'aaaaaaaeeeeeiiiiiooooooouuuuuncyy';
/** Contenido de un paréntesis o corchete que se quita del título («(Official Video)», «[HD]», «(Letra)»…). */
export const DUPLICATE_TAGS = Object.freeze([
  'official video',
  'official music video',
  'official audio',
  'official lyric video',
  'official visualizer',
  'lyric video',
  'lyrics video',
  'video lyric',
  'video lyrics',
  'video oficial',
  'videoclip oficial',
  'videoclip',
  'video',
  'audio oficial',
  'audio',
  'letra',
  'con letra',
  'lyrics',
  'lyric',
  'visualizer',
  'hd',
  'hq',
  '4k',
]);
export const FEATURING_MARKS = Object.freeze(['ft', 'feat', 'featuring']);

const TAGS = new Set(DUPLICATE_TAGS);
const FEATURING = new Set(FEATURING_MARKS);
const COMBINING = /[̀-ͯ]/g;
const SIGNS = /[^\p{L}\p{N}]+/gu;
const GROUP = /[([]([^()[\]]*)[)\]]/g;
const FOLD = new Map([...FOLD_FROM].map((char, index) => [char, FOLD_TO[index]]));

function fold(text) {
  const lower = (typeof text === 'string' ? text : '').toLowerCase().replace(COMBINING, '');
  let out = '';
  for (const char of lower) out += FOLD.get(char) ?? char;
  return out;
}

const words = (text) => text.replace(SIGNS, ' ').split(' ').filter(Boolean);

/** Título comparable: sin mayúsculas, acentos, signos, etiquetas como «(Official Video)» ni featuring. */
export function normalizeDuplicateTitle(title) {
  const grouped = fold(title).replace(GROUP, (_, inner) => {
    const parts = words(inner);
    return parts.length > 0 && (TAGS.has(parts.join(' ')) || FEATURING.has(parts[0])) ? ' ' : ` ${inner} `;
  });
  const parts = words(grouped);
  const cut = parts.findIndex((word, index) => index > 0 && FEATURING.has(word));
  return (cut === -1 ? parts : parts.slice(0, cut)).join(' ');
}

/** Artista comparable: sin mayúsculas, acentos ni signos, con espacios simples. */
export function normalizeDuplicateArtist(artist) {
  return words(fold(artist)).join(' ');
}

const durationOf = (value) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null);

/** ¿Parecen la misma canción? a y b: { title, artist, durationS } (durationS puede faltar o ser null). */
export function isPossibleDuplicate(a, b) {
  const title = normalizeDuplicateTitle(a?.title);
  if (title === '' || title !== normalizeDuplicateTitle(b?.title)) return false;
  const da = durationOf(a?.durationS);
  const db = durationOf(b?.durationS);
  if (da !== null && db !== null) return Math.abs(da - db) <= DUPLICATE_TOLERANCE_S;
  return normalizeDuplicateArtist(a?.artist) === normalizeDuplicateArtist(b?.artist);
}

/**
 * Para cada archivo de [batch] ({ title, artist, durationS }), su primer parecido: antes una canción de [library]; si
 * no, un archivo anterior de la misma tanda. Devuelve [{ index, match, inBatch }] solo de los que se parecen a algo.
 */
export function findUploadDuplicates(batch, library) {
  const found = [];
  batch.forEach((candidate, index) => {
    const inLibrary = library.find((song) => isPossibleDuplicate(candidate, song));
    if (inLibrary) {
      found.push({ index, match: inLibrary, inBatch: false });
      return;
    }
    const earlier = batch.slice(0, index).find((other) => isPossibleDuplicate(candidate, other));
    if (earlier) found.push({ index, match: earlier, inBatch: true });
  });
  return found;
}

/** «Parece que ya está en la biblioteca: «X» (3:21). ¿Subirla igualmente?» (sin la duración si no se conoce). */
export function duplicateMessage({ match, inBatch }) {
  const duration = durationOf(match?.durationS);
  const when = duration === null ? '' : ` (${formatDuration(duration)})`;
  const where = inBatch ? 'Parece repetida en esta subida' : 'Parece que ya está en la biblioteca';
  return `${where}: «${match?.title ?? ''}»${when}. ¿Subirla igualmente?`;
}
