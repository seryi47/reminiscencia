"""Sincroniza lo que se publica en la web pública (frontend/web) con el catálogo (ADR-0007, ADR-0008).

- Comprueba que existe el audio de cada canción con public=true. El audio público ya no se copia a la web: lo sirve
  Cloudflare R2 (ADR-0020, fase 3), y scripts/sync_r2.py lo sube desde audio-library/audio/ antes de publicar.
- Borra de frontend/web/audio/ cualquier audio que quede de antes (la carpeta ya no se usa).
- Regenera frontend/web/data/songs.json (solo públicas), folders.json (todas las carpetas)
  y catalog.json (solo las canciones públicas y todas las carpetas, sin rutas de audio ni huellas SHA-256).
- Copia a frontend/web/covers/ las portadas de las canciones públicas y de todas las carpetas (ADR-0016), desde
  audio-library/covers/, y borra las que sobran. Las canciones y carpetas con portada llevan "cover": "covers/<id>.jpg";
  las carpetas con artista, "artist". Los dos campos solo aparecen cuando tienen valor.
Vercel sirve solo frontend/web (y redirige /audio/<id>.opus a R2); el audio privado de audio-library/ nunca llega al
público, porque sync_r2 solo sube las canciones de data/songs.json.
Los metadatos de las canciones no publicadas (título, artista, origen...) tampoco salen de audio-library/:
la web es pública y catalog.json forma parte de ella (ADR-0008).
"""

from __future__ import annotations

import filecmp
import json
import re
import shutil
from pathlib import Path

from sonidos import catalog
from sonidos.portadas import COVER_NAME, cover_ref

PUBLIC_FIELDS = ("id", "title", "artist", "year", "tags", "folder_id", "duration_s", "license")
CATALOG_SONG_FIELDS = (
    "id", "title", "artist", "year", "tags", "folder_id", "license", "source", "duration_s", "public",
)
# El identificador da nombre al fichero de audio: solo el formato de la biblioteca, nunca una ruta (ADR-0010).
SONG_ID = re.compile(r"S[0-9a-f]{16}")


def _cover_of(item: dict) -> str | None:
    """El campo "cover" de una canción o carpeta, comprobado: solo "covers/<id>.jpg" con su propio id. Cualquier otro
    valor (otra ruta, otro id) es un catálogo corrupto y detiene la regeneración."""
    cover = item.get("cover")
    if cover is None:
        return None
    try:
        expected = cover_ref(item.get("id"))
    except ValueError as error:
        raise ValueError(f"portada en un elemento cuyo id no admite portada: {item.get('id')!r}") from error
    if cover != expected:
        raise ValueError(f"portada no válida en {item.get('id')!r}: {cover!r}")
    return cover


def sync_public(*, catalog_path: Path, audio_dir: Path, web_dir: Path, covers_dir: Path | None = None) -> dict:
    """covers_dir: las portadas de la biblioteca; por defecto, la carpeta covers junto a audio_dir
    (audio-library/covers)."""
    data = catalog.load(catalog_path)
    covers_dir = audio_dir.parent / "covers" if covers_dir is None else covers_dir
    web_audio = web_dir / "audio"
    web_data = web_dir / "data"
    web_covers = web_dir / "covers"
    web_data.mkdir(parents=True, exist_ok=True)

    public = [song for song in data["songs"] if song.get("public") is True]
    for song in public:
        if not isinstance(song.get("id"), str) or not SONG_ID.fullmatch(song["id"]):
            raise ValueError(f"identificador de canción no válido en la parte pública: {song.get('id')!r}")
    public_names = {f"{song['id']}.opus" for song in public}

    for name in sorted(public_names):
        source = audio_dir / name
        if source.is_symlink() or not source.is_file():
            raise FileNotFoundError(f"falta el audio de {name} en {audio_dir}")
    # El audio público lo sirve R2: lo que quede en frontend/web/audio/ es de antes de la fase 3 y se borra.
    if web_audio.is_dir() and not web_audio.is_symlink():
        for stale in web_audio.glob("*.opus"):
            stale.unlink()

    song_covers = {song["id"]: _cover_of(song) for song in public}
    folder_covers = {folder["id"]: _cover_of(folder) for folder in data["folders"]}
    cover_names = {cover.split("/", 1)[1] for cover in (*song_covers.values(), *folder_covers.values()) if cover}
    for name in cover_names:
        source = covers_dir / name
        if source.is_symlink() or not source.is_file():
            raise FileNotFoundError(f"falta la portada {name} en {covers_dir}")
        target = web_covers / name
        web_covers.mkdir(parents=True, exist_ok=True)
        if target.is_symlink():
            raise ValueError(f"enlace simbólico en las portadas publicadas: {name}")
        if not target.exists() or not filecmp.cmp(source, target, shallow=False):
            shutil.copyfile(source, target)
    if web_covers.is_dir():
        for stale in web_covers.iterdir():
            # Solo se borra lo que tiene nombre de portada; nada más puede haber llegado ahí desde el catálogo.
            if COVER_NAME.fullmatch(stale.name) and stale.name not in cover_names:
                stale.unlink()

    songs = []
    for song in public:
        entry = {key: song.get(key) for key in PUBLIC_FIELDS}
        entry["tags"] = list(song.get("tags") or [])
        entry["audio"] = f"audio/{song['id']}.opus"
        if song_covers[song["id"]]:
            entry["cover"] = song_covers[song["id"]]
        songs.append(entry)
    songs.sort(key=lambda item: item["title"].lower())

    (web_data / "songs.json").write_text(json.dumps(songs, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    folders = []
    for folder in data["folders"]:
        entry = {"id": folder["id"], "name": folder["name"], "parent_id": folder["parent_id"]}
        artist = folder.get("artist")
        if isinstance(artist, str) and artist.strip():
            entry["artist"] = artist.strip()
        if folder_covers[folder["id"]]:
            entry["cover"] = folder_covers[folder["id"]]
        folders.append(entry)
    (web_data / "folders.json").write_text(json.dumps(folders, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    catalog_songs = []
    for song in public:
        entry = {key: song.get(key) for key in CATALOG_SONG_FIELDS}
        entry["tags"] = list(song.get("tags") or [])
        if song_covers[song["id"]]:
            entry["cover"] = song_covers[song["id"]]
        catalog_songs.append(entry)
    catalog_songs.sort(key=lambda item: ((item["title"] or "").lower(), item["id"]))
    catalog_view = {"songs": catalog_songs, "folders": folders}
    (web_data / "catalog.json").write_text(json.dumps(catalog_view, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    return {"public": len(songs), "catalog_songs": len(catalog_songs), "folders": len(folders),
            "covers": len(cover_names)}
