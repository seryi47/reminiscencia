// Función de Vercel: metadatos de vídeos y playlists de YouTube (ADR-0019, ADR-0021). La lógica está en
// server/youtube-playlist.js; aquí solo se marca la respuesta (ADR-0038) para que el Worker sepa que Vercel está en pie
// al reenviar /api/youtube/playlist.
import { handlePlaylist } from '../../server/youtube-playlist.js';
import { markYoutube } from '../../server/youtube-mark.js';

export async function GET(request) {
  return markYoutube(await handlePlaylist(request));
}

export { handlePlaylist };
