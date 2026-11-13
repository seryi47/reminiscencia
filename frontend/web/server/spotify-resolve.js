// Resolver de «Transferir música» (ADR-0044): el cerebro. Dada una colección de Spotify ya normalizada (spotify-core) y
// una función `searchYoutube(query, track)` que devuelve candidatos de YouTube, resuelve cada pista a una coincidencia
// con nivel de confianza (spotify-match). Conserva el ORDEN y limita la concurrencia. `searchYoutube` se inyecta: en
// producción envuelve la búsqueda real (server/youtube-search.js + YouTube Music); en pruebas, respuestas simuladas.

import { classifyMatch } from './spotify-match.js';
import { youtubeQueriesFor } from './spotify-core.js';

// Ejecuta `fn` sobre cada elemento con como mucho `limit` en paralelo, conservando el orden de salida.
async function mapPool(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return results;
}

/** Identidad de álbum/carpeta para una colección de Spotify (playlist o álbum → una carpeta; ADR-0019). */
export function albumOf(collection) {
  if (!collection || (collection.type !== 'album' && collection.type !== 'playlist')) return null;
  // Id estable del álbum SIN dos puntos: el pipeline valida el id con [A-Za-z0-9_-] (cliente `cleanAlbum`, `upload-core` y
  // el backend), así que `spotify:playlist:X` se descartaba y la canción se publicaba sin carpeta (ADR-0044). Con guiones
  // bajos pasa las tres validaciones y el backend agrupa por este id (una re-importación de la misma lista reutiliza la
  // carpeta). Se sanea el id de Spotify (base62) por si trajera algo raro.
  const safeId = String(collection.id ?? '').replace(/[^A-Za-z0-9_-]/g, '');
  return {
    id: `spotify_${collection.type}_${safeId}`,
    name: collection.name,
    cover: collection.cover ?? null,
    artist: collection.artist ?? null,
  };
}

/**
 * Resuelve una colección. Devuelve:
 * {
 *   type, id, name, album,
 *   results: [{ index, track, query, tier:'alta'|'media'|'baja', best, alternatives, error? }],
 *   summary: { total, alta, media, baja, error },
 * }
 * - `best` es { candidate, score, ... } (la coincidencia elegida) o null.
 * - un fallo de búsqueda de una pista no tumba el resto: queda como tier 'baja' con `error`.
 */
export async function resolveCollection(
  collection,
  { searchYoutube },
  { concurrency = 4, maxAlternatives = 5, maxQueries = 3 } = {},
) {
  if (!collection || !Array.isArray(collection.tracks)) throw new Error('colección inválida');
  if (typeof searchYoutube !== 'function') throw new Error('falta searchYoutube');

  const results = await mapPool(collection.tracks, concurrency, async (track, index) => {
    // Se prueban varias variantes de consulta (ADR-0046) acumulando candidatos: así una primera búsqueda floja no deja la
    // pista en «revisión manual». Se para en cuanto hay una coincidencia ALTA para no gastar llamadas de más (YouTube Music
    // limita en listas largas). Si TODAS las variantes fallan por red y no se juntó ni un candidato, queda baja con error.
    const queries = youtubeQueriesFor(track).slice(0, Math.max(1, maxQueries));
    const byKey = new Map();
    let lastError = null;
    let match = { tier: 'baja', best: null, alternatives: [] };
    for (const query of queries) {
      let candidates;
      try {
        candidates = (await searchYoutube(query, track)) ?? [];
      } catch (error) {
        lastError = error;
        continue;
      }
      for (const candidate of candidates) {
        const key = candidate?.id || candidate?.url;
        if (key && !byKey.has(key)) byKey.set(key, candidate);
      }
      match = classifyMatch(track, [...byKey.values()], { maxAlternatives });
      if (match.tier === 'alta') break;
    }
    const query = queries[0];
    if (byKey.size === 0 && lastError) {
      return { index, track, query, tier: 'baja', best: null, alternatives: [], error: String(lastError?.message ?? lastError) };
    }
    return { index, track, query, tier: match.tier, best: match.best, alternatives: match.alternatives };
  });

  const summary = { total: results.length, alta: 0, media: 0, baja: 0, error: 0 };
  for (const result of results) {
    summary[result.tier] += 1;
    if (result.error) summary.error += 1;
  }

  return { type: collection.type, id: collection.id, name: collection.name, album: albumOf(collection), results, summary };
}

/** Reselección manual de una pista: puntúa una nueva lista de candidatos (p. ej. de una búsqueda manual del usuario). */
export function reresolveTrack(track, candidates, { maxAlternatives = 8 } = {}) {
  return classifyMatch(track, candidates ?? [], { maxAlternatives });
}
