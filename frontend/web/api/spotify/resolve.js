// Función de Vercel: resuelve una colección de Spotify a candidatos de YouTube con confianza (ADR-0044). En Vercel hay
// yt-dlp, así que la búsqueda se hace en local (searchYoutubeCandidates), no por el upstream.
import { handleSpotifyResolve } from '../../server/spotify-endpoints.js';
import { searchCandidatesForTransfer } from '../../server/youtube-search.js';

export function POST(request) {
  // Candidatos de YouTube Music (oficiales) + búsqueda normal, para máxima precisión (ADR-0044).
  return handleSpotifyResolve(request, { search: (query) => searchCandidatesForTransfer(query, { env: process.env }) });
}
