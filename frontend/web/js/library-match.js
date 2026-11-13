// Regla común (web + APK) de «¿esta pista de Spotify ya está en mi biblioteca?» para el panel de «Transferir música»
// (ADR-0046). Datos y casos en tests/contrato/biblioteca-match.json; el espejo en la APK es mobile/lib/library_match.dart.
//
// Es MÁS TOLERANTE que la regla de duplicados (ADR-0026) a propósito: su objetivo es NO contar como «falta» una canción
// que ya tienes por diferencias menores de metadatos (un «Remastered» en el título, un «feat.» de más en el artista o unos
// segundos de duración). Parte del título ya normalizado de duplicados (sin ruido tipo «(Official Video)» ni «feat») y,
// encima, quita las etiquetas NEUTRAS (remaster, radio edit… = la misma grabación) pero CONSERVA las de versión (live,
// remix, acústico…), que sí son otra grabación. Coincide si la clave de título es igual y no vacía y, además: si ambos
// artistas se conocen, deben solaparse; si a alguno le falta, decide la duración (±tolerancia) o, sin ella, basta el título.

import { normalizeDuplicateTitle, normalizeDuplicateArtist } from './duplicates.js';

export const LIBRARY_MATCH_TOLERANCE_S = 8;

/** Etiquetas que NO cambian la grabación: se quitan de la clave de título para que «Clocks (Remastered)» = «Clocks». */
export const NEUTRAL_VERSION_TAGS = Object.freeze([
  'remaster',
  'remastered',
  'remasterizado',
  'remasterizada',
  'remastered version',
  'radio edit',
  'radio version',
  'single version',
  'album version',
  'original mix',
]);

const FEATURING = new Set(['ft', 'feat', 'featuring', 'con']);
const GROUP = /[([]([^()[\]]*)[)\]]/g;
const padded = (text) => ` ${text} `;

/** Quita los grupos entre paréntesis/corchetes que contienen una etiqueta neutra, con todo lo que lleven dentro (así
 *  «(Remastered 2011)» desaparece entero, año incluido). Las versiones (live, remix…) no son neutras y se conservan. */
function stripNeutralGroups(title) {
  return String(title ?? '').replace(GROUP, (whole, inner) => {
    const norm = normalizeDuplicateArtist(inner); // minúsculas, sin acentos ni signos
    return NEUTRAL_VERSION_TAGS.some((tag) => padded(norm).includes(padded(tag))) ? ' ' : whole;
  });
}

/** Clave de título para comparar presencia en biblioteca: quitar grupos neutros, normalizar como duplicados y, por último,
 *  quitar las etiquetas neutras sueltas (sin paréntesis, p. ej. «Tema - Radio Edit»). */
export function libraryTitleKey(title) {
  let key = normalizeDuplicateTitle(stripNeutralGroups(title));
  // Las frases más largas primero, para no dejar restos («radio edit» antes que «radio»).
  for (const tag of [...NEUTRAL_VERSION_TAGS].sort((a, b) => b.length - a.length)) {
    while (padded(key).includes(padded(tag))) key = padded(key).replaceAll(padded(tag), ' ').trim();
  }
  return key.replace(/\s+/g, ' ').trim();
}

const artistTokens = (artist) =>
  normalizeDuplicateArtist(artist).split(' ').filter((word) => word && !FEATURING.has(word));

/** Los artistas se solapan si todos los tokens de uno están en el otro (tolera «feat» y acentos). */
function artistsOverlap(a, b) {
  const ta = artistTokens(a);
  const tb = artistTokens(b);
  if (ta.length === 0 || tb.length === 0) return false;
  const subset = (x, y) => x.every((token) => y.includes(token));
  return subset(ta, tb) || subset(tb, ta);
}

const durationOf = (value) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null);

/**
 * ¿Esta pista ya está en la biblioteca? a y b: { title, artist, durationS }. Simétrica.
 * - clave de título igual y no vacía (obligatorio);
 * - si ambos artistas se conocen, deben solaparse (un «radio edit» del mismo artista cuenta aunque dure menos; dos
 *   canciones distintas del mismo título de artistas distintos, no);
 * - si a alguno le falta el artista, decide la duración (±tolerancia) y, sin duración, basta el título.
 */
export function isSameLibraryTrack(a, b) {
  const keyA = libraryTitleKey(a?.title);
  const keyB = libraryTitleKey(b?.title);
  if (keyA === '' || keyA !== keyB) return false;
  const tokensA = artistTokens(a?.artist);
  const tokensB = artistTokens(b?.artist);
  if (tokensA.length > 0 && tokensB.length > 0) return artistsOverlap(a?.artist, b?.artist);
  const da = durationOf(a?.durationS);
  const db = durationOf(b?.durationS);
  if (da !== null && db !== null) return Math.abs(da - db) <= LIBRARY_MATCH_TOLERANCE_S;
  return true;
}
