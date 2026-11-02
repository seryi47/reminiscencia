"""Paquete de cambios entre el procesado y la publicación (ADR-0008, corrección de la ronda 2).

El procesado no tiene permisos de escritura: deja un paquete con los ficheros cambiados. La publicación
valida el paquete (rutas permitidas, sin enlaces simbólicos, base igual a main, índice esperado) y solo
entonces lo aplica. Las pruebas de git usan un repositorio temporal, sin red ni remoto.
"""

import json
import os
import subprocess
from pathlib import Path

import pytest

from sonidos import paquete
from sonidos.paquete import Change, PaqueteError

HEAD_SHA = "0123456789abcdef0123456789abcdef01234567"
SONG = "audio-library/audio/S0123456789abcdef.opus"
CATALOG = "audio-library/indexes/catalog.json"


@pytest.mark.parametrize(
    "ruta",
    [
        SONG,
        CATALOG,
        "frontend/web/audio/S0123456789abcdef.opus",
        "frontend/web/data/songs.json",
        "frontend/web/data/folders.json",
        "frontend/web/data/catalog.json",
    ],
)
def test_allowed_paths_are_the_ones_the_library_writes(ruta):
    assert paquete.ruta_permitida(ruta)


@pytest.mark.parametrize(
    "ruta",
    [
        "",
        "/etc/passwd",
        "../audio-library/audio/x.opus",
        "audio-library/audio/../../scripts/ci_library.py",
        "./audio-library/audio/x.opus",
        "audio-library//x.opus",
        "audio-library/audio/",
        "audio-library/audio/sub/x.opus",
        "audio-library/audio/.oculto.opus",
        "audio-library/audio/x\\y.opus",
        "audio-library/audio/x\ny.opus",
        "audio-library/audio/x\x00.opus",
        "audio-library/indexes/catalog.json.bak",
        "audio-library/indexes/.catalog-tmp.json",
        "audio-library/staging/x.opus",
        "audio-library/audio2/x.opus",
        "frontend/web/app.js",
        "frontend/web/index.html",
        "frontend/web/data-extra/x.json",
        "frontend/web/audio2/x.opus",
        "frontend/web/data",
        ".github/workflows/biblioteca.yml",
        "scripts/ci_library.py",
        "backend/sonidos/publish.py",
        ".git/config",
    ],
)
def test_any_other_path_is_refused(ruta):
    assert not paquete.ruta_permitida(ruta)


def _package(tmp_path, *, files=None, changes=None, base=HEAD_SHA, accion="import"):
    """Paquete de prueba: 'files' son los ficheros de cambios/ y 'changes', el manifiesto (si se pasa)."""
    package = tmp_path / "paquete"
    package.mkdir(parents=True, exist_ok=True)
    for ruta, data in (files or {}).items():
        target = package / "cambios" / ruta
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
    if changes is not None:
        manifest = {"base": base, "accion": accion, "cambios": changes}
        (package / "manifiesto.json").write_text(json.dumps(manifest), encoding="utf-8")
    return package


# --- Manifiesto --------------------------------------------------------------------------------


def test_manifest_is_read_when_its_base_is_the_head_of_main(tmp_path):
    package = _package(tmp_path, changes=[{"ruta": SONG, "estado": "A"}])

    accion, changes = paquete.read_manifest(package, head=HEAD_SHA)

    assert accion == "import"
    assert changes == [Change(SONG, "A")]


def test_package_built_on_another_main_is_refused(tmp_path):
    package = _package(tmp_path, changes=[{"ruta": SONG, "estado": "A"}], base="f" * 40)

    with pytest.raises(PaqueteError, match="main cambió"):
        paquete.read_manifest(package, head=HEAD_SHA)


@pytest.mark.parametrize(
    "entries",
    [
        [{"ruta": "frontend/web/app.js", "estado": "M"}],
        [{"ruta": SONG, "estado": "X"}],
        [{"ruta": SONG, "estado": "A"}, {"ruta": SONG, "estado": "M"}],
        [{"ruta": SONG, "estado": "A", "extra": 1}],
        [CATALOG],
        [{"ruta": "../" + CATALOG, "estado": "M"}],
    ],
)
def test_manifest_entries_must_be_allowed_unique_and_well_formed(tmp_path, entries):
    package = _package(tmp_path, changes=entries)

    with pytest.raises(PaqueteError):
        paquete.read_manifest(package, head=HEAD_SHA)


def test_manifest_action_must_be_import_or_organize(tmp_path):
    package = _package(tmp_path, changes=[], accion="publish")

    with pytest.raises(PaqueteError, match="acción"):
        paquete.read_manifest(package, head=HEAD_SHA)


# --- Estructura del paquete --------------------------------------------------------------------


def test_package_with_exactly_the_declared_files_is_accepted(tmp_path):
    changes = [Change(SONG, "A"), Change(CATALOG, "M")]
    package = _package(tmp_path, files={SONG: b"opus", CATALOG: b"{}"})

    paquete.check_package(package, changes)


def test_symbolic_link_inside_the_package_is_refused(tmp_path):
    package = _package(tmp_path, files={SONG: b"opus"})
    outside = tmp_path / "fuera.txt"
    outside.write_text("no es audio", encoding="utf-8")
    (package / "cambios" / SONG).unlink()
    os.symlink(outside, package / "cambios" / SONG)

    with pytest.raises(PaqueteError, match="enlace simbólico"):
        paquete.check_package(package, [Change(SONG, "A")])


def test_symbolic_link_to_a_directory_inside_the_package_is_refused(tmp_path):
    package = _package(tmp_path)
    (package / "cambios" / "audio-library").mkdir(parents=True)
    os.symlink(tmp_path, package / "cambios" / "audio-library" / "audio")

    with pytest.raises(PaqueteError, match="enlace simbólico"):
        paquete.check_package(package, [])


def test_file_that_was_not_declared_is_refused(tmp_path):
    package = _package(tmp_path, files={SONG: b"opus", "frontend/web/data/extra.json": b"{}"})

    with pytest.raises(PaqueteError, match="no esperado"):
        paquete.check_package(package, [Change(SONG, "A")])


def test_declared_file_that_is_missing_is_refused(tmp_path):
    package = _package(tmp_path)

    with pytest.raises(PaqueteError, match="falta"):
        paquete.check_package(package, [Change(SONG, "A")])


def test_deleted_path_must_not_carry_a_file(tmp_path):
    package = _package(tmp_path, files={SONG: b"opus"})

    with pytest.raises(PaqueteError, match="no esperado"):
        paquete.check_package(package, [Change(SONG, "D")])


def test_unexpected_entry_at_the_top_of_the_package_is_refused(tmp_path):
    package = _package(tmp_path)
    (package / "evil.sh").write_text("echo", encoding="utf-8")

    with pytest.raises(PaqueteError, match="no esperado"):
        paquete.check_package(package, [])


# --- Índice de git -----------------------------------------------------------------------------


def test_index_with_only_expected_regular_files_is_accepted():
    raw = (
        ":000000 100644 0000000 1111111 A\x00" + SONG + "\x00"
        + ":100644 100644 aaaaaaa bbbbbbb M\x00" + CATALOG + "\x00"
    )

    assert paquete.check_index(raw, {SONG, CATALOG}) == {SONG, CATALOG}


def test_index_entry_with_symbolic_link_mode_is_refused():
    raw = ":000000 120000 0000000 1111111 A\x00" + SONG + "\x00"

    with pytest.raises(PaqueteError, match="modo"):
        paquete.check_index(raw, {SONG})


def test_index_entry_outside_the_package_is_refused():
    raw = ":100644 100644 aaaaaaa bbbbbbb M\x00frontend/web/app.js\x00"

    with pytest.raises(PaqueteError, match="no esperado"):
        paquete.check_index(raw, {SONG})


# --- Git real: procesado y publicación en un repositorio temporal ------------------------------


def _git(repo: Path, *args: str) -> None:
    subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True, text=True)


def _git_output(repo: Path, *args: str) -> str:
    return subprocess.run(
        ["git", "-C", str(repo), *args], check=True, capture_output=True, text=True,
    ).stdout


@pytest.fixture
def library_repo(tmp_path):
    """Repositorio con la forma de la biblioteca y un commit inicial. Sin remoto."""
    repo = tmp_path / "repo"
    for folder in ("audio-library/indexes", "audio-library/audio", "frontend/web/audio", "frontend/web/data"):
        (repo / folder).mkdir(parents=True)
    (repo / "frontend" / "web" / "app.js").write_text("// app\n", encoding="utf-8")
    (repo / CATALOG).write_text("{}\n", encoding="utf-8")
    (repo / SONG).write_bytes(b"uno")
    (repo / "frontend" / "web" / "audio" / "S0123456789abcdef.opus").write_bytes(b"uno")
    (repo / "frontend" / "web" / "data" / "songs.json").write_text("[]\n", encoding="utf-8")
    _git(repo, "init", "-q")
    _git(repo, "add", "-A")
    _git(repo, "-c", "user.name=prueba", "-c", "user.email=prueba@example.invalid", "commit", "-q", "-m", "inicial")
    return repo


def _change_like_the_processing_job(repo: Path) -> None:
    (repo / CATALOG).write_text('{"songs": 1}\n', encoding="utf-8")
    (repo / "audio-library" / "audio" / "S1111111111111111.opus").write_bytes(b"dos")
    (repo / "frontend" / "web" / "audio" / "S0123456789abcdef.opus").unlink()
    (repo / "frontend" / "web" / "data" / "songs.json").write_text('[{"id": "S1"}]\n', encoding="utf-8")


def test_package_from_processing_is_applied_to_a_clean_checkout_of_main(library_repo, tmp_path):
    head = paquete.head_commit(library_repo)
    _change_like_the_processing_job(library_repo)
    package = tmp_path / "paquete"

    summary = paquete.package_changes(library_repo, package, action="import")
    assert summary == {"accion": "import", "cambios": 4}

    # Publicación: un checkout limpio de main, sin más cambios que los del paquete.
    _git(library_repo, "checkout", "-q", "--", ".")
    _git(library_repo, "clean", "-fdq")
    result = paquete.apply_package(package, library_repo, head=head)

    assert result == {"accion": "import", "aplicados": 3, "eliminados": 1}
    staged = _git_output(library_repo, "diff", "--cached", "--name-status")
    assert f"M\t{CATALOG}" in staged
    assert "A\taudio-library/audio/S1111111111111111.opus" in staged
    assert "D\tfrontend/web/audio/S0123456789abcdef.opus" in staged
    assert "M\tfrontend/web/data/songs.json" in staged
    assert "app.js" not in staged


def test_processing_refuses_a_symbolic_link_it_would_have_to_publish(library_repo, tmp_path):
    (library_repo / "audio-library" / "audio" / "S2222222222222222.opus").symlink_to(
        library_repo / "frontend" / "web" / "app.js"
    )

    with pytest.raises(PaqueteError, match="fichero regular"):
        paquete.package_changes(library_repo, tmp_path / "paquete", action="import")


def test_processing_refuses_to_package_a_change_outside_the_library(library_repo, tmp_path):
    (library_repo / "frontend" / "web" / "app.js").write_text("// alterado\n", encoding="utf-8")

    with pytest.raises(PaqueteError, match="no permitida"):
        paquete.package_changes(library_repo, tmp_path / "paquete", action="import")


def test_publishing_refuses_a_path_outside_the_library_and_touches_nothing(library_repo, tmp_path):
    head = paquete.head_commit(library_repo)
    package = _package(
        tmp_path,
        files={"frontend/web/app.js": b"// malicioso\n"},
        changes=[{"ruta": "frontend/web/app.js", "estado": "M"}],
        base=head,
    )

    with pytest.raises(PaqueteError):
        paquete.apply_package(package, library_repo, head=head)

    assert _git_output(library_repo, "diff", "--cached", "--name-only") == ""
    assert (library_repo / "frontend" / "web" / "app.js").read_text(encoding="utf-8") == "// app\n"


def test_publishing_refuses_a_symbolic_link_before_touching_main(library_repo, tmp_path):
    head = paquete.head_commit(library_repo)
    package = _package(tmp_path, changes=[{"ruta": SONG, "estado": "A"}], base=head)
    (package / "cambios" / SONG).parent.mkdir(parents=True, exist_ok=True)
    os.symlink(library_repo / "frontend" / "web" / "app.js", package / "cambios" / SONG)

    with pytest.raises(PaqueteError, match="enlace simbólico"):
        paquete.apply_package(package, library_repo, head=head)

    assert _git_output(library_repo, "status", "--porcelain") == ""
    assert not (library_repo / "audio-library" / "audio" / "S1111111111111111.opus").exists()


def test_untracked_build_leftovers_outside_the_library_are_not_packaged(library_repo, tmp_path):
    # 'pip install -e backend' puede dejar una carpeta de compilación sin rastrear: no es un cambio de la biblioteca.
    (library_repo / "backend" / "build").mkdir(parents=True)
    (library_repo / "backend" / "build" / "x.py").write_text("x\n", encoding="utf-8")

    summary = paquete.package_changes(library_repo, tmp_path / "paquete", action="import")

    assert summary == {"accion": "import", "cambios": 0}


def test_untracked_files_left_by_publishing_are_not_committed_nor_refused(library_repo, tmp_path):
    head = paquete.head_commit(library_repo)
    _change_like_the_processing_job(library_repo)
    package = tmp_path / "paquete"
    paquete.package_changes(library_repo, package, action="import")
    _git(library_repo, "checkout", "-q", "--", ".")
    _git(library_repo, "clean", "-fdq")
    (library_repo / "backend" / "sonidos.egg-info").mkdir(parents=True)
    (library_repo / "backend" / "sonidos.egg-info" / "PKG-INFO").write_text("x\n", encoding="utf-8")

    result = paquete.apply_package(package, library_repo, head=head)

    assert result["aplicados"] == 3
    assert "egg-info" not in _git_output(library_repo, "diff", "--cached", "--name-only")
