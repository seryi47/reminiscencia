"""Copia todo el audio de audio-library/audio/ al bucket privado de R2 y comprueba los tamaños (ADR-0024, parte 1).

Es el paso previo a sacar el audio de Git (parte 2): después, el bucket privado es la única copia del audio de las
canciones privadas. Nunca borra nada, ni del bucket ni del repositorio. Sube lo que falta o tiene otro tamaño y, al
final, vuelve a listar el bucket y comprueba que cada fichero local está con el mismo tamaño y que cada canción del
catálogo tiene su audio. Sale con código 1 si algo no cuadra. Lo ejecuta el workflow manual migrar-audio-privado.yml.

Uso:
    python scripts/migrar_audio_privado.py            # simulación: solo cuenta
    python scripts/migrar_audio_privado.py --aplicar  # R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY y
                                                      # R2_PRIVATE_BUCKET
"""

import argparse
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))

from sonidos.r2 import (  # noqa: E402
    R2Error, apply_plan, bucket_from_env, catalog_keys, local_audio, missing_variables, plan_sync,
)

AUDIO_DIR = Path("audio-library") / "audio"
CATALOG = Path("audio-library") / "indexes" / "catalog.json"


def verify(local: dict[str, Path], remote: dict[str, int], catalog: list[str]) -> list[str]:
    """Problemas tras la copia: ficheros locales que no están en el bucket con su tamaño y canciones del catálogo sin
    audio en el bucket."""
    problems = [f"{key}: {'falta' if key not in remote else 'tamaño distinto'} en el bucket privado"
                for key, path in sorted(local.items()) if remote.get(key) != path.stat().st_size]
    problems += [f"{key}: canción del catálogo sin audio en el bucket privado" for key in catalog if key not in remote]
    return problems


def main(argv: list[str] | None = None, *, env=None, client=None) -> int:
    parser = argparse.ArgumentParser(description="Copia el audio de la biblioteca al bucket privado de R2.")
    parser.add_argument("--aplicar", action="store_true", help="sube de verdad; sin esto solo se simula")
    parser.add_argument("--raiz", type=Path, default=ROOT)
    args = parser.parse_args(argv)
    env = os.environ if env is None else env

    try:
        local = local_audio(args.raiz / AUDIO_DIR)
        catalog = catalog_keys(args.raiz / CATALOG)
    except R2Error as error:
        print(f"Error: {error}")
        return 1
    total_mb = sum(path.stat().st_size for path in local.values()) / 1_048_576
    print(f"Audio local: {len(local)} ficheros ({total_mb:.1f} MB); canciones en el catálogo: {len(catalog)}.")
    sin_fichero = [key for key in catalog if key not in local]
    if sin_fichero:
        print(f"Aviso: {len(sin_fichero)} canción(es) del catálogo sin audio local (se comprobará si ya están en el bucket).")
    missing = missing_variables(env, "R2_PRIVATE_BUCKET")
    if missing:
        if args.aplicar:
            print(f"Faltan variables de entorno: {', '.join(missing)}")
            return 1
        print("Simulación sin credenciales: no se ha cambiado nada.")
        return 0
    try:
        bucket = bucket_from_env(env, "R2_PRIVATE_BUCKET", client=client)
        plan = plan_sync(local, bucket.list_sizes())
        print(f"Por subir: {len(plan.upload)}. Ya estaban: {len(plan.unchanged)}. En el bucket y no en local: "
              f"{len(plan.extra)} (no se borran).")
        if not args.aplicar:
            print("Simulación: no se ha cambiado nada.")
            return 0
        result = apply_plan(bucket, local, plan)  # sin delete_extra: nunca borra
        print(result)
        problems = verify(local, dict(bucket.list_sizes()), catalog)
    except (R2Error, OSError) as error:
        print(f"Error: {error}")
        return 1
    except Exception as error:  # noqa: BLE001  (solo el tipo: el registro del workflow es público)
        print(f"Error con el bucket: {type(error).__name__}")
        return 1
    if problems:
        print(f"Comprobación: {len(problems)} problema(s).")
        for problem in problems[:50]:
            print(f"  {problem}")
        return 1
    print(f"Comprobación: los {len(local)} ficheros están en el bucket privado con el mismo tamaño, y las "
          f"{len(catalog)} canciones del catálogo tienen su audio.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
