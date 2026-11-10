// Función de Netlify: metadatos de vídeos y playlists de YouTube mientras Vercel está bloqueado (ADR-0038).
//
// Adaptador fino sobre el mismo núcleo (frontend/web/server/youtube-playlist.js) que usan Vercel y el Worker. Solo marca
// la respuesta con la cabecera-marca para que el Worker sepa que Netlify está en pie al reenviar /api/youtube/playlist.
// Como en la búsqueda, el respaldo yt-dlp puede faltar en Netlify; oEmbed/YouTube Music/HTML cubren el caso normal.
import { handlePlaylist } from '../../frontend/web/server/youtube-playlist.js';
import { markYoutube } from '../../frontend/web/server/youtube-mark.js';

export const config = { path: '/api/youtube/playlist' };

export default async function (request) {
  return markYoutube(await handlePlaylist(request));
}
