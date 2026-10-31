# CLAUDE.md: instrucciones permanentes

## Objetivo
Proyecto doctoral sobre música, memoria y Alzheimer, con una plataforma que sirve para estudiar las hipótesis. La investigación y el desarrollo avanzan en paralelo. Ver [PROJECT_MASTER.md](PROJECT_MASTER.md).

## Reglas de desarrollo
- Idioma de la documentación y de los mensajes al usuario: español. Identificadores de código: inglés.
- Cada cambio de funcionalidad va con pruebas. Nada se marca como terminado sin haberlo ejecutado.
- Antes de dar algo por hecho, ejecutar `python -m pytest -q` en `backend/`.
- Al cerrar una tarea, revisar con grep los `.md` del repositorio y corregir lo que quede obsoleto.
- Las decisiones importantes van en un ADR nuevo en `docs/decisions/` (arquitectura, legalidad, presupuesto, viabilidad científica).
- Verificar cada referencia científica antes de citarla. Lo no verificado va como pendiente en [BIBLIOGRAPHY.md](BIBLIOGRAPHY.md).

## Restricciones (no negociables)
- **Sin descarga de plataformas.** Nunca descargar desde YouTube, servicios de streaming ni de vídeo (ADR-0002, reafirmado en ADR-0005). La entrada por URL solo acepta Internet Archive con licencia en los metadatos o ficheros directos con licencia declarada. La lista de bloqueo está en `backend/sonidos/sources.py` y en `frontend/web/lib/validate.js`; ambas deben coincidir.
- **Todo corre en GitHub y Vercel.** No hay panel local ni base de datos local: la fuente de verdad es `audio-library/indexes/catalog.json` (ADR-0007). El procesado pesado (descarga, ffmpeg) va en GitHub Actions, nunca en Vercel.
- **Audio.** El audio de la biblioteca se versiona en `audio-library/audio/` (ADR-0007). Solo se publica al público lo que está en `frontend/web/audio/` (ADR-0006). Vigilar los límites de GitHub con `scripts/check_repo_limits.py`.
- **Sin datos personales de pacientes en el repositorio.** Nombres, fotografías y recuerdos reales nunca se versionan. Las personas se identifican con alias o identificadores.
- **Sin filtros destructivos** sobre el audio por defecto. Cualquier normalización o limpieza debe medirse antes de activarse.
- **Sin prometer resultados clínicos.** Toda afirmación sobre efectos de la música se presenta como hipótesis o como evidencia con su nivel.
- **Secretos fuera del repositorio.** `GITHUB_TOKEN` y `ADMIN_PASSWORD` viven en las variables de entorno de Vercel. La administración falla cerrada: sin `ADMIN_PASSWORD`, nada se ejecuta. Las claves de firma de Android están en `~/.android-keys/`.

## Arquitectura (resumen)
- `backend/sonidos/`: `catalog` (catálogo JSON, fuente de verdad), `pipeline` (importar una URL), `publish` (sincroniza lo publicado con la web), `intake` y `sources` (fuentes con licencia), `probe`, `hashing`, `compression` (ffmpeg), `limits` y `release` (límites de GitHub).
- `scripts/ci_library.py`: punto de entrada del workflow; lee sus entradas de variables de entorno, nunca de la línea de comandos.
- `scripts/check_repo_limits.py`: límites de GitHub (CI).
- `.github/workflows/library.yml`: escrituras al catálogo (importar, publicar, organizar). Concurrencia única; hace commit y push.
- `.github/workflows/backend.yml`: pruebas de Python, app Flutter y límites del repositorio.
- `frontend/web/`: web pública de escucha (`index.html`, `app.js`, `listen.css`), administración (`admin/`), funciones de Vercel (`api/catalog.js`, `api/dispatch.js`, `api/runs.js`) y utilidades (`lib/auth.js`, `lib/github.js`, `lib/validate.js`). Vercel sirve solo esta carpeta (Root Directory).
- `mobile/`: app Flutter (lee la biblioteca de la web y guarda copia para escuchar sin conexión).
- `audio-library/`: catálogo (`indexes/catalog.json`) y audio (`audio/`).
- `docs/`: decisiones (ADR), arquitectura, procesado de audio.

## Cómo ejecutar
```
cd backend
python3 -m venv .venv && ./.venv/bin/pip install -e ".[dev]"
./.venv/bin/python -m pytest -q
```
Requiere ffmpeg y ffprobe en el PATH (en GitHub Actions ya se instalan). La administración no se ejecuta en local: es la web de Vercel.
