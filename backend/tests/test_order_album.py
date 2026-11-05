"""Números de pista y order_album (ADR-0026): contrato de la petición, aplicación atómica, renumeración al entrar y
salir de un álbum, migración del catálogo anterior y parte pública."""

import importlib.util
import json
from pathlib import Path

import pytest

from sonidos import catalog
from sonidos.issue_request import RequestError, parse_request, request_from_env, summarize, validate_payload

ROOT = Path(__file__).resolve().parents[2]
SONG = "S0123456789abcdef"
SONG_B = "Sfedcba9876543210"
OLD_FOLDER = "0123456789"
NEW_FOLDER = "F0123456789abcdef"


def organize_body(payload: dict) -> str:
    return "action: organize\npayload: " + json.dumps(payload)


@pytest.fixture
def ci(tmp_path, monkeypatch):
    """scripts/ci_library.py con todas sus rutas en un directorio temporal (como en test_ci_library.py)."""
    spec = importlib.util.spec_from_file_location("ci_library_order_test", ROOT / "scripts" / "ci_library.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    base = tmp_path / "repo"
    monkeypatch.setattr(module, "CATALOG", base / "audio-library" / "indexes" / "catalog.json")
    monkeypatch.setattr(module, "AUDIO", base / "audio-library" / "audio")
    monkeypatch.setattr(module, "COVERS", base / "audio-library" / "covers")
    monkeypatch.setattr(module, "STAGING", base / "audio-library" / "staging")
    monkeypatch.setattr(module, "WEB", base / "frontend" / "web")
    return module


def _organize(module, payload: dict) -> dict:
    return module.run({"ACTION": "organize", "PAYLOAD": json.dumps(payload)})


def _seed(module, count: int, *, titles: list[str] | None = None) -> tuple[list[str], str]:
    data = catalog.empty()
    folder = catalog.create_folder(data, "Álbum de prueba")
    ids = []
    for index in range(count):
        song, _ = catalog.add_song(
            data, sha256=f"{index + 16:02x}" * 32, title=(titles or [])[index] if titles else f"Tema {index}",
            license="CC0 1.0", source="direct-url:ejemplo.com/t.mp3", codec="opus", duration_s=5.0, size_bytes=10,
        )
        ids.append(song["id"])
    catalog.save(module.CATALOG, data)
    module.AUDIO.mkdir(parents=True, exist_ok=True)
    for song_id in ids:
        (module.AUDIO / f"{song_id}.opus").write_bytes(b"opus-bytes")
    return ids, folder["id"]


def _tracks(module, folder_id: str) -> list[tuple[str, int | None]]:
    data = catalog.load(module.CATALOG)
    return [(song["id"], song.get("track")) for song in catalog.songs_in_folder(data, folder_id)]


# --- Contrato de la petición -----------------------------------------------------------------------------------------


def test_order_album_accepts_the_new_order_and_keeps_it():
    request = parse_request(organize_body({"op": "order_album", "folder_id": NEW_FOLDER, "song_ids": [SONG_B, SONG]}))
    assert request["payload"] == {"op": "order_album", "folder_id": NEW_FOLDER, "song_ids": [SONG_B, SONG]}
    old = parse_request(organize_body({"op": "order_album", "folder_id": OLD_FOLDER, "song_ids": [SONG]}))
    assert old["payload"]["folder_id"] == OLD_FOLDER


@pytest.mark.parametrize("payload, message", [
    ({"op": "order_album", "folder_id": NEW_FOLDER, "song_ids": []}, "entre 1 y 190"),
    ({"op": "order_album", "folder_id": NEW_FOLDER, "song_ids": SONG}, "entre 1 y 190"),
    ({"op": "order_album", "folder_id": NEW_FOLDER, "song_ids": None}, "entre 1 y 190"),
    ({"op": "order_album", "folder_id": NEW_FOLDER, "song_ids": [f"S{index:016x}" for index in range(191)]},
     "entre 1 y 190"),
    ({"op": "order_album", "folder_id": NEW_FOLDER, "song_ids": [SONG, SONG_B, SONG]}, "repetidas"),
    ({"op": "order_album", "folder_id": NEW_FOLDER, "song_ids": ["S0123"]}, "song_id"),
    ({"op": "order_album", "folder_id": NEW_FOLDER, "song_ids": [1]}, "song_id"),
    ({"op": "order_album", "folder_id": None, "song_ids": [SONG]}, "folder_id no es un id"),
    ({"op": "order_album", "folder_id": "../x", "song_ids": [SONG]}, "folder_id no es un id"),
    ({"op": "order_album", "song_ids": [SONG]}, "falta el campo folder_id"),
    ({"op": "order_album", "folder_id": NEW_FOLDER}, "falta el campo song_ids"),
    ({"op": "order_album", "folder_id": NEW_FOLDER, "song_ids": [SONG], "track": 1}, "campo desconocido"),
])
def test_order_album_refuses_bad_lists_ids_and_extra_fields(payload, message):
    with pytest.raises(RequestError, match=message):
        validate_payload(payload)


def test_edit_song_still_cannot_set_a_track():
    with pytest.raises(RequestError, match="campo desconocido"):
        validate_payload({"op": "edit_song", "song_id": SONG, "track": 3})


def test_one_hundred_ninety_songs_fit_in_the_payload_limit():
    ids = [f"S{index:016x}" for index in range(190)]
    # La web y la APK envían el JSON compacto (sin espacios), como aquí.
    payload = json.dumps({"op": "order_album", "folder_id": NEW_FOLDER, "song_ids": ids}, separators=(",", ":"))
    request = parse_request("action: organize\npayload: " + payload)
    assert request["payload"]["song_ids"] == ids
    compact = json.dumps(request["payload"], ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    assert len(compact) == 65 + 20 * 190 <= 4000


def test_order_album_in_the_manual_form_goes_through_the_same_validation():
    env = {"ACTION": "organize", "PAYLOAD": json.dumps({"op": "order_album", "folder_id": NEW_FOLDER, "song_ids": [SONG]})}
    request = request_from_env(env)
    assert request["payload"]["op"] == "order_album"
    assert summarize(request)["campos"] == ["folder_id", "song_ids"]


# Cuerpos que generan la web (js/cuidador/incidencias.js, buildIssueBody) y la APK (LibraryRequest.orderAlbum.body):
# los dos los acepta parse_request tal cual. Si cambia el formato en uno de los dos, hay que cambiarlo aquí.
@pytest.mark.parametrize("text", [
    'action: organize\npayload: {"op":"order_album","folder_id":"F0123456789abcdef","song_ids":["S000000000000000b",'
    '"S000000000000000a"]}',
])
def test_the_bodies_written_by_the_web_and_the_apk_are_accepted(text):
    request = parse_request(text)
    assert request["payload"]["song_ids"] == ["S000000000000000b", "S000000000000000a"]


# --- Aplicación (scripts/ci_library.py) ------------------------------------------------------------------------------


def test_order_album_assigns_tracks_one_to_n_and_publishes_them(ci):
    ids, folder_id = _seed(ci, 3)
    _organize(ci, {"op": "move_songs", "song_ids": ids, "folder_id": folder_id})
    _organize(ci, {"op": "edit_song", "song_id": ids[0], "public": True})
    _organize(ci, {"op": "edit_song", "song_id": ids[2], "public": True})

    result = _organize(ci, {"op": "order_album", "folder_id": folder_id, "song_ids": [ids[2], ids[0], ids[1]]})

    assert result["songs"] == [{"id": ids[2], "track": 1}, {"id": ids[0], "track": 2}, {"id": ids[1], "track": 3}]
    assert _tracks(ci, folder_id) == [(ids[2], 1), (ids[0], 2), (ids[1], 3)]
    songs = {song["id"]: song for song in json.loads((ci.WEB / "data" / "songs.json").read_text(encoding="utf-8"))}
    assert songs[ids[2]]["track"] == 1 and songs[ids[0]]["track"] == 2 and ids[1] not in songs
    view = json.loads((ci.WEB / "data" / "catalog.json").read_text(encoding="utf-8"))
    assert {song["id"]: song["track"] for song in view["songs"]} == {ids[2]: 1, ids[0]: 2}


def test_repeating_the_same_order_changes_nothing(ci):
    ids, folder_id = _seed(ci, 2)
    _organize(ci, {"op": "move_songs", "song_ids": ids, "folder_id": folder_id})
    _organize(ci, {"op": "order_album", "folder_id": folder_id, "song_ids": [ids[1], ids[0]]})
    before = ci.CATALOG.read_bytes()
    _organize(ci, {"op": "order_album", "folder_id": folder_id, "song_ids": [ids[1], ids[0]]})
    assert ci.CATALOG.read_bytes() == before


@pytest.mark.parametrize("song_ids_of, motivo", [
    (lambda ids: [ids[0], ids[1]], r"faltan 1 canción\(es\) del álbum\)"),
    (lambda ids: [ids[0], ids[1], ids[2], ids[3]], r"\(sobran 1 canción"),
    (lambda ids: [ids[0], ids[1], ids[3]], r"faltan 1 canción\(es\) del álbum y sobran 1"),
    (lambda ids: [ids[0], ids[1], ids[2], "S" + "f" * 16], r"\(sobran 1"),
])
def test_order_album_is_atomic_when_the_list_is_not_exactly_the_album(ci, song_ids_of, motivo):
    ids, folder_id = _seed(ci, 4)
    _organize(ci, {"op": "move_songs", "song_ids": ids[:3], "folder_id": folder_id})
    before = ci.CATALOG.read_bytes()

    with pytest.raises(catalog.CatalogError, match=motivo):
        _organize(ci, {"op": "order_album", "folder_id": folder_id, "song_ids": song_ids_of(ids)})

    assert ci.CATALOG.read_bytes() == before


def test_order_album_refuses_an_album_that_does_not_exist_without_changes(ci):
    ids, _ = _seed(ci, 1)
    before = ci.CATALOG.read_bytes()
    with pytest.raises(catalog.CatalogError, match="no existe la carpeta"):
        _organize(ci, {"op": "order_album", "folder_id": "F" + "0" * 16, "song_ids": ids})
    assert ci.CATALOG.read_bytes() == before


def test_catalog_order_album_refuses_repeated_ids_even_without_the_request_validation():
    data = catalog.empty()
    folder = catalog.create_folder(data, "A")
    song, _ = catalog.add_song(data, sha256="aa" * 32, title="T", license="CC0", source="x", codec="opus",
                               duration_s=1.0, size_bytes=1)
    catalog.update_song(data, song["id"], {"folder_id": folder["id"]})
    with pytest.raises(catalog.CatalogError, match="repetidas"):
        catalog.order_album(data, folder["id"], [song["id"], song["id"]])


def test_entering_gets_the_next_track_and_leaving_renumbers_the_rest(ci):
    ids, folder_id = _seed(ci, 5)
    _organize(ci, {"op": "move_songs", "song_ids": [ids[3], ids[1], ids[0]], "folder_id": folder_id})
    assert _tracks(ci, folder_id) == [(ids[3], 1), (ids[1], 2), (ids[0], 3)]

    # edit_song con folder_id: entra al final.
    _organize(ci, {"op": "edit_song", "song_id": ids[4], "folder_id": folder_id})
    assert _tracks(ci, folder_id)[-1] == (ids[4], 4)

    # Sale una del medio: las demás quedan de 1 a n sin huecos y la que sale pierde el número.
    _organize(ci, {"op": "edit_song", "song_id": ids[1], "folder_id": None})
    assert _tracks(ci, folder_id) == [(ids[3], 1), (ids[0], 2), (ids[4], 3)]
    saved = {song["id"]: song for song in catalog.load(ci.CATALOG)["songs"]}
    assert "track" not in saved[ids[1]] and "track" not in saved[ids[2]]

    # move_songs que saca varias a la vez.
    _organize(ci, {"op": "move_songs", "song_ids": [ids[3], ids[4]], "folder_id": None})
    assert _tracks(ci, folder_id) == [(ids[0], 1)]

    # Volver a poner una canción en el álbum en el que ya está no cambia su número.
    _organize(ci, {"op": "move_songs", "song_ids": [ids[2], ids[1]], "folder_id": folder_id})
    before = _tracks(ci, folder_id)
    _organize(ci, {"op": "move_songs", "song_ids": [ids[2]], "folder_id": folder_id})
    _organize(ci, {"op": "edit_song", "song_id": ids[1], "folder_id": folder_id, "title": "Otro título"})
    assert _tracks(ci, folder_id) == before == [(ids[0], 1), (ids[2], 2), (ids[1], 3)]


def test_moving_between_albums_renumbers_both(ci):
    ids, first = _seed(ci, 4)
    data = catalog.load(ci.CATALOG)
    second = catalog.create_folder(data, "Otro álbum")["id"]
    catalog.save(ci.CATALOG, data)
    _organize(ci, {"op": "move_songs", "song_ids": ids[:3], "folder_id": first})
    _organize(ci, {"op": "move_songs", "song_ids": [ids[3]], "folder_id": second})

    _organize(ci, {"op": "move_songs", "song_ids": [ids[0]], "folder_id": second})

    assert _tracks(ci, first) == [(ids[1], 1), (ids[2], 2)]
    assert _tracks(ci, second) == [(ids[3], 1), (ids[0], 2)]


def test_organize_youtube_playlist_appends_new_songs_in_playlist_order(ci):
    ids, _ = _seed(ci, 3)
    tracks = [{"song_id": ids[2], "artist": "A"}, {"song_id": ids[0], "artist": "A"}]
    result = _organize(ci, {"op": "organize_youtube_playlist", "playlist_id": "PLx", "name": "Lista", "songs": tracks})
    folder_id = result["folder"]["id"]
    assert _tracks(ci, folder_id) == [(ids[2], 1), (ids[0], 2)]

    more = tracks + [{"song_id": ids[1], "artist": "A"}]
    _organize(ci, {"op": "organize_youtube_playlist", "playlist_id": "PLx", "name": "Lista", "songs": more})
    assert _tracks(ci, folder_id) == [(ids[2], 1), (ids[0], 2), (ids[1], 3)]


def test_delete_folder_moves_its_songs_to_the_parent_at_the_end_or_drops_their_tracks(ci):
    ids, parent_id = _seed(ci, 4)
    data = catalog.load(ci.CATALOG)
    child_id = catalog.create_folder(data, "Disco 2", parent_id)["id"]
    catalog.save(ci.CATALOG, data)
    _organize(ci, {"op": "move_songs", "song_ids": [ids[0]], "folder_id": parent_id})
    _organize(ci, {"op": "move_songs", "song_ids": [ids[2], ids[1]], "folder_id": child_id})

    _organize(ci, {"op": "delete_folder", "folder_id": child_id})
    assert _tracks(ci, parent_id) == [(ids[0], 1), (ids[2], 2), (ids[1], 3)]

    _organize(ci, {"op": "delete_folder", "folder_id": parent_id})
    assert all("track" not in song for song in catalog.load(ci.CATALOG)["songs"])


# --- Migración del catálogo anterior ---------------------------------------------------------------------------------


def _old_catalog(module) -> tuple[list[str], str, str]:
    """Catálogo de antes de ADR-0026: canciones en un álbum sin número y una suelta con un número que sobra."""
    data = catalog.empty()
    folder = catalog.create_folder(data, "Viejo")
    ids = []
    for index, title in enumerate(["zeta", "Alfa", "beta", "alfa"]):
        song, _ = catalog.add_song(
            data, sha256=f"{index + 40:02x}" * 32, title=title, license="CC0 1.0", source="x", codec="opus",
            duration_s=5.0, size_bytes=10,
        )
        song["folder_id"] = folder["id"]
        song["public"] = True
        ids.append(song["id"])
    loose, _ = catalog.add_song(data, sha256="ee" * 32, title="Suelta", license="CC0 1.0", source="x", codec="opus",
                                duration_s=5.0, size_bytes=10)
    loose["track"] = 7
    catalog.save(module.CATALOG, data)
    module.AUDIO.mkdir(parents=True, exist_ok=True)
    for song_id in ids:
        (module.AUDIO / f"{song_id}.opus").write_bytes(b"opus")
    return ids, folder["id"], loose["id"]


def test_the_first_write_migrates_an_old_catalog_in_todays_order(ci):
    ids, folder_id, loose_id = _old_catalog(ci)
    sin_migrar = catalog.load(ci.CATALOG)

    _organize(ci, {"op": "create_folder", "name": "Otro"})

    # El orden de hoy es el de data/songs.json: título sin mayúsculas; «Alfa» y «alfa» empatan y manda el catálogo.
    assert _tracks(ci, folder_id) == [(ids[1], 1), (ids[3], 2), (ids[2], 3), (ids[0], 4)]
    saved = catalog.load(ci.CATALOG)
    assert "track" not in next(song for song in saved["songs"] if song["id"] == loose_id)
    published = json.loads((ci.WEB / "data" / "songs.json").read_text(encoding="utf-8"))
    assert [(song["title"], song["track"]) for song in published] == [("Alfa", 1), ("alfa", 2), ("beta", 3), ("zeta", 4)]
    # No cambia nada más de las canciones.
    for before, after in zip(sin_migrar["songs"], saved["songs"], strict=True):
        assert {k: v for k, v in before.items() if k != "track"} == {k: v for k, v in after.items() if k != "track"}

    # Ya migrado: otra escritura no cambia los números.
    before = _tracks(ci, folder_id)
    _organize(ci, {"op": "create_folder", "name": "Otro más"})
    assert _tracks(ci, folder_id) == before


def test_normalize_tracks_keeps_numbered_songs_first_and_closes_gaps():
    data = catalog.empty()
    folder = catalog.create_folder(data, "Mezcla")["id"]
    songs = []
    for index, (title, track) in enumerate([("a", None), ("b", 5), ("c", 2), ("d", True), ("e", 0), ("f", "3")]):
        song, _ = catalog.add_song(data, sha256=f"{index + 80:02x}" * 32, title=title, license="CC0", source="x",
                                   codec="opus", duration_s=1.0, size_bytes=1)
        song["folder_id"] = folder
        if track is not None:
            song["track"] = track
        songs.append(song)

    assert catalog.normalize_tracks(data) is True
    # Primero las que tenían un número válido (2 y 5); después el resto, por título. Booleanos, 0 y texto no valen.
    assert [(song["title"], song["track"]) for song in catalog.songs_in_folder(data, folder)] == [
        ("c", 1), ("b", 2), ("a", 3), ("d", 4), ("e", 5), ("f", 6),
    ]
    assert catalog.normalize_tracks(data) is False

