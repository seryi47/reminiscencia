import json

from sonidos.importer import import_local_file
from sonidos.library import Library
from sonidos.web_build import build_web


def test_build_web_copies_playback_audio_and_writes_index(tone_wav, tmp_path):
    library = Library(tmp_path / "library.sqlite")
    import_local_file(
        library,
        tone_wav,
        license="propia",
        title="Tono de prueba",
        variant_profiles=("opus-64k",),
        audio_dir=tmp_path / "audio",
    )
    web_dir = tmp_path / "web"

    entries = build_web(library, web_dir)
    library.close()

    assert len(entries) == 1
    audio_file = web_dir / entries[0]["audio"]
    assert audio_file.exists()
    assert audio_file.suffix == ".opus"

    index = json.loads((web_dir / "data" / "songs.json").read_text(encoding="utf-8"))
    assert index[0]["title"] == "Tono de prueba"
    assert index[0]["audio"].startswith("audio/")


def test_web_index_has_no_local_paths(tone_wav, tmp_path):
    library = Library(tmp_path / "library.sqlite")
    import_local_file(
        library,
        tone_wav,
        license="propia",
        variant_profiles=("opus-64k",),
        audio_dir=tmp_path / "audio",
    )
    web_dir = tmp_path / "web"

    build_web(library, web_dir)
    library.close()

    content = (web_dir / "data" / "songs.json").read_text(encoding="utf-8")
    assert str(tmp_path) not in content


def test_song_without_playback_variant_is_skipped(tone_wav, tmp_path):
    library = Library(tmp_path / "library.sqlite")
    import_local_file(library, tone_wav, license="propia")
    web_dir = tmp_path / "web"

    entries = build_web(library, web_dir)
    library.close()

    assert entries == []
