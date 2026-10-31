"""Resolución de URLs a fuentes de audio con licencia (ADR-0005).

Sólo acepta:
- Ítems de Internet Archive cuya licencia figura en los metadatos.
- Ficheros de audio directos con licencia declarada por el usuario.

Rechaza plataformas de vídeo y streaming antes de cualquier descarga.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from urllib.parse import urlparse

AUDIO_EXTENSIONS = (".mp3", ".flac", ".ogg", ".opus", ".m4a", ".wav")

BLOCKED_HOSTS = frozenset(
    {
        "youtube.com",
        "youtu.be",
        "spotify.com",
        "open.spotify.com",
        "music.apple.com",
        "soundcloud.com",
        "vimeo.com",
        "tiktok.com",
        "instagram.com",
        "facebook.com",
        "bandcamp.com",
    }
)

# Licencias de Internet Archive reconocidas, por fragmento de la URL de licencia.
IA_LICENSE_NAMES = {
    "publicdomain/mark": "Dominio público (Public Domain Mark 1.0)",
    "publicdomain/zero": "CC0 1.0 (dominio público)",
    "publicdomain/": "Dominio público (Creative Commons)",
    "by/4.0": "CC BY 4.0",
    "by-sa/4.0": "CC BY-SA 4.0",
    "by-nc/4.0": "CC BY-NC 4.0",
    "by-nc-sa/4.0": "CC BY-NC-SA 4.0",
}

# Preferencia de formatos dentro de un ítem de Internet Archive (mejor primero).
IA_FORMAT_PREFERENCE = ("Flac", "VBR MP3", "128Kbps MP3", "Ogg Vorbis", "64Kbps MP3")

# Identificador de ítem de Internet Archive. Sin barras ni puntos sueltos: acaba en rutas de descarga y de staging.
IA_IDENTIFIER = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,199}")


class SourceError(ValueError):
    """La URL no se puede usar. El mensaje se muestra al usuario."""


@dataclass(frozen=True)
class ResolvedSource:
    source: str
    identifier: str
    download_url: str
    license: str
    title: str | None
    file_name: str


def _host(url: str) -> str:
    host = urlparse(url).hostname or ""
    return host[4:] if host.startswith("www.") else host


def is_blocked(url: str) -> bool:
    host = _host(url)
    return any(host == blocked or host.endswith("." + blocked) for blocked in BLOCKED_HOSTS)


def ia_license_name(license_url: str | None) -> str | None:
    if not license_url:
        return None
    lowered = license_url.lower()
    for fragment, name in IA_LICENSE_NAMES.items():
        if fragment in lowered:
            return name
    return None


def choose_ia_file(files: list[dict]) -> dict | None:
    """Elige el mejor fichero de audio de un ítem de Internet Archive."""
    audio = [item for item in files if item.get("format") in IA_FORMAT_PREFERENCE]
    for preferred in IA_FORMAT_PREFERENCE:
        for item in audio:
            if item.get("format") == preferred:
                return item
    return None


def ia_identifier(url: str) -> str:
    """Identificador de un ítem de Internet Archive, de la forma archive.org/details/<id> o archive.org/download/<id>."""
    parts = urlparse(url).path.strip("/").split("/")
    if len(parts) != 2 or parts[0] not in {"details", "download"} or not IA_IDENTIFIER.fullmatch(parts[1]):
        raise SourceError(
            "La URL de Internet Archive debe ser de la forma archive.org/details/<identificador> "
            "o archive.org/download/<identificador>"
        )
    return parts[1]


def resolve_internet_archive(url: str, metadata: dict) -> ResolvedSource:
    identifier = ia_identifier(url)

    meta = metadata.get("metadata") or {}
    license_name = ia_license_name(meta.get("licenseurl"))
    if license_name is None:
        raise SourceError(f"El ítem {identifier} no declara una licencia reconocida; no se importa")

    chosen = choose_ia_file(metadata.get("files") or [])
    if chosen is None:
        raise SourceError(f"El ítem {identifier} no tiene un fichero de audio en un formato soportado")

    return ResolvedSource(
        source="internet-archive",
        identifier=identifier,
        download_url=f"https://archive.org/download/{identifier}/{chosen['name']}",
        license=f"{license_name} (Internet Archive: {identifier})",
        title=meta.get("title"),
        file_name=chosen["name"],
    )


def resolve_direct_file(url: str, license: str | None) -> ResolvedSource:
    if not license or not license.strip():
        raise SourceError("Para un fichero directo hay que indicar la licencia de uso")
    path = urlparse(url).path.lower()
    if not path.endswith(AUDIO_EXTENSIONS):
        raise SourceError("La URL no apunta a un fichero de audio directo (mp3, flac, ogg, opus, m4a o wav)")
    file_name = urlparse(url).path.rsplit("/", 1)[-1]
    return ResolvedSource(
        source="direct-url",
        identifier=_host(url) + "/" + file_name,
        download_url=url,
        license=license.strip(),
        title=None,
        file_name=file_name,
    )


def classify(url: str) -> str:
    """Devuelve 'internet-archive', 'direct' o lanza SourceError."""
    if not url.startswith(("http://", "https://")):
        raise SourceError("La URL debe empezar por http:// o https://")
    if is_blocked(url):
        raise SourceError(
            "Esta plataforma no se puede importar: sus condiciones de uso no permiten descargar el contenido. "
            "Usa un fichero de audio con licencia o un ítem de Internet Archive."
        )
    host = _host(url)
    if host == "archive.org":
        return "internet-archive"
    if urlparse(url).path.lower().endswith(AUDIO_EXTENSIONS):
        return "direct"
    raise SourceError("Fuente no soportada. Admite Internet Archive o un fichero de audio directo con licencia.")
