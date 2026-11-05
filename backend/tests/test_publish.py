import json
import shutil

import pytest

from sonidos import catalog
from sonidos.publish import sync_public


def _catalog_with(tmp_path, public_flags):
    audio = tmp_path / "audio"
    audio.mkdir()
    data = catalog.empty()
    folder = catalog.create_folder(data, "Jazz")
    for index, public in enumerate(public_flags):
        sha = f"{index:x}" * 64
        song, _ = catalog.add_song(data, sha256=sha[:64], title=f"Tema {index}", license="CC0",
                                   source="s", codec="opus", duration_s=5.0, size_bytes=10)
        (audio / f"{song['id']}.opus").write_bytes(b"opus" + bytes([index]))
        catalog.update_song(data, song["id"], {"public": public, "folder_id": folder["id"], "tags": ["Jazz"]})
    path = tmp_path / "catalog.json"
    catalog.save(path, data)
    return path, audio


def test_only_public_songs_are_listed_and_no_audio_is_copied_to_the_web(tmp_path):
    path, audio = _catalog_with(tmp_path, [True, False])
    web = tmp_path / "web"

    result = sync_public(catalog_path=path, audio_dir=audio, web_dir=web)

    assert result["public"] == 1
    # El audio público lo sirve R2 (ADR-0020, fase 3): la web solo lleva los datos.
    assert not (web / "audio").exists()
    listed = json.loads((web / "data" / "songs.json").read_text(encoding="utf-8"))
    assert len(listed) == 1 and listed[0]["audio"].startswith("audio/") and listed[0]["tags"] == ["jazz"]
    folders = json.loads((web / "data" / "folders.json").read_text(encoding="utf-8"))
    assert folders[0]["name"] == "Jazz"


def test_unpublishing_removes_the_public_audio(tmp_path):
    path, audio = _catalog_with(tmp_path, [True])
    web = tmp_path / "web"
    sync_public(catalog_path=path, audio_dir=audio, web_dir=web)

    data = catalog.load(path)
    catalog.update_song(data, data["songs"][0]["id"], {"public": False})
    catalog.save(path, data)
    sync_public(catalog_path=path, audio_dir=audio, web_dir=web)

    assert list((web / "audio").glob("*.opus")) == []
    assert json.loads((web / "data" / "songs.json").read_text(encoding="utf-8")) == []


def test_catalog_json_lists_only_public_songs_and_every_folder_without_audio_paths_or_hashes(tmp_path):
    path, audio = _catalog_with(tmp_path, [True, False])
    web = tmp_path / "web"

    result = sync_public(catalog_path=path, audio_dir=audio, web_dir=web)

    view = json.loads((web / "data" / "catalog.json").read_text(encoding="utf-8"))
    assert result["catalog_songs"] == 1
    assert [song["title"] for song in view["songs"]] == ["Tema 0"]
    assert all(song["public"] is True for song in view["songs"])
    for song in view["songs"]:
        # La canción está en el álbum «Jazz»: lleva su número de pista (ADR-0026).
        assert set(song) == {
            "id", "title", "artist", "year", "tags", "folder_id", "license", "source", "duration_s", "public", "track",
        }
        assert song["track"] == 1
    assert [folder["name"] for folder in view["folders"]] == ["Jazz"]
    assert view["folders"] == json.loads((web / "data" / "folders.json").read_text(encoding="utf-8"))
    text = (web / "data" / "catalog.json").read_text(encoding="utf-8")
    assert "sha256" not in text and "audio/" not in text
    assert "Tema 1" not in text


def test_unpublished_song_metadata_never_reaches_the_web(tmp_path):
    path, audio = _catalog_with(tmp_path, [False, False])
    web = tmp_path / "web"

    sync_public(catalog_path=path, audio_dir=audio, web_dir=web)

    view = json.loads((web / "data" / "catalog.json").read_text(encoding="utf-8"))
    assert view["songs"] == []
    assert "Tema" not in (web / "data" / "catalog.json").read_text(encoding="utf-8")


def test_public_flag_must_be_a_json_boolean(tmp_path):
    path, audio = _catalog_with(tmp_path, [True])
    data = catalog.load(path)
    data["songs"][0]["public"] = "false"  # texto, no booleano: no se publica
    catalog.save(path, data)
    web = tmp_path / "web"

    result = sync_public(catalog_path=path, audio_dir=audio, web_dir=web)

    assert result["public"] == 0
    assert list((web / "audio").glob("*.opus")) == []


def test_audio_left_in_the_web_from_before_r2_is_removed(tmp_path):
    path, audio = _catalog_with(tmp_path, [True])
    web = tmp_path / "web"
    song_id = catalog.load(path)["songs"][0]["id"]
    (web / "audio").mkdir(parents=True)
    (web / "audio" / f"{song_id}.opus").write_bytes((audio / f"{song_id}.opus").read_bytes())

    sync_public(catalog_path=path, audio_dir=audio, web_dir=web)

    assert list((web / "audio").glob("*.opus")) == []


def test_a_public_song_without_its_audio_in_the_library_is_refused(tmp_path):
    path, audio = _catalog_with(tmp_path, [True])
    song_id = catalog.load(path)["songs"][0]["id"]
    (audio / f"{song_id}.opus").unlink()

    with pytest.raises(FileNotFoundError):
        sync_public(catalog_path=path, audio_dir=audio, web_dir=tmp_path / "web")


def test_public_song_id_that_is_not_a_library_id_is_refused(tmp_path):
    path, audio = _catalog_with(tmp_path, [True])
    data = catalog.load(path)
    data["songs"][0]["id"] = "../../escape"  # el id da nombre al fichero: no puede salir de la carpeta de audio
    catalog.save(path, data)

    with pytest.raises(ValueError, match="identificador"):
        sync_public(catalog_path=path, audio_dir=audio, web_dir=tmp_path / "web")
