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
        # Última página Ogg (cabecera «OggS», versión 0): su granule es el total de muestras de salida a 48 kHz. Se
        # valida que el candidato sea un límite de página REAL (su tabla de segmentos da un tamaño que, o bien termina
        # el fichero, o bien empalma con otra «OggS»): así una secuencia «OggS» incrustada en el audio comprimido no se
        # confunde con una página y no calcula una duración errónea (afecta a la regla de duplicados ±2 s y a la UI).
        page = tail.rfind(b"OggS")
        while page >= 0 and not _es_pagina_ogg(tail, page):
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


def _es_pagina_ogg(tail: bytes, page: int) -> bool:
    """¿El offset page es una cabecera de página Ogg real dentro de tail? Comprueba la versión (0), los bits
    reservados del tipo de cabecera, y que el tamaño que marca su tabla de segmentos termine el buffer o caiga justo
    sobre otra página «OggS». Evita casar con una secuencia «OggS» incrustada en los datos de audio."""
    if page + 27 > len(tail):
        return False
    if tail[page + 4] != 0:  # versión de la página Ogg
        return False
    if tail[page + 5] & 0xF8:  # bits reservados del tipo de cabecera (solo 0x01/0x02/0x04 son válidos)
        return False
    nsegs = tail[page + 26]
    header_end = page + 27 + nsegs
    if header_end > len(tail):
        return False
    page_len = header_end + sum(tail[page + 27:header_end])
    # La última página termina el fichero (y, por tanto, el final del tail); cualquier otra empalma con la siguiente.
    if page_len == len(tail):
        return True
    return page_len + 4 <= len(tail) and tail[page_len:page_len + 4] == b"OggS"


def _ffprobe(path: Path) -> AudioInfo:
    try:
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
    except OSError as error:
        # ffprobe no está en el PATH (p. ej. la ruta sin ffmpeg de buzon.yml, ADR-0042) o no se pudo ejecutar. Sin
        # esto, el FileNotFoundError subiría hasta reventar el job entero y una subida envenenada se reprocesaría sin
        # fin. Degradamos a ProbeError: el que no sea un Opus válido se rechaza limpio y el lote continúa.
        raise ProbeError(f"no se pudo ejecutar ffprobe para leer {path}: {error}") from error
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
