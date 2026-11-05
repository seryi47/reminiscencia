"""Subidas de la web y la APK en el bucket privado de R2 (sonidos.entrada; ADR-0017 y ADR-0024).

  python scripts/entrada_r2.py recoger --salida "$RUNNER_TEMP/entrada"
      Job 'recoger' de buzon.yml: descarga las subidas completas (entrada/<UUID>/ con manifiesto) a la carpeta de
      salida, que viaja como artefacto a 'procesar'. Escribe en GITHUB_OUTPUT 'cantidad' (cuántas) e 'ids' (sus UUID,
      separados por espacios). Solo lee del bucket.
  python scripts/entrada_r2.py limpiar
      Job 'publicar', después de subir a main: borra entrada/<UUID>/ de las subidas de la variable IDS (la salida 'ids'
      de 'recoger'). Solo acepta UUID.

Variables: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY y R2_PRIVATE_BUCKET. Solo biblioteca estándar. En el
registro (público) solo se escriben números y UUID, nunca nombres de archivo ni respuestas de R2.
"""

import argparse
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))

from sonidos.entrada import cleanup, collect, valid_ids  # noqa: E402
from sonidos.r2 import R2Error, bucket_from_env, missing_variables  # noqa: E402


def _output(env, values: dict[str, str]) -> None:
    destination = env.get("GITHUB_OUTPUT", "")
    if destination:
        with Path(destination).open("a", encoding="utf-8") as handle:
            for name, value in values.items():
                handle.write(f"{name}={value}\n")


def main(argv: list[str] | None = None, *, env=None, client=None) -> int:
    parser = argparse.ArgumentParser(description="Subidas de la web en el bucket privado de R2.")
    commands = parser.add_subparsers(dest="orden", required=True)
    recoger = commands.add_parser("recoger")
    recoger.add_argument("--salida", required=True, type=Path)
    commands.add_parser("limpiar")
    args = parser.parse_args(argv)
    env = os.environ if env is None else env

    missing = missing_variables(env, "R2_PRIVATE_BUCKET")
    if missing:
        print(f"Faltan variables de entorno: {', '.join(missing)}")
        return 1
    try:
        bucket = bucket_from_env(env, "R2_PRIVATE_BUCKET", client=client)
        if args.orden == "recoger":
            result = collect(bucket, args.salida)
            ids = result["recogidas"]
            _output(env, {"cantidad": str(len(ids)), "ids": " ".join(ids)})
            print(f"Subidas recogidas: {len(ids)} ({result['bytes'] / 1_048_576:.1f} MB). "
                  f"Pendientes para la siguiente ejecución: {result['pendientes']}.")
            if result["no_validas"]:
                print(f"::warning title=Subidas::{len(result['no_validas'])} subida(s) del bucket privado no se pueden "
                      f"recoger y se quedan para revisarlas: {' '.join(result['no_validas'])}")
            return 0
        ids = valid_ids(env.get("IDS", ""))
        print(f"Objetos borrados de entrada/: {cleanup(bucket, ids)} ({len(ids)} subida(s)).")
        return 0
    except R2Error as error:
        print(f"Error: {error}")
        return 1
    except Exception as error:  # noqa: BLE001  (solo el tipo: el registro del workflow es público)
        print(f"Error con el bucket privado: {type(error).__name__}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
