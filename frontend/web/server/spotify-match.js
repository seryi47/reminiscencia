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
  // Recopilaciones y mixes: nunca son «la canción». Un candidato con cualquiera de estas pasa la exclusión dura
  // incluso si el título «contiene» el de la canción buscada (ADR-0044 ampliado tras auditoría 2026-11-24).
  compilation: ['compilation', 'compilacion', 'megamix', 'full album', 'album completo', 'greatest hits', 'best of'],
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
  durationNear: 40, // ±3 s (la misma grabación; Spotify y YouTube suelen diferir unos segundos por intros/silencios)
  durationClose: 30, // ±8 s (sigue siendo la misma canción)
  durationLoose: 10, // ±15 s
  durationFar: -40, // >15 s: casi seguro otra versión (directo, extendida…)
  artistMatch: 30,
  artistMismatch: -30,
  versionExtra: -45, // el candidato añade una versión que Spotify no tiene (directo, cover, remix…)
  versionMissing: -20, // el candidato no tiene la versión que Spotify sí pide
  versionRight: 25, // Spotify pide una versión y el candidato la tiene, sin extras
  sourceTopic: 20, // YouTube Music «Topic»/«Art Track»: subida oficial de sello
  sourceOfficial: 12, // VEVO o canal del artista
  isrcExact: 1000, // decisivo
  // Señales de estudio en el título del candidato (empujan a la grabación oficial, ADR-0044 ampliado 2026-11-23).
  officialAudio: 25, // «Official Audio» / «Audio Oficial»
  officialVideo: 20, // «Official Music Video» / «Video Oficial» / «Videoclip Oficial»
  lyricsVideo: 12, // «Lyrics» / «Letra» / «Lyric Video»
  // EXCLUSIÓN DURA (ADR-0044 ampliado 2026-11-23): si la pista de Spotify NO es directo/remix/cover/instrumental/etc.,
  // un candidato que SÍ lo sea recibe un gran negativo que lo saca del tier «alta»/«media» pero lo deja visible en el
  // selector de alternativas, por si el usuario quiere elegirlo manualmente.
  hardExcluded: -500,
  // Duración incompatible (fragmento muy corto o compilación muy larga): también excluyente.
  durationUnusable: -500,
});

export const THRESHOLDS = Object.freeze({
  titleFloor: 0.5, // por debajo de esta cobertura de título, no es la misma canción
  mediumFloor: 45, // por debajo, confianza baja (revisión manual)
  autoScore: 90, // mínimo para confianza alta
  autoDurationS: 8, // para aceptar sola, la duración debe cuadrar dentro de ±8 s (misma grabación)
  durationNearS: 3,
  durationCloseS: 8,
  durationLooseS: 15,
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

// Categorías de versión que —si el track de Spotify NO las pide— son EXCLUYENTES, no solo una penalización.
// 'extended' y 'demo' también entran: cambian la grabación de forma relevante.
const HARD_EXCLUDE_CATEGORIES = Object.freeze(['live', 'acoustic', 'remix', 'instrumental', 'cover', 'altered', 'extended', 'demo', 'compilation']);

/**
 * ¿El candidato debería ser excluido porque añade una categoría de versión (live, remix, cover, karaoke…) que la
 * pista original de Spotify NO pide? Si Spotify también lo pide (p. ej. un track llamado «Song (Live at X)»), el
 * candidato live NO queda excluido — se busca la MISMA versión. Devuelve la categoría culpable, o null.
 */
export function hardExcludedReason(track, candidate) {
  const sp = detectVersions(track.title);
  const cand = detectVersions(candidate.title);
  for (const category of HARD_EXCLUDE_CATEGORIES) {
    if (cand.has(category) && !sp.has(category)) return category;
  }
  return null;
}

// Señales de «es la grabación de estudio» en el título del candidato: Official Audio, Official Music Video, Lyrics…
// Suman puntos para que una subida oficial o un lyric video que reproduce la grabación de estudio GANE siempre al mero
// candidato con el nombre coincidente.
const OFFICIAL_SIGNAL_PATTERNS = Object.freeze({
  // Solo frases explícitas de que es la toma de estudio: «Official Audio», «Audio Oficial». Sin `/\baudio\b/` suelto
  // porque haría pasar cualquier vídeo con la palabra «audio» en el título.
  officialAudio: [/\bofficial audio\b/, /\baudio oficial\b/],
  // Idem con el videoclip oficial: SIEMPRE con «official»/«oficial» (sin `/\bmusic video\b/` suelto, que colaba con
  // «New Music Video Trailer», «Fan Music Video» etc.).
  officialVideo: [/\bofficial music video\b/, /\bofficial video\b/, /\bvideo oficial\b/, /\bvideoclip oficial\b/],
  // Lyrics o letra: EXIGIR «video»/«visualizer»/«con letra» para no coger a cualquier vídeo que mencione «lyrics» o
  // «letra» en el título (p. ej. «Rolling in the Deep - Adele Lyrics Compilation», que era compilación con score alta).
  lyricsVideo: [/\blyric video\b/, /\blyrics video\b/, /\bofficial lyric video\b/, /\bvideo lyric\b/, /\blyric visualizer\b/, /\bcon letra\b/],
});

/** Devuelve { officialAudio, officialVideo, lyricsVideo } booleanos según lo que diga el título. */
export function detectOfficialSignals(rawTitle) {
  const norm = normalizeText(rawTitle);
  const out = { officialAudio: false, officialVideo: false, lyricsVideo: false };
  for (const [key, patterns] of Object.entries(OFFICIAL_SIGNAL_PATTERNS)) {
    out[key] = patterns.some((re) => re.test(norm));
  }
  return out;
}

/**
 * ¿La duración del candidato es inservible para esta pista? Fragmentos (<60 s cuando Spotify es >100 s) o compilaciones
 * excesivamente largas (>2,5× la de Spotify, cuando Spotify es >100 s). Esto no es «otra versión»: es «no es la canción».
 */
export function isDurationUnusable(spDurS, candDurS) {
  if (typeof spDurS !== 'number' || typeof candDurS !== 'number') return false;
  // Fragmento (preview / avance): candidato muy corto, solo si Spotify es «canción normal» (≥100 s).
  if (candDurS < 60 && spDurS >= 100) return true;
  // Compilación / álbum completo / mix largo: candidato más de 2,5× la duración de Spotify. SIEMPRE aplica
  // (una intro de 90 s de Spotify no debe aceptar un «full album» de 10 min como «la misma pista»).
  if (candDurS > Math.max(spDurS * 2.5, 300)) return true;
  return false;
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
    if (durDiff <= THRESHOLDS.durationNearS) { score += WEIGHTS.durationNear; reasons.push('duracion:±3s'); }
    else if (durDiff <= THRESHOLDS.durationCloseS) { score += WEIGHTS.durationClose; reasons.push('duracion:±8s'); }
    else if (durDiff <= THRESHOLDS.durationLooseS) { score += WEIGHTS.durationLoose; reasons.push('duracion:±15s'); }
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

  // Señales explícitas de «es la grabación de estudio» en el título: Official Audio / Music Video / Lyrics / Letra.
  // Un candidato que se identifique como «Official Audio» o «Lyric Video» reproduce la grabación de estudio con muy
  // alta probabilidad, por eso suman por encima del bonus de fuente (ADR-0044 ampliado 2026-11-23).
  const officialSignals = detectOfficialSignals(candidate.title);
  if (officialSignals.officialAudio) { score += WEIGHTS.officialAudio; reasons.push('oficial:audio'); }
  else if (officialSignals.officialVideo) { score += WEIGHTS.officialVideo; reasons.push('oficial:video'); }
  else if (officialSignals.lyricsVideo) { score += WEIGHTS.lyricsVideo; reasons.push('oficial:letra'); }

  // EXCLUSIÓN DURA por versión (live, remix, cover, karaoke, nightcore, extended…): si Spotify NO pide esa categoría y
  // el candidato la trae, no es la misma grabación — se saca de la carrera con un negativo grande que lo lleva muy por
  // debajo de `mediumFloor`. Se mantiene en la lista de alternativas para que el usuario pueda elegirlo a mano si de
  // verdad quiere esa versión (ADR-0044 ampliado 2026-11-23).
  const hardReason = hardExcludedReason(track, candidate);
  if (hardReason) { score += WEIGHTS.hardExcluded; reasons.push(`descartado:${hardReason}`); }

  // EXCLUSIÓN DURA por duración incompatible (fragmento o compilación): tampoco es la misma canción.
  if (isDurationUnusable(spDur, candDur)) { score += WEIGHTS.durationUnusable; reasons.push('descartado:duracion'); }

  return {
    score,
    reasons,
    signals: { coverage, durDiff, artistMatch, extra, missing, source, isrcExact, spVersions: [...spVersions],
      officialAudio: officialSignals.officialAudio, officialVideo: officialSignals.officialVideo,
      lyricsVideo: officialSignals.lyricsVideo, hardExcluded: hardReason, durationUnusable: isDurationUnusable(spDur, candDur) },
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
 * - alta: se puede aceptar sola (título y artista cuadran, duración dentro de ±8 s y versión consistente). No se exige
 *   ventaja sobre el segundo: cuando hay dos subidas de la MISMA canción (p. ej. vídeo oficial + lyric video), ambas
 *   valen y escoger la primera es correcto. Lo que descarta un candidato es que sea OTRA versión (directo, remix,
 *   extendida, cover…), que penaliza la puntuación y rompe `versionOk`, o que la duración se aleje (>8 s).
 * - media: título y artista cuadran pero algo no encaja del todo (duración 8–15 s, versión dudosa o puntuación justa)
 *   → se preselecciona el mejor, pero el usuario puede revisar entre `alternatives`.
 * - baja: nada supera el mínimo o el artista no coincide → búsqueda manual (best = null).
 */
export function classifyMatch(track, candidates, { maxAlternatives = 5 } = {}) {
  const ranked = rankCandidates(track, candidates);
  const best = ranked[0];
  // Puerta de artista para AUTOACEPTAR: solo se considera «alta» si el artista cuadra, o el candidato es de una fuente
  // oficial (Topic/VEVO) o tiene ISRC exacto. Que el artista no coincida ya no manda la pista a manual: se baja a
  // «media» con el mejor candidato preseleccionado, para que un clic confirme en vez de obligar a rebuscar.
  const artistOk = !best || best.signals.artistMatch !== false
    || best.signals.source === 'topic' || best.signals.source === 'official' || best.signals.isrcExact;
  if (!best || best.score < THRESHOLDS.mediumFloor) {
    return { tier: 'baja', best: null, alternatives: ranked.slice(0, maxAlternatives), ranked };
  }
  // Duración «de la misma grabación»: dentro de ±8 s. Spotify y YouTube difieren varios segundos de forma rutinaria
  // (intros, silencios finales, conteos), así que exigir ±2 s mandaba a «revisar» coincidencias correctísimas.
  const durationOk = best.signals.durDiff != null && best.signals.durDiff <= THRESHOLDS.autoDurationS;
  const versionOk = best.signals.extra.length === 0 && best.signals.missing.length === 0;
  const clear = artistOk && (best.signals.isrcExact
    || (best.score >= THRESHOLDS.autoScore && durationOk && versionOk));
  if (clear) {
    return { tier: 'alta', best, alternatives: ranked.slice(1, maxAlternatives), ranked };
  }
  return { tier: 'media', best, alternatives: ranked.slice(0, maxAlternatives), ranked };
}
