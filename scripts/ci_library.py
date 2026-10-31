"""Punto de entrada único del workflow library.yml (ADR-0007).

Lee las entradas de variables de entorno (nunca de la línea de comandos), para que
ningún dato escrito en la web llegue a un intérprete de shell:

  ACTION   import | publish | organize
  URL, LICENSE, TITLE          (import)
  SONG_ID, PUBLIC              (publish: "true" | "false")
  PAYLOAD                      (organize: JSON con "op" y sus campos)

Siempre termina regenerando la parte pública de la web, para que catálogo y web coincidan.
Imprime un JSON con el resultado, que el workflow añade al resumen del trabajo.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from sonidos import catalog  # noqa: E402
from sonidos.pipeline import import_url  # noqa: E402
from sonidos.publish import sync_public  # noqa: E402

CATALOG = ROOT / "audio-library" / "indexes" / "catalog.json"
AUDIO = ROOT / "audio-library" / "audio"
STAGING = ROOT / "audio-library" / "staging"
WEB = ROOT / "frontend" / "web"


def organize(data: dict, payload: dict) -> dict:
    operation = payload.get("op")
    if operation == "create_folder":
        return {"folder": catalog.create_folder(data, payload.get("name", ""), payload.get("parent_id"))}
    if operation == "rename_folder":
        return {"folder": catalog.rename_folder(data, payload["folder_id"], payload.get("name", ""))}
    if operation == "delete_folder":
        catalog.delete_folder(data, payload["folder_id"])
        return {"deleted": payload["folder_id"]}
    if operation == "edit_song":
        fields = {key: value for key, value in payload.items() if key not in ("op", "song_id")}
        return {"song": catalog.update_song(data, payload["song_id"], fields)}
    raise catalog.CatalogError(f"operación desconocida: {operation}")


def run(env: dict) -> dict:
    action = env.get("ACTION", "")
    if action == "import":
        result = import_url(
            catalog_path=CATALOG, audio_dir=AUDIO, staging_dir=STAGING,
            url=env.get("URL", "").strip(), license=env.get("LICENSE", "").strip() or None,
            title=env.get("TITLE", "").strip() or None,
        )
    elif action == "publish":
        data = catalog.load(CATALOG)
        song = catalog.update_song(data, env.get("SONG_ID", ""), {"public": env.get("PUBLIC") == "true"})
        catalog.save(CATALOG, data)
        result = {"song": song}
    elif action == "organize":
        data = catalog.load(CATALOG)
        result = organize(data, json.loads(env.get("PAYLOAD") or "{}"))
        catalog.save(CATALOG, data)
    else:
        raise catalog.CatalogError(f"acción desconocida: {action!r}")

    result["web"] = sync_public(catalog_path=CATALOG, audio_dir=AUDIO, web_dir=WEB)
    return result


def main() -> int:
    try:
        result = run(dict(os.environ))
    except (catalog.CatalogError, ValueError, KeyError, FileNotFoundError) as error:
        print(json.dumps({"error": str(error)}, ensure_ascii=False))
        return 1
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
