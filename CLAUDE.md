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
- **Sin descarga de plataformas.** No implementar adaptadores que descarguen desde YouTube ni servicios de streaming (ADR-0002).
- **Sin audio en el repositorio.** El audio de reproducción va como assets de GitHub Releases (ADR-0003). `audio-library/audio/` está en `.gitignore`.
- **Sin datos personales de pacientes en el repositorio.** Nombres, fotografías y recuerdos reales nunca se versionan. Las personas se identifican con alias o identificadores.
- **Sin filtros destructivos** sobre el audio por defecto. Cualquier normalización o limpieza debe medirse antes de activarse.
- **Sin prometer resultados clínicos.** Toda afirmación sobre efectos de la música se presenta como hipótesis o como evidencia con su nivel.
- **Sin secretos en el repositorio.** Las credenciales van en variables de entorno o en GitHub Secrets.

## Arquitectura (resumen)
- `backend/sonidos/`: probe (ffprobe), hashing, compression (ffmpeg), library (SQLite), importer, cli.
- `backend/tests/`: pruebas con audio sintético.
- `audio-library/`: índices (versionados) y audio (ignorado).
- `docs/`: decisiones, arquitectura, procesado de audio.
- GitHub: código, documentación, pruebas, índice, releases de audio, Actions, incidencias y roadmap.

## Cómo ejecutar
```
cd backend
python3 -m venv .venv && ./.venv/bin/pip install -e ".[dev]"
./.venv/bin/python -m pytest -q
```
Requiere ffmpeg y ffprobe en el PATH.
