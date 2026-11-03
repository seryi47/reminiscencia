# Reminiscencia · doctorado sobre música, memoria y Alzheimer

Proyecto doctoral y plataforma para estudiar y acompañar la relación entre la música, la memoria autobiográfica y el Alzheimer.

**Estado (2026-11-03):** la web pública y la app Android funcionan sin usuarios y con el aspecto de Spotify ([ADR-0015](docs/decisions/ADR-0015-interfaz-sin-usuarios-aspecto-spotify.md)): no hay perfiles, modos paciente ni cuidador, PIN ni registro del estudio, y todos ven la misma biblioteca, hoy con 10 canciones públicas (las privadas no se muestran). La biblioteca se gestiona con incidencias de GitHub (ADR-0008) y con el buzón de subida (ADR-0014); no hay panel de administración. Pendiente: las 18 referencias abiertas de `BIBLIOGRAPHY.md` (no verificadas), decidir cómo se estudian las hipótesis sin el registro del estudio (ADR-0015) y los estudios con personas.

| Qué | Dónde |
|---|---|
| Escuchar (público) | https://reminiscencia.vercel.app |
| App Android | `mobile/` (lee la biblioteca de la web; versión 1.2.0+3) |
| Cambios en la biblioteca | Incidencias con la etiqueta `biblioteca`, procesadas por el workflow `biblioteca` |
| Subir canciones para todos | Página de subida de `audio-library/buzon/`, procesada por el workflow `buzon` |

## Cómo se usa la web

https://reminiscencia.vercel.app abre directamente en **Inicio** con la música. No hay cuentas ni hay que elegir nada: todos ven la misma biblioteca pública. Vercel sirve la carpeta `frontend/web/`, y los datos que lee son los que genera el repositorio (`data/` y `audio/`).

- **Inicio**: saludo, accesos rápidos y estantes con las carpetas, lo añadido y tus listas.
- **Buscar**: por título o artista, con «Explorar todo».
- **Tu biblioteca**: «Canciones que te gustan», tus listas, las carpetas y lo que has subido a este navegador.
- **Reproductor** (abajo; en el teléfono, minirreproductor y pantalla completa): reproducir, anterior, siguiente, aleatorio, repetir (no, toda la cola o una canción), volumen y «Añadir a la cola».
- **Sin conexión**: una carpeta o una lista se descarga desde su barra de acciones para escucharla sin internet.

Las listas y los «Me gusta» se guardan **solo en este navegador** (IndexedDB). No se sincronizan ni hay copia: en otro navegador o tras borrar los datos del sitio, no están. La copia cifrada `.rmc` de la versión anterior está retirada (ADR-0015). En la app Android, listas y «Me gusta» se guardan solo en el teléfono.

## Cómo subir canciones

El botón **Subir canciones** abre una hoja con tres caminos. Ninguno usa contraseñas ni tokens: los dos últimos solo abren GitHub en otra pestaña.

### Solo en este navegador

Elige archivos de tu dispositivo (WAV, MP3, M4A, OGG o FLAC; hasta 60 MB y 20 minutos cada uno). Se convierten a Opus en el propio navegador y se guardan solo en él: no se suben a ningún servidor ni van a GitHub, y nadie más las ve (ADR-0012). Aparecen en Tu biblioteca y se borran desde el menú de su fila; al borrarlas salen también de tus listas y de «Me gusta». La app Android tiene lo mismo como «Solo en este teléfono», con FFmpeg (ADR-0013).

### Para todos (buzón)

Para que una canción entre en la biblioteca pública y la vean la web y la APK. Hace falta **permiso de escritura en el repositorio**: la hoja de la web y la de la APK solo abren la página de subida de GitHub (ADR-0014).

1. Abre la página de subida del buzón: https://github.com/seryi47/reminiscencia/upload/main/audio-library/buzon
2. Arrastra los archivos: WAV, MP3, M4A, FLAC u OGG. El título de cada canción será el nombre del archivo sin la extensión (`Mi canción.mp3` pasa a «Mi canción»).
3. En la descripción del commit, escribe una línea con la licencia:

   ```
   Licencia: CC BY 4.0
   ```

4. Elige «Commit directly to the main branch» y pulsa «Commit changes».

El workflow `buzon` convierte cada archivo a Opus, lo añade al catálogo, regenera la parte pública y lo borra del buzón. Con la línea `Licencia:`, las canciones entran **públicas** con esa licencia y la fuente «Subida por <tu cuenta>». Sin ella, entran **privadas** y el resumen de la ejecución lo indica; para publicarlas, sube otra vez el mismo archivo con la línea `Licencia:`. **Quien sube responde de la licencia que declara.**

Si una ejecución no llega a procesar lo subido, quien tenga permiso de escritura puede lanzar el workflow `buzon` a mano desde Actions; lo que procesa así entra **privado**, porque no hay mensaje de commit del que leer la licencia.

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

### Desde Internet Archive

Para importar un ítem de Internet Archive con licencia (o un fichero de audio directo con licencia declarada). La hoja valida la dirección en el navegador, con la misma lista de bloqueo de 42 plataformas que el backend, y abre en GitHub una incidencia nueva con la etiqueta `biblioteca` y el texto ya escrito; hay que pulsar «Submit new issue» para enviarla. Solo se procesan las incidencias de cuentas con permiso de escritura (job `autorizar`). La canción entra **privada** hasta que se publica por incidencia (abajo). YouTube y las plataformas de streaming no se admiten.

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
3. Para un fichero de audio directo, fuera de Internet Archive, `license:` es obligatoria y debe declarar la licencia. YouTube y las plataformas de streaming no se admiten.

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
