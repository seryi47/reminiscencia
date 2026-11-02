"""Catálogo versionado en JSON (ADR-0007). Fuente de verdad de la biblioteca.

Estructura de audio-library/indexes/catalog.json:
{
  "version": 1,
  "folders": [{"id", "name", "parent_id"}],
  "songs":   [{"id", "title", "artist", "year", "tags", "folder_id", "license",
               "source", "sha256", "duration_s", "codec", "size_bytes", "added_at", "public"}]
}
Las operaciones son puras sobre el fichero: cada cambio se guarda entero y de forma atómica.
"""

from __future__ import annotations

import json
import os
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path

VERSION = 1
EDITABLE = ("title", "artist", "year", "tags", "folder_id", "public")


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


def add_song(data: dict, *, sha256: str, title: str, license: str, source: str,
             codec: str, duration_s: float, size_bytes: int) -> tuple[dict, bool]:
    """Devuelve (canción, creada). Si el contenido ya existe, no duplica."""
    if not license or not license.strip():
        raise CatalogError("no se puede importar una canción sin licencia declarada")
    for song in data["songs"]:
        if song["sha256"] == sha256:
            return song, False
    song = {
        "id": song_id_for(sha256),
        "title": title.strip() or "Sin título",
        "artist": "",
        "year": None,
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
    if "public" in fields:
        fields["public"] = bool(fields["public"])
    if "folder_id" in fields and not fields["folder_id"]:
        fields["folder_id"] = None
    song.update(fields)
    return song


def create_folder(data: dict, name: str, parent_id: str | None = None) -> dict:
    """Crea una carpeta. Si ya hay una con ese nombre bajo el mismo padre, la devuelve: reejecutar una
    petición no duplica la carpeta."""
    clean = name.strip()
    if not clean:
        raise CatalogError("el nombre de la carpeta no puede estar vacío")
    if parent_id:
        find_folder(data, parent_id)
    for existing in data["folders"]:
        if existing["name"] == clean and existing["parent_id"] == (parent_id or None):
            return existing
    folder = {"id": uuid.uuid4().hex[:10], "name": clean, "parent_id": parent_id or None}
    data["folders"].append(folder)
    return folder


def rename_folder(data: dict, folder_id: str, name: str) -> dict:
    clean = name.strip()
    if not clean:
        raise CatalogError("el nombre de la carpeta no puede estar vacío")
    folder = find_folder(data, folder_id)
    folder["name"] = clean
    return folder


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
