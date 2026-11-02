# ADR-0005: Entrada de audio por URL, restringida a fuentes con licencia

- Estado: aceptada
- Fecha: 2026-10-31
- Última revisión: 2026-11-02 (texto ajustado al código de main, commit b3daf9f)
- Modifica: ADR-0002 (la regla general se mantiene; se añade una vía controlada)
- Nota de estado (2026-11-02): la entrada por URL se hace con una petición en una incidencia del repositorio, procesada por el workflow `biblioteca.yml` (ADR-0008). Las reglas de esta decisión siguen vigentes. La validación vive en `backend/sonidos/sources.py`, `backend/sonidos/intake.py` y `backend/sonidos/issue_request.py`, y la web la repite en `frontend/web/js/intake.js`.

## Contexto

El usuario quiere pegar una URL y que el sistema obtenga el audio. Una URL de YouTube o de un servicio de streaming no garantiza que el contenido pueda copiarse ni publicarse. Además, la web pública ya sirve audio: cualquier pista que no tenga licencia quedaría expuesta al público.

## Decisión

1. **Plataformas bloqueadas por código.** YouTube, Spotify, Apple Music, SoundCloud, Vimeo, TikTok, Instagram, Facebook, Bandcamp, Deezer, Tidal, Mixcloud, Dailymotion y Twitch se rechazan antes de cualquier descarga. También se rechazan los dominios de sus ficheros (CDN, por ejemplo `sndcdn.com`, `dzcdn.net` o `bcbits.com`), incluidos como destino de una redirección. La lista también cubre X (`x.com`, `twitter.com`, `twimg.com`), Reddit (`reddit.com`, `redd.it`), Rumble (`rumble.com`) y los acortadores `dai.ly`, `fb.watch` e `instagr.am`. `BLOCKED_HOSTS` en `backend/sonidos/sources.py` tiene **42 entradas**. La lista de `frontend/web/js/intake.js` tiene las mismas 42, porque la web no puede aceptar más de lo que acepta el backend (ADR-0008). Sus condiciones de uso no permiten descargar el contenido y la mayoría de la música que alojan tiene derechos de autor.
2. **Internet Archive, con licencia en los metadatos.** Se acepta una URL `archive.org/details/<identificador>` o `archive.org/download/<identificador>`, pero solo la forma de ítem: un fichero concreto dentro de `archive.org/download/<identificador>/<fichero>` se rechaza. Se acepta solo si el ítem declara una licencia reconocida en sus metadatos (`licenseurl`, que tiene que apuntar a creativecommons.org). La licencia se toma del propio ítem. Las licencias aceptadas (`IA_LICENSE_PATHS` en `sources.py`) son CC BY 4.0, CC BY-SA 4.0, CC BY-NC 4.0, CC BY-NC-SA 4.0, dominio público, CC0 1.0 y Public Domain Mark 1.0. Si el ítem no tiene una licencia reconocida, se rechaza.
   Un fichero servido desde un servidor de Internet Archive (`*.archive.org`, como `ia800100.us.archive.org`) no se acepta como fichero directo: su licencia está en el ítem. Dentro de la importación de un ítem, la descarga sí puede seguir la redirección a su servidor de ficheros. Una URL directa que redirige a un servidor de Internet Archive se rechaza.
3. **Fichero de audio directo, con licencia declarada por el usuario.** Se acepta una URL que apunte directamente a un fichero de audio (`.mp3`, `.flac`, `.ogg`, `.opus`, `.m4a`, `.wav`) sólo si el usuario indica la licencia. El sistema no puede verificarla, así que la responsabilidad es del usuario y queda registrada en la biblioteca.
4. **Cualquier otra URL se rechaza** con un mensaje explicativo.
5. **Límites y descarga segura.** El tamaño máximo de descarga es de **200 MiB** (`MAX_DOWNLOAD_BYTES` en `intake.py`; el mensaje al usuario dice «200 MB»). Los metadatos de Internet Archive tienen un límite de 10 MiB. La descarga va a un directorio de trabajo (`audio-library/staging/`, sin rastrear y borrado al terminar), nunca a `audio-library/audio/`. Se rechaza si el servidor no declara el tamaño ni usa codificación por trozos, y si la descarga se corta. No se usan proxies del entorno. No se descarga de direcciones de bucle local, de red privada ni de enlace local (metadatos de la nube), tampoco por redirección.
6. **Dónde se comprueba cada cosa.** La web (`frontend/web/js/cuidador/incidencias.js`; antes `js/intake.js`, que sigue en `main` sin uso en la app) valida la petición antes de abrir la incidencia: el esquema, la forma del host, las plataformas bloqueadas, la forma de los ítems de Internet Archive, los servidores de ficheros de Internet Archive y las direcciones IP escritas en la URL que son privadas o de bucle local. **La web no resuelve nombres de dominio.** La comprobación de direcciones privadas por nombre la hace el backend al conectar (`resolve_public` y `_connect_public` en `intake.py`): cada conexión valida la dirección a la que conecta, también en cada redirección. Esa es la garantía real.

## Consecuencias

- No se implementa ninguna extracción desde plataformas de vídeo ni de streaming, ni siquiera para uso privado. Si el usuario necesita música de esas plataformas, la vía legal es comprar o licenciar esa música, o usar un fichero propio con licencia.
- Cualquier pista publicada en la web pública debe tener licencia registrada. La publicación es un paso separado que el usuario aprueba (la operación `edit_song` con `public`, ADR-0008).
- La regla es fácil de auditar: la lista de plataformas bloqueadas (42 entradas, la misma en la web) y las licencias aceptadas están en `backend/sonidos/sources.py`, con pruebas en `backend/tests/test_sources.py`.

## Pendiente de dictamen legal

- Si la licencia declarada por el depositante en Internet Archive es suficiente para publicar la grabación en Europa. Para grabaciones antiguas puede depender de la fecha de fijación y del país.
