"""Resolución y descarga de fuentes para la importación (ADR-0005, ADR-0007).

Sin base de datos: el resultado de una importación se guarda en el catálogo
versionado (sonidos/catalog.py), no aquí.
"""

from __future__ import annotations

import json
from pathlib import Path
from urllib.request import HTTPRedirectHandler, Request, build_opener, urlopen

from sonidos.sources import (
    ResolvedSource,
    SourceError,
    check_download_url,
    classify,
    ia_identifier,
    resolve_direct_file,
    resolve_internet_archive,
)

MAX_DOWNLOAD_BYTES = 200 * 1024 * 1024
MAX_METADATA_BYTES = 10 * 1024 * 1024
MAX_REDIRECT_BODY_BYTES = 64 * 1024
USER_AGENT = "reminiscencia-backend/0.2 (importacion con licencia)"


class _LimitedBody:
    """Cuerpo de una redirección. urllib lo lee entero antes de seguirla; aquí solo hasta un límite."""

    def __init__(self, response):
        self._response = response

    def read(self, amount=-1):
        if amount is None or amount < 0 or amount > MAX_REDIRECT_BODY_BYTES:
            amount = MAX_REDIRECT_BODY_BYTES
        return self._response.read(amount)

    def __getattr__(self, name):
        return getattr(self._response, name)


def _checked_redirects(allow_private_network: bool) -> type[HTTPRedirectHandler]:
    class CheckedRedirects(HTTPRedirectHandler):
        """Cada salto de una descarga se revisa antes de seguirlo: una fuente con licencia no puede llevar a
        una plataforma bloqueada ni a la red interna (ADR-0005)."""

        def redirect_request(self, req, fp, code, msg, headers, newurl):
            check_download_url(newurl, allow_private_network=allow_private_network)
            return super().redirect_request(req, fp, code, msg, headers, newurl)

        def http_error_302(self, req, fp, code, msg, headers):
            return super().http_error_302(req, _LimitedBody(fp), code, msg, headers)

        http_error_301 = http_error_303 = http_error_307 = http_error_308 = http_error_302

    return CheckedRedirects


def fetch_json(url: str) -> dict:
    request = Request(url, headers={"User-Agent": USER_AGENT})
    body = bytearray()
    with urlopen(request, timeout=30) as response:
        while True:
            chunk = response.read(1 << 16)
            if not chunk:
                break
            body += chunk
            if len(body) > MAX_METADATA_BYTES:
                raise SourceError("Los metadatos de Internet Archive superan los 10 MB")
    return json.loads(body.decode("utf-8"))


def _declared_length(response) -> int | None:
    value = (response.headers.get("Content-Length") or "").strip()
    return int(value) if value.isdigit() else None


def download(url: str, destination: Path, *, allow_private_network: bool = False) -> Path:
    """Descarga un fichero con límite de tamaño. Escribe solo dentro de `destination`.

    La URL inicial y cada redirección pasan por check_download_url: nunca se descarga de una
    plataforma bloqueada ni de la red interna, aunque la fuente inicial sea válida. Si el servidor
    declara el tamaño y la conexión se corta antes, la descarga falla: no se importa un fichero truncado.
    """
    check_download_url(url, allow_private_network=allow_private_network)
    destination.parent.mkdir(parents=True, exist_ok=True)
    request = Request(url, headers={"User-Agent": USER_AGENT})
    opener = build_opener(_checked_redirects(allow_private_network))
    written = 0
    with opener.open(request, timeout=120) as response, destination.open("wb") as handle:
        declared = _declared_length(response)
        while True:
            chunk = response.read(1 << 20)
            if not chunk:
                break
            written += len(chunk)
            if written > MAX_DOWNLOAD_BYTES:
                handle.close()
                destination.unlink(missing_ok=True)
                raise SourceError("El fichero supera el límite de 200 MB")
            handle.write(chunk)
    if declared is not None and written != declared:
        destination.unlink(missing_ok=True)
        raise SourceError("La descarga se cortó antes de terminar")
    return destination


def resolve_url(url: str, *, license: str | None = None) -> ResolvedSource:
    kind = classify(url)
    if kind == "internet-archive":
        identifier = ia_identifier(url)
        metadata = fetch_json(f"https://archive.org/metadata/{identifier}")
        return resolve_internet_archive(url, metadata)
    return resolve_direct_file(url, license)
