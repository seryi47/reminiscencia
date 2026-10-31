# CHANGELOG

## [Sin publicar]

### Añadido
- Estructura inicial del proyecto y control de versiones.
- Núcleo de backend en Python: lectura de metadatos con ffprobe, huella SHA-256, perfiles de transcodificación (Opus, AAC, MP3), biblioteca SQLite con detección de duplicados y licencia obligatoria, índice JSON sin rutas locales, CLI.
- 11 pruebas automatizadas con audio sintético generado por ffmpeg; todas pasan en local.
- Flujo de integración continua en GitHub Actions (Python 3.12 y 3.13).
- Documentación: CLAUDE.md, PROJECT_MASTER.md, RESEARCH.md, BIBLIOGRAPHY.md, ROADMAP.md, ADR-0001 a ADR-0003, COMPRESSION.md.

### Añadido (límites y publicación)
- `sonidos/limits.py`: constantes de los límites verificados de GitHub; rechaza assets de release de 2 GiB o más; reparte en lotes de hasta 999 assets más manifiesto; audita los ficheros versionados (aviso > 50 MiB, bloqueo > 100 MiB, repositorio > 1 GiB ideal y > 5 GiB máximo).
- `sonidos/release.py`: manifiesto SHA256SUMS y comandos `gh release create/upload`. Sólo simula salvo que se pida ejecutar.
- `scripts/check_repo_limits.py` y job de GitHub Actions que falla si el repositorio incumple los límites.
- 11 pruebas nuevas (22 en total).

### Añadido (biblioteca, web y Android)
- Ocho grabaciones de dominio público de Internet Archive (declaradas en el ítem original), importadas con su licencia y con variante Opus 64 kbps. Verificadas por SHA-256 tras descargarlas de la release.
- Publicación del lote de audio como release privada `audio-2026-10-31-01` en GitHub, con manifiesto SHA-256. Corregido un fallo: las variantes tenían el mismo nombre y se pisaban.
- Web de reproducción en HTML estático, desplegada en Vercel. Probada en Chrome: carga, reproducción, siguiente y pausa.
- App Flutter (`mobile/`) con reproducción en segundo plano, controles multimedia y auriculares. Probada en emulador Android 15.
- `sonidos build-web` y `scripts/sync_mobile_assets.sh`.

### Decidido
- Sin descarga desde YouTube ni otras plataformas (ADR-0002).
- Audio de reproducción en GitHub Releases; el repositorio contiene índice, código y documentación (ADR-0003).
