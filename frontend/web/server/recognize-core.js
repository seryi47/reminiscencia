// Reconocimiento musical propio (ADR-0048): servidor de la huella acústica. Recibe los hashes (constellation map) que
// calculó el móvil y los busca en nuestro índice `fingerprints.json`, que apareja {hash -> [(songId, offset_en_canción)]}.
// Devuelve la canción con más votos alineados en el tiempo (histograma de delta de offsets), con una puntuación de
// confianza en [0, 1]. Puro JS, sin dependencias: corre en el Worker y en Node 22.

/**
 * Para cada hash del query (con su offset), apuntamos todas las ocurrencias en el índice como votos por
 * (songId, offsetEnCanción - offsetEnQuery). El candidato correcto acumula muchos votos con el MISMO delta: la
 * grabación ambiente es una ventana corta, así que todos sus hashes están desplazados la misma cantidad respecto a
 * la posición de esa misma ventana en la canción original. Lo que no coincide dispersa su delta y no suma.
 *
 * @param {{hashes: number[], offsets: number[]}} query
 * @param {Map<number, Array<{songId: string, offset: number}>>|object} index
 * @param {{minVotes?: number}=} opts
 * @returns {{matched: boolean, songId?: string, votes?: number, totalQueryHashes: number, confidence: number}}
 */
export function matchFingerprint(query, index, { minVotes = 5 } = {}) {
  if (!query || !Array.isArray(query.hashes) || !Array.isArray(query.offsets)) {
    return { matched: false, totalQueryHashes: 0, confidence: 0 };
  }
  if (query.hashes.length !== query.offsets.length) {
    return { matched: false, totalQueryHashes: 0, confidence: 0 };
  }
  const total = query.hashes.length;
  if (total === 0) return { matched: false, totalQueryHashes: 0, confidence: 0 };
  // bestBySong[songId] = Map(delta → votes)
  const bestBySong = new Map();
  const get = index instanceof Map ? (h) => index.get(h) : (h) => index[h];
  for (let i = 0; i < total; i++) {
    const hits = get(query.hashes[i]);
    if (!hits) continue;
    const queryOffset = query.offsets[i];
    for (const hit of hits) {
      const delta = hit.offset - queryOffset;
      let perDelta = bestBySong.get(hit.songId);
      if (!perDelta) { perDelta = new Map(); bestBySong.set(hit.songId, perDelta); }
      perDelta.set(delta, (perDelta.get(delta) ?? 0) + 1);
    }
  }
  let bestSong = null;
  let bestVotes = 0;
  for (const [songId, perDelta] of bestBySong) {
    for (const v of perDelta.values()) {
      if (v > bestVotes) { bestVotes = v; bestSong = songId; }
    }
  }
  if (bestSong === null || bestVotes < minVotes) {
    return { matched: false, totalQueryHashes: total, confidence: 0 };
  }
  const confidence = Math.min(1, bestVotes / Math.max(20, total * 0.1));
  return { matched: true, songId: bestSong, votes: bestVotes, totalQueryHashes: total, confidence };
}

/** Index: `{ hash_as_string: [{s: songId, o: offset}, ...] }`. Compacto para caber en JSON. Lo abrimos al arrancar. */
export function parseFingerprintIndex(json) {
  const index = new Map();
  if (!json || typeof json !== 'object') return index;
  for (const [key, list] of Object.entries(json)) {
    const hash = Number(key);
    if (!Number.isFinite(hash) || !Array.isArray(list)) continue;
    const entries = [];
    for (const entry of list) {
      if (!entry || typeof entry !== 'object') continue;
      const songId = entry.s ?? entry.songId;
      const offset = entry.o ?? entry.offset;
      if (typeof songId !== 'string' || typeof offset !== 'number') continue;
      entries.push({ songId, offset });
    }
    if (entries.length) index.set(hash, entries);
  }
  return index;
}

/** Metadatos ligeros por canción para enriquecer la respuesta: `{ songId: { title, artist } }`. */
export function enrichMatch(result, meta) {
  if (!result.matched || !result.songId) return { ...result };
  const m = (meta && meta[result.songId]) || {};
  return { ...result, title: m.title ?? null, artist: m.artist ?? null };
}
