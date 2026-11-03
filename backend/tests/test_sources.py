import pytest

from sonidos import intake, sources
from sonidos.sources import (
    SourceError,
    canonical_host,
    check_download_url,
    classify,
    ia_identifier,
    ia_license_name,
    resolve_direct_file,
    resolve_internet_archive,
)


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


# --- Formas de descarga de Internet Archive (ADR-0008): archive.org/download/<id>/<fichero> -------------


@pytest.mark.parametrize(
    ("url", "expected"),
    [
        ("https://archive.org/download/tema-item", "tema-item"),
        ("https://archive.org/download/tema-item/tema.flac", "tema-item"),
        ("https://archive.org/download/tema-item/tema%20uno%20%28versi%C3%B3n%202%29.mp3", "tema-item"),
        ("https://archive.org/download/tema-item/portada.jpg", "tema-item"),
        ("https://archive.org/download/tema-item/tema.mp3?download=1", "tema-item"),
        ("https://archive.org/download/tema-item/tema.mp3#t=10", "tema-item"),
        ("https://www.archive.org/download/tema-item/tema.mp3", "tema-item"),
        ("https://archive.org./download/tema-item/tema.mp3", "tema-item"),
        ("https://archive.org/details/tema-item/", "tema-item"),
    ],
)
def test_download_forms_with_a_file_are_the_item_and_the_file_name_is_ignored(url, expected):
    assert ia_identifier(url) == expected


def test_classify_sends_download_paths_to_internet_archive():
    assert classify("https://archive.org/download/tema-item") == "internet-archive"
    assert classify("https://archive.org/download/tema-item/tema.flac") == "internet-archive"


@pytest.mark.parametrize(
    "url",
    [
        # Sin identificador
        "https://archive.org/",
        "https://archive.org/download/",
        "https://archive.org/download",
        "https://archive.org/download//tema.mp3",
        "https://archive.org//download/tema-item",
        # Identificadores con barras, con '..' o codificados
        "https://archive.org/download/../tema.mp3",
        "https://archive.org/download/a..b/tema.mp3",
        "https://archive.org/download/a%2Fb/tema.mp3",
        "https://archive.org/download/tema-item;x/tema.mp3",
        # Un fichero que no es un único nombre de texto
        "https://archive.org/download/tema-item/..",
        "https://archive.org/download/tema-item/.",
        "https://archive.org/download/tema-item/%2e%2e",
        "https://archive.org/download/tema-item/sub/tema.mp3",
        "https://archive.org/download/tema-item/a%2Fb.mp3",
        "https://archive.org/download/tema-item/a%5Cb.mp3",
        "https://archive.org/download/tema-item/%E2%80%AEtema.mp3",
        "https://archive.org/download/tema-item//",
        # Otras formas: details no admite fichero, y stream, services o la búsqueda no son ítems
        "https://archive.org/details/tema-item/tema.mp3",
        "https://archive.org/details/a/b",
        "https://archive.org/stream/tema-item/tema.mp3",
        "https://archive.org/services/tema-item",
        "https://archive.org/search?query=tema",
    ],
)
def test_archive_forms_outside_the_contract_are_refused(url):
    with pytest.raises(SourceError, match="forma archive.org"):
        ia_identifier(url)


@pytest.mark.parametrize(
    "url",
    [
        "https://ia800100.us.archive.org/download/tema-item/tema.mp3",
        "https://ia800100.us.archive.org/download/tema-item",
        "https://ia800100.us.archive.org/12/items/tema-item/tema.mp3",
        "http://ia600200.us.archive.org/5/items/tema-item/tema.flac",
    ],
)
def test_internet_archive_file_servers_are_refused_as_item_identifiers(url):
    with pytest.raises(SourceError, match="archive.org/details"):
        ia_identifier(url)


@pytest.mark.parametrize(
    "url",
    [
        "https://archive.org.ejemplo.com/download/tema-item/tema.mp3",
        "https://ejemplo.com/archive.org/download/tema-item",
        "https://notarchive.org/details/tema-item",
        "ftp://archive.org/download/tema-item/tema.mp3",
    ],
)
def test_other_hosts_and_schemes_are_not_internet_archive_items(url):
    with pytest.raises(SourceError, match="forma archive.org"):
        ia_identifier(url)


def test_error_messages_name_the_download_forms_too():
    with pytest.raises(SourceError) as shape:
        ia_identifier("https://archive.org/stream/tema-item")
    with pytest.raises(SourceError) as server:
        ia_identifier("https://ia800100.us.archive.org/download/tema-item/tema.mp3")

    assert "archive.org/download/<identificador>/<fichero>" in str(shape.value)
    assert "archive.org/download/<identificador>" in str(server.value)


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


# Las mismas plataformas escritas de otra forma: punto final, ancho completo, separador ideográfico
# (U+3002) y guion blando (U+00AD). Lo que resuelve la conexión es el host de la lista.
@pytest.mark.parametrize(
    "url",
    [
        "https://youtube.com./audio/tema.mp3",
        "https://www.youtube.com./audio/tema.mp3",
        "https://soundcloud.com./track.mp3",
        "https://ｙｏｕｔｕｂｅ.com/x.mp3",
        "https://youtube。com/x.mp3",
        "https://soundcloud。com/track.mp3",
        "https://youtu­.be/x.mp3",
    ],
)
def test_blocked_platform_is_refused_whatever_the_spelling_of_the_host(url):
    with pytest.raises(SourceError, match="no se puede importar"):
        classify(url)


@pytest.mark.parametrize(
    ("url", "expected"),
    [
        ("https://Www.Example.com./a.mp3", "example.com"),
        ("https://ｙｏｕｔｕｂｅ.com/x.mp3", "youtube.com"),
        ("https://youtube。com/x.mp3", "youtube.com"),
        ("https://youtu­.be/x.mp3", "youtu.be"),
    ],
)
def test_canonical_host_is_the_host_the_connection_would_use(url, expected):
    assert canonical_host(url) == expected


def test_url_without_host_is_refused():
    with pytest.raises(SourceError, match="host"):
        classify("https:///tema.mp3")


def test_archive_with_trailing_dot_is_the_same_internet_archive_host():
    assert classify("https://archive.org./details/charleston1925") == "internet-archive"


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


@pytest.mark.parametrize(
    ("license_url", "expected"),
    [
        ("https://creativecommons.org/licenses/by/4.0/", "CC BY 4.0"),
        ("http://creativecommons.org/licenses/by-nc-sa/4.0/legalcode", "CC BY-NC-SA 4.0"),
        ("https://creativecommons.org/publicdomain/zero/1.0/", "CC0 1.0 (dominio público)"),
        ("http://creativecommons.org/publicdomain/mark/1.0/", "Dominio público (Public Domain Mark 1.0)"),
        ("http://creativecommons.org/licenses/publicdomain/", "Dominio público (Creative Commons)"),
    ],
)
def test_ia_license_is_read_from_the_creative_commons_path(license_url, expected):
    assert ia_license_name(license_url) == expected


@pytest.mark.parametrize(
    "license_url",
    [
        "https://example.com/by/4.0/",
        "https://evil.example/publicdomain/",
        "https://example.com/all-rights-reserved?ref=by-nc/4.0",
        "https://creativecommons.org.example.com/licenses/by/4.0/",
        "https://creativecommons.org/licenses/by/3.0/",
        "https://creativecommons.org/licenses/by-nc-nd/4.0/",
        "ftp://creativecommons.org/licenses/by/4.0/",
        ["https://creativecommons.org/licenses/by/4.0/"],
        None,
    ],
)
def test_license_fragment_outside_creative_commons_is_not_a_license(license_url):
    assert ia_license_name(license_url) is None


def test_internet_archive_item_without_known_license_is_refused():
    metadata = _ia_metadata(
        "https://example.com/licencia-rara",
        [{"name": "tema.mp3", "format": "VBR MP3"}],
    )

    with pytest.raises(SourceError, match="no declara una licencia reconocida"):
        resolve_internet_archive("https://archive.org/details/tema-item", metadata)


def test_internet_archive_item_with_a_fake_license_host_is_refused():
    metadata = _ia_metadata(
        "https://example.com/by/4.0/",
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


@pytest.mark.parametrize(
    "name",
    ["/tmp/escape.mp3", "../escape.mp3", "carpeta/tema.mp3", "..\\escape.mp3", "tema\n.mp3", "..", "tema.jpg"],
)
def test_internet_archive_file_name_must_be_a_plain_audio_name(name):
    metadata = _ia_metadata(
        "http://creativecommons.org/publicdomain/zero/1.0/",
        [{"name": name, "format": "VBR MP3"}],
    )

    with pytest.raises(SourceError, match="nombre que no se puede usar"):
        resolve_internet_archive("https://archive.org/details/tema-item", metadata)


def test_internet_archive_file_name_is_quoted_in_the_download_url():
    metadata = _ia_metadata(
        "http://creativecommons.org/publicdomain/zero/1.0/",
        [{"name": "tema uno (versión 2).mp3", "format": "VBR MP3"}],
    )

    resolved = resolve_internet_archive("https://archive.org/details/tema-item", metadata)

    assert resolved.file_name == "tema uno (versión 2).mp3"
    assert resolved.download_url == "https://archive.org/download/tema-item/tema%20uno%20%28versi%C3%B3n%202%29.mp3"


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


# --- Revisión de seguridad 2026-11-02 (corrector de ronda 1) -----------------------------------


@pytest.mark.parametrize(
    "url",
    [
        "https://www.deezer.com/track/1.mp3",
        "https://cdns-preview-e.dzcdn.net/stream/c-1.mp3",
        "https://tidal.com/browse/track/1.flac",
        "https://www.mixcloud.com/artista/mezcla.mp3",
        "https://www.dailymotion.com/tema.mp3",
        "https://www.twitch.tv/videos/1.mp3",
        "https://cf-media.sndcdn.com/x.mp3",
        "https://audio-ssl.itunes.apple.com/itunes-assets/x/preview.m4a",
        "https://t4.bcbits.com/stream/abc123.mp3",
        "https://p.scdn.co/mp3-preview/abc.mp3",
    ],
)
def test_streaming_hosts_and_their_cdns_are_refused_like_their_platform(url):
    with pytest.raises(SourceError, match="no se puede importar"):
        classify(url)


def test_host_with_percent_escapes_is_refused_because_the_connection_would_decode_it():
    # urllib desescapa el host al conectar: you%74ube.com llega a youtube.com.
    for url in (
        "https://you%74ube.com/x.mp3",
        "https://youtube%2ecom/x.mp3",
        "https://%79outube.com/x.mp3",
        "https://arch%69ve.org/details/tema-item",
    ):
        with pytest.raises(SourceError, match="host"):
            canonical_host(url)
        with pytest.raises(SourceError, match="host"):
            classify(url)


def test_host_whose_normalization_leaves_an_empty_label_is_refused():
    # U+2025 se normaliza a '..' y el codec IDNA no revisa las etiquetas después de NFKC.
    url = "https://youtu‥be.com/a.mp3"

    with pytest.raises(SourceError, match="host"):
        canonical_host(url)
    with pytest.raises(SourceError, match="host"):
        classify(url)


@pytest.mark.parametrize(
    "license_url",
    [
        "https://creativecommons.org/publicdomain/",
        "https://creativecommons.org/publicdomain/inventada/9.9/",
        "https://creativecommons.org/publicdomain/zero/2.0/",
        "https://creativecommons.org/publicdomain/mark/2.0/",
    ],
)
def test_public_domain_root_and_invented_paths_are_not_licenses(license_url):
    assert ia_license_name(license_url) is None


@pytest.mark.parametrize(
    "url",
    [
        "https://ia800100.us.archive.org/12/items/tema-item/tema.mp3",
        "http://ia600200.us.archive.org/5/items/tema-item/tema.flac",
    ],
)
def test_internet_archive_file_servers_are_not_direct_sources(url):
    # La licencia se lee del ítem (ADR-0005): el CDN no permite declararla a mano.
    with pytest.raises(SourceError, match="archive.org/details"):
        classify(url)
    with pytest.raises(SourceError, match="archive.org/details"):
        resolve_direct_file(url, license="CC0 1.0")


@pytest.mark.parametrize(
    "title",
    [["Tell me", "pretty maiden"], "x" * 5000, "Tema\n<b>falso</b>", "Tema extra", 42],
)
def test_internet_archive_title_that_is_not_plain_short_text_is_not_used(title):
    metadata = _ia_metadata(
        "http://creativecommons.org/publicdomain/mark/1.0/",
        [{"name": "tema.mp3", "format": "VBR MP3"}],
    )
    metadata["metadata"]["title"] = title

    resolved = resolve_internet_archive("https://archive.org/details/tema-item", metadata)

    assert resolved.title is None
    assert resolved.file_name == "tema.mp3"


@pytest.mark.parametrize(
    "url",
    [
        "http://169.254.169.254/latest/meta-data/x.mp3",
        "http://127.0.0.1:8080/x.mp3",
        "http://10.0.0.5/x.mp3",
        "http://192.168.1.10/x.mp3",
        "http://[::1]/x.mp3",
        "http://[::ffff:127.0.0.1]/x.mp3",
        "http://0.0.0.0/x.mp3",
        "http://localhost:8080/x.mp3",
    ],
)
def test_download_refuses_loopback_private_and_link_local_addresses(url):
    with pytest.raises(SourceError, match="red privada"):
        check_download_url(url)


def test_private_network_is_allowed_only_when_the_caller_says_so():
    check_download_url("http://127.0.0.1:8080/x.mp3", allow_private_network=True)


def test_public_address_literal_is_allowed():
    check_download_url("http://93.184.216.34/x.mp3")


def test_host_name_resolving_to_a_private_address_is_refused(monkeypatch):
    monkeypatch.setattr(sources.socket, "getaddrinfo", lambda *args, **kwargs: [(0, 0, 0, "", ("10.0.0.5", 0))])

    with pytest.raises(SourceError, match="red privada"):
        check_download_url("https://cdn.ejemplo.com/tema.mp3")


def test_host_name_resolving_only_to_public_addresses_is_allowed(monkeypatch):
    monkeypatch.setattr(sources.socket, "getaddrinfo", lambda *args, **kwargs: [(0, 0, 0, "", ("93.184.216.34", 0))])

    check_download_url("https://ejemplo.com/tema.mp3")


# --- Corrección de la ronda 2 (2026-11-02) -----------------------------------------------------


@pytest.mark.parametrize("url", ["https://dai.ly/clip.mp3", "https://fb.watch/clip.mp3", "https://instagr.am/clip.mp3"])
def test_short_domains_of_platforms_are_refused(url):
    with pytest.raises(SourceError, match="no se puede importar"):
        classify(url)


def test_a_host_that_only_ends_like_a_platform_is_not_blocked():
    assert classify("https://xyoutube.com/a.mp3") == "direct"
    assert classify("https://notyoutu.be/a.mp3") == "direct"


@pytest.mark.parametrize(
    "url",
    ["https://youtube.com /a.mp3", "https://youtube.com　/a.mp3", "https://ejemplo.com /a.mp3"],
)
def test_host_with_a_space_or_an_ideographic_separator_is_refused(url):
    with pytest.raises(SourceError, match="host"):
        canonical_host(url)
    with pytest.raises(SourceError, match="host"):
        classify(url)


def test_name_with_www_is_resolved_as_the_connection_resolves_it(monkeypatch):
    # La conexión resuelve 'www.pub-entry.example' tal cual; la comprobación tiene que mirar ese mismo nombre.
    answers = {"pub-entry.example": "93.184.216.34", "www.pub-entry.example": "127.0.0.1"}
    monkeypatch.setattr(sources.socket, "getaddrinfo", lambda host, *args, **kwargs: [(2, 1, 6, "", (answers[host], 0))])

    check_download_url("https://pub-entry.example/final.mp3")
    with pytest.raises(SourceError, match="red privada"):
        check_download_url("https://www.pub-entry.example/final.mp3")


@pytest.mark.parametrize(
    "url",
    [
        "http://[::127.0.0.1]/x.mp3",
        "http://[::7f00:1]/x.mp3",
        "http://[::ffff:0:7f00:1]/x.mp3",
        "http://[64:ff9b::7f00:1]/x.mp3",
        "http://[64:ff9b:1::1]/x.mp3",
        "http://[2002:7f00:1::1]/x.mp3",
        "http://[::ffff:10.0.0.5]/x.mp3",
    ],
)
def test_ipv6_forms_that_embed_a_private_ipv4_address_are_refused(url):
    with pytest.raises(SourceError, match="red privada"):
        check_download_url(url)


def test_ipv6_form_that_embeds_a_public_ipv4_address_is_allowed():
    check_download_url("http://[64:ff9b::5db8:d822]/x.mp3")


def test_archive_org_apex_is_not_a_direct_file_either():
    with pytest.raises(SourceError, match="archive.org/details"):
        resolve_direct_file("https://archive.org/download/x/y.mp3", license="CC0")


@pytest.mark.parametrize("title", ["Hola‮mundo", "Hola​mundo", "Hola﻿mundo"])
def test_internet_archive_title_with_format_characters_is_not_used(title):
    metadata = _ia_metadata(
        "http://creativecommons.org/publicdomain/mark/1.0/",
        [{"name": "tema.mp3", "format": "VBR MP3"}],
    )
    metadata["metadata"]["title"] = title

    assert resolve_internet_archive("https://archive.org/details/tema-item", metadata).title is None


@pytest.mark.parametrize(
    "license_url",
    [
        "https://creativecommons.org/licenses/by/4.0/xyz-inventada",
        "https://creativecommons.org/licenses/by/4.0/../by-nd/4.0/",
        "https://creativecommons.org/licenses/by/4.0/./",
        "https://creativecommons.org/licenses/by/4.0/legalcode/extra",
        "https://evil.example\\@creativecommons.org/licenses/by/4.0/",
        "https://user@creativecommons.org/licenses/by/4.0/",
    ],
)
def test_ia_license_with_invented_relative_or_backslash_parts_is_not_a_license(license_url):
    assert ia_license_name(license_url) is None


@pytest.mark.parametrize(
    ("license_url", "expected"),
    [
        ("https://creativecommons.org/licenses/by/4.0/legalcode", "CC BY 4.0"),
        ("https://creativecommons.org/licenses/by/4.0/deed.es", "CC BY 4.0"),
        ("https://creativecommons.org/publicdomain/zero/1.0/legalcode", "CC0 1.0 (dominio público)"),
    ],
)
def test_ia_license_accepts_the_usual_suffixes_of_creative_commons_urls(license_url, expected):
    assert ia_license_name(license_url) == expected


# --- Formas de descarga de Internet Archive (ADR-0008): la licencia y el audio salen del ítem ---------


@pytest.mark.parametrize(
    "url",
    [
        "https://archive.org/details/tema-item",
        "https://archive.org/download/tema-item",
        "https://archive.org/download/tema-item/",
        "https://archive.org/download/tema-item/otro-nombre.wav",
    ],
)
def test_every_item_form_resolves_to_the_same_item_license_and_file(url):
    metadata = _ia_metadata(
        "https://creativecommons.org/licenses/by-sa/4.0/",
        [{"name": "tema.mp3", "format": "VBR MP3"}, {"name": "tema.flac", "format": "Flac"}],
    )

    resolved = resolve_internet_archive(url, metadata)

    assert resolved.identifier == "tema-item"
    assert resolved.license == "CC BY-SA 4.0 (Internet Archive: tema-item)"
    assert resolved.file_name == "tema.flac"
    assert resolved.download_url == "https://archive.org/download/tema-item/tema.flac"


def test_file_name_in_a_download_url_cannot_declare_the_license():
    metadata = _ia_metadata(
        "https://example.com/licencia-rara",
        [{"name": "tema.mp3", "format": "VBR MP3"}],
    )

    with pytest.raises(SourceError, match="no declara una licencia reconocida"):
        resolve_internet_archive("https://archive.org/download/tema-item/CC0-1.0.mp3", metadata)


def test_resolve_url_asks_for_the_metadata_of_the_item_not_of_the_file(monkeypatch):
    asked = []

    def fake_fetch(url):
        asked.append(url)
        return _ia_metadata(
            "https://creativecommons.org/publicdomain/zero/1.0/",
            [{"name": "tema.flac", "format": "Flac"}],
        )

    monkeypatch.setattr(intake, "fetch_json", fake_fetch)

    resolved = intake.resolve_url("https://archive.org/download/tema-item/otro-nombre.wav")

    assert asked == ["https://archive.org/metadata/tema-item"]
    assert resolved.download_url == "https://archive.org/download/tema-item/tema.flac"


# --- Artista y año desde los metadatos de Internet Archive (2026-11-03) ------------------------


def _ia_with(**fields):
    metadata = _ia_metadata(
        "http://creativecommons.org/publicdomain/mark/1.0/", [{"name": "tema.mp3", "format": "VBR MP3"}]
    )
    metadata["metadata"].update(fields)
    return resolve_internet_archive("https://archive.org/details/tema-item", metadata)


def test_internet_archive_creator_and_date_give_artist_and_year():
    resolved = _ia_with(creator="Golden Gate Orchestra", date="1925-00-00 00:00:00")

    assert resolved.artist == "Golden Gate Orchestra"
    assert resolved.year == 1925


def test_internet_archive_creator_list_is_joined_without_empty_or_repeated_names():
    resolved = _ia_with(creator=["Harry Macdonough", " ", "Grace Spencer", 7, "Harry Macdonough"])

    assert resolved.artist == "Harry Macdonough, Grace Spencer"


def test_internet_archive_without_creator_or_date_keeps_artist_empty_and_year_null():
    resolved = _ia_with()

    assert resolved.artist == ""
    assert resolved.year is None


@pytest.mark.parametrize("creator", [None, "", "   ", 42, {"name": "x"}, ["", None], "Hola\nmundo", "Hola‮mundo"])
def test_internet_archive_creator_that_is_not_plain_text_is_discarded(creator):
    assert _ia_with(creator=creator).artist == ""


def test_internet_archive_creator_list_drops_only_the_unsafe_names():
    assert _ia_with(creator=["Ana​Pérez", "Luis Gil"]).artist == "Luis Gil"


def test_internet_archive_long_creator_is_cut_to_the_catalog_limit():
    from sonidos.catalog import SONG_ARTIST_MAX_CHARS

    resolved = _ia_with(creator=["a" * 150, "b" * 150])

    assert len(resolved.artist) == SONG_ARTIST_MAX_CHARS
    assert resolved.artist.startswith("a" * 150 + ", b")


def test_internet_archive_long_creator_does_not_end_in_a_separator():
    resolved = _ia_with(creator=["a" * 199, "b"])

    assert resolved.artist == "a" * 199


@pytest.mark.parametrize(
    ("fields", "expected"),
    [
        ({"date": "1927-01-01", "year": "1930"}, 1927),
        ({"date": "1920s", "year": "1927"}, 1927),
        ({"year": "1902"}, 1902),
        ({"year": 1919}, 1919),
        ({"date": ["c. 1900", "1907-00-00"]}, 1907),
        ({"date": "1925/06"}, 1925),
        ({"date": "c. 1925"}, None),
        ({"date": "0000-00-00"}, None),
        ({"date": "0999"}, None),
        ({"date": "2101"}, None),
        ({"date": "19250"}, None),
        ({"date": "25-01-1925"}, None),
        ({"year": True}, None),
        ({"year": 19.25}, None),
        ({"date": "1925\n"}, 1925),
    ],
)
def test_internet_archive_year_only_takes_a_valid_four_digit_year(fields, expected):
    assert _ia_with(**fields).year == expected


def test_direct_file_has_no_artist_or_year():
    resolved = resolve_direct_file("https://ejemplo.com/tema.mp3", "CC0")

    assert resolved.artist == "" and resolved.year is None
