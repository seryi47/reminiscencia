"""Lectura de metadatos de audio con ffprobe."""

from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass
from pathlib import Path


class ProbeError(RuntimeError):
    pass


@dataclass(frozen=True)
class AudioInfo:
    codec: str
    sample_rate: int
    channels: int
    duration_s: float
    bitrate: int | None
    size_bytes: int


def probe(path: Path) -> AudioInfo:
    result = subprocess.run(
        [
            "ffprobe",
            "-v", "error",
            "-select_streams", "a:0",
            "-show_entries", "stream=codec_name,sample_rate,channels,bit_rate:format=duration",
            "-of", "json",
            str(path),
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        raise ProbeError(f"ffprobe no pudo leer {path}: {result.stderr.strip()}")

    data = json.loads(result.stdout)
    streams = data.get("streams") or []
    if not streams:
        raise ProbeError(f"{path} no tiene pista de audio")

    stream = streams[0]
    bit_rate = stream.get("bit_rate")
    return AudioInfo(
        codec=stream["codec_name"],
        sample_rate=int(stream["sample_rate"]),
        channels=int(stream["channels"]),
        duration_s=float(data["format"]["duration"]),
        bitrate=int(bit_rate) if bit_rate else None,
        size_bytes=path.stat().st_size,
    )
