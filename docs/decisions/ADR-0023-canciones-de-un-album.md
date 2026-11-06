# ADR-0023: Quitar canciones de un álbum y añadir varias con buscador

- Estado: aceptada (rama `feature/albumes-quitar-y-buscar`, 2026-11-05; pendiente de fusionar en main).
- Fecha: 2026-11-05.
- Relacionadas: ADR-0008 (peticiones por incidencias), ADR-0016 (álbumes), ADR-0022 (editar sin GitHub, `/api/editar`).

> **Nota (2026-11-05):** la causa de los fallos del contexto la resuelven [ADR-0025](ADR-0025-publicar-robusto.md) (`publicar` ya no rechaza el paquete si `main` cambió sin tocar la biblioteca, y reintenta el push con rebase) y [ADR-0024](ADR-0024-audio-privado-en-r2.md) (`/api/subir` ya no escribe en `main`). `move_songs` sigue teniendo sentido: una petición en lugar de N.

## Contexto

- La APK tenía «Añadir canciones a este álbum», pero sin buscador y con una petición por canción. La web no lo tenía.
- Ninguna de las dos permitía quitar una canción de un álbum desde el propio álbum. Solo se podía con «Añadir a un álbum» › «Sin álbum» o «Sacar del álbum».
- Cada petición abre una incidencia y una ejecución de `biblioteca.yml`. Las ejecuciones van en cola, una detrás de otra (`queue: max`). Pero `publicar` rechaza el paquete si main cambió mientras se procesaba (por ejemplo, por una subida de `/api/subir`). Así fallaron 7 de las últimas 30 ejecuciones el 2026-11-03.
- Por eso, añadir N canciones con N peticiones multiplicaba los fallos y dejaba el álbum a medias.

## Decisión

1. **Operación nueva `move_songs`.**
   - Forma: `{"op":"move_songs","song_ids":[…],"folder_id":"F…"|null}`.
   - Admite de 1 a 100 ids de canción sin repetir; 100 caben de sobra en los 4000 caracteres del payload. `folder_id` es obligatorio y admite `null` (sin álbum).
   - **Es atómica:** `scripts/ci_library.py` comprueba primero que existen todas las canciones y el álbum. Si falta algo, el catálogo no cambia.
   - Está permitida en `/api/editar` (`ALLOWED_OPS`).
   - La validan los tres sitios con las mismas reglas: `sonidos.issue_request.validate_payload`, `validateOperation` en `js/cuidador/incidencias.js` y `LibraryRequest.moveSongs` en la APK.
2. **«Añadir canciones» en un álbum, igual en la web y en la APK:**
   - buscador sin distinguir acentos ni mayúsculas, por título, artista y álbum actual;
   - casillas para elegir varias, que se mantienen al cambiar la búsqueda;
   - botón «Añadir (N)», con un máximo de 100;
   - se envía una sola petición `move_songs`;
   - solo aparecen las canciones de la biblioteca común que se pueden editar y que no están ya en el álbum.
3. **«Quitar de este álbum»:**
   - está en el menú de cada canción, solo dentro del álbum en el que está;
   - pide confirmación y envía `edit_song` con `folder_id: null`;
   - la canción y su audio siguen en la biblioteca y solo pierden la relación con el álbum.

## Consecuencias

- Añadir varias canciones es una sola incidencia y un solo commit: o entran todas o ninguna.
- Los cambios llegan a todos cuando `biblioteca.yml` termina, en un par de minutos. Hasta entonces el álbum se ve como antes. Repetir la petición no causa daño: poner una canción en el álbum en el que ya está no cambia el catálogo.

## Validación

- **Backend:**
  - `test_issue_request.py`: forma correcta, `folder_id` nulo, listas vacías, de más de 100 o con repetidos, ids no válidos, campos de más y 100 ids dentro del límite.
  - `test_ci_library.py`: mueve varias, quita una sin borrarla y es atómica si falta una canción o el álbum.
- **Web y APK:** pruebas unitarias, de extremo a extremo y de widgets, con el detalle en el CHANGELOG.
