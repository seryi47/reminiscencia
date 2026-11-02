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
from urllib.parse import quote, unquote, urlparse, urlsplit

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
        # Acortadores oficiales de plataformas: la primera petición ya saldría a esos dominios.
        "dai.ly",
        "fb.watch",
        "instagr.am",
        "x.com",
        "twitter.com",
        "twimg.com",
        "reddit.com",
        "redd.it",
        "rumble.com",
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
# Lo único que puede seguir a la ruta de una licencia: nada, o una de las variantes que CC publica.
IA_LICENSE_SUFFIXES = frozenset({"legalcode", "legalcode.es", "legalcode.en", "deed", "deed.es", "deed.en"})

# Preferencia de formatos dentro de un ítem de Internet Archive (mejor primero).
IA_FORMAT_PREFERENCE = ("Flac", "VBR MP3", "128Kbps MP3", "Ogg Vorbis", "64Kbps MP3")

# Identificador de ítem de Internet Archive. Sin barras ni puntos sueltos: acaba en rutas de descarga y de staging.
IA_IDENTIFIER = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,199}")

# Categorías de texto que no van en un título: control, separadores de línea y de párrafo, surrogates y
# caracteres de formato (bidi y espacios de ancho cero), que invierten o esconden lo que se lee.
UNSAFE_TEXT_CATEGORIES = ("Cc", "Zl", "Zp", "Cs", "Cf")

# Host ya normalizado a ASCII: etiquetas de letras, dígitos, guion y guion bajo, separadas por puntos.
_HOST_NAME = re.compile(r"[a-z0-9_-]+(?:\.[a-z0-9_-]+)*")

# Rangos IPv6 que llevan una IPv4 dentro: se juzgan por esa IPv4 (ver is_public_address).
_IPV4_COMPATIBLE = ipaddress.IPv6Network("::/96")
_SIIT = ipaddress.IPv6Network("::ffff:0:0:0/96")
_NAT64 = ipaddress.IPv6Network("64:ff9b::/96")
_NAT64_LOCAL = ipaddress.IPv6Network("64:ff9b:1::/48")


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
    """Host en minúsculas, sin punto final ni 'www.', para comparar con las listas de esta política
    (plataformas, Internet Archive, licencias). No es el nombre que resuelve la conexión: esa comprobación
    usa connection_host, tal cual.

    La conexión desescapa el host (you%74ube.com es youtube.com), así que un host con '%' se rechaza. El
    codec IDNA hace la misma normalización que la conexión: NFKC (nombres de ancho completo), separadores
    ideográficos y caracteres invisibles como el guion blando. Tras esa normalización no puede quedar una
    etiqueta vacía (U+2025 se convierte en '..') ni un espacio. Un host que no cumple lo anterior se rechaza.
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
    if not _is_ip_literal(ascii_host) and not _HOST_NAME.fullmatch(ascii_host):
        raise SourceError("El host de la URL no es válido")
    return ascii_host[4:] if ascii_host.startswith("www.") else ascii_host


def connection_host(url: str) -> str:
    """Host que resuelve la conexión: el de la URL, en minúsculas y sin quitar 'www.'."""
    host = urlsplit(url).hostname or ""
    if not host or "%" in host:
        raise SourceError("La URL no tiene un host válido")
    return host


def is_blocked(url: str) -> bool:
    host = canonical_host(url)
    return any(host == blocked or host.endswith("." + blocked) for blocked in BLOCKED_HOSTS)


def check_download_url(
    url: str, *, allow_private_network: bool = False, allow_internet_archive: bool = False
) -> None:
    """Revisa una URL antes de descargarla y cada redirección que siga la descarga (ADR-0005).

    Solo http o https, nunca una plataforma bloqueada, llegue por donde llegue, y nunca un fichero servido
    desde Internet Archive salvo que la descarga sea de un ítem de Internet Archive (allow_internet_archive).
    Tampoco una dirección de bucle local, de red privada o de enlace local (metadatos de la nube), salvo que
    quien llama lo pida (las pruebas con servidores en 127.0.0.1). Esta comprobación resuelve el nombre una
    vez para dar el error pronto; la garantía real está al conectar (intake), que valida la dirección a la
    que conecta en el mismo paso.
    """
    if urlsplit(url).scheme not in ("http", "https"):
        raise SourceError("La descarga apunta a una dirección que no es http o https")
    if is_blocked(url):
        raise SourceError("No se descarga desde una plataforma que no se puede importar, tampoco por redirección")
    if not allow_internet_archive and _internet_archive_file_server(canonical_host(url)):
        raise SourceError(IA_FILE_SERVER_MESSAGE)
    if not allow_private_network:
        resolve_public(connection_host(url), None)


def is_public_address(address: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    """Dirección pública. Las formas IPv6 que llevan una IPv4 dentro (mapeada, compatible, traducida SIIT,
    NAT64 y 6to4) se juzgan por esa IPv4; el rango NAT64 local (64:ff9b:1::/48) nunca es público."""
    if isinstance(address, ipaddress.IPv6Address):
        embedded = None
        if address.ipv4_mapped is not None:
            embedded = address.ipv4_mapped
        elif any(address in network for network in (_IPV4_COMPATIBLE, _SIIT, _NAT64)):
            embedded = ipaddress.IPv4Address(int(address) & 0xFFFFFFFF)
        elif address.sixtofour is not None:
            embedded = address.sixtofour
        if embedded is not None:
            return embedded.is_global
        if address in _NAT64_LOCAL:
            return False
    return address.is_global


def resolve_public(host: str, port: int | None, *, allow_private_network: bool = False) -> list[tuple]:
    """Resuelve el host una sola vez y devuelve las entradas de getaddrinfo. Si una dirección no es pública,
    lanza SourceError (salvo que quien llama lo pida)."""
    try:
        infos = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    except (OSError, UnicodeError) as error:
        raise SourceError("El host de la URL no se puede resolver") from error
    if not infos:
        raise SourceError("El host de la URL no se puede resolver")
    if not allow_private_network:
        for info in infos:
            address = ipaddress.ip_address(info[4][0].split("%", 1)[0])
            if not is_public_address(address):
                raise SourceError(
                    "No se descarga desde una dirección de red privada, de bucle local o de enlace local"
                )
    return infos


def _is_ip_literal(text: str) -> bool:
    try:
        ipaddress.ip_address(text)
    except ValueError:
        return False
    return True


def ia_license_name(license_url: str | None) -> str | None:
    """Nombre de la licencia de un ítem de Internet Archive, o None si no es una licencia reconocida.

    La URL tiene que ser http(s) de creativecommons.org y su ruta tiene que ser una licencia de
    IA_LICENSE_PATHS, seguida como mucho de un sufijo de IA_LICENSE_SUFFIXES. Una subcadena parecida en otro
    host (example.com/by/4.0/), un segmento '.' o '..', una barra invertida o datos de usuario no cuentan.
    """
    if not isinstance(license_url, str) or not license_url.strip():
        return None
    url = license_url.strip()
    if "\\" in url or "@" in url:  # un navegador leería otro host: se rechaza sin más
        return None
    try:
        parts = urlsplit(url)
        if parts.scheme not in ("http", "https") or canonical_host(url) != IA_LICENSE_HOST:
            return None
    except ValueError:  # incluye SourceError
        return None
    segments = tuple(part.lower() for part in parts.path.split("/") if part)
    for prefix, name in IA_LICENSE_PATHS.items():
        if segments[: len(prefix)] == prefix and _is_license_suffix(segments[len(prefix):]):
            return name
    return None


def _is_license_suffix(rest: tuple[str, ...]) -> bool:
    return rest == () or (len(rest) == 1 and rest[0] in IA_LICENSE_SUFFIXES)


def choose_ia_file(files: list[dict]) -> dict | None:
    """Elige el mejor fichero de audio de un ítem de Internet Archive."""
    audio = [item for item in files if item.get("format") in IA_FORMAT_PREFERENCE]
    for preferred in IA_FORMAT_PREFERENCE:
        for item in audio:
            if item.get("format") == preferred:
                return item
    return None


IA_ITEM_FORM_MESSAGE = (
    "La URL de Internet Archive debe ser de la forma archive.org/details/<identificador>, "
    "archive.org/download/<identificador> o archive.org/download/<identificador>/<fichero>"
)


def ia_identifier(url: str) -> str:
    """Identificador del ítem de una URL de Internet Archive (ADR-0005, ADR-0008), con http o https y el host
    archive.org (también con 'www.' o punto final). Se aceptan:

    - archive.org/details/<identificador>
    - archive.org/download/<identificador>, con una barra final opcional
    - archive.org/download/<identificador>/<fichero>. El fichero no se usa: la licencia y el audio salen de los
      metadatos del ítem.

    Se rechaza cualquier otra forma, los servidores de fichero (ia800100.us.archive.org) y los identificadores con
    barras, con '..' o con caracteres fuera de [A-Za-z0-9._-].
    """
    url_parts = urlsplit(url)
    if url_parts.scheme not in ("http", "https"):
        raise SourceError(IA_ITEM_FORM_MESSAGE)
    host = canonical_host(url)
    if host != "archive.org":
        raise SourceError(IA_FILE_SERVER_MESSAGE if _internet_archive_file_server(host) else IA_ITEM_FORM_MESSAGE)
    # Ruta sin la barra inicial: [tipo, identificador] o [download, identificador, fichero]. Una barra final se tolera.
    parts = url_parts.path.split("/")[1:]
    if parts[-1:] == [""]:
        parts.pop()
    if len(parts) not in (2, 3) or parts[0] not in {"details", "download"}:
        raise SourceError(IA_ITEM_FORM_MESSAGE)
    identifier, file_part = parts[1], parts[2:]
    if file_part and (parts[0] != "download" or not _is_plain_file_name(file_part[0])):
        raise SourceError(IA_ITEM_FORM_MESSAGE)
    if not _is_plain_identifier(identifier):
        raise SourceError(IA_ITEM_FORM_MESSAGE)
    return identifier


def _is_plain_identifier(identifier: str) -> bool:
    """Identificador que puede ir en una URL de descarga y en una carpeta de trabajo: sin barras ni '..'."""
    return IA_IDENTIFIER.fullmatch(identifier) is not None and ".." not in identifier


def _is_plain_file_name(segment: str) -> bool:
    """Segmento de fichero de una ruta de Internet Archive. No se usa para nada, pero tiene que ser un único
    segmento de texto: no vacío, ni '.' o '..' (también codificados), ni con barras ni caracteres de control o de
    formato."""
    name = unquote(segment)
    return (
        name not in ("", ".", "..")
        and "/" not in name
        and "\\" not in name
        and not any(unicodedata.category(char) in UNSAFE_TEXT_CATEGORIES for char in name)
    )


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
    saltos de línea, caracteres de formato, un texto largo) no se usa: la importación toma el título de la
    petición o del fichero."""
    if not isinstance(value, str):
        return None
    clean = value.strip()
    if not clean or len(clean) > IA_TITLE_MAX_CHARS:
        return None
    if any(unicodedata.category(char) in UNSAFE_TEXT_CATEGORIES for char in clean):
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
    """Internet Archive: el dominio raíz y sus servidores de ficheros (ia800100.us.archive.org). Su licencia
    está en el ítem, así que un fichero de ahí no se importa como directo con una licencia declarada a mano
    (ADR-0005)."""
    return host == "archive.org" or host.endswith(".archive.org")


IA_FILE_SERVER_MESSAGE = (
    "Un fichero de Internet Archive se importa desde su ítem (archive.org/details/<identificador> o "
    "archive.org/download/<identificador>), donde figura la licencia"
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
