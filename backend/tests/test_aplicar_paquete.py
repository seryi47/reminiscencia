"""Job 'publicar' de biblioteca.yml (ADR-0010): scripts/aplicar_paquete.py valida y aplica el paquete sobre main, y
regenera la parte pública desde el catálogo antes de que el workflow confirme. Se ejecuta el script tal como lo
ejecuta el workflow, sobre un repositorio temporal con git real y sin remoto."""

import importlib.util
import json
import subprocess
from pathlib import Path

import pytest

from sonidos import catalog, paquete

ROOT = Path(__file__).resolve().parents[2]
CATALOG = "audio-library/indexes/catalog.json"
SONGS_JSON = "frontend/web/data/songs.json"
FORGED_TITLE = "<img src=x onerror=alert(1)>"


@pytest.fixture
def aplicar(monkeypatch):
    monkeypatch.delenv("GITHUB_ENV", raising=False)
    spec = importlib.util.spec_from_file_location("aplicar_paquete_under_test", ROOT / "scripts" / "aplicar_paquete.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _paquete(tmp_path: Path, *, files: dict, changes: list, base: str) -> Path:
    package = tmp_path / "paquete"
    for ruta, data in files.items():
        target = package / "cambios" / ruta
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
    manifest = {"base": base, "accion": "import", "cambios": changes}
    (package / "manifiesto.json").write_text(json.dumps(manifest), encoding="utf-8")
    return package


def _indice(repo: Path, ruta: str) -> bytes:
    return subprocess.run(["git", "-C", str(repo), "show", f":{ruta}"], check=True, capture_output=True).stdout


def _ultima_linea(salida: str) -> dict:
    return json.loads(salida.strip().splitlines()[-1])


def test_publicar_no_deja_publicado_un_songs_json_forjado(main_publicado, tmp_path, aplicar, capsys):
    repo = main_publicado
    legitimo = _indice(repo, SONGS_JSON)
    forjado = json.dumps([{"id": "Sabababababababab", "title": FORGED_TITLE}]).encode("utf-8")
    package = _paquete(
        tmp_path, files={SONGS_JSON: forjado}, changes=[{"ruta": SONGS_JSON, "estado": "M"}],
        base=paquete.head_commit(repo),
    )

    assert aplicar.main(["--paquete", str(package), "--raiz", str(repo)]) == 0

    publicado = _indice(repo, SONGS_JSON)
    assert publicado == legitimo
    assert FORGED_TITLE.encode("utf-8") not in publicado
    salida = capsys.readouterr().out
    assert "::warning" in salida and SONGS_JSON in salida


def test_publicar_avisa_de_lo_que_regenera_aunque_el_paquete_no_lo_traiga(main_publicado, tmp_path, aplicar, capsys):
    repo = main_publicado
    audio_nuevo = b"opus-nuevo"
    data = catalog.load(repo / CATALOG)
    nueva, _ = catalog.add_song(
        data, sha256="cd" * 32, title="Tema nuevo", license="CC0 1.0",
        source="direct-url:ejemplo.com/n.mp3", codec="opus", duration_s=5.0, size_bytes=len(audio_nuevo),
    )
    catalog.update_song(data, nueva["id"], {"public": True, "folder_id": data["folders"][0]["id"]})
    catalogo = tmp_path / "catalogo.json"
    catalog.save(catalogo, data)
    ruta_audio = f"audio-library/audio/{nueva['id']}.opus"
    package = _paquete(
        tmp_path,
        files={CATALOG: catalogo.read_bytes(), ruta_audio: audio_nuevo},
        changes=[{"ruta": CATALOG, "estado": "M"}, {"ruta": ruta_audio, "estado": "A"}],
        base=paquete.head_commit(repo),
    )

    assert aplicar.main(["--paquete", str(package), "--raiz", str(repo)]) == 0

    salida = capsys.readouterr().out
    assert "::notice" in salida and "::warning" not in salida
    # El audio público ya no se copia a la web: lo sirve R2 (ADR-0020, fase 3).
    assert set(_ultima_linea(salida)["parte_publica"]["regenerados"]) == {
        SONGS_JSON, "frontend/web/data/catalog.json",
    }
    assert not (repo / "frontend/web/audio" / f"{nueva['id']}.opus").exists()
    assert b"Tema nuevo" in _indice(repo, SONGS_JSON)


def _commit_ajeno(repo: Path, ruta: str, data: bytes) -> str:
    (repo / ruta).parent.mkdir(parents=True, exist_ok=True)
    (repo / ruta).write_bytes(data)
    for args in (("add", "--", ruta), ("-c", "user.name=web", "-c", "user.email=web@example.invalid", "commit", "-qm", "x")):
        subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True)
    return paquete.head_commit(repo)


def _paquete_de_titulo(repo: Path, tmp_path: Path) -> Path:
    data = catalog.load(repo / CATALOG)
    data["songs"][0]["title"] = "Tema retitulado"
    catalogo = tmp_path / "catalogo.json"
    catalog.save(catalogo, data)
    return _paquete(
        tmp_path, files={CATALOG: catalogo.read_bytes()}, changes=[{"ruta": CATALOG, "estado": "M"}],
        base=paquete.head_commit(repo),
    )


def test_publicar_aplica_sobre_main_si_entre_medias_solo_llegaron_trozos_de_una_subida(
    main_publicado, tmp_path, aplicar, capsys, monkeypatch,
):
    # ADR-0025: el fallo real era un trozo de /api/subir en audio-library/buzon/.partes/ entre procesar y publicar.
    repo = main_publicado
    package = _paquete_de_titulo(repo, tmp_path)
    head = _commit_ajeno(repo, "audio-library/buzon/.partes/0f8fad5b-d9cb-469f-a165-70867728950e/0.part", b"trozo")
    entorno = tmp_path / "github_env"
    monkeypatch.setenv("GITHUB_ENV", str(entorno))

    assert aplicar.main(["--paquete", str(package), "--raiz", str(repo)]) == 0

    assert b"Tema retitulado" in _indice(repo, SONGS_JSON)
    assert f"BASE={head}" in entorno.read_text(encoding="utf-8")


def test_publicar_se_detiene_si_entre_medias_cambio_el_catalogo(main_publicado, tmp_path, aplicar, capsys):
    repo = main_publicado
    package = _paquete_de_titulo(repo, tmp_path)
    _commit_ajeno(repo, CATALOG, (repo / CATALOG).read_bytes() + b"\n")

    assert aplicar.main(["--paquete", str(package), "--raiz", str(repo)]) == 1
    error = json.loads(capsys.readouterr().out)["error"]
    assert "main cambió" in error and CATALOG in error


def test_aplicar_no_mira_el_audio_lo_comprueba_sync_r2(main_publicado, tmp_path, aplicar, capsys):
    # ADR-0024: el audio de la biblioteca está en el bucket privado; aplicar_paquete no lo tiene en la copia local. La
    # parada por falta de audio de una canción pública la hace scripts/sync_r2.py antes del push (test_r2.py).
    repo = main_publicado
    data = catalog.load(repo / CATALOG)
    nueva, _ = catalog.add_song(
        data, sha256="ef" * 32, title="Sin audio", license="CC0 1.0",
        source="direct-url:ejemplo.com/s.mp3", codec="opus", duration_s=5.0, size_bytes=3,
    )
    catalog.update_song(data, nueva["id"], {"public": True, "folder_id": data["folders"][0]["id"]})
    catalogo = tmp_path / "catalogo.json"
    catalog.save(catalogo, data)
    package = _paquete(
        tmp_path, files={CATALOG: catalogo.read_bytes()}, changes=[{"ruta": CATALOG, "estado": "M"}],
        base=paquete.head_commit(repo),
    )

    assert aplicar.main(["--paquete", str(package), "--raiz", str(repo)]) == 0
    assert b"Sin audio" in _indice(repo, SONGS_JSON)
