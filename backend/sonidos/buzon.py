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

ZIP (2026-11-03): un <nombre>.zip del buzón se descomprime entrada a entrada en un directorio temporal fuera del
repositorio y cada canción que contiene (WAV, MP3, M4A, FLAC, OGG u Opus, también en subcarpetas) se procesa como un
archivo del buzón, con la licencia del commit que trajo el ZIP y como título el nombre de su archivo sin ruta ni
extensión. Las rutas del ZIP nunca se usan para escribir: cada entrada se copia a un nombre fijo del directorio
temporal, que se borra antes de la siguiente. Se ignoran, y se cuentan en el resultado, las carpetas, lo de
__MACOSX/, los ocultos, los enlaces simbólicos, lo que no es un archivo, lo que no es audio y las rutas absolutas o
con «..». Un ZIP cifrado o dañado se rechaza entero, sin catalogar nada. El ZIP se borra del buzón. Sin límite de
tamaño (orden del propietario).

Portadas (ADR-0016): audio-library/buzon/portadas/<ID>.<jpg|jpeg|png|webp>, donde ID es el id de una canción
(S + 16 hexadecimales) o de una carpeta (F + 16 hexadecimales) que ya está en el catálogo (o que entra en el mismo
push). Máximo 10 MiB. Se convierte a JPEG de 640×640 (sonidos.portadas) en audio-library/covers/<ID>.jpg, el catálogo
apunta a ella y se borra del buzón. No necesita línea de licencia. Un id que no existe, un nombre que no es un id o
una imagen que no es válida se rechazan y se borran, con el motivo en el resumen. Las canciones se procesan antes que
las portadas.

Subidas por trozos desde la web pública y la APK (ADR-0017): la función de Vercel guarda cada trozo de un Ogg Opus en
audio-library/buzon/.partes/<id>/<índice>.part (id: UUID en minúsculas; índices desde 0) con un commit por trozo, y
con el último escribe audio-library/buzon/.partes/<id>/manifiesto.json, {"nombre": "<nombre>.opus", "partes": N} (y,
opcionalmente, los metadatos de álbum y artista de YouTube), en un commit con la línea «Licencia: …». Una carpeta sin
manifiesto es una subida en curso y se ignora. Con manifiesto y
las N partes, se unen en orden en audio-library/buzon/<nombre>.opus (con un sufijo « (2)», « (3)»... si ese nombre ya
está), se borra la carpeta de partes y el archivo se procesa como cualquier otro, con la licencia del commit que trajo
el manifiesto. Si este push no trae el manifiesto (otra ejecución de la cola llegó antes a main), se usa la licencia
que la función declara siempre (WEB_LICENSE): esas carpetas solo las escribe la función de la web.
- Un manifiesto que no es válido (forma, nombre o número de partes) se rechaza y se borra la carpeta.
- Se dejan para revisar: un id que no es un UUID, enlaces simbólicos, elementos que no son partes y partes que faltan.
"""

from __future__ import annotations

import json
import re
import shutil
import tempfile
import unicodedata
import zipfile
import zlib
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
EXTENSIONS = (".wav", ".mp3", ".m4a", ".flac", ".ogg", ".opus")
MAX_FILE_BYTES = GIT_BLOCK_FILE_BYTES  # 100 MiB: lo que GitHub deja versionar.
MAX_NAME_CHARS = 200
MAX_NAME_BYTES = 255
MAX_TITLE_CHARS = 200
MAX_LICENSE_CHARS = 300
UPLOADED_BY = "Subida por "
# Subidas por trozos (ADR-0017).
PARTES_SUBDIRECTORY = ".partes"
PARTES_DIRECTORY = f"{BUZON_DIRECTORY}/{PARTES_SUBDIRECTORY}"
PARTES_MANIFEST = "manifiesto.json"
MAX_PARTES = 1000
MAX_MANIFEST_BYTES = 4096
# ZIP con canciones (ver el docstring del módulo).
ZIP_EXTENSION = ".zip"
ZIP_IGNORED = {
    "carpetas": "carpetas",
    "macosx": "de __MACOSX",
    "ocultos": "ocultos",
    "enlaces": "enlaces simbólicos",
    "no_son_archivos": "que no son archivos",
    "rutas_peligrosas": "con ruta absoluta o «..»",
    "no_audio": "que no son audio",
}
_ZIP_UTF8_FLAG = 0x800
_ZIP_ENCRYPTED_FLAG = 0x1
_FILE_TYPE_MASK = 0o170000
_REGULAR_FILE = 0o100000
_SYMLINK = 0o120000
_DRIVE = re.compile(r"[A-Za-z]:")
WEB_LICENSE = "Subida desde la web pública; quien la sube declara tener derecho a publicarla"
_UPLOAD_ID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
_PART_NAME = re.compile(r"(?:0|[1-9][0-9]{0,2})\.part")  # índices de 0 a 999: como mucho MAX_PARTES partes

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


def es_zip(name: str) -> bool:
    lower = name.lower()
    return lower.endswith(ZIP_EXTENSION) and len(lower) > len(ZIP_EXTENSION)


def nombre_visible(name: str) -> str:
    """El nombre de un archivo de dentro de un ZIP con lo que nombre_valido no admite cambiado por espacios (como hace
    la web con lo que sube): sin controles, caracteres de formato ni separadores raros en el catálogo ni en el
    resumen."""
    text = unicodedata.normalize("NFC", name)
    kept = "".join(
        char if unicodedata.category(char)[0] in "LMN" or char in _NAME_PUNCTUATION else " " for char in text
    )
    return " ".join(kept.split())


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


def ruta_de_partes(ruta: object) -> bool:
    """Un trozo (<índice>.part) o el manifiesto de una subida por trozos: audio-library/buzon/.partes/<UUID>/<nombre>.
    Son las únicas rutas de .partes que el paquete puede borrar."""
    if not isinstance(ruta, str) or not ruta.startswith(PARTES_DIRECTORY + "/"):
        return False
    upload_id, separator, name = ruta[len(PARTES_DIRECTORY) + 1:].partition("/")
    if not separator or "/" in name or not _UPLOAD_ID.fullmatch(upload_id):
        return False
    return name == PARTES_MANIFEST or _PART_NAME.fullmatch(name) is not None


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
        # Los trozos de .partes no se procesan uno a uno: los une _unir_partes cuando llega su manifiesto.
        return {path: message for path, message in files.items() if not path.startswith(PARTES_DIRECTORY + "/")}
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
        "publicas": [], "privadas": [], "duplicadas": [], "portadas": [], "zips": [], "rechazados": [],
        "revisar": [], "ya_no_estan": [],
    }
    changed = False
    source = UPLOADED_BY + actor
    prefix = BUZON_DIRECTORY + "/"
    portadas_prefix = PORTADAS_DIRECTORY + "/"
    archivos = _archivos_a_procesar(event, buzon)
    del_evento = archivos_del_evento(event) if isinstance(event, Mapping) and "commits" in event else {}
    albumes: dict[str, dict] = {}
    archivos.update(_unir_partes(buzon, result, del_evento, albumes=albumes))
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

            license_text = licencia_desde_mensaje(message)
            if es_zip(name):
                zip_changed = _procesar_zip(
                    data, result, target=target, name=name, repo=repo, license_text=license_text, source=source,
                    audio_dir=audio_dir, staging=staging,
                )
                target.unlink()
                changed = changed or zip_changed
                continue

            motivo = _motivo_de_rechazo(target, name)
            song_changed = _catalogar(
                data, result, target=target, archivo=name, title=titulo_desde_nombre(name), motivo=motivo,
                license_text=license_text, source=source, audio_dir=audio_dir, staging=staging,
                album=(albumes.get(path) or {}).get("album"),
                artist=(albumes.get(path) or {}).get("artist"),
            )
            target.unlink()
            changed = changed or song_changed

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


def _leer_manifiesto(path: Path) -> tuple[str, int, dict | None, str] | None:
    """(nombre, partes, álbum, artista) de un manifiesto válido, o None."""
    try:
        if path.stat().st_size > MAX_MANIFEST_BYTES:
            return None
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, ValueError):
        return None
    if not isinstance(data, dict) or not {"nombre", "partes"} <= set(data) or set(data) - {
        "nombre", "partes", "album", "artist"
    }:
        return None
    nombre, partes = data["nombre"], data["partes"]
    if not isinstance(nombre, str) or not nombre_valido(nombre) or not nombre.lower().endswith(".opus") or len(nombre) <= 5:
        return None
    if isinstance(partes, bool) or not isinstance(partes, int) or not 1 <= partes <= MAX_PARTES:
        return None
    artist = data.get("artist", "")
    if (not isinstance(artist, str) or len(artist) > catalog.SONG_ARTIST_MAX_CHARS
            or any(ord(char) < 32 or ord(char) == 127 for char in artist)):
        return None
    artist = artist.strip()
    album = None
    if "album" in data:
        candidate = data["album"]
        if not isinstance(candidate, dict) or set(candidate) != {"id", "name"}:
            return None
        album_id = candidate["id"]
        album_name = candidate["name"]
        if not isinstance(album_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,200}", album_id):
            return None
        if (not isinstance(album_name, str) or not album_name.strip() or len(album_name) > 200
                or any(ord(char) < 32 or ord(char) == 127 for char in album_name)):
            return None
        album = {"id": album_id, "name": album_name.strip()}
    return nombre, partes, album, artist


def _nombre_libre(buzon: Path, nombre: str) -> str:
    """El nombre, o el nombre con « (2)», « (3)»... si ya hay un archivo así en el buzón (sin distinguir mayúsculas).
    Nunca sobrescribe."""
    taken = {item.name.casefold() for item in buzon.iterdir()}
    if nombre.casefold() not in taken:
        return nombre
    stem = nombre[:-len(".opus")]
    for number in range(2, 10_000):
        suffix = f" ({number}).opus"
        base = stem
        while base and not nombre_valido(base + suffix):
            base = base[:-1].rstrip(". ")
        candidate = (base or "Sin título") + suffix
        if candidate.casefold() not in taken:
            return candidate
    raise BuzonError("no hay un nombre libre en el buzón para una subida por trozos")


def _unir_partes(buzon: Path, result: dict, del_evento: Mapping[str, str], *,
                  albumes: dict[str, dict] | None = None) -> dict[str, str]:
    """Une las subidas por trozos completas de audio-library/buzon/.partes/ (ver el docstring del módulo). Devuelve las
    rutas del buzón de los archivos unidos con el mensaje de commit del que se lee su licencia."""
    directory = buzon / PARTES_SUBDIRECTORY
    if directory.is_symlink():
        result["revisar"].append({"ruta": PARTES_DIRECTORY, "motivo": "enlace simbólico"})
        return {}
    if not directory.is_dir():
        return {}
    unidas: dict[str, str] = {}
    for entry in sorted(directory.iterdir()):
        if entry.name in PLACEHOLDERS:
            continue
        ruta = f"{PARTES_DIRECTORY}/{entry.name}"
        if entry.is_symlink() or not entry.is_dir():
            result["revisar"].append({"ruta": ruta, "motivo": "no es una carpeta de partes"})
            continue
        if not _UPLOAD_ID.fullmatch(entry.name):
            result["revisar"].append({"ruta": ruta, "motivo": "carpeta de partes con un id que no es un UUID"})
            continue
        manifest = entry / PARTES_MANIFEST
        if not manifest.exists() and not manifest.is_symlink():
            continue  # subida en curso: faltan trozos por llegar
        children = sorted(entry.iterdir())
        if any(child.is_symlink() or not child.is_file() or not ruta_de_partes(f"{ruta}/{child.name}")
               for child in children):
            result["revisar"].append({"ruta": ruta, "motivo": "la carpeta de partes tiene elementos que no son partes"})
            continue
        spec = _leer_manifiesto(manifest)
        if spec is None:
            result["rechazados"].append({"archivo": f"{PARTES_SUBDIRECTORY}/{entry.name}",
                                         "motivo": "el manifiesto de partes no es válido"})
            shutil.rmtree(entry)
            continue
        nombre, total, album, artist = spec
        names = {child.name for child in children} - {PARTES_MANIFEST}
        expected = {f"{index}.part" for index in range(total)}
        if expected - names:
            result["revisar"].append({"ruta": ruta, "motivo": f"faltan {len(expected - names)} de {total} partes"})
            continue
        if names - expected:
            result["revisar"].append({"ruta": ruta, "motivo": "hay más partes de las que dice el manifiesto"})
            continue
        final = _nombre_libre(buzon, nombre)
        with (buzon / final).open("xb") as joined:
            for index in range(total):
                with (entry / f"{index}.part").open("rb") as part:
                    shutil.copyfileobj(part, joined)
        shutil.rmtree(entry)
        final_path = f"{BUZON_DIRECTORY}/{final}"
        unidas[final_path] = del_evento.get(f"{ruta}/{PARTES_MANIFEST}", f"Licencia: {WEB_LICENSE}")
        if (album is not None or artist) and albumes is not None:
            albumes[final_path] = {"album": album, "artist": artist}
    return unidas


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


def _catalogar(data: dict, result: dict, *, target: Path, archivo: str, title: str, motivo: str | None,
               license_text: str | None, source: str, audio_dir: Path, staging: Path,
               album: dict | None = None, artist: str | None = None) -> bool:
    """Comprueba que target es audio y lo añade al catálogo (o lo anota como rechazado con motivo, si ya trae uno).
    Anota el resultado con archivo como nombre y devuelve si cambió la biblioteca. No borra target."""
    info = None
    if motivo is None:
        try:
            info = probe(target)
        except ProbeError:
            motivo = "no es audio (ffprobe no encuentra una pista de audio)"
        else:
            if not info.duration_s > 0:
                motivo = "el audio no tiene duración"
    if motivo is None:
        entry, motivo, song_changed = _add(
            data, target=target, archivo=archivo, title=title, info=info, license_text=license_text, source=source,
            audio_dir=audio_dir, staging=staging, artist=artist or "",
        )
        if motivo is None and album is not None and license_text:
            folder, folder_changed = catalog.youtube_album(data, album["id"], album["name"])
            song = catalog.find_song(data, entry["song_id"])
            association_changed = song.get("folder_id") != folder["id"]
            if association_changed:
                catalog.update_song(data, song["id"], {"folder_id": folder["id"]})
            song_changed = song_changed or folder_changed or association_changed
    if motivo is not None:
        result["rechazados"].append({"archivo": archivo, "motivo": motivo})
        return False
    result[entry.pop("lista")].append(entry)
    return song_changed


def _nombre_de_entrada(info: zipfile.ZipInfo) -> str:
    """El nombre de una entrada del ZIP. Sin la marca UTF-8, zipfile lo lee como CP437, pero macOS y muchos compresores
    escriben UTF-8 sin la marca: si los bytes son UTF-8 válido, se lee como UTF-8."""
    name = info.filename
    if not info.flag_bits & _ZIP_UTF8_FLAG:
        try:
            name = name.encode("cp437").decode("utf-8")
        except (UnicodeEncodeError, UnicodeDecodeError):
            pass
    return name


def clasificar_entrada(info: zipfile.ZipInfo) -> tuple[str | None, str]:
    """(motivo para ignorarla, una clave de ZIP_IGNORED, o None; nombre base). Solo se devuelve el nombre base: la
    ruta de la entrada nunca se usa para escribir."""
    path = _nombre_de_entrada(info).replace("\\", "/")
    if info.is_dir() or path.endswith("/"):
        return "carpetas", ""
    parts = path.split("/")
    if path.startswith("/") or _DRIVE.match(path) or ".." in parts:
        return "rutas_peligrosas", ""
    parts = [part for part in parts if part not in ("", ".")]
    if not parts:
        return "carpetas", ""
    if "__MACOSX" in parts:
        return "macosx", ""
    mode = (info.external_attr >> 16) & _FILE_TYPE_MASK
    if mode == _SYMLINK:
        return "enlaces", ""
    if mode not in (0, _REGULAR_FILE):
        return "no_son_archivos", ""
    if any(part.startswith(".") for part in parts):
        return "ocultos", ""
    base = parts[-1]
    if not extension_de_audio(base):
        return "no_audio", ""
    return None, base


def _motivo_de_zip(archive: zipfile.ZipFile) -> str | None:
    """Motivo para rechazar el ZIP entero: cifrado o dañado (se comprueba el CRC de todas las entradas antes de
    catalogar nada, sin escribir en el disco)."""
    if any(info.flag_bits & _ZIP_ENCRYPTED_FLAG for info in archive.infolist()):
        return "el ZIP está cifrado (con contraseña): no se puede descomprimir"
    try:
        bad = archive.testzip()
    except (zipfile.BadZipFile, zlib.error, EOFError, OSError, ValueError, NotImplementedError, RuntimeError):
        bad = True
    if bad is not None:
        return "el ZIP está dañado o usa un formato que no se puede descomprimir"
    return None


def _procesar_zip(data: dict, result: dict, *, target: Path, name: str, repo: Path, license_text: str | None,
                  source: str, audio_dir: Path, staging: Path) -> bool:
    """Un ZIP del buzón (ver el docstring del módulo). Anota el resultado y devuelve si cambió la biblioteca. No borra
    el ZIP: lo borra quien llama."""
    try:
        archive = zipfile.ZipFile(target)
    except (zipfile.BadZipFile, OSError, ValueError, EOFError):
        result["rechazados"].append({"archivo": name, "motivo": "no es un ZIP válido o está dañado"})
        return False
    changed = False
    with archive:
        motivo = _motivo_de_zip(archive)
        if motivo is not None:
            result["rechazados"].append({"archivo": name, "motivo": motivo})
            return False
        ignored = dict.fromkeys(ZIP_IGNORED, 0)
        canciones = 0
        with tempfile.TemporaryDirectory(prefix="reminiscencia-zip-") as temporary:
            work = Path(temporary).resolve()
            root = repo.resolve()
            if work == root or root in work.parents:
                raise BuzonError("el directorio temporal del ZIP está dentro del repositorio")
            for info in archive.infolist():
                reason, base = clasificar_entrada(info)
                if reason is not None:
                    ignored[reason] += 1
                    continue
                canciones += 1
                shown = nombre_visible(base) or "Sin título"
                archivo = f"{name}/{shown}"
                extension = next(ext for ext in EXTENSIONS if base.lower().endswith(ext))
                extracted = work / f"entrada{extension}"  # nombre fijo: nada del ZIP decide dónde se escribe
                try:
                    with archive.open(info) as source_file, extracted.open("xb") as destination:
                        shutil.copyfileobj(source_file, destination, 1024 * 1024)
                except (zipfile.BadZipFile, zlib.error, EOFError, OSError, ValueError, NotImplementedError,
                        RuntimeError):
                    extracted.unlink(missing_ok=True)
                    result["rechazados"].append({"archivo": archivo, "motivo": "no se puede descomprimir"})
                    continue
                try:
                    motivo = "está vacío" if extracted.stat().st_size == 0 else None
                    song_changed = _catalogar(
                        data, result, target=extracted, archivo=archivo, title=titulo_desde_nombre(shown),
                        motivo=motivo, license_text=license_text, source=source, audio_dir=audio_dir, staging=staging,
                    )
                finally:
                    extracted.unlink(missing_ok=True)
                changed = changed or song_changed
    result["zips"].append({
        "archivo": name, "canciones": canciones,
        "ignorados": {key: count for key, count in ignored.items() if count},
    })
    return changed


def _motivo_de_rechazo(target: Path, name: str) -> str | None:
    if not extension_de_audio(name):
        return "no es un archivo de audio admitido (WAV, MP3, M4A, FLAC, OGG u Opus) ni un ZIP"
    if target.stat().st_size > MAX_FILE_BYTES:
        return "pasa de 100 MiB"
    if target.stat().st_size == 0:
        return "está vacío"
    return None


def _add(data: dict, *, target: Path, archivo: str, title: str, info, license_text: str | None, source: str,
         audio_dir: Path, staging: Path, artist: str = "") -> tuple[dict, str | None, bool]:
    """Añade la canción (o reconoce la que ya está). Devuelve (entrada del resultado, motivo de rechazo, cambió)."""
    sha256 = sha256_file(target)
    name = archivo
    existing = next((song for song in data["songs"] if song["sha256"] == sha256), None)
    if existing is not None:
        artist_changed = bool(artist and existing.get("artist") != artist)
        if artist_changed:
            catalog.update_song(data, existing["id"], {"artist": artist})
        if license_text and existing.get("license") == catalog.LICENSE_UNDECLARED:
            # La misma grabación, ahora con licencia: se declara y se publica.
            catalog.declare_license(data, existing["id"], license_text, source)
            catalog.update_song(data, existing["id"], {"public": True})
            return ({"lista": "publicas", "archivo": name, "song_id": existing["id"], "titulo": existing["title"],
                     "licencia": license_text, "nueva": False}, None, True)
        return ({"lista": "duplicadas", "archivo": name, "song_id": existing["id"], "titulo": existing["title"]},
                None, artist_changed)

    song, _ = catalog.add_song(
        data, sha256=sha256, title=title, license=license_text or catalog.LICENSE_UNDECLARED, source=source,
        codec=info.codec, duration_s=info.duration_s, size_bytes=info.size_bytes, artist=artist,
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
    block("ZIP descomprimidos y borrados del buzón", [
        f"{_quoted(item['archivo'])}: {item['canciones']} canción(es)"
        + ("" if not item.get("ignorados") else " · ignorados: " + ", ".join(
            f"{count} {ZIP_IGNORED.get(key, key)}" for key, count in item["ignorados"].items()))
        for item in result.get("zips", [])
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
