// Función de Vercel: búsqueda en YouTube (ADR-0021). La lógica está en server/youtube-search.js; aquí solo se marca la
// respuesta con la cabecera-marca (ADR-0038) para que el Worker sepa que Vercel está en pie al reenviar /api/youtube/search.
import { handleSearch } from '../../server/youtube-search.js';
import { markYoutube } from '../../server/youtube-mark.js';

export async function GET(request) {
  return markYoutube(await handleSearch(request));
}

export { handleSearch };
