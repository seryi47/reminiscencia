"""Portadas de canciones y de álbumes (carpetas) (ADR-0016).

Una portada es un JPEG de 640×640 en audio-library/covers/<ID>.jpg, donde ID es el id de una canción (S + 16
hexadecimales) o de una carpeta (F + 16 hexadecimales). El catálogo apunta a ella con "cover": "covers/<ID>.jpg".
sonidos.publish.sync_public copia a frontend/web/covers/ las de las canciones públicas y las de las carpetas.

Entrada: el buzón (audio-library/buzon/portadas/<ID>.<jpg|jpeg|png|webp>, máximo 10 MiB), procesado por
sonidos.buzon. La imagen se convierte con ffmpeg: recorte centrado a cuadrado, 640×640, JPEG sin metadatos (ni EXIF
ni ubicación) y salida determinista (la misma imagen da los mismos bytes).

Seguridad de la conversión: el formato se elige por los primeros bytes del archivo (JPEG, PNG o WebP), nunca por
la extensión ni por lo que ffmpeg adivine, y la imagen entra por la entrada estándar con el demuxer de ese formato
(jpeg_pipe, png_pipe o webp_pipe). Así ffmpeg no puede tratarla como una lista de reproducción, una secuencia de
ficheros ni una URL. Antes de convertir, ffprobe comprueba el códec y las dimensiones (como máximo 16384 px por lado
y 100 megapíxeles, para no descomprimir una bomba). Después, ffprobe comprueba que la salida es un JPEG de 640×640.
"""

from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path

COVERS_DIRECTORY = "audio-library/covers"
WEB_COVERS_DIRECTORY = "frontend/web/covers"
COVER_SIZE = 640
MAX_UPLOAD_BYTES = 10 * 1024 * 1024  # 10 MiB
MAX_SOURCE_SIDE = 16384
MAX_SOURCE_PIXELS = 100_000_000
# El contrato pide «calidad 85» (escala 0-100 de libjpeg). El codificador mjpeg de ffmpeg no tiene esa escala: usa
# -q:v de 2 (mejor) a 31. Con una imagen de prueba de 640×640, -q:v 2 da un tamaño del orden del de libjpeg a 85
# (ver ADR-0016). Es una equivalencia aproximada, no exacta.
CONTRACT_QUALITY = 85
FFMPEG_QSCALE = "2"
TIMEOUT_S = 120

# Id que puede tener portada: canción (S) o carpeta (F), con 16 hexadecimales en minúscula.
COVER_ID = re.compile(r"[SF][0-9a-f]{16}")
# Nombre de una portada guardada o publicada.
COVER_NAME = re.compile(r"[SF][0-9a-f]{16}\.jpg")
# Nombre de una portada subida al buzón: el id exacto y una extensión de imagen (sin distinguir mayúsculas).
UPLOAD_NAME = re.compile(r"([SF][0-9a-f]{16})\.(?i:jpg|jpeg|png|webp)")

_FORMATS = (
    # (demuxer de ffmpeg, códec que debe ver ffprobe)
    ("jpeg_pipe", "mjpeg"),
    ("png_pipe", "png"),
    ("webp_pipe", "webp"),
)


class PortadaError(ValueError):
    """La imagen no se puede usar como portada. El mensaje va al resumen del job."""


def cover_ref(item_id: str) -> str:
    """Valor del campo "cover" del catálogo para un id."""
    if not isinstance(item_id, str) or not COVER_ID.fullmatch(item_id):
        raise ValueError(f"identificador sin portada posible: {item_id!r}")
    return f"covers/{item_id}.jpg"


def formato_por_firma(head: bytes) -> tuple[str, str] | None:
    """(demuxer, códec) según los primeros bytes: JPEG (FF D8 FF), PNG (firma de 8 bytes) o WebP (RIFF....WEBP)."""
    if head.startswith(b"\xff\xd8\xff"):
        return _FORMATS[0]
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return _FORMATS[1]
    if len(head) >= 12 and head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return _FORMATS[2]
    return None


def _run(args: list[str], source: Path) -> subprocess.CompletedProcess:
    try:
        with source.open("rb") as stdin:
            return subprocess.run(args, stdin=stdin, capture_output=True, timeout=TIMEOUT_S, check=False)
    except subprocess.TimeoutExpired as error:
        raise PortadaError("la conversión de la imagen tarda demasiado") from error
    except OSError as error:
        raise PortadaError(f"no se pudo ejecutar {args[0]}") from error


def _probe(path: Path, demuxer: str) -> dict:
    result = _run(
        ["ffprobe", "-v", "error", "-f", demuxer, "-i", "pipe:0", "-select_streams", "v:0",
         "-show_entries", "stream=codec_name,width,height", "-of", "json"],
        path,
    )
    if result.returncode != 0:
        raise PortadaError("no es una imagen JPEG, PNG o WebP válida")
    try:
        streams = json.loads(result.stdout.decode("utf-8", errors="replace")).get("streams") or []
    except ValueError as error:
        raise PortadaError("no es una imagen JPEG, PNG o WebP válida") from error
    return streams[0] if streams and isinstance(streams[0], dict) else {}


def convertir_portada(source: Path, destination: Path) -> Path:
    """Convierte 'source' en un JPEG de 640×640 (recorte centrado) en 'destination'. Lanza PortadaError si no es una
    imagen JPEG, PNG o WebP válida o si sus dimensiones pasan de los límites."""
    with source.open("rb") as handle:
        head = handle.read(16)
    formato = formato_por_firma(head)
    if formato is None:
        raise PortadaError("no es una imagen JPEG, PNG o WebP")
    demuxer, codec = formato
    info = _probe(source, demuxer)
    width, height = info.get("width"), info.get("height")
    if info.get("codec_name") != codec or not isinstance(width, int) or not isinstance(height, int):
        raise PortadaError("no es una imagen JPEG, PNG o WebP válida")
    if width < 1 or height < 1:
        raise PortadaError("la imagen no tiene dimensiones")
    if max(width, height) > MAX_SOURCE_SIDE or width * height > MAX_SOURCE_PIXELS:
        raise PortadaError(f"la imagen es demasiado grande (más de {MAX_SOURCE_SIDE} px por lado o 100 megapíxeles)")

    destination.parent.mkdir(parents=True, exist_ok=True)
    size = str(COVER_SIZE)
    result = _run(
        [
            "ffmpeg", "-y", "-v", "error",
            "-f", demuxer, "-i", "pipe:0",
            "-frames:v", "1",
            "-vf", f"scale={size}:{size}:force_original_aspect_ratio=increase:flags=lanczos,crop={size}:{size}",
            "-pix_fmt", "yuvj420p",
            "-map_metadata", "-1",
            "-fflags", "+bitexact", "-flags:v", "+bitexact",
            "-c:v", "mjpeg", "-q:v", FFMPEG_QSCALE,
            "-f", "mjpeg", str(destination),
        ],
        source,
    )
    if result.returncode != 0 or not destination.is_file():
        destination.unlink(missing_ok=True)
        raise PortadaError("ffmpeg no puede convertir la imagen a JPEG")
    out = _probe(destination, "jpeg_pipe")
    if out.get("codec_name") != "mjpeg" or out.get("width") != COVER_SIZE or out.get("height") != COVER_SIZE:
        destination.unlink(missing_ok=True)
        raise PortadaError("la conversión no ha dado un JPEG de 640×640")
    return destination
