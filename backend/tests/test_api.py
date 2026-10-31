import shutil

from fastapi.testclient import TestClient

from sonidos import intake
from sonidos.api import create_app
from sonidos.importer import import_local_file
from sonidos.library import Library


def _client(tmp_path):
    app = create_app(
        db_path=tmp_path / "library.sqlite",
        audio_dir=tmp_path / "audio",
        staging_dir=tmp_path / "staging",
        web_dir=tmp_path / "web",
        index_path=tmp_path / "indexes" / "songs.json",
    )
    return TestClient(app)


def test_admin_page_is_served(tmp_path):
    client = _client(tmp_path)

    response = client.get("/")

    assert response.status_code == 200
    assert "Panel de administración" in response.text


def test_empty_library_reports_zero(tmp_path):
    client = _client(tmp_path)

    assert client.get("/api/stats").json()["songs"] == 0
    assert client.get("/api/songs").json() == []


def test_blocked_platform_returns_422_without_network(tmp_path, monkeypatch):
    def no_network(*args, **kwargs):
        raise AssertionError("no debe haber red")

    monkeypatch.setattr(intake, "fetch_json", no_network)
    monkeypatch.setattr(intake, "download", no_network)
    client = _client(tmp_path)

    response = client.post("/api/intake", json={"url": "https://www.youtube.com/watch?v=abc"})

    assert response.status_code == 422
    assert "no se puede importar" in response.json()["detail"]


def test_intake_of_licensed_archive_item_creates_song(tmp_path, tone_wav, monkeypatch):
    metadata = {
        "metadata": {"title": "Canción de prueba", "licenseurl": "http://creativecommons.org/publicdomain/mark/1.0/"},
        "files": [{"name": "tono.wav", "format": "Flac"}],
    }
    monkeypatch.setattr(intake, "fetch_json", lambda url: metadata)

    def download(url, destination):
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(tone_wav, destination)
        return destination

    monkeypatch.setattr(intake, "download", download)
    client = _client(tmp_path)

    response = client.post("/api/intake", json={"url": "https://archive.org/details/cancion-prueba"})

    assert response.status_code == 201
    body = response.json()
    assert body["created"] is True
    assert body["source"] == "internet-archive"
    songs = client.get("/api/songs").json()
    assert songs[0]["title"] == "Canción de prueba"
    assert songs[0]["variants"] == ["opus-64k"]


def test_publish_web_writes_playback_index(tmp_path, tone_wav):
    library = Library(tmp_path / "library.sqlite")
    import_local_file(
        library,
        tone_wav,
        license="propia",
        title="Tono",
        variant_profiles=("opus-64k",),
        audio_dir=tmp_path / "audio",
    )
    library.close()
    client = _client(tmp_path)

    response = client.post("/api/publish-web")

    assert response.status_code == 200
    assert response.json()["published"] == 1
    assert (tmp_path / "web" / "data" / "songs.json").exists()
