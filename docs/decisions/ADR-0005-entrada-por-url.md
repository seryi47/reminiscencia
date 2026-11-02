# ADR-0005: Entrada de audio por URL, restringida a fuentes con licencia

- Estado: aceptada
- Fecha: 2026-10-31
- Modifica: ADR-0002 (la regla general se mantiene; se añade una vía controlada)
- Nota de estado (2026-10-31): **administración retirada.** La entrada por URL ya no pasa por `/admin/`: cada petición va en una incidencia con la etiqueta `biblioteca` (ADR-0008), desde la sección «Gestionar» de la web o a mano, y la procesa el workflow `biblioteca.yml`. Las reglas de esta decisión siguen vigentes. La sección «Actualización» de abajo queda superada.

## Contexto

El usuario quiere pegar una URL y que el sistema obtenga el audio. Una URL de YouTube o de un servicio de streaming no garantiza que el contenido pueda copiarse ni publicarse. Además, la web pública ya sirve audio: cualquier pista que no tenga licencia quedaría expuesta al público.

## Decisión

1. **Plataformas bloqueadas por código.** YouTube, Spotify, Apple Music, SoundCloud, Vimeo, TikTok, Instagram, Facebook, Bandcamp, Deezer, Tidal, Mixcloud, Dailymotion y Twitch se rechazan antes de cualquier descarga, y también los dominios de sus ficheros (CDN, por ejemplo `sndcdn.com`, `dzcdn.net` o `bcbits.com`), incluidos como destino de una redirección. La lista completa está en `backend/sonidos/sources.py`. Sus condiciones de uso no permiten descargar el contenido y la mayoría de la música que alojan tiene derechos de autor.
2. **Internet Archive, con licencia en los metadatos.** Se acepta una URL `archive.org/details/<id>` sólo si el ítem declara una licencia reconocida (dominio público o Creative Commons). La licencia se toma del propio ítem. Si no tiene licencia reconocida, se rechaza. Un fichero servido desde un servidor de Internet Archive (`*.archive.org`, como `ia800100.us.archive.org`) no se acepta como fichero directo: su licencia está en el ítem.
3. **Fichero de audio directo, con licencia declarada por el usuario.** Se acepta una URL que apunte directamente a un fichero de audio (`.mp3`, `.flac`, `.ogg`, `.opus`, `.m4a`, `.wav`) sólo si el usuario indica la licencia. El sistema no puede verificarla, así que la responsabilidad es del usuario y queda registrada en la biblioteca.
4. **Cualquier otra URL se rechaza** con un mensaje explicativo.
5. **Límite de tamaño de descarga** (200 MB) y descarga a un directorio de trabajo, nunca al repositorio.

## Consecuencias

- No se implementa ninguna extracción desde plataformas de vídeo ni de streaming, ni siquiera para uso privado. Si el usuario necesita música de esas plataformas, la vía legal es comprar o licenciar esa música, o usar un fichero propio con licencia.
- Cualquier pista publicada en la web pública debe tener licencia registrada. La publicación es un paso separado que el usuario aprueba.
- La regla es fácil de auditar: la lista de plataformas bloqueadas y las licencias aceptadas están en `backend/sonidos/sources.py`, con pruebas.

## Pendiente de dictamen legal

- Si la licencia declarada por el depositante en Internet Archive es suficiente para publicar la grabación en Europa. Para grabaciones antiguas puede depender de la fecha de fijación y del país.

## Actualización (2026-10-31)

El panel local con API se retiró. La entrada por URL ahora pasa por `/admin/` (Vercel), que valida la dirección, y la importación real corre en el workflow `library` de GitHub Actions (`backend/sonidos/pipeline.py`). La lista de plataformas bloqueadas está duplicada a propósito en `backend/sonidos/sources.py` y en `frontend/web/lib/validate.js`; si se cambia una, hay que cambiar la otra.
