# Reminiscencia · doctorado sobre música, memoria y Alzheimer

Proyecto doctoral y plataforma para estudiar y acompañar la relación entre la música, la memoria autobiográfica y el Alzheimer.

**Estado:** la plataforma funciona en la web y en la app Android. La biblioteca se gestiona desde la propia web, con incidencias de GitHub (ADR-0008). Estudios con personas, pendientes.

| Qué | Dónde |
|---|---|
| Escuchar y gestionar (público) | https://reminiscencia.vercel.app, sección «Gestionar» |
| App Android | `mobile/` (lee la biblioteca de la web) |
| Procesado de los cambios | Workflow `biblioteca`: lee las incidencias con la etiqueta `biblioteca` |

## Cómo se usa

1. Abre la sección **Gestionar** de la web. Cada formulario comprueba la petición y abre una incidencia nueva en GitHub con el texto ya escrito: solo queda pulsar «Submit new issue». El formato de las peticiones está en ADR-0008.
2. **Añadir audio:** pega una dirección de Internet Archive (`archive.org/details/…`) o un enlace directo a un fichero de audio con su licencia, que es obligatoria. YouTube y las plataformas de streaming no se admiten.
3. Solo el propietario procesa las peticiones. El workflow descarga, convierte y guarda el resultado en el repositorio, responde en la incidencia y la cierra. Tarda unos minutos y la web se actualiza sola.
4. Organiza en carpetas y edita título, artista, año, etiquetas y carpeta de las canciones publicadas. Las canciones nuevas quedan **privadas** y la web solo lista las públicas: para publicarlas hace falta su identificador (`song_id`) en `audio-library/indexes/catalog.json` (ADR-0008).

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
