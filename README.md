# Reminiscencia · doctorado sobre música, memoria y Alzheimer

Proyecto doctoral y plataforma para estudiar y acompañar la relación entre la música, la memoria autobiográfica y el Alzheimer.

**Estado (2026-11-03):** la web pública y la app Android funcionan sin usuarios y con el aspecto de Spotify ([ADR-0015](docs/decisions/ADR-0015-interfaz-sin-usuarios-aspecto-spotify.md)): no hay perfiles, modos paciente ni cuidador, PIN ni registro del estudio, y todos ven la misma biblioteca, hoy con 10 canciones públicas (las privadas no se muestran). La biblioteca se gestiona con incidencias de GitHub (ADR-0008) y con el buzón de subida (ADR-0014), al que la web y la APK suben para todos con la función `/api/subir` (ADR-0017; probado en producción el 2026-11-03 con «Prueba subida directa.mp3», publicada como «Prueba subida directa» y despublicada después con la incidencia #21); no hay panel de administración. Las canciones y las carpetas (álbumes) tienen portada (ADR-0016), y el importador toma el artista y el año de Internet Archive. Pendiente: las 18 referencias abiertas de `BIBLIOGRAPHY.md` (no verificadas), decidir cómo se estudian las hipótesis sin el registro del estudio (ADR-0015) y los estudios con personas.

| Qué | Dónde |
|---|---|
| Escuchar (público) | https://reminiscencia.vercel.app |
| App Android | `mobile/` (lee la biblioteca de la web; versión 1.2.0+3) |
| Cambios en la biblioteca | Incidencias con la etiqueta `biblioteca`, procesadas por el workflow `biblioteca` |
| Subir canciones para todos | «Subir canciones» en la web o en la APK (función `/api/subir`), procesada por el workflow `buzon`; con permiso de escritura, también la página de subida de `audio-library/buzon/` |

## Cómo se usa la web

https://reminiscencia.vercel.app abre directamente en **Inicio** con la música. No hay cuentas ni hay que elegir nada: todos ven la misma biblioteca pública. Vercel sirve la carpeta `frontend/web/`, y los datos que lee son los que genera el repositorio (`data/` y `audio/`).

- **Inicio**: saludo, accesos rápidos y estantes con las carpetas, lo añadido y tus listas.
- **Buscar**: por título o artista, con «Explorar todo».
- **Tu biblioteca**: «Canciones que te gustan», tus listas, las carpetas y las canciones guardadas antes solo en este navegador.
- **Reproductor** (abajo; en el teléfono, minirreproductor y pantalla completa): reproducir, anterior, siguiente, aleatorio, repetir (no, toda la cola o una canción), volumen y «Añadir a la cola».
- **Sin conexión**: una carpeta o una lista se descarga desde su barra de acciones para escucharla sin internet.

Las listas y los «Me gusta» se guardan **solo en este navegador** (IndexedDB). No se sincronizan ni hay copia: en otro navegador o tras borrar los datos del sitio, no están. La copia cifrada `.rmc` de la versión anterior está retirada (ADR-0015). En la app Android, listas y «Me gusta» se guardan solo en el teléfono.

## Cómo subir canciones

El botón **Subir canciones** sube siempre **para todos** (ADR-0017): eliges uno o varios archivos (WAV, MP3, M4A, FLAC, OGG u OPUS), o un `.zip` con canciones, y no hay que hacer nada más. El ZIP no se sube: el navegador o el teléfono lo descomprime, saca cada canción (también de subcarpetas; ignora lo que no es audio) y la sube con el nombre de su archivo como título. No hace falta cuenta ni contraseña.

- Cada archivo se convierte a Opus en el propio navegador, para que pese poco, y se envía, de uno en uno y en orden, a la función de la web `/api/subir`, en trozos de hasta 4 MB. La hoja muestra el progreso y, por archivo, «Subida: llegará a todos en un par de minutos» o el error.
- El título de cada canción es el nombre del archivo sin la extensión (`Mi canción.mp3` pasa a «Mi canción»). Los caracteres que el buzón no admite (`:`, `/`, comillas...) se cambian por espacios; si el nombre ya está en el buzón, se añade « (2)».
- La función guarda los trozos en el buzón del repositorio (`audio-library/buzon/.partes/<id>/`) con un commit cada uno, y con el último escribe el manifiesto y la línea «Licencia: Subida desde la web pública; quien la sube declara tener derecho a publicarla». El workflow `buzon` une los trozos, convierte, cataloga y publica: la canción entra **pública** en la web y en la APK.
- **Al subir, declaras que tienes derecho a publicar estos archivos.** La web no lo comprueba. Lo subido queda en el historial de git aunque se retire después: no subas nada sin derechos ni grabaciones o datos de pacientes.
- No hay límite de subidas ni de tamaño por archivo; el buzón rechaza un archivo unido de más de 100 MiB (unas cuatro horas de Opus). Un navegador sin conversión a Opus (WebCodecs) no puede subir: usa Chrome o Edge actualizados.
- La función necesita la variable de entorno `GITHUB_TOKEN` en Vercel (token personal de una cuenta con permiso de escritura, con «Contents: write»). El token nunca llega al navegador. Sin ella, la hoja muestra que la subida no está configurada.

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

### Importar playlists propias de YouTube desde Homeostasia

Homeostasia conserva la cola existente de «Subir canciones»: tanto los archivos elegidos a mano como los WAV importados terminan en `ctx.addUploads`, se convierten a Ogg Opus, se envían por fragmentos a `/api/subir` y los publica el workflow `buzon`. La importación no crea una ruta alternativa de publicación.

La APK ofrece el mismo flujo desde `mobile/lib/ui/homeostasia.dart`: consulta los proxies `/api/youtube/*`, convierte y valida los WAV en el teléfono y después llama a `LibraryController.uploadShared`, de modo que también termina en `/api/subir` y en el workflow `buzon`.

El flujo de YouTube es:

1. El navegador valida una URL `https://www.youtube.com/playlist?list=...` y llama a `GET /api/youtube/playlist?url=...`.
2. La función serverless ejecuta `yt-dlp` con argumentos separados, `--flat-playlist` y un máximo de 200 elementos. Solo devuelve IDs y títulos; no descarga vídeos ni acepta URLs que no sean de YouTube.
3. El navegador encola como máximo cuatro trabajos a la vez. Las llamadas a `api.yttowav.org` pasan por `POST /api/youtube/convert`, `GET /api/youtube/status` y `GET /api/youtube/download`; el backend fija `format: wav` y `quality: original`, valida el identificador y transmite el WAV sin cargarlo completo en memoria.
4. Cada WAV debe tener cabecera RIFF/WAVE y contenido. Tras descargarlo se convierte en `File` y vuelve a la cola original. Los errores son por canción y se pueden reintentar.

Las funciones de proxy se encuentran en `frontend/web/api/youtube/`; `frontend/web/server/` contiene la lógica compartida fuera del directorio de rutas. La CSP sigue usando `connect-src 'self'`, por lo que el navegador no necesita CORS del servicio externo. El estado de trabajos encolados se conserva en `localStorage` y los WAV terminados antes de encolarlos en IndexedDB; la conversión solo se marca terminada después de descargar y validar el archivo, y la publicación sigue siendo un estado separado de la conversión.

Configuración del servidor:

- `YTDLP_PATH`: ruta absoluta al ejecutable `yt-dlp`; si no existe se intenta `yt-dlp` desde `PATH`. En producción debe instalarse o incluirse ese ejecutable en el runtime de Vercel. La función devuelve un error explícito si falta.
- No se necesita ninguna clave para yttowav en el frontend. `GITHUB_TOKEN` sigue siendo únicamente la variable de `/api/subir`.

La API externa de yttowav no publica una especificación estable de sus endpoints. El script original y la integración usan sus rutas observadas (`/api/convert`, `/api/status` y `/api/download/?jobId=...`), además de comprobar estados, identificadores, origen de descarga y cabecera WAV. La comprobación no destructiva observó HTTP 500 en el preflight `OPTIONS /api/convert` y HTTP 400 para un `jobId` deliberadamente inválido en `/api/status`. El proxy evita el preflight del navegador, pero no se creó ningún trabajo real: la conversión y descarga de WAV siguen pendientes de una prueba autorizada contra el servicio externo.

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
- `edit_song` también admite `title`, `artist`, `year`, `tags` y `folder_id`. Las carpetas se gestionan con `create_folder`, `rename_folder`, `edit_folder` y `delete_folder`. No hay borrado de canciones: hoy solo se despublican.
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
node scripts/smoke_produccion.mjs [url]
```

## Aviso

No se descarga música de plataformas de vídeo ni de streaming. Solo se importan grabaciones cuya licencia se declara o se lee de su ítem original (ADR-0002, ADR-0005). Los resultados clínicos no están demostrados (RESEARCH.md).
