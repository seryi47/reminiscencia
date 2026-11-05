# ADR-0027: Ediciones pendientes, vista inmediata y aviso si fallan

- Estado: aceptada (rama `feature/ediciones-pendientes`, 2026-11-05; pendiente de fusionar en main).
- Fecha: 2026-11-05.
- Relacionadas: ADR-0008 (peticiones por incidencias), ADR-0017 y ADR-0018 (seguimiento de subidas), ADR-0022 (editar sin GitHub), ADR-0023 (`move_songs`) y ADR-0026 (`order_album`).

## Contexto

- Las ediciones de la biblioteca común (`edit_song`, `move_songs`, `order_album`, `edit_folder`, `rename_folder`, `create_folder` y portadas) se envían a `POST /api/editar`. Esa función abre una incidencia de GitHub (y devuelve su número) o guarda la portada en el buzón. `biblioteca.yml` (o `buzon.yml`, para las portadas) la aplica en uno o dos minutos, a veces más porque va en cola.
- Mientras tanto, la web y la APK seguían mostrando lo de antes. Eso invitaba a repetir el cambio.
- Si el workflow fallaba, la incidencia quedaba abierta con la etiqueta `error` y nadie se enteraba desde la app.
- Las subidas ya tenían un seguimiento parecido (`js/cuidador/subida-estado.js` y `lib/upload_tracker.dart`): sondean `data/songs.json` hasta ver la canción.

## Decisión

### 1. Estado de una edición: `GET /api/editar?incidencia=N`

- Responde `{ ok: true, incidencia: N, estado }` con `estado`:
  - `abierta`: en cola o procesándose;
  - `cerrada`: `biblioteca.yml` la aplicó (la cierra al terminar bien);
  - `error`: tiene la etiqueta `error`, o se cerró como «no planificada».
- Usa el **token del servidor**. La API pública de GitHub solo admite 60 consultas por hora y por IP, y varias personas detrás de la misma IP la agotarían.
- **Validación estricta:** un solo parámetro `incidencia`, solo cifras, sin ceros a la izquierda y como mucho 9 (`^[1-9][0-9]{0,8}$`). Si no vale, 400 sin llamar a GitHub.
- Solo responde de incidencias de edición: cuerpo que empieza por `action: organize` y que no son pull requests. Si no, 404. Así no sirve para leer otras incidencias del repositorio.
- `Cache-Control: no-store`. El token nunca sale en la respuesta.
- Mismo fichero (`frontend/web/api/editar.js`, exporta `GET` y `POST`). Pruebas con GitHub simulado en `tests/web-unit/api-editar.test.mjs`.

### 2. Registro de pendientes

- Al enviar una edición con éxito se guarda como **pendiente**, con:
  - `key` (identificador local), `kind` (`organize` o `cover`), `payload` (la operación tal cual se envió) o `targetId` (la portada);
  - `issue` (número de incidencia, o null), `label` (nombre de lo editado: título de la canción o nombre del álbum, ya con el cambio) y `action` (qué se hizo: «Detalles de la canción», «Añadir a «B»», «Quitar del álbum», «Orden de las canciones», «Álbum nuevo», «Portada nueva»…);
  - `createdAt`, `closedAt` (cuando el servidor la dio por cerrada), `state` (`pendiente` o `error`) y `error` (motivo);
  - en las portadas, `hadCover` (si ya tenía portada) y la vista previa (JPEG ya recortado);
  - en `create_folder`, `knownFolderIds` (los álbumes que había al crearlo).
- **Persistencia:**
  - web: `localStorage`, clave `reminiscencia.ediciones`, `{ version: 1, items }`, con try/catch (si el navegador no deja guardar, vale durante la visita). La vista previa de una portada solo se guarda si cabe (si no, se guarda la edición sin vista previa);
  - APK: `biblioteca-local/ediciones_pendientes.json` (la carpeta que Android deja fuera de las copias de seguridad, como `subidas/`), con la misma forma (la portada en base64).
- Sobreviven a recargar la web o reabrir la APK, y sin conexión siguen pendientes.

### 3. Vista inmediata (optimista)

- **El catálogo real no se toca.** Lo que se pinta es el catálogo real con las ediciones pendientes aplicadas encima, en orden de envío:
  - `edit_song`: título, artista, año, etiquetas y álbum;
  - `move_songs` y `edit_song` con `folder_id`: la canción entra o sale del álbum. Al entrar recibe el número de pista siguiente (si el álbum usa números); al salir lo pierde. Si ya estaba en ese álbum, no cambia;
  - `order_album`: números de pista 1..n en el orden nuevo;
  - `edit_folder` y `rename_folder`: nombre y artista del álbum;
  - portadas: la imagen nueva (en la web, la vista previa en `data:`, que la CSP ya admite en `img-src`; en la APK, la imagen en memoria);
  - `create_folder` no se puede previsualizar (el id lo pone el backend): solo sale en la lista de cambios pendientes.
- **Marca «Pendiente»:** una etiqueta de texto (no solo color) en las filas de las canciones editadas y en la cabecera de los álbumes editados.
- **Lista de cambios pendientes:** en Tu biblioteca, un botón «N cambios pendientes» (o «No se ha podido guardar N cambios», si alguno falló) abre la lista, con el estado de cada uno y, en los fallidos, «Reintentar» y «Descartar».

### 4. Confirmación y fallo

- **Revisión:** mientras haya pendientes, se lee el catálogo (`data/songs.json` y `data/folders.json`, sin caché) y, de cada edición con número de incidencia, su estado. Espera creciente: 20, 30, 45, 60, 90, 120 s y después cada 180 s. Se vuelve a empezar por 20 s con cada edición nueva. También se revisa al abrir.
- **Confirmada** (desaparece la marca y se avisa: «Ya está guardado: «X».»):
  - cuando el catálogo ya la refleja (comparación por operación; los textos, sin espacios sobrantes);
  - cuando el servidor la dio por `cerrada` hace 10 minutos o más y el catálogo no la refleja (otra edición posterior la cambió; ya no hay nada que esperar);
  - si lo editado ya no existe en el catálogo;
  - una portada de algo que **ya tenía portada**: la ruta (`covers/<id>.jpg`) no cambia y no hay forma de verlo en el catálogo, así que se da por guardada a los 10 minutos.
- **Fallida** (se quita la vista optimista y se avisa: «No se ha podido guardar «X». Inténtalo de nuevo.»):
  - si el servidor dice `error`;
  - si pasan **30 minutos** sin confirmarse y sin que el servidor la dé por cerrada, **solo si esa revisión pudo leer el catálogo** (sin conexión nunca caduca).
  - La fallida queda en la lista con «Reintentar» (vuelve a enviar la misma operación o la misma portada) y «Descartar».
- **Sin duplicados:** si ya hay una edición pendiente igual (misma operación con los mismos datos, o la portada del mismo elemento con la misma imagen), no se reenvía y se avisa: «Ya está pendiente: «X».».
- **Sustitución:** una edición nueva que cambia todos los campos de otra pendiente sobre lo mismo (por ejemplo, dos «Editar detalles» seguidos de la misma canción, dos órdenes del mismo álbum o dos portadas del mismo elemento) quita la anterior de la lista; el catálogo acabará con la última.

### 5. Igual en la web y en la APK

- Web: `js/edit-pending.js` (lógica pura, sin DOM) y `js/edit-remote.js` (`sendOrganize`, `sendCover` y `fetchEditStatus`). La app (`js/app.js`) aplica las pendientes al reconstruir el catálogo.
- APK: `lib/pending_edits.dart` (misma lógica, almacén en fichero y controlador) y `lib/edit_remote.dart` (`fetchEditStatus`). La interfaz pinta el catálogo con las pendientes aplicadas.
- Las reglas (aplicar, reflejar, duplicados, sustitución y plazos) están en `tests/contrato/ediciones-pendientes.json`, con casos que pasan las dos implementaciones.

## Consecuencias

- Quien edita ve el cambio al momento y sabe si se ha guardado o no, sin ir a GitHub.
- Cada edición pendiente hace como mucho una consulta a `/api/editar` y una lectura del catálogo por revisión (con espera creciente). El token del servidor admite 5000 consultas por hora.
- Una portada de algo que ya tenía portada no se puede confirmar de verdad, y un fallo de `buzon.yml` al procesarla no se detecta: pasados 10 minutos se da por guardada.
- Si el workflow va muy atrasado (más de 30 minutos), la edición se da por fallida aunque luego se aplique. Reintentar envía una operación que, aplicada dos veces, deja el mismo resultado.
- Las ediciones se guardan en cada navegador o teléfono: otra persona no ve la marca «Pendiente» de un cambio ajeno.

## Validación

- `tests/web-unit/api-editar.test.mjs`: estado con GitHub simulado, validación del número y solo incidencias de edición.
- `tests/web-unit/edit-pending.test.mjs` y `mobile/test/pending_edits_test.dart`: el contrato común y el gestor (persistencia, revisión, plazos y reintento).
- `tests/web-e2e/funcional.e2e.mjs`: pendiente → confirmada y pendiente → error → deshecha, con «Reintentar». `a11y.e2e.mjs`: la lista de cambios pendientes.
- `mobile/test/pending_edits_ui_test.dart`: lo mismo en la APK.
