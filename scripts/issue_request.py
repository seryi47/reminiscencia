"""Valida una petición de biblioteca y la deja en GITHUB_ENV (ADR-0008).

Uso dentro del workflow biblioteca.yml:
  python scripts/issue_request.py --modo incidencia   lee BODY (cuerpo de la incidencia)
  python scripts/issue_request.py --modo manual       lee ACTION, URL, LICENSE, TITLE y PAYLOAD

Ambos modos pasan por sonidos.issue_request. Si la petición es correcta, escribe las variables
de la acción en el fichero indicado por GITHUB_ENV e imprime un resumen JSON sin el payload.
Si no lo es, imprime {"error": "..."} por stdout y sale con código 1.
Ningún valor se interpola en un intérprete de shell: el workflow lo pasa solo por variables de entorno.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from sonidos.issue_request import (  # noqa: E402
    RequestError,
    parse_request,
    request_from_env,
    summarize,
    to_github_env,
    write_github_env,
)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Valida una petición de biblioteca y la deja en GITHUB_ENV.")
    parser.add_argument("--modo", choices=("incidencia", "manual"), required=True)
    args = parser.parse_args(argv)
    try:
        if args.modo == "incidencia":
            request = parse_request(os.environ.get("BODY", ""))
        else:
            request = request_from_env(os.environ)
        destination = os.environ.get("GITHUB_ENV", "")
        if not destination:
            raise RequestError("GITHUB_ENV no está definido; este script solo corre en GitHub Actions")
        write_github_env(destination, to_github_env(request))
    except (ValueError, OSError) as error:
        print(json.dumps({"error": str(error)}, ensure_ascii=False))
        return 1
    print(json.dumps(summarize(request), ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
