import json
import shutil
import subprocess
from pathlib import Path

import pytest

from sonidos import catalog
from sonidos.publish import sync_public


def _write_valid_cover_jpeg(path: Path, color: str = "0x5078c8") -> None:
    """Crea un JPEG 640×640 válido con ffmpeg: la ruta de los tests que ejercen portadas no pasa por libjpeg (PIL
    no está en el entorno). Se salta la prueba si ffmpeg no está disponible: la generación es una dependencia
    externa, igual que en portadas.py."""
    result = subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", f"color=c={color}:s=640x640:d=1",
         "-frames:v", "1", "-f", "mjpeg", str(path)],
        capture_output=True,
    )
    if result.returncode != 0:
        pytest.skip(f"ffmpeg no disponible en el entorno de pruebas: {result.stderr.decode('utf-8', errors='replace')[:200]}")


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


def test_a_public_song_without_local_audio_is_still_published(tmp_path):
    # ADR-0024: el audio está en el bucket privado de R2, no en la copia local. Que una canción pública tenga audio lo
    # comprueba scripts/sync_r2.py en 'publicar', antes de subir a main (pruebas en test_r2.py).
    path, audio = _catalog_with(tmp_path, [True])
    song_id = catalog.load(path)["songs"][0]["id"]
    (audio / f"{song_id}.opus").unlink()

    result = sync_public(catalog_path=path, audio_dir=audio, web_dir=tmp_path / "web")

    assert result["public"] == 1


def test_public_song_id_that_is_not_a_library_id_is_refused(tmp_path):
    path, audio = _catalog_with(tmp_path, [True])
    data = catalog.load(path)
    data["songs"][0]["id"] = "../../escape"  # el id da nombre al fichero: no puede salir de la carpeta de audio
    catalog.save(path, data)

    with pytest.raises(ValueError, match="identificador"):
        sync_public(catalog_path=path, audio_dir=audio, web_dir=tmp_path / "web")


def test_thumbnail_is_published_and_linked_when_cover_exists(tmp_path):
    """ADR-0050: una canción con portada lleva el campo "thumb" y la miniatura va a frontend/web/thumbs."""
    path, audio = _catalog_with(tmp_path, [True])
    data = catalog.load(path)
    song_id = data["songs"][0]["id"]
    data["songs"][0]["cover"] = f"covers/{song_id}.jpg"
    catalog.save(path, data)
    covers_dir = tmp_path / "covers"
    covers_dir.mkdir()
    _write_valid_cover_jpeg(covers_dir / f"{song_id}.jpg")

    web = tmp_path / "web"
    result = sync_public(catalog_path=path, audio_dir=audio, web_dir=web, covers_dir=covers_dir, thumbs_dir=tmp_path / "thumbs")

    assert result["covers"] == 1 and result["thumbs"] == 1
    songs = json.loads((web / "data" / "songs.json").read_text(encoding="utf-8"))
    assert songs[0]["cover"] == f"covers/{song_id}.jpg"
    assert songs[0]["thumb"] == f"thumbs/{song_id}.jpg"
    assert (web / "thumbs" / f"{song_id}.jpg").is_file()
    # La miniatura se auto-cachea en audio-library/thumbs al publicar, aunque no viniera de buzón.
    assert (tmp_path / "thumbs" / f"{song_id}.jpg").is_file()


def test_thumbnail_is_not_added_when_source_cover_is_invalid(tmp_path):
    """Si la miniatura no se puede generar (bytes raros en el cover), la canción queda publicada sin "thumb"."""
    path, audio = _catalog_with(tmp_path, [True])
    data = catalog.load(path)
    song_id = data["songs"][0]["id"]
    data["songs"][0]["cover"] = f"covers/{song_id}.jpg"
    catalog.save(path, data)
    covers_dir = tmp_path / "covers"
    covers_dir.mkdir()
    (covers_dir / f"{song_id}.jpg").write_bytes(b"not-a-real-jpeg")  # convertir_thumbnail fallará

    web = tmp_path / "web"
    result = sync_public(catalog_path=path, audio_dir=audio, web_dir=web, covers_dir=covers_dir, thumbs_dir=tmp_path / "thumbs")

    assert result["covers"] == 1 and result["thumbs"] == 0
    songs = json.loads((web / "data" / "songs.json").read_text(encoding="utf-8"))
    assert songs[0]["cover"] == f"covers/{song_id}.jpg"
    assert "thumb" not in songs[0]
    assert not (web / "thumbs").exists() or not any((web / "thumbs").iterdir())


def test_stale_thumbnail_is_removed_from_the_web(tmp_path):
    """Al despublicar la canción, la miniatura publicada se borra junto con la portada."""
    path, audio = _catalog_with(tmp_path, [True])
    data = catalog.load(path)
    song_id = data["songs"][0]["id"]
    data["songs"][0]["cover"] = f"covers/{song_id}.jpg"
    catalog.save(path, data)
    covers_dir = tmp_path / "covers"
    covers_dir.mkdir()
    _write_valid_cover_jpeg(covers_dir / f"{song_id}.jpg", color="0xc85078")

    web = tmp_path / "web"
    sync_public(catalog_path=path, audio_dir=audio, web_dir=web, covers_dir=covers_dir, thumbs_dir=tmp_path / "thumbs")
    assert (web / "thumbs" / f"{song_id}.jpg").is_file()

    data = catalog.load(path)
    data["songs"][0]["public"] = False
    catalog.save(path, data)
    sync_public(catalog_path=path, audio_dir=audio, web_dir=web, covers_dir=covers_dir, thumbs_dir=tmp_path / "thumbs")

    assert not (web / "thumbs" / f"{song_id}.jpg").exists()
