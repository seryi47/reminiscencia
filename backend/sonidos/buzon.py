"""Buzón de subida de canciones (ADR-0014).

Quien tiene permiso de escritura en el repositorio sube audio a audio-library/buzon/ desde la página de subida de
GitHub. El workflow buzon.yml (job 'procesar', sin token) llama a procesar_buzon: convierte cada archivo a Opus con el
perfil de reproducción de la biblioteca, lo añade al catálogo con el nombre del archivo como título y lo borra del
buzón. La publicación (job 'publicar') valida el paquete y regenera la parte pública como en biblioteca.yml.

Qué archivos se procesan: los que añadió o modificó el push que lanzó el workflow (el evento de GitHub, fichero
GITHUB_EVENT_PATH), siempre que sigan en el buzón. Así cada archivo queda a nombre de quien lo subió (github.actor)
aunque dos subidas se encolen, y una licencia se lee del commit que trajo ese archivo.

Licencia: una línea «Licencia: <texto>» en el mensaje del commit. Con ella, la canción entra pública con esa licencia
y fuente «Subida por <cuenta>». Sin ella, entra privada con la licencia LICENSE_UNDECLARED y no se puede publicar
hasta que se declare (subiendo de nuevo el mismo archivo con la línea). Quien sube responde de lo que declara.

Rechazos:
- Se borran del buzón y se anotan: extensión que no es de audio, más de 100 MiB, contenido que ffprobe no lee como
  audio o que ffmpeg no convierte. El archivo sigue en el historial de git.
- Se dejan donde están y se anotan para revisarlos a mano: enlaces simbólicos, carpetas, subcarpetas y nombres con
  caracteres fuera de la lista (rutas, controles, caracteres de formato, punto inicial...). El paquete no puede
  borrarlos (sonidos.paquete solo admite nombres válidos).

Portadas (ADR-0016): audio-library/buzon/portadas/<ID>.<jpg|jpeg|png|webp>, donde ID es el id de una canción
(S + 16 hexadecimales) o de una carpeta (F + 16 hexadecimales) que ya está en el catálogo (o que entra en el mismo
push). Máximo 10 MiB. Se convierte a JPEG de 640×640 (sonidos.portadas) en audio-library/covers/<ID>.jpg, el catálogo
apunta a ella y se borra del buzón. No necesita línea de licencia. Un id que no existe, un nombre que no es un id o
una imagen que no es válida se rechazan y se borran, con el motivo en el resumen. Las canciones se procesan antes que
las portadas.
"""

from __future__ import annotations

import json
import re
import shutil
import unicodedata
from collections.abc import Mapping
from pathlib import Path

from sonidos import catalog
from sonidos.compression import TranscodeError, transcode
from sonidos.hashing import sha256_file
from sonidos.limits import GIT_BLOCK_FILE_BYTES
from sonidos.pipeline import PLAYBACK_PROFILE
from sonidos.portadas import (
    COVERS_DIRECTORY, MAX_UPLOAD_BYTES as MAX_COVER_BYTES, UPLOAD_NAME, PortadaError, convertir_portada, cover_ref,
)
from sonidos.probe import ProbeError, probe
from sonidos.publish import sync_public

BUZON_DIRECTORY = "audio-library/buzon"
PORTADAS_SUBDIRECTORY = "portadas"
PORTADAS_DIRECTORY = f"{BUZON_DIRECTORY}/{PORTADAS_SUBDIRECTORY}"
# Ficheros fijos del buzón: no son subidas y nunca se procesan ni se borran.
PLACEHOLDERS = frozenset({"README.md", ".gitkeep"})
EXTENSIONS = (".wav", ".mp3", ".m4a", ".flac", ".ogg")
MAX_FILE_BYTES = GIT_BLOCK_FILE_BYTES  # 100 MiB: lo que GitHub deja versionar. Desde el navegador, 25 MiB.
MAX_NAME_CHARS = 200
MAX_NAME_BYTES = 255
MAX_TITLE_CHARS = 200
MAX_LICENSE_CHARS = 300
UPLOADED_BY = "Subida por "

# Nombre de una cuenta de GitHub: letras, números y guiones, hasta 39 caracteres.
_ACTOR = re.compile(r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})")
_LICENSE_LINE = re.compile(r"^[ \t]*licencia[ \t]*:(.*)$", re.IGNORECASE | re.MULTILINE)
# Además de letras, marcas y números (cualquier alfabeto), solo esta puntuación. Ni barras, ni controles, ni
# caracteres de formato (bidi, ancho cero), ni comillas dobles, ni separadores distintos del espacio.
_NAME_PUNCTUATION = frozenset(" ._-()[]'’&,!¡¿+#")


class BuzonError(ValueError):
    """El buzón o el evento no tienen la forma esperada. El procesado se detiene sin tocar el catálogo."""


def nombre_valido(name: object) -> bool:
    """Nombre de un archivo directo del buzón: sin rutas, sin punto ni guion iniciales, sin espacio ni punto finales y
    solo con caracteres de _NAME_PUNCTUATION además de letras, marcas y números."""
    if not isinstance(name, str) or not name or len(name) > MAX_NAME_CHARS:
        return False
    if len(name.encode("utf-8", errors="surrogatepass")) > MAX_NAME_BYTES:
        return False
    if name[0] in ".- " or name[-1] in ". ":
        return False
    for char in name:
        if unicodedata.category(char)[0] in "LMN" or char in _NAME_PUNCTUATION:
            continue
        return False
    return True


def extension_de_audio(name: str) -> bool:
    lower = name.lower()
    return any(lower.endswith(ext) and len(lower) > len(ext) for ext in EXTENSIONS)


def titulo_desde_nombre(name: str) -> str:
    """El nombre del archivo sin su extensión, en forma NFC (macOS sube los acentos descompuestos) y sin espacios a los
    lados. Recortado al máximo de título de las peticiones."""
    stem = name.rsplit(".", 1)[0] if "." in name else name
    title = unicodedata.normalize("NFC", stem).strip()[:MAX_TITLE_CHARS].strip()
    return title or "Sin título"


def _has_control(text: str) -> bool:
    return any(unicodedata.category(char) in ("Cc", "Zl", "Zp", "Cs", "Cf") for char in text)


def licencia_desde_mensaje(message: object) -> str | None:
    """El texto de la primera línea «Licencia: <texto>» del mensaje de un commit (sin distinguir mayúsculas). None si no
    hay línea, si está vacía, si pasa de 300 caracteres o si lleva caracteres de control o de formato."""
    if not isinstance(message, str):
        return None
    match = _LICENSE_LINE.search(message)
    if not match:
        return None
    text = unicodedata.normalize("NFC", match.group(1)).strip()
    if not text or len(text) > MAX_LICENSE_CHARS or _has_control(text):
        return None
    if text == catalog.LICENSE_UNDECLARED:
        return None
    return text


def actor_valido(actor: object) -> str:
    if not isinstance(actor, str) or not _ACTOR.fullmatch(actor):
        raise BuzonError("la cuenta que sube no tiene un nombre de GitHub válido")
    return actor


def archivos_del_evento(event: Mapping) -> dict[str, str]:
    """Rutas del buzón que el push añadió o modificó, con el mensaje del último commit del push que las tocó. Un archivo
    que un commit posterior del mismo push borró no aparece. El orden de 'commits' es el del push (del más antiguo
    al más reciente)."""
    commits = event.get("commits") if isinstance(event, Mapping) else None
    if not isinstance(commits, list):
        raise BuzonError("el evento no es un push con la lista de commits")
    prefix = BUZON_DIRECTORY + "/"
    files: dict[str, str] = {}
    for commit in commits:
        if not isinstance(commit, Mapping):
            raise BuzonError("un commit del evento no tiene la forma esperada")
        message = commit.get("message") if isinstance(commit.get("message"), str) else ""
        for key in ("added", "modified"):
            for path in commit.get(key) or []:
                if isinstance(path, str) and path.startswith(prefix):
                    files[path] = message
        for path in commit.get("removed") or []:
            files.pop(path, None)
    return files


def _check_no_links(repo: Path) -> Path:
    current = repo
    for part in BUZON_DIRECTORY.split("/"):
        current = current / part
        if current.is_symlink():
            raise BuzonError(f"enlace simbólico en la ruta del buzón: {BUZON_DIRECTORY}")
    return current


def _mensaje_de_cabeza(event: Mapping) -> str:
    head = event.get("head_commit") if isinstance(event, Mapping) else None
    message = head.get("message") if isinstance(head, Mapping) else None
    return message if isinstance(message, str) else ""


def _archivos_a_procesar(event: Mapping, buzon: Path) -> dict[str, str]:
    """Las rutas que nombra el evento. Si no nombra ninguna (el evento del push no siempre trae las listas de archivos,
    y un lanzamiento manual no trae commits), se procesa lo que hay en el buzón en este commit, con el mensaje del
    último commit del push para la licencia."""
    files = archivos_del_evento(event) if isinstance(event, Mapping) and "commits" in event else {}
    if files:
        return files
    message = _mensaje_de_cabeza(event)
    files: dict[str, str] = {}
    for directory, prefix in ((buzon, BUZON_DIRECTORY + "/"), (buzon / PORTADAS_SUBDIRECTORY, PORTADAS_DIRECTORY + "/")):
        if directory.is_symlink() or not directory.is_dir():
            continue
        for item in sorted(directory.iterdir()):
            if item.name not in PLACEHOLDERS and (item.is_file() or item.is_symlink()):
                files[prefix + item.name] = message
    return files


def procesar_buzon(*, repo: Path, event: Mapping, actor: str, staging_dir: Path | None = None) -> dict:
    """Procesa las subidas del push (ver el docstring del módulo). Deja en el repositorio el catálogo y el audio nuevos,
    la parte pública regenerada y los archivos borrados del buzón; no confirma nada."""
    actor = actor_valido(actor)
    buzon = _check_no_links(repo)
    catalog_path = repo / "audio-library" / "indexes" / "catalog.json"
    audio_dir = repo / "audio-library" / "audio"
    covers_dir = repo / COVERS_DIRECTORY
    staging = staging_dir or repo / "audio-library" / "staging"
    for folder in (catalog_path.parent, audio_dir, covers_dir, buzon / PORTADAS_SUBDIRECTORY):
        if folder.is_symlink():
            raise BuzonError(f"enlace simbólico en la biblioteca: {folder.relative_to(repo).as_posix()}")
    if not catalog_path.is_file():
        raise BuzonError("falta el catálogo de la biblioteca")

    data = catalog.load(catalog_path)
    result: dict = {
        "accion": "buzon", "actor": actor,
        "publicas": [], "privadas": [], "duplicadas": [], "portadas": [], "rechazados": [], "revisar": [],
        "ya_no_estan": [],
    }
    changed = False
    source = UPLOADED_BY + actor
    prefix = BUZON_DIRECTORY + "/"
    portadas_prefix = PORTADAS_DIRECTORY + "/"
    archivos = _archivos_a_procesar(event, buzon)
    portadas = {path: message for path, message in archivos.items() if path.startswith(portadas_prefix)}
    try:
        for path, message in sorted(archivos.items()):
            if path in portadas:
                continue
            name = path[len(prefix):]
            if "/" in name:
                result["revisar"].append({"ruta": path, "motivo": "subcarpeta dentro del buzón"})
                continue
            if name in PLACEHOLDERS:
                continue
            if not nombre_valido(name):
                result["revisar"].append({"ruta": path, "motivo": "nombre con caracteres no admitidos"})
                continue
            target = buzon / name
            if target.is_symlink():
                result["revisar"].append({"ruta": path, "motivo": "enlace simbólico"})
                continue
            if not target.exists():
                result["ya_no_estan"].append(name)
                continue
            if not target.is_file():
                result["revisar"].append({"ruta": path, "motivo": "no es un archivo"})
                continue

            motivo = _motivo_de_rechazo(target, name)
            info = None
            if motivo is None:
                try:
                    info = probe(target)
                except ProbeError:
                    motivo = "no es audio (ffprobe no encuentra una pista de audio)"
                else:
                    if not info.duration_s > 0:
                        motivo = "el audio no tiene duración"
            if motivo is not None:
                result["rechazados"].append({"archivo": name, "motivo": motivo})
                target.unlink()
                continue

            license_text = licencia_desde_mensaje(message)
            entry, motivo, song_changed = _add(
                data, target=target, name=name, info=info, license_text=license_text, source=source,
                audio_dir=audio_dir, staging=staging,
            )
            target.unlink()
            if motivo is not None:
                result["rechazados"].append({"archivo": name, "motivo": motivo})
                continue
            changed = changed or song_changed
            result[entry.pop("lista")].append(entry)

        # Después de las canciones: una portada puede ser de una canción que entra en este mismo push.
        for path in sorted(portadas):
            cover_changed = _procesar_portada(
                data, result, path=path, name=path[len(portadas_prefix):], directory=buzon / PORTADAS_SUBDIRECTORY,
                covers_dir=covers_dir, staging=staging,
            )
            changed = changed or cover_changed
    finally:
        shutil.rmtree(staging, ignore_errors=True)

    if changed:
        catalog.save(catalog_path, data)
    result["web"] = sync_public(
        catalog_path=catalog_path, audio_dir=audio_dir, web_dir=repo / "frontend" / "web", covers_dir=covers_dir,
    )
    return result


def _procesar_portada(data: dict, result: dict, *, path: str, name: str, directory: Path, covers_dir: Path,
                      staging: Path) -> bool:
    """Una portada del buzón (ver el docstring del módulo). Anota el resultado y devuelve si cambió la biblioteca."""
    shown = f"{PORTADAS_SUBDIRECTORY}/{name}"
    if "/" in name:
        result["revisar"].append({"ruta": path, "motivo": "subcarpeta dentro de las portadas del buzón"})
        return False
    if name in PLACEHOLDERS:
        return False
    if not nombre_valido(name):
        result["revisar"].append({"ruta": path, "motivo": "nombre con caracteres no admitidos"})
        return False
    target = directory / name
    if target.is_symlink():
        result["revisar"].append({"ruta": path, "motivo": "enlace simbólico"})
        return False
    if not target.exists():
        result["ya_no_estan"].append(shown)
        return False
    if not target.is_file():
        result["revisar"].append({"ruta": path, "motivo": "no es un archivo"})
        return False

    def rechazar(motivo: str) -> bool:
        result["rechazados"].append({"archivo": shown, "motivo": motivo})
        target.unlink()
        return False

    match = UPLOAD_NAME.fullmatch(name)
    if match is None:
        return rechazar("el nombre no es <id>.jpg, .jpeg, .png o .webp con el id de una canción (S…) o de una "
                        "carpeta (F…)")
    item_id = match.group(1)
    item = catalog.find_item(data, item_id)
    if item is None:
        return rechazar(f"no hay ninguna canción ni carpeta con el id {item_id}")
    size = target.stat().st_size
    if size == 0:
        return rechazar("está vacío")
    if size > MAX_COVER_BYTES:
        return rechazar("pasa de 10 MB")
    produced = staging / "portadas" / f"{item_id}.jpg"
    try:
        convertir_portada(target, produced)
    except PortadaError as error:
        return rechazar(str(error))

    covers_dir.mkdir(parents=True, exist_ok=True)
    destination = covers_dir / f"{item_id}.jpg"
    if destination.is_symlink():
        raise BuzonError(f"enlace simbólico en la biblioteca: {COVERS_DIRECTORY}/{item_id}.jpg")
    file_changed = not destination.is_file() or destination.read_bytes() != produced.read_bytes()
    if file_changed:
        shutil.move(str(produced), destination)
    else:
        produced.unlink()
    catalog_changed = catalog.set_cover(data, item_id, cover_ref(item_id))
    target.unlink()
    result["portadas"].append({
        "archivo": shown, "id": item_id, "tipo": "canción" if item_id.startswith("S") else "carpeta",
        "nueva": file_changed or catalog_changed,
    })
    return file_changed or catalog_changed


def _motivo_de_rechazo(target: Path, name: str) -> str | None:
    if not extension_de_audio(name):
        return "no es un archivo de audio admitido (WAV, MP3, M4A, FLAC u OGG)"
    if target.stat().st_size > MAX_FILE_BYTES:
        return "pasa de 100 MiB"
    if target.stat().st_size == 0:
        return "está vacío"
    return None


def _add(data: dict, *, target: Path, name: str, info, license_text: str | None, source: str,
         audio_dir: Path, staging: Path) -> tuple[dict, str | None, bool]:
    """Añade la canción (o reconoce la que ya está). Devuelve (entrada del resultado, motivo de rechazo, cambió)."""
    sha256 = sha256_file(target)
    title = titulo_desde_nombre(name)
    existing = next((song for song in data["songs"] if song["sha256"] == sha256), None)
    if existing is not None:
        if license_text and existing.get("license") == catalog.LICENSE_UNDECLARED:
            # La misma grabación, ahora con licencia: se declara y se publica.
            catalog.declare_license(data, existing["id"], license_text, source)
            catalog.update_song(data, existing["id"], {"public": True})
            return ({"lista": "publicas", "archivo": name, "song_id": existing["id"], "titulo": existing["title"],
                     "licencia": license_text, "nueva": False}, None, True)
        return ({"lista": "duplicadas", "archivo": name, "song_id": existing["id"], "titulo": existing["title"]},
                None, False)

    song, _ = catalog.add_song(
        data, sha256=sha256, title=title, license=license_text or catalog.LICENSE_UNDECLARED, source=source,
        codec=info.codec, duration_s=info.duration_s, size_bytes=info.size_bytes,
    )
    try:
        produced = transcode(target, staging / song["id"], PLAYBACK_PROFILE)
    except TranscodeError:
        data["songs"].remove(song)
        return {}, "ffmpeg no lo puede convertir a Opus", False
    audio_dir.mkdir(parents=True, exist_ok=True)
    shutil.move(str(produced), audio_dir / f"{song['id']}.opus")
    if license_text:
        catalog.update_song(data, song["id"], {"public": True})
        return ({"lista": "publicas", "archivo": name, "song_id": song["id"], "titulo": song["title"],
                 "licencia": license_text, "nueva": True}, None, True)
    return {"lista": "privadas", "archivo": name, "song_id": song["id"], "titulo": song["title"]}, None, True


def _quoted(value: str, *, ascii_only: bool = False) -> str:
    # Entre comillas y escapado: un nombre no puede cerrar el bloque ni meter un salto de línea en el resumen.
    return json.dumps(value, ensure_ascii=ascii_only)


def resumen_markdown(result: Mapping) -> str:
    """Resumen del job (GITHUB_STEP_SUMMARY). Los nombres de archivo y las licencias vienen de quien sube: van
    escapados y en bloques sangrados (código literal en Markdown), nunca como Markdown ni HTML."""
    lines = ["## Buzón de canciones", "", f"Subida por la cuenta: {_quoted(result.get('actor', ''), ascii_only=True)}", ""]

    def block(title: str, rows: list[str]) -> None:
        if not rows:
            return
        lines.extend([f"### {title}", ""])
        lines.extend("    " + row for row in rows)
        lines.append("")

    if "error" in result:
        block("Error: no se ha publicado nada", [_quoted(str(result["error"]), ascii_only=True)])
        return "\n".join(lines) + "\n"
    block("Públicas (con licencia declarada)", [
        f"{_quoted(item['archivo'])} -> {item['song_id']} · licencia {_quoted(item['licencia'])}"
        for item in result.get("publicas", [])
    ])
    privadas = result.get("privadas", [])
    if privadas:
        lines.extend([
            "### Privadas: el commit no tenía una línea «Licencia: <texto>» válida", "",
            "Estas canciones entran con public false y no se pueden publicar hasta declarar su licencia. Para "
            "declararla, sube de nuevo el mismo archivo con la línea «Licencia: <texto>» en la descripción del commit.",
            "",
        ])
        lines.extend("    " + f"{_quoted(item['archivo'])} -> {item['song_id']}" for item in privadas)
        lines.append("")
    block("Portadas (JPEG de 640×640 en audio-library/covers)", [
        f"{_quoted(item['archivo'])} -> {item['id']} ({item['tipo']})"
        + ("" if item.get("nueva", True) else " · sin cambios")
        for item in result.get("portadas", [])
    ])
    block("Ya estaban en el catálogo (sin cambios)", [
        f"{_quoted(item['archivo'])} -> {item['song_id']}" for item in result.get("duplicadas", [])
    ])
    block("Rechazados y borrados del buzón (siguen en el historial de git)", [
        f"{_quoted(item['archivo'])}: {item['motivo']}" for item in result.get("rechazados", [])
    ])
    block("Para revisar a mano (siguen en el buzón)", [
        f"{_quoted(item['ruta'], ascii_only=True)}: {item['motivo']}" for item in result.get("revisar", [])
    ])
    block("Ya no estaban en el buzón", [_quoted(name) for name in result.get("ya_no_estan", [])])
    if len(lines) == 4:
        lines.append("Este push no trae archivos nuevos para el buzón.")
    return "\n".join(lines) + "\n"
