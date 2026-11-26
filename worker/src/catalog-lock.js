// Candado optimista del catálogo en R2 (ADR-0052). Un POST que modifica el catálogo adquiere este lock al entrar y lo
// libera al salir. Evita la carrera entre leer la versión actual y escribir la nueva: si otro proceso tiene el lock
// vigente, respondemos 423 Locked con Retry-After, no se toca el catálogo.
//
// Formato: catalog/LOCK.json = { by, until_ts: ms_epoch, token }. La atomicidad real del PUT la da R2 con onlyIf:
// - cuando no hay objeto previo, PUT con etagDoesNotMatch: '*'   (falla si otro lo creó mientras tanto).
// - cuando el objeto previo ha expirado, PUT con etagMatches: <etag del expirado> (falla si otro lo robó antes).
// Expira solo por tiempo: si se encuentra con until_ts <= now, puede robarlo el siguiente.

export const LOCK_KEY = 'catalog/LOCK.json';
export const LOCK_TTL_MS = 15 * 1000;

function makeToken(by, now) {
  return `${by}-${now}-${Math.random().toString(36).slice(2, 10)}`;
}

function serialize(by, now, token) {
  return JSON.stringify({ by, until_ts: now + LOCK_TTL_MS, token });
}

/** Intenta adquirir el lock atómicamente. Devuelve {ok:true, token} o {ok:false, retryAfter}. */
export async function acquireLock(bucket, by, { now = Date.now() } = {}) {
  const existing = await bucket.get(LOCK_KEY);
  if (existing) {
    const text = await existing.text();
    let current = null;
    try { current = JSON.parse(text); } catch { current = null; }
    if (current && typeof current.until_ts === 'number' && current.until_ts > now) {
      return { ok: false, retryAfter: Math.ceil((current.until_ts - now) / 1000) };
    }
    // Expirado o inválido: intento robar el lock, pero solo si el objeto que vi es el mismo que está ahora en R2.
    const token = makeToken(by, now);
    const written = await bucket.put(LOCK_KEY, serialize(by, now, token), {
      httpMetadata: { contentType: 'application/json; charset=utf-8' },
      onlyIf: { etagMatches: existing.etag },
    });
    if (!written) return { ok: false, retryAfter: 1 };
    return { ok: true, token };
  }
  // No existía: creación atómica (falla si otro lo creó entre mi get y mi put).
  const token = makeToken(by, now);
  const written = await bucket.put(LOCK_KEY, serialize(by, now, token), {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
    onlyIf: { etagDoesNotMatch: '*' },
  });
  if (!written) return { ok: false, retryAfter: 1 };
  return { ok: true, token };
}

/** Libera el lock si es nuestro (compara token). Idempotente. */
export async function releaseLock(bucket, token) {
  const existing = await bucket.get(LOCK_KEY);
  if (!existing) return;
  const text = await existing.text();
  let current = null;
  try { current = JSON.parse(text); } catch { current = null; }
  if (!current || current.token !== token) return;
  // Marcamos liberado poniendo until_ts=0 (el siguiente acquire lo tratará como expirado y lo robará con etag).
  const payload = JSON.stringify({ by: current.by, until_ts: 0, token: null });
  await bucket.put(LOCK_KEY, payload, {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
    onlyIf: { etagMatches: existing.etag },
  });
}
