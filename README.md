# Reminiscencia · doctorado sobre música, memoria y Alzheimer

Proyecto doctoral y plataforma para estudiar y acompañar la relación entre la música, la memoria autobiográfica y el Alzheimer.

**Estado (2026-11-02):** la web pública de escucha y la app Android funcionan con la biblioteca publicada: 9 canciones públicas, y las privadas no se muestran. La biblioteca se gestiona con incidencias de GitHub (ADR-0008); no hay panel de administración. La interfaz única, con modo paciente y modo cuidador, está implementada (ADR-0009); su parte visual está pendiente de rediseño. Estudios con personas, pendientes.

| Qué | Dónde |
|---|---|
| Escuchar (público) | https://reminiscencia.vercel.app |
| App Android | `mobile/` (lee la biblioteca de la web) |
| Cambios en la biblioteca | Incidencias con la etiqueta `biblioteca`, procesadas por el workflow `biblioteca` |

## Qué es la web pública

https://reminiscencia.vercel.app es la interfaz pública de la biblioteca, en una sola página con dos modos. El **modo paciente** escucha las grabaciones de dominio público por listas y carpetas, con búsqueda y reproductor, y solo muestra las canciones publicadas. El **modo cuidador** guarda perfiles, recuerdos, fotografías, observaciones e historial solo en el navegador (IndexedDB); no hay cuentas ni sincronización, y la copia cifrada `.rmc` es la única vía para llevar los datos a otro dispositivo (ADR-0009). Vercel sirve la carpeta `frontend/web/`, y los datos que lee son los que genera el repositorio (`data/` y `audio/`).

El modo cuidador tiene además **Gestionar la biblioteca**, en la sección Biblioteca. Valida la petición en el navegador y abre en GitHub una incidencia nueva con el texto ya escrito; hay que pulsar «Submit new issue» para enviarla. La web no tiene contraseña ni token, y solo las cuentas con permiso de escritura procesan las peticiones (job `autorizar`).

## Cómo se usa

Cada cambio en la biblioteca es una petición: una incidencia con la etiqueta **biblioteca** cuyo cuerpo tiene líneas `clave: valor`. Las claves son `action`, `url`, `license`, `title` y `payload`. El formato completo está en [ADR-0008](docs/decisions/ADR-0008-entrada-por-incidencias.md).

### Añadir una canción

1. Abre una incidencia con la etiqueta **biblioteca** ya puesta. El workflow se lanza al abrir la incidencia: si la etiqueta se añade después, no se procesa.
2. En el cuerpo, escribe:

   ```
   action: import
   url: https://archive.org/details/<identificador-del-ítem>
   ```

   También se admite `archive.org/download/<identificador-del-ítem>`.
3. Para un fichero de audio directo, fuera de Internet Archive, `license:` es obligatoria y debe declarar la licencia. YouTube y las plataformas de streaming no se admiten.

Las canciones nuevas quedan **privadas** hasta que las publicas.

### Publicar, despublicar o editar

Abre otra incidencia con la etiqueta **biblioteca** y un `payload` JSON en una sola línea. `action: organize` no admite las claves `url`, `license` ni `title`:

```
action: organize
payload: {"op":"edit_song","song_id":"S<16 caracteres hexadecimales>","public":true}
```

- `"public":true` publica la canción; `"public":false` la despublica. Son booleanos JSON, no texto.
- Los identificadores tienen la forma `S` seguida de 16 caracteres hexadecimales, y están en `audio-library/indexes/catalog.json`.
- `edit_song` también admite `title`, `artist`, `year`, `tags` y `folder_id`. Las carpetas se gestionan con `create_folder`, `rename_folder` y `delete_folder`. No hay borrado de canciones: hoy solo se despublican.

### Qué pasa después

El workflow `biblioteca` valida la petición, aplica el cambio al catálogo, guarda el resultado en `main` y responde en la incidencia. Si todo sale bien, la cierra. Si algo falla, le añade la etiqueta `error` y la deja abierta. En la prueba real del 2 de noviembre de 2026 (incidencias #1 a #3), cada petición tardó menos de dos minutos. La web se actualiza cuando Vercel despliega `main`.

## Documentación

- [CLAUDE.md](CLAUDE.md): reglas de trabajo, restricciones y arquitectura.
- [PROJECT_MASTER.md](PROJECT_MASTER.md): estado completo del proyecto.
- [ROADMAP.md](ROADMAP.md) y [CHANGELOG.md](CHANGELOG.md): fases y cambios.
- [RESEARCH.md](RESEARCH.md), [ALZHEIMER_RESEARCH.md](ALZHEIMER_RESEARCH.md), [METHODOLOGY.md](METHODOLOGY.md), [BIBLIOGRAPHY.md](BIBLIOGRAPHY.md) y [SECURITY.md](SECURITY.md): investigación, referencias verificadas, seguridad y privacidad.
- [docs/decisions/](docs/decisions/): decisiones de arquitectura (ADR).
- [docs/user-experience/](docs/user-experience/): diseño de la interfaz y del reproductor.

## Pruebas

Backend:

```
cd backend
python3 -m venv .venv && ./.venv/bin/pip install -e ".[dev]"
./.venv/bin/python -m pytest -q
```

Web, desde la raíz:

```
node --test "tests/web-unit/*.test.mjs"
```

Extremo a extremo y de accesibilidad (necesitan Chrome; si no está en una ruta habitual, indicarla en `CHROME_PATH`):

```
cd tests/web-e2e && npm ci && npm test
```

## Aviso

No se descarga música de plataformas de vídeo ni de streaming. Solo se importan grabaciones cuya licencia se declara o se lee de su ítem original (ADR-0002, ADR-0005). Los resultados clínicos no están demostrados (RESEARCH.md).
