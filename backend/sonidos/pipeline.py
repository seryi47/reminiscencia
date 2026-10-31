"""Importación de una URL al catálogo versionado (ADR-0007).

Pasos: resolver la fuente (ADR-0005) -> descargar a staging -> huella SHA-256 ->
sondeo -> si es nuevo, convertir a Opus en audio-library/audio/<id>.opus -> guardar catálogo.
Pensado para ejecutarse en GitHub Actions (runner con ffmpeg), no en Vercel.
"""

from __future__ import annotations

import shutil
from pathlib import Path

from sonidos import catalog
from sonidos.compression import transcode
from sonidos.hashing import sha256_file
from sonidos import intake
from sonidos.probe import probe

PLAYBACK_PROFILE = "opus-64k"


def import_url(
    *,
    catalog_path: Path,
    audio_dir: Path,
    staging_dir: Path,
    url: str,
    license: str | None,
    title: str | None = None,
) -> dict:
    resolved = intake.resolve_url(url, license=license)
    target = intake.download(resolved.download_url, staging_dir / resolved.identifier.replace("/", "_") / resolved.file_name)
    try:
        sha256 = sha256_file(target)
        info = probe(target)

        data = catalog.load(catalog_path)
        song, created = catalog.add_song(
            data,
            sha256=sha256,
            title=title or resolved.title or target.stem,
            license=resolved.license,
            source=f"{resolved.source}:{resolved.identifier}",
            codec=info.codec,
            duration_s=info.duration_s,
            size_bytes=info.size_bytes,
        )
        if created:
            produced = transcode(target, staging_dir / song["id"], PLAYBACK_PROFILE)
            audio_dir.mkdir(parents=True, exist_ok=True)
            shutil.move(str(produced), audio_dir / f"{song['id']}.opus")
            catalog.save(catalog_path, data)
        return {"song_id": song["id"], "created": created, "source": resolved.source, "license": song["license"]}
    finally:
        shutil.rmtree(staging_dir / resolved.identifier.replace("/", "_"), ignore_errors=True)
