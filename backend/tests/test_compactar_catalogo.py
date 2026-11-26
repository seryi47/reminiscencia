"""Tests del script scripts/compactar_catalogo.py (ADR-0052)."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "scripts"))

import compactar_catalogo as cc  # noqa: E402


def test_elimina_codec_opus_pero_mantiene_el_distinto():
    """El 95 %+ son opus; omitirlo ahorra ~5 KB. Pero si una canción es flac debe conservarse."""
    cat = {
        "version": 1,
        "folders": [],
        "songs": [
            {"id": "S1", "title": "a", "codec": "opus"},
            {"id": "S2", "title": "b", "codec": "flac"},
        ],
    }
    out = cc.compactar_catalogo(cat)
    assert "codec" not in out["songs"][0]
    assert out["songs"][1]["codec"] == "flac"


def test_elimina_size_bytes():
    """size_bytes es derivable del objeto R2 y se puede omitir."""
    cat = {
        "version": 1,
        "folders": [],
        "songs": [{"id": "S1", "title": "a", "size_bytes": 12345}],
    }
    out = cc.compactar_catalogo(cat)
    assert "size_bytes" not in out["songs"][0]


def test_compacta_added_at_a_fecha_si_hora_es_cero():
    """2026-10-31T00:00:00Z se puede guardar como 2026-10-31. Si tiene hora concreta, intacto."""
    cat = {
        "version": 1,
        "folders": [],
        "songs": [
            {"id": "S1", "title": "a", "added_at": "2026-10-31T00:00:00Z"},
            {"id": "S2", "title": "b", "added_at": "2026-10-31T11:19:09+00:00"},
        ],
    }
    out = cc.compactar_catalogo(cat)
    assert out["songs"][0]["added_at"] == "2026-10-31"
    assert out["songs"][1]["added_at"] == "2026-10-31T11:19:09+00:00"


def test_main_escribe_salida_y_reporta_ahorro(tmp_path, capsys):
    """El flujo completo: lee, compacta, escribe, reporta."""
    src = tmp_path / "catalog.json"
    src.write_text(
        json.dumps(
            {
                "version": 1,
                "folders": [],
                "songs": [{"id": "S1", "title": "a", "codec": "opus", "size_bytes": 123}],
            }
        )
    )
    out = tmp_path / "out.json"
    rc = cc.main(["--source", str(src), "--out", str(out)])
    assert rc == 0
    assert out.exists()
    captured = capsys.readouterr().out
    assert "ahorro" in captured
    assert "compactado" in captured


def test_main_source_inexistente_devuelve_1(tmp_path):
    rc = cc.main(["--source", str(tmp_path / "noexiste.json"), "--out", str(tmp_path / "x.json")])
    assert rc == 1
