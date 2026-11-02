"""Descargas con revalidación de cada redirección (ADR-0005).

Solo usan servidores en 127.0.0.1 o se rechazan antes de conectar: estas pruebas no salen a la red.
"""

import http.server
import socketserver
import threading

import pytest

from sonidos import intake
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
        intake.fetch_json(f"http://127.0.0.1:{port}/metadata/tema-item")


def test_metadata_within_the_limit_is_read(server):
    port, routes = server
    routes["/metadata/tema-item"] = (200, None, b'{"files": []}')

    assert intake.fetch_json(f"http://127.0.0.1:{port}/metadata/tema-item") == {"files": []}


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
