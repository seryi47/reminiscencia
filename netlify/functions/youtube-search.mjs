// Función de Netlify: búsqueda en YouTube mientras Vercel está bloqueado (ADR-0038).
//
// Es un adaptador fino sobre el mismo núcleo que usan Vercel (frontend/web/api/youtube/search.js) y el Worker: la lógica
// vive en frontend/web/server/youtube-search.js (handler Web estándar Request→Response, con spawn/env/fetch por
// defecto del entorno Node de Netlify). Solo marca la respuesta con la cabecera-marca para que el Worker sepa que
// Netlify está en pie al reenviar /api/youtube/search.
//
// La ruta pública la fija `config.path` (función v2 de Netlify), así que responde en el mismo /api/youtube/search que
// la web pide en su propio origen. El respaldo yt-dlp puede no estar disponible en Netlify (youtube-dl-exec va como
// módulo externo y su require se captura): la ruta HTML cubre el caso normal; con Vercel de vuelta, respaldo completo.
import { handleSearch } from '../../frontend/web/server/youtube-search.js';
import { markYoutube } from '../../frontend/web/server/youtube-mark.js';

export const config = { path: '/api/youtube/search' };

export default async function (request) {
  return markYoutube(await handleSearch(request));
}
