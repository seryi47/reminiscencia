// Motor de identificación de «Transferir música» (ADR-0044): dada una pista de Spotify y una lista de candidatos de
// YouTube, puntúa cada candidato y decide el nivel de confianza (alta = aceptar solo, media = elegir entre alternativas,
// baja = revisión manual). Es PURO (sin red ni estado): la búsqueda de candidatos y la descarga viven en otros módulos.
// Vive en el servidor para que web y APK compartan una sola implementación (paridad real; ADR-0044).
//
// Spotify cerró las señales acústicas en 2024 (ADR-0044), así que la identificación es por METADATOS. La señal más
// fiable es la DURACIÓN exacta que da Spotify (en ms); después, título y artista normalizados (se reutiliza la misma
// normalización que la búsqueda y los duplicados, catalog.js y duplicados), la consistencia de versión (estudio vs
// directo/acústico/remix/instrumental/karaoke/cover/…) y la preferencia por fuentes oficiales (canales «Topic»/«Art
// Track» de YouTube Music, VEVO). El ISRC, si algún día llega en un candidato, es decisivo.

import { normalizeText, wordPoints } from '../js/catalog.js';

// --- Etiquetas de versión --------------------------------------------------------------------------------------------
// Categorías cuyo valor CAMBIA qué grabación es: si la pista de Spotify es de estudio y el candidato trae una de estas,
// es otra versión (penaliza fuerte). Cada frase se busca como subcadena entre límites de palabra en el título normalizado.
export const VERSION_TAGS = Object.freeze({
  live: ['live', 'en vivo', 'en directo', 'directo', 'en concierto', 'concert', 'unplugged', 'session', 'sesion'],
  acoustic: ['acoustic', 'acustico', 'acustica'],
  remix: ['remix', 'rmx', 'vip mix', 'bootleg', 'flip', 'mashup', 'club mix', 'dub'],
  instrumental: ['instrumental', 'karaoke', 'backing track', 'minus one'],
  cover: ['cover', 'tribute', 'tributo', 'as made famous by', 'in the style of', 'originally performed', 'made famous'],
  altered: ['sped up', 'speed up', 'spedup', 'slowed', 'slowed down', 'nightcore', 'reverb', '8d', '8d audio', 'daycore'],
  demo: ['demo'],
  extended: ['extended', 'extended mix', 'extended version'],
});

// Categorías que NO cambian la grabación (misma pista): no cuentan como desajuste de versión.
export const LENIENT_TAGS = Object.freeze({
  remaster: ['remaster', 'remastered', 'remasterizado', 'remasterizada', 'remastered version'],
  radioedit: ['radio edit', 'radio version', 'single version', 'album version', 'original mix'],
});

// Ruido que no es una versión: se ignora al comparar títulos y nunca es un desajuste («Official Video», «HD», «Audio»…).
export const NOISE_TAGS = Object.freeze([
  'official video', 'official music video', 'official audio', 'official lyric video', 'official visualizer',
  'lyric video', 'lyrics video', 'video lyric', 'video lyrics', 'video oficial', 'videoclip oficial', 'videoclip',
  'video', 'audio oficial', 'audio', 'letra', 'con letra', 'lyrics', 'lyric', 'visualizer', 'hd', 'hq', '4k',
  'official', 'mv', 'm/v', 'color coded',
]);

const FEATURING = ['ft', 'feat', 'featuring', 'con'];

// Pesos y umbrales (se fijan con el set de pruebas «dorado» de tests/web-unit/spotify-match.test.mjs).
export const WEIGHTS = Object.freeze({
  title: 45, // 0..45 según cobertura del título
  durationNear: 40, // ±2 s
  durationClose: 25, // ±5 s
  durationLoose: 5, // ±10 s
  durationFar: -40, // >10 s: casi seguro otra versión
  artistMatch: 30,
  artistMismatch: -30,
  versionExtra: -45, // el candidato añade una versión que Spotify no tiene (directo, cover, remix…)
  versionMissing: -20, // el candidato no tiene la versión que Spotify sí pide
  versionRight: 25, // Spotify pide una versión y el candidato la tiene, sin extras
  sourceTopic: 20, // YouTube Music «Topic»/«Art Track»: subida oficial de sello
  sourceOfficial: 12, // VEVO o canal del artista
  isrcExact: 1000, // decisivo
});

export const THRESHOLDS = Object.freeze({
  titleFloor: 0.5, // por debajo de esta cobertura de título, no es la misma canción
  mediumFloor: 45, // por debajo, confianza baja (revisión manual)
  autoScore: 90, // mínimo para confianza alta
  autoGap: 15, // ventaja sobre el segundo para aceptar solo
  autoGapOfficial: 6, // ventaja menor basta si la fuente es oficial
  durationNearS: 2,
  durationCloseS: 5,
  durationLooseS: 10,
});

const SOURCE_BONUS = { topic: WEIGHTS.sourceTopic, official: WEIGHTS.sourceOfficial, search: 0 };

const normArtist = (value) => normalizeText(value);
const padded = (value) => ` ${value} `;

function hasPhrase(normTitle, phrase) {
  return padded(normTitle).includes(padded(phrase));
}

/** Conjunto de categorías de versión presentes en un título (ya sea de Spotify o de un candidato). */
export function detectVersions(rawTitle) {
  const norm = normalizeText(rawTitle);
  const found = new Set();
  for (const [category, phrases] of Object.entries(VERSION_TAGS)) {
    if (phrases.some((phrase) => hasPhrase(norm, phrase))) found.add(category);
  }
  return found;
}

function isLenient(rawTitle) {
  const norm = normalizeText(rawTitle);
  return Object.values(LENIENT_TAGS).some((phrases) => phrases.some((phrase) => hasPhrase(norm, phrase)));
}

/** Tokens del «núcleo» del título: normalizado, sin ruido ni etiquetas de versión ni la cola de «feat…». */
export function coreTitleTokens(rawTitle) {
  let norm = normalizeText(rawTitle);
  const strip = [...NOISE_TAGS, ...Object.values(VERSION_TAGS).flat(), ...Object.values(LENIENT_TAGS).flat()];
  // Quita las frases más largas primero para no dejar restos.
  for (const phrase of strip.sort((a, b) => b.length - a.length)) {
    while (hasPhrase(norm, phrase)) norm = padded(norm).replaceAll(padded(phrase), ' ').trim();
  }
  const words = norm.split(' ').filter(Boolean);
  const cut = words.findIndex((word, index) => index > 0 && FEATURING.includes(word));
  return (cut >= 0 ? words.slice(0, cut) : words).filter(Boolean);
}

function tokenCoverage(tokens, words) {
  if (tokens.length === 0) return 0;
  let hit = 0;
  for (const token of tokens) if (words.some((word) => wordPoints(token, word) > 0)) hit += 1;
  return hit / tokens.length;
}

const mainArtist = (track) => (Array.isArray(track.artists) ? track.artists[0] : track.artist) ?? '';
const durationS = (track) => {
  if (typeof track.durationS === 'number') return track.durationS;
  if (typeof track.durationMs === 'number') return track.durationMs / 1000;
  return null;
};

/**
 * Puntúa un candidato de YouTube frente a una pista de Spotify. Devuelve { score, reasons:[...], signals:{...} }.
 * - track: { title, artists:[principal, ...], album?, durationMs|durationS, year?, isrc? }
 * - candidate: { id, url, title, artist?, durationS?, source?: 'topic'|'official'|'search', isrc? }
 */
export function scoreCandidate(track, candidate) {
  const reasons = [];
  const candTitleNorm = normalizeText(candidate.title);
  const candWords = candTitleNorm.split(' ').filter(Boolean);
  const coverage = tokenCoverage(coreTitleTokens(track.title), candWords.length ? candWords : [candTitleNorm]);
  // Un ISRC igual identifica la MISMA grabación aunque el título difiera, así que salta la criba de título.
  const isrcExact = Boolean(track.isrc) && Boolean(candidate.isrc)
    && String(track.isrc).toUpperCase() === String(candidate.isrc).toUpperCase();
  if (coverage < THRESHOLDS.titleFloor && !isrcExact) {
    return { score: -1000, coverage, reasons: ['titulo-no-coincide'], signals: { coverage, isrcExact: false } };
  }
  let score = Math.round(WEIGHTS.title * coverage);
  reasons.push(`titulo:${coverage.toFixed(2)}`);

  // Duración (la señal más fiable).
  const spDur = durationS(track);
  const candDur = typeof candidate.durationS === 'number' ? candidate.durationS : null;
  let durDiff = null;
  if (spDur != null && candDur != null) {
    durDiff = Math.abs(spDur - candDur);
    if (durDiff <= THRESHOLDS.durationNearS) { score += WEIGHTS.durationNear; reasons.push('duracion:±2s'); }
    else if (durDiff <= THRESHOLDS.durationCloseS) { score += WEIGHTS.durationClose; reasons.push('duracion:±5s'); }
    else if (durDiff <= THRESHOLDS.durationLooseS) { score += WEIGHTS.durationLoose; reasons.push('duracion:±10s'); }
    else { score += WEIGHTS.durationFar; reasons.push('duracion:lejana'); }
  }

  // Consistencia de versión (se calcula antes del artista: un cover nombra al artista original en el título sin serlo).
  const spVersions = detectVersions(track.title);
  const candVersions = detectVersions(candidate.title);

  // Artista: se exigen todos los tokens del artista principal. En el canal del candidato siempre vale; en el TÍTULO solo
  // si el candidato no es un cover/tributo («Yesterday (Tribute to The Beatles)» nombra a The Beatles pero no lo es).
  const spArtistTokens = normArtist(mainArtist(track)).split(' ').filter(Boolean);
  const channelWords = normArtist(candidate.artist).split(' ').filter(Boolean);
  const everyTokenIn = (words) => spArtistTokens.every((token) => words.some((word) => wordPoints(token, word) > 0));
  let artistMatch = null;
  if (spArtistTokens.length > 0) {
    const inChannel = everyTokenIn(channelWords);
    const inTitle = !candVersions.has('cover') && everyTokenIn(candWords);
    artistMatch = inChannel || inTitle;
    score += artistMatch ? WEIGHTS.artistMatch : WEIGHTS.artistMismatch;
    reasons.push(artistMatch ? 'artista:ok' : 'artista:distinto');
  }

  // (Penalizaciones de versión.)
  const extra = [...candVersions].filter((category) => !spVersions.has(category));
  const missing = [...spVersions].filter((category) => !candVersions.has(category));
  // `extra` solo contiene categorías reales de VERSION_TAGS (detectVersions no mira las LENIENT), así que un candidato
  // «remaster»/«radio edit» nunca cuenta como versión distinta.
  if (extra.length > 0) {
    score += WEIGHTS.versionExtra; reasons.push(`version-extra:${extra.join(',')}`);
  } else if (isLenient(candidate.title) && !isLenient(track.title) && spVersions.size === 0) {
    reasons.push('version:remaster-ok'); // misma grabación: sin penalización
  }
  if (missing.length > 0) { score += WEIGHTS.versionMissing; reasons.push(`version-falta:${missing.join(',')}`); }
  if (spVersions.size > 0 && extra.length === 0 && missing.length === 0) {
    score += WEIGHTS.versionRight; reasons.push('version:correcta');
  }

  // Fuente.
  const source = candidate.source ?? 'search';
  if (SOURCE_BONUS[source]) { score += SOURCE_BONUS[source]; reasons.push(`fuente:${source}`); }

  // ISRC (decisivo si ambos lo traen e igual; calculado arriba para poder saltar la criba de título).
  if (isrcExact) { score += WEIGHTS.isrcExact; reasons.push('isrc:exacto'); }

  return {
    score,
    reasons,
    signals: { coverage, durDiff, artistMatch, extra, missing, source, isrcExact, spVersions: [...spVersions] },
  };
}

/** Ordena los candidatos de más a menos puntos (a igualdad, conserva el orden de entrada). */
export function rankCandidates(track, candidates) {
  return candidates
    .map((candidate, index) => ({ candidate, index, ...scoreCandidate(track, candidate) }))
    .sort((a, b) => b.score - a.score || a.index - b.index);
}

/**
 * Decide la coincidencia de una pista: { tier: 'alta'|'media'|'baja', best, alternatives, ranked }.
 * - alta: se puede aceptar sola (puntúa alto, duración ±2 s conocida, versión consistente y ventaja clara / fuente oficial).
 * - media: hay candidatos razonables pero ambiguos → el usuario elige entre `alternatives`.
 * - baja: nada supera el mínimo → búsqueda manual (best = null).
 */
export function classifyMatch(track, candidates, { maxAlternatives = 5 } = {}) {
  const ranked = rankCandidates(track, candidates);
  const best = ranked[0];
  if (!best || best.score < THRESHOLDS.mediumFloor) {
    return { tier: 'baja', best: null, alternatives: ranked.slice(0, maxAlternatives), ranked };
  }
  const second = ranked[1];
  const gap = second ? best.score - second.score : Infinity;
  const official = best.signals.source === 'topic' || best.signals.source === 'official';
  const durationOk = best.signals.durDiff != null && best.signals.durDiff <= THRESHOLDS.durationNearS;
  const versionOk = best.signals.extra.length === 0 && best.signals.missing.length === 0;
  const clear = best.signals.isrcExact
    || (best.score >= THRESHOLDS.autoScore && durationOk && versionOk
        && (gap >= THRESHOLDS.autoGap || (official && gap >= THRESHOLDS.autoGapOfficial)));
  if (clear) {
    return { tier: 'alta', best, alternatives: ranked.slice(1, maxAlternatives), ranked };
  }
  return { tier: 'media', best, alternatives: ranked.slice(0, maxAlternatives), ranked };
}
