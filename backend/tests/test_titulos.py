"""Regla común de «título limpio» (ADR-0032): contrato (tests/contrato/titulos.json), idempotencia, el buzón al crear
cada canción, la operación clean_titles y la vista previa. Sin red: el catálogo real se lee de esta copia de trabajo."""

import copy
import hashlib
import importlib.util
import json
import random
import subprocess
from pathlib import Path

import pytest

from conftest import make_tone
from sonidos import catalog, duplicados, titulos
from sonidos.buzon import procesar_buzon
from sonidos.issue_request import RequestError, parse_request, validate_payload

ROOT = Path(__file__).resolve().parents[2]
CONTRATO = json.loads((ROOT / "tests" / "contrato" / "titulos.json").read_text(encoding="utf-8"))
REAL_CATALOG = ROOT / "audio-library" / "indexes" / "catalog.json"
BUZON = "audio-library/buzon"
CON_LICENCIA = "Add files via upload\n\nLicencia: CC BY 4.0 (grabación propia)"


def _clean(caso):
    return titulos.clean_song(
        caso["titulo"], caso["artista"], keep_artist=caso.get("conservar_artista", False),
        known_artists=caso.get("conocidos", ()),
    )


# --- Contrato ---------------------------------------------------------------------------------------------------------


def test_the_data_of_the_rule_is_exactly_the_shared_contract():
    assert list(titulos.SEPARATORS) == CONTRATO["separadores"]
    assert list(titulos.TAG_WORDS) == CONTRATO["palabras_etiqueta"]
    assert list(titulos.TRAILING_WORDS) == CONTRATO["palabras_sueltas_al_final"]
    assert list(titulos.COLLAB_MARKS) == CONTRATO["marcas_colaboracion"]
    assert list(titulos.CREDIT_SEPARATORS) == CONTRATO["separadores_de_creditos"]
    assert list(titulos.PARTICLES) == CONTRATO["particulas"]
    assert list(titulos.ACRONYMS) == CONTRATO["siglas"]
    assert list(titulos.EXTENSIONS) == CONTRATO["extensiones"]
    assert titulos.MAX_PREFIX_CHARS == CONTRATO["max_prefijo"]
    assert titulos.MIN_UPPER_LETTERS == CONTRATO["min_letras_mayusculas"]
    assert titulos.MAX_ROUNDS == CONTRATO["max_rondas"]


def test_the_exact_tags_are_the_ones_of_the_duplicates_rule_not_a_copy():
    # Las etiquetas exactas no se repiten: son las de duplicados.json (ADR-0026).
    assert "duplicados.json" in CONTRATO["etiquetas"]
    for tag in duplicados.TAGS:
        assert titulos.is_tag(tag), tag
    # Las palabras de etiqueta no deben solaparse con las marcas de colaboración ni con las partículas.
    assert not set(titulos.TAG_WORDS) & set(titulos.COLLAB_MARKS)
    assert not set(titulos.TAG_WORDS) & set(titulos.PARTICLES)


def test_web_and_apk_do_not_apply_it():
    assert CONTRATO["web"] == "no_aplica"
    assert CONTRATO["apk"] == "no_aplica"
    assert CONTRATO["motivo_no_aplica"]


@pytest.mark.parametrize("caso", CONTRATO["casos"], ids=lambda caso: caso["nota"])
def test_every_contract_case(caso):
    assert _clean(caso) == (caso["salida"]["titulo"], caso["salida"]["artista"])


@pytest.mark.parametrize("caso", CONTRATO["casos"], ids=lambda caso: caso["nota"])
def test_cleaning_twice_is_cleaning_once(caso):
    title, artist = _clean(caso)
    again = titulos.clean_song(
        title, artist, keep_artist=caso.get("conservar_artista", False), known_artists=caso.get("conocidos", ()),
    )
    assert again == (title, artist)


def test_the_contract_cases_have_unique_notes_and_cover_the_spec():
    notas = [caso["nota"] for caso in CONTRATO["casos"]]
    assert len(notas) == len(set(notas))
    salidas = {(caso["titulo"], caso["artista"]): caso["salida"] for caso in CONTRATO["casos"]}
    # Los ejemplos del encargo.
    assert salidas[("BAD BUNNY - MONACO (Official Video) nadie sabe lo que va a pasar mañana", "")] == {
        "titulo": "Monaco", "artista": "Bad Bunny"}
    assert salidas[("Bad Bunny - DtMF (Letra)", "")] == {"titulo": "DtMF", "artista": "Bad Bunny"}
    assert salidas[("Rick Astley - Never Gonna Give You Up (Official Video) (4K Remaster)", "")] == {
        "titulo": "Never Gonna Give You Up", "artista": "Rick Astley"}
    assert salidas[("BAD GYAL - FIEBRE PROD KING DOUDOU", "")] == {
        "titulo": "Fiebre Prod King Doudou", "artista": "Bad Gyal"}


def test_odd_inputs_never_raise_and_never_empty_a_title():
    assert titulos.clean_song(None, None) == ("", "")
    assert titulos.clean_song("", "Marea") == ("", "Marea")
    assert titulos.clean_song("   ", "") == ("   ", "")
    assert titulos.clean_song("[HD]", "") == ("[HD]", "")
    assert titulos.clean_song("Tema", 12) == ("Tema", "")


def test_idempotence_on_random_titles():
    """Combinaciones al azar (semilla fija) de las piezas que dan problemas: nunca vacía un título y limpiar dos veces
    da lo mismo que una."""
    pieces = [
        "BAD", "Bunny", " - ", " – ", " — ", "(Official Video)", "[HD]", "(feat. X)", "(con Y)", "01 ", "7 - ", "LA",
        "de", "  ", "Oficial", "Music", "Video", "(Remix - Official Video)", "(1999)", ".mp4", "ZOO", "Tema", "x", "&",
        "y", ",", "(", ")", "[", "]", "-", "SKA-P", "ÑANDÚ", "(Letra)", "Lyrics", "2011", "DJ", "ß", "İ", "ǅ", "Ĳ",
    ]
    rng = random.Random(32)
    known = frozenset({"bad bunny", "zoo", "la"})
    for _ in range(20000):
        title = "".join(rng.choice(pieces) for _ in range(rng.randint(1, 8)))
        artist = rng.choice(["", "Bad Bunny", "iPerol", "ZOO", " x ", "LA"])
        keep = rng.random() < 0.3
        once = titulos.clean_song(title, artist, keep_artist=keep, known_artists=known)
        assert titulos.clean_song(*once, keep_artist=keep, known_artists=known) == once, (title, artist, keep)
        if title.strip():
            assert once[0].strip(), (title, artist)


def test_credits_split_lists_of_artists():
    assert titulos.credits("Rauw Alejandro y Mr. Naisgai") == {"rauw alejandro", "mr naisgai"}
    assert titulos.credits("Daddy Yankee x Natti Natasha x Becky G") == {"daddy yankee", "natti natasha", "becky g"}
    assert titulos.credits("Sons Of Aguirre & Scila") == {"sons of aguirre", "scila"}
    assert titulos.credits("Sech feat. Darell, Ozuna") == {"sech", "darell", "ozuna"}
    assert titulos.credits("") == frozenset()


def test_known_artists_come_from_songs_and_albums():
    songs = [{"artist": "Bad Bunny y Don Omar"}, {"artist": ""}, {"artist": None}, {}]
    folders = [{"artist": "Desakato"}, {"name": "Sin artista"}]
    assert titulos.known_artists(songs, folders) == {"bad bunny", "don omar", "desakato"}


# --- plan_clean y el catálogo real -------------------------------------------------------------------------------------


def _song(song_id, title, artist="", **extra):
    return {"id": song_id, "title": title, "artist": artist, "folder_id": None, **extra}


def test_plan_clean_lists_only_what_changes_and_never_the_id():
    data = {"folders": [], "songs": [
        _song("S0000000000000001", "Bad Bunny - Yonaguni (Video Oficial)"),
        _song("S0000000000000002", "Tema limpio", "Marea"),
    ]}
    before = copy.deepcopy(data)
    changes = titulos.plan_clean(data)
    assert data == before  # no toca el catálogo
    assert changes == [{
        "id": "S0000000000000001",
        "antes": {"title": "Bad Bunny - Yonaguni (Video Oficial)", "artist": ""},
        "despues": {"title": "Yonaguni", "artist": "Bad Bunny"},
    }]
    assert titulos.plan_clean(data, ["S0000000000000002"]) == []


def test_plan_clean_learns_artists_found_while_cleaning():
    """«Ray Heredia» no está en la biblioteca, pero sale de la primera canción; con él se reconoce el de la segunda, que
    tenía de artista el canal. Así una segunda limpieza no encuentra nada nuevo."""
    data = {"folders": [], "songs": [
        _song("S0000000000000001", "Ray Heredia - Alegría de Vivir (Audio Oficial)"),
        _song("S0000000000000002", "Ray Heredia - Otra (Letra)", "CanalDeMusica"),
    ]}
    changes = {change["id"]: change["despues"] for change in titulos.plan_clean(data)}
    assert changes == {
        "S0000000000000001": {"title": "Alegría de Vivir", "artist": "Ray Heredia"},
        "S0000000000000002": {"title": "Otra", "artist": "Ray Heredia"},
    }


def _apply(data, changes):
    applied = copy.deepcopy(data)
    by_id = {change["id"]: change["despues"] for change in changes}
    for song in applied["songs"]:
        if song["id"] in by_id:
            song["title"], song["artist"] = by_id[song["id"]]["title"], by_id[song["id"]]["artist"]
    return applied


def test_the_real_catalog_cleans_once_and_then_nothing():
    data = json.loads(REAL_CATALOG.read_text(encoding="utf-8"))
    changes = titulos.plan_clean(data)
    assert changes  # el catálogo de main tiene títulos de YouTube por limpiar
    ids = {song["id"] for song in data["songs"]}
    for change in changes:
        assert change["id"] in ids
        assert change["despues"]["title"].strip()
        assert len(change["despues"]["title"]) <= len(change["antes"]["title"])
    assert titulos.plan_clean(_apply(data, changes)) == []


# --- Contrato de la petición -------------------------------------------------------------------------------------------


def test_the_request_is_accepted_with_or_without_song_ids():
    assert validate_payload({"op": "clean_titles"}) == {"op": "clean_titles"}
    assert validate_payload({"op": "clean_titles", "song_ids": ["S0000000000000001"]}) == {
        "op": "clean_titles", "song_ids": ["S0000000000000001"]}
    pedido = parse_request('action: organize\npayload: {"op":"clean_titles"}')
    assert pedido["payload"] == {"op": "clean_titles"}
    with pytest.raises(RequestError) as error:
        validate_payload({"op": "clean_titles", "title": "x"})
    assert (error.value.code, error.value.field) == ("unknown_field", "title")


# --- clean_titles en scripts/ci_library.py -------------------------------------------------------------------------------


@pytest.fixture
def ci(tmp_path, monkeypatch):
    spec = importlib.util.spec_from_file_location("ci_library_titulos", ROOT / "scripts" / "ci_library.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    base = tmp_path / "repo"
    monkeypatch.setattr(module, "CATALOG", base / "audio-library" / "indexes" / "catalog.json")
    monkeypatch.setattr(module, "AUDIO", base / "audio-library" / "audio")
    monkeypatch.setattr(module, "COVERS", base / "audio-library" / "covers")
    monkeypatch.setattr(module, "STAGING", base / "audio-library" / "staging")
    monkeypatch.setattr(module, "WEB", base / "frontend" / "web")
    return module


def _seed(module, titles: list[tuple[str, str]], *, album: bool = False) -> list[str]:
    data = catalog.empty()
    folder = catalog.youtube_album(data, "PLprueba", "Fiesta")[0] if album else None
    ids = []
    for index, (title, artist) in enumerate(titles):
        song, _ = catalog.add_song(
            data, sha256=hashlib.sha256(f"tema-{index}".encode()).hexdigest(), title=title, license="CC0 1.0",
            source="Subida por ana", codec="opus", duration_s=100.0 + index, size_bytes=10, artist=artist,
        )
        catalog.update_song(data, song["id"], {"public": True, **({"folder_id": folder["id"]} if folder else {})})
        ids.append(song["id"])
    catalog.save(module.CATALOG, data)
    return ids


def _organize(module, payload: dict) -> dict:
    return module.run({"ACTION": "organize", "PAYLOAD": json.dumps(payload)})


def test_clean_titles_changes_only_title_and_artist_and_is_idempotent(ci):
    ids = _seed(ci, [
        ("BAD BUNNY - MONACO (Official Video) nadie sabe lo que va a pasar mañana", ""),
        ("Bad Bunny - DtMF (Letra)", "iPerol"),
        ("Tema limpio", "Marea"),
    ])
    before = {song["id"]: song for song in catalog.load(ci.CATALOG)["songs"]}

    result = _organize(ci, {"op": "clean_titles"})

    assert result["cleaned"] == 2
    after = {song["id"]: song for song in catalog.load(ci.CATALOG)["songs"]}
    assert (after[ids[0]]["artist"], after[ids[0]]["title"]) == ("Bad Bunny", "Monaco")
    assert (after[ids[1]]["artist"], after[ids[1]]["title"]) == ("Bad Bunny", "DtMF")
    assert after[ids[2]] == before[ids[2]]
    for song_id in ids:
        rest = {key: value for key, value in after[song_id].items() if key not in ("title", "artist")}
        assert rest == {key: value for key, value in before[song_id].items() if key not in ("title", "artist")}
        assert after[song_id]["id"] == catalog.song_id_for(after[song_id]["sha256"])
    # La parte pública se regenera con los títulos nuevos.
    publicas = json.loads((ci.WEB / "data" / "songs.json").read_text(encoding="utf-8"))
    assert {song["title"] for song in publicas} == {"Monaco", "DtMF", "Tema limpio"}

    snapshot = ci.CATALOG.read_text(encoding="utf-8")
    again = _organize(ci, {"op": "clean_titles"})
    assert again["cleaned"] == 0 and again["songs"] == []
    assert ci.CATALOG.read_text(encoding="utf-8") == snapshot


def test_clean_titles_with_song_ids_only_touches_those(ci):
    ids = _seed(ci, [("Marea - Corazón de mimbre", ""), ("Marea - La luna me sabe a poco", "")])

    result = _organize(ci, {"op": "clean_titles", "song_ids": [ids[1]]})

    assert [change["id"] for change in result["songs"]] == [ids[1]]
    songs = {song["id"]: song for song in catalog.load(ci.CATALOG)["songs"]}
    assert songs[ids[0]]["title"] == "Marea - Corazón de mimbre"
    assert (songs[ids[1]]["artist"], songs[ids[1]]["title"]) == ("Marea", "La luna me sabe a poco")


def test_clean_titles_is_atomic_when_a_song_does_not_exist(ci):
    ids = _seed(ci, [("Marea - Corazón de mimbre", "")])
    snapshot = ci.CATALOG.read_text(encoding="utf-8")

    with pytest.raises(catalog.CatalogError):
        _organize(ci, {"op": "clean_titles", "song_ids": [ids[0], "S0000000000000099"]})

    assert ci.CATALOG.read_text(encoding="utf-8") == snapshot


def test_clean_titles_keeps_the_youtube_album_artist_in_sync(ci):
    _seed(ci, [("Desakato - Cada vez (Videoclip Oficial)", "canal"), ("Desakato - Sombras", "Desakato")], album=True)

    _organize(ci, {"op": "clean_titles"})

    data = catalog.load(ci.CATALOG)
    assert {(song["artist"], song["title"]) for song in data["songs"]} == {("Desakato", "Cada vez"), ("Desakato", "Sombras")}
    [folder] = data["folders"]
    assert folder["artist"] == "Desakato"  # todas sus canciones ya comparten artista (ADR-0019)


def test_clean_titles_via_main_prints_the_changes(ci, capsys, monkeypatch):
    _seed(ci, [("Rick Astley - Never Gonna Give You Up (Official Video) (4K Remaster)", "")])
    monkeypatch.setattr(ci.os, "environ", {"ACTION": "organize", "PAYLOAD": '{"op":"clean_titles"}'})

    assert ci.main() == 0

    salida = json.loads(capsys.readouterr().out)
    assert salida["cleaned"] == 1
    assert salida["songs"][0]["despues"] == {"title": "Never Gonna Give You Up", "artist": "Rick Astley"}


# --- El buzón limpia al crear la canción -----------------------------------------------------------------------------------


def _git(repo: Path, *args: str) -> None:
    subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True, text=True)


def _commit(repo: Path, message: str) -> None:
    _git(repo, "add", "-A")
    _git(repo, "-c", "user.name=prueba", "-c", "user.email=prueba@example.invalid", "commit", "-q", "-m", message)


@pytest.fixture
def repo(main_publicado: Path) -> Path:
    (main_publicado / BUZON).mkdir(parents=True)
    (main_publicado / BUZON / "README.md").write_text("buzón\n", encoding="utf-8")
    _commit(main_publicado, "buzón")
    return main_publicado


def _catalogo(repo: Path) -> dict:
    return json.loads((repo / "audio-library" / "indexes" / "catalog.json").read_text(encoding="utf-8"))


def test_the_mailbox_creates_the_song_with_a_clean_title_and_keeps_name_and_id(repo):
    name = "BAD BUNNY - MONACO (Official Video) nadie sabe lo que va a pasar mañana.wav"
    make_tone(repo / BUZON / name, seconds=1.0, frequency=610)
    _commit(repo, CON_LICENCIA)

    result = procesar_buzon(
        repo=repo, event={"commits": [{"message": CON_LICENCIA, "added": [f"{BUZON}/{name}"], "modified": [],
                                       "removed": []}]}, actor="ana",
    )

    [entry] = result["publicas"]
    assert entry["archivo"] == name  # el nombre del archivo no cambia en el resumen
    song = next(song for song in _catalogo(repo)["songs"] if song["id"] == entry["song_id"])
    assert (song["artist"], song["title"]) == ("Bad Bunny", "Monaco")
    assert song["id"] == catalog.song_id_for(song["sha256"])
    assert (repo / "audio-library" / "audio" / f"{song['id']}.opus").is_file()


def _parts_upload(repo: Path, tmp_path: Path, upload_id: str, nombre: str, *, artist: str = "",
                  album: dict | None = None, frequency: int = 1300) -> str:
    parts = repo / BUZON / ".partes" / upload_id
    parts.mkdir(parents=True)
    (parts / "0.part").write_bytes(make_tone(tmp_path / f"{upload_id}.wav", seconds=0.5, frequency=frequency).read_bytes())
    manifest = {"nombre": nombre, "partes": 1, **({"album": album} if album else {}), **({"artist": artist} if artist else {})}
    (parts / "manifiesto.json").write_text(json.dumps(manifest), encoding="utf-8")
    return f"{BUZON}/.partes/{upload_id}/manifiesto.json"


def test_a_playlist_artist_is_respected_and_only_the_title_is_cleaned(repo, tmp_path):
    album = {"id": "PLprueba", "name": "Fiesta"}
    paths = [
        _parts_upload(repo, tmp_path, "123e4567-e89b-12d3-a456-426614174001", "Bad Bunny - DtMF (Letra).opus",
                      artist="iPerol", album=album, frequency=1310),
        _parts_upload(repo, tmp_path, "123e4567-e89b-12d3-a456-426614174002", "Bad Bunny - Yonaguni (Video Oficial).opus",
                      artist="Bad Bunny", album=album, frequency=1320),
    ]
    _commit(repo, CON_LICENCIA)

    result = procesar_buzon(
        repo=repo, event={"commits": [{"message": CON_LICENCIA, "added": paths, "modified": [], "removed": []}]},
        actor="ana",
    )

    songs = {song["id"]: song for song in _catalogo(repo)["songs"]}
    found = {(songs[item["song_id"]]["artist"], songs[item["song_id"]]["title"]) for item in result["publicas"]}
    # «iPerol» viene de la playlist: se respeta aunque «Bad Bunny» ya sea un artista conocido (ADR-0019).
    assert found == {("iPerol", "Bad Bunny - DtMF"), ("Bad Bunny", "Yonaguni")}


def test_a_single_video_with_the_channel_as_artist_gets_the_known_artist(repo, tmp_path):
    # Primero una canción de «Bad Bunny»; después un vídeo suelto cuyo artista es el canal que lo subió.
    first = _parts_upload(repo, tmp_path, "123e4567-e89b-12d3-a456-426614174003", "Bad Bunny - Yonaguni.opus",
                          frequency=1330)
    _commit(repo, CON_LICENCIA)
    procesar_buzon(
        repo=repo, event={"commits": [{"message": CON_LICENCIA, "added": [first], "modified": [], "removed": []}]},
        actor="ana",
    )
    second = _parts_upload(repo, tmp_path, "123e4567-e89b-12d3-a456-426614174004", "Bad Bunny - DtMF (Letra).opus",
                           artist="iPerol", frequency=1340)
    _commit(repo, CON_LICENCIA)

    procesar_buzon(
        repo=repo, event={"commits": [{"message": CON_LICENCIA, "added": [second], "modified": [], "removed": []}]},
        actor="ana",
    )

    found = {(song["artist"], song["title"]) for song in _catalogo(repo)["songs"]}
    assert ("Bad Bunny", "Yonaguni") in found
    assert ("Bad Bunny", "DtMF") in found


def test_an_existing_song_keeps_its_title_when_uploaded_again(repo):
    name = "Marea - Corazón de mimbre (Official Video).wav"
    make_tone(repo / BUZON / name, seconds=1.0, frequency=620)
    data_before = _catalogo(repo)
    _commit(repo, CON_LICENCIA)
    event = {"commits": [{"message": CON_LICENCIA, "added": [f"{BUZON}/{name}"], "modified": [], "removed": []}]}
    first = procesar_buzon(repo=repo, event=event, actor="ana")
    song_id = first["publicas"][0]["song_id"]
    # A mano, alguien le pone otro título; la misma grabación vuelve a subirse y no se toca.
    data = _catalogo(repo)
    catalog.update_song(data, song_id, {"title": "Corazón de mimbre (versión de la radio)"})
    catalog.save(repo / "audio-library" / "indexes" / "catalog.json", data)
    make_tone(repo / BUZON / name, seconds=1.0, frequency=620)
    _commit(repo, CON_LICENCIA)

    again = procesar_buzon(repo=repo, event=event, actor="ana")

    assert [item["song_id"] for item in again["duplicadas"]] == [song_id]
    song = next(song for song in _catalogo(repo)["songs"] if song["id"] == song_id)
    assert song["title"] == "Corazón de mimbre (versión de la radio)"
    assert len(_catalogo(repo)["songs"]) == len(data_before["songs"]) + 1


# --- Vista previa -----------------------------------------------------------------------------------------------------


def _preview_module():
    spec = importlib.util.spec_from_file_location("vista_previa_titulos", ROOT / "scripts" / "vista_previa_titulos.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_the_preview_lists_before_and_after_and_a_total(tmp_path, capsys):
    data = {"version": 1, "folders": [], "songs": [
        _song("S0000000000000001", "Bad Bunny - DtMF (Letra)"),
        _song("S0000000000000002", "Tema limpio", "Marea"),
    ]}
    path = tmp_path / "catalog.json"
    path.write_text(json.dumps(data), encoding="utf-8")
    snapshot = path.read_text(encoding="utf-8")

    assert _preview_module().main([str(path)]) == 0

    salida = capsys.readouterr().out.splitlines()
    assert salida == [
        "S0000000000000001  [artista, título]",
        "    antes:   (sin artista) | Bad Bunny - DtMF (Letra)",
        "    después: Bad Bunny | DtMF",
        "Total: 1 de 2 canciones cambiarían.",
    ]
    assert path.read_text(encoding="utf-8") == snapshot  # no escribe nada


def test_the_preview_of_the_real_catalog_matches_plan_clean(capsys):
    data = json.loads(REAL_CATALOG.read_text(encoding="utf-8"))
    assert _preview_module().main([]) == 0
    salida = capsys.readouterr().out.splitlines()
    assert salida[-1] == f"Total: {len(titulos.plan_clean(data))} de {len(data['songs'])} canciones cambiarían."


def test_the_preview_rejects_unknown_ids(tmp_path, capsys):
    path = tmp_path / "catalog.json"
    path.write_text(json.dumps({"version": 1, "folders": [], "songs": []}), encoding="utf-8")
    assert _preview_module().main([str(path), "--id", "S0000000000000001"]) == 1
    assert "S0000000000000001" in capsys.readouterr().err
