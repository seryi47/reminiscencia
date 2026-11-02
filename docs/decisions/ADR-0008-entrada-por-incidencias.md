# ADR-0008: Entrada de la biblioteca por incidencias de GitHub

- Estado: aceptada
- Fecha: 2026-10-31
- Sustituye: la administración en Vercel de ADR-0007 (puntos 4 y 5) y la entrada por `/admin/` de la actualización de ADR-0005.

## Contexto

La biblioteca se gestionaba desde una página de administración en Vercel, protegida con una contraseña, con funciones `api/*` que disparaban el workflow `library.yml` usando un token de GitHub. Esa parte añadía un secreto en la web, varias funciones que mantener y una superficie de ataque que no hacía falta.

El investigador decide que no habrá administración de momento: todo lo de gestión vive en la página pública. Hace falta una forma de importar, organizar y publicar canciones sin panel propio y sin secretos en el navegador.

## Decisión

1. **No hay administración.** No existe contraseña de administración, ni token de GitHub en la web, ni funciones de Vercel (`api/`), ni `frontend/web/admin`, ni `frontend/web/lib`. La página pública es la única interfaz.
2. **Toda escritura en el catálogo es una petición.** Una petición es un texto de líneas `clave: valor` (claves `action`, `url`, `license`, `title`, `payload`). Se envía como incidencia del repositorio con la etiqueta `biblioteca`. El contrato está implementado y probado en `backend/sonidos/issue_request.py`.
3. **Solo el propietario procesa.** El workflow `.github/workflows/biblioteca.yml` actúa sobre una incidencia solo si su autor es el propietario del repositorio y la incidencia lleva la etiqueta `biblioteca`. También puede lanzarse a mano (`workflow_dispatch`) con los mismos campos.
4. **Un solo camino de procesado.** El workflow valida la petición (`scripts/issue_request.py`), la aplica al catálogo (`scripts/ci_library.py`), guarda el resultado con un commit de `github-actions[bot]` y responde en la incidencia (`scripts/responder_incidencia.py`). Cierra la incidencia si todo salió bien y le añade la etiqueta `error` si algo falló.
5. **Sin secretos nuevos.** El workflow usa el `GITHUB_TOKEN` del propio job, con `contents: write` e `issues: write`.

## Alternativas descartadas

- **Contraseña compartida en la web.** Cualquier secreto que la página pueda comprobar o enviar acaba al alcance de quien lea la página pública. Además obliga a guardarla en Vercel.
- **Endpoint público con autenticación propia (token en una API).** Obliga a mantener un servicio, almacenar un secreto y proteger una superficie que hoy no existe.
- **OAuth propio con GitHub.** Necesita callback, sesiones y almacenamiento de tokens para un único usuario.
- **Panel en Vercel con contraseña (ADR-0007 original).** Retirado por decisión del investigador.

## Control de acceso

| Capa | Control |
|---|---|
| Repositorio | Solo el propietario y los colaboradores pueden etiquetar incidencias o lanzar el workflow. |
| Workflow | Se ejecuta con `workflow_dispatch`, o con una incidencia cuyo autor es `github.repository_owner` y tiene la etiqueta `biblioteca`. |
| Entrada | Máximo 8000 caracteres por petición; claves y operaciones en lista blanca; ids con formato fijo; booleanos JSON estrictos; límites de longitud por campo. |
| Ejecución | Ningún texto de la incidencia se interpola en un script: pasa por variables de entorno. Concurrencia `library-catalog` sin cancelación y con cola (`queue: max`): una petición en espera no se cancela sin respuesta. Solo `main` escribe en el catálogo (guarda de rama en el paso de guardado). El checkout no guarda el token (`persist-credentials: false`) y el push lo recibe solo en su paso. Los permisos se declaran en el job. |
| Salida | Commit solo si hay cambios. `scripts/check_repo_limits.py` se ejecuta antes de subir. |

## Riesgos

- **Repositorio público.** Si el repositorio se hace público, cualquiera puede abrir una incidencia. El filtro de autor es imprescindible: sin él, cualquier usuario podría provocar escrituras si consiguiera la etiqueta. Con él, el workflow ignora las incidencias de otros usuarios aunque traigan la etiqueta. Antes de hacer público el repositorio hay que revisar este filtro y los permisos de etiquetado.
- **Metadatos de canciones no publicadas.** Desde la corrección de 2026-11-02, `frontend/web/data/catalog.json` solo lista las canciones públicas: título, artista, licencia y origen de las no publicadas no salen de `audio-library/`, porque la web es pública. La página no muestra las no publicadas; para publicarlas hay que usar su `song_id` de `audio-library/indexes/catalog.json`. **Decisión aplicada, a confirmar por el investigador:** si quiere ver también las no publicadas en la página, habrá que decidir cómo sin publicar sus metadatos.
- **Licencias no verificadas.** En ficheros directos la licencia la declara quien escribe la petición (ADR-0005). El sistema no la comprueba.
- **Latencia.** Cada escritura tarda lo que tarda un workflow de GitHub Actions (minutos), no es inmediata.
- **Etiqueta en el momento de crear la incidencia.** El workflow se dispara con el evento `opened`. Si la etiqueta se añade después de crear la incidencia, el workflow no se lanza.

## Formato de la petición

Importar desde Internet Archive (la licencia se toma del ítem; `license` es opcional):

```
action: import
url: https://archive.org/details/<identificador>
title: (opcional, máximo 200 caracteres)
```

Importar un fichero directo (la licencia es obligatoria):

```
action: import
url: https://ejemplo.org/pistas/tema.flac
license: CC0 1.0
title: (opcional)
```

Organizar (una sola línea de JSON en `payload`; no admite `url`, `license` ni `title`):

```
action: organize
payload: {"op":"edit_song","song_id":"S0123456789abcdef","public":true,"tags":["jazz"]}
```

Operaciones: `create_folder` (`name`, `parent_id`), `rename_folder` (`folder_id`, `name`), `delete_folder` (`folder_id`) y `edit_song` (`song_id` y, opcionalmente, `title`, `artist`, `year`, `tags`, `folder_id` y `public`). Publicar y despublicar es `edit_song` con `public`.

Reglas: una clave por línea; una clave desconocida o repetida es un error; una línea sin dos puntos se ignora; una clave con valor vacío equivale a no enviarla; los ids de carpeta son de 10 caracteres hexadecimales en minúscula y los de canción, `S` seguida de 16; `public` y los demás booleanos son `true` o `false` de JSON, nunca texto.

## Relación con otras decisiones

- ADR-0002 y ADR-0005: fuentes admitidas, plataformas bloqueadas y licencia obligatoria en ficheros directos. Sin cambios; la validación de URL vive en `backend/sonidos/sources.py`.
- ADR-0006: el audio publicado sigue en `frontend/web/audio/`.
- ADR-0007: el catálogo versionado, el audio en el repositorio y los commits del bot siguen vigentes. Su parte de administración queda sustituida por este ADR.

## Qué se verificó

- `python -m pytest -q` en `backend/`: 261 pruebas en verde (164 de la entrega original, 48 añadidas en la corrección de 2026-11-02 y 49 de la ronda de corrección posterior: guardas de plataformas y CDN, redes privadas, títulos de Internet Archive, descargas cortadas, rama `main` y cola del workflow). La corrección de 2026-11-02 se ejecutó con Python 3.14 y con Python 3.11.14; la ronda posterior, con Python 3.14.6.
- Subproceso de `scripts/issue_request.py` con `BODY` y `GITHUB_ENV` temporales: éxito en modo incidencia, error con código 1 sin escribir nada, modo manual y ausencia de `GITHUB_ENV`.
- Simulación del flujo del workflow con ficheros temporales: petición válida, petición con plataforma bloqueada, edición con etiquetas normalizadas y respuesta de éxito y de error.
- `python3 scripts/check_repo_limits.py`: correcto.
- Sintaxis de `.github/workflows/biblioteca.yml` con `ruby -ryaml -e 'YAML.load_file(...)'` y con PyYAML: correcta.
- `frontend/web/data/`: regenerado con `sonidos.publish.sync_public`. `songs.json` y `folders.json` quedan byte a byte iguales; `catalog.json` contiene solo las 9 canciones públicas (antes 11, con las dos no publicadas).
- Corrección de 2026-11-02 (revisión de seguridad de la rama, hallazgos de severidad alta y media): catálogo público solo con canciones publicadas; plataformas comparadas por host canónico (punto final, ancho completo, U+3002 y guion blando); cada redirección de una descarga se revisa (solo http o https, sin plataformas bloqueadas); licencia de Internet Archive leída de la ruta de creativecommons.org; nombre de fichero de Internet Archive validado y codificado en la URL; checkout sin credenciales persistidas; retirados `frontend/web/admin/`, `api/` y `lib/`. Pruebas nuevas: `test_intake.py` (descargas contra un servidor local en 127.0.0.1, sin red externa) y casos añadidos en `test_sources.py`, `test_issue_request.py`, `test_publish.py` y `test_biblioteca_workflow.py`.

**No verificado:** el workflow no se ha ejecutado en GitHub Actions, ni antes ni después de la corrección de 2026-11-02. Falta una incidencia de prueba con la etiqueta `biblioteca` y una ejecución manual con `workflow_dispatch` antes de dar el flujo por cerrado.
