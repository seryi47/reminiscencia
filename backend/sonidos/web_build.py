"""Prepara la carpeta de la web (frontend/web) con el audio de reproducción y el índice.

El audio se copia a frontend/web/audio/, que está en .gitignore: se despliega
en Vercel, pero no se versiona en Git (ADR-0003). El índice sí se versiona
porque no contiene rutas locales.
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path

from sonidos.library import Library

PLAYBACK_PROFILE = "opus-64k"


def build_web(library: Library, web_dir: Path) -> list[dict]:
    audio_dir = web_dir / "audio"
    data_dir = web_dir / "data"
    audio_dir.mkdir(parents=True, exist_ok=True)
    data_dir.mkdir(parents=True, exist_ok=True)

    entries = []
    for song in library.list_songs(only_public=True):
        variant = next(
            (item for item in library.variants_for(song["id"]) if item["profile"] == PLAYBACK_PROFILE),
            None,
        )
        if variant is None:
            continue

        target_name = f"{song['id']}.opus"
        shutil.copyfile(variant["path"], audio_dir / target_name)
        entries.append(
            {
                "id": song["id"],
                "title": song["title"],
                "artist": song["artist"],
                "year": song["year"],
                "tags": song["tags"],
                "folder_id": song["folder_id"],
                "duration_s": song["duration_s"],
                "license": song["license"],
                "audio": f"audio/{target_name}",
            }
        )

    (data_dir / "songs.json").write_text(
        json.dumps(entries, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    folders = [
        {"id": item["id"], "name": item["name"], "parent_id": item["parent_id"]}
        for item in library.list_folders()
    ]
    (data_dir / "folders.json").write_text(
        json.dumps(folders, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return entries
