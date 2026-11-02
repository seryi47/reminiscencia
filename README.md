# Reminiscencia · doctorado sobre música, memoria y Alzheimer

Proyecto doctoral y plataforma para estudiar y acompañar la relación entre la música, la memoria autobiográfica y el Alzheimer.

**Estado:** la plataforma funciona en la web y en la app Android. La biblioteca se gestiona con incidencias de GitHub (ADR-0008). Estudios con personas, pendientes.

| Qué | Dónde |
|---|---|
| Escuchar (público) | https://reminiscencia.vercel.app |
| App Android | `mobile/` (lee la biblioteca de la web) |
| Cambios en la biblioteca | Incidencias con la etiqueta `biblioteca`, procesadas por el workflow `biblioteca` |

## Cómo se usa

1. Abre una incidencia en el repositorio con la etiqueta **biblioteca**. Su cuerpo es una petición: líneas `clave: valor` con `action` (`import` u `organize`) y los campos de cada acción. El formato completo está en [ADR-0008](docs/decisions/ADR-0008-entrada-por-incidencias.md).
2. **Añadir audio:** `action: import` con una dirección de Internet Archive (`archive.org/details/…`) o con un enlace directo a un fichero de audio y su licencia, que es obligatoria. YouTube y las plataformas de streaming no se admiten.
3. Solo el propietario procesa las peticiones. El workflow descarga, convierte y guarda el resultado en el repositorio, responde en la incidencia y la cierra. Tarda unos minutos y la web se actualiza sola.
4. **Publicar o editar:** `action: organize` con un `payload` JSON en una sola línea, por ejemplo `{"op":"edit_song","song_id":"S…","public":true}`. Los identificadores de canción están en `audio-library/indexes/catalog.json`.

Las canciones nuevas quedan **privadas** hasta que las publicas, y la web solo muestra las públicas.

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
