# ADR-0022: Editar la biblioteca sin pasar por GitHub

- Estado: aceptada.
- Fecha: 2026-11-05
- Modifica: [ADR-0008](ADR-0008-entrada-por-incidencias.md) (las ediciones ya no abren GitHub en el navegador) y amplía [ADR-0017](ADR-0017-subida-directa-a-github.md) (segunda función de Vercel con token de servidor).

## Contexto

Cambiar un título, un artista, un álbum o una portada obligaba a abrir GitHub (incidencia con la etiqueta `biblioteca` o página de subida de portadas) y tener permiso de escritura. Orden del propietario: nada de ir a GitHub; todo se valida y se guarda en segundo plano desde la web o la APK.

## Decisión

1. **`POST /api/editar`** (`frontend/web/api/editar.js`, Node sin dependencias), con el mismo contrato para la web (`js/edit-remote.js`) y la APK (`lib/edit_remote.dart`). La app no guarda ningún token.
2. **Cambios de texto y álbumes** (JSON `{action: 'organize', payload}`): se valida con las mismas reglas de `incidencias.js` y se crea una incidencia con la etiqueta `biblioteca` usando el token del servidor, de modo que pasa por los tres jobs de ADR-0008. Operaciones permitidas: `create_folder`, `edit_folder`, `rename_folder` y `edit_song` sin `public`. Se rechazan `delete_folder`, `public` e `import`.
3. **Portadas** (`image/jpeg` con `X-Portada-Id`, S o F más 16 hex): máximo 1 MB y firma JPEG comprobada. Se guarda en `audio-library/buzon/portadas/<ID>.jpg`; `buzon.yml` la procesa a 640×640. La web y la APK recortan a 640 px antes de enviar.
4. **Token de Vercel**: necesita **Contents e Issues en escritura**. Con un 401 o 403 la función responde que falta ese permiso.
5. **Riesgo aceptado**: como en ADR-0017, cualquiera con acceso a la web puede proponer ediciones. Se excluyen borrar álbumes y publicar o despublicar. Pendiente: límite de uso por origen.

## Consecuencias

- Las ediciones llegan a todos en un par de minutos, sin abrir GitHub.
- `buildOrganizeIssueUrl`, `COVER_UPLOAD_URL` y `EDIT_NOTE` quedan sin uso en la web, y la APK ya no abre GitHub para editar.
