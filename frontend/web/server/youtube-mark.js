// Cabecera-marca de las respuestas de las funciones de YouTube (ADR-0038).
//
// El Worker reenvía /api/youtube/search y /playlist a una lista de plataformas (Vercel primero, para que vuelva sola
// cuando Vercel se desbloquee; Netlify de respaldo mientras tanto). Para saber si una plataforma está EN PIE o CAÍDA
// no basta el código de estado: una función real puede devolver 502 («YouTube devolvió demasiados datos»), y una
// plataforma pausada devuelve 402 (Vercel: DEPLOYMENT_DISABLED) o una página de error sin que la función llegue a
// ejecutarse. Por eso cada función marca su respuesta con esta cabecera: si llega, la función se ejecutó (aunque sea un
// error de la función); si no llega, la plataforma está caída y el Worker prueba la siguiente.
//
// La usan los wrappers de Vercel (frontend/web/api/youtube/*.js) y las funciones de Netlify (netlify/functions/*), y
// la lee el Worker (worker/src/index.js). Es el único sitio donde vive el nombre de la cabecera.

export const YOUTUBE_MARK_HEADER = 'X-Reminiscencia-Youtube';

/** Devuelve una copia de la respuesta con la cabecera-marca puesta (sin consumir el cuerpo: se transmite igual). */
export function markYoutube(response) {
  const headers = new Headers(response.headers);
  headers.set(YOUTUBE_MARK_HEADER, '1');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
