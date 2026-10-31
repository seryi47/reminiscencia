"""Preparación de la publicación del audio en GitHub Releases (ADR-0003).

Por defecto sólo genera los comandos y el manifiesto de checksums. No sube
nada hasta que se pide de forma explícita con execute=True.
"""

from __future__ import annotations

import hashlib
import subprocess
from dataclasses import dataclass
from pathlib import Path

from sonidos.limits import plan_release_batches

MANIFEST_NAME = "SHA256SUMS.txt"


@dataclass(frozen=True)
class ReleaseBatch:
    tag: str
    files: list[Path]
    manifest: Path


def build_manifest(files: list[Path], destination: Path) -> Path:
    lines = []
    for path in sorted(files, key=lambda item: item.name):
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        lines.append(f"{digest}  {path.name}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return destination


def plan_batches(files: list[Path], *, tag_prefix: str, work_dir: Path) -> list[ReleaseBatch]:
    batches = []
    for index, group in enumerate(plan_release_batches(files), start=1):
        tag = f"{tag_prefix}-{index:02d}"
        manifest = build_manifest(group, work_dir / tag / MANIFEST_NAME)
        batches.append(ReleaseBatch(tag=tag, files=group, manifest=manifest))
    return batches


def gh_commands(repo: str, batch: ReleaseBatch) -> list[list[str]]:
    create = [
        "gh", "release", "create", batch.tag,
        "--repo", repo,
        "--title", batch.tag,
        "--notes", "Lote de audio con licencia registrada. Ver SHA256SUMS.txt.",
    ]
    upload = [
        "gh", "release", "upload", batch.tag,
        "--repo", repo,
        *[str(path) for path in batch.files],
        str(batch.manifest),
    ]
    return [create, upload]


def publish(repo: str, batches: list[ReleaseBatch], *, execute: bool) -> list[list[str]]:
    commands = [command for batch in batches for command in gh_commands(repo, batch)]
    if execute:
        for command in commands:
            subprocess.run(command, check=True)
    return commands
