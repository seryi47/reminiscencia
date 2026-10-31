"""Sincroniza lo que se publica en la web pública (frontend/web) con el catálogo (ADR-0007).

- Copia el audio de las canciones con public=true a frontend/web/audio/.
- Borra de frontend/web/audio/ lo que ya no está publicado.
- Regenera frontend/web/data/songs.json (solo públicas) y folders.json (todas las carpetas).
Vercel sirve solo frontend/web; el audio privado de audio-library/ nunca llega al público.
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path

from sonidos import catalog

PUBLIC_FIELDS = ("id", "title", "artist", "year", "tags", "folder_id", "duration_s", "license")


def sync_public(*, catalog_path: Path, audio_dir: Path, web_dir: Path) -> dict:
    data = catalog.load(catalog_path)
    web_audio = web_dir / "audio"
    web_data = web_dir / "data"
    web_audio.mkdir(parents=True, exist_ok=True)
    web_data.mkdir(parents=True, exist_ok=True)

    public = [song for song in data["songs"] if song.get("public")]
    public_names = {f"{song['id']}.opus" for song in public}

    for name in public_names:
        source = audio_dir / name
        if not source.exists():
            raise FileNotFoundError(f"falta el audio de {name} en {audio_dir}")
        target = web_audio / name
        if not target.exists() or target.stat().st_size != source.stat().st_size:
            shutil.copyfile(source, target)
    for stale in web_audio.glob("*.opus"):
        if stale.name not in public_names:
            stale.unlink()

    songs = []
    for song in public:
        entry = {key: song.get(key) for key in PUBLIC_FIELDS}
        entry["tags"] = list(song.get("tags") or [])
        entry["audio"] = f"audio/{song['id']}.opus"
        songs.append(entry)
    songs.sort(key=lambda item: item["title"].lower())

    (web_data / "songs.json").write_text(json.dumps(songs, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    folders = [
        {"id": folder["id"], "name": folder["name"], "parent_id": folder["parent_id"]}
        for folder in data["folders"]
    ]
    (web_data / "folders.json").write_text(json.dumps(folders, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return {"public": len(songs), "folders": len(folders)}
