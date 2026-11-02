"""Descargas con revalidación de cada redirección (ADR-0005).

Solo usan servidores en 127.0.0.1 o se rechazan antes de conectar: estas pruebas no salen a la red.
"""

import http.server
import shutil
import socket
import socketserver
import ssl
import subprocess
import threading
from urllib.request import Request

import pytest

from sonidos import intake, sources
from sonidos.sources import SourceError

PAYLOAD = b"audio de prueba"


@pytest.fixture
def server():
    routes = {}

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):  # noqa: N802 - nombre fijado por http.server
            status, location, body = routes.get(self.path, (404, None, b""))
            self.send_response(status)
            if location is not None:
                self.send_header("Location", location.format(port=httpd.server_address[1]))
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args):
            return

    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    try:
        yield httpd.server_address[1], routes
    finally:
        httpd.shutdown()
        httpd.server_close()


def test_download_follows_a_redirect_to_an_allowed_host(server, tmp_path):
    port, routes = server
    routes["/a.mp3"] = (302, "http://127.0.0.1:{port}/b.mp3", b"")
    routes["/b.mp3"] = (200, None, PAYLOAD)
    destination = tmp_path / "staging" / "a.mp3"

    intake.download(f"http://127.0.0.1:{port}/a.mp3", destination, allow_private_network=True)

    assert destination.read_bytes() == PAYLOAD


def test_redirect_to_a_blocked_platform_is_refused_before_following_it(server, tmp_path):
    port, routes = server
    routes["/a.mp3"] = (302, "https://m.youtube.com/a.mp3", b"")
    destination = tmp_path / "staging" / "a.mp3"

    with pytest.raises(SourceError, match="plataforma"):
        intake.download(f"http://127.0.0.1:{port}/a.mp3", destination, allow_private_network=True)

    assert not destination.exists()


def test_redirect_to_a_scheme_other_than_http_is_refused(server, tmp_path):
    port, routes = server
    routes["/a.mp3"] = (302, "ftp://127.0.0.1:{port}/a.mp3", b"")
    destination = tmp_path / "staging" / "a.mp3"

    with pytest.raises(SourceError, match="http o https"):
        intake.download(f"http://127.0.0.1:{port}/a.mp3", destination, allow_private_network=True)

    assert not destination.exists()


def test_blocked_url_is_refused_before_any_request(tmp_path):
    destination = tmp_path / "staging" / "tema.mp3"

    with pytest.raises(SourceError, match="plataforma"):
        intake.download("https://youtube.com./audio/tema.mp3", destination)

    assert not destination.exists()


# --- Revisión de seguridad 2026-11-02 (corrector de ronda 1) -----------------------------------


@pytest.fixture
def truncating_server():
    """Declara 10000 bytes en Content-Length, envía 4000 y cierra la conexión (descarga cortada)."""

    class Handler(socketserver.StreamRequestHandler):
        def handle(self):
            while self.rfile.readline() not in (b"\r\n", b""):
                pass
            self.wfile.write(b"HTTP/1.1 200 OK\r\nContent-Length: 10000\r\nConnection: close\r\n\r\n" + b"x" * 4000)

    httpd = socketserver.ThreadingTCPServer(("127.0.0.1", 0), Handler)
    httpd.daemon_threads = True
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    try:
        yield httpd.server_address[1]
    finally:
        httpd.shutdown()
        httpd.server_close()


def test_download_that_ends_before_the_declared_length_is_refused(truncating_server, tmp_path):
    destination = tmp_path / "staging" / "tema.mp3"

    with pytest.raises(SourceError, match="cortó"):
        intake.download(f"http://127.0.0.1:{truncating_server}/tema.mp3", destination, allow_private_network=True)

    assert not destination.exists()


def test_download_refuses_a_private_address_by_default_before_connecting(tmp_path):
    destination = tmp_path / "staging" / "a.mp3"

    with pytest.raises(SourceError, match="red privada"):
        intake.download("http://169.254.169.254/latest/meta-data/x.mp3", destination)

    assert not destination.exists()


def test_redirect_to_a_private_address_is_refused_by_default():
    handler = intake._checked_redirects(allow_private_network=False)()

    with pytest.raises(SourceError, match="red privada"):
        handler.redirect_request(None, None, 302, "Found", {}, "http://127.0.0.1:8080/x.mp3")


def test_redirect_to_a_streaming_cdn_is_refused(server, tmp_path):
    port, routes = server
    routes["/a.mp3"] = (302, "https://t4.bcbits.com/stream/a.mp3", b"")
    destination = tmp_path / "staging" / "a.mp3"

    with pytest.raises(SourceError, match="no se puede importar"):
        intake.download(f"http://127.0.0.1:{port}/a.mp3", destination, allow_private_network=True)

    assert not destination.exists()


def test_metadata_larger_than_the_limit_is_refused(server, monkeypatch):
    port, routes = server
    routes["/metadata/tema-item"] = (200, None, b'{"metadata": {"title": "' + b"a" * 500 + b'"}}')
    monkeypatch.setattr(intake, "MAX_METADATA_BYTES", 100)

    with pytest.raises(SourceError, match="superan"):
        intake.fetch_json(f"http://127.0.0.1:{port}/metadata/tema-item", allow_private_network=True)


def test_metadata_within_the_limit_is_read(server):
    port, routes = server
    routes["/metadata/tema-item"] = (200, None, b'{"files": []}')

    assert intake.fetch_json(f"http://127.0.0.1:{port}/metadata/tema-item", allow_private_network=True) == {"files": []}


class _EndlessBody:
    """Cuerpo sin fin: registra cuántos bytes le piden."""

    def __init__(self):
        self.requested = []

    def read(self, amount=-1):
        self.requested.append(amount)
        return b"x" * (amount if amount >= 0 else 1 << 20)

    def close(self):
        pass


def test_redirect_body_is_read_only_up_to_a_limit(monkeypatch):
    monkeypatch.setattr(intake, "MAX_REDIRECT_BODY_BYTES", 16)
    body = _EndlessBody()

    data = intake._LimitedBody(body).read()

    assert len(data) <= 16
    assert all(0 < amount <= 16 for amount in body.requested)


# --- Corrección de la ronda 2 (2026-11-02): conexión validada, longitud y redirecciones ----------


@pytest.fixture
def raw_server():
    """Sirve, en 127.0.0.1, la respuesta HTTP exacta que se le pase (cabeceras y cuerpo)."""
    servers = []

    def serve(payload: bytes) -> int:
        class Handler(socketserver.StreamRequestHandler):
            def handle(self):
                while self.rfile.readline() not in (b"\r\n", b""):
                    pass
                self.wfile.write(payload)

        httpd = socketserver.ThreadingTCPServer(("127.0.0.1", 0), Handler)
        httpd.daemon_threads = True
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        servers.append(httpd)
        return httpd.server_address[1]

    try:
        yield serve
    finally:
        for httpd in servers:
            httpd.shutdown()
            httpd.server_close()


@pytest.mark.parametrize("declared", ["+10000", "1_0000", "10000, 10000", "abc"])
def test_content_length_that_is_not_plain_digits_is_refused(raw_server, tmp_path, declared):
    port = raw_server(
        b"HTTP/1.1 200 OK\r\nContent-Length: " + declared.encode() + b"\r\nConnection: close\r\n\r\n" + b"x" * 4000
    )
    destination = tmp_path / "staging" / "tema.mp3"

    with pytest.raises(SourceError, match="tamaño"):
        intake.download(f"http://127.0.0.1:{port}/tema.mp3", destination, allow_private_network=True)

    assert not destination.exists()


def test_response_without_content_length_or_chunked_encoding_is_refused(raw_server, tmp_path):
    # Sin longitud no se puede saber si el servidor cortó: el fichero quedaría truncado y aceptado.
    port = raw_server(b"HTTP/1.0 200 OK\r\nContent-Type: audio/mpeg\r\n\r\n" + b"x" * 4000)
    destination = tmp_path / "staging" / "tema.mp3"

    with pytest.raises(SourceError, match="no declara el tamaño"):
        intake.download(f"http://127.0.0.1:{port}/tema.mp3", destination, allow_private_network=True)

    assert not destination.exists()


def test_chunked_download_cut_in_the_middle_is_refused_and_removed(raw_server, tmp_path):
    port = raw_server(
        b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n" + b"100\r\n" + b"x" * 40 + b"\r\n"
    )
    destination = tmp_path / "staging" / "tema.mp3"

    with pytest.raises(SourceError, match="cortó"):
        intake.download(f"http://127.0.0.1:{port}/tema.mp3", destination, allow_private_network=True)

    assert not destination.exists()


def test_address_that_changes_between_the_check_and_the_connection_is_refused(monkeypatch, tmp_path):
    # El primer DNS responde pública (la comprobación) y el segundo, de bucle local (la conexión).
    answers = []

    def getaddrinfo(host, *args, **kwargs):
        answers.append(host)
        address = "93.184.216.34" if len(answers) == 1 else "127.0.0.1"
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (address, 80))]

    monkeypatch.setattr(sources.socket, "getaddrinfo", getaddrinfo)
    destination = tmp_path / "staging" / "tema.mp3"

    with pytest.raises(SourceError, match="red privada"):
        intake.download("http://rebind.example/tema.mp3", destination)

    assert not destination.exists()
    assert len(answers) >= 2


def test_download_ignores_proxies_from_the_environment(server, tmp_path, monkeypatch):
    # Con un proxy en el entorno, la petición iría a ese proxy y no a la dirección que se validó. El proxy
    # de aquí está cerrado: si se usara, la descarga fallaría.
    port, routes = server
    routes["/tema.mp3"] = (200, None, PAYLOAD)
    monkeypatch.setenv("HTTP_PROXY", "http://127.0.0.1:1")
    monkeypatch.setenv("http_proxy", "http://127.0.0.1:1")
    destination = tmp_path / "staging" / "tema.mp3"

    intake.download(f"http://127.0.0.1:{port}/tema.mp3", destination, allow_private_network=True)

    assert destination.read_bytes() == PAYLOAD


def test_direct_download_cannot_be_redirected_into_internet_archive():
    handler = intake._checked_redirects(allow_private_network=True, internet_archive=False)()

    with pytest.raises(SourceError, match="archive.org/details"):
        handler.redirect_request(None, None, 302, "Found", {}, "https://ia800100.us.archive.org/items/abc/x.mp3")


def test_internet_archive_download_may_follow_its_own_file_server():
    handler = intake._checked_redirects(allow_private_network=True, internet_archive=True)()
    request = Request("https://archive.org/download/abc/x.mp3")

    redirected = handler.redirect_request(
        request, None, 302, "Found", {}, "https://ia800100.us.archive.org/9/items/abc/x.mp3"
    )

    assert redirected.full_url == "https://ia800100.us.archive.org/9/items/abc/x.mp3"


def test_metadata_request_refuses_a_private_address_by_default(server):
    port, routes = server
    routes["/metadata/tema-item"] = (200, None, b'{"files": []}')

    with pytest.raises(SourceError, match="red privada"):
        intake.fetch_json(f"http://127.0.0.1:{port}/metadata/tema-item")


def test_metadata_redirect_to_a_private_address_is_refused():
    handler = intake._checked_redirects(allow_private_network=False, internet_archive=True)()

    with pytest.raises(SourceError, match="red privada"):
        handler.redirect_request(None, None, 302, "Found", {}, "http://127.0.0.1:8080/metadata/x")


@pytest.fixture
def tls_server(tmp_path, monkeypatch):
    """Servidor HTTPS en 127.0.0.1 con un certificado de prueba. El entorno lo declara de confianza
    (SSL_CERT_FILE), así que la descarga verifica el certificado como en Internet Archive."""
    openssl = shutil.which("openssl")
    if openssl is None:
        pytest.skip("hace falta openssl para generar el certificado de prueba")
    cert, key = tmp_path / "cert.pem", tmp_path / "key.pem"
    made = subprocess.run(
        [openssl, "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", str(key), "-out", str(cert),
         "-days", "1", "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1"],
        capture_output=True, check=False,
    )
    if made.returncode != 0:
        pytest.skip("openssl no puede generar el certificado de prueba")

    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(cert, key)

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):  # noqa: N802 - nombre fijado por http.server
            self.send_response(200)
            self.send_header("Content-Length", str(len(PAYLOAD)))
            self.end_headers()
            self.wfile.write(PAYLOAD)

        def log_message(self, *args):
            return

    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    httpd.socket = context.wrap_socket(httpd.socket, server_side=True)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    monkeypatch.setenv("SSL_CERT_FILE", str(cert))
    try:
        yield httpd.server_address[1]
    finally:
        httpd.shutdown()
        httpd.server_close()


def test_https_download_verifies_the_certificate_and_reads_the_body(tls_server, tmp_path):
    destination = tmp_path / "staging" / "tema.mp3"

    intake.download(f"https://127.0.0.1:{tls_server}/tema.mp3", destination, allow_private_network=True)

    assert destination.read_bytes() == PAYLOAD


def test_https_download_refuses_a_certificate_nobody_trusts(tls_server, tmp_path, monkeypatch):
    monkeypatch.delenv("SSL_CERT_FILE", raising=False)
    destination = tmp_path / "staging" / "tema.mp3"

    with pytest.raises(OSError):
        intake.download(f"https://127.0.0.1:{tls_server}/tema.mp3", destination, allow_private_network=True)

    assert not destination.exists()
