"""Sincroniza el audio con los dos buckets de R2 (ADR-0020 y ADR-0024). Por defecto solo muestra el plan (simulación).

- Bucket privado (R2_PRIVATE_BUCKET), la fuente de verdad de todo el audio: recibe el audio de audio-library/audio/ de
  la copia de trabajo que todavía no tenga (en 'publicar', el que acaba de traer el paquete).
- Bucket público (R2_BUCKET): recibe el audio de las canciones de frontend/web/data/songs.json (las públicas) que le
  falte, desde la copia local o desde el bucket privado, y con --borrar-sobrantes pierde el de las despublicadas.
Si una canción pública no tiene audio ni en la copia local ni en ningún bucket, se detiene sin escribir nada (código 1):
'publicar' no sube nada a main. Las canciones del catálogo sin audio en el bucket privado se anotan como aviso.

Lo ejecutan los jobs 'publicar' de buzon.yml y biblioteca.yml antes de subir a main (con --borrar-sobrantes, para que
una canción despublicada deje de oírse), y r2.yml como repaso (sin borrar).

Uso:
    python scripts/sync_r2.py            # simulación: sin credenciales no toca nada y supone los buckets vacíos
    python scripts/sync_r2.py --aplicar  # variables R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
                                         # R2_BUCKET y R2_PRIVATE_BUCKET
    python scripts/sync_r2.py --aplicar --borrar-sobrantes
"""

import argparse
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))

from sonidos.r2 import (  # noqa: E402
    AUDIO_PREFIX, AUDIO_SUFFIX, R2Error, apply_publication, bucket_from_env, catalog_keys, local_audio,
    missing_variables, plan_publication, public_keys,
)

AUDIO_DIR = Path("audio-library") / "audio"
CATALOG = Path("audio-library") / "indexes" / "catalog.json"
SONGS_JSON = Path("frontend") / "web" / "data" / "songs.json"
BUCKETS = ("R2_BUCKET", "R2_PRIVATE_BUCKET")


def _ids(keys: list[str], limit: int = 20) -> str:
    """Ids de canción (S + 16 hexadecimales, ya validados): se pueden escribir en el registro público del job."""
    ids = [key[len(AUDIO_PREFIX):-len(AUDIO_SUFFIX)] for key in keys[:limit]]
    return ", ".join(ids) + (" …" if len(keys) > limit else "")


def main(argv: list[str] | None = None, *, env=None, client=None) -> int:
    parser = argparse.ArgumentParser(description="Sincroniza el audio con los buckets privado y público de R2.")
    parser.add_argument("--aplicar", action="store_true", help="escribe de verdad; sin esto solo se simula")
    parser.add_argument("--borrar-sobrantes", action="store_true", help="borra del público lo que ya no es público")
    parser.add_argument("--raiz", type=Path, default=ROOT, help="raíz del repositorio (por defecto, la de este script)")
    args = parser.parse_args(argv)
    env = os.environ if env is None else env

    try:
        local = local_audio(args.raiz / AUDIO_DIR)
        wanted = public_keys(args.raiz / SONGS_JSON)
        everything = catalog_keys(args.raiz / CATALOG)
    except R2Error as error:
        print(f"Error: {error}")
        return 1
    missing = missing_variables(env, *BUCKETS)
    private = public = None
    private_sizes: dict[str, int] = {}
    public_sizes: dict[str, int] = {}
    if missing:
        if args.aplicar:
            print(f"Faltan variables de entorno: {', '.join(missing)}")
            return 1
        print(f"Simulación sin credenciales ({len(wanted)} canciones públicas); los buckets se suponen vacíos.")
    else:
        try:
            private = bucket_from_env(env, "R2_PRIVATE_BUCKET", client=client)
            public = bucket_from_env(env, "R2_BUCKET", client=client)
            private_sizes = dict(private.list_sizes())
            public_sizes = dict(public.list_sizes())
        except R2Error as error:
            print(f"No se pudo leer un bucket: {error}")
            return 1
        except Exception as error:  # noqa: BLE001  (solo el tipo: el registro del workflow es público)
            print(f"No se pudo leer un bucket: {type(error).__name__}")
            return 1

    plan = plan_publication(
        local=local, private=private_sizes, public_keys=wanted, public=public_sizes, catalog=everything,
    )
    to_private_mb = sum(local[key].stat().st_size for key in plan.to_private) / 1_048_576
    print(
        f"Al bucket privado: {len(plan.to_private)} ({to_private_mb:.1f} MB). "
        f"Al público desde la copia local: {len(plan.public_from_local)}; desde el privado: "
        f"{len(plan.public_from_private)}. Sin cambios en el público: {len(plan.public_unchanged)}. "
        f"Sobrantes en el público: {len(plan.public_extra)}."
    )
    if plan.not_in_private and private is not None:
        print(f"::warning title=R2::{len(plan.not_in_private)} canción(es) del catálogo sin audio en el bucket privado: "
              f"{_ids(plan.not_in_private)}")
    if plan.missing:
        if private is None:
            # Sin credenciales no se puede saber si el audio está en los buckets (ADR-0024: la copia local no lo tiene).
            print(f"Sin audio local (no se comprueban los buckets sin credenciales): {len(plan.missing)} canción(es) "
                  "pública(s).")
        else:
            print(f"Error: falta el audio de {len(plan.missing)} canción(es) pública(s) en la copia local y en los dos "
                  f"buckets: {_ids(plan.missing)}")
            return 1
    if not args.aplicar or private is None or public is None:
        print("Simulación: no se ha cambiado nada.")
        return 0
    try:
        result = apply_publication(private, public, local, plan, delete_extra=args.borrar_sobrantes)
    except (R2Error, OSError) as error:
        print(f"Error: {error}")
        return 1
    except Exception as error:  # noqa: BLE001  (solo el tipo: el registro del workflow es público)
        print(f"Error al escribir en un bucket: {type(error).__name__}")
        return 1
    print(result)
    return 0


if __name__ == "__main__":
    sys.exit(main())
