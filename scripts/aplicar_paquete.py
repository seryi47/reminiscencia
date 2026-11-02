"""Valida el paquete del procesado, lo aplica sobre el checkout de main y regenera la parte pública desde el catálogo
(ADR-0008, ADR-0010). Este script corre en el job 'publicar', que tiene permiso de escritura: por eso no ejecuta nada
del paquete, solo lee y copia ficheros después de validarlos (sonidos.paquete). Los datos de la web y el audio
publicado no se aceptan del paquete: se generan de nuevo desde el catálogo y el audio aplicados.

Uso dentro del workflow biblioteca.yml (job 'publicar'):
  python scripts/aplicar_paquete.py --paquete "$RUNNER_TEMP/paquete"
Deja en GITHUB_ENV las variables ACCION (para el mensaje del commit) y BASE (el HEAD de main al aplicar).
Anota en el registro del job lo que la regeneración escribió fuera del paquete (aviso) y lo que el paquete traía y
ha sido sustituido (alarma). Ante un error imprime {"error": "..."} y sale con código 1, sin confirmar nada.
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
from sonidos.paquete import PaqueteError, head_commit, publish_package  # noqa: E402


def _anotar(parte: dict) -> None:
    """Avisos de GitHub Actions en el registro del job. Las rutas son fijas o están validadas (sonidos.paquete)."""
    if parte["sustituidos_del_paquete"]:
        print("::warning title=Parte pública::El paquete traía y la regeneración ha sustituido: "
              + ", ".join(parte["sustituidos_del_paquete"]))
    if parte["regenerados"]:
        print("::notice title=Parte pública::Regenerado desde el catálogo fuera del paquete: "
              + ", ".join(parte["regenerados"]))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Valida y aplica el paquete de la biblioteca, y regenera la parte pública.",
    )
    parser.add_argument("--paquete", required=True, type=Path)
    parser.add_argument("--raiz", type=Path, default=ROOT)
    args = parser.parse_args(argv)
    try:
        head = head_commit(args.raiz)
        result = publish_package(args.paquete, args.raiz, head=head)
        destination = os.environ.get("GITHUB_ENV", "")
        if destination:
            write_github_env(destination, {"ACCION": result["accion"], "BASE": head})
    except (PaqueteError, OSError, ValueError) as error:
        print(json.dumps({"error": str(error)}, ensure_ascii=False))
        return 1
    _anotar(result["parte_publica"])
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
