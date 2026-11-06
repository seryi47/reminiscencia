"""Vista previa de la operación clean_titles (ADR-0032): qué canciones cambiarían y cómo, sin tocar nada.

Lee un catálogo LOCAL (por defecto, audio-library/indexes/catalog.json de esta copia de trabajo) y, para cada canción
que cambiaría, escribe su id, «antes (artista | título)» y «después (artista | título)», y al final el total. Usa la
misma función que el backend (sonidos.titulos.plan_clean), así que lo que lista es exactamente lo que haría la petición
sobre ese catálogo. No escribe ningún fichero ni usa la red.

Uso: python scripts/vista_previa_titulos.py [catalog.json] [--id S…] [--id S…]
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from sonidos import titulos  # noqa: E402

CATALOG = ROOT / "audio-library" / "indexes" / "catalog.json"


def _shown(song: dict) -> str:
    artist = song["artist"] or "(sin artista)"
    return f"{artist} | {song['title']}"


def preview(data: dict, song_ids: list[str] | None = None) -> list[str]:
    """Las líneas de la vista previa: una por canción que cambia y, al final, el total."""
    changes = titulos.plan_clean(data, song_ids)
    lines = []
    for change in changes:
        marks = []
        if change["antes"]["artist"] != change["despues"]["artist"]:
            marks.append("artista")
        if change["antes"]["title"] != change["despues"]["title"]:
            marks.append("título")
        lines.append(f"{change['id']}  [{', '.join(marks)}]")
        lines.append(f"    antes:   {_shown(change['antes'])}")
        lines.append(f"    después: {_shown(change['despues'])}")
    total = len(data.get("songs", [])) if song_ids is None else len(song_ids)
    lines.append(f"Total: {len(changes)} de {total} canciones cambiarían.")
    return lines


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Vista previa de clean_titles sobre un catálogo local.")
    parser.add_argument("catalogo", nargs="?", default=str(CATALOG), help="ruta del catalog.json (local)")
    parser.add_argument("--id", action="append", dest="ids", help="solo esta canción (se puede repetir)")
    args = parser.parse_args(argv)
    data = json.loads(Path(args.catalogo).read_text(encoding="utf-8"))
    if args.ids:
        known = {song.get("id") for song in data.get("songs", [])}
        missing = [song_id for song_id in args.ids if song_id not in known]
        if missing:
            print(f"No están en el catálogo: {', '.join(missing)}", file=sys.stderr)
            return 1
    print("\n".join(preview(data, args.ids)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
