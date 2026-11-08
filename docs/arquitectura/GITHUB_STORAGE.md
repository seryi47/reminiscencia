# Almacenamiento en GitHub: audio, catálogo y límites

- Estado: 2026-11-05; la interfaz ya no tiene usuarios (ADR-0015) y las canciones también entran por el buzón `audio-library/buzon/` (`buzon.yml`, ADR-0014), que borra cada archivo tras procesarlo, aunque el original queda en el historial de git y cuenta para su tamaño. Desde ADR-0024 (parte 1), «Subir canciones» en la web y en la APK ya no escribe en el repositorio: la función de Vercel `frontend/web/api/subir.js` guarda los trozos en el bucket privado de R2 (`entrada/<id>/`) y lanza `buzon.yml`; los trozos que hasta entonces se guardaron en `audio-library/buzon/.partes/<id>/` siguen en el historial. Todo el audio está en ese bucket privado, que es su fuente de verdad; con la parte 2 de ADR-0024, `audio-library/audio/` ya no está en Git (está en `.gitignore`). Portadas en `audio-library/covers/` (ADR-0016).
- Decisiones: ADR-0003 (almacenamiento en el ecosistema GitHub, parcialmente superada), ADR-0006 (audio publicado en el repositorio), ADR-0007 (catálogo y flujo), ADR-0008 (entrada por incidencias), ADR-0010 (procesado y publicación separados), ADR-0014 (buzón), ADR-0016 (portadas), ADR-0017 (subida para todos por `/api/subir`), ADR-0020 (audio público en R2), ADR-0024 (audio privado en R2) y ADR-0025 (publicar aunque main avance).
- Código: `backend/sonidos/` (`limits.py`, `catalog.py`, `pipeline.py`, `publish.py`, `paquete.py`, `r2.py`, `entrada.py`) y `scripts/` (`check_repo_limits.py`, `sync_r2.py`, `entrada_r2.py`).

## 1. Qué hay en el repositorio

| Ruta | Qué contiene | Estado en main | Llega al público |
|---|---|---|---|
| `audio-library/indexes/catalog.json` | Catálogo: 30 canciones (19 públicas y 11 privadas) y un álbum | Versionado | No |
| `audio-library/audio/<id>.opus` | Audio de reproducción de todas las canciones (287 ficheros, unos 480 MB, el 2026-11-05) | Ya no se versiona (parte 2 de ADR-0024, en `.gitignore`); el historial conserva lo que hubo. En los workflows, solo el audio nuevo, de paso hacia el bucket | No |
| `audio/<id>.opus` del bucket privado de R2 | Copia de todo el audio, público y privado: la fuente de verdad desde ADR-0024. La rellenó `migrar-audio-privado.yml` (parte 1, ya retirado) y la mantiene cada `publicar` | Fuera de Git | No |
| `entrada/<id>/` del bucket privado de R2 | Trozos y manifiesto de las subidas de `/api/subir`, hasta que `buzon.yml` los publica y los borra (ADR-0024) | Fuera de Git | No |
| `frontend/web/audio/<id>.opus` | Ya no existe (ADR-0020, fase 3): el audio publicado lo sirve el bucket público de Cloudflare R2 | — | Lo sirve el Worker desde el bucket: en el dominio propio, en el mismo origen; en Vercel, por redirección (ADR-0031 y ADR-0034) |
| `audio-library/covers/<id>.jpg` y `frontend/web/covers/<id>.jpg` | Portadas de 640×640 (hoy una); a la web van las de canciones públicas y todas las carpetas (ADR-0016) | Versionado | Las de `frontend/web/covers/` |
| `audio-library/buzon/` (y `.partes/<id>/`) | Carpeta de paso del workflow `buzon`: archivos subidos desde la página de GitHub, que se borran al procesarlos. `.partes/` solo guarda subidas de `/api/subir` anteriores a ADR-0024 | Versionado de paso; queda en el historial | No |
| `frontend/web/data/songs.json`, `folders.json`, `catalog.json` | Datos públicos, regenerados desde el catálogo | Versionado | Sí, lo sirve el Worker de Cloudflare (ADR-0034) y Vercel |
| `audio-library/**/*.mp3`, `*.wav`, `*.flac`, `*.m4a` | Fuentes sin convertir | Excluidas por `.gitignore` | No |
| `releases/**/*.apk` y `SHA256SUMS.txt` | APK de la app Android | Excluidos por `.gitignore`; se adjuntan a la release | Como descarga de la release |

El repositorio es privado (comprobado con `gh` el 2026-11-02). Vercel y el Worker de Cloudflare solo sirven `frontend/web` (ADR-0007 y ADR-0034; el Worker, además, sin `api/`, `server/` ni la configuración de Node), así que lo que está en `audio-library/` no llega a la web.

## 2. Cómo entra una canción

Por incidencia (ADR-0008):

1. **Identificador.** `S` seguido de los 16 primeros caracteres hexadecimales del SHA-256 del original (`song_id_for` en `catalog.py`). Importar dos veces el mismo contenido da la misma canción y no la duplica (`test_same_content_twice_is_not_duplicated` en `backend/tests/test_pipeline.py`).
2. **Descarga.** El original va a `audio-library/staging/`, un directorio de trabajo sin rastrear, con los límites de `intake.py`. Se borra al terminar, también si la importación falla (`pipeline.py`).
3. **Conversión.** ffmpeg lo convierte a Opus a 64 kb/s, con el perfil `opus-64k` de `compression.py`, y lo deja en `audio-library/audio/<id>.opus`. Antes, `probe.py` (ffprobe) lee sus metadatos.
4. **Catálogo.** Se añade la canción con `public: false` («las canciones nuevas nacen privadas», `catalog.py`). Guarda la licencia, el origen (`internet-archive:<identificador>` o `direct-url:<host>/<fichero>`), la huella SHA-256, el códec, la duración, el tamaño y la fecha de alta. Sin licencia no entra (`test_song_without_license_is_refused` en `backend/tests/test_catalog.py`).
5. **Publicación.** Editar la canción con `public: true` regenera `frontend/web/data/` (`publish.py`) y el job `publicar`, antes de subir a main (`scripts/sync_r2.py`), sube el audio nuevo al bucket privado y copia al público el de las canciones públicas, desde la copia local o desde el privado. Con `public: false`, regenera los datos y `publicar` borra su audio del bucket público; el privado nunca pierde nada (ADR-0020 y ADR-0024).

Por el buzón (ADR-0014, ADR-0017 y ADR-0024): desde la web o la APK, «Subir canciones» convierte el archivo a Opus en el dispositivo y lo envía en trozos de hasta 4 MiB a `/api/subir`, que los guarda en `entrada/<id>/` del bucket privado de R2 (sin sobrescribir) y, con el último, el manifiesto; después lanza `buzon.yml` con un `repository_dispatch`. El job `recoger` baja todas las subidas completas (la primera ejecución de la cola publica todo lo pendiente; ADR-0030), `procesar` (sin secretos) une los trozos, convierte con el mismo perfil y da de alta la canción (título: el nombre del archivo sin extensión; pública con la licencia fija de la web), y `publicar` borra la subida del bucket tras subir a main. Quien tiene permiso de escritura puede subir también desde la página de GitHub, con «Licencia: …» en el commit.

## 3. Qué sale a la web

Lo que genera `publish.py` a partir del catálogo:

- `songs.json`: solo las canciones públicas, con `id`, `title`, `artist`, `year`, `tags`, `folder_id`, `duration_s`, `license`, la ruta del audio y `cover` si tiene portada.
- `folders.json`: todas las carpetas, con `id`, `name`, `parent_id` y, si tienen valor, `artist` y `cover` (ADR-0016).
- `catalog.json`: las canciones públicas (con `source` y `public` además de lo anterior) y todas las carpetas. No incluye rutas de audio ni huellas SHA-256.

Las canciones no publicadas no aparecen en ningún fichero de la web. Lo prueban `test_catalog_json_lists_only_public_songs_and_every_folder_without_audio_paths_or_hashes` y `test_unpublished_song_metadata_never_reaches_the_web` en `backend/tests/test_publish.py`.

## 4. Límites de GitHub

Cifras de `backend/sonidos/limits.py`, que cita docs.github.com consultado el 2026-10-31. No se han vuelto a consultar en esta revisión.

| Límite | Valor | Qué hace el proyecto |
|---|---|---|
| Fichero en Git: aviso | 50 MiB | `check_repo_limits.py` avisa |
| Fichero en Git: bloqueo | 100 MiB | `check_repo_limits.py` falla en CI |
| Repositorio: tamaño ideal | 1 GiB | `check_repo_limits.py` avisa |
| Repositorio: máximo recomendado | 5 GiB | `check_repo_limits.py` falla en CI |
| Asset de una release | Menos de 2 GiB | `release.py` lo comprueba; ningún workflow usa `release.py` |
| Assets por release | 1000, de los que se reserva uno para `SHA256SUMS.txt` | `plan_release_batches`, en `limits.py` |

`check_repo_limits.py` corre en `backend.yml` (en cada push a `main` y en cada pull request) y en `biblioteca.yml` y `buzon.yml`, antes de cada commit del catálogo. El 2026-11-02 devuelve «Límites de GitHub: correcto».

**Cómo se mide.** `audit_repository` suma el tamaño de cada fichero versionado (`git ls-files`) tal como está en el árbol de trabajo. Hasta el 2026-11-05 el audio versionado (`audio-library/audio/`) ocupaba unos 480 MB; desde la parte 2 de ADR-0024 ya no está en `git ls-files`, así que `audit_repository` no lo cuenta. El cálculo no mide el historial de Git, que conserva ese audio.

## 5. Límites de entrada y descarga

| Límite | Valor | Dónde |
|---|---|---|
| Descarga de una fuente | 200 MiB | `intake.py`, `MAX_DOWNLOAD_BYTES` |
| Metadatos de Internet Archive | 10 MiB | `intake.py`, `MAX_METADATA_BYTES` |
| Petición de incidencia | 8000 caracteres | `issue_request.py`; la web (`js/cuidador/incidencias.js`) no se ha comparado cifra a cifra |
| URL, licencia, título, datos JSON | 2048, 300, 200 y 4000 caracteres | sin comparar en la web |
| Nombre de carpeta y artista | 80 y 200 caracteres | sin comparar en la web |
| Etiquetas | 20 por canción, de 40 caracteres como máximo | sin comparar en la web |
| Cambios en un paquete | 2000 | `paquete.py`, `MAX_CHANGES` |
| Trozo de una subida por `/api/subir` | 4 MiB (Vercel admite 4,5 MB por petición) | `frontend/web/api/subir.js`, `MAX_CHUNK_BYTES` |
| Trozos por archivo | 1000 | `api/subir.js` y `backend/sonidos/buzon.py`, `MAX_PARTS` y `MAX_PARTES` |
| Archivo del buzón (también el unido) | 100 MiB | `backend/sonidos/buzon.py`, `MAX_FILE_BYTES` |
| Subidas por hora | Sin límite, por decisión del propietario (ADR-0017) | — |

## 6. Flujo de incidencias (ADR-0008, ADR-0010)

1. **Petición.** Una cuenta con permiso de escritura abre una incidencia con la etiqueta `biblioteca`. Su cuerpo son líneas `clave: valor` (`action: import` con `url`, `license` y `title`, o `action: organize` con un `payload` en JSON de una línea). Para importar, la hoja «Subir canciones» de la web («Desde Internet Archive») prepara el texto y abre el formulario de nueva incidencia de GitHub con el texto ya escrito; `organize` se escribe a mano (la hoja «Gestionar la biblioteca» del modo cuidador se retiró con ADR-0015). El workflow solo actúa si el autor tiene permiso de escritura y la etiqueta está al crear la incidencia: si se añade después, no se lanza (ADR-0008, enmienda de 2026-11-02).
2. **Validación.** `scripts/issue_request.py` valida la petición con `sonidos/issue_request.py`: claves y operaciones en lista blanca, identificadores con formato fijo, límites de longitud y booleanos JSON estrictos.
3. **Procesado (`procesar`, sin token).** `scripts/ci_library.py` aplica la petición: importa (`pipeline.py`) o organiza (crea, renombra o borra carpetas, y edita canciones). Después regenera los datos públicos en su copia, pero no los empaqueta. `scripts/empaquetar_cambios.py` deja en el artefacto `biblioteca-paquete` solo el catálogo y el audio que cambiaron, con un día de retención.
4. **Publicación (`publicar`, con token solo para subir).** Descarga el paquete y lo valida (`backend/sonidos/paquete.py`) antes de tocar el repositorio:
   - el manifiesto tiene la forma exacta, y su base es el HEAD de `main` o un antecesor suyo cuyos cambios posteriores no tocan las rutas del paquete, el catálogo, el audio, las portadas ni la parte pública (ADR-0025); si no, la petición se rechaza y hay que reenviarla;
   - solo se admiten rutas de la biblioteca: el catálogo, el audio con identificador (`S` + 16 hexadecimales + `.opus`) en las dos carpetas de audio, y los tres JSON públicos;
   - solo se pueden borrar ficheros de audio (al despublicar o retirar); nunca el catálogo ni los datos públicos;
   - ningún enlace simbólico ni fichero que no sea regular.

   Después aplica el paquete y regenera la parte pública desde el catálogo (`scripts/aplicar_paquete.py`, con `sonidos.publish`; ADR-0010), comprueba los límites, confirma con `github-actions[bot]`, sincroniza los buckets de R2 y sube a `main`. Si el push se rechaza porque `main` avanzó sin tocar nada de lo anterior, rebasa el commit y reintenta, hasta tres veces (ADR-0025).
5. **Respuesta.** `scripts/responder_incidencia.py` comenta en la incidencia. Si todo salió bien, la cierra. Si algo falló, le añade la etiqueta `error`.

**Garantías y límites.** Un único grupo de concurrencia (`library-catalog`) evita dos escrituras a la vez, y las peticiones en espera no se cancelan (ADR-0008). La validación comprueba rutas y tipos de fichero, no el contenido: un procesado comprometido podría escribir contenido indebido en las rutas permitidas (riesgo residual de ADR-0010).

## 7. Prueba real y pendientes

**Prueba real (2026-11-02).** La grabación «Tell me pretty maiden» se importó, se publicó y se despublicó con las incidencias #1, #2 y #3. Quedan en el historial los commits del bot `biblioteca: import` (630b6f5) y `biblioteca: organize` (8caeb45 y b3daf9f). La grabación está hoy en el catálogo como privada (`public: false`). ADR-0008 todavía dice que el flujo no está verificado en GitHub Actions; esa prueba no está reflejada en él.

**Prueba de la subida para todos (2026-11-03).** En producción, «Prueba subida directa.mp3» llegó por `/api/subir` (commit `8ac2d17`, un trozo y su manifiesto), `buzon.yml` la publicó como «Prueba subida directa» (`e7eaa73`) y se despublicó después con la incidencia #21 (`6d62aee`).

**Pendiente:**

- El campo `source` de `catalog.json` público incluye, en las URL directas, el host y el nombre del fichero de origen. Decidir si se publica.
- Verificar en las políticas de GitHub que el audio versionado es admisible (ADR-0003).
- Cualquiera puede subir por `/api/subir` sin límite de tamaño ni por hora (ADR-0017). Desde ADR-0024 ni los trozos ni el Opus convertido entran en el historial de git: vigilar el tamaño del repositorio con `check_repo_limits.py`, que no mide el historial, y el del bucket privado en Cloudflare.
- Tras la parte 2 de ADR-0024 el historial sigue guardando el audio antiguo y los trozos de `.partes/`; quitarlo exigiría reescribir la historia, que no se ha decidido.
- Si el repositorio pasa a ser público, revisar antes el filtro de autor del workflow (ADR-0008).
