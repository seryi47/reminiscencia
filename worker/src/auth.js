// Autorización de los endpoints de escritura del catálogo (ADR-0052): header X-Auth con AUTH_PASSWORD, comparación
// timing-safe (ninguna rama devuelve antes según cuántos bytes coincidan). El secreto se sube con
// `npx wrangler@4 secret put AUTH_PASSWORD` (ver memoria reminiscencia-worker-auth).

/** Compara dos cadenas en tiempo constante (sin early return basado en longitud ni en el primer byte distinto). */
export function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  const length = Math.max(ea.length, eb.length);
  let diff = ea.length ^ eb.length;
  for (let i = 0; i < length; i += 1) {
    const ai = i < ea.length ? ea[i] : 0;
    const bi = i < eb.length ? eb[i] : 0;
    diff |= ai ^ bi;
  }
  return diff === 0;
}

/** True si la petición trae un X-Auth que coincide con env.AUTH_PASSWORD. Si falta el secreto en el entorno, SIEMPRE
 *  responde false (no se permiten escrituras sin secreto configurado). */
export function isAuthorized(request, env) {
  const expected = typeof env?.AUTH_PASSWORD === 'string' ? env.AUTH_PASSWORD : '';
  if (!expected) return false;
  const supplied = request.headers.get('x-auth') ?? '';
  return timingSafeEqual(expected, supplied);
}
