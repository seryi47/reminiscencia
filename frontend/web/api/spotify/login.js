// Función de Vercel: arranca el login OAuth de Spotify (ADR-0044). Lógica en server/spotify-endpoints.js.
import { handleSpotifyLogin } from '../../server/spotify-endpoints.js';

export function POST(request) { return handleSpotifyLogin(request, { env: process.env }); }
export function GET(request) { return handleSpotifyLogin(request, { env: process.env }); }
