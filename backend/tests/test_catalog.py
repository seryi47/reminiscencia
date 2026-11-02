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
    updated = catalog.update_song(data, song["id"], {"tags": "Jazz, jazz , años 20", "year": "1925", "public": 1})
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
