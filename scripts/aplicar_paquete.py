"""Valida el paquete del procesado y lo aplica sobre el checkout de main (ADR-0008). Este script corre en el job
'publicar', que tiene permiso de escritura: por eso no ejecuta nada del paquete, solo lee y copia ficheros
después de validarlos (sonidos.paquete).

Uso dentro del workflow biblioteca.yml (job 'publicar'):
  python scripts/aplicar_paquete.py --paquete "$RUNNER_TEMP/paquete"
Deja en GITHUB_ENV las variables ACCION (para el mensaje del commit) y BASE (el HEAD de main al aplicar).
Ante un error imprime {"error": "..."} y sale con código 1, sin cambiar nada del índice más allá de lo validado.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from sonidos.issue_request import write_github_env  # noqa: E402
from sonidos.paquete import PaqueteError, apply_package, head_commit  # noqa: E402


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Valida el paquete de la biblioteca y lo aplica sobre main.")
    parser.add_argument("--paquete", required=True, type=Path)
    parser.add_argument("--raiz", type=Path, default=ROOT)
    args = parser.parse_args(argv)
    try:
        head = head_commit(args.raiz)
        result = apply_package(args.paquete, args.raiz, head=head)
        destination = os.environ.get("GITHUB_ENV", "")
        if destination:
            write_github_env(destination, {"ACCION": result["accion"], "BASE": head})
    except (PaqueteError, OSError, ValueError) as error:
        print(json.dumps({"error": str(error)}, ensure_ascii=False))
        return 1
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
