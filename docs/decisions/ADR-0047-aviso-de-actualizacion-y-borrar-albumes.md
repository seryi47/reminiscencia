# ADR-0047: Aviso de actualización de la APK y borrar álbumes desde la interfaz

- Estado: **implementada y probada** (2026-11-16). Suites verdes: web `node --test tests/web-unit/*.test.mjs` 1035/1035; APK `flutter test` 659/659; backend `pytest` 1445/1445. Falta la verificación en vivo del usuario (dispositivo real), que no se puede hacer desde el entorno de desarrollo.
- Fecha: 2026-11-16.
- Relacionadas: [ADR-0027](ADR-0027-ediciones-pendientes.md) (ediciones pendientes), [ADR-0041](ADR-0041-despublicar-cancion.md) (despublicar canción), [ADR-0034](ADR-0034-worker-sirve-la-web.md) (releases y despliegue), [ADR-0008](ADR-0008-entrada-por-incidencias.md) (contrato de peticiones).

## Contexto

Dos peticiones del usuario, independientes:

1. **Avisar en la APK cuando hay una versión más nueva**, sin tener que pasar el APK al móvil a mano cada vez. Como la app no está en Google Play (se distribuye por GitHub Releases, ADR-0034), no hay actualización automática del sistema.
2. **Poder borrar un álbum** desde la interfaz, tanto en la web como en la APK. La operación `delete_folder` YA existía en el backend (`catalog.delete_folder`) y en la validación/contrato de la web, pero estaba **deliberadamente bloqueada** en el servidor de `/api/editar` y no existía ni botón web ni soporte en la APK (el contrato la marcaba `"apk": "no_aplica"`).

## Decisión

### 1. Aviso de actualización (chequeo al abrir)

- Al arrancar (`home_shell`), la app consulta la **última release pública de GitHub** (`GET /repos/seryi47/reminiscencia/releases/latest`, sin token) y compara su versión (`android-vX.Y.Z`) con la instalada (`kAppVersionName` en `lib/app_version.dart`). La lógica pura está en `lib/update_check.dart` (`checkForUpdate`, `isNewerVersion`), probada con un cliente simulado.
- Si hay una más nueva, muestra un diálogo con **«Actualizar»** (abre el APK `arm64-v8a` de la release con `url_launcher`; si no está, la página de la release) o **«Ahora no»** (sigue con la versión actual). No fuerza nada: el usuario decide. «Ahora no» recuerda esa versión en `SharedPreferences` para no volver a insistir hasta que haya otra más nueva.
- **Fail-open y silencioso:** cualquier fallo (sin red, respuesta rara, GitHub caído) no muestra aviso ni bloquea el arranque. Las pruebas lo apagan con `updateCheckEnabled=false` (`flutter_test_config.dart`) para no tocar la red ni dejar temporizadores.
- `kAppVersionName` debe ir sincronizado con `pubspec.yaml`; `android.yml` lo comprueba en CI (falla si no coinciden).
- La instalación en sí sigue siendo un toque manual (obligatorio en sideload de Android); lo que se automatiza es el **descubrimiento y la descarga**.

### 2. Borrar álbumes (`delete_folder`) en web y APK

- `delete_folder` **borra el álbum pero NO sus canciones**: suben al nivel superior (el padre del álbum; sueltas si no tiene), y las subcarpetas también. Es el comportamiento que ya tenía `catalog.delete_folder`; la vista optimista lo replica.
- **Servidor:** se añade `delete_folder` a `ALLOWED_OPS` de `edit-core.js` (antes se rechazaba con «pídela desde GitHub»). Entra por `/api/editar` como el resto (el Worker abre la incidencia con su token; lo aplica la Action con `catalog.delete_folder`).
- **Web:** `deleteAlbum(folder)` en `app.js` (confirmación + `delete_folder`), item «Eliminar álbum» en el menú del álbum (`collection.js`, solo álbumes editables), y vista optimista en `edit-pending.js` (apply: reparenta canciones y quita el álbum; reflected: el álbum ya no existe; describe: «Eliminar álbum»).
- **APK:** factoría `LibraryRequest.deleteAlbum`, `deleteAlbumFlow` + `ListTile` «Eliminar álbum» en la hoja del álbum (`library_edit.dart`), y las tres ramas en `pending_edits.dart`.
- **Contrato** (`tests/contrato/peticiones.json`): `delete_folder` pasa a `"apk": "deleteAlbum"`, `api_editar: true` y entra en `operaciones_api_editar`.

## Consecuencias

- Pruebas nuevas: APK `update_check_test.dart` (comparación de versiones, elección del APK arm64, casos de red); web `edit-pending.test.mjs` y APK `pending_edits_test.dart` (apply/reflected/describe de `delete_folder`); `library_requests_test.dart` (factoría), `library_ui_test.dart` (menú → confirmar → `delete_folder`), `contrato_peticiones_test.dart` (factoría `deleteAlbum`); web `api-editar.test.mjs` (delete_folder pasa de rechazada a admitida; `ALLOWED_OPS` y `organizeProblem` actualizados).
- APK `1.3.4+18 → 1.3.5+19`.
- **Qué NO se ha hecho (honestidad):** el aviso de actualización depende de que se publique la release en GitHub (etiqueta `android-vX.Y.Z`); mientras no haya una release ≥ a la instalada, no aparece aviso (correcto). La detección de arquitectura del APK se simplifica a preferir `arm64-v8a` (la de la mayoría de móviles, incluido el del usuario) y cae a la página de la release si no está.
- Verificación en vivo (móvil real) pendiente del usuario.
