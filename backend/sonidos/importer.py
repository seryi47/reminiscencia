"""Flujo de importación de un archivo de audio local ya licenciado.

Pasos: sondeo -> huella SHA-256 -> alta en biblioteca (detecta duplicados)
-> variantes de reproducción opcionales.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

from sonidos.compression import transcode
from sonidos.hashing import sha256_file
from sonidos.library import ImportResult, Library
from sonidos.probe import probe


@dataclass(frozen=True)
class ImportReport:
    result: ImportResult
    variants: list[Path] = field(default_factory=list)


def import_local_file(
    library: Library,
    source: Path,
    *,
    license: str,
    title: str | None = None,
    origin: str = "local",
    variant_profiles: tuple[str, ...] = (),
    audio_dir: Path | None = None,
) -> ImportReport:
    info = probe(source)
    sha256 = sha256_file(source)

    result = library.add_song(
        sha256=sha256,
        title=title or source.stem,
        source=origin,
        license=license,
        codec=info.codec,
        sample_rate=info.sample_rate,
        channels=info.channels,
        duration_s=info.duration_s,
        bitrate=info.bitrate,
        size_bytes=info.size_bytes,
    )

    variants: list[Path] = []
    if result.created and variant_profiles:
        if audio_dir is None:
            raise ValueError("audio_dir es obligatorio para generar variantes")
        for profile in variant_profiles:
            destination_dir = audio_dir / result.song_id
            path = transcode(source, destination_dir, profile)
            library.add_variant(result.song_id, profile, path, path.stat().st_size)
            variants.append(path)

    return ImportReport(result=result, variants=variants)
