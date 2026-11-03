import shutil

import pytest

from sonidos import catalog, intake
from sonidos.catalog import CatalogError
from sonidos.pipeline import import_url
from sonidos.sources import SourceError


@pytest.fixture
def paths(tmp_path):
    return dict(catalog_path=tmp_path / "catalog.json", audio_dir=tmp_path / "audio", staging_dir=tmp_path / "staging")


def _fake_download(source):
    def download(url, destination, **kwargs):
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


# --- Corrección de la ronda 2 (2026-11-02) -----------------------------------------------------


def test_staging_folder_is_removed_when_the_download_fails(paths, monkeypatch):
    def broken_download(url, destination, **kwargs):
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(b"parcial")
        raise SourceError("La descarga se cortó antes de terminar")

    monkeypatch.setattr(intake, "download", broken_download)

    with pytest.raises(SourceError, match="cortó"):
        import_url(url="https://ejemplo.com/tema.wav", license="CC0", **paths)

    assert not (paths["staging_dir"] / "ejemplo.com_tema.wav").exists()


def test_title_taken_from_the_file_name_is_limited_to_200_characters(paths, tone_wav, monkeypatch):
    monkeypatch.setattr(intake, "download", _fake_download(tone_wav))

    result = import_url(url=f"https://ejemplo.com/{'a' * 210}.wav", license="CC0", **paths)

    song = catalog.find_song(catalog.load(paths["catalog_path"]), result["song_id"])
    assert len(song["title"]) == 200


def test_direct_download_is_not_marked_as_internet_archive(paths, tone_wav, monkeypatch):
    seen = {}

    def spy(url, destination, **kwargs):
        seen.update(kwargs)
        return _fake_download(tone_wav)(url, destination)

    monkeypatch.setattr(intake, "download", spy)

    import_url(url="https://ejemplo.com/tema.wav", license="CC0", **paths)

    assert seen == {"internet_archive": False}


# --- Artista y año desde Internet Archive (2026-11-03) -----------------------------------------


def _import_ia(paths, tone_wav, monkeypatch, **fields):
    metadata = {"metadata": {"title": "Tono", "licenseurl": "http://creativecommons.org/publicdomain/mark/1.0/",
                             **fields},
                "files": [{"name": "tono.wav", "format": "Flac"}]}
    monkeypatch.setattr(intake, "fetch_json", lambda url: metadata)
    monkeypatch.setattr(intake, "download", _fake_download(tone_wav))
    result = import_url(url="https://archive.org/details/tono-prueba", license=None, **paths)
    return catalog.find_song(catalog.load(paths["catalog_path"]), result["song_id"])


def test_internet_archive_import_saves_creator_as_artist_and_the_year(paths, tone_wav, monkeypatch):
    song = _import_ia(paths, tone_wav, monkeypatch, creator=["Harry Macdonough", "Grace Spencer"],
                      date="1902-00-00 00:00:00")

    assert song["artist"] == "Harry Macdonough, Grace Spencer"
    assert song["year"] == 1902


def test_internet_archive_import_with_unusable_creator_and_date_still_imports(paths, tone_wav, monkeypatch):
    song = _import_ia(paths, tone_wav, monkeypatch, creator="x" * 500, date="hacia 1920", year="1920s")

    assert song["artist"] == "x" * catalog.SONG_ARTIST_MAX_CHARS
    assert song["year"] is None
    assert song["title"] == "Tono"


def test_internet_archive_import_artist_and_year_pass_the_request_contract(paths, tone_wav, monkeypatch):
    from sonidos.issue_request import validate_payload

    song = _import_ia(paths, tone_wav, monkeypatch, creator="y" * 300, year=1925)

    validated = validate_payload({"op": "edit_song", "song_id": song["id"], "artist": song["artist"],
                                  "year": song["year"]})
    assert validated["artist"] == song["artist"] and validated["year"] == 1925


def test_direct_file_import_keeps_artist_empty(paths, tone_wav, monkeypatch):
    monkeypatch.setattr(intake, "download", _fake_download(tone_wav))

    result = import_url(url="https://ejemplo.com/tema.wav", license="CC0", **paths)

    song = catalog.find_song(catalog.load(paths["catalog_path"]), result["song_id"])
    assert song["artist"] == "" and song["year"] is None
