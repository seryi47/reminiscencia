import json
import shutil

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


def test_only_public_songs_are_copied_and_listed(tmp_path):
    path, audio = _catalog_with(tmp_path, [True, False])
    web = tmp_path / "web"

    result = sync_public(catalog_path=path, audio_dir=audio, web_dir=web)

    assert result["public"] == 1
    assert len(list((web / "audio").glob("*.opus"))) == 1
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
