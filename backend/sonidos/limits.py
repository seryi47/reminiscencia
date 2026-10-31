"""Límites de GitHub que el proyecto respeta.

Fuentes (docs.github.com, verificadas el 2026-10-31):
- Git: avisa a partir de 50 MiB y bloquea ficheros de más de 100 MiB.
  Repositorio ideal < 1 GB; recomendado máximo < 5 GB.
- Releases: cada asset debe ser menor de 2 GiB; hasta 1000 assets por release.
  La página no indica límite total ni de ancho de banda.
"""

from __future__ import annotations

import subprocess
from pathlib import Path

MiB = 1024**2
GiB = 1024**3

GIT_WARN_FILE_BYTES = 50 * MiB
GIT_BLOCK_FILE_BYTES = 100 * MiB
GIT_REPO_IDEAL_BYTES = 1 * GiB
GIT_REPO_RECOMMENDED_MAX_BYTES = 5 * GiB

RELEASE_ASSET_MAX_BYTES = 2 * GiB
RELEASE_MAX_ASSETS = 1000
# Se reserva un asset por release para el manifiesto de checksums.
RELEASE_DATA_ASSETS_PER_BATCH = RELEASE_MAX_ASSETS - 1


class LimitError(ValueError):
    pass


def check_release_asset(path: Path) -> int:
    size = path.stat().st_size
    if size >= RELEASE_ASSET_MAX_BYTES:
        raise LimitError(
            f"{path.name} ocupa {size} bytes; un asset de release debe ser menor de 2 GiB"
        )
    return size


def plan_release_batches(files: list[Path]) -> list[list[Path]]:
    """Reparte los ficheros en lotes que caben en una release.

    Falla si algún fichero supera el límite por asset, para no subir una
    parte de la biblioteca.
    """
    for path in files:
        check_release_asset(path)

    ordered = sorted(files, key=lambda path: path.name)
    return [
        ordered[start : start + RELEASE_DATA_ASSETS_PER_BATCH]
        for start in range(0, len(ordered), RELEASE_DATA_ASSETS_PER_BATCH)
    ]


def audit_repository(root: Path) -> list[str]:
    """Devuelve los problemas del repositorio frente a los límites de GitHub.

    Sólo mira los ficheros versionados (git ls-files), igual que GitHub.
    """
    listing = subprocess.run(
        ["git", "-C", str(root), "ls-files", "-z"],
        capture_output=True,
        check=True,
    ).stdout.decode("utf-8")

    problems: list[str] = []
    total = 0
    for name in filter(None, listing.split("\0")):
        path = root / name
        if not path.is_file():
            continue
        size = path.stat().st_size
        total += size
        if size > GIT_BLOCK_FILE_BYTES:
            problems.append(f"{name}: {size} bytes; GitHub bloquea ficheros de más de 100 MiB")
        elif size > GIT_WARN_FILE_BYTES:
            problems.append(f"{name}: {size} bytes; supera el aviso de 50 MiB")

    if total > GIT_REPO_RECOMMENDED_MAX_BYTES:
        problems.append(f"repositorio: {total} bytes; supera el máximo recomendado de 5 GiB")
    elif total > GIT_REPO_IDEAL_BYTES:
        problems.append(f"repositorio: {total} bytes; supera el tamaño ideal de 1 GiB")
    return problems
