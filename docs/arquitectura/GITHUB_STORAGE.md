# Almacenamiento en GitHub: audio, catálogo y límites

- Estado: 2026-11-02, con la interfaz única (ADR-0009).
- Decisiones: ADR-0003 (almacenamiento en el ecosistema GitHub, parcialmente superada), ADR-0006 (audio publicado en el repositorio), ADR-0007 (catálogo y flujo), ADR-0008 (entrada por incidencias) y ADR-0010 (procesado y publicación separados).
- Código: `backend/sonidos/` (`limits.py`, `catalog.py`, `pipeline.py`, `publish.py`, `paquete.py`) y `scripts/check_repo_limits.py`.

## 1. Qué hay en el repositorio

| Ruta | Qué contiene | Estado en main | Llega al público |
|---|---|---|---|
| `audio-library/indexes/catalog.json` | Catálogo: 12 canciones (9 públicas) y ninguna carpeta | Versionado | No |
| `audio-library/audio/<id>.opus` | Audio de reproducción de todas las canciones (12 ficheros, unos 18 MiB) | Versionado | No |
| `frontend/web/audio/<id>.opus` | Audio de las canciones publicadas (9 ficheros, unos 12 MiB) | Versionado | Sí, lo sirve Vercel |
| `frontend/web/data/songs.json`, `folders.json`, `catalog.json` | Datos públicos, regenerados desde el catálogo | Versionado | Sí, lo sirve Vercel |
| `audio-library/**/*.mp3`, `*.wav`, `*.flac`, `*.m4a` | Fuentes sin convertir | Excluidas por `.gitignore` | No |
| `releases/**/*.apk` y `SHA256SUMS.txt` | APK de la app Android | Excluidos por `.gitignore`; se adjuntan a la release | Como descarga de la release |

El repositorio es privado (comprobado con `gh` el 2026-11-02). Vercel solo sirve `frontend/web` (ADR-0007), así que lo que está en `audio-library/` no llega a la web.

## 2. Cómo entra una canción

1. **Identificador.** `S` seguido de los 16 primeros caracteres hexadecimales del SHA-256 del original (`song_id_for` en `catalog.py`). Importar dos veces el mismo contenido da la misma canción y no la duplica (`test_same_content_twice_is_not_duplicated` en `backend/tests/test_pipeline.py`).
2. **Descarga.** El original va a `audio-library/staging/`, un directorio de trabajo sin rastrear, con los límites de `intake.py`. Se borra al terminar, también si la importación falla (`pipeline.py`).
3. **Conversión.** ffmpeg lo convierte a Opus a 64 kb/s, con el perfil `opus-64k` de `compression.py`, y lo deja en `audio-library/audio/<id>.opus`. Antes, `probe.py` (ffprobe) lee sus metadatos.
4. **Catálogo.** Se añade la canción con `public: false` («las canciones nuevas nacen privadas», `catalog.py`). Guarda la licencia, el origen (`internet-archive:<identificador>` o `direct-url:<host>/<fichero>`), la huella SHA-256, el códec, la duración, el tamaño y la fecha de alta. Sin licencia no entra (`test_song_without_license_is_refused` en `backend/tests/test_catalog.py`).
5. **Publicación.** Editar la canción con `public: true` copia el audio a `frontend/web/audio/` y regenera `frontend/web/data/`. Con `public: false`, borra el audio público y regenera los datos (`publish.py`).

## 3. Qué sale a la web

Lo que genera `publish.py` a partir del catálogo:

- `songs.json`: solo las canciones públicas, con `id`, `title`, `artist`, `year`, `tags`, `folder_id`, `duration_s`, `license` y la ruta del audio.
- `folders.json`: todas las carpetas, con `id`, `name` y `parent_id`.
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

`check_repo_limits.py` corre en `backend.yml` (en cada push a `main` y en cada pull request) y en `biblioteca.yml`, antes de cada commit del catálogo. El 2026-11-02 devuelve «Límites de GitHub: correcto».

**Cómo se mide.** `audit_repository` suma el tamaño de cada fichero versionado (`git ls-files`) tal como está en el árbol de trabajo. Por eso el audio publicado cuenta dos veces: la copia de la biblioteca y la copia publicada. Hoy el audio versionado ocupa unos 30 MiB en total. El cálculo no mide el historial de Git, que también ocupa espacio. Si el audio publicado se acerca a 1 GiB, hay que pasarlo a almacenamiento externo (ADR-0006), y eso requiere decisión y coste explícitos.

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

## 6. Flujo de incidencias (ADR-0008, ADR-0010)

1. **Petición.** El propietario abre una incidencia con la etiqueta `biblioteca`. Su cuerpo son líneas `clave: valor` (`action: import` con `url`, `license` y `title`, o `action: organize` con un `payload` en JSON de una línea). La interfaz (Biblioteca del modo cuidador, «Gestionar la biblioteca») prepara el texto y abre el formulario de nueva incidencia de GitHub con el texto ya escrito; lo envía el propietario. El workflow solo actúa si el autor es el propietario y la etiqueta está al crear la incidencia: si se añade después, no se lanza (ADR-0008).
2. **Validación.** `scripts/issue_request.py` valida la petición con `sonidos/issue_request.py`: claves y operaciones en lista blanca, identificadores con formato fijo, límites de longitud y booleanos JSON estrictos.
3. **Procesado (`procesar`, sin token).** `scripts/ci_library.py` aplica la petición: importa (`pipeline.py`) o organiza (crea, renombra o borra carpetas, y edita canciones). Después regenera los datos públicos en su copia, pero no los empaqueta. `scripts/empaquetar_cambios.py` deja en el artefacto `biblioteca-paquete` solo el catálogo y el audio que cambiaron, con un día de retención.
4. **Publicación (`publicar`, con token solo para subir).** Descarga el paquete y lo valida (`backend/sonidos/paquete.py`) antes de tocar el repositorio:
   - el manifiesto tiene la forma exacta, y su base es el HEAD de `main`; si `main` cambió, la petición se rechaza y hay que reenviarla;
   - solo se admiten rutas de la biblioteca: el catálogo, el audio con identificador (`S` + 16 hexadecimales + `.opus`) en las dos carpetas de audio, y los tres JSON públicos;
   - solo se pueden borrar ficheros de audio (al despublicar o retirar); nunca el catálogo ni los datos públicos;
   - ningún enlace simbólico ni fichero que no sea regular.

   Después aplica el paquete y regenera la parte pública desde el catálogo (`scripts/aplicar_paquete.py`, con `sonidos.publish`; ADR-0010), comprueba los límites, confirma con `github-actions[bot]` y sube a `main`.
5. **Respuesta.** `scripts/responder_incidencia.py` comenta en la incidencia. Si todo salió bien, la cierra. Si algo falló, le añade la etiqueta `error`.

**Garantías y límites.** Un único grupo de concurrencia (`library-catalog`) evita dos escrituras a la vez, y las peticiones en espera no se cancelan (ADR-0008). La validación comprueba rutas y tipos de fichero, no el contenido: un procesado comprometido podría escribir contenido indebido en las rutas permitidas (riesgo residual de ADR-0010).

## 7. Prueba real y pendientes

**Prueba real (2026-11-02).** La grabación «Tell me pretty maiden» se importó, se publicó y se despublicó con las incidencias #1, #2 y #3. Quedan en el historial los commits del bot `biblioteca: import` (630b6f5) y `biblioteca: organize` (8caeb45 y b3daf9f). La grabación está hoy en el catálogo como privada (`public: false`). ADR-0008 todavía dice que el flujo no está verificado en GitHub Actions; esa prueba no está reflejada en él.

**Pendiente:**

- El campo `source` de `catalog.json` público incluye, en las URL directas, el host y el nombre del fichero de origen. Decidir si se publica.
- Verificar en las políticas de GitHub que el audio versionado es admisible (ADR-0003).
- Colaboradores con permiso de escritura: en curso en la rama `feat/contrato-colaboradores`.
- Si el repositorio pasa a ser público, revisar antes el filtro de autor del workflow (ADR-0008).
