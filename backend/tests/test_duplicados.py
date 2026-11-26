"""Regla común de «posible duplicado» (ADR-0026): contrato compartido con la web y la APK
(tests/contrato/duplicados.json) y aviso en el buzón, que nunca bloquea."""

import importlib.util
import json
import subprocess
from pathlib import Path

import pytest

from conftest import SONG_ID, make_tone
from sonidos import catalog, duplicados
from sonidos.buzon import procesar_buzon, resumen_markdown

ROOT = Path(__file__).resolve().parents[2]
CONTRATO = json.loads((ROOT / "tests" / "contrato" / "duplicados.json").read_text(encoding="utf-8"))
CATALOG = "audio-library/indexes/catalog.json"
BUZON = "audio-library/buzon"
CON_LICENCIA = "Add files via upload\n\nLicencia: CC BY 4.0 (grabación propia)"


# --- Contrato común ---------------------------------------------------------------------------------------------------


def test_the_data_of_the_rule_is_exactly_the_shared_contract():
    assert duplicados.TOLERANCE_S == CONTRATO["tolerancia_s"]
    assert duplicados.FOLD_FROM == CONTRATO["pliegue"]["de"]
    assert duplicados.FOLD_TO == CONTRATO["pliegue"]["a"]
    assert len(duplicados.FOLD_FROM) == len(duplicados.FOLD_TO)
    assert list(duplicados.TAGS) == CONTRATO["etiquetas"]
    assert list(duplicados.FEATURING) == CONTRATO["marcas_featuring"]


@pytest.mark.parametrize("case", CONTRATO["normalizar_titulo"], ids=lambda case: case["entrada"])
def test_title_normalization_matches_the_contract(case):
    assert duplicados.normalize_title(case["entrada"]) == case["salida"]


@pytest.mark.parametrize("case", CONTRATO["normalizar_artista"], ids=lambda case: case["entrada"] or "(vacío)")
def test_artist_normalization_matches_the_contract(case):
    assert duplicados.normalize_artist(case["entrada"]) == case["salida"]


@pytest.mark.parametrize("case", CONTRATO["titulo_con_artista"], ids=lambda case: case["entrada"]["title"])
def test_title_with_artist_matches_the_contract(case):
    assert duplicados.title_with_artist(case["entrada"]) == case["salida"]


@pytest.mark.parametrize("case", CONTRATO["casos"], ids=lambda case: case["nota"])
def test_every_contract_case_in_both_directions(case):
    assert duplicados.is_possible_duplicate(case["a"], case["b"]) is case["duplicado"]
    assert duplicados.is_possible_duplicate(case["b"], case["a"]) is case["duplicado"]


def test_odd_values_are_handled_as_missing():
    assert duplicados.normalize_title(None) == ""
    assert duplicados.normalize_artist(12) == ""
    # Una duración que no es un número (o es infinita) cuenta como que falta: decide el artista.
    a = {"title": "Tema", "artist": "X", "duration_s": float("inf")}
    assert duplicados.is_possible_duplicate(a, {"title": "Tema", "artist": "x", "duration_s": True})
    assert not duplicados.is_possible_duplicate(a, {"title": "Tema", "artist": "Y", "duration_s": "200"})


def test_possible_duplicates_skips_the_song_itself():
    songs = [
        {"id": "S1", "title": "Tema", "artist": "", "duration_s": 100.0},
        {"id": "S2", "title": "Tema (Letra)", "artist": "", "duration_s": 101.0},
        {"id": "S3", "title": "Otro", "artist": "", "duration_s": 100.0},
    ]
    assert [song["id"] for song in duplicados.possible_duplicates(songs[0], songs)] == ["S2"]


@pytest.mark.parametrize("seconds, text", [(201.4, "3:21"), (5, "0:05"), (3725, "1:02:05"), (None, "—"), (0, "—")])
def test_format_duration_like_the_web_and_the_apk(seconds, text):
    assert duplicados.format_duration(seconds) == text
