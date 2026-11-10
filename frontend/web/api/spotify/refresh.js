// Función de Vercel: refresca el token de Spotify (ADR-0044).
import { handleSpotifyRefresh } from '../../server/spotify-endpoints.js';

export function POST(request) { return handleSpotifyRefresh(request, { env: process.env }); }
