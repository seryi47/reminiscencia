"""Huella SHA-256 del contenido de un archivo, leído por bloques."""

from __future__ import annotations

import hashlib
from pathlib import Path

CHUNK_SIZE = 1 << 20


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(CHUNK_SIZE), b""):
            digest.update(chunk)
    return digest.hexdigest()
