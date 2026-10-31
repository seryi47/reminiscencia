"""Perfiles de transcodificación y ejecución de ffmpeg.

Los perfiles son puntos de partida para experimentar, no configuraciones
definitivas (ver docs/audio-processing/COMPRESSION.md). No se aplica ningún
filtro destructivo: sólo se elige el códec, la tasa de bits y se descarta
el vídeo.
"""

from __future__ import annotations

import subprocess
from dataclasses import dataclass
from pathlib import Path


class TranscodeError(RuntimeError):
    pass


@dataclass(frozen=True)
class Profile:
    name: str
    extension: str
    encoder_args: tuple[str, ...]


PROFILES: dict[str, Profile] = {
    profile.name: profile
    for profile in (
        Profile("opus-48k", ".opus", ("-c:a", "libopus", "-b:a", "48k", "-vbr", "on")),
        Profile("opus-64k", ".opus", ("-c:a", "libopus", "-b:a", "64k", "-vbr", "on")),
        Profile("aac-64k", ".m4a", ("-c:a", "aac", "-b:a", "64k")),
        Profile("aac-128k", ".m4a", ("-c:a", "aac", "-b:a", "128k")),
        Profile("mp3-128k", ".mp3", ("-c:a", "libmp3lame", "-b:a", "128k")),
    )
}


def transcode(source: Path, destination_dir: Path, profile_name: str) -> Path:
    if profile_name not in PROFILES:
        raise TranscodeError(f"perfil desconocido: {profile_name}")

    profile = PROFILES[profile_name]
    destination_dir.mkdir(parents=True, exist_ok=True)
    destination = destination_dir / f"{profile.name}{profile.extension}"

    result = subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-v", "error",
            "-i", str(source),
            "-map", "0:a:0",
            "-vn",
            *profile.encoder_args,
            str(destination),
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        raise TranscodeError(f"ffmpeg falló con {source}: {result.stderr.strip()}")
    return destination
