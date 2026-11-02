"""Punto de entrada único del workflow biblioteca.yml (ADR-0008).

La petición llega en variables de entorno (ACTION, URL, LICENSE, TITLE, PAYLOAD) que
scripts/issue_request.py deja en GITHUB_ENV tras validarla. Este script nunca lee la línea de
comandos: vuelve a validar la petición con sonidos.issue_request y la aplica:

  import     descarga, convierte y añade la canción al catálogo (sonidos.pipeline)
  organize   crea, renombra o borra carpetas y edita canciones, incluida su publicación (public)

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
from sonidos.publish import sync_public  # noqa: E402

CATALOG = ROOT / "audio-library" / "indexes" / "catalog.json"
AUDIO = ROOT / "audio-library" / "audio"
STAGING = ROOT / "audio-library" / "staging"
WEB = ROOT / "frontend" / "web"


def organize(data: dict, payload: dict) -> dict:
    """Aplica una operación ya validada por sonidos.issue_request.validate_payload."""
    operation = payload["op"]
    if operation == "create_folder":
        return {"folder": catalog.create_folder(data, payload["name"], payload.get("parent_id"))}
    if operation == "rename_folder":
        return {"folder": catalog.rename_folder(data, payload["folder_id"], payload["name"])}
    if operation == "delete_folder":
        catalog.delete_folder(data, payload["folder_id"])
        return {"deleted": payload["folder_id"]}
    if operation == "edit_song":
        fields = {key: value for key, value in payload.items() if key not in ("op", "song_id")}
        return {"song": catalog.update_song(data, payload["song_id"], fields)}
    raise catalog.CatalogError(f"operación desconocida: {operation}")


def run(env: Mapping[str, str]) -> dict:
    request = request_from_env(env)
    if request["action"] == "import":
        result = import_url(
            catalog_path=CATALOG, audio_dir=AUDIO, staging_dir=STAGING,
            url=request["url"], license=request["license"], title=request["title"],
        )
    else:
        data = catalog.load(CATALOG)
        result = organize(data, request["payload"])
        catalog.save(CATALOG, data)
    result["web"] = sync_public(catalog_path=CATALOG, audio_dir=AUDIO, web_dir=WEB)
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
