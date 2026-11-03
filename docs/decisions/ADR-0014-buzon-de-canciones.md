# ADR-0014: Buzón de canciones subidas desde GitHub

- Estado: aceptada. Vía privada probada en GitHub el 2026-11-03 (ver «Cómo se prueba»); vía pública sin probar.
- Fecha: 2026-11-03
- Relacionadas: ADR-0007 (catálogo como fuente de verdad), ADR-0008 (entrada por incidencias), ADR-0010 (procesado y publicación separados) y ADR-0011 (publicar regenera la parte pública).

## Contexto

Hasta ahora, una canción entra en la biblioteca por una incidencia con una URL de Internet Archive o de un fichero directo con licencia (ADR-0008). No hay forma de añadir una grabación que alguien tiene en su ordenador, como una grabación propia o una cedida, para que la vean todos. La subida desde el navegador y desde la APK guarda el audio solo en ese dispositivo (ADR-0012, ADR-0013).

## Decisión

1. **Entrada.** Quien tiene permiso de escritura sube archivos de audio (WAV, MP3, M4A, FLAC u OGG) a `audio-library/buzon/` desde la página de subida de GitHub: https://github.com/seryi47/reminiscencia/upload/main/audio-library/buzon. El push a `main` que toca `audio-library/buzon/**` lanza el workflow `buzon` (`.github/workflows/buzon.yml`). El `README.md` y el `.gitkeep` del buzón no lo lanzan ni se procesan.
2. **Licencia.** Se declara en el mensaje del commit que sube los archivos, con una línea `Licencia: <texto>` (en la página de subida, en la descripción del commit). La línea debe empezar así; no distingue mayúsculas, vale la primera y el texto tiene como máximo 300 caracteres, sin caracteres de control ni de formato (`sonidos.buzon.licencia_desde_mensaje`).
   - Con licencia: la canción entra **pública** (`public: true`), con esa licencia y la fuente `Subida por <cuenta>`, donde `<cuenta>` es `github.actor`, la cuenta que hizo el push.
   - Sin licencia válida: la canción entra **privada** (`public: false`), con la licencia `Sin declarar` (`catalog.LICENSE_UNDECLARED`) y la misma fuente. El job lo anota en su resumen y con un aviso. `update_song` no deja publicar una canción con esa licencia. Para declararla después, se sube otra vez el mismo archivo con la línea `Licencia:`; el contenido es el mismo (misma huella SHA-256), así que se declara la licencia de la canción que ya está y se publica.
   - **Quien sube responde de la licencia que declara.** El workflow no comprueba que la declaración sea cierta: la registra con el nombre de la cuenta.
3. **Qué archivos se procesan.** Los que el push añadió o modificó según el evento de GitHub (`GITHUB_EVENT_PATH`, lista `commits` con `added`, `modified`, `removed` y `message`), siempre que sigan en el buzón. La licencia de cada archivo sale del último commit del push que lo tocó. Así, si dos subidas se encolan, cada archivo queda a nombre de quien lo subió y con la licencia de su commit. `procesar` trabaja sobre `main` tal como está al empezar (`ref: main`).
4. **Proceso** (`sonidos.buzon.procesar_buzon`, `scripts/buzon.py`): para cada archivo, huella SHA-256, sondeo con ffprobe, conversión a Opus con el perfil de reproducción de la biblioteca (`pipeline.PLAYBACK_PROFILE`, `opus-64k`) y alta en el catálogo. El título es el nombre del archivo sin la extensión, en forma NFC, como máximo de 200 caracteres. Una grabación que ya está en el catálogo no se duplica. Después, el archivo se borra del buzón y se regenera la parte pública con `sonidos.publish.sync_public`.
5. **Rechazos.**
   - Se borran del buzón y se anotan en el resumen: extensión que no es de audio, archivo vacío, más de 100 MiB (`limits.GIT_BLOCK_FILE_BYTES`), contenido que ffprobe no lee como audio y audio que ffmpeg no convierte.
   - Se dejan en el buzón y se anotan para revisarlos a mano: enlaces simbólicos, carpetas, subcarpetas y nombres con caracteres fuera de la lista (`nombre_valido`: letras, marcas y números de cualquier alfabeto, espacio y `._-()[]'’&,!¡¿+#`; sin punto ni guion iniciales, sin espacio ni punto finales, hasta 200 caracteres y 255 bytes). El paquete no puede borrarlos.
   - Un buzón que sea un enlace simbólico, o una cuenta con un nombre que no es de GitHub, detienen el procesado sin tocar nada.
6. **Seguridad**, con los mismos tres jobs que `biblioteca.yml`:
   - `autorizar` comprueba que `github.actor` y `github.triggering_actor` (quien relanza una ejecución) tienen permiso `admin`, `maintain` o `write`, con el mismo punto de la API que `biblioteca.yml`. No hace checkout.
   - `procesar` tiene `contents: read`, ningún token y `persist-credentials: false`. La guarda de rama va antes de instalar nada. Deja el resultado en `resultado.json` y empaqueta los cambios con `scripts/empaquetar_cambios.py` y `ACTION=buzon`.
   - `publicar` valida el paquete, lo aplica, regenera la parte pública desde el catálogo (ADR-0011), comprueba los límites con `scripts/check_repo_limits.py`, confirma y sube a `main`. El `GITHUB_TOKEN` solo llega al paso que sube. No ejecuta ffmpeg ni código del procesado.
   - El paquete admite una acción nueva, `buzon`, que es la única que puede tocar `audio-library/buzon/`, y solo para borrar archivos con nombre válido (nunca `README.md` ni `.gitkeep`). Las demás acciones no pueden tocar el buzón.
   - Concurrencia: el mismo grupo que `biblioteca.yml` (`library-catalog`, sin cancelar y con `queue: max`).
   - Las acciones están fijadas por SHA, las mismas que en `biblioteca.yml`.
   - Ningún nombre de archivo ni mensaje de commit se interpola en el workflow: el script los lee del evento. En el resumen del job van escapados y en bloques de código; en los avisos de GitHub Actions solo va texto fijo.
   - El push del bot no vuelve a lanzar el workflow: GitHub no lanza workflows con los pushes hechos con `GITHUB_TOKEN`.

## Consecuencias

- **Los archivos del buzón quedan en el historial de git** aunque el workflow los borre: el repositorio crece con cada subida, además de con el Opus de la biblioteca, y lo que se sube no se puede retirar sin reescribir el historial. Por eso no hay que subir nada que no se pueda versionar (ni datos de pacientes, ni grabaciones sin derecho a usarlas), aunque entre como privado.
- **Tamaño.** Se recomienda MP3 o FLAC antes que WAV. GitHub admite desde el navegador hasta 25 MiB por archivo (docs.github.com, «About large files on GitHub», consultado el 2026-11-03); cuatro minutos de WAV en estéreo a 44,1 kHz ocupan unos 42 MB y no se pueden subir así. Por git, GitHub avisa a partir de 50 MiB y bloquea más de 100 MiB. El `.gitignore` excluye `*.wav`, `*.mp3`, `*.flac` y `*.m4a` de `audio-library/`: subir desde un clon local exige `git add -f`; la página de subida no lo mira.
- La fuente `Subida por <cuenta>` sale en `frontend/web/data/catalog.json` para las canciones públicas: es el nombre público de una cuenta de GitHub, no un dato de pacientes.
- Si `main` cambia mientras se procesa, `publicar` falla porque la base del paquete ya no es `main` (ADR-0010) y los archivos siguen en el buzón. Para reintentarlo, se relanza la ejecución en GitHub («Re-run all jobs»): `procesar` vuelve a leer `main` y el evento original, y `github.actor` sigue siendo quien subió.
- Una subida que solo tenga archivos rechazados o duplicados se limpia del buzón igual.

## Cómo se prueba

- `backend/tests/test_buzon.py`: nombre a título, licencia desde el mensaje, nombres y rutas, pública o privada, declaración posterior, duplicados, rechazos (no audio, vacío, tamaño), enlaces y subcarpetas para revisar, el paquete que solo borra del buzón y el script del job. Las conversiones son reales con ffmpeg (tonos sintéticos en WAV, MP3, FLAC, OGG y M4A) y git es real, sin red.
- `backend/tests/test_buzon_workflow.py`: estructura del workflow (disparo, concurrencia compartida, permisos por job, token solo en el push, checkouts sin credenciales, acciones fijadas, ninguna interpolación en `run:`).
- Suite de `backend/`: 563 pruebas en verde el 2026-11-03.
- **No verificado en GitHub** al escribir este ADR: el disparo por push con los filtros de `paths`, la forma real del evento de un commit de la página de subida, la consulta de permiso con `contents: read`, la cola compartida con `biblioteca.yml` y el push final.
- **Verificado el 2026-11-03.** Un push con un WAV de prueba sin licencia lanzó el workflow (ejecución 41608486716) y la consulta de permiso pasó, pero terminó en verde sin procesar nada: el evento no traía las listas de archivos. La corrección `34a1f06` procesa lo que hay en el buzón cuando el evento no nombra archivos, con el mensaje del último commit del push (`head_commit`), y añade `workflow_dispatch`. La ejecución manual 41608984990 dio de alta la canción como privada con `Sin declarar` y subió a `main` (commit del bot `4f6c73d`). Una ejecución manual no tiene mensaje de commit: todo lo que procesa entra privado, a nombre de quien la lanza. Siguen sin verificar una subida con «Licencia: …» y la cola compartida con `biblioteca.yml`. Suite de `backend/`: 566 pruebas en verde.
