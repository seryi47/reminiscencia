"""Tests de `scripts/detectar_duplicados.py` (normalización, decisión, informe, fallback MusicBrainz).

Se cargan las funciones del script directamente por ruta, sin depender de que esté en PYTHONPATH.
"""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "detectar_duplicados.py"
_spec = importlib.util.spec_from_file_location("detectar_duplicados", SCRIPT)
assert _spec and _spec.loader
_dup = importlib.util.module_from_spec(_spec)
# Registrar en sys.modules antes de ejecutar: @dataclass en Python 3.14 lo requiere.
sys.modules["detectar_duplicados"] = _dup
_spec.loader.exec_module(_dup)  # type: ignore[union-attr]


def test_normaliza_titulos_a_la_misma_clave():
    """'Averno', 'AVERNO (feat. Xxx)' y 'averno (Ladiëresis' se agrupan bajo el mismo título normalizado."""
    base = _dup.normalize_title("Averno")
    assert _dup.normalize_title("AVERNO (feat. Xxx)") == base
    assert _dup.normalize_title("averno (Ladiëresis") == base
    # Un artista como "Rayden" o "Rayden y Tanxugueiras" comparten mismo artista principal.
    assert _dup.normalize_artist("Rayden") == _dup.normalize_artist("Rayden y Tanxugueiras")


def test_decide_elige_la_mas_cercana_y_marca_delete_cuando_pasa_tolerancia():
    songs = [
        {"id": "s1", "title": "No tengas miedo", "artist": "Rayden", "duration_s": 197},  # 3:17 cerca de 197
        {"id": "s2", "title": "No tengas miedo", "artist": "Rayden", "duration_s": 93},   # 1:33 muy lejos
    ]
    decisions = _dup.decide_group(songs, (197.0, "deezer"))
    kept = [d for d in decisions if d.verdict == "KEEP"]
    deleted = [d for d in decisions if d.verdict == "DELETE"]
    assert len(kept) == 1 and kept[0].song_id == "s1"
    assert len(deleted) == 1 and deleted[0].song_id == "s2"
    assert deleted[0].delta is not None and deleted[0].delta > 100


def test_fallback_a_musicbrainz_si_deezer_no_encuentra(monkeypatch):
    """Si Deezer no devuelve nada, se consulta MusicBrainz y se usa su duración."""
    monkeypatch.setattr(_dup, "query_deezer", lambda a, t: None)
    monkeypatch.setattr(_dup, "query_musicbrainz", lambda a, t: (202.0, "musicbrainz"))
    monkeypatch.setattr(_dup.time, "sleep", lambda *_: None)
    res = _dup.official_duration("Rayden", "Haciéndonos los muertos")
    assert res == (202.0, "musicbrainz")


def test_grupo_sin_referencia_queda_todo_en_review():
    songs = [
        {"id": "a", "title": "Desconocida", "artist": "Anónimo", "duration_s": 180},
        {"id": "b", "title": "Desconocida", "artist": "Anónimo", "duration_s": 240},
    ]
    decisions = _dup.decide_group(songs, None)
    assert {d.verdict for d in decisions} == {"REVIEW"}
    assert all(d.delta is None for d in decisions)


def test_informe_html_valido_y_planes_coherentes(tmp_path):
    songs_grupo_1 = [
        {"id": "s1", "title": "No tengas miedo", "artist": "Rayden", "folder_id": "F1", "duration_s": 197},
        {"id": "s2", "title": "No tengas miedo", "artist": "Rayden", "folder_id": "F1", "duration_s": 93},
    ]
    songs_grupo_2 = [
        {"id": "a1", "title": "Averno", "artist": "Rayden y Tanxugueiras", "folder_id": None, "duration_s": 159},
        {"id": "a2", "title": "averno", "artist": "Rayden", "folder_id": None, "duration_s": 159},
    ]
    groups = [
        _dup.GroupResult(
            key="rayden|no tengas miedo",
            artist_display="Rayden", title_display="No tengas miedo",
            official_duration=197.0, source="deezer",
            decisions=_dup.decide_group(songs_grupo_1, (197.0, "deezer")),
        ),
        _dup.GroupResult(
            key="rayden|averno",
            artist_display="Rayden", title_display="Averno",
            official_duration=159.0, source="deezer",
            decisions=_dup.decide_group(songs_grupo_2, (159.0, "deezer")),
        ),
    ]
    n_del, n_rev, n_keep = _dup.write_report(tmp_path, groups, catalog_version=8)
    informe = (tmp_path / "informe.html").read_text(encoding="utf-8")
    plan = json.loads((tmp_path / "plan-borrado.json").read_text(encoding="utf-8"))

    assert informe.startswith("<!doctype html>")
    assert "<table" in informe and "</html>" in informe
    assert "catálogo v8" in informe
    assert n_del == 1 and n_rev == 1 and n_keep == 2
    assert plan["catalog_version"] == 8
    assert len(plan["items"]) == 1
    assert plan["items"][0]["id"] == "s2"
