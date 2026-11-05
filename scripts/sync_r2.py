"""Sincroniza frontend/web/audio con el bucket de R2 (ADR-0020). Por defecto solo muestra el plan (simulación).

Uso:
    python scripts/sync_r2.py            # simulación: no toca el bucket ni necesita credenciales
    python scripts/sync_r2.py --aplicar  # sube lo que falta (variables R2_ACCOUNT_ID, R2_ACCESS_KEY_ID,
                                         # R2_SECRET_ACCESS_KEY y R2_BUCKET)
    python scripts/sync_r2.py --aplicar --borrar-sobrantes
"""

import argparse
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))

from sonidos.r2 import R2Error, S3Bucket, apply_plan, local_audio, plan_sync  # noqa: E402


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Sincroniza el audio público con R2.")
    parser.add_argument("--aplicar", action="store_true", help="sube de verdad; sin esto solo se simula")
    parser.add_argument("--borrar-sobrantes", action="store_true", help="borra del bucket lo que ya no es público")
    args = parser.parse_args(argv)

    local = local_audio(ROOT / "frontend" / "web" / "audio")
    names = ("R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET")
    missing = [name for name in names if not os.environ.get(name)]
    bucket = None
    remote: dict[str, int] = {}
    if missing:
        if args.aplicar:
            print(f"Faltan variables de entorno: {', '.join(missing)}")
            return 1
        print(f"Simulación sin credenciales ({len(local)} canciones públicas); el bucket se supone vacío.")
    else:
        try:
            bucket = S3Bucket(
                account_id=os.environ["R2_ACCOUNT_ID"],
                access_key_id=os.environ["R2_ACCESS_KEY_ID"],
                secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
                bucket=os.environ["R2_BUCKET"],
            )
            remote = dict(bucket.list_sizes())
        except Exception as error:  # noqa: BLE001
            print(f"No se pudo leer el bucket: {type(error).__name__}")
            return 1

    plan = plan_sync(local, remote)
    total_mb = sum(local[key].stat().st_size for key in plan.upload) / 1_048_576
    print(
        f"Por subir: {len(plan.upload)} ({total_mb:.1f} MB). Sin cambios: {len(plan.unchanged)}. "
        f"Sobrantes en el bucket: {len(plan.extra)}."
    )
    if not args.aplicar or bucket is None:
        print("Simulación: no se ha cambiado nada.")
        return 0
    try:
        result = apply_plan(bucket, local, plan, delete_extra=args.borrar_sobrantes)
    except (R2Error, OSError) as error:
        print(f"Error: {error}")
        return 1
    print(result)
    return 0


if __name__ == "__main__":
    sys.exit(main())
