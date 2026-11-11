import pytest

from sonidos import catalog
from sonidos.catalog import CatalogError


def _song(data, sha="a" * 64, license="CC0"):
    return catalog.add_song(data, sha256=sha, title="Tema", license=license, source="x:y",
                            codec="flac", duration_s=10.0, size_bytes=100)


def test_new_song_is_private_and_deduplicated():
    data = catalog.empty()
    song, created = _song(data)
    again, created_again = _song(data)
    assert created is True and created_again is False
    assert song["public"] is False
    assert len(data["songs"]) == 1


def test_song_without_license_is_refused():
    with pytest.raises(CatalogError, match="sin licencia"):
        _song(catalog.empty(), license="  ")


def test_update_song_validates_and_normalizes():
    data = catalog.empty()
    song, _ = _song(data)
    updated = catalog.update_song(data, song["id"], {"tags": "Jazz, jazz , años 20", "year": "1925", "public": True})
    assert updated["tags"] == ["jazz", "años 20"]
    assert updated["year"] == 1925
    assert updated["public"] is True


def test_update_rejects_unknown_fields_and_empty_title():
    data = catalog.empty()
    song, _ = _song(data)
    with pytest.raises(CatalogError, match="no editables"):
        catalog.update_song(data, song["id"], {"sha256": "x"})
    with pytest.raises(CatalogError, match="vacío"):
        catalog.update_song(data, song["id"], {"title": "  "})


def test_folder_tree_and_delete_moves_contents_up():
    data = catalog.empty()
    parent = catalog.create_folder(data, "Años 20")
    child = catalog.create_folder(data, "Jazz", parent["id"])
    song, _ = _song(data)
    catalog.update_song(data, song["id"], {"folder_id": child["id"]})

    catalog.delete_folder(data, child["id"])

    assert catalog.find_song(data, song["id"])["folder_id"] == parent["id"]
    assert [f["id"] for f in data["folders"]] == [parent["id"]]


def test_song_cannot_move_to_missing_folder():
    data = catalog.empty()
    song, _ = _song(data)
    with pytest.raises(CatalogError, match="no existe la carpeta"):
        catalog.update_song(data, song["id"], {"folder_id": "nope"})


def test_save_and_load_roundtrip(tmp_path):
    path = tmp_path / "catalog.json"
    data = catalog.empty()
    _song(data)
    catalog.save(path, data)
    assert catalog.load(path)["songs"][0]["title"] == "Tema"
    assert catalog.load(tmp_path / "missing.json") == catalog.empty()


def test_creating_a_folder_twice_under_the_same_parent_does_not_duplicate_it():
    data = catalog.empty()
    first = catalog.create_folder(data, "Jazz")

    again = catalog.create_folder(data, " Jazz ")

    assert again["id"] == first["id"]
    assert len(data["folders"]) == 1


def test_same_folder_name_under_another_parent_is_another_folder():
    data = catalog.empty()
    parent = catalog.create_folder(data, "Años 20")
    catalog.create_folder(data, "Jazz")

    child = catalog.create_folder(data, "Jazz", parent["id"])

    assert child["parent_id"] == parent["id"]
    assert len(data["folders"]) == 3


def test_youtube_album_matches_by_name_before_creating(tmp_path=None):
    data = catalog.empty()
    # Álbum ya existente (p. ej. venía de una importación de YouTube) con su propio id de fuente.
    first, _ = catalog.youtube_album(data, "yt_fiesta", "Fiesta")
    assert len(data["folders"]) == 1
    # Importar la MISMA lista por otra fuente y con el nombre igual (distinto id) se une al álbum existente, no duplica.
    again, changed = catalog.youtube_album(data, "spotify_playlist_abc", "  fiesta ")
    assert again["id"] == first["id"]
    assert changed is False
    assert len(data["folders"]) == 1  # no se ha creado un segundo "Fiesta"
    assert first.get("youtube_playlist_id") == "yt_fiesta"  # no se pisa el id de la fuente original


def test_youtube_album_creates_when_no_match():
    data = catalog.empty()
    folder, changed = catalog.youtube_album(data, "spotify_playlist_new", "Mix")
    assert changed is True
    assert folder["name"] == "Mix"
    assert folder["youtube_playlist_id"] == "spotify_playlist_new"
    assert len(data["folders"]) == 1


@pytest.mark.parametrize("public", ["false", "true", 1, 0, None])
def test_update_song_public_must_be_a_json_boolean(public):
    # bool("false") es True: el texto no puede llegar nunca al catálogo como publicación.
    data = catalog.empty()
    song, _ = _song(data)

    with pytest.raises(CatalogError, match="public"):
        catalog.update_song(data, song["id"], {"public": public})
    assert song["public"] is False
