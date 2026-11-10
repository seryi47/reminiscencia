# Reminiscencia · doctorado sobre música, memoria y Alzheimer

Proyecto doctoral y plataforma para estudiar y acompañar la relación entre la música, la memoria autobiográfica y el Alzheimer.

**Estado (2026-11-04):** la web pública y la app Android funcionan sin usuarios y con el aspecto de Spotify ([ADR-0015](docs/decisions/ADR-0015-interfaz-sin-usuarios-aspecto-spotify.md)): no hay perfiles, modos paciente ni cuidador, PIN ni registro del estudio, y todos ven la misma biblioteca: 30 canciones catalogadas, 19 públicas y 11 privadas. Las privadas no se muestran. La biblioteca se gestiona con incidencias de GitHub (ADR-0008) y con el buzón de subida (ADR-0014), al que la web y la APK suben para todos con la función `/api/subir` (ADR-0017; probado en producción el 2026-11-03 con «Prueba subida directa.mp3», publicada como «Prueba subida directa» y despublicada después con la incidencia #21); no hay panel de administración. Las canciones y las carpetas (álbumes) tienen portada (ADR-0016). El álbum de YouTube «Nuestro desacato» agrupa las siete canciones de Desakato. La versión Android en `main` es 1.2.4+8; la release pública aún es 1.2.0 porque no están disponibles en GitHub Actions los secretos de firma de producción.

| Qué | Dónde |
|---|---|
| Escuchar (público) | https://reminiscencia.cometia.es (Cloudflare, ADR-0034), https://reminiscencia.netlify.app (Netlify, segunda dirección mientras Vercel está bloqueado; ADR-0037) y https://reminiscencia.vercel.app (bloqueada por Vercel hasta el 2026-12-07) |
| App Android | `mobile/` (lee la biblioteca de la web; versión 1.2.6+10) |
| Cambios en la biblioteca | Incidencias con la etiqueta `biblioteca`, procesadas por el workflow `biblioteca` |
| Subir canciones para todos | «Subir canciones» en la web o en la APK (función `/api/subir`), procesada por el workflow `buzon`; con permiso de escritura, también la página de subida de `audio-library/buzon/` |

## Cómo se usa la web

https://reminiscencia.cometia.es abre directamente en **Inicio** con la música. No hay cuentas ni hay que elegir nada: todos ven la misma biblioteca pública. El Worker de Cloudflare sirve la carpeta `frontend/web/` ([ADR-0034](docs/decisions/ADR-0034-web-en-cloudflare.md); también Vercel, en https://reminiscencia.vercel.app, cuando no está bloqueado), y los datos que lee son los que genera el repositorio (`data/`). El audio lo sirve el Worker de Cloudflare desde el bucket de R2, con `r2.dev` de respaldo: en Cloudflare es el mismo origen y Vercel redirige `/audio/<id>.opus` al Worker ([ADR-0020](docs/decisions/ADR-0020-audio-en-r2.md) y [ADR-0031](docs/decisions/ADR-0031-audio-por-el-worker.md)).

- **Inicio**: saludo, accesos rápidos y estantes con las carpetas, lo añadido y tus listas.
- **Buscar**: por título, artista, álbum, año y etiquetas, sin tildes ni mayúsculas, con una errata permitida en palabras de 4 letras o más y lo más parecido primero (ADR-0028), con «Explorar todo»; si la canción no está, también en YouTube con «Escuchar» y «Descargar» (ADR-0021).
- **Tu biblioteca**: «Canciones que te gustan», tus listas, las carpetas y las canciones guardadas antes solo en este navegador.
- **Reproductor** (abajo; en el teléfono, minirreproductor y pantalla completa): reproducir, anterior, siguiente, aleatorio, repetir (no, toda la cola o una canción), volumen y «Añadir a la cola».
- **Sin conexión**: una carpeta o una lista se descarga desde su barra de acciones para escucharla sin internet.

Las listas y los «Me gusta» se guardan **solo en este navegador** (IndexedDB). No se sincronizan ni hay copia: en otro navegador o tras borrar los datos del sitio, no están. La copia cifrada `.rmc` de la versión anterior está retirada (ADR-0015). En la app Android, listas y «Me gusta» se guardan solo en el teléfono.

## Cómo subir canciones

El botón **Subir canciones** sube siempre **para todos** (ADR-0017): eliges uno o varios archivos (WAV, MP3, M4A, FLAC, OGG u OPUS), o un `.zip` con canciones, y no hay que hacer nada más. El ZIP no se sube: el navegador o el teléfono lo descomprime, saca cada canción (también de subcarpetas; ignora lo que no es audio) y la sube con el nombre de su archivo como título. No hace falta cuenta ni contraseña.

- Cada archivo se convierte a Opus en el propio navegador, para que pese poco, y se envía, de uno en uno y en orden, a la función de la web `/api/subir`, en trozos de hasta 4 MB. La hoja muestra el progreso y, por archivo, «Subida: llegará a todos en un par de minutos» o el error.
- El título de cada canción es el nombre del archivo sin la extensión, limpio: sin etiquetas como «(Official Video)» o «(Letra)» ni lo que va detrás, sin número de pista y, si es «Artista - Título», con el artista aparte (`Bad Bunny - Monaco (Official Video).mp3` pasa a «Monaco» de «Bad Bunny»; ADR-0032). Los caracteres que el buzón no admite (`:`, `/`, comillas...) se cambian por espacios; si el nombre ya está en el buzón, se añade « (2)».
- Mientras se envía un archivo ya se convierte el siguiente, y van hasta dos a la vez (ADR-0030). El API puede servirlo un Worker de Cloudflare (`worker/`, ADR-0029), con trozos de 32 MB y portadas que se ven al momento; hasta desplegarlo y poner su dirección en `js/api-config.js` y `lib/api_config.dart`, todo sigue por Vercel.
- La función guarda los trozos en el bucket privado de Cloudflare R2 (`entrada/<id>/`) y, con el último, el manifiesto; después lanza el workflow `buzon` (un `repository_dispatch`), que la publica con la licencia de la web. Ya no hace commits en `main` ([ADR-0024](docs/decisions/ADR-0024-audio-privado-en-r2.md)).
- **Al subir, declaras que tienes derecho a publicar estos archivos.** La web no lo comprueba. Lo subido queda guardado (en el bucket privado de R2 y, lo de antes de ADR-0024, en el historial de git) aunque se retire después: no subas nada sin derechos ni grabaciones o datos de pacientes.
- No hay límite de subidas ni de tamaño por archivo; el buzón rechaza un archivo unido de más de 100 MiB (unas cuatro horas de Opus). Un navegador sin conversión a Opus (WebCodecs) no puede subir: usa Chrome o Edge actualizados.
- La función necesita en Vercel `GITHUB_TOKEN` (con «Contents: write», solo para lanzar el workflow) y las claves de R2: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` y `R2_PRIVATE_BUCKET`. Sin ellas responde 500 con un mensaje claro.

Las canciones que se guardaron antes **solo en este navegador** (ADR-0012) siguen sonando en Tu biblioteca y se borran desde la hoja, en «Guardadas solo en este navegador», o desde el menú de su fila. La app Android usa la misma función `/api/subir` (ADR-0017): convierte a Opus en el teléfono y envía los mismos trozos; las canciones subidas antes «Solo en este teléfono» (ADR-0013) siguen sonando y se pueden borrar.

### Desde GitHub (con permiso de escritura)

Quien tiene **permiso de escritura en el repositorio** puede seguir subiendo al buzón desde GitHub (ADR-0014), por ejemplo para declarar otra licencia:

1. Abre la página de subida del buzón: https://github.com/seryi47/reminiscencia/upload/main/audio-library/buzon
2. Arrastra los archivos: WAV, MP3, M4A, FLAC, OGG u OPUS. El título de cada canción será el nombre del archivo sin la extensión. También vale un `.zip` con canciones, aunque estén en subcarpetas (ver abajo).
3. En la descripción del commit, escribe una línea con la licencia:

   ```
   Licencia: CC BY 4.0
   ```

4. Elige «Commit directly to the main branch» y pulsa «Commit changes».

El workflow `buzon` convierte cada archivo a Opus, lo añade al catálogo, regenera la parte pública y lo borra del buzón. Con la línea `Licencia:`, las canciones entran **públicas** con esa licencia y la fuente «Subida por <tu cuenta>». Sin ella, entran **privadas** y el resumen de la ejecución lo indica; para publicarlas, sube otra vez el mismo archivo con la línea `Licencia:`. **Quien sube responde de la licencia que declara.**

Si una ejecución no llega a procesar lo subido, quien tenga permiso de escritura puede lanzar el workflow `buzon` a mano desde Actions; lo que procesa así entra **privado**, porque no hay mensaje de commit del que leer la licencia. Excepción: las subidas por trozos de la web completas entran públicas con la licencia de la web (ADR-0017).

Un **ZIP** se descomprime fuera del repositorio, entrada a entrada, y cada canción que contiene (WAV, MP3, M4A, FLAC, OGG u OPUS, también en subcarpetas) se procesa como un archivo del buzón, con la licencia del commit; su título es el nombre de su archivo sin carpeta ni extensión (`Disco/Cara A/01 Vals.mp3` pasa a «01 Vals»). Después se borra el ZIP del buzón. Las carpetas, lo de `__MACOSX/`, los ocultos, los enlaces simbólicos, lo que no es audio y las rutas absolutas o con `..` se ignoran y se cuentan en el resumen. Un ZIP con contraseña o dañado se rechaza entero, sin catalogar nada, y se borra. El ZIP no tiene límite de tamaño, aunque el navegador de GitHub no admite más de 25 MiB por archivo.

Se rechazan, y se borran del buzón, los archivos que no son de audio y los de más de 100 MiB. Los enlaces simbólicos, las subcarpetas y los nombres con caracteres raros se quedan en el buzón para revisarlos a mano. El resultado está en la pestaña Actions, en el resumen de la ejecución `buzon`.

Ten en cuenta:
- Desde el navegador, GitHub admite hasta 25 MiB por archivo. Usa MP3 o FLAC antes que WAV: cuatro minutos de WAV ocupan unos 42 MB.
- Lo que se sube queda en el historial de git aunque se borre del buzón. No subas nada sin derecho a usarlo ni datos de pacientes.

#### Portadas de canciones y de álbumes

Las portadas se suben al mismo buzón, en su carpeta `portadas` (ADR-0016): https://github.com/seryi47/reminiscencia/upload/main/audio-library/buzon/portadas

- El nombre del archivo es el id de la canción (`S` seguida de 16 caracteres hexadecimales) o de la carpeta (`F` seguida de 16) y la extensión `.jpg`, `.jpeg`, `.png` o `.webp`; por ejemplo, `S5aac103b6eb2ecf4.jpg`. Los ids están en `audio-library/indexes/catalog.json`.
- Hasta 10 MB por imagen. No hace falta línea de licencia, pero sí permiso de escritura.
- El workflow `buzon` la recorta al centro, la convierte a un JPEG de 640×640 sin metadatos y la guarda en `audio-library/covers/<id>.jpg`; la web y la APK la ven en `covers/<id>.jpg` si la canción es pública, o siempre si es de una carpeta. Subir otra imagen con el mismo nombre la sustituye.
- Si el id no existe o la imagen no es válida, se rechaza, se borra del buzón y el motivo sale en el resumen de la ejecución.
- Sube solo portadas que puedas usar: quedan en el historial de git y, las públicas, en la web. Nunca fotografías de pacientes ni de otras personas.

### Importar vídeos y playlists públicas de YouTube desde Homeostasia

Homeostasia sirve para importar vídeos o playlists públicas y accesibles de YouTube. Quien importa debe tener derecho a publicar el audio: que una playlist sea pública no significa que tenga licencia. La subida manual de archivos está en su opción independiente, «Subir canciones». Los WAV importados terminan en `ctx.addUploads`, se convierten a Ogg Opus, se envían por fragmentos a `/api/subir` y los publica el workflow `buzon`; la importación no crea una ruta alternativa de publicación.

Las funciones `/api/youtube/*` siguen en Vercel; en https://reminiscencia.cometia.es el Worker se las reenvía tal cual (ADR-0034), así que no funcionan mientras Vercel esté bloqueado. La APK ofrece el mismo flujo desde `mobile/lib/ui/homeostasia.dart`: consulta los proxies `/api/youtube/*`, convierte y valida los WAV en el teléfono y después llama a `LibraryController.uploadShared`, de modo que también termina en `/api/subir` y en el workflow `buzon`. Ambas interfaces limitan las creaciones a una cada dos segundos, reintentan errores transitorios de creación hasta seis veces respetando `Retry-After`, reintentan cinco errores temporales de consulta de estado, muestran la posición y el progreso de la cola externa, y envían un UUID de traza para diagnóstico sin registrar datos de la canción.

El flujo de YouTube es:

1. La interfaz valida una URL HTTPS de un vídeo o playlist de YouTube y llama a `GET /api/youtube/playlist?url=...`.
2. Para una playlist, la función serverless ejecuta `yt-dlp` con argumentos separados, `--flat-playlist` y un máximo de 200 elementos. Completa el artista de cada vídeo con YouTube Music, asociando por ID; si falla o no obtiene el nombre, usa la página y la navegación de YouTube Music (incluidas las continuaciones) y, como último respaldo, el HTML público de YouTube. Devuelve el título original, artista e ID de vídeo; si no puede leer el título, devuelve un error en vez de iniciar una importación con el ID como nombre. Para un vídeo individual, obtiene el título original de oEmbed y usa los metadatos de la página pública y `yt-dlp` como alternativas. No descarga audio en este paso ni acepta URLs que no sean de YouTube.
3. El navegador encola como máximo cuatro trabajos a la vez, separa dos segundos la creación de cada trabajo para evitar ráfagas y reintenta errores transitorios hasta seis veces con espera exponencial, respetando `Retry-After`. Las llamadas a `api.yttowav.org` pasan por `POST /api/youtube/convert`, `GET /api/youtube/status` y `GET /api/youtube/download`; el backend fija `format: wav` y `quality: original`, valida el identificador y transmite el WAV sin cargarlo completo en memoria. Si yttowav rechaza una creación, la interfaz recibe el código HTTP y el mensaje de error seguro del proveedor.
4. Cada WAV debe tener cabecera RIFF/WAVE y contenido. Tras descargarlo se convierte en `File` y vuelve a la cola original. Los errores son por canción y se pueden reintentar.
5. Si la entrada es una playlist, su nombre y el artista de cada canción se propagan en cada subida y el workflow crea o reutiliza un álbum con ese nombre. Todas sus canciones quedan asociadas al mismo álbum y artista; si todas comparten artista, el álbum también lo muestra. La web y la APK leen el mismo catálogo publicado. Los vídeos individuales no crean álbum. La metadata viaja en el manifiesto de `/api/subir`; las subidas manuales siguen sin cambios (ADR-0019).

Las funciones de proxy se encuentran en `frontend/web/api/youtube/`; `frontend/web/server/` contiene la lógica compartida fuera del directorio de rutas. La CSP sigue usando `connect-src 'self'`, por lo que el navegador no necesita CORS del servicio externo. La web guarda en `localStorage` el identificador del trabajo externo y su traza; Android los guarda en `SharedPreferences`. Al volver a importar el mismo vídeo se consulta el trabajo existente en lugar de crear otro. Si el proveedor responde que ya no existe (404), se olvida y el siguiente intento puede crear uno nuevo. «Detener seguimiento» o cerrar la hoja detiene las consultas del cliente, pero no cancela el trabajo en yttowav; no se ha encontrado una ruta pública de cancelación. Los WAV terminados antes de encolarlos se conservan en IndexedDB en la web; la conversión solo se marca terminada después de descargar y validar el archivo, y la publicación sigue siendo un estado separado de la conversión. Decisión: [ADR-0018](docs/decisions/ADR-0018-seguimiento-trabajos-youtube.md).

Configuración del servidor:

- `YTDLP_PATH`: ruta absoluta al ejecutable `yt-dlp`; si no existe se intenta `yt-dlp` desde `PATH`. Se usa como fuente principal; si no está disponible, la playlist intenta recuperarse desde YouTube Music y el HTML público. Configurarlo en Vercel sigue siendo recomendable; si ninguna fuente puede leer la playlist, la función devuelve un error explícito.
- No se necesita ninguna clave para yttowav en el frontend. `GITHUB_TOKEN` sigue siendo únicamente la variable de `/api/subir`.

La API externa de yttowav no publica una especificación estable de sus endpoints. El script original y la integración usan sus rutas observadas (`/api/convert`, `/api/status` y `/api/download/?jobId=...`), además de comprobar estados, identificadores, origen de descarga y cabecera WAV. En la prueba real del 2026-11-03, una conversión pasó por la cola, descargó el WAV y se publicó en la biblioteca; cuatro respuestas 502 temporales de estado fueron seguidas por respuestas correctas para el mismo trabajo. El WAV se decodificó completo con FFmpeg y el audio publicado se reprodujo en Chrome de escritorio, también mediante una respuesta parcial HTTP 206. La escucha en un dispositivo Android real sigue pendiente; el error del navegador integrado de VS Code también apareció con una canción anterior del catálogo. La importación de playlists como álbum está descrita en [ADR-0019](docs/decisions/ADR-0019-playlists-de-youtube-como-albumes.md); el despliegue y la reparación de «Nuestro desacato» quedaron verificados en producción: sus siete canciones muestran el artista y el álbum correctos.

### Importar desde Internet Archive

En la hoja, «Importar desde Internet Archive». Para importar un ítem de Internet Archive con licencia (o un fichero de audio directo con licencia declarada). La hoja valida la dirección en el navegador, con la misma lista de bloqueo de 42 plataformas que el backend, y abre en GitHub una incidencia nueva con la etiqueta `biblioteca` y el texto ya escrito; hay que pulsar «Submit new issue» para enviarla. Solo se procesan las incidencias de cuentas con permiso de escritura (job `autorizar`). La canción entra **privada** hasta que se publica por incidencia (abajo). Por esta vía de incidencias no se admiten YouTube ni las plataformas de streaming.

## Cambios en la biblioteca por incidencia

Publicar, despublicar, editar y organizar carpetas se hace escribiendo la incidencia a mano: la web ya no tiene la hoja «Gestionar la biblioteca» del antiguo modo cuidador (ADR-0015, decisión 10). Cada cambio en la biblioteca es una petición: una incidencia con la etiqueta **biblioteca** cuyo cuerpo tiene líneas `clave: valor`. Las claves son `action`, `url`, `license`, `title` y `payload`. El formato completo está en [ADR-0008](docs/decisions/ADR-0008-entrada-por-incidencias.md).

### Añadir una canción

1. Abre una incidencia con la etiqueta **biblioteca** ya puesta. El workflow se lanza al abrir la incidencia: si la etiqueta se añade después, no se procesa.
2. En el cuerpo, escribe:

   ```
   action: import
   url: https://archive.org/details/<identificador-del-ítem>
   ```

   También se admite `archive.org/download/<identificador-del-ítem>`.
3. Para un fichero de audio directo, fuera de Internet Archive, `license:` es obligatoria y debe declarar la licencia. Las URLs de YouTube y de plataformas de streaming no se admiten en las incidencias de importación.

Las canciones nuevas quedan **privadas** hasta que las publicas.

### Publicar, despublicar o editar

Abre otra incidencia con la etiqueta **biblioteca** y un `payload` JSON en una sola línea. `action: organize` no admite las claves `url`, `license` ni `title`:

```
action: organize
payload: {"op":"edit_song","song_id":"S<16 caracteres hexadecimales>","public":true}
```

- `"public":true` publica la canción; `"public":false` la despublica. Son booleanos JSON, no texto.
- Los identificadores tienen la forma `S` seguida de 16 caracteres hexadecimales, y están en `audio-library/indexes/catalog.json`.
- `edit_song` también admite `title`, `artist`, `year`, `tags` y `folder_id`. Las carpetas se gestionan con `create_folder`, `rename_folder`, `edit_folder` y `delete_folder`. Para pasar varias canciones a un álbum (o sacarlas de su álbum con `"folder_id":null`) en una sola petición: `{"op":"move_songs","song_ids":["S…","S…"],"folder_id":"F…"}`, de 1 a 100 canciones sin repetir; o se mueven todas o ninguna ([ADR-0023](docs/decisions/ADR-0023-canciones-de-un-album.md)). Para ordenar un álbum: `{"op":"order_album","folder_id":"F…","song_ids":[…]}` con la lista completa y exacta de sus canciones en el orden nuevo (de 1 a 190); si no coincide con el álbum, no cambia nada ([ADR-0026](docs/decisions/ADR-0026-albumes-orden-seleccion-duplicados.md)). Cada canción con álbum lleva su número de pista `track` en `data/songs.json`. Para asignar de una vez una playlist de YouTube ya catalogada, `organize_youtube_playlist` recibe su `playlist_id`, `name` y una lista `songs` con `{song_id, artist}` por canción. No hay borrado de canciones: hoy solo se despublican. Para limpiar títulos y artistas (etiquetas de YouTube, «Artista - Título», canales): `{"op":"clean_titles"}` para todas o con `"song_ids":[…]` (de 1 a 100); antes, `python3 scripts/vista_previa_titulos.py` muestra qué cambiaría ([ADR-0032](docs/decisions/ADR-0032-titulos-limpios.md)).
- Una carpeta es también un álbum, con artista opcional (ADR-0016): `{"op":"create_folder","name":"Boleros","artist":"Antonio Machín"}` o `{"op":"edit_folder","folder_id":"F<16 caracteres hexadecimales>","name":"Boleros","artist":"Antonio Machín"}`. `name` tiene de 1 a 80 caracteres y `artist`, de 0 a 80 (vacío lo quita), los dos en una línea. Las carpetas nuevas tienen ids `F` seguida de 16 caracteres hexadecimales; las anteriores, de 10, siguen valiendo.

### Qué pasa después

El workflow `biblioteca` valida la petición, aplica el cambio al catálogo, guarda el resultado en `main` y responde en la incidencia. Si todo sale bien, la cierra. Si algo falla, le añade la etiqueta `error` y la deja abierta. En la prueba real del 2 de noviembre de 2026 (incidencias #1 a #3), cada petición tardó menos de dos minutos. La web se actualiza cuando Vercel despliega `main`.

## Documentación

- [CLAUDE.md](CLAUDE.md): reglas de trabajo, restricciones y arquitectura.
- [PROJECT_MASTER.md](PROJECT_MASTER.md): estado completo del proyecto.
- [ROADMAP.md](ROADMAP.md) y [CHANGELOG.md](CHANGELOG.md): fases y cambios.
- [RESEARCH.md](RESEARCH.md), [ALZHEIMER_RESEARCH.md](ALZHEIMER_RESEARCH.md), [METHODOLOGY.md](METHODOLOGY.md), [BIBLIOGRAPHY.md](BIBLIOGRAPHY.md) y [SECURITY.md](SECURITY.md): investigación, referencias verificadas, seguridad y privacidad.
- [docs/decisions/](docs/decisions/): decisiones de arquitectura (ADR).
- [docs/user-experience/](docs/user-experience/): diseño de la interfaz y del reproductor.

## Pruebas

Backend:

```
cd backend
python3 -m venv .venv && ./.venv/bin/pip install -e ".[dev]"
./.venv/bin/python -m pytest -q
```

Web, desde la raíz:

```
node --test "tests/web-unit/*.test.mjs"
```

Extremo a extremo y de accesibilidad (necesitan Chrome; si no está en una ruta habitual, indicarla en `CHROME_PATH`):

```
cd tests/web-e2e && npm ci && npm test
```

Comprobador de la web pública tras cada cambio en `main` (antes, poner `main` al día con `origin/main`):

```
node scripts/smoke_produccion.mjs [url] [--concurrencia=N]
```

## Aviso

La importación por incidencias no admite YouTube ni plataformas de streaming. Homeostasia procesa vídeos o playlists accesibles de YouTube, pero quien los sube debe tener derecho a publicar el audio; que una playlist sea pública no equivale a una licencia. En las demás importaciones se declara o se lee la licencia del ítem original (ADR-0002, ADR-0005). Los resultados clínicos no están demostrados (RESEARCH.md).
