# Doctorado: Sonidos, memoria y Alzheimer

Proyecto doctoral y plataforma tecnológica para estudiar y acompañar la relación entre la música, la memoria autobiográfica y el Alzheimer.

**Estado:** fases 1 a 5 en marcha. Biblioteca con 8 pistas de dominio público; web de reproducción pública en https://reminiscencia.vercel.app; app Android firmada para producción y probada en emulador. Estudios con personas, pendientes.

## Documentación
- [CLAUDE.md](CLAUDE.md): reglas de trabajo y restricciones.
- [PROJECT_MASTER.md](PROJECT_MASTER.md): estado completo del proyecto.
- [RESEARCH.md](RESEARCH.md) y [BIBLIOGRAPHY.md](BIBLIOGRAPHY.md): investigación y referencias verificadas.
- [ROADMAP.md](ROADMAP.md) y [CHANGELOG.md](CHANGELOG.md).
- [docs/decisions/](docs/decisions/): decisiones de arquitectura.

## Uso rápido del backend

```
cd backend
python3 -m venv .venv && ./.venv/bin/pip install -e ".[dev]"
./.venv/bin/python -m pytest -q

# Importar un archivo con licencia declarada
./.venv/bin/python -m sonidos import ruta/al/archivo.wav --license "CC-BY-4.0" --variant opus-64k --audio-dir ../audio-library/audio
./.venv/bin/python -m sonidos list
./.venv/bin/python -m sonidos export-index --output ../audio-library/indexes/songs.json
```

Requiere ffmpeg y ffprobe.

## Aviso
Este proyecto no descarga música de plataformas de vídeo ni de streaming. Sólo importa archivos cuya licencia se declara. Ver [ADR-0002](docs/decisions/ADR-0002-fuentes-de-audio.md).

Los resultados clínicos no están demostrados. Ver [RESEARCH.md](RESEARCH.md).
