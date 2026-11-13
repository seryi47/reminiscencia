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
const YEAR = '(?:19|20)\\d\\d';
const escapeRe = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Clave de título para comparar presencia en biblioteca: la normalización de duplicados (minúsculas, sin acentos, sin ruido
 * tipo «(Official Video)» ni «feat») y, encima, quitar las etiquetas NEUTRAS (remaster, radio edit…) con un año pegado si lo
 * llevan («Remastered 2011»), PERO conservando las de versión (live, remix…), que distinguen la grabación. Se quita solo la
 * etiqueta neutra, no el grupo entero, para no tirar un «Live» que vaya junto a un «Remastered» (p. ej. «Live Remastered»).
 */
export function libraryTitleKey(title) {
  let key = normalizeDuplicateTitle(title);
  for (const tag of [...NEUTRAL_VERSION_TAGS].sort((a, b) => b.length - a.length)) {
    // La etiqueta como palabra(s) completas, con un año opcional pegado delante o detrás («2011 Remaster», «Remaster 2011»).
    const re = new RegExp(`(?:^|\\s)(?:${YEAR}\\s+)?${escapeRe(tag)}(?:\\s+${YEAR})?(?=\\s|$)`, 'g');
    key = key.replace(re, ' ');
  }
  return key.replace(/\s+/g, ' ').trim();
}

const artistTokens = (artist) =>
  normalizeDuplicateArtist(artist).split(' ').filter((word) => word && !FEATURING.has(word));

const isSubset = (x, y) => x.every((token) => y.includes(token));
const sameArtistSet = (x, y) => x.length === y.length && isSubset(x, y) && isSubset(y, x);
const durationOf = (value) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null);

/**
 * ¿Esta pista ya está en la biblioteca? a y b: { title, artist, durationS }. Simétrica.
 * - clave de título igual y no vacía (obligatorio);
 * - si ambos artistas se conocen:
 *   · el MISMO artista (mismos tokens) → es la misma grabación aunque la duración difiera (p. ej. un «radio edit»);
 *   · artistas que SOLO se solapan (uno es «feat» del otro) → solo cuenta si la duración cuadra (±tolerancia), para no
 *     confundir dos canciones distintas del mismo título donde el artista suelto es un colaborador de la otra;
 *   · artistas claramente distintos → no es la misma;
 * - si a alguno le falta el artista, decide la duración (±tolerancia) y, sin duración, basta el título.
 */
export function isSameLibraryTrack(a, b) {
  const keyA = libraryTitleKey(a?.title);
  const keyB = libraryTitleKey(b?.title);
  if (keyA === '' || keyA !== keyB) return false;
  const ta = artistTokens(a?.artist);
  const tb = artistTokens(b?.artist);
  const da = durationOf(a?.durationS);
  const db = durationOf(b?.durationS);
  const durationOk = da !== null && db !== null ? Math.abs(da - db) <= LIBRARY_MATCH_TOLERANCE_S : null;
  if (ta.length > 0 && tb.length > 0) {
    if (sameArtistSet(ta, tb)) return true;
    if (!(isSubset(ta, tb) || isSubset(tb, ta))) return false;
    return durationOk ?? true; // solape parcial: sin las dos duraciones, se confía en el solape
  }
  return durationOk ?? true;
}
