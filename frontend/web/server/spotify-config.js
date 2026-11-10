// Configuración de «Transferir música» (ADR-0044).
//
// El Client ID de Spotify es PÚBLICO: aparece en la URL de autorización que ve el navegador del usuario, así que no es
// una credencial secreta (con PKCE no hay secreto de cliente). Se puede sobreescribir con la variable de entorno
// SPOTIFY_CLIENT_ID (en Vercel) o el secreto del Worker, sin tocar el código.
//
// El Redirect URI es FIJO: es el único registrado en la app de Spotify. Tras el login, Spotify devuelve siempre a esta
// dirección (la sirve el Worker en el dominio propio, ADR-0034), que cambia el código por el token.
export const SPOTIFY_CLIENT_ID = 'cbf0af01b2e1415593923057e93bf48e';
export const SPOTIFY_REDIRECT_URI = 'https://reminiscencia.cometia.es/api/spotify/callback';

/** El Client ID efectivo: el de la variable de entorno si está, si no el público por defecto. */
export const spotifyClientId = (env = {}) => env.SPOTIFY_CLIENT_ID || SPOTIFY_CLIENT_ID;
