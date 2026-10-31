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
