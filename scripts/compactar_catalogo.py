"""Compactación del catálogo (ADR-0052).

Lee `audio-library/indexes/catalog.json` y genera un catálogo compactado quitando campos redundantes o derivables:
  * `codec`: solo se mantiene si es distinto del valor por defecto (`opus`), que es el 95 %+ de los casos.
  * `size_bytes`: se omite (derivable del objeto R2 vía HEAD; ahorra ~5 KB por 674 canciones).
  * `added_at`: se compacta a `YYYY-MM-DD` cuando se puede (todas las horas de la misma hora/día en el mismo folder).

Escribe el resultado en `~/Desktop/catalogo-compacto.json` y reporta el ahorro en bytes (serialización compacta,
sin espacios). No sube nada al servidor; solo informe.

Uso:
    python3 scripts/compactar_catalogo.py
    python3 scripts/compactar_catalogo.py --source otro_catalogo.json --out /ruta/salida.json
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_SOURCE = ROOT / "audio-library" / "indexes" / "catalog.json"
DEFAULT_DEST = Path.home() / "Desktop" / "catalogo-compacto.json"
DEFAULT_CODEC = "opus"
SIZE_FIELD = "size_bytes"


def _compact_added_at(value: Any) -> Any:
    """Si `added_at` acaba en una hora que no aporta (00:00:00 UTC) se queda solo la fecha. Resto intacto."""
    if not isinstance(value, str):
        return value
    # YYYY-MM-DDT00:00:00(Z|+00:00) → YYYY-MM-DD
    if value.endswith("T00:00:00Z") or value.endswith("T00:00:00+00:00"):
        return value.split("T", 1)[0]
    return value


def compactar_cancion(song: dict) -> dict:
    """Aplica reducciones conservando orden de campos para que el diff humano sea pequeño."""
    out: dict[str, Any] = {}
    for k, v in song.items():
        if k == "codec" and v == DEFAULT_CODEC:
            continue
        if k == SIZE_FIELD:
            continue
        if k == "added_at":
            out[k] = _compact_added_at(v)
            continue
        out[k] = v
    return out


def compactar_catalogo(catalog: dict) -> dict:
    out = {k: v for k, v in catalog.items() if k != "songs"}
    out["songs"] = [compactar_cancion(s) for s in catalog.get("songs", [])]
    return out


def _bytes_of(obj: dict) -> int:
    return len(json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--out", type=Path, default=DEFAULT_DEST)
    args = parser.parse_args(argv)
    if not args.source.exists():
        print(f"[ERROR] no existe el catálogo en {args.source}", file=sys.stderr)
        return 1
    catalog = json.loads(args.source.read_text(encoding="utf-8"))
    before = _bytes_of(catalog)
    compacted = compactar_catalogo(catalog)
    after = _bytes_of(compacted)
    args.out.write_text(json.dumps(compacted, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    ratio = (1 - after / before) * 100 if before else 0
    print(f"canciones            : {len(catalog.get('songs', []))}")
    print(f"tamaño original      : {before:,} bytes")
    print(f"tamaño compactado    : {after:,} bytes")
    print(f"ahorro               : {before - after:,} bytes ({ratio:.1f} %)")
    print(f"salida               : {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
