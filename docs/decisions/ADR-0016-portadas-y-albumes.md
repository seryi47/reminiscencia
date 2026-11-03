# ADR-0016: Portadas de canciones y de álbumes, y álbumes con artista

- Estado: aceptada; en `main` (merge `aba83c2`). Probada en GitHub el 2026-11-03: una portada subida al buzón (`237a5cb`) está en `audio-library/covers/` y `frontend/web/covers/`
- Fecha: 2026-11-03
- Relacionadas: ADR-0007 (catálogo como fuente de verdad), ADR-0008 (entrada por incidencias), ADR-0010 (procesado y publicación separados), ADR-0011 (publicar regenera la parte pública), ADR-0014 (buzón) y ADR-0015 (interfaz con el aspecto de Spotify).

## Contexto

La interfaz de ADR-0015 muestra portadas y organiza la música en carpetas, pero el catálogo no tiene imágenes ni sabe de quién es un álbum. Las carpetas ya hacen de álbum; les falta el artista y una portada. Las canciones también pueden tener la suya. Todo tiene que entrar por los caminos que ya existen (incidencias y buzón), sin token en el procesado y con la parte pública regenerada desde el catálogo.

## Decisión

1. **Los álbumes son las carpetas.** Cada carpeta del catálogo admite dos campos opcionales: `artist` (texto de 0 a 80 caracteres en una línea) y `cover` (`"covers/<id>.jpg"`). Los dos solo aparecen cuando tienen valor: un artista vacío quita el campo.
2. **Ids de carpeta.** Las carpetas nuevas tienen id `F` seguida de 16 hexadecimales en minúscula (`catalog.new_folder_id`). Las anteriores, de 10 hexadecimales, siguen siendo válidas en las peticiones, pero no pueden tener portada. A 2026-11-03 el catálogo de `main` no tiene carpetas, así que no hay nada que migrar.
3. **Canciones.** Campo opcional `cover`: `"covers/<id>.jpg"`.
4. **Contrato público.** `frontend/web/data/songs.json` y `catalog.json` llevan `cover` en las canciones públicas que lo tengan; `folders.json` y `catalog.json` llevan `artist` y `cover` en las carpetas que los tengan. Las portadas se sirven en `frontend/web/covers/<id>.jpg`. `sonidos.publish.sync_public` copia las de las canciones públicas y las de todas las carpetas desde `audio-library/covers/` y borra las que sobran (solo ficheros con nombre de portada). Un `cover` que no sea exactamente `covers/<id propio>.jpg`, o cuyo fichero falte, detiene la regeneración.
5. **Subida por el buzón.** `audio-library/buzon/portadas/<ID>.<jpg|jpeg|png|webp>`, con `ID` el id exacto de una canción (`S` + 16 hexadecimales) o de una carpeta (`F` + 16) que esté en el catálogo, o que entre en el mismo push (las canciones se procesan antes que las portadas). La extensión no distingue mayúsculas. Máximo 10 MiB. No hace falta línea de licencia; sí permiso de escritura (el job `autorizar` ya lo comprueba).
   - Se rechazan y se borran del buzón, con el motivo en el resumen: un nombre que no es `<ID>.<extensión>`, un id que no existe, un archivo vacío o de más de 10 MiB y una imagen que no es válida.
   - Se dejan para revisar a mano, como en ADR-0014: enlaces simbólicos, subcarpetas y nombres con caracteres no admitidos. Una carpeta `portadas` que sea un enlace simbólico detiene el procesado.
   - Subir otra imagen con el mismo nombre sustituye la portada. Si sale idéntica, no cambia nada.
6. **Conversión** (`sonidos.portadas.convertir_portada`, en el job `procesar`, sin token): recorte centrado a cuadrado, 640×640, JPEG (`mjpeg`, `yuvj420p`), sin metadatos (`-map_metadata -1`, sin EXIF ni ubicación) y con `+bitexact` (la misma imagen da los mismos bytes y no hay firma del codificador).
   - El formato se elige por los primeros bytes (JPEG, PNG o WebP), nunca por la extensión, y la imagen entra por la entrada estándar con el demuxer de ese formato (`jpeg_pipe`, `png_pipe`, `webp_pipe`). Así ffmpeg no puede tratarla como lista de reproducción, secuencia de ficheros ni URL.
   - Antes, ffprobe comprueba el códec y las dimensiones: como máximo 16384 px por lado y 100 megapíxeles. Después, comprueba que la salida es un JPEG de 640×640. Cada llamada tiene un límite de 120 s.
   - **Calidad.** El contrato pide «calidad 85», que es la escala 0–100 de libjpeg. El codificador de ffmpeg no tiene esa escala: usa `-q:v` de 2 (mejor) a 31. Se usa `-q:v 2`. Medido el 2026-11-03 con una imagen de prueba (`testsrc2`) recortada a 640×640: 41 KB con `-q:v 2` frente a 50 KB de `sips` (libjpeg de macOS) a calidad 85, que guarda el color sin submuestrear. Es una equivalencia aproximada, no exacta.
7. **Incidencias.** Operación nueva `edit_folder`: `{"op":"edit_folder","folder_id":"F…","name":"…","artist":"…"}`, con `name` obligatorio (1 a 80 caracteres) y `artist` opcional (0 a 80), los dos en una línea (sin controles, separadores de línea ni caracteres de formato). Sin `artist`, se conserva el que tenga. `create_folder` admite también `artist`; dos álbumes con el mismo nombre y distinto artista bajo el mismo padre son dos carpetas. `edit_song` ya cambiaba `title` y `artist` (confirmado y probado). Las portadas no se cambian por incidencia: solo por el buzón. Borrar una carpeta (`delete_folder`) borra también su portada.
8. **Paquete** (`sonidos.paquete`): las rutas cerradas se amplían solo con `audio-library/covers/<ID>.jpg` (se añade, cambia o borra) y `frontend/web/covers/<ID>.jpg` (parte pública: no se empaqueta y la publicación la regenera, ADR-0011), con `ID` = `S` o `F` + 16 hexadecimales y solo `.jpg`. La acción `buzon` puede borrar también archivos de `audio-library/buzon/portadas/` con nombre válido. La publicación rechaza enlaces simbólicos en las dos carpetas de portadas y sustituye cualquier portada publicada que traiga el paquete por la regenerada.

## Consecuencias

- **Derechos.** Las portadas de discos suelen tener derechos de autor. No se pide licencia, pero quien sube responde de lo que sube, como con la licencia del audio (ADR-0014). Las de canciones públicas y las de carpetas se publican en la web.
- **Datos personales.** Una portada es una fotografía que queda en el historial de git aunque se sustituya. Nunca se suben fotografías de pacientes ni de otras personas (CLAUDE.md). La conversión quita los metadatos, también la ubicación de las fotos de teléfono, pero el original sigue en el historial.
- **Tamaño.** Una portada de 640×640 ocupa del orden de 40 a 100 KB. El original subido también queda en el historial (hasta 10 MiB). `scripts/check_repo_limits.py` sigue vigilando el repositorio.
- La web y la APK leen los campos nuevos como opcionales: un catálogo sin portadas ni artistas sigue siendo válido.
- La validación de ids de carpeta de la web (`frontend/web/js/cuidador/incidencias.js` y `js/intake.js`, hoy `^[0-9a-f]{10}$`) tiene que aceptar también `F` + 16 hexadecimales para pedir `edit_folder` sobre las carpetas nuevas. No es de este cambio: lo hace la parte web con este mismo contrato.

## Cómo se prueba

- `backend/tests/test_portadas.py`: conversión real con ffmpeg de un PNG sintético a JPEG de 640×640 (y de JPEG y WebP), determinismo, recorte, firma frente a extensión, imágenes falsas, límite de píxeles; buzón de portadas (canción pública, privada, carpeta, canción del mismo push, portada repetida, rechazos, 10 MiB, enlaces, subcarpetas, evento sin listas); parte pública (portadas sobrantes, rutas forjadas, fichero que falta, artista); paquete completo con git real (procesar, empaquetar, publicar; portada publicada forjada; carpeta de portadas que es un enlace).
- `backend/tests/test_issue_request.py` y `test_ci_library.py`: `edit_folder`, `create_folder` con artista, ids `F`, una sola línea, `edit_song` con `title` y `artist`, y borrado de la portada al borrar la carpeta.
- **No verificado en GitHub:** el disparo del workflow `buzon` con una subida a `portadas/`, la conversión con el ffmpeg de Ubuntu del runner (la local es ffmpeg 8.1.2 de Homebrew), el push final y que Vercel sirva `covers/` con la CSP de `vercel.json`.
