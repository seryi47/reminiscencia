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
  { concurrency = 1, maxAlternatives = 5, maxQueries = 10, budgetMs = 25000 } = {},
) {
  if (!collection || !Array.isArray(collection.tracks)) throw new Error('colección inválida');
  if (typeof searchYoutube !== 'function') throw new Error('falta searchYoutube');
  // Presupuesto global (ADR-0046 ampliado 2026-11-24): el Worker de Cloudflare tiene ~30 s de CPU por petición. Con
  // concurrencia 1 (serializado para no saturar el upstream), 25 pistas × (reintentos + 8 s de «último recurso») se
  // pasaban del límite y Cloudflare devolvía 503 (Error 1102 CPU exceeded). `budgetMs` recorta los reintentos y el
  // «último recurso» para las pistas que queden cuando el tiempo se agota: así siempre devuelve algo (las no resueltas
  // quedan en tier=baja con `error:'tiempo agotado'`, el cliente las ve y reintenta la página).
  const startedAt = Date.now();
  const timeLeft = () => Math.max(0, budgetMs - (Date.now() - startedAt));

  // Cache de candidatos por consulta normalizada (ADR-0046 ampliado 2026-11-19): el mismo artista suele mandar varias
  // pistas en una misma lista y muchas variantes de consulta repiten las palabras. Compartirlos ahorra llamadas al
  // upstream y reduce la presión que dispara el rate-limit de YouTube Music.
  const queryCache = new Map(); // normalizedQuery -> candidates[]
  const normalizeQuery = (q) => String(q ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

  async function searchWithCache(query, track) {
    const key = normalizeQuery(query);
    if (queryCache.has(key)) return queryCache.get(key);
    const candidates = (await searchYoutube(query, track)) ?? [];
    // Solo cacheamos resultados NO vacíos: un vacío transitorio por rate-limit no debe tapar un reintento posterior.
    if (candidates.length > 0) queryCache.set(key, candidates);
    return candidates;
  }

  const results = await mapPool(collection.tracks, concurrency, async (track, index) => {
    // Se prueban varias variantes de consulta (ADR-0046) acumulando candidatos: así una primera búsqueda floja no deja la
    // pista en «revisión manual». Se para en cuanto hay una coincidencia ALTA para no gastar llamadas de más (YouTube Music
    // limita en listas largas). Si TODAS las variantes fallan por red y no se juntó ni un candidato, queda baja con error.
    const queries = youtubeQueriesFor(track).slice(0, Math.max(1, maxQueries));
    const byKey = new Map();
    let lastError = null;
    let match = { tier: 'baja', best: null, alternatives: [] };
    // Si el presupuesto ya está agotado antes de empezar, ni siquiera lanzamos las queries para esta pista: el Worker
    // se ahorra el tiempo de red y devuelve la respuesta a tiempo con esta pista marcada en error. El cliente puede
    // pedir la siguiente página o reintentar: el presupuesto es por petición, cada una arranca con los 25 s enteros.
    if (timeLeft() < 2000) {
      return { index, track, query: queries[0], tier: 'baja', best: null, alternatives: [], error: 'tiempo agotado' };
    }
    for (const query of queries) {
      let candidates;
      try {
        candidates = await searchWithCache(query, track);
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
    // Rescate contra el rate-limit silencioso del upstream (ADR-0046 ampliado 2026-11-19): si todas las queries han
    // vuelto con 0 resultados y ningún error explícito, reintentamos todas las variantes con backoff progresivo.
    // Con el cambio del Worker (upstream primero, YT Music como fallback) ya no hace falta un backoff tan largo;
    // 3 reintentos cortos bastan porque el upstream es mucho más tolerante.
    const backoffsMs = [500, 1500, 4000];
    for (const waitMs of backoffsMs) {
      if (byKey.size > 0 || lastError || queries.length === 0) break;
      // Presupuesto agotado: saltar reintentos (ADR-0046 ampliado 2026-11-24). Dejamos margen > waitMs + 1 query.
      if (timeLeft() < waitMs + 3000) break;
      await new Promise((r) => setTimeout(r, waitMs));
      for (const query of queries) {
        try {
          const candidates = (await searchYoutube(query, track)) ?? [];
          for (const candidate of candidates) {
            const key = candidate?.id || candidate?.url;
            if (key && !byKey.has(key)) byKey.set(key, candidate);
          }
          if (byKey.size > 0) break; // basta con que una variante del reintento devuelva algo
        } catch (error) {
          lastError = error;
          break;
        }
      }
      if (byKey.size > 0) match = classifyMatch(track, [...byKey.values()], { maxAlternatives });
    }
    // Fallback DE ÚLTIMA OPORTUNIDAD: si tras los reintentos sigue vacío, esperamos 8 s para que la ventana de
    // rate-limit se cierre y lanzamos UNA query mínima (artista + título, sin "lyrics" ni variantes). Confirmado
    // en producción (19-nov) que la ráfaga de una página entera agotaba cuota del upstream y 6 pistas quedaban
    // vacías aunque se resolvieran bien al llamarlas en solitario minutos después.
    if (byKey.size === 0 && !lastError && Array.isArray(track.artists) && track.artists[0] && track.title
        && timeLeft() >= 11000) { // 8 s de espera + ~3 s de margen para la propia query
      await new Promise((r) => setTimeout(r, 8000));
      const minimalQuery = `${track.artists[0]} ${track.title}`.replace(/\s+/g, ' ').trim();
      try {
        const candidates = (await searchYoutube(minimalQuery, track)) ?? [];
        for (const candidate of candidates) {
          const key = candidate?.id || candidate?.url;
          if (key && !byKey.has(key)) byKey.set(key, candidate);
        }
        if (byKey.size > 0) match = classifyMatch(track, [...byKey.values()], { maxAlternatives });
      } catch (error) {
        lastError = error;
      }
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
