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
    """Metadatos de audio. Para Ogg Opus (lo que suben la web y la APK, ya convertido en el dispositivo) se leen en
    **Python puro**, sin ffprobe: así la publicación de esas subidas no necesita ffmpeg (ADR-0042; evita los ~7 min que
    tardaba instalarlo en el runner). Para cualquier otro formato se usa ffprobe como siempre."""
    with path.open("rb") as handle:
        head = handle.read(4096)
    if head[:4] == b"OggS" and b"OpusHead" in head:
        info = _opus_info(path, head)
        if info is not None:
            return info
    return _ffprobe(path)


def _opus_info(path: Path, head: bytes) -> AudioInfo | None:
    """Lee codec, canales, tasa de entrada y duración de un Ogg Opus sin ffprobe. La duración sale de la posición de
    grano (granule) de la última página Ogg, en muestras a 48 kHz, menos el pre-skip de OpusHead. Devuelve None si el
    fichero no encaja (entonces se cae a ffprobe)."""
    try:
        marker = head.index(b"OpusHead")
        opus_head = head[marker:marker + 19]
        if len(opus_head) < 19:
            return None
        channels = opus_head[9]
        pre_skip = int.from_bytes(opus_head[10:12], "little")
        input_rate = int.from_bytes(opus_head[12:16], "little") or 48000
        with path.open("rb") as handle:
            handle.seek(0, 2)
            size = handle.tell()
            handle.seek(max(0, size - 65536))
            tail = handle.read()
        # Última página Ogg (cabecera «OggS», versión 0): su granule es el total de muestras de salida a 48 kHz.
        page = tail.rfind(b"OggS")
        while page >= 0 and not (page + 14 <= len(tail) and tail[page + 4] == 0):
            page = tail.rfind(b"OggS", 0, page)
        if page < 0:
            return None
        granule = int.from_bytes(tail[page + 6:page + 14], "little")
        if granule == 0xFFFFFFFFFFFFFFFF:  # página sin fin de paquete: no da la duración
            return None
        samples = max(0, granule - pre_skip)
        duration = samples / 48000.0
        if duration <= 0 or channels <= 0:
            return None
        bitrate = int(size * 8 / duration)
        return AudioInfo(
            codec="opus",
            sample_rate=input_rate,
            channels=channels,
            duration_s=duration,
            bitrate=bitrate,
            size_bytes=size,
        )
    except (ValueError, IndexError, OSError):
        return None


def _ffprobe(path: Path) -> AudioInfo:
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
