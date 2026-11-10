// Función de Vercel: lista la biblioteca de Spotify del usuario (playlists + «Me gusta») para elegir qué transferir (ADR-0044).
import { handleSpotifyMine } from '../../server/spotify-endpoints.js';

export function POST(request) { return handleSpotifyMine(request, { env: process.env }); }
