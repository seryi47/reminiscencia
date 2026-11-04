"""Catálogo versionado en JSON (ADR-0007). Fuente de verdad de la biblioteca.

Estructura de audio-library/indexes/catalog.json:
{
  "version": 1,
  "folders": [{"id", "name", "parent_id", "artist"?, "cover"?}],
  "songs":   [{"id", "title", "artist", "year", "tags", "folder_id", "license",
               "source", "sha256", "duration_s", "codec", "size_bytes", "added_at", "public", "cover"?}]
}
Una carpeta es también un álbum (ADR-0016): "artist" (opcional, una línea de hasta 80 caracteres) y "cover"
(opcional, "covers/<id>.jpg"). Una canción puede tener "cover" igual. Los campos opcionales solo están cuando tienen
valor. Los ids de carpeta nuevos son F seguida de 16 hexadecimales; los anteriores, de 10 hexadecimales, siguen siendo
válidos (no tienen portada).
Las operaciones son puras sobre el fichero: cada cambio se guarda entero y de forma atómica.
"""

from __future__ import annotations

import hashlib
import json
import os
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path

VERSION = 1
EDITABLE = ("title", "artist", "year", "tags", "folder_id", "public")
# Licencia de una canción subida al buzón sin línea «Licencia:» en el commit (ADR-0014). La canción queda privada y
# no se puede publicar hasta que alguien declare su licencia (declare_license).
LICENSE_UNDECLARED = "Sin declarar"
# Límites del artista y del año de una canción. Los aplica el contrato de las peticiones (issue_request) y la importación
# desde Internet Archive (sources), que recorta o descarta lo que no cumpla.
SONG_ARTIST_MAX_CHARS = 200
YEAR_MIN = 1000
YEAR_MAX = 2100


class CatalogError(ValueError):
    pass


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def empty() -> dict:
    return {"version": VERSION, "folders": [], "songs": []}


def load(path: Path) -> dict:
    if not path.exists():
        return empty()
    data = json.loads(path.read_text(encoding="utf-8"))
    data.setdefault("folders", [])
    data.setdefault("songs", [])
    return data


def save(path: Path, data: dict) -> None:
    """Escritura atómica: primero a un fichero temporal, luego reemplazo."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".catalog-", suffix=".json")
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        json.dump(data, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
    os.replace(tmp, path)


def song_id_for(sha256: str) -> str:
    return f"S{sha256[:16]}"


def find_song(data: dict, song_id: str) -> dict:
    for song in data["songs"]:
        if song["id"] == song_id:
            return song
    raise CatalogError(f"no existe la canción {song_id}")


def find_folder(data: dict, folder_id: str) -> dict:
    for folder in data["folders"]:
        if folder["id"] == folder_id:
            return folder
    raise CatalogError(f"no existe la carpeta {folder_id}")


def youtube_album(data: dict, playlist_id: str, name: str) -> tuple[dict, bool]:
    """Crea o reutiliza el álbum estable de una playlist; el id de YouTube queda solo en el catálogo interno."""
    for folder in data["folders"]:
        if folder.get("youtube_playlist_id") == playlist_id:
            changed = folder.get("name") != name
            folder["name"] = name
            return folder, changed

    folder_id = f"F{hashlib.sha256(f'youtube:{playlist_id}'.encode()).hexdigest()[:16]}"
    if any(folder.get("id") == folder_id for folder in data["folders"]):
        raise CatalogError("el id del álbum de YouTube coincide con una carpeta existente")
    folder = {
        "id": folder_id,
        "name": name,
        "parent_id": None,
        "youtube_playlist_id": playlist_id,
    }
    data["folders"].append(folder)
    return folder, True


def add_song(data: dict, *, sha256: str, title: str, license: str, source: str,
             codec: str, duration_s: float, size_bytes: int, artist: str = "",
             year: int | None = None) -> tuple[dict, bool]:
    """Devuelve (canción, creada). Si el contenido ya existe, no duplica (ni cambia su artista ni su año).
    artist y year llegan ya validados (por ejemplo, de los metadatos de Internet Archive)."""
    if not license or not license.strip():
        raise CatalogError("no se puede importar una canción sin licencia declarada")
    for song in data["songs"]:
        if song["sha256"] == sha256:
            return song, False
    song = {
        "id": song_id_for(sha256),
        "title": title.strip() or "Sin título",
        "artist": (artist or "").strip(),
        "year": year,
        "tags": [],
        "folder_id": None,
        "license": license.strip(),
        "source": source,
        "sha256": sha256,
        "duration_s": round(float(duration_s), 3),
        "codec": codec,
        "size_bytes": int(size_bytes),
        "added_at": _now(),
        "public": False,  # las canciones nuevas nacen privadas
    }
    data["songs"].append(song)
    return song, True


def update_song(data: dict, song_id: str, fields: dict) -> dict:
    song = find_song(data, song_id)
    unknown = set(fields) - set(EDITABLE)
    if unknown:
        raise CatalogError(f"campos no editables: {', '.join(sorted(unknown))}")
    if "title" in fields and not str(fields["title"]).strip():
        raise CatalogError("el título no puede estar vacío")
    if fields.get("folder_id"):
        find_folder(data, fields["folder_id"])
    if "tags" in fields:
        fields["tags"] = normalize_tags(fields["tags"])
    if fields.get("year") not in (None, ""):
        fields["year"] = int(fields["year"])
    elif "year" in fields:
        fields["year"] = None
    if "public" in fields and not isinstance(fields["public"], bool):
        raise CatalogError("public debe ser true o false (booleano, no texto ni número)")
    if fields.get("public") is True and song.get("license") == LICENSE_UNDECLARED:
        raise CatalogError("no se puede publicar una canción sin licencia declarada")
    if "folder_id" in fields and not fields["folder_id"]:
        fields["folder_id"] = None
    song.update(fields)
    return song


def declare_license(data: dict, song_id: str, license: str, source: str) -> dict:
    """Declara la licencia de una canción que entró sin ella (LICENSE_UNDECLARED). Solo sustituye esa marca: la licencia
    de una canción que ya la tiene no se cambia por esta vía."""
    song = find_song(data, song_id)
    if song.get("license") != LICENSE_UNDECLARED:
        raise CatalogError(f"la canción {song_id} ya tiene licencia declarada")
    clean = license.strip()
    if not clean or clean == LICENSE_UNDECLARED:
        raise CatalogError("la licencia declarada no puede estar vacía")
    song["license"] = clean
    song["source"] = source
    return song


def new_folder_id() -> str:
    return f"F{uuid.uuid4().hex[:16]}"


def _set_artist(folder: dict, artist: str | None) -> None:
    clean = (artist or "").strip()
    if clean:
        folder["artist"] = clean
    else:
        folder.pop("artist", None)


def create_folder(data: dict, name: str, parent_id: str | None = None, artist: str | None = None) -> dict:
    """Crea una carpeta (un álbum, con artista opcional). Si ya hay una con ese nombre y ese artista bajo el mismo
    padre, la devuelve: reejecutar una petición no duplica la carpeta. Dos álbumes con el mismo nombre y distinto
    artista son dos carpetas."""
    clean = name.strip()
    if not clean:
        raise CatalogError("el nombre de la carpeta no puede estar vacío")
    if parent_id:
        find_folder(data, parent_id)
    clean_artist = (artist or "").strip()
    for existing in data["folders"]:
        if (existing["name"] == clean and existing["parent_id"] == (parent_id or None)
                and (existing.get("artist") or "") == clean_artist):
            return existing
    folder = {"id": new_folder_id(), "name": clean, "parent_id": parent_id or None}
    _set_artist(folder, clean_artist)
    data["folders"].append(folder)
    return folder


def rename_folder(data: dict, folder_id: str, name: str) -> dict:
    clean = name.strip()
    if not clean:
        raise CatalogError("el nombre de la carpeta no puede estar vacío")
    folder = find_folder(data, folder_id)
    folder["name"] = clean
    return folder


_KEEP = object()


def edit_folder(data: dict, folder_id: str, name: str, artist=_KEEP) -> dict:
    """Cambia el nombre y, si se pasa, el artista de una carpeta. Un artista vacío lo quita; sin artista, se conserva
    el que tenga."""
    folder = rename_folder(data, folder_id, name)
    if artist is not _KEEP:
        _set_artist(folder, artist)
    return folder


def find_item(data: dict, item_id: str) -> dict | None:
    """La canción o la carpeta con ese id, o None."""
    for collection in ("songs", "folders"):
        for item in data[collection]:
            if item.get("id") == item_id:
                return item
    return None


def set_cover(data: dict, item_id: str, cover: str) -> bool:
    """Apunta la canción o la carpeta a su portada. Devuelve si el catálogo ha cambiado."""
    item = find_item(data, item_id)
    if item is None:
        raise CatalogError(f"no existe ninguna canción ni carpeta {item_id}")
    if item.get("cover") == cover:
        return False
    item["cover"] = cover
    return True


def delete_folder(data: dict, folder_id: str) -> None:
    """Borra la carpeta. Sus canciones y subcarpetas suben al nivel superior."""
    folder = find_folder(data, folder_id)
    parent = folder["parent_id"]
    for song in data["songs"]:
        if song["folder_id"] == folder_id:
            song["folder_id"] = parent
    for item in data["folders"]:
        if item["parent_id"] == folder_id:
            item["parent_id"] = parent
    data["folders"].remove(folder)


def normalize_tags(tags) -> list[str]:
    items = tags.split(",") if isinstance(tags, str) else list(tags or [])
    seen, clean = set(), []
    for item in items:
        value = str(item).strip().lower()
        if value and value not in seen:
            seen.add(value)
            clean.append(value)
    return clean
