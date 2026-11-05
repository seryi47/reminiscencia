# ADR-0003: Almacenamiento del audio dentro del ecosistema GitHub

- Estado: aceptada (fase 1). Las decisiones 1 y 2 están superadas por ADR-0006 y ADR-0007: el audio de la biblioteca se versiona en el repositorio, no en Releases. Los límites siguen vigentes y se comprueban en CI.
- Fecha: 2026-10-31
- Última revisión: 2026-11-02 (texto contrastado con el código de main, commit b3daf9f)

> **Nota (2026-10-31):** para la biblioteca, el audio se versiona en `audio-library/audio/` y se publica en `frontend/web/audio/` (ADR-0006, ADR-0007). Las releases de GitHub siguen sirviendo para lotes de descarga, pero no como origen para el navegador, porque sus assets requieren autenticación.
>
> **Nota (2026-11-02):** `backend/sonidos/release.py` prepara lotes para Releases, pero ningún workflow lo invoca; solo lo usan sus pruebas. Las releases que sí se usan son las de los APK de la app Android (`docs/android/RELEASE.md`). Cómo se guarda hoy la biblioteca está descrito en `docs/arquitectura/GITHUB_STORAGE.md`.

> **Nota (2026-11-05):** desde la fase 3 de [ADR-0020](ADR-0020-audio-en-r2.md), `frontend/web/audio/` ya no existe: el audio público lo sirve Cloudflare R2 y Vercel redirige `/audio/<id>.opus` al bucket.

## Contexto

El proyecto quiere que GitHub sea el centro de control. Pero una biblioteca musical no cabe bien en git:

| Mecanismo | Límite verificado (docs.github.com, 2026-10-31) | Encaje con audio |
|---|---|---|
| Git normal | Bloquea ficheros > 100 MiB; avisa > 50 MiB; repo ideal < 1 GB, recomendado < 5 GB | Malo para audio. Sólo para código, índices y metadatos |
| Git LFS | Tamaño por fichero: 2 GB (Free/Pro), 4 GB (Team). Cuotas de almacenamiento y ancho de banda: no publicadas en la página consultada | Razonable, pero el coste depende de cuotas que hay que confirmar |
| Releases | Cada asset < 2 GiB; hasta 1000 assets por release; sin límite total ni de ancho de banda indicado | Muy adecuado para ficheros de audio ya transcodificados |

Las cifras de Git y de Releases son las que recoge `backend/sonidos/limits.py`, con la fecha de la consulta. Las de Git LFS no están en el código y no se han vuelto a comprobar en la revisión del 2026-11-02.

## Decisión

1. **Repositorio:** contiene código, documentación, índices JSON, metadatos y pruebas. Nunca audio.
   - *Superada (ADR-0006 y ADR-0007):* el repositorio sí contiene el audio de la biblioteca: `audio-library/audio/` (todas las canciones, en Opus) y `frontend/web/audio/` (solo las publicadas). Los originales no se versionan: `.gitignore` excluye mp3, wav, flac y m4a dentro de `audio-library/`.
2. **Audio de reproducción:** se publica como assets de GitHub Releases, agrupados por lote de importación. Cada asset va acompañado de su SHA-256.
   - *Superada (ADR-0006 y ADR-0007):* el audio de la biblioteca no se publica en Releases. Lo sirve la web desde `frontend/web/audio/`, que Vercel despliega desde Git.
3. **Índice:** `audio-library/indexes/catalog.json` (versionado, ADR-0007) relaciona cada `song_id` con su hash. El índice `songs.json` de la primera versión ya no existe.
   - *Precisión (2026-11-02):* `frontend/web/data/songs.json` sí existe, pero es un derivado público que regenera `backend/sonidos/publish.py` a partir del catálogo. No es un índice de la biblioteca.
4. **Originales:** no se suben. Sólo se conserva la huella y la licencia.
   - *Precisión (2026-11-02):* el catálogo guarda también el origen, el códec, la duración y el tamaño del original (`backend/sonidos/catalog.py`). El original se descarga a un directorio de trabajo y se borra al terminar la importación (`backend/sonidos/pipeline.py`).
5. **Condición:** sólo se publica audio cuya licencia esté registrada (ver ADR-0002). El catálogo rechaza una canción sin licencia (`test_song_without_license_is_refused` en `backend/tests/test_catalog.py`), y la importación rechaza un fichero directo sin licencia (`test_direct_file_without_license_is_refused` en `backend/tests/test_pipeline.py`).

Git LFS queda como alternativa si se necesita versionar binarios que cambian. Un almacenamiento externo (por ejemplo, un bucket de objetos) se considerará si el audio se acerca al límite del repositorio (ADR-0006). Cualquier servicio externo deberá justificarse y tener un coste menor que la alternativa.

## Consecuencias

- Lo que ve el público (la web, sus datos y el audio publicado) sale del repositorio de GitHub a través de Vercel (ADR-0006, ADR-0007).
- La verificación de las políticas de GitHub sigue pendiente (ver «Pendiente»): ya hay audio versionado en el repositorio.
- La API de GitHub (gh CLI) permite subir y descargar assets desde un script o desde GitHub Actions. El flujo de la biblioteca no la usa para el audio; `android.yml` sí la usa para crear las releases de los APK.
- El índice no guarda rutas locales: los campos que escribe `catalog.py` no las incluyen. La prueba que este ADR citaba antes, `test_export_index_has_no_local_paths`, no existe en `backend/tests/` (comprobado el 2026-11-02). Lo que sí prueba `backend/tests/test_publish.py` es que el catálogo público no incluye rutas de audio ni huellas (`test_catalog_json_lists_only_public_songs_and_every_folder_without_audio_paths_or_hashes`).

## Pendiente

- Verificar en las políticas de uso aceptable de GitHub que el audio versionado en el repositorio es admisible para este contenido. No verificado en la revisión del 2026-11-02. Sustituye al pendiente original sobre Releases.
- Escribir la prueba que compruebe que el catálogo no guarda rutas locales, o retirar esa afirmación.
- Confirmar las cuotas de LFS si en el futuro se usa. No verificado.
