"""Paquete de cambios entre el procesado y la publicación de la biblioteca (ADR-0008).

El procesado (job 'procesar') no tiene permisos de escritura ni token: ejecuta la petición, deja en un paquete
los ficheros que cambió y lo sube como artefacto. La publicación (job 'publicar') descarga el paquete, lo valida
y solo entonces lo aplica sobre main, confirma y sube. Validar significa: el manifiesto parte de la base que
está en main, cada ruta es de la biblioteca, cada cambio es un fichero regular (sin enlaces simbólicos) y el
índice de git resultante solo contiene esas rutas.

Estructura del paquete:
  peticion.json, resultado.json   salida de issue_request y ci_library (para responder a la incidencia)
  manifiesto.json                 {"base": sha, "accion": "import"|"organize", "cambios": [{"ruta", "estado"}]}
                                  estado: A (nuevo), M (modificado) o D (borrado)
  cambios/<ruta>                  contenido de cada fichero A o M
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path

from sonidos.issue_request import ACTIONS

MANIFEST = "manifiesto.json"
CHANGES_DIR = "cambios"
METADATA_FILES = ("peticion.json", "resultado.json")
# Lo que escribe la biblioteca: el catálogo, el audio y los datos públicos de la web.
ALLOWED_FILES = frozenset({"audio-library/indexes/catalog.json"})
ALLOWED_DIRECTORIES = ("audio-library/audio", "frontend/web/audio", "frontend/web/data")
STATES = ("A", "M", "D")
MAX_CHANGES = 2000

_SHA = re.compile(r"[0-9a-f]{40}")
_FILE_NAME = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]*")
_REGULAR_MODES = ("000000", "100644", "100755")


class PaqueteError(ValueError):
    """El paquete o el repositorio no cumplen lo que se espera. El mensaje se publica en la incidencia."""


@dataclass(frozen=True)
class Change:
    path: str
    state: str


def ruta_permitida(ruta: object) -> bool:
    """Solo rutas de la biblioteca: el catálogo, o un fichero directo dentro de audio o de los datos públicos.
    Sin rutas absolutas, sin '..', sin barras invertidas ni caracteres de control, sin subcarpetas ni nombres
    que empiecen por punto."""
    if not isinstance(ruta, str) or not ruta or len(ruta) > 300 or ruta.startswith("/"):
        return False
    if any(ord(char) < 32 or ord(char) == 127 or char == "\\" for char in ruta):
        return False
    if ruta in ALLOWED_FILES:
        return True
    directory, _, name = ruta.rpartition("/")
    return directory in ALLOWED_DIRECTORIES and _FILE_NAME.fullmatch(name) is not None


def head_commit(repo: Path) -> str:
    return _git(repo, "rev-parse", "HEAD").strip()


def package_changes(repo: Path, package: Path, *, action: str) -> dict:
    """Lo que el procesado dejó en el repositorio, en un paquete. Falla si cambió una ruta fuera de la biblioteca
    o un elemento que no es un fichero regular (un enlace simbólico, por ejemplo)."""
    if action not in ACTIONS:
        raise PaqueteError("acción no admitida al empaquetar")
    head = head_commit(repo)
    changes = []
    for code, path in _status_entries(repo):
        if not ruta_permitida(path):
            if code == "??":
                continue  # restos que no son de la biblioteca (una carpeta de compilación): no se publican
            raise PaqueteError(f"el procesado cambió una ruta no permitida: {path}")
        if "D" in code:
            changes.append(Change(path, "D"))
            continue
        source = repo / path
        if source.is_symlink() or not source.is_file():
            raise PaqueteError(f"{path} no es un fichero regular")
        changes.append(Change(path, "A" if code == "??" or "A" in code else "M"))
    if len(changes) > MAX_CHANGES:
        raise PaqueteError("el procesado produjo demasiados cambios para un paquete")

    package.mkdir(parents=True, exist_ok=True)
    for change in changes:
        if change.state != "D":
            target = package / CHANGES_DIR / change.path
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(repo / change.path, target)
    manifest = {
        "base": head,
        "accion": action,
        "cambios": [{"ruta": change.path, "estado": change.state} for change in changes],
    }
    (package / MANIFEST).write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return {"accion": action, "cambios": len(changes)}


def read_manifest(package: Path, *, head: str) -> tuple[str, list[Change]]:
    """Lee y valida el manifiesto: forma exacta, base igual al HEAD de main, acción conocida, rutas de la
    biblioteca sin repetir y estados A, M o D."""
    try:
        data = json.loads((package / MANIFEST).read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise PaqueteError("el paquete no tiene un manifiesto válido") from error
    if not isinstance(data, dict) or set(data) != {"base", "accion", "cambios"}:
        raise PaqueteError("el manifiesto no tiene la forma esperada")
    base = data["base"]
    if not isinstance(base, str) or not _SHA.fullmatch(base):
        raise PaqueteError("el manifiesto no tiene una base válida")
    if base != head:
        raise PaqueteError("main cambió mientras se procesaba la petición; hay que reenviarla")
    action = data["accion"]
    if action not in ACTIONS:
        raise PaqueteError("acción no admitida en el paquete")
    entries = data["cambios"]
    if not isinstance(entries, list) or len(entries) > MAX_CHANGES:
        raise PaqueteError("la lista de cambios del paquete no es válida")
    changes: list[Change] = []
    seen: set[str] = set()
    for entry in entries:
        if not isinstance(entry, dict) or set(entry) != {"ruta", "estado"}:
            raise PaqueteError("un cambio del manifiesto no tiene la forma esperada")
        ruta, state = entry["ruta"], entry["estado"]
        if not ruta_permitida(ruta):
            raise PaqueteError(f"ruta no permitida en el paquete: {ruta!r}")
        if state not in STATES or ruta in seen:
            raise PaqueteError(f"cambio repetido o estado no válido: {ruta}")
        seen.add(ruta)
        changes.append(Change(ruta, state))
    return action, changes


def check_package(package: Path, changes: list[Change]) -> None:
    """El paquete tiene exactamente los ficheros del manifiesto, todos regulares, y nada más."""
    if package.is_symlink() or not package.is_dir():
        raise PaqueteError("el paquete no es una carpeta")
    for entry in package.iterdir():
        if entry.is_symlink():
            raise PaqueteError(f"enlace simbólico en el paquete: {entry.name}")
        if entry.name not in (*METADATA_FILES, MANIFEST, CHANGES_DIR):
            raise PaqueteError(f"elemento no esperado en el paquete: {entry.name}")
        if entry.name in METADATA_FILES and not entry.is_file():
            raise PaqueteError(f"{entry.name} no es un fichero")

    expected = {change.path for change in changes if change.state != "D"}
    found = _files_under(package / CHANGES_DIR)
    extra = found - expected
    if extra:
        raise PaqueteError(f"fichero no esperado en el paquete: {sorted(extra)[0]}")
    missing = expected - found
    if missing:
        raise PaqueteError(f"falta en el paquete un fichero del manifiesto: {sorted(missing)[0]}")
    for change in changes:
        if change.state == "D" and (package / CHANGES_DIR / change.path).exists():
            raise PaqueteError(f"un fichero borrado no puede traer contenido: {change.path}")


def check_index(raw: str, expected: set[str]) -> set[str]:
    """Lee la salida de 'git diff --cached --raw -z --no-renames': solo rutas esperadas y modos de fichero
    regular (un enlace simbólico tiene el modo 120000 y se rechaza)."""
    staged: set[str] = set()
    fields = raw.split("\x00")
    index = 0
    while index < len(fields):
        meta = fields[index]
        index += 1
        if not meta:
            continue
        parts = meta.split(" ")
        if len(parts) != 5 or not parts[0].startswith(":") or index >= len(fields):
            raise PaqueteError("salida de git no reconocida al comprobar el índice")
        new_mode, path = parts[1], fields[index]
        index += 1
        if new_mode not in _REGULAR_MODES:
            raise PaqueteError(f"modo no admitido en el índice para {path}: {new_mode}")
        if path not in expected:
            raise PaqueteError(f"el índice contiene un cambio no esperado: {path}")
        staged.add(path)
    return staged


def apply_package(package: Path, repo: Path, *, head: str) -> dict:
    """Valida el paquete y lo aplica sobre el checkout de main, dejando los cambios en el índice. No confirma
    ni sube: eso lo hace el workflow, después de comprobar que hay algo que guardar."""
    action, changes = read_manifest(package, head=head)
    check_package(package, changes)
    for change in changes:
        _no_links_above(repo, change.path)

    for change in changes:
        target = repo / change.path
        if change.state == "D":
            if target.is_symlink():
                raise PaqueteError(f"enlace simbólico en el repositorio: {change.path}")
            if target.exists():
                target.unlink()
            continue
        if target.is_symlink():
            raise PaqueteError(f"enlace simbólico en el repositorio: {change.path}")
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(package / CHANGES_DIR / change.path, target)

    paths = {change.path for change in changes}
    added = [change.path for change in changes if change.state != "D"]
    removed = [change.path for change in changes if change.state == "D"]
    if added:
        _git(repo, "add", "-A", "--", *added)
    if removed:
        _git(repo, "rm", "-q", "--cached", "--ignore-unmatch", "--", *removed)
    check_index(_git(repo, "diff", "--cached", "--raw", "-z", "--no-renames"), paths)
    for code, path in _status_entries(repo):
        # Lo que no está en el índice no se confirma: los ficheros sin rastrear que deja el propio proceso
        # (la caché de Python, por ejemplo) no son un cambio pendiente.
        if path not in paths and code != "??":
            raise PaqueteError(f"quedan cambios fuera del paquete: {path}")
    return {"accion": action, "aplicados": len(added), "eliminados": len(removed)}


def _status_entries(repo: Path) -> list[tuple[str, str]]:
    raw = _git(repo, "status", "--porcelain=v1", "-z", "--untracked-files=all")
    entries = []
    for record in raw.split("\x00"):
        if not record:
            continue
        code, path = record[:2], record[3:]
        if "R" in code or "C" in code:
            raise PaqueteError("no se admiten cambios de nombre en la biblioteca")
        entries.append((code, path))
    return entries


def _files_under(root: Path) -> set[str]:
    """Rutas relativas de los ficheros bajo 'root'. Un enlace simbólico, sea fichero o carpeta, es un error."""
    if not root.exists() and not root.is_symlink():
        return set()
    if root.is_symlink() or not root.is_dir():
        raise PaqueteError("la carpeta de cambios del paquete no es una carpeta")
    found: set[str] = set()
    for current, dirs, files in os.walk(root, followlinks=False):
        for name in dirs + files:
            link = Path(current) / name
            if link.is_symlink():
                raise PaqueteError(f"enlace simbólico en el paquete: {link.relative_to(root).as_posix()}")
        for name in files:
            found.add((Path(current) / name).relative_to(root).as_posix())
    return found


def _no_links_above(repo: Path, path: str) -> None:
    current = repo
    for part in path.split("/")[:-1]:
        current = current / part
        if current.is_symlink():
            raise PaqueteError(f"enlace simbólico en la ruta {path}")


def _git(repo: Path, *args: str) -> str:
    try:
        result = subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True, text=True)
    except (OSError, subprocess.CalledProcessError) as error:
        detail = (getattr(error, "stderr", "") or "").strip()
        raise PaqueteError(f"git falló ({' '.join(args[:2])}): {detail}") from error
    return result.stdout
