# ADR-0006: Audio publicado dentro del repositorio para la web

- Estado: aceptada
- Fecha: 2026-10-31
- Modifica: ADR-0003 (solo para el audio que se publica en la web)

## Contexto

El despliegue de Vercel sale de GitHub (Git integration). Vercel solo sirve lo que está en el repositorio, y el audio de `frontend/web/audio/` estaba fuera de Git, así que la web devolvía 404 en cada pista.

Un release privado de GitHub no sirve como origen para un navegador, porque sus assets requieren autenticación. Un almacenamiento externo (por ejemplo Vercel Blob) añadiría un servicio nuevo y coste.

## Decisión

El audio que se publica en la web (`frontend/web/audio/*.opus`) se versiona en el repositorio. Es la misma fuente que despliega Vercel, y mantiene GitHub como centro, como pediste.

Límites que se vigilan (docs.github.com, verificados): fichero < 100 MiB (el aviso está en 50 MiB), repositorio ideal < 1 GB, máximo recomendado < 5 GB. El script `scripts/check_repo_limits.py` falla en CI si se incumplen.

## Cuándo cambiar

- Si el audio publicado se acerca a 1 GB, pasar el audio a un almacenamiento externo (Vercel Blob o similar) y dejar en Git solo el índice. Eso requiere decisión y coste explícitos.
- Los audios no publicados también están en Git, en `audio-library/audio/`: el catálogo los necesita para publicarlos después. Lo que se sirve al público es solo `frontend/web/audio/` (lo publicado), según ADR-0007.
