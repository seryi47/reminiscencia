// Función de Vercel: página que cierra el login de Spotify (ADR-0044). El Redirect URI registrado apunta al Worker
// (cometia), así que en la práctica el callback lo sirve el Worker; esto existe por paridad si la web se sirve en Vercel.
import { handleSpotifyCallback } from '../../server/spotify-endpoints.js';

export function GET() { return handleSpotifyCallback(); }
