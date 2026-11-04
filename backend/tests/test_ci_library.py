import hashlib
import importlib.util
import json
from pathlib import Path

import pytest

from sonidos import catalog

ROOT = Path(__file__).resolve().parents[2]
PETICION_VARS = ("ACTION", "URL", "LICENSE", "TITLE", "PAYLOAD")


@pytest.fixture
def ci(tmp_path, monkeypatch):
    """Carga scripts/ci_library.py apuntando todas sus rutas a un directorio temporal."""
    spec = importlib.util.spec_from_file_location("ci_library_under_test", ROOT / "scripts" / "ci_library.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    base = tmp_path / "repo"
    monkeypatch.setattr(module, "CATALOG", base / "audio-library" / "indexes" / "catalog.json")
    monkeypatch.setattr(module, "AUDIO", base / "audio-library" / "audio")
    monkeypatch.setattr(module, "COVERS", base / "audio-library" / "covers")
    monkeypatch.setattr(module, "STAGING", base / "audio-library" / "staging")
    monkeypatch.setattr(module, "WEB", base / "frontend" / "web")
    return module


def _seed_private_song(module) -> str:
    data = catalog.empty()
    song, _ = catalog.add_song(
        data, sha256="ab" * 32, title="Tema privado", license="CC0 1.0", source="direct-url:ejemplo.com/t.mp3",
        codec="opus", duration_s=5.0, size_bytes=10,
    )
    catalog.save(module.CATALOG, data)
    module.AUDIO.mkdir(parents=True, exist_ok=True)
    (module.AUDIO / f"{song['id']}.opus").write_bytes(b"opus-bytes")
    return song["id"]


def _organize(module, payload: dict) -> dict:
    return module.run({"ACTION": "organize", "PAYLOAD": json.dumps(payload)})


def test_organize_edit_song_public_publishes_audio_and_both_web_files(ci):
    song_id = _seed_private_song(ci)

    result = _organize(ci, {"op": "edit_song", "song_id": song_id, "public": True, "tags": ["Jazz"]})

    assert result["song"]["public"] is True
    assert result["web"]["public"] == 1
    assert (ci.WEB / "audio" / f"{song_id}.opus").read_bytes() == b"opus-bytes"
    songs = json.loads((ci.WEB / "data" / "songs.json").read_text(encoding="utf-8"))
    assert [song["id"] for song in songs] == [song_id]
    view = json.loads((ci.WEB / "data" / "catalog.json").read_text(encoding="utf-8"))
    assert view["songs"][0]["public"] is True and view["songs"][0]["tags"] == ["jazz"]
    assert "sha256" not in view["songs"][0] and "audio" not in view["songs"][0]
    assert catalog.load(ci.CATALOG)["songs"][0]["public"] is True


def test_organize_edit_song_unpublish_removes_the_public_audio(ci):
    song_id = _seed_private_song(ci)
    _organize(ci, {"op": "edit_song", "song_id": song_id, "public": True})

    result = _organize(ci, {"op": "edit_song", "song_id": song_id, "public": False})

    assert result["song"]["public"] is False
    assert list((ci.WEB / "audio").glob("*.opus")) == []
    assert json.loads((ci.WEB / "data" / "songs.json").read_text(encoding="utf-8")) == []


def test_organize_folder_operations_update_the_catalog(ci):
    created = _organize(ci, {"op": "create_folder", "name": "Jazz"})
    folder_id = created["folder"]["id"]

    renamed = _organize(ci, {"op": "rename_folder", "folder_id": folder_id, "name": "Blues"})
    deleted = _organize(ci, {"op": "delete_folder", "folder_id": folder_id})

    assert renamed["folder"]["name"] == "Blues"
    assert deleted["deleted"] == folder_id
    assert catalog.load(ci.CATALOG)["folders"] == []


def test_organize_on_missing_song_fails_and_leaves_catalog_unchanged(ci):
    with pytest.raises(catalog.CatalogError, match="no existe la canción"):
        _organize(ci, {"op": "edit_song", "song_id": "S0123456789abcdef", "public": True})
    assert not ci.CATALOG.exists()


def test_import_action_passes_the_validated_request_to_the_pipeline(ci, monkeypatch):
    calls = {}

    def fake_import(**kwargs):
        calls.update(kwargs)
        return {"song_id": "S0123456789abcdef", "created": True, "source": "direct-url", "license": "CC0"}

    monkeypatch.setattr(ci, "import_url", fake_import)

    result = ci.run({"ACTION": "import", "URL": "https://ejemplo.com/tema.mp3", "LICENSE": "CC0", "TITLE": "", "PAYLOAD": ""})

    assert calls["url"] == "https://ejemplo.com/tema.mp3"
    assert calls["license"] == "CC0" and calls["title"] is None
    assert result["created"] is True and "web" in result


def test_publish_action_no_longer_exists(ci, monkeypatch, capsys):
    for name in PETICION_VARS:
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("ACTION", "publish")
    monkeypatch.setenv("SONG_ID", "S0123456789abcdef")
    monkeypatch.setenv("PUBLIC", "true")

    assert ci.main() == 1
    assert "acción desconocida" in json.loads(capsys.readouterr().out)["error"]


def test_main_prints_json_error_and_exits_1_for_a_bad_payload(ci, monkeypatch, capsys):
    for name in PETICION_VARS:
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("ACTION", "organize")
    monkeypatch.setenv("PAYLOAD", '{"op":"edit_song","song_id":"S0123456789abcdef"}')

    assert ci.main() == 1
    assert json.loads(capsys.readouterr().out)["error"].startswith("edit_song necesita")


def test_main_prints_the_result_as_json_and_exits_0(ci, monkeypatch, capsys):
    for name in PETICION_VARS:
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("ACTION", "organize")
    monkeypatch.setenv("PAYLOAD", json.dumps({"op": "create_folder", "name": "Jazz"}))

    assert ci.main() == 0
    output = json.loads(capsys.readouterr().out)
    assert output["folder"]["name"] == "Jazz" and output["web"]["folders"] == 1


def test_organize_album_with_artist_reaches_folders_json(ci):
    created = _organize(ci, {"op": "create_folder", "name": "Boleros", "artist": "Antonio Machín"})
    folder_id = created["folder"]["id"]
    assert folder_id.startswith("F") and len(folder_id) == 17

    edited = _organize(ci, {"op": "edit_folder", "folder_id": folder_id, "name": "Boleros de siempre"})
    assert edited["folder"] == {"id": folder_id, "name": "Boleros de siempre", "parent_id": None, "artist": "Antonio Machín"}
    folders = json.loads((ci.WEB / "data" / "folders.json").read_text(encoding="utf-8"))
    assert folders == [edited["folder"]]

    cleared = _organize(ci, {"op": "edit_folder", "folder_id": folder_id, "name": "Boleros", "artist": ""})
    assert "artist" not in cleared["folder"]
    assert "artist" not in json.loads((ci.WEB / "data" / "folders.json").read_text(encoding="utf-8"))[0]


def test_organize_edit_song_changes_title_and_artist(ci):
    song_id = _seed_private_song(ci)

    result = _organize(ci, {"op": "edit_song", "song_id": song_id, "title": "Ojos verdes", "artist": "Concha Piquer"})

    song = catalog.load(ci.CATALOG)["songs"][0]
    assert result["song"]["title"] == song["title"] == "Ojos verdes"
    assert song["artist"] == "Concha Piquer"


def test_organize_youtube_playlist_assigns_artist_and_stable_album(ci):
    song_id = _seed_private_song(ci)
    _organize(ci, {"op": "edit_song", "song_id": song_id, "public": True})
    payload = {
        "op": "organize_youtube_playlist",
        "playlist_id": "PLVU-jIOit29A",
        "name": "Nuestro desacato",
        "songs": [{"song_id": song_id, "artist": "Desakato"}],
    }

    result = _organize(ci, payload)

    expected_id = f"F{hashlib.sha256(b'youtube:PLVU-jIOit29A').hexdigest()[:16]}"
    saved = catalog.load(ci.CATALOG)
    assert result["folder"]["id"] == expected_id
    assert result["folder"]["youtube_playlist_id"] == "PLVU-jIOit29A"
    assert result["songs"][0]["artist"] == "Desakato"
    assert result["songs"][0]["folder_id"] == expected_id
    public_folder = json.loads((ci.WEB / "data" / "folders.json").read_text(encoding="utf-8"))[0]
    assert public_folder["name"] == "Nuestro desacato"
    assert "youtube_playlist_id" not in public_folder

    repeated = _organize(ci, {**payload, "name": "Nombre actualizado"})
    assert repeated["folder"]["id"] == expected_id
    assert repeated["folder"]["name"] == "Nombre actualizado"
    assert len(saved["folders"]) == 1


def test_organize_youtube_playlist_missing_song_does_not_create_album(ci):
    _seed_private_song(ci)
    before = catalog.load(ci.CATALOG)

    with pytest.raises(catalog.CatalogError, match="no existe la canción"):
        _organize(ci, {
            "op": "organize_youtube_playlist",
            "playlist_id": "PLVU-jIOit29A",
            "name": "Nuestro desacato",
            "songs": [{"song_id": "S0123456789abcdef", "artist": "Desakato"}],
        })

    assert catalog.load(ci.CATALOG) == before


def test_organize_edit_folder_on_a_missing_folder_fails(ci):
    with pytest.raises(catalog.CatalogError, match="no existe la carpeta"):
        _organize(ci, {"op": "edit_folder", "folder_id": "F0123456789abcdef", "name": "x"})


def test_deleting_an_album_removes_its_cover_and_its_public_copy(ci):
    folder_id = _organize(ci, {"op": "create_folder", "name": "Tangos"})["folder"]["id"]
    data = catalog.load(ci.CATALOG)
    catalog.set_cover(data, folder_id, f"covers/{folder_id}.jpg")
    catalog.save(ci.CATALOG, data)
    ci.COVERS.mkdir(parents=True)
    (ci.COVERS / f"{folder_id}.jpg").write_bytes(b"jpeg")
    _organize(ci, {"op": "edit_folder", "folder_id": folder_id, "name": "Tangos", "artist": "Carlos Gardel"})
    assert (ci.WEB / "covers" / f"{folder_id}.jpg").read_bytes() == b"jpeg"
    [carpeta] = json.loads((ci.WEB / "data" / "folders.json").read_text(encoding="utf-8"))
    assert carpeta["cover"] == f"covers/{folder_id}.jpg" and carpeta["artist"] == "Carlos Gardel"

    _organize(ci, {"op": "delete_folder", "folder_id": folder_id})

    assert not (ci.COVERS / f"{folder_id}.jpg").exists()
    assert not (ci.WEB / "covers" / f"{folder_id}.jpg").exists()
