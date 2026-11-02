"""Resolución y descarga de fuentes para la importación (ADR-0005, ADR-0007).

Sin base de datos: el resultado de una importación se guarda en el catálogo
versionado (sonidos/catalog.py), no aquí.

Cada conexión valida la dirección a la que conecta en el mismo paso en que conecta (resolve_public y
_connect_public): un DNS que cambie entre la comprobación y la conexión no lleva la descarga a la red interna.
"""

from __future__ import annotations

import http.client
import json
import re
import socket
from pathlib import Path
from urllib.request import HTTPHandler, HTTPRedirectHandler, HTTPSHandler, ProxyHandler, Request, build_opener

from sonidos.sources import (
    ResolvedSource,
    SourceError,
    check_download_url,
    classify,
    ia_identifier,
    resolve_direct_file,
    resolve_internet_archive,
    resolve_public,
)

MAX_DOWNLOAD_BYTES = 200 * 1024 * 1024
MAX_METADATA_BYTES = 10 * 1024 * 1024
MAX_REDIRECT_BODY_BYTES = 64 * 1024
USER_AGENT = "reminiscencia-backend/0.2 (importacion con licencia)"

# Longitud declarada: solo cifras (int() acepta '+10000' y '1_0000', que no son una longitud HTTP).
_PLAIN_DIGITS = re.compile(r"[0-9]{1,18}")


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


def _connect_public(host: str, port: int, timeout, source_address, allow_private_network: bool) -> socket.socket:
    """Conecta a una dirección ya validada. El nombre se resuelve una sola vez: lo que se valida es lo que
    se usa para conectar."""
    infos = resolve_public(host, port, allow_private_network=allow_private_network)
    last_error: OSError | None = None
    for info in infos:
        address = info[4][0].split("%", 1)[0]
        try:
            return socket.create_connection((address, port), timeout, source_address)
        except OSError as error:
            last_error = error
    raise last_error if last_error is not None else SourceError("El host de la URL no se puede resolver")


def _connection_classes(allow_private_network: bool):
    class PublicHTTPConnection(http.client.HTTPConnection):
        def connect(self):
            self.sock = _connect_public(
                self.host, self.port, self.timeout, self.source_address, allow_private_network
            )

    class PublicHTTPSConnection(http.client.HTTPSConnection):
        def connect(self):
            sock = _connect_public(self.host, self.port, self.timeout, self.source_address, allow_private_network)
            self.sock = self._context.wrap_socket(sock, server_hostname=self.host)

    return PublicHTTPConnection, PublicHTTPSConnection


def _checked_redirects(*, allow_private_network: bool, internet_archive: bool = False) -> type[HTTPRedirectHandler]:
    class CheckedRedirects(HTTPRedirectHandler):
        """Cada salto de una descarga se revisa antes de seguirlo: una fuente con licencia no puede llevar a
        una plataforma bloqueada, a la red interna ni a un fichero de Internet Archive que no sea suyo
        (ADR-0005)."""

        def redirect_request(self, req, fp, code, msg, headers, newurl):
            check_download_url(
                newurl,
                allow_private_network=allow_private_network,
                allow_internet_archive=internet_archive,
            )
            return super().redirect_request(req, fp, code, msg, headers, newurl)

        def http_error_302(self, req, fp, code, msg, headers):
            return super().http_error_302(req, _LimitedBody(fp), code, msg, headers)

        http_error_301 = http_error_303 = http_error_307 = http_error_308 = http_error_302

    return CheckedRedirects


def _guarded_opener(*, allow_private_network: bool, internet_archive: bool):
    """Abridor que valida la dirección al conectar, en cada petición y en cada redirección. No usa proxies
    del entorno: la petición sale directa a la dirección validada (ADR-0005)."""
    connection, tls_connection = _connection_classes(allow_private_network)

    class PublicHTTPHandler(HTTPHandler):
        def http_open(self, req):
            return self.do_open(connection, req)

    class PublicHTTPSHandler(HTTPSHandler):
        def https_open(self, req):
            # Solo el contexto: en Python 3.14 HTTPSHandler ya no guarda check_hostname. Sin él, la conexión
            # usa la verificación por defecto del contexto (certificado y nombre).
            return self.do_open(tls_connection, req, context=self._context)

    return build_opener(
        ProxyHandler({}),
        PublicHTTPHandler,
        PublicHTTPSHandler,
        _checked_redirects(allow_private_network=allow_private_network, internet_archive=internet_archive),
    )


def fetch_json(url: str, *, allow_private_network: bool = False) -> dict:
    """Metadatos de Internet Archive. Misma guarda de red que una descarga; su límite de tamaño es de 10 MB."""
    check_download_url(url, allow_private_network=allow_private_network, allow_internet_archive=True)
    request = Request(url, headers={"User-Agent": USER_AGENT})
    opener = _guarded_opener(allow_private_network=allow_private_network, internet_archive=True)
    body = bytearray()
    with opener.open(request, timeout=30) as response:
        while True:
            chunk = response.read(1 << 16)
            if not chunk:
                break
            body += chunk
            if len(body) > MAX_METADATA_BYTES:
                raise SourceError("Los metadatos de Internet Archive superan los 10 MB")
    return json.loads(body.decode("utf-8"))


def _declared_length(response) -> int | None:
    """Longitud del Content-Length, o None si no hay. Una cabecera repetida o que no son cifras se rechaza."""
    values = response.headers.get_all("Content-Length") or []
    if not values:
        return None
    value = values[0].strip()
    if len(values) != 1 or not _PLAIN_DIGITS.fullmatch(value):
        raise SourceError("El servidor declara un tamaño de descarga no válido")
    return int(value)


def _copy_body(opener, request: Request, destination: Path) -> None:
    written = 0
    with opener.open(request, timeout=120) as response, destination.open("wb") as handle:
        declared = _declared_length(response)
        if declared is None and not getattr(response, "chunked", False):
            # Sin longitud ni codificación por trozos, un corte no se distingue del final: no se acepta.
            raise SourceError(
                "El servidor no declara el tamaño del fichero; no se puede comprobar que la descarga esté completa"
            )
        while True:
            chunk = response.read(1 << 20)
            if not chunk:
                break
            written += len(chunk)
            if written > MAX_DOWNLOAD_BYTES:
                raise SourceError("El fichero supera el límite de 200 MB")
            handle.write(chunk)
    if declared is not None and written != declared:
        raise SourceError("La descarga se cortó antes de terminar")


def download(
    url: str,
    destination: Path,
    *,
    allow_private_network: bool = False,
    internet_archive: bool = False,
) -> Path:
    """Descarga un fichero con límite de tamaño. Escribe solo dentro de `destination`.

    La URL inicial y cada redirección pasan por check_download_url, y cada conexión valida su dirección
    (nunca se descarga de una plataforma bloqueada ni de la red interna). Un fichero de Internet Archive solo
    se descarga si el ítem es de Internet Archive (internet_archive): de una fuente ajena no (ADR-0005).
    Si el servidor no declara el tamaño o la conexión se corta, la descarga falla y no queda ningún fichero.
    """
    check_download_url(url, allow_private_network=allow_private_network, allow_internet_archive=internet_archive)
    destination.parent.mkdir(parents=True, exist_ok=True)
    request = Request(url, headers={"User-Agent": USER_AGENT})
    opener = _guarded_opener(allow_private_network=allow_private_network, internet_archive=internet_archive)
    try:
        _copy_body(opener, request, destination)
    except http.client.IncompleteRead as error:
        destination.unlink(missing_ok=True)
        raise SourceError("La descarga se cortó antes de terminar") from error
    except BaseException:
        destination.unlink(missing_ok=True)
        raise
    return destination


def resolve_url(url: str, *, license: str | None = None) -> ResolvedSource:
    kind = classify(url)
    if kind == "internet-archive":
        identifier = ia_identifier(url)
        metadata = fetch_json(f"https://archive.org/metadata/{identifier}")
        return resolve_internet_archive(url, metadata)
    return resolve_direct_file(url, license)
