import shutil

import pytest

from sonidos import intake
from sonidos.catalog import CatalogError
from sonidos.pipeline import import_url
from sonidos.sources import SourceError


@pytest.fixture
def paths(tmp_path):
    return dict(catalog_path=tmp_path / "catalog.json", audio_dir=tmp_path / "audio", staging_dir=tmp_path / "staging")


def _fake_download(source):
    def download(url, destination):
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, destination)
        return destination
    return download


def test_archive_url_is_converted_and_cataloged(paths, tone_wav, monkeypatch):
    metadata = {"metadata": {"title": "Tono", "licenseurl": "http://creativecommons.org/publicdomain/mark/1.0/"},
                "files": [{"name": "tono.wav", "format": "Flac"}]}
    monkeypatch.setattr(intake, "fetch_json", lambda url: metadata)
    monkeypatch.setattr(intake, "download", _fake_download(tone_wav))

    result = import_url(url="https://archive.org/details/tono-prueba", license=None, **paths)

    assert result["created"] is True
    assert (paths["audio_dir"] / f"{result['song_id']}.opus").exists()
    assert not (paths["staging_dir"] / "tono-prueba").exists()
    from sonidos import catalog
    song = catalog.find_song(catalog.load(paths["catalog_path"]), result["song_id"])
    assert song["public"] is False and song["title"] == "Tono"


def test_same_content_twice_is_not_duplicated(paths, tone_wav, monkeypatch):
    metadata = {"metadata": {"licenseurl": "http://creativecommons.org/publicdomain/zero/1.0/"},
                "files": [{"name": "tono.wav", "format": "Flac"}]}
    monkeypatch.setattr(intake, "fetch_json", lambda url: metadata)
    monkeypatch.setattr(intake, "download", _fake_download(tone_wav))
    first = import_url(url="https://archive.org/details/a", license=None, **paths)
    second = import_url(url="https://archive.org/details/a", license=None, **paths)
    assert first["created"] is True and second["created"] is False


def test_platform_is_refused_without_any_download(paths, monkeypatch):
    def no_network(*a, **k):
        raise AssertionError("no debe descargar")
    monkeypatch.setattr(intake, "download", no_network)
    with pytest.raises(SourceError, match="no se puede importar"):
        import_url(url="https://www.youtube.com/watch?v=x", license="CC0", **paths)


def test_direct_file_without_license_is_refused(paths):
    with pytest.raises(SourceError, match="indicar la licencia"):
        import_url(url="https://ejemplo.com/tema.mp3", license=None, **paths)


def test_empty_license_is_refused_before_download(paths, monkeypatch):
    def no_network(*a, **k):
        raise AssertionError("no debe descargar sin licencia")
    monkeypatch.setattr(intake, "download", no_network)
    with pytest.raises(SourceError, match="indicar la licencia"):
        import_url(url="https://ejemplo.com/tema.wav", license="   ", **paths)
