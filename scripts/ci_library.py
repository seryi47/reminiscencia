"""Punto de entrada único del workflow biblioteca.yml (ADR-0008).

La petición llega en variables de entorno (ACTION, URL, LICENSE, TITLE, PAYLOAD) que
scripts/issue_request.py deja en GITHUB_ENV tras validarla. Este script nunca lee la línea de
comandos: vuelve a validar la petición con sonidos.issue_request y la aplica:

  import     descarga, convierte y añade la canción al catálogo (sonidos.pipeline)
  organize   crea, renombra, edita (nombre y artista del álbum) o borra carpetas, edita y mueve canciones, ordena un
             álbum (order_album, ADR-0026) y organiza una playlist de YouTube ya catalogada. Antes migra los números de
             pista (catalog.normalize_tracks). Al borrar una carpeta se borra también su portada (ADR-0016).

Siempre termina regenerando la parte pública de la web, para que catálogo y web coincidan.
Imprime el resultado como JSON. Ante cualquier error imprime {"error": "..."} y sale con código 1.
"""

from __future__ import annotations

import json
import os
import sys
from collections.abc import Mapping
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from sonidos import catalog  # noqa: E402
from sonidos.issue_request import request_from_env  # noqa: E402
from sonidos.pipeline import import_url  # noqa: E402
from sonidos.portadas import COVER_ID  # noqa: E402
from sonidos.publish import sync_public  # noqa: E402

CATALOG = ROOT / "audio-library" / "indexes" / "catalog.json"
AUDIO = ROOT / "audio-library" / "audio"
COVERS = ROOT / "audio-library" / "covers"
STAGING = ROOT / "audio-library" / "staging"
WEB = ROOT / "frontend" / "web"


def organize(data: dict, payload: dict) -> dict:
    """Aplica una operación ya validada por sonidos.issue_request.validate_payload."""
    operation = payload["op"]
    if operation == "create_folder":
        return {"folder": catalog.create_folder(data, payload["name"], payload.get("parent_id"), payload.get("artist"))}
    if operation == "rename_folder":
        return {"folder": catalog.rename_folder(data, payload["folder_id"], payload["name"])}
    if operation == "edit_folder":
        if "artist" in payload:
            folder = catalog.edit_folder(data, payload["folder_id"], payload["name"], payload["artist"])
        else:
            folder = catalog.edit_folder(data, payload["folder_id"], payload["name"])
        return {"folder": folder}
    if operation == "delete_folder":
        catalog.delete_folder(data, payload["folder_id"])
        return {"deleted": payload["folder_id"]}
    if operation == "edit_song":
        fields = {key: value for key, value in payload.items() if key not in ("op", "song_id")}
        return {"song": catalog.update_song(data, payload["song_id"], fields)}
    if operation == "move_songs":
        # Atómica: primero se comprueba que existen todas las canciones y el álbum; si falta algo, no cambia nada.
        songs = [catalog.find_song(data, song_id) for song_id in payload["song_ids"]]
        if payload["folder_id"] is not None:
            catalog.find_folder(data, payload["folder_id"])
        updated = [catalog.update_song(data, song["id"], {"folder_id": payload["folder_id"]}) for song in songs]
        return {"songs": updated, "folder_id": payload["folder_id"]}
    if operation == "order_album":
        # Atómica: catalog.order_album comprueba antes de tocar nada que la lista es exactamente la del álbum.
        songs = catalog.order_album(data, payload["folder_id"], payload["song_ids"])
        return {"folder_id": payload["folder_id"], "songs": [{"id": song["id"], "track": song["track"]} for song in songs]}
    if operation == "organize_youtube_playlist":
        tracks = payload["songs"]
        songs = [catalog.find_song(data, track["song_id"]) for track in tracks]
        playlist_id = payload["playlist_id"]
        folder, _ = catalog.youtube_album(data, playlist_id, payload["name"])
        folder_id = folder["id"]
        updated = [
            catalog.update_song(data, song["id"], {"artist": track["artist"], "folder_id": folder_id})
            for song, track in zip(songs, tracks, strict=True)
        ]
        return {"folder": folder, "songs": updated}
    raise catalog.CatalogError(f"operación desconocida: {operation}")


def _remove_cover(folder_id: str) -> None:
    """La portada de una carpeta borrada ya no la usa nadie. Solo ids con portada posible (F + 16 hexadecimales)."""
    if not COVER_ID.fullmatch(folder_id):
        return
    if COVERS.is_symlink():
        raise catalog.CatalogError("enlace simbólico en audio-library/covers")
    cover = COVERS / f"{folder_id}.jpg"
    if cover.is_symlink():
        raise catalog.CatalogError(f"enlace simbólico en la portada {folder_id}.jpg")
    cover.unlink(missing_ok=True)


def run(env: Mapping[str, str]) -> dict:
    request = request_from_env(env)
    if request["action"] == "import":
        result = import_url(
            catalog_path=CATALOG, audio_dir=AUDIO, staging_dir=STAGING,
            url=request["url"], license=request["license"], title=request["title"],
        )
    else:
        data = catalog.load(CATALOG)
        # Migra el catálogo anterior a los números de pista (ADR-0026) antes de aplicar la operación; si ya está
        # migrado, no cambia nada.
        catalog.normalize_tracks(data)
        result = organize(data, request["payload"])
        catalog.save(CATALOG, data)
        if request["payload"]["op"] == "delete_folder":
            _remove_cover(request["payload"]["folder_id"])
    result["web"] = sync_public(catalog_path=CATALOG, audio_dir=AUDIO, web_dir=WEB, covers_dir=COVERS)
    return result


def main() -> int:
    try:
        result = run(os.environ)
    except Exception as error:  # cualquier fallo sale como JSON; el workflow no guarda nada si falla
        print(json.dumps({"error": str(error) or type(error).__name__}, ensure_ascii=False))
        return 1
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
