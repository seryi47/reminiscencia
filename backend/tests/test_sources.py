import pytest

from sonidos.sources import SourceError, classify, ia_identifier, resolve_direct_file, resolve_internet_archive


@pytest.mark.parametrize(
    "url",
    [
        "https://archive.org/details/tema-item",
        "https://archive.org/download/tema-item/",
        "https://www.archive.org/details/tema-item?tab=about",
    ],
)
def test_ia_identifier_accepts_details_and_download_forms(url):
    assert ia_identifier(url) == "tema-item"


@pytest.mark.parametrize(
    "url",
    [
        "https://archive.org/details/",
        "https://archive.org/details/a/b",
        "https://archive.org/stream/a",
        "https://archive.org/details/..",
        "https://archive.org/details/.oculto",
        "https://archive.org/details/a%20b/../c",
    ],
)
def test_ia_identifier_refuses_other_shapes_and_unsafe_identifiers(url):
    with pytest.raises(SourceError, match="forma archive.org"):
        ia_identifier(url)


@pytest.mark.parametrize(
    "url",
    [
        "https://www.youtube.com/watch?v=abc123",
        "https://youtu.be/abc123",
        "https://open.spotify.com/track/xyz",
        "https://soundcloud.com/artista/cancion",
        "https://music.youtube.com/watch?v=abc",
    ],
)
def test_streaming_platforms_are_refused_before_any_download(url):
    with pytest.raises(SourceError, match="no se puede importar"):
        classify(url)


def test_unknown_host_is_refused():
    with pytest.raises(SourceError, match="no soportada"):
        classify("https://ejemplo.com/pagina.html")


def test_non_http_url_is_refused():
    with pytest.raises(SourceError, match="http"):
        classify("ftp://archive.org/details/algo")


def test_classify_recognises_internet_archive_and_direct_audio():
    assert classify("https://archive.org/details/charleston1925") == "internet-archive"
    assert classify("https://ejemplo.com/pistas/tema.flac") == "direct"


def _ia_metadata(license_url, files):
    return {
        "metadata": {"title": "Un tema", "licenseurl": license_url},
        "files": files,
    }


def test_internet_archive_prefers_flac_and_reads_license_from_item():
    metadata = _ia_metadata(
        "http://creativecommons.org/publicdomain/mark/1.0/",
        [
            {"name": "tema.mp3", "format": "VBR MP3"},
            {"name": "tema.flac", "format": "Flac"},
            {"name": "tema.jpg", "format": "JPEG"},
        ],
    )

    resolved = resolve_internet_archive("https://archive.org/details/tema-item", metadata)

    assert resolved.file_name == "tema.flac"
    assert resolved.download_url == "https://archive.org/download/tema-item/tema.flac"
    assert "Dominio público" in resolved.license
    assert "tema-item" in resolved.license
    assert resolved.title == "Un tema"


def test_internet_archive_item_without_known_license_is_refused():
    metadata = _ia_metadata(
        "https://example.com/licencia-rara",
        [{"name": "tema.mp3", "format": "VBR MP3"}],
    )

    with pytest.raises(SourceError, match="no declara una licencia reconocida"):
        resolve_internet_archive("https://archive.org/details/tema-item", metadata)


def test_internet_archive_item_without_audio_is_refused():
    metadata = _ia_metadata(
        "http://creativecommons.org/publicdomain/mark/1.0/",
        [{"name": "portada.jpg", "format": "JPEG"}],
    )

    with pytest.raises(SourceError, match="no tiene un fichero de audio"):
        resolve_internet_archive("https://archive.org/details/tema-item", metadata)


def test_direct_file_requires_declared_license():
    with pytest.raises(SourceError, match="indicar la licencia"):
        resolve_direct_file("https://ejemplo.com/tema.mp3", license=None)


def test_direct_file_requires_audio_extension():
    with pytest.raises(SourceError, match="fichero de audio directo"):
        resolve_direct_file("https://ejemplo.com/pagina.html", license="CC0")


def test_direct_file_keeps_declared_license():
    resolved = resolve_direct_file("https://ejemplo.com/tema.opus", license=" CC BY 4.0 ")

    assert resolved.source == "direct-url"
    assert resolved.license == "CC BY 4.0"
    assert resolved.file_name == "tema.opus"
