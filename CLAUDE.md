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
- **Sin descarga de plataformas.** Nunca descargar desde YouTube, servicios de streaming ni de vídeo (ADR-0002, reafirmado en ADR-0005). La entrada por URL solo acepta Internet Archive con licencia en los metadatos o ficheros directos con licencia declarada. La lista de bloqueo está en `backend/sonidos/sources.py` y en `frontend/web/js/intake.js`; ambas deben coincidir, y la web no puede aceptar más de lo que acepta el backend (ADR-0008).
- **Todo corre en GitHub y Vercel.** No hay panel local ni base de datos local: la fuente de verdad es `audio-library/indexes/catalog.json` (ADR-0007). El procesado pesado (descarga, ffmpeg) va en GitHub Actions, nunca en Vercel.
- **Audio.** El audio de la biblioteca se versiona en `audio-library/audio/` (ADR-0007). Solo se publica al público lo que está en `frontend/web/audio/` (ADR-0006). Vigilar los límites de GitHub con `scripts/check_repo_limits.py`.
- **Sin datos personales de pacientes en el repositorio.** Nombres, fotografías y recuerdos reales nunca se versionan. Las personas se identifican con alias o identificadores.
- **Sin filtros destructivos** sobre el audio por defecto. Cualquier normalización o limpieza debe medirse antes de activarse.
- **Sin prometer resultados clínicos.** Toda afirmación sobre efectos de la música se presenta como hipótesis o como evidencia con su nivel.
- **Secretos fuera del repositorio.** No hay administración ni secretos en la web (ADR-0008): la página pública no guarda contraseñas ni tokens. Las claves de firma de Android están en `~/.android-keys/`.

## Arquitectura (resumen)
- `backend/sonidos/`: `catalog` (catálogo JSON, fuente de verdad), `pipeline` (importar una URL), `publish` (sincroniza lo publicado con la web), `intake` y `sources` (fuentes con licencia), `probe`, `hashing`, `compression` (ffmpeg), `limits` y `release` (límites de GitHub).
- `scripts/ci_library.py`: punto de entrada del workflow; lee sus entradas de variables de entorno, nunca de la línea de comandos.
- `scripts/check_repo_limits.py`: límites de GitHub (CI).
- `.github/workflows/biblioteca.yml`: escrituras al catálogo desde incidencias del propietario con la etiqueta `biblioteca` o a mano (ADR-0008). Concurrencia única; hace commit y push.
- `.github/workflows/backend.yml`: pruebas de Python, app Flutter, límites del repositorio y pruebas de la web (`web-unit`).
- `frontend/web/`: web pública de escucha y de gestión (`index.html`, `app.js`, `js/gestion.js`, `js/intake.js`, `listen.css`, `styles.css`) y datos publicados (`data/`, `audio/`). No tiene administración ni funciones de Vercel (ADR-0008). Vercel sirve solo esta carpeta (Root Directory).
- `mobile/`: app Flutter (lee la biblioteca de la web y guarda copia para escuchar sin conexión).
- `audio-library/`: catálogo (`indexes/catalog.json`) y audio (`audio/`).
- `docs/`: decisiones (ADR) y procesado de audio (`docs/audio-processing/`).

## Cómo ejecutar
```
cd backend
python3 -m venv .venv && ./.venv/bin/pip install -e ".[dev]"
./.venv/bin/python -m pytest -q
```
Requiere ffmpeg y ffprobe en el PATH (en GitHub Actions ya se instalan).

Pruebas de la web, desde la raíz: `node --test "tests/web-unit/*.test.mjs"`.
