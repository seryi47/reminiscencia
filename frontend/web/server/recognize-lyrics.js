// Segunda vía del reconocimiento (ADR-0048): letras. El móvil manda el audio grabado y el Worker lo transcribe con
// `@cf/openai/whisper` (Workers AI) y busca el texto en LRClib (base pública de letras, sin token). Si hay una letra
// que contiene varias frases seguidas del transcrito, devolvemos esa canción como candidata; la app la pasa al flujo de
// importación de YouTube.

// Nota de precisión HONESTA: Whisper está entrenado con habla, no con vocales cantadas sobre música; en un bar con
// ruido puede dar un transcrito limpio (pop con voz clara) o un galimatías (rap acelerado o bar ruidoso). Cuando no
// hay confianza en el transcrito, devolvemos `matched: false` con razón «no_lyrics_captured» o «no_lyrics_match».

const WHISPER_MODEL = '@cf/openai/whisper';
const LRCLIB_SEARCH = 'https://lrclib.net/api/search';
// Longitud mínima del transcrito para que merezca la pena buscar letra. Si el micro capta ruido, Whisper devuelve 1-2
// palabras y la búsqueda es ruido también.
const MIN_TRANSCRIPT_WORDS = 4;

const MIN_PHRASE_WORDS = 3;    // mínimo de palabras en una ventana del transcrito para considerar un «frase»
const MAX_PHRASE_WORDS = 8;    // máximo

const MAX_CANDIDATES_LRCLIB = 40;

const LRCLIB_USER_AGENT = 'reminiscencia-recognizer (https://reminiscencia.cometia.es)';

export async function handleRecognizeLyricsRequest(request, { env } = {}) {
  if (request.method !== 'POST') {
    return jsonResponse(405, { ok: false, matched: false, error: 'Solo se admite POST.' });
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
    return jsonResponse(400, { ok: false, matched: false, error: 'Audio demasiado corto.' });
  }
  if (audioBytes.length > 10 * 1024 * 1024) {
    return jsonResponse(413, { ok: false, matched: false, error: 'Audio demasiado grande (>10 MB).' });
  }

  // 1) Transcripción Whisper. Pedimos `vtt=false` para recibir el texto plano.
  let transcript = '';
  try {
    const out = await ai.run(WHISPER_MODEL, { audio: Array.from(audioBytes) });
    transcript = (out?.text ?? '').trim();
  } catch (error) {
    return jsonResponse(200, { ok: true, matched: false, reason: 'whisper_failed', detail: String(error?.message ?? error) });
  }
  const words = transcript.split(/\s+/).filter(Boolean);
  if (words.length < MIN_TRANSCRIPT_WORDS) {
    return jsonResponse(200, { ok: true, matched: false, reason: 'no_lyrics_captured', transcript });
  }

  // 2) Búsqueda en LRClib. Hacemos primero una búsqueda con las 2–4 primeras palabras significativas, luego con las
  //    2–4 de en medio. Las que más se parezcan a la letra ganan.
  const candidates = await searchLrclib(transcript, { env });
  if (candidates.length === 0) {
    return jsonResponse(200, { ok: true, matched: false, reason: 'no_lyrics_match', transcript });
  }

  // 3) Elegimos la canción cuyas letras contengan más frases consecutivas del transcrito.
  const scored = candidates.map((c) => ({ ...c, score: scoreCandidate(transcript, c.plainLyrics ?? '') }));
  scored.sort((a, b) => b.score - a.score);
  const top = scored[0];
  if (!top || top.score < 2) {
    return jsonResponse(200, { ok: true, matched: false, reason: 'low_lyrics_confidence', transcript });
  }
  return jsonResponse(200, {
    ok: true,
    matched: true,
    source: 'lyrics',
    title: top.trackName ?? top.name ?? '',
    artist: top.artistName ?? '',
    album: top.albumName ?? '',
    confidence: Math.min(1, top.score / 8),
    transcript,
  });
}

/** Normaliza para comparar: baja, quita signos, colapsa espacios. */
function normalize(text) {
  return String(text ?? '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Puntúa un candidato por el número de ventanas del transcrito que están, tal cual, dentro de la letra. */
function scoreCandidate(transcript, lyrics) {
  const t = normalize(transcript);
  const l = normalize(lyrics);
  if (!t || !l) return 0;
  const words = t.split(' ');
  let score = 0;
  for (let n = MIN_PHRASE_WORDS; n <= Math.min(MAX_PHRASE_WORDS, words.length); n++) {
    for (let i = 0; i + n <= words.length; i++) {
      const phrase = words.slice(i, i + n).join(' ');
      if (l.includes(phrase)) score += n - MIN_PHRASE_WORDS + 1;
    }
  }
  return score;
}

/** Busca en LRClib con varias consultas sacadas del transcrito; deduplica por (trackName, artistName). */
async function searchLrclib(transcript, { env } = {}) {
  const t = normalize(transcript);
  const words = t.split(' ');
  if (words.length === 0) return [];
  const queries = new Set();
  // Primeras 3–4 palabras y de en medio (bar típico: pierdes el primer verso y el final).
  queries.add(words.slice(0, 4).join(' '));
  if (words.length >= 6) queries.add(words.slice(2, 6).join(' '));
  if (words.length >= 8) queries.add(words.slice(Math.floor(words.length / 2), Math.floor(words.length / 2) + 4).join(' '));
  const seen = new Map();
  const headers = { 'User-Agent': LRCLIB_USER_AGENT, Accept: 'application/json' };
  const fetchImpl = env?.fetch ?? globalThis.fetch;
  for (const q of queries) {
    if (seen.size >= MAX_CANDIDATES_LRCLIB) break;
    const url = `${LRCLIB_SEARCH}?q=${encodeURIComponent(q)}`;
    try {
      const res = await fetchImpl(url, { headers });
      if (!res.ok) continue;
      const list = await res.json();
      if (!Array.isArray(list)) continue;
      for (const item of list) {
        if (!item || typeof item !== 'object') continue;
        const key = `${item.trackName ?? ''}|${item.artistName ?? ''}`.toLowerCase();
        if (!seen.has(key)) seen.set(key, item);
        if (seen.size >= MAX_CANDIDATES_LRCLIB) break;
      }
    } catch (_) { /* seguimos con las otras queries */ }
  }
  return [...seen.values()];
}

function jsonResponse(status, data) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}
