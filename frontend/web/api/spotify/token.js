// Función de Vercel: cambia el código de OAuth por un token de Spotify (ADR-0044).
import { handleSpotifyToken } from '../../server/spotify-endpoints.js';

export function POST(request) { return handleSpotifyToken(request, { env: process.env }); }
