import importlib.util
import json
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
OK = {"preparar": "success", "aplicar": "success", "guardar": "success"}


@pytest.fixture
def responder():
    spec = importlib.util.spec_from_file_location("responder_under_test", ROOT / "scripts" / "responder_incidencia.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_success_is_ok_and_describes_the_import(responder):
    peticion = {"action": "import", "url": "https://archive.org/details/x"}
    resultado = {"song_id": "S0123456789abcdef", "created": True, "web": {"public": 9, "folders": 0}}

    ok, body = responder.evaluate(peticion, resultado, OK)

    assert ok is True
    assert "Canción S0123456789abcdef: añadida al catálogo." in body
    assert "9 canciones publicadas" in body


def test_import_of_known_content_says_it_was_already_there(responder):
    ok, body = responder.evaluate({"action": "import"}, {"song_id": "S0123456789abcdef", "created": False}, OK)

    assert ok is True and "ya estaba en el catálogo" in body


def test_refused_request_reports_the_reason(responder):
    estados = {"preparar": "failure", "aplicar": "skipped", "guardar": "skipped"}

    ok, body = responder.evaluate({"error": "import necesita la clave url"}, None, estados)

    assert ok is False
    assert "Motivo: import necesita la clave url" in body
    assert "etiqueta `error`" in body


def test_failed_apply_reports_the_error_of_the_result(responder):
    estados = {"preparar": "success", "aplicar": "failure", "guardar": "skipped"}

    ok, body = responder.evaluate({"action": "organize", "op": "edit_song"},
                                  {"error": "no existe la canción S0123456789abcdef"}, estados)

    assert ok is False
    assert "no existe la canción S0123456789abcdef" in body


def test_failed_push_is_an_error_even_if_apply_worked(responder):
    estados = {"preparar": "success", "aplicar": "success", "guardar": "failure"}

    ok, body = responder.evaluate({"action": "organize"}, {"folder": {"name": "Jazz"}}, estados)

    assert ok is False
    assert "no se pudieron guardar los cambios" in body


def test_no_changes_to_save_still_counts_as_success(responder):
    ok, _ = responder.evaluate({"action": "organize", "op": "delete_folder"}, {"deleted": "0123456789"}, OK)

    assert ok is True


def test_main_writes_the_body_file_and_prints_the_decision(responder, tmp_path, monkeypatch, capsys):
    peticion = tmp_path / "peticion.json"
    peticion.write_text(json.dumps({"error": "clave desconocida: comentario"}), encoding="utf-8")
    cuerpo = tmp_path / "comentario.md"
    monkeypatch.setenv("ESTADO_PREPARAR", "failure")
    monkeypatch.setenv("ESTADO_APLICAR", "skipped")
    monkeypatch.setenv("ESTADO_GUARDAR", "skipped")

    code = responder.main(["--peticion", str(peticion), "--resultado", str(tmp_path / "no-existe.json"), "--cuerpo", str(cuerpo)])

    assert code == 0
    assert capsys.readouterr().out.strip() == "error"
    assert "Motivo: clave desconocida: comentario" in cuerpo.read_text(encoding="utf-8")


def test_main_prints_ok_when_every_step_succeeded(responder, tmp_path, monkeypatch, capsys):
    peticion = tmp_path / "peticion.json"
    peticion.write_text(json.dumps({"action": "organize", "op": "edit_song"}), encoding="utf-8")
    resultado = tmp_path / "resultado.json"
    resultado.write_text(json.dumps({"song": {"id": "S0123456789abcdef"}, "web": {"public": 1, "folders": 0}}), encoding="utf-8")
    cuerpo = tmp_path / "comentario.md"
    for name in ("PREPARAR", "APLICAR", "GUARDAR"):
        monkeypatch.setenv(f"ESTADO_{name}", "success")

    code = responder.main(["--peticion", str(peticion), "--resultado", str(resultado), "--cuerpo", str(cuerpo)])

    assert code == 0
    assert capsys.readouterr().out.strip() == "ok"
    assert "La incidencia se cierra." in cuerpo.read_text(encoding="utf-8")
