"""El paso «Subir a main» de 'publicar' (buzon.yml y biblioteca.yml; ADR-0025), ejecutado de verdad con bash y git
contra un remoto local: si main avanzó sin tocar la biblioteca, rebasa el commit encima y lo sube; si lo nuevo de main
toca lo que la publicación lee o regenera, o lo que cambia el propio commit, o el rebase choca, no sube nada."""

import os
import subprocess
from pathlib import Path

import pytest

from test_biblioteca_workflow import _steps

ROOT = Path(__file__).resolve().parents[2]
WORKFLOWS = ROOT / ".github" / "workflows"
CATALOG = "audio-library/indexes/catalog.json"
REMOTE_LINE = 'REMOTO="https://x-access-token:${GH_TOKEN}@github.com/${GITHUB_REPOSITORY}.git"'


def _git(repo: Path, *args: str) -> str:
    return subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True, text=True).stdout.strip()


def _commit(repo: Path, files: dict[str, str], message: str) -> str:
    for ruta, text in files.items():
        (repo / ruta).parent.mkdir(parents=True, exist_ok=True)
        (repo / ruta).write_text(text, encoding="utf-8")
    _git(repo, "add", "-A")
    _git(repo, "-c", "user.name=p", "-c", "user.email=p@example.invalid", "commit", "-qm", message)
    return _git(repo, "rev-parse", "HEAD")


def _push_script(workflow: str) -> str:
    """El bloque run: del paso, con el remoto de GitHub cambiado por el remoto local de la prueba."""
    step = next(step for step in _steps((WORKFLOWS / workflow).read_text(encoding="utf-8")) if "git push" in step)
    lines = step.split("run: |\n", 1)[1].splitlines()
    script = "\n".join(line[10:] if line.startswith(" " * 10) else line for line in lines)
    assert REMOTE_LINE in script
    return script.replace(REMOTE_LINE, 'REMOTO="$REMOTO_PRUEBA"')


@pytest.fixture
def remoto(tmp_path: Path) -> dict[str, Path]:
    """Un remoto con main, la copia de 'publicar' (con su commit encima de BASE) y otra copia para los cambios ajenos."""
    bare = tmp_path / "remoto.git"
    subprocess.run(["git", "init", "-q", "--bare", "-b", "main", str(bare)], check=True)
    semilla = tmp_path / "semilla"
    subprocess.run(["git", "clone", "-q", str(bare), str(semilla)], check=True, capture_output=True)
    _git(semilla, "checkout", "-q", "-b", "main")
    _commit(semilla, {CATALOG: '{"songs": []}\n', "audio-library/buzon/Vals.mp3": "audio\n", "README.md": "x\n"}, "main")
    _git(semilla, "push", "-q", "origin", "main")
    publicar = tmp_path / "publicar"
    otra = tmp_path / "otra"
    # 'publicar' es un clon parcial, como el checkout del job (fetch-depth: 0 y filter: blob:none).
    _git(bare, "config", "uploadpack.allowFilter", "true")
    subprocess.run(["git", "clone", "-q", "-b", "main", "--filter=blob:none", bare.as_uri(), str(publicar)],
                   check=True, capture_output=True)
    assert _git(publicar, "config", "remote.origin.promisor") == "true"
    subprocess.run(["git", "clone", "-q", "-b", "main", str(bare), str(otra)], check=True, capture_output=True)
    for key, value in (("user.name", "github-actions[bot]"), ("user.email", "bot@example.invalid")):
        _git(publicar, "config", key, value)
    return {"bare": bare, "publicar": publicar, "otra": otra}


def _run(workflow: str, repos: dict[str, Path], base: str, tmp_path: Path) -> subprocess.CompletedProcess:
    env = {
        **os.environ, "GITHUB_REF_NAME": "main", "BASE": base, "GH_TOKEN": "token-de-prueba",
        "GITHUB_REPOSITORY": "seryi47/reminiscencia", "GITHUB_STEP_SUMMARY": str(tmp_path / "resumen.md"),
        "REMOTO_PRUEBA": str(repos["bare"]),
    }
    return subprocess.run(["bash", "--noprofile", "--norc", "-eo", "pipefail", "-c", _push_script(workflow)],
                          cwd=repos["publicar"], env=env, capture_output=True, text=True)


def _publish_commit(repos: dict[str, Path]) -> str:
    """Lo que deja 'Confirmar cambios': el catálogo nuevo y el archivo del buzón borrado, encima de BASE."""
    base = _git(repos["publicar"], "rev-parse", "HEAD")
    (repos["publicar"] / "audio-library/buzon/Vals.mp3").unlink()
    _commit(repos["publicar"], {CATALOG: '{"songs": ["Vals"]}\n'}, "buzón: canciones")
    return base


@pytest.mark.parametrize("workflow", ["buzon.yml", "biblioteca.yml"])
def test_pushes_directly_when_main_did_not_move(remoto, tmp_path, workflow):
    base = _publish_commit(remoto)
    result = _run(workflow, remoto, base, tmp_path)
    assert result.returncode == 0, result.stderr
    assert _git(remoto["bare"], "rev-parse", "main") == _git(remoto["publicar"], "rev-parse", "HEAD")


@pytest.mark.parametrize("workflow", ["buzon.yml", "biblioteca.yml"])
def test_a_commit_that_only_adds_upload_parts_is_rebased_over_and_both_stay_in_main(remoto, tmp_path, workflow):
    base = _publish_commit(remoto)
    ajeno = _commit(remoto["otra"], {"audio-library/buzon/.partes/0f8fad5b-d9cb-469f-a165-70867728950e/0.part": "t\n"},
                    "Subida desde la web: Vals (trozo 1 de 2)")
    _git(remoto["otra"], "push", "-q", "origin", "main")

    result = _run(workflow, remoto, base, tmp_path)

    assert result.returncode == 0, result.stderr
    assert "rebasado" in result.stdout
    main = _git(remoto["bare"], "rev-parse", "main")
    assert _git(remoto["bare"], "rev-parse", "main^") == ajeno
    assert _git(remoto["bare"], "show", f"{main}:{CATALOG}") == '{"songs": ["Vals"]}'
    assert "0.part" in _git(remoto["bare"], "ls-tree", "-r", "--name-only", "main")


@pytest.mark.parametrize("ruta", [CATALOG, "frontend/web/data/songs.json", "audio-library/audio/S0123456789abcdef.opus",
                                  "audio-library/buzon/Vals.mp3"])
def test_a_commit_that_touches_the_library_or_the_same_paths_is_not_rebased_over(remoto, tmp_path, ruta):
    base = _publish_commit(remoto)
    _commit(remoto["otra"], {ruta: "cambio ajeno\n"}, "cambio ajeno")
    _git(remoto["otra"], "push", "-q", "origin", "main")
    before = _git(remoto["bare"], "rev-parse", "main")

    result = _run("buzon.yml", remoto, base, tmp_path)

    assert result.returncode == 1
    assert f"toca {ruta}" in result.stderr
    assert _git(remoto["bare"], "rev-parse", "main") == before


def test_a_rewritten_main_is_not_rebased_over(remoto, tmp_path):
    base = _publish_commit(remoto)
    # Con identidad explícita, como el resto: en la CI no hay usuario de git configurado (falló con código 128).
    _git(remoto["otra"], "-c", "user.name=p", "-c", "user.email=p@example.invalid", "commit", "-q", "--amend", "-m", "historia reescrita")
    _git(remoto["otra"], "push", "-q", "--force", "origin", "main")

    result = _run("biblioteca.yml", remoto, base, tmp_path)

    assert result.returncode == 1 and "se ha reescrito" in result.stderr


def test_the_token_is_only_used_in_the_remote_url():
    script = _push_script("buzon.yml")
    assert script.count("GH_TOKEN") == 0  # tras sustituir la URL, nada más usa el token
