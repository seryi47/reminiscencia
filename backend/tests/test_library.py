import pytest

from sonidos.importer import import_local_file
from sonidos.library import LicenseRequiredError, Library


@pytest.fixture
def library(tmp_path):
    lib = Library(tmp_path / "indexes" / "library.sqlite")
    yield lib
    lib.close()


def test_import_creates_song_with_stable_id(library, tone_wav):
    report = import_local_file(library, tone_wav, license="propia del archivo familiar")

    assert report.result.created is True
    assert report.result.song_id.startswith("S")
    song = library.get_song(report.result.song_id)
    assert song["title"] == "tono"
    assert song["codec"] == "pcm_s16le"
    assert song["license"] == "propia del archivo familiar"


def test_importing_same_content_twice_does_not_duplicate(library, tone_wav, tmp_path):
    first = import_local_file(library, tone_wav, license="propia")
    copy = tmp_path / "copia" / "otro_nombre.wav"
    copy.parent.mkdir()
    copy.write_bytes(tone_wav.read_bytes())

    second = import_local_file(library, copy, license="propia")

    assert second.result.created is False
    assert second.result.song_id == first.result.song_id
    assert len(library.list_songs()) == 1


def test_import_without_license_is_refused(library, tone_wav):
    with pytest.raises(LicenseRequiredError):
        import_local_file(library, tone_wav, license="   ")

    assert library.list_songs() == []


def test_import_generates_opus_variant(library, tone_wav, tmp_path):
    audio_dir = tmp_path / "audio"
    report = import_local_file(
        library,
        tone_wav,
        license="propia",
        variant_profiles=("opus-64k",),
        audio_dir=audio_dir,
    )

    assert len(report.variants) == 1
    variant = report.variants[0]
    assert variant.exists()
    assert variant.suffix == ".opus"

    stored = library.variants_for(report.result.song_id)
    assert [row["profile"] for row in stored] == ["opus-64k"]
    assert stored[0]["size_bytes"] < tone_wav.stat().st_size


def test_stats_counts_songs_and_bytes(library, tone_wav):
    import_local_file(library, tone_wav, license="propia")

    stats = library.stats()

    assert stats["songs"] == 1
    assert stats["original_bytes"] == tone_wav.stat().st_size
    assert stats["variant_bytes"] == 0


def test_export_index_has_no_local_paths(library, tone_wav, tmp_path):
    import_local_file(library, tone_wav, license="propia")
    destination = tmp_path / "index" / "songs.json"

    library.export_index(destination)

    content = destination.read_text(encoding="utf-8")
    assert str(tone_wav.parent) not in content
    assert '"sha256"' in content
