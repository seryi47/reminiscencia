"""Descargas con revalidación de cada redirección (ADR-0005).

Solo usan servidores en 127.0.0.1 o se rechazan antes de conectar: estas pruebas no salen a la red.
"""

import http.server
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

    intake.download(f"http://127.0.0.1:{port}/a.mp3", destination)

    assert destination.read_bytes() == PAYLOAD


def test_redirect_to_a_blocked_platform_is_refused_before_following_it(server, tmp_path):
    port, routes = server
    routes["/a.mp3"] = (302, "https://m.youtube.com/a.mp3", b"")
    destination = tmp_path / "staging" / "a.mp3"

    with pytest.raises(SourceError, match="plataforma"):
        intake.download(f"http://127.0.0.1:{port}/a.mp3", destination)

    assert not destination.exists()


def test_redirect_to_a_scheme_other_than_http_is_refused(server, tmp_path):
    port, routes = server
    routes["/a.mp3"] = (302, "ftp://127.0.0.1:{port}/a.mp3", b"")
    destination = tmp_path / "staging" / "a.mp3"

    with pytest.raises(SourceError, match="http o https"):
        intake.download(f"http://127.0.0.1:{port}/a.mp3", destination)

    assert not destination.exists()


def test_blocked_url_is_refused_before_any_request(tmp_path):
    destination = tmp_path / "staging" / "tema.mp3"

    with pytest.raises(SourceError, match="plataforma"):
        intake.download("https://youtube.com./audio/tema.mp3", destination)

    assert not destination.exists()
