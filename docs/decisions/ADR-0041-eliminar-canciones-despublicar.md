# ADR-0041: Eliminar canciones desde la app = despublicar (sin que el usuario toque GitHub)

- Estado: aceptada (2026-11-10). Pruebas reales en backend, web y APK. El borrado de extremo a extremo (hasta que desaparece para todos) lo verifica el usuario con la APK en un dispositivo.
- Fecha: 2026-11-10.
- Relacionadas: [ADR-0022](ADR-0022-edicion-sin-github.md) (editar la biblioteca sin que el usuario toque GitHub), [ADR-0027](ADR-0027-ediciones-pendientes.md) (ediciones pendientes, se ven al momento), [ADR-0008](ADR-0008-entrada-por-incidencias.md) (entrada por incidencias), [ADR-0024](ADR-0024-audio-privado-en-r2.md) (el audio privado es la fuente de verdad).

## Contexto

Se pidió poder **eliminar canciones desde la app**: al pulsar «Eliminar» la canción desaparece directamente, sin pedir permisos de GitHub ni autorizaciones externas, reflejándose en la biblioteca y sin dejar registros obsoletos.

Publicar o despublicar estaba **bloqueado a propósito** desde la web (`edit-core.js`: «Publicar o despublicar hay que pedirlo desde GitHub»): era una acción reservada al propietario por GitHub. El resto de ediciones (títulos, álbumes, portadas) ya se hacían sin que el usuario tocara GitHub (ADR-0022): la web/APK llaman a `/api/editar`, el Worker abre la incidencia con su token y `biblioteca.yml` la aplica.

## Decisión

Eliminar = **despublicar** (poner `public: false`), por el mismo flujo de edición, con una operación propia `unpublish_song`. Es **reversible**: el audio sigue en el bucket privado (la fuente de verdad, ADR-0024) y se puede volver a publicar; `sync_public` la quita de `data/songs.json` y `sync_r2` borra su copia del bucket público.

- **Backend:** nueva op `unpublish_song` (`song_id`) en el contrato (`issue_request.py`) y en el aplicador (`ci_library.py`: `catalog.update_song(..., {"public": False})`). El catálogo ya permitía `public:false` (solo bloquea `public:true` sin licencia).
- **Contrato común** (`tests/contrato/peticiones.json`): casos válido e inválido, y `unpublish_song` entra en `operaciones_api_editar` (se puede pedir por `/api/editar`).
- **Web:** `unpublish_song` en `ALLOWED_OPS` (`edit-core.js`) y en la validación espejo (`incidencias.js`); `edit-pending.js` la **quita de la lista al instante** (apply) y la da por **confirmada cuando ya no está** en el catálogo (reflected). Menú de canción → «Eliminar de la biblioteca» con confirmación (`app.js: deleteSong`, `components.js`).
- **APK:** `LibraryRequest.unpublishSong` (`library_requests.dart`); `pending_edits.dart` la quita al instante y la confirma cuando desaparece; menú de canción → «Eliminar de la biblioteca» con confirmación (`song_row.dart`, `library_edit.dart: deleteSongFlow`).
- **No se abre la publicación entera al público:** solo la **despublicación** (quitar). Volver a publicar sigue siendo del propietario. El usuario eligió «despublicar, reversible» entre las opciones.

## Consecuencias

- Cualquiera en la web/APK puede **eliminar** (despublicar) una canción del catálogo común, al instante y sin tocar GitHub, igual que ya podía subir y editar (ADR-0017, ADR-0022). Riesgo asumido por el usuario; mitigado porque es **reversible** (el audio no se borra). Abrir el borrado permanente del audio se decidió NO hacerlo.
- La canción desaparece de «Tu biblioteca» y de «Añadidas recientemente» al instante (edición pendiente); cuando `biblioteca.yml` la despublica, deja de estar en `data/songs.json` y la edición pendiente se confirma sola. Sin registros obsoletos.
- **Pruebas:** backend (`test_contrato_peticiones`, validación y operación conocida), web (`edit-pending.test.mjs`: apply quita + reflected; `api-editar.test.mjs`: en `ALLOWED_OPS`), APK (`contrato_peticiones_test.dart`: factoría `unpublishSong` y cuerpo; `pending_edits_test.dart`: apply quita + reflected). Suites verdes (backend 1430, web 907, APK 599).
- **Pendiente de verificar en dispositivo:** el ciclo completo en la APK (pulsar Eliminar → desaparece → se despublica de verdad). No es verificable sin un teléfono.
