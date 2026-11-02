"""Empaqueta lo que el procesado cambió en el repositorio, para que el job de publicación lo valide y lo aplique
(ADR-0008). Solo empaqueta el catálogo y el audio: la parte pública (datos de la web y audio publicado) la regenera
la publicación desde el catálogo (ADR-0010). No escribe en git ni en la web: solo deja el paquete en la carpeta
indicada.

Uso dentro del workflow biblioteca.yml (job 'procesar', después de ejecutar la petición):
  python scripts/empaquetar_cambios.py --salida "$RUNNER_TEMP/paquete"
La acción llega en la variable ACTION (la deja scripts/issue_request.py en GITHUB_ENV).
Ante un error imprime {"error": "..."} y sale con código 1.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from sonidos.paquete import PaqueteError, package_processing_changes  # noqa: E402


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Empaqueta los cambios del procesado de la biblioteca.")
    parser.add_argument("--salida", required=True, type=Path)
    args = parser.parse_args(argv)
    try:
        result = package_processing_changes(ROOT, args.salida, action=os.environ.get("ACTION", ""))
    except (PaqueteError, OSError, ValueError) as error:
        print(json.dumps({"error": str(error)}, ensure_ascii=False))
        return 1
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
