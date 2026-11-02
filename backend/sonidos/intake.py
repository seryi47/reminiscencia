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
USER_AGENT = "reminiscencia-backend/0.2 (importacion con licencia)"


class _CheckedRedirects(HTTPRedirectHandler):
    """Cada salto de una descarga se revisa antes de seguirlo: una fuente con licencia no puede
    llevar a una plataforma bloqueada (ADR-0005)."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        check_download_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


_DOWNLOADER = build_opener(_CheckedRedirects)


def fetch_json(url: str) -> dict:
    request = Request(url, headers={"User-Agent": USER_AGENT})
    with urlopen(request, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))


def download(url: str, destination: Path) -> Path:
    """Descarga un fichero con límite de tamaño. Escribe solo dentro de `destination`.

    La URL inicial y cada redirección pasan por check_download_url: nunca se descarga de una
    plataforma bloqueada, aunque la fuente inicial sea válida.
    """
    check_download_url(url)
    destination.parent.mkdir(parents=True, exist_ok=True)
    request = Request(url, headers={"User-Agent": USER_AGENT})
    written = 0
    with _DOWNLOADER.open(request, timeout=120) as response, destination.open("wb") as handle:
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
    return destination


def resolve_url(url: str, *, license: str | None = None) -> ResolvedSource:
    kind = classify(url)
    if kind == "internet-archive":
        identifier = ia_identifier(url)
        metadata = fetch_json(f"https://archive.org/metadata/{identifier}")
        return resolve_internet_archive(url, metadata)
    return resolve_direct_file(url, license)
