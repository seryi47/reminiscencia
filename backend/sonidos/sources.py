"""Resolución de URLs a fuentes de audio con licencia (ADR-0005).

Sólo acepta:
- Ítems de Internet Archive cuya licencia figura en los metadatos.
- Ficheros de audio directos con licencia declarada por el usuario.

Rechaza plataformas de vídeo y streaming antes de cualquier descarga. La lista se compara con el host
canónico (canonical_host): el punto final, el nombre de ancho completo o un separador ideográfico no
permiten eludirla.
"""

from __future__ import annotations

import ipaddress
import re
import socket
import unicodedata
from dataclasses import dataclass
from urllib.parse import quote, urlparse, urlsplit

AUDIO_EXTENSIONS = (".mp3", ".flac", ".ogg", ".opus", ".m4a", ".wav")

# Plataformas de vídeo y de streaming (ADR-0002, ADR-0005) y los dominios de sus ficheros (CDN).
# Se compara por sufijo: 'youtube.com' cubre 'm.youtube.com'.
BLOCKED_HOSTS = frozenset(
    {
        "youtube.com",
        "youtu.be",
        "youtube-nocookie.com",
        "googlevideo.com",
        "ytimg.com",
        "spotify.com",
        "open.spotify.com",
        "scdn.co",
        "spotifycdn.com",
        "music.apple.com",
        "itunes.apple.com",
        "mzstatic.com",
        "soundcloud.com",
        "sndcdn.com",
        "vimeo.com",
        "vimeocdn.com",
        "tiktok.com",
        "tiktokcdn.com",
        "instagram.com",
        "cdninstagram.com",
        "facebook.com",
        "fbcdn.net",
        "bandcamp.com",
        "bcbits.com",
        "deezer.com",
        "dzcdn.net",
        "tidal.com",
        "mixcloud.com",
        "dailymotion.com",
        "dmcdn.net",
        "twitch.tv",
        "jtvnw.net",
        "ttvnw.net",
    }
)

IA_PUBLIC_DOMAIN_NAME = "Dominio público (Creative Commons)"
IA_TITLE_MAX_CHARS = 200

# Licencias de Internet Archive reconocidas. La URL de licencia tiene que ser de creativecommons.org
# y su ruta tiene que empezar por una de estas (sin distinguir mayúsculas). Solo rutas concretas: la raíz
# /publicdomain/ no es una licencia.
IA_LICENSE_HOST = "creativecommons.org"
IA_LICENSE_PATHS = {
    ("licenses", "by", "4.0"): "CC BY 4.0",
    ("licenses", "by-sa", "4.0"): "CC BY-SA 4.0",
    ("licenses", "by-nc", "4.0"): "CC BY-NC 4.0",
    ("licenses", "by-nc-sa", "4.0"): "CC BY-NC-SA 4.0",
    ("licenses", "publicdomain"): IA_PUBLIC_DOMAIN_NAME,
    ("publicdomain", "zero", "1.0"): "CC0 1.0 (dominio público)",
    ("publicdomain", "mark", "1.0"): "Dominio público (Public Domain Mark 1.0)",
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


def canonical_host(url: str) -> str:
    """Host tal como lo resolverá la conexión, en minúsculas, sin punto final ni 'www.'.

    La conexión desescapa el host (you%74ube.com es youtube.com), así que un host con '%' se rechaza. El
    codec IDNA hace la misma normalización que la conexión: NFKC (nombres de ancho completo), separadores
    ideográficos y caracteres invisibles como el guion blando. Tras esa normalización no puede quedar una
    etiqueta vacía (U+2025 se convierte en '..'). Un host que no cumple lo anterior se rechaza.
    """
    host = urlparse(url).hostname or ""
    if "%" in host:
        raise SourceError("El host de la URL no es válido")
    try:
        ascii_host = host.encode("idna").decode("ascii").lower().rstrip(".")
    except UnicodeError as error:
        raise SourceError("El host de la URL no es válido") from error
    if not ascii_host:
        raise SourceError("La URL no tiene un host válido")
    if any(not label for label in ascii_host.split(".")):
        raise SourceError("El host de la URL no es válido")
    return ascii_host[4:] if ascii_host.startswith("www.") else ascii_host


def is_blocked(url: str) -> bool:
    host = canonical_host(url)
    return any(host == blocked or host.endswith("." + blocked) for blocked in BLOCKED_HOSTS)


def check_download_url(url: str, *, allow_private_network: bool = False) -> None:
    """Revisa una URL antes de descargarla y cada redirección que siga la descarga (ADR-0005).

    Solo http o https, nunca una plataforma bloqueada, llegue por donde llegue, y nunca una dirección de
    bucle local, de red privada o de enlace local (metadatos de la nube), salvo que quien llama lo pida
    (las pruebas con servidores en 127.0.0.1). Un nombre se resuelve antes de conectar: un cambio de DNS
    entre esta comprobación y la conexión no se detecta.
    """
    if urlsplit(url).scheme not in ("http", "https"):
        raise SourceError("La descarga apunta a una dirección que no es http o https")
    if is_blocked(url):
        raise SourceError("No se descarga desde una plataforma que no se puede importar, tampoco por redirección")
    if not allow_private_network:
        _check_public_host(canonical_host(url))


def _check_public_host(host: str) -> None:
    try:
        addresses = [ipaddress.ip_address(host)]
    except ValueError:
        try:
            infos = socket.getaddrinfo(host, None, type=socket.SOCK_STREAM)
        except (OSError, UnicodeError) as error:
            raise SourceError("El host de la URL no se puede resolver") from error
        addresses = [ipaddress.ip_address(info[4][0].split("%", 1)[0]) for info in infos]
    if not addresses:
        raise SourceError("El host de la URL no se puede resolver")
    for address in addresses:
        if isinstance(address, ipaddress.IPv6Address) and address.ipv4_mapped is not None:
            address = address.ipv4_mapped
        if not address.is_global:
            raise SourceError("No se descarga desde una dirección de red privada, de bucle local o de enlace local")


def ia_license_name(license_url: str | None) -> str | None:
    """Nombre de la licencia de un ítem de Internet Archive, o None si no es una licencia reconocida.

    La URL tiene que ser http(s) de creativecommons.org y su ruta tiene que empezar por una licencia de
    IA_LICENSE_PATHS. Una subcadena parecida en otro host (example.com/by/4.0/) no cuenta.
    """
    if not isinstance(license_url, str) or not license_url.strip():
        return None
    url = license_url.strip()
    try:
        parts = urlsplit(url)
        if parts.scheme not in ("http", "https") or canonical_host(url) != IA_LICENSE_HOST:
            return None
    except ValueError:  # incluye SourceError
        return None
    segments = tuple(part.lower() for part in parts.path.split("/") if part)
    for prefix, name in IA_LICENSE_PATHS.items():
        if segments[: len(prefix)] == prefix:
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


def _ia_file_name(name: object) -> str:
    """Nombre de un fichero de Internet Archive. Acaba en una ruta local y en una URL de descarga,
    así que solo vale un nombre plano, con extensión de audio y sin caracteres de control."""
    if (
        not isinstance(name, str)
        or name in {"", ".", ".."}
        or "/" in name
        or "\\" in name
        or not name.isprintable()
        or not name.lower().endswith(AUDIO_EXTENSIONS)
    ):
        raise SourceError("El fichero de audio de Internet Archive tiene un nombre que no se puede usar")
    return name


def _ia_title(value: object) -> str | None:
    """Título de Internet Archive: texto de una línea y de hasta 200 caracteres. Lo que no lo sea (una lista,
    saltos de línea, un texto largo) no se usa: la importación toma el título de la petición o del fichero."""
    if not isinstance(value, str):
        return None
    clean = value.strip()
    if not clean or len(clean) > IA_TITLE_MAX_CHARS:
        return None
    if any(unicodedata.category(char) in ("Cc", "Zl", "Zp", "Cs") for char in clean):
        return None
    return clean


def resolve_internet_archive(url: str, metadata: dict) -> ResolvedSource:
    identifier = ia_identifier(url)

    meta = metadata.get("metadata") or {}
    license_name = ia_license_name(meta.get("licenseurl"))
    if license_name is None:
        raise SourceError(f"El ítem {identifier} no declara una licencia reconocida; no se importa")

    chosen = choose_ia_file(metadata.get("files") or [])
    if chosen is None:
        raise SourceError(f"El ítem {identifier} no tiene un fichero de audio en un formato soportado")
    file_name = _ia_file_name(chosen.get("name"))
    quoted_name = quote(file_name, safe="")

    return ResolvedSource(
        source="internet-archive",
        identifier=identifier,
        download_url=f"https://archive.org/download/{identifier}/{quoted_name}",
        license=f"{license_name} (Internet Archive: {identifier})",
        title=_ia_title(meta.get("title")),
        file_name=file_name,
    )


def _internet_archive_file_server(host: str) -> bool:
    """Servidores de ficheros de Internet Archive (ia800100.us.archive.org). Su licencia está en el ítem, así
    que un fichero de ahí no se importa como directo con una licencia declarada a mano (ADR-0005)."""
    return host.endswith(".archive.org")


IA_FILE_SERVER_MESSAGE = (
    "Un fichero de Internet Archive se importa desde la página de su ítem (archive.org/details/<identificador>), "
    "donde figura la licencia"
)


def resolve_direct_file(url: str, license: str | None) -> ResolvedSource:
    if not license or not license.strip():
        raise SourceError("Para un fichero directo hay que indicar la licencia de uso")
    if _internet_archive_file_server(canonical_host(url)):
        raise SourceError(IA_FILE_SERVER_MESSAGE)
    path = urlparse(url).path.lower()
    if not path.endswith(AUDIO_EXTENSIONS):
        raise SourceError("La URL no apunta a un fichero de audio directo (mp3, flac, ogg, opus, m4a o wav)")
    file_name = urlparse(url).path.rsplit("/", 1)[-1]
    return ResolvedSource(
        source="direct-url",
        identifier=canonical_host(url) + "/" + file_name,
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
    host = canonical_host(url)
    if host == "archive.org":
        return "internet-archive"
    if _internet_archive_file_server(host):
        raise SourceError(IA_FILE_SERVER_MESSAGE)
    if urlparse(url).path.lower().endswith(AUDIO_EXTENSIONS):
        return "direct"
    raise SourceError("Fuente no soportada. Admite Internet Archive o un fichero de audio directo con licencia.")
