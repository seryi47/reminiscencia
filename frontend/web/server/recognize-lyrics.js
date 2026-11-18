// Segunda vía del reconocimiento (ADR-0048): letras. El móvil manda el audio grabado y el Worker lo transcribe con
// `@cf/openai/whisper-large-v3-turbo` (Workers AI) y busca el texto en:
//   1. Lyrics.ovh (gratis, sin token, PERMITE buscar por contenido de letra: una frase del verso devuelve la canción).
//   2. LRClib (gratis, sin token, pero su /api/search solo busca por título/artista, no por letra): la usamos como
//      fallback cuando Whisper devuelve algo que parece título.
// Combinamos candidatos y rankeamos por coincidencia de la letra real contra el transcrito.

// Nota de precisión HONESTA: Whisper está entrenado con habla, no con vocales cantadas sobre música; en un bar con
// ruido puede dar un transcrito limpio (pop con voz clara) o un galimatías (rap acelerado o bar ruidoso). Cuando no
// hay confianza en el transcrito, devolvemos `matched: false` con razón «no_lyrics_captured» o «no_lyrics_match».

// `whisper-large-v3-turbo` acepta base64, autodetecta el idioma (clave para música en español) y rinde mejor en voces
// cantadas que el `whisper` básico. Workers AI incluye cuota generosa para esto.
const WHISPER_MODEL = '@cf/openai/whisper-large-v3-turbo';
const LRCLIB_SEARCH = 'https://lrclib.net/api/search';
const LRCLIB_GET = 'https://lrclib.net/api/get';
const LYRICSOVH_SUGGEST = 'https://api.lyrics.ovh/suggest';
const LYRICSOVH_GET = 'https://api.lyrics.ovh/v1'; // /v1/{artist}/{title} → {lyrics}
// Longitud mínima del transcrito para que merezca la pena buscar letra. Si el micro capta ruido, Whisper devuelve 1-2
// palabras y la búsqueda es ruido también.
const MIN_TRANSCRIPT_WORDS = 4;

// Palabras «raras» (que no aparecen en una lista larga de muletillas) se usan para desambiguar: una canción con
// «callin'» y «verte» en la misma letra tiene mucho más peso que una con «baby» y «girl».
const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her', 'us', 'them', 'my', 'your', 'our',
  'baby', 'girl', 'boy', 'yeah', 'oh', 'woh', 'woah', 'uh', 'honey', 'love', 'no', 'si', 'yes',
  'el', 'la', 'los', 'las', 'un', 'una', 'y', 'o', 'pero', 'en', 'de', 'del', 'con', 'que',
  'yo', 'tu', 'ella', 'nosotros', 'ellos', 'ellas', 'mi', 'su',
  'mama', 'papa', 'bebe', 'morning', 'in', 'to', 'at',
]);

const MIN_PHRASE_WORDS = 2;    // ventanas de 2 a 6 palabras consecutivas (antes 3 a 8 era demasiado estricto)
const MAX_PHRASE_WORDS = 6;

const MAX_CANDIDATES_LRCLIB = 50;
const MAX_LRCLIB_QUERIES = 6; // tope de llamadas a LRClib por petición: no spameamos su API
const MAX_LYRICS_LOAD_CONCURRENCY = 5; // cuántas letras completas pedimos EN PARALELO: no hundir Lyrics.ovh/LRClib
const MAX_LYRICS_LENGTH_FOR_SCORING = 10_000; // una letra >10 KB se recorta; proteger CPU del Worker

const LRCLIB_USER_AGENT = 'reminiscencia-recognizer (https://reminiscencia.cometia.es)';

export async function handleRecognizeLyricsRequest(request, { env } = {}) {
  if (request.method !== 'POST') {
    return jsonResponse(405, { ok: false, matched: false, error: 'Solo se admite POST.' });
  }
  // Rate limit propio de la vía letras (cuota Workers AI = coste €): 20 peticiones por minuto por IP.
  //
  // IMPORTANTE: el binding `LYRICS_RATE_LIMITER` de Cloudflare Workers (`[[ratelimits]]`) está en beta y nos devolvía
  // siempre `success: true` incluso enviando 30 peticiones en 2 segundos — comportamiento verificado con una cabecera
  // de diagnóstico. No es fiable para proteger coste de Workers AI. Implementamos nuestro propio contador usando
  // `caches.default` (que es un cache per-colo, eventualmente consistente): clave por `ip + ventana de 60 s`, con TTL
  // = ventana. No es perfecto (concurrencia entre colos, pequeño exceso en carreras) pero YA ENFORZA.
  const diagLimiter = await enforceLyricsRateLimit(request);
  if (diagLimiter === 'denied') {
    return jsonResponse(429, { ok: false, matched: false, error: 'Demasiadas peticiones; espera un minuto.' }, { 'X-Lyrics-Limiter': diagLimiter });
  }
  const ai = env?.AI;
  if (!ai) {
    return jsonResponse(200, { ok: true, matched: false, reason: 'ai_not_ready' });
  }
  let audioBytes;
  try {
    const buf = await request.arrayBuffer();
    audioBytes = new Uint8Array(buf);
  } catch (_) {
    return jsonResponse(400, { ok: false, matched: false, error: 'Cuerpo no legible como audio.' });
  }
  if (audioBytes.length < 1024) {
    return jsonResponse(400, { ok: false, matched: false, error: 'Audio demasiado corto.' }, { 'X-Lyrics-Limiter': diagLimiter });
  }
  if (audioBytes.length > 10 * 1024 * 1024) {
    return jsonResponse(413, { ok: false, matched: false, error: 'Audio demasiado grande (>10 MB).' }, { 'X-Lyrics-Limiter': diagLimiter });
  }

  // 1) Transcripción con whisper-large-v3-turbo. Pasamos el audio como base64 (es lo que acepta este modelo) y le
  //    decimos `task: 'transcribe'` para que escriba la letra TAL CUAL se canta (si fuera 'translate' lo traduciría a
  //    inglés). El idioma lo detecta solo, así que vale para español, inglés, etc.
  let transcript = '';
  let detectedLanguage = '';
  try {
    const audioB64 = toBase64(audioBytes);
    const out = await ai.run(WHISPER_MODEL, { audio: audioB64, task: 'transcribe' });
    transcript = (out?.text ?? '').trim();
    detectedLanguage = (out?.language ?? '').toString();
  } catch (error) {
    return jsonResponse(200, { ok: true, matched: false, reason: 'whisper_failed', detail: String(error?.message ?? error) });
  }
  const words = transcript.split(/\s+/).filter(Boolean);
  if (words.length < MIN_TRANSCRIPT_WORDS) {
    return jsonResponse(200, { ok: true, matched: false, reason: 'no_lyrics_captured', transcript });
  }

  // 2) Reunir candidatos. Lyrics.ovh DEVUELVE canción buscando por fragmento de letra (lo que nos interesa); LRClib
  //    /api/search solo busca por título/artista pero vale como red cuando Whisper devuelve algo parecido al título.
  const candidates = await gatherCandidates(transcript, { env });
  if (candidates.length === 0) {
    return jsonResponse(200, { ok: true, matched: false, reason: 'no_lyrics_match', transcript });
  }

  // 3) Para cada candidato traemos la letra completa (si no la tiene ya) y puntuamos por coincidencia contra el
  //    transcrito. Con cap de paralelismo para no reventar Lyrics.ovh/LRClib si tenemos 50 candidatos.
  const scored = await mapWithLimit(candidates, MAX_LYRICS_LOAD_CONCURRENCY, async (c) => ({
    ...c,
    score: scoreCandidate(transcript, (await loadLyrics(c, { env })).slice(0, MAX_LYRICS_LENGTH_FOR_SCORING)),
  }));
  scored.sort((a, b) => b.score - a.score);
  const top = scored[0];
  // Umbral adaptativo: con transcrito muy corto exigimos menos. Si no llega, devolvemos el candidato con mejor score
  // como «low_lyrics_confidence» pero incluimos su título/artista por si el usuario quiere confirmar.
  const minScore = words.length < 8 ? 2 : 3;
  if (!top || top.score < minScore) {
    return jsonResponse(200, {
      ok: true,
      matched: false,
      reason: 'low_lyrics_confidence',
      transcript,
      language: detectedLanguage,
      bestGuess: top ? { title: top.trackName ?? '', artist: top.artistName ?? '', score: top.score } : null,
    });
  }
  return jsonResponse(200, {
    ok: true,
    matched: true,
    source: 'lyrics',
    title: top.trackName ?? '',
    artist: top.artistName ?? '',
    confidence: Math.min(1, top.score / 10),
    transcript,
    language: detectedLanguage,
  });
}

/** Codifica un Uint8Array a base64 ASCII sin Buffer (compatible con Workers runtime). */
function toBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Normaliza para comparar: baja, quita signos, colapsa espacios. */
function normalize(text) {
  return String(text ?? '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Puntúa un candidato combinando: 1) ventanas consecutivas del transcrito presentes en la letra y 2) palabras «raras»
 *  del transcrito (fuera de la lista de muletillas) que también aparecen en la letra. Las palabras raras pesan más. */
export function scoreCandidate(transcript, lyrics) {
  const t = normalize(transcript);
  const l = normalize(lyrics);
  if (!t || !l) return 0;
  const words = t.split(' ');
  let score = 0;
  // Palabras raras presentes en la letra (muy discriminativas).
  const rareWordsInTranscript = words.filter((w) => w.length >= 3 && !STOPWORDS.has(w));
  const uniqueRare = [...new Set(rareWordsInTranscript)];
  for (const w of uniqueRare) {
    // Coincidencia como palabra entera, no subcadena, para no inflar con «oh» en «oh-oh».
    const re = new RegExp(`\\b${escapeRegExp(w)}\\b`);
    if (re.test(l)) score += 2;
  }
  // Ventanas consecutivas de 2-6 palabras en la letra (frases exactas).
  for (let n = MIN_PHRASE_WORDS; n <= Math.min(MAX_PHRASE_WORDS, words.length); n++) {
    for (let i = 0; i + n <= words.length; i++) {
      const slice = words.slice(i, i + n);
      // Si todas las palabras de la ventana son stopwords, no cuenta.
      if (slice.every((w) => STOPWORDS.has(w))) continue;
      const phrase = slice.join(' ');
      if (l.includes(phrase)) score += n - MIN_PHRASE_WORDS + 2;
    }
  }
  return score;
}

function escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/** Reúne candidatos de Lyrics.ovh (por contenido de letra) y de LRClib (por título). Dedup por (title, artist). */
export async function gatherCandidates(transcript, { env, fetchImpl } = {}) {
  const t = normalize(transcript);
  const words = t.split(' ');
  if (words.length === 0) return [];
  const rare = words.filter((w) => w.length >= 3 && !STOPWORDS.has(w));
  const fetcher = fetchImpl ?? env?.fetch ?? globalThis.fetch;
  const seen = new Map();

  // Helper: añade un candidato normalizado al mapa.
  const add = (title, artist, extra = {}) => {
    const trackName = String(title ?? '').trim();
    const artistName = String(artist ?? '').trim();
    if (!trackName || !artistName) return;
    const key = `${trackName}|${artistName}`.toLowerCase();
    if (!seen.has(key)) seen.set(key, { trackName, artistName, ...extra });
  };

  // 1) Lyrics.ovh — BUSCAR POR LETRA. Lo que funciona con su API son **ventanas consecutivas** de 3-5 palabras del
  //    transcrito (incluidas las muletillas que sirven de pegamento). No vale juntar las palabras raras sueltas: perdemos
  //    la frase y Lyrics.ovh no la reconoce. Para cada palabra rara, enviamos una ventana centrada en ella.
  const lyricsQueries = new Set();
  for (let i = 0; i < words.length && lyricsQueries.size < 5; i++) {
    const w = words[i];
    if (w.length < 3 || STOPWORDS.has(w)) continue;
    const start = Math.max(0, i - 1);
    const end = Math.min(words.length, i + 4);
    const phrase = words.slice(start, end).join(' ').trim();
    if (phrase.split(' ').length >= 3) lyricsQueries.add(phrase);
  }
  // Como red: la primera y la última ventana del transcrito, siempre.
  if (words.length >= 4) lyricsQueries.add(words.slice(0, 5).join(' '));
  if (words.length >= 5) lyricsQueries.add(words.slice(Math.max(0, words.length - 5)).join(' '));

  for (const q of lyricsQueries) {
    if (seen.size >= MAX_CANDIDATES_LRCLIB) break;
    if (!q.trim()) continue;
    try {
      const res = await fetcher(`${LYRICSOVH_SUGGEST}/${encodeURIComponent(q)}`);
      if (!res.ok) continue;
      const data = await res.json();
      if (!data?.data || !Array.isArray(data.data)) continue;
      for (const item of data.data.slice(0, 15)) {
        add(item.title_short ?? item.title, item?.artist?.name, { source: 'lyrics.ovh' });
      }
    } catch (_) { /* seguimos */ }
  }

  // 2) LRClib — búsqueda por título/artista, por si el transcrito contiene el título cantado. Máximo 2 queries.
  const lrclibHeaders = { 'User-Agent': LRCLIB_USER_AGENT, Accept: 'application/json' };
  const lrclibQueries = new Set([
    words.slice(0, 4).join(' '),
    rare.length >= 2 ? rare.slice(0, 3).join(' ') : null,
  ].filter(Boolean));
  let used = 0;
  for (const q of lrclibQueries) {
    if (used >= 2) break;
    if (seen.size >= MAX_CANDIDATES_LRCLIB) break;
    used += 1;
    try {
      const res = await fetcher(`${LRCLIB_SEARCH}?q=${encodeURIComponent(q)}`, { headers: lrclibHeaders });
      if (!res.ok) continue;
      const list = await res.json();
      if (!Array.isArray(list)) continue;
      for (const item of list.slice(0, 15)) {
        add(item.trackName, item.artistName, { source: 'lrclib', plainLyrics: item.plainLyrics });
      }
    } catch (_) { /* seguimos */ }
  }
  return [...seen.values()];
}

/** Devuelve la letra plano de un candidato. Si ya la trae (LRClib), la usa tal cual. Si viene de Lyrics.ovh, pide
 *  la letra completa a `/api/v1/{artist}/{title}`. Nunca lanza; devuelve '' si no puede leerla. */
export async function loadLyrics(candidate, { env, fetchImpl } = {}) {
  if (typeof candidate?.plainLyrics === 'string' && candidate.plainLyrics) return candidate.plainLyrics;
  const fetcher = fetchImpl ?? env?.fetch ?? globalThis.fetch;
  const { trackName, artistName } = candidate;
  if (!trackName || !artistName) return '';
  // Preferimos LRClib /api/get (tiene timestamps y texto plano) y, si no, Lyrics.ovh.
  try {
    const url = `${LRCLIB_GET}?track_name=${encodeURIComponent(trackName)}&artist_name=${encodeURIComponent(artistName)}`;
    const res = await fetcher(url, { headers: { 'User-Agent': LRCLIB_USER_AGENT, Accept: 'application/json' } });
    if (res.ok) {
      const data = await res.json();
      if (typeof data?.plainLyrics === 'string' && data.plainLyrics) {
        candidate.plainLyrics = data.plainLyrics;
        return data.plainLyrics;
      }
    }
  } catch (_) { /* fallback */ }
  try {
    const url = `${LYRICSOVH_GET}/${encodeURIComponent(artistName)}/${encodeURIComponent(trackName)}`;
    const res = await fetcher(url);
    if (res.ok) {
      const data = await res.json();
      if (typeof data?.lyrics === 'string' && data.lyrics) {
        candidate.plainLyrics = data.lyrics;
        return data.lyrics;
      }
    }
  } catch (_) { /* nada */ }
  return '';
}

function jsonResponse(status, data, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...extraHeaders },
  });
}

/** Rate limiter propio: cuenta peticiones por IP en ventanas de 60 s usando `caches.default`. Devuelve 'allowed' o
 *  'denied'. Si falla cualquier parte (caches no disponible, red interna lenta), devuelve 'allowed' (fail-open,
 *  nunca bloqueamos por fallo infra). Tope = `LYRICS_RATE_LIMIT_PER_MINUTE`. */
const LYRICS_RATE_LIMIT_PER_MINUTE = 20;
export async function enforceLyricsRateLimit(request) {
  try {
    const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('x-forwarded-for') || 'desconocida';
    const windowMinute = Math.floor(Date.now() / 60000);
    const key = `https://rl.internal/lyrics/${encodeURIComponent(ip)}/${windowMinute}`;
    const cached = await caches.default.match(key);
    let count = 0;
    if (cached) {
      const text = await cached.text();
      count = parseInt(text, 10) || 0;
    }
    if (count >= LYRICS_RATE_LIMIT_PER_MINUTE) {
      return 'denied';
    }
    // Incrementamos y re-cacheamos con TTL = ventana (60 s desde ahora). No es atómico entre llamadas concurrentes
    // en el mismo colo, pero el error es al alza (algunas cuentan menos) → el techo real es ~20±5, aceptable.
    const next = new Response(String(count + 1), {
      headers: { 'Cache-Control': 'max-age=60', 'Content-Type': 'text/plain' },
    });
    await caches.default.put(key, next);
    return 'allowed';
  } catch (_) {
    return 'allowed';
  }
}

/** Procesa `items` llamando a `fn` con como mucho `limit` en paralelo. Mantiene el orden original en la salida. */
export async function mapWithLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return results;
}
