# ADR-0021: Buscar en YouTube desde el buscador

- Estado: aceptada; implementada en la web y en la APK. Escuchar en la APK está pendiente de validar en un móvil real.
- Fecha: 2026-11-05.
- Relacionadas: ADR-0017 (subida para todos), ADR-0019 (playlists con álbum y artista), ADR-0020 (R2 y CSP).

## Contexto

Hasta ahora, para añadir una canción de YouTube había que salir del buscador, encontrar su URL y pegarla en «Homeostasia». Se quiere que, si la canción no está en la biblioteca, la persona pueda localizarla, escucharla y descargarla sin salir de Buscar.

## Decisión

1. **Orden.** Buscar sigue mostrando primero la biblioteca. Debajo aparece la sección «En YouTube». Si la biblioteca no tiene ninguna canción que coincida, la búsqueda en YouTube es automática (con espera de 700 ms tras la última tecla y mínimo 3 letras). Si tiene alguna, solo aparece el botón «Buscar «…» en YouTube», para no gastar consultas de más.
2. **Servidor.** `GET /api/youtube/search?q=` (`frontend/web/api/youtube/search.js`, lógica en `server/youtube-search.js`) devuelve hasta 8 vídeos `{id, url, title, artist, durationS}`. Lee primero la página de resultados de YouTube y, si falla, usa `yt-dlp` (`ytsearch`). Descarta vídeos de más de 20 minutos, sin duración o con id no válido. El artista sale del canal (sin « - Topic»). Caché de 1 hora en el borde.
3. **Descargar.** Es exactamente el flujo de pegar la URL en Homeostasia: el proxy de playlists lee título y artista, se convierte a WAV y se entrega a la cola de subidas, que pasa a Opus y publica en la biblioteca (ADR-0017). Web: `importYoutubeVideo` en `js/views/homeostasia.js`. APK: `YoutubeImporter.importPlaylist` y `uploadShared`, como `_importYoutube`. Un vídeo ya hecho o en marcha no se repite.
4. **Escuchar.** Reproduce al momento y además inicia la descarga (si no estaba ya en marcha).
   - Web: reproductor incrustado de `youtube-nocookie.com` en un iframe (la CSP añade `frame-src https://www.youtube-nocookie.com`); se pausa la música propia y solo hay un vídeo abierto a la vez.
   - APK: el teléfono resuelve un flujo de audio con `youtube_explode_dart` (`lib/youtube_stream.dart`) y lo reproduce por la cola normal con `PlaybackPort.playStream`, con notificación y controles. La biblioteca no se toca hasta que la descarga se publique.

## Consecuencias y riesgos

- Reproducir y descargar de YouTube va contra sus condiciones de servicio. Es la misma vía que ya usa Homeostasia (ADR-0019) y la asume el proyecto; no se usa para nada comercial.
- La búsqueda y yt-dlp pueden fallar desde las IP de Vercel si YouTube las bloquea; la sección muestra el error con «Reintentar» y el resto del buscador no se ve afectado.
- `youtube_explode_dart` depende de cómo cambie YouTube; si falla, la APK avisa y recomienda «Descargar». No se ha podido probar «Escuchar» de la APK en un dispositivo real desde el entorno de desarrollo.
- Sin conexión, la web no busca y lo dice.
