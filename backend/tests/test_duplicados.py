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


# --- Aviso en el buzón ------------------------------------------------------------------------------------------------


def _git(repo: Path, *args: str) -> None:
    subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True, text=True)


@pytest.fixture
def repo(main_publicado: Path) -> Path:
    """main con «Tema público» (5 s, en el álbum «Jazz») y el buzón."""
    (main_publicado / BUZON).mkdir(parents=True)
    (main_publicado / BUZON / "README.md").write_text("buzón\n", encoding="utf-8")
    _git(main_publicado, "add", "-A")
    _git(main_publicado, "-c", "user.name=p", "-c", "user.email=p@example.invalid", "commit", "-q", "-m", "buzón")
    return main_publicado


def _subir(repo: Path, name: str, *, seconds: float, frequency: int) -> str:
    make_tone(repo / BUZON / name, seconds=seconds, frequency=frequency)
    return f"{BUZON}/{name}"


def _evento(paths: list[str]) -> dict:
    return {"commits": [{"message": CON_LICENCIA, "added": paths, "modified": [], "removed": []}]}


def test_buzon_warns_about_possible_duplicates_without_blocking(repo):
    paths = [
        _subir(repo, "Tema publico (Official Video).wav", seconds=5.0, frequency=500),   # como la del catálogo
        _subir(repo, "Tema público.wav", seconds=9.0, frequency=520),                     # mismo título, 4 s más
        _subir(repo, "Nueva.wav", seconds=3.0, frequency=600),
        _subir(repo, "Nueva [HD].wav", seconds=3.0, frequency=700),                      # repetida en la tanda
    ]

    result = procesar_buzon(repo=repo, event=_evento(paths), actor="seryi47")

    assert len(result["publicas"]) == 4  # no se bloquea ninguna
    avisos = {item["archivo"]: item for item in result["posibles_duplicados"]}
    # Se procesan por orden de nombre: «Nueva [HD].wav» entra antes que «Nueva.wav», que es la que avisa.
    assert set(avisos) == {"Tema publico (Official Video).wav", "Nueva.wav"}
    assert avisos["Tema publico (Official Video).wav"]["parecida_a"] == SONG_ID
    assert avisos["Tema publico (Official Video).wav"]["titulo_parecida"] == "Tema público"
    assert avisos["Tema publico (Official Video).wav"]["duracion_parecida"] == "0:05"
    primera = next(item for item in result["publicas"] if item["archivo"] == "Nueva [HD].wav")
    assert avisos["Nueva.wav"]["parecida_a"] == primera["song_id"]

    resumen = resumen_markdown(result)
    assert "### Posibles duplicados (se han añadido igualmente; revisa si sobran)" in resumen
    assert f'"Nueva.wav" -> {avisos["Nueva.wav"]["song_id"]} · parece "Nueva [HD]"' in resumen


def test_an_identical_file_is_still_reported_as_already_there_not_as_a_possible_duplicate(repo):
    first = _subir(repo, "Una.wav", seconds=2.0, frequency=800)
    procesar_buzon(repo=repo, event=_evento([first]), actor="seryi47")
    again = _subir(repo, "Una.wav", seconds=2.0, frequency=800)

    result = procesar_buzon(repo=repo, event=_evento([again]), actor="seryi47")

    assert len(result["duplicadas"]) == 1
    assert result["posibles_duplicados"] == []
    assert "Posibles duplicados" not in resumen_markdown(result)


def test_the_buzon_script_prints_a_github_warning(repo, tmp_path, capsys):
    spec = importlib.util.spec_from_file_location("buzon_script_test", ROOT / "scripts" / "buzon.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    path = _subir(repo, "Tema público (Letra).wav", seconds=5.0, frequency=900)
    event = tmp_path / "evento.json"
    event.write_text(json.dumps(_evento([path])), encoding="utf-8")

    code = module.main([], env={"GITHUB_EVENT_PATH": str(event), "ACTOR": "seryi47"}, root=repo)

    assert code == 0
    out = capsys.readouterr().out
    assert "::warning title=Buzón::1 canción(es) nueva(s) parecen estar ya en la biblioteca" in out
    # El nombre del archivo no va al comando de GitHub Actions (solo al resumen escapado).
    assert "Letra" not in out.split("::warning", 1)[1].split("\n", 1)[0]


def test_the_buzon_migrates_old_catalogs_to_track_numbers(repo):
    data = json.loads((repo / CATALOG).read_text(encoding="utf-8"))
    for song in data["songs"]:
        song.pop("track", None)
    (repo / CATALOG).write_text(json.dumps(data), encoding="utf-8")
    path = _subir(repo, "Otra.wav", seconds=1.0, frequency=1000)

    procesar_buzon(repo=repo, event=_evento([path]), actor="seryi47")

    saved = catalog.load(repo / CATALOG)
    assert next(song for song in saved["songs"] if song["id"] == SONG_ID)["track"] == 1
    published = json.loads((repo / "frontend/web/data/songs.json").read_text(encoding="utf-8"))
    assert next(song for song in published if song["id"] == SONG_ID)["track"] == 1
