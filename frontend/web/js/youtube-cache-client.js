// Cliente del preflight de cache R2 para YouTube (ADR-0052).
// Llamada previa a la importación de playlist para saber qué vídeos ya están en caché y pueden descargarse
// con concurrencia alta (son GETs a R2, no saturan yttowav).

/** Dado un array de URLs de YouTube, pregunta al Worker cuáles están ya en cache R2 (hits) y cuáles no (misses). */
export async function youtubeCacheCheck(urls, { fetchImpl = globalThis.fetch, endpoint = '/api/youtube/cache/check' } = {}) {
  if (!Array.isArray(urls) || urls.length === 0) {
    return { hits: [], misses: [], invalid: [], hitRate: 0 };
  }
  try {
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ urls }),
    });
    if (!response.ok) return emptyResult(urls);
    const data = await response.json();
    const hits = Array.isArray(data?.hits) ? data.hits : [];
    const misses = Array.isArray(data?.misses) ? data.misses : [];
    const invalid = Array.isArray(data?.invalid) ? data.invalid : [];
    const total = hits.length + misses.length;
    return {
      hits,
      misses,
      invalid,
      hitRate: total > 0 ? hits.length / total : 0,
    };
  } catch {
    return emptyResult(urls);
  }
}

function emptyResult(urls) {
  return { hits: [], misses: urls.map((url) => ({ url })), invalid: [], hitRate: 0 };
}

/**
 * Concurrencia recomendada para cada canción, según venga de cache o de yttowav.
 * - cache: 8 (R2 aguanta fácilmente).
 * - yttowav: 2 (preserva cupo diario de 40/IP).
 */
export function concurrencyFor(source) {
  return source === 'cache' ? 8 : 2;
}
