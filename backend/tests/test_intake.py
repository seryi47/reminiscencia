import shutil

import pytest

from sonidos import intake
from sonidos.intake import intake_url
from sonidos.library import Library
from sonidos.sources import SourceError


@pytest.fixture
def library(tmp_path):
    lib = Library(tmp_path / "library.sqlite")
    yield lib
    lib.close()


def _fake_download(source_file):
    def download(url, destination):
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source_file, destination)
        return destination

    return download


def test_internet_archive_url_is_imported_with_item_license(library, tone_wav, tmp_path, monkeypatch):
    metadata = {
        "metadata": {"title": "Tono de archivo", "licenseurl": "http://creativecommons.org/publicdomain/mark/1.0/"},
        "files": [{"name": "tono.wav", "format": "Flac"}],
    }
    monkeypatch.setattr(intake, "fetch_json", lambda url: metadata)
    monkeypatch.setattr(intake, "download", _fake_download(tone_wav))

    report, resolved = intake_url(
        library,
        "https://archive.org/details/tono-archivo",
        staging_dir=tmp_path / "staging",
        audio_dir=tmp_path / "audio",
    )

    assert report.result.created is True
    song = library.get_song(report.result.song_id)
    assert song["title"] == "Tono de archivo"
    assert song["source"] == "internet-archive:tono-archivo"
    assert "tono-archivo" in song["license"]
    assert [v["profile"] for v in library.variants_for(report.result.song_id)] == ["opus-64k"]


def test_same_url_twice_does_not_duplicate(library, tone_wav, tmp_path, monkeypatch):
    metadata = {
        "metadata": {"licenseurl": "http://creativecommons.org/publicdomain/zero/1.0/"},
        "files": [{"name": "tono.wav", "format": "Flac"}],
    }
    monkeypatch.setattr(intake, "fetch_json", lambda url: metadata)
    monkeypatch.setattr(intake, "download", _fake_download(tone_wav))
    url = "https://archive.org/details/tono-repetido"

    first, _ = intake_url(library, url, staging_dir=tmp_path / "s", audio_dir=tmp_path / "a")
    second, _ = intake_url(library, url, staging_dir=tmp_path / "s", audio_dir=tmp_path / "a")

    assert first.result.created is True
    assert second.result.created is False
    assert len(library.list_songs()) == 1


def test_direct_url_needs_license(library, tmp_path):
    with pytest.raises(SourceError, match="indicar la licencia"):
        intake_url(
            library,
            "https://ejemplo.com/tema.mp3",
            staging_dir=tmp_path / "s",
            audio_dir=tmp_path / "a",
        )
    assert library.list_songs() == []


def test_blocked_platform_never_downloads(library, tmp_path, monkeypatch):
    def no_network(*args, **kwargs):
        raise AssertionError("no debe descargar nada de una plataforma bloqueada")

    monkeypatch.setattr(intake, "download", no_network)
    monkeypatch.setattr(intake, "fetch_json", no_network)

    with pytest.raises(SourceError, match="no se puede importar"):
        intake_url(
            library,
            "https://www.youtube.com/watch?v=abc",
            staging_dir=tmp_path / "s",
            audio_dir=tmp_path / "a",
            license="cualquiera",
        )
