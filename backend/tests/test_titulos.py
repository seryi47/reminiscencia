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
    assert list(titulos.CHANNEL_WORDS) == CONTRATO["palabras_de_canal"]
    assert list(titulos.CHANNEL_SUFFIXES) == CONTRATO["sufijos_de_canal"]
    assert titulos.CHANNEL_MIN_LETTERS == CONTRATO["min_letras_canal_alfanumerico"]
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


@pytest.mark.parametrize("pair", CONTRATO["parece_canal"], ids=lambda pair: pair[0])
def test_which_artists_look_like_a_youtube_channel(pair):
    name, channel = pair
    assert titulos.looks_like_channel(name) is channel


# Los artistas del catálogo de main (2026-11-06) que parecen un canal, revisados uno a uno. Si el catálogo cambia y
# aparece otro, la prueba lo dice para revisarlo; ninguno de los demás (nombres de persona y de grupo) lo es.
REAL_CHANNELS = {
    "CantoYo Video Lyrics", "CarlinhosX7", "Disney Channel Animation", "Doble Music", "EuskalGazte778",
    "IkonProducciones", "Imagine Dragons FAN", "KapitalMusicTv", "Luxury Life Music", "OmarMontesVEVO",
    "Warner Music Spain Archivos", "YouMoreTv - Espectáculo", "antifa93cat", "gigatr0n", "ra29597",
    "Rich Music LTD",
    # Alias de productor de car music / phonk, estilizados con números (leet): son el nombre real del artista,
    # no un canal (revisados con el usuario el 2026-11-14).
    "DavidK3y", "K3YN0T3",
}


def test_the_channels_of_the_real_catalog_are_the_reviewed_ones():
    data = json.loads(REAL_CATALOG.read_text(encoding="utf-8"))
    artists = {song["artist"] for song in data["songs"] if song.get("artist")}
    artists |= {folder["artist"] for folder in data["folders"] if folder.get("artist")}
    # Subconjunto, no igualdad: al limpiar el catálogo, los canales sustituidos desaparecen.
    assert {artist for artist in artists if titulos.looks_like_channel(artist)} <= REAL_CHANNELS


def test_channel_suffix():
    assert titulos.strip_channel_suffix("OmarMontesVEVO") == "Omar Montes"
    assert titulos.strip_channel_suffix("SFDKVEVO") == "SFDK"
    assert titulos.strip_channel_suffix("SFDK VEVO") == "SFDK"
    assert titulos.strip_channel_suffix("VEVO") == "VEVO"
    assert titulos.strip_channel_suffix("Bad Bunny y SFDKVEVO") == "Bad Bunny y SFDKVEVO"  # varios artistas
    assert titulos.strip_channel_suffix("Marea") == "Marea"


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
        artist = rng.choice([
            "", "Bad Bunny", "iPerol", "ZOO", " x ", "LA", "gigatr0n", "OmarMontesVEVO", "SFDKVEVO", "VEVO",
            "Luxury Music", "KapitalMusicTv",
        ])
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
    # No se exige que haya cambios: tras la limpieza de la incidencia #58 el catálogo de main ya está limpio y el plan
    # puede venir vacío. Lo que se comprueba vale en los dos casos: cambios válidos y una segunda pasada sin nada.
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
