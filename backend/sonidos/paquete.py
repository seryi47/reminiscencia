"""Paquete de cambios entre el procesado y la publicación de la biblioteca (ADR-0008, ADR-0010).

El procesado (job 'procesar') no tiene permisos de escritura ni token: ejecuta la petición, deja en un paquete
los ficheros de la biblioteca que cambió (el catálogo y el audio, sin la parte pública) y lo sube como artefacto.
La publicación (job 'publicar') descarga el paquete, lo valida, lo aplica sobre main y regenera la parte pública
(datos de la web y audio publicado) desde el catálogo: no confía en la que pudiera traer el paquete. Validar
significa: el manifiesto parte de la base que está en main, cada ruta es de la biblioteca, cada cambio es un
fichero regular (sin enlaces simbólicos) y el índice de git resultante solo contiene esas rutas.

Estructura del paquete:
  peticion.json, resultado.json   salida de issue_request y ci_library (para responder a la incidencia)
  manifiesto.json                 {"base": sha, "accion": "import"|"organize"|"buzon", "cambios": [{"ruta", "estado"}]}
                                  estado: A (nuevo), M (modificado) o D (borrado)
  cambios/<ruta>                  contenido de cada fichero A o M

La acción 'buzon' (workflow buzon.yml, ADR-0014) es la única que puede borrar archivos de audio-library/buzon/, de
audio-library/buzon/portadas/ y los trozos y manifiestos de audio-library/buzon/.partes/<UUID>/ (ADR-0017), y solo
borrarlos: nunca añadirlos ni cambiarlos. Solo se admiten nombres válidos del buzón (sonidos.buzon.nombre_valido o
sonidos.buzon.ruta_de_partes) y nunca sus ficheros fijos (README.md, .gitkeep).

Portadas (ADR-0016): audio-library/covers/<ID>.jpg (se añade, cambia o borra con el catálogo) y su copia pública,
frontend/web/covers/<ID>.jpg, que la publicación regenera. ID es S o F seguida de 16 hexadecimales; solo .jpg.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path

from sonidos.buzon import BUZON_DIRECTORY, PLACEHOLDERS, PORTADAS_DIRECTORY, nombre_valido, ruta_de_partes
from sonidos.issue_request import ACTIONS as ISSUE_ACTIONS
from sonidos.portadas import COVER_NAME, COVERS_DIRECTORY, WEB_COVERS_DIRECTORY
from sonidos.publish import sync_public

BUZON_ACTION = "buzon"
ACTIONS = (*ISSUE_ACTIONS, BUZON_ACTION)
MANIFEST = "manifiesto.json"
CHANGES_DIR = "cambios"
METADATA_FILES = ("peticion.json", "resultado.json")
# Lo que escribe la biblioteca: el catálogo, el audio y los datos públicos de la web.
CATALOG_FILE = "audio-library/indexes/catalog.json"
ALLOWED_FILES = frozenset({CATALOG_FILE})
SOURCE_AUDIO_DIRECTORY = "audio-library/audio"
WEB_DIRECTORY = "frontend/web"
WEB_AUDIO_DIRECTORY = "frontend/web/audio"
# Solo audio con identificador de canción, y solo los tres datos públicos de la web. Nunca HTML, SVG ni JS:
# la web es estática y se sirve tal cual.
AUDIO_DIRECTORIES = (SOURCE_AUDIO_DIRECTORY, WEB_AUDIO_DIRECTORY)
DATA_DIRECTORY = "frontend/web/data"
DATA_FILES = frozenset({"songs.json", "folders.json", "catalog.json"})
COVER_DIRECTORIES = (COVERS_DIRECTORY, WEB_COVERS_DIRECTORY)
AUDIO_NAME = re.compile(r"S[0-9a-f]{16}\.opus")
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
    if ruta_buzon(ruta):
        return True
    directory, _, name = ruta.rpartition("/")
    if directory in AUDIO_DIRECTORIES:
        return AUDIO_NAME.fullmatch(name) is not None
    if directory in COVER_DIRECTORIES:
        return COVER_NAME.fullmatch(name) is not None
    if directory == DATA_DIRECTORY:
        return name in DATA_FILES
    return False


def ruta_buzon(ruta: object) -> bool:
    """Un archivo directo del buzón o de su carpeta de portadas, con nombre válido, que no sea uno de sus ficheros
    fijos (ADR-0014, ADR-0016), o un trozo o un manifiesto de una subida por trozos (ADR-0017)."""
    if not isinstance(ruta, str):
        return False
    if ruta_de_partes(ruta):
        return True
    directory, _, name = ruta.rpartition("/")
    return directory in (BUZON_DIRECTORY, PORTADAS_DIRECTORY) and name not in PLACEHOLDERS and nombre_valido(name)


def borrado_permitido(ruta: str) -> bool:
    """Un paquete solo puede borrar audio y portadas de la biblioteca (una canción despublicada, una carpeta borrada)
    y, con la acción 'buzon', los archivos ya procesados del buzón. Nunca borra el catálogo ni los datos públicos:
    esos solo se reescriben."""
    if ruta_buzon(ruta):
        return True
    directory, _, name = ruta.rpartition("/")
    if directory in COVER_DIRECTORIES:
        return COVER_NAME.fullmatch(name) is not None
    return directory in AUDIO_DIRECTORIES and AUDIO_NAME.fullmatch(name) is not None


def ruta_derivada(ruta: str) -> bool:
    """La parte pública que sale del catálogo, del audio y de las portadas: los tres datos de la web, el audio
    publicado y las portadas publicadas. El procesado no la empaqueta, y la publicación la regenera con
    sonidos.publish.sync_public (ADR-0010, ADR-0016)."""
    directory, _, name = ruta.rpartition("/")
    if directory == WEB_AUDIO_DIRECTORY:
        return AUDIO_NAME.fullmatch(name) is not None
    if directory == WEB_COVERS_DIRECTORY:
        return COVER_NAME.fullmatch(name) is not None
    return directory == DATA_DIRECTORY and name in DATA_FILES


def head_commit(repo: Path) -> str:
    return _git(repo, "rev-parse", "HEAD").strip()


def package_changes(repo: Path, package: Path, *, action: str, sin_derivados: bool = False) -> dict:
    """Lo que el procesado dejó en el repositorio, en un paquete. Falla si cambió una ruta fuera de la biblioteca
    o un elemento que no es un fichero regular (un enlace simbólico, por ejemplo). Con 'sin_derivados', deja fuera
    la parte pública (ver package_processing_changes)."""
    if action not in ACTIONS:
        raise PaqueteError("acción no admitida al empaquetar")
    head = head_commit(repo)
    changes = []
    for code, path in _status_entries(repo):
        if not ruta_permitida(path):
            if code == "??":
                continue  # restos que no son de la biblioteca (una carpeta de compilación): no se publican
            raise PaqueteError(f"el procesado cambió una ruta no permitida: {path}")
        if sin_derivados and ruta_derivada(path):
            continue  # la parte pública la regenera la publicación desde el catálogo
        if ruta_buzon(path):
            if action != BUZON_ACTION:
                raise PaqueteError(f"solo el buzón puede cambiar el buzón: {path}")
            if "D" not in code:
                raise PaqueteError(f"el procesado solo puede borrar archivos del buzón: {path}")
        if "D" in code:
            if not borrado_permitido(path):
                raise PaqueteError(f"el procesado intentó borrar una ruta protegida: {path}")
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


def package_processing_changes(repo: Path, package: Path, *, action: str) -> dict:
    """Lo que empaqueta el procesado (job 'procesar'): el catálogo y el audio de la biblioteca, sin la parte pública.
    Los datos de la web y el audio publicado salen de esos dos: la publicación los regenera después de aplicar el
    paquete (ADR-0010). Así el paquete no lleva nada que la publicación no vuelva a generar."""
    return package_changes(repo, package, action=action, sin_derivados=True)


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
        if state == "D" and not borrado_permitido(ruta):
            raise PaqueteError(f"borrado no permitido en el paquete: {ruta}")
        if ruta_buzon(ruta) and (state != "D" or action != BUZON_ACTION):
            raise PaqueteError(f"el paquete solo puede borrar archivos del buzón, y solo con la acción buzon: {ruta}")
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


def _apply(package: Path, repo: Path, *, head: str) -> tuple[str, list[Change]]:
    """Valida el paquete y lo copia sobre el checkout de main, dejando en el índice exactamente sus rutas."""
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
    _check_only_expected(repo, paths, "quedan cambios fuera del paquete")
    return action, changes


def apply_package(package: Path, repo: Path, *, head: str) -> dict:
    """Valida el paquete y lo aplica sobre el checkout de main, dejando los cambios en el índice. No confirma
    ni sube: eso lo hace el workflow, después de comprobar que hay algo que guardar."""
    action, changes = _apply(package, repo, head=head)
    return _summary(action, changes)


def publish_package(package: Path, repo: Path, *, head: str) -> dict:
    """Lo que hace el job 'publicar' (ADR-0010): aplica el paquete sobre main y, después, regenera la parte pública
    desde el catálogo ya aplicado. Lo que la regeneración cambia se añade al índice junto con el paquete.
    'regenerados' son los ficheros que la regeneración escribió y el paquete no traía. 'sustituidos_del_paquete'
    son los que el paquete traía y la regeneración ha reemplazado (un paquete forjado o desfasado).
    No confirma ni sube."""
    action, changes = _apply(package, repo, head=head)
    package_paths = {change.path for change in changes}
    if not (repo / CATALOG_FILE).is_file():
        # Sin catálogo, sync_public lo tomaría por vacío y borraría toda la parte pública.
        raise PaqueteError("falta el catálogo en main")
    _refuse_links(
        repo, CATALOG_FILE, DATA_DIRECTORY, WEB_AUDIO_DIRECTORY, SOURCE_AUDIO_DIRECTORY,
        COVERS_DIRECTORY, WEB_COVERS_DIRECTORY,
    )
    before = _public_digests(repo)
    try:
        web = sync_public(
            catalog_path=repo / CATALOG_FILE, audio_dir=repo / SOURCE_AUDIO_DIRECTORY, web_dir=repo / WEB_DIRECTORY,
            covers_dir=repo / COVERS_DIRECTORY,
        )
    except (KeyError, TypeError, AttributeError, ValueError) as error:
        raise PaqueteError(f"el catálogo no se puede regenerar la parte pública: {error!r}") from error
    after = _public_digests(repo)
    changed = {ruta for ruta in before.keys() | after.keys() if before.get(ruta) != after.get(ruta)}
    present = sorted(ruta for ruta in changed if ruta in after)
    gone = sorted(ruta for ruta in changed if ruta not in after)
    if present:
        _git(repo, "add", "--", *present)
    if gone:
        _git(repo, "rm", "-q", "--cached", "--ignore-unmatch", "--", *gone)
    expected = package_paths | changed
    check_index(_git(repo, "diff", "--cached", "--raw", "-z", "--no-renames"), expected)
    _check_only_expected(repo, expected, "quedan cambios fuera de la parte pública")
    summary = _summary(action, changes)
    summary["parte_publica"] = {
        "web": web,
        "regenerados": sorted(changed - package_paths),
        "sustituidos_del_paquete": sorted(changed & package_paths),
    }
    return summary


def _summary(action: str, changes: list[Change]) -> dict:
    added = [change for change in changes if change.state != "D"]
    removed = [change for change in changes if change.state == "D"]
    return {"accion": action, "aplicados": len(added), "eliminados": len(removed)}


def _check_only_expected(repo: Path, expected: set[str], message: str) -> None:
    """Lo que no está en 'expected' no se confirma. Los ficheros sin rastrear que deja el propio proceso (la caché de
    Python, por ejemplo) no son un cambio pendiente, pero un cambio rastreado fuera de lo esperado sí lo es."""
    for code, path in _status_entries(repo):
        if path not in expected and code != "??":
            raise PaqueteError(f"{message}: {path}")


def _public_digests(repo: Path) -> dict[str, str]:
    """Huella de cada fichero de la parte pública del checkout: los datos de la web, el audio y las portadas
    publicados."""
    rutas = [f"{DATA_DIRECTORY}/{name}" for name in sorted(DATA_FILES)]
    audio = repo / WEB_AUDIO_DIRECTORY
    if audio.is_dir():
        rutas += [f"{WEB_AUDIO_DIRECTORY}/{file.name}" for file in sorted(audio.glob("*.opus"))]
    covers = repo / WEB_COVERS_DIRECTORY
    if covers.is_dir():
        rutas += [f"{WEB_COVERS_DIRECTORY}/{file.name}" for file in sorted(covers.glob("*.jpg"))]
    digests = {}
    for ruta in rutas:
        path = repo / ruta
        if path.is_symlink():
            raise PaqueteError(f"enlace simbólico en la parte pública: {ruta}")
        if path.is_file():
            digests[ruta] = _sha256(path)
    return digests


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def _refuse_links(repo: Path, *rutas: str) -> None:
    """La regeneración escribe en estas rutas: ninguna puede ser un enlace simbólico ni estar dentro de uno."""
    for ruta in rutas:
        _no_links_above(repo, ruta)
        if (repo / ruta).is_symlink():
            raise PaqueteError(f"enlace simbólico en la biblioteca: {ruta}")


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
