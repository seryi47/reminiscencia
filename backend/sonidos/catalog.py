"""Catálogo versionado en JSON (ADR-0007). Fuente de verdad de la biblioteca.

Estructura de audio-library/indexes/catalog.json:
{
  "version": 1,
  "folders": [{"id", "name", "parent_id", "artist"?, "cover"?}],
  "songs":   [{"id", "title", "artist", "year", "tags", "folder_id", "license",
               "source", "sha256", "duration_s", "codec", "size_bytes", "added_at", "public", "cover"?, "track"?}]
}
Una carpeta es también un álbum (ADR-0016): "artist" (opcional, una línea de hasta 80 caracteres) y "cover"
(opcional, "covers/<id>.jpg"). Una canción puede tener "cover" igual. Los campos opcionales solo están cuando tienen
valor. Los ids de carpeta nuevos son F seguida de 16 hexadecimales; los anteriores, de 10 hexadecimales, siguen siendo
válidos (no tienen portada).
Número de pista (ADR-0026): "track" (entero desde 1) da el orden de una canción dentro de su álbum. Solo lo tienen las
canciones con álbum, y en cada álbum van de 1 a n sin huecos ni repetidos. Al entrar en un álbum, una canción recibe el
siguiente número; al salir, lo pierde y las demás se renumeran. Un catálogo sin "track" (anterior a ADR-0026) se migra
con normalize_tracks: las canciones sin número van al final, en el orden de hoy (título sin mayúsculas, y después su
posición en el catálogo, que es el orden de data/songs.json).
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
    """Crea o reutiliza el álbum estable de una playlist; el id de YouTube/Spotify queda solo en el catálogo interno.

    Emparejado en dos pasos para que al importar un álbum/lista «vaya todo al mismo sitio» (ADR-0044):
    1) por `youtube_playlist_id` exacto (misma fuente re-importada);
    2) si no, por NOMBRE (sin distinguir mayúsculas ni espacios), para unirse a un álbum que ya tengas con ese nombre
       aunque viniera de otra fuente (p. ej. ya existía de YouTube y ahora llega de Spotify) en vez de duplicarlo.
    Si no hay ninguno, se crea.
    """
    for folder in data["folders"]:
        if folder.get("youtube_playlist_id") == playlist_id:
            changed = folder.get("name") != name
            folder["name"] = name
            return folder, changed

    target = name.strip().casefold()
    for folder in data["folders"]:
        if (folder.get("name") or "").strip().casefold() == target:
            # Álbum existente con el mismo nombre: unir las canciones ahí. No se pisa su id de fuente si ya tenía uno.
            folder.setdefault("youtube_playlist_id", playlist_id)
            return folder, False

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


def sync_youtube_album_artist(data: dict, folder_id: str) -> bool:
    """Deriva el artista del álbum si todas sus canciones conocidas tienen el mismo artista."""
    folder = find_folder(data, folder_id)
    if not folder.get("youtube_playlist_id"):
        return False
    artists = {
        song["artist"].strip()
        for song in data["songs"]
        if song.get("folder_id") == folder_id
        and isinstance(song.get("artist"), str)
        and song["artist"].strip()
    }
    artist = next(iter(artists)) if len(artists) == 1 else ""
    previous_artist = folder.get("artist") or ""
    _set_artist(folder, artist)
    return previous_artist != artist


def add_song(data: dict, *, sha256: str, title: str, license: str, source: str,
             codec: str, duration_s: float, size_bytes: int, artist: str = "",
             year: int | None = None, gain_db: float | None = None) -> tuple[dict, bool]:
    """Devuelve (canción, creada). Si el contenido ya existe, no duplica (ni cambia su artista ni su año).
    artist y year llegan ya validados (por ejemplo, de los metadatos de Internet Archive).
    gain_db (ADR-0046) es la ganancia de normalización de volumen, opcional; solo se guarda cuando se conoce."""
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
    if gain_db is not None:
        song["gain_db"] = round(float(gain_db), 1)
    data["songs"].append(song)
    return song, True


def set_gain(data: dict, song_id: str, gain_db: float | None) -> bool:
    """Fija (o quita, con None) la ganancia de normalización de una canción (ADR-0046). Idempotente: devuelve si cambió algo.
    La usa el backfill scripts/analizar_volumen.py para rellenar `gain_db` del catálogo existente."""
    song = find_song(data, song_id)
    new_value = round(float(gain_db), 1) if gain_db is not None else None
    old_value = song.get("gain_db")
    if new_value is None:
        if "gain_db" in song:
            del song["gain_db"]
            return True
        return False
    if old_value == new_value:
        return False
    song["gain_db"] = new_value
    return True


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
    previous_folder_id = song.get("folder_id")
    if "folder_id" in fields and not fields["folder_id"]:
        fields["folder_id"] = None
    new_folder_id = fields.pop("folder_id", previous_folder_id)
    song.update(fields)
    if new_folder_id != previous_folder_id:
        _move_to_folder(data, song, new_folder_id)
        fields["folder_id"] = new_folder_id
    if "artist" in fields or "folder_id" in fields:
        for folder_id in {previous_folder_id, song.get("folder_id")} - {None}:
            sync_youtube_album_artist(data, folder_id)
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
    """Borra la carpeta. Sus canciones y subcarpetas suben al nivel superior. Las canciones entran en la carpeta superior
    al final y en su orden; si no hay carpeta superior, pierden el número de pista."""
    folder = find_folder(data, folder_id)
    parent = folder["parent_id"]
    for song in songs_in_folder(data, folder_id):
        _move_to_folder(data, song, parent)
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


# --- Números de pista (ADR-0026) -------------------------------------------------------------------------------------


def _valid_track(value: object) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and value >= 1


def _current_order_key(song: dict, index: int) -> tuple:
    """El orden de hoy de una canción sin número de pista: su título sin mayúsculas y, a igualdad, su posición en el
    catálogo (es como ordena publish.sync_public data/songs.json, y la web y la APK conservan ese orden)."""
    return (str(song.get("title") or "").lower(), index)


def songs_in_folder(data: dict, folder_id: str | None) -> list[dict]:
    """Canciones de una carpeta en su orden: primero las que tienen número de pista (de menor a mayor) y después las
    que no lo tienen, en el orden de hoy. Sin carpeta (None), lista vacía."""
    if folder_id is None:
        return []
    numbered, unnumbered = [], []
    for index, song in enumerate(data["songs"]):
        if song.get("folder_id") != folder_id:
            continue
        if _valid_track(song.get("track")):
            numbered.append(((song["track"], index), song))
        else:
            unnumbered.append((_current_order_key(song, index), song))
    numbered.sort(key=lambda item: item[0])
    unnumbered.sort(key=lambda item: item[0])
    return [song for _, song in numbered] + [song for _, song in unnumbered]


def _renumber(data: dict, folder_id: str | None) -> bool:
    """Deja las pistas de la carpeta de 1 a n, sin huecos, en su orden. Devuelve si cambió algo."""
    changed = False
    for position, song in enumerate(songs_in_folder(data, folder_id), start=1):
        if song.get("track") != position or not _valid_track(song.get("track")):
            song["track"] = position
            changed = True
    return changed


def _move_to_folder(data: dict, song: dict, folder_id: str | None) -> None:
    """Saca la canción de su carpeta (renumera las que quedan) y la pone al final de folder_id (o sin carpeta y sin
    número de pista, si es None)."""
    previous = song.get("folder_id")
    song["folder_id"] = None
    song.pop("track", None)
    _renumber(data, previous)
    if folder_id is None:
        return
    _renumber(data, folder_id)
    song["folder_id"] = folder_id
    song["track"] = len(songs_in_folder(data, folder_id))


def normalize_tracks(data: dict) -> bool:
    """Migra y repara los números de pista de todo el catálogo: en cada carpeta, de 1 a n en su orden (las canciones
    sin número, al final y en el orden de hoy); las canciones sin carpeta no tienen número. Devuelve si cambió algo.
    Es idempotente: sobre un catálogo ya normalizado no cambia nada."""
    changed = False
    folder_ids = []
    for song in data["songs"]:
        folder_id = song.get("folder_id")
        if folder_id is None:
            if "track" in song:
                song.pop("track")
                changed = True
        elif folder_id not in folder_ids:
            folder_ids.append(folder_id)
    for folder_id in folder_ids:
        changed = _renumber(data, folder_id) or changed
    return changed


def order_album(data: dict, folder_id: str, song_ids: list[str]) -> list[dict]:
    """Ordena el álbum: song_ids tiene que ser exactamente la lista de sus canciones (sin repetidos, ni de menos, ni de
    más), en el orden nuevo. Asigna track 1..n. Si la lista no coincide, no cambia nada."""
    find_folder(data, folder_id)
    if len(set(song_ids)) != len(song_ids):
        raise CatalogError("la lista del orden tiene canciones repetidas")
    current = {song["id"] for song in data["songs"] if song.get("folder_id") == folder_id}
    wanted = set(song_ids)
    missing = current - wanted
    extra = wanted - current
    if missing or extra:
        parts = []
        if missing:
            parts.append(f"faltan {len(missing)} canción(es) del álbum")
        if extra:
            parts.append(f"sobran {len(extra)} canción(es) que no están en el álbum")
        raise CatalogError(
            "la lista del orden no coincide con las canciones del álbum (" + " y ".join(parts)
            + "); vuelve a cargar la biblioteca y ordénalo de nuevo"
        )
    by_id = {song["id"]: song for song in data["songs"] if song.get("folder_id") == folder_id}
    ordered = [by_id[song_id] for song_id in song_ids]
    for position, song in enumerate(ordered, start=1):
        song["track"] = position
    return ordered
