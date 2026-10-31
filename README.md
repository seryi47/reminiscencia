# Reminiscencia · doctorado sobre música, memoria y Alzheimer

Proyecto doctoral y plataforma para estudiar y acompañar la relación entre la música, la memoria autobiográfica y el Alzheimer.

**Estado:** la plataforma funciona en la web y en la app Android. La biblioteca se gestiona desde Vercel. Estudios con personas, pendientes.

| Qué | Dónde |
|---|---|
| Escuchar (público) | https://reminiscencia.vercel.app |
| Administrar (contraseña) | https://reminiscencia.vercel.app/admin/ |
| App Android | `mobile/` (lee la biblioteca de la web) |
| Trabajos de importación y edición | GitHub Actions: workflow `library` |

## Cómo se usa

1. Entra en **/admin/** con la contraseña de administración.
2. **Añadir audio:** pega una dirección de Internet Archive (`archive.org/details/…`) o un enlace directo a un fichero de audio con su licencia. YouTube y las plataformas de streaming no se admiten.
3. El trabajo se ejecuta en GitHub (descarga, conversión y guardado en el repositorio). Tarda 1-3 minutos y la web se actualiza sola.
4. Organiza en carpetas, edita título, artista, año y etiquetas, y **publica** las canciones que quieras en la web.

Las canciones nuevas quedan **privadas** hasta que las publicas.

## Documentación

- [CLAUDE.md](CLAUDE.md): reglas de trabajo y arquitectura.
- [PROJECT_MASTER.md](PROJECT_MASTER.md): estado completo del proyecto.
- [RESEARCH.md](RESEARCH.md) y [BIBLIOGRAPHY.md](BIBLIOGRAPHY.md): investigación y referencias verificadas.
- [ROADMAP.md](ROADMAP.md) y [CHANGELOG.md](CHANGELOG.md).
- [docs/decisions/](docs/decisions/): decisiones de arquitectura (ADR).

## Pruebas

```
cd backend
python3 -m venv .venv && ./.venv/bin/pip install -e ".[dev]"
./.venv/bin/python -m pytest -q
```

## Aviso

No se descarga música de plataformas de vídeo ni de streaming. Solo se importan grabaciones cuya licencia se declara o se lee de su ítem original (ADR-0002, ADR-0005). Los resultados clínicos no están demostrados (RESEARCH.md).
