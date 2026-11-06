# ADR-0007: Catálogo en el repositorio y flujo de trabajo desde Vercel

- Estado: aceptada. Los puntos 4 y 5 están superados por ADR-0008; su texto se conserva como historial.
- Fecha: 2026-10-31
- Sustituye: la base de datos SQLite local como fuente de verdad (ADR-0001 para la base de datos local queda para desarrollo sin Vercel)
- Nota de estado (2026-10-31): **administración retirada.** Los puntos 4 y 5 (administración en Vercel, funciones `api/*` y el workflow `library.yml`) quedan sustituidos por ADR-0008: toda escritura es una petición en una incidencia del propietario y el workflow es `biblioteca.yml`. Siguen vigentes el catálogo versionado, el audio en el repositorio, la publicación por `public` y el límite de los ficheros de GitHub (puntos 1 a 3 y 6).
- Nota de estado (2026-11-02): en main ya no hay administración. No existen `frontend/web/admin`, `api/` ni `frontend/web/lib`, y ningún código lee `ADMIN_PASSWORD` ni `GITHUB_TOKEN`. El punto 6 (la app Android) está implementado.

> **Nota (2026-11-05):** desde la fase 3 de [ADR-0020](ADR-0020-audio-en-r2.md), `frontend/web/audio/` ya no existe: el audio público lo sirve Cloudflare R2 y Vercel redirige `/audio/<id>.opus` al bucket.

> **Nota (2026-11-05, ADR-0024):** el catálogo sigue siendo la fuente de verdad en Git, pero el audio ya no: está en un bucket privado de Cloudflare R2. Ver [ADR-0024](ADR-0024-audio-privado-en-r2.md).

## Contexto

Quieres que todo funcione desde la web de Vercel y desde la APK, sin depender de tu equipo. Vercel no puede descargar ni convertir audio (límites de tiempo, memoria y ausencia de ffmpeg, y tu regla de no meter procesado pesado allí). GitHub Actions sí puede.

## Decisión

1. **Fuente de verdad:** `audio-library/indexes/catalog.json`, versionado en Git. Contiene carpetas, canciones, metadatos, licencia, hash y el indicador `public`. *Vigente.*
2. **Audio de reproducción de todas las canciones:** `audio-library/audio/<id>.opus` dentro del repositorio. Solo se sirve al público lo que está en `frontend/web/audio/`. Vercel sirve solo `frontend/web` (Root Directory), así que lo que está en `audio-library/` no es accesible desde la web. *Vigente.*
3. **Publicar** = copiar el audio a `frontend/web/audio/` y regenerar `frontend/web/data/*.json`. **Despublicar** = borrarlo de ahí. Lo hace un workflow, y Vercel redespliega al hacer push. *Vigente: lo hace `backend/sonidos/publish.py` dentro de `biblioteca.yml` (ADR-0008).*
4. **[Superado por ADR-0008]** Vercel sirve la web pública, la página de administración (`/admin`) y dos funciones ligeras (`/api/*`). Las funciones:
   - validan la contraseña de administración (`ADMIN_PASSWORD`). **Si la variable no existe, responden 503 y no hacen nada** (falla cerrada);
   - rechazan plataformas de vídeo y streaming (ADR-0005) antes de llamar a nada;
   - disparan el workflow `library.yml` con `GITHUB_TOKEN` (permiso mínimo: Actions y Contents del repositorio).

   *Qué queda vigente:* Vercel sirve la web estática de `frontend/web`. No hay página de administración, ni funciones `api/*`, ni contraseña (ADR-0008).
5. **[Superado por ADR-0008]** **Workflow `library.yml`** (`workflow_dispatch`): importar URL, publicar/despublicar, organizar carpetas y editar metadatos. Usa ffmpeg del runner, hace commit y push con `GITHUB_TOKEN`. Un grupo de concurrencia evita dos escrituras a la vez.

   *Qué queda vigente:* el workflow es `biblioteca.yml`, con tres jobs (`autorizar`, `procesar` y `publicar`; ADR-0008 y ADR-0010). Un único grupo de concurrencia (`library-catalog`) evita dos escrituras a la vez.
6. **APK:** leerá el catálogo público desde `https://reminiscencia.vercel.app/data/songs.json`.

   *Implementado:* `mobile/lib/library_store.dart` lee `data/songs.json` y `data/folders.json` de `https://reminiscencia.vercel.app/` y guarda una copia para escuchar sin conexión.

## Consecuencias

- El repositorio crece con el audio de todas las canciones. Se vigila con `scripts/check_repo_limits.py`: el script bloquea con más de 100 MiB por fichero o más de 5 GiB de repositorio, y solo avisa con más de 50 MiB por fichero o más de 1 GiB. Si el audio se acerca a 1 GB, pasar el audio a almacenamiento externo; eso requiere decisión y coste explícitos. Detalle en `docs/arquitectura/GITHUB_STORAGE.md`.
- **[Superado por ADR-0008]** La contraseña de administración es responsabilidad del usuario. Sin ella, la administración queda desactivada, no abierta. En main no hay contraseña de administración.
- Cada importación es un commit (su autor es `github-actions[bot]`). El historial de Git es el registro de lo que se ha añadido.
