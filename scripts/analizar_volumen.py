"""Backfill de normalización de volumen (ADR-0046): mide la sonoridad (EBU R128 / LUFS) del audio de cada canción con ffmpeg
y guarda su `gain_db` en el catálogo, para que los reproductores igualen el volumen entre canciones.

Necesita ffmpeg y el audio en `audio-library/audio/<id>.opus` (como lo tienen los runners de los workflows tras recoger de
R2). Idempotente: por defecto solo mide las que aún no tienen `gain_db`. Con `--force`, remide todas. `--limit N` mide como
mucho N por ejecución (para repartir el coste en tandas). No sube nada: solo reescribe el catálogo local; el `publish` ya
copia `gain_db` a `data/songs.json`.

Uso:
  python scripts/analizar_volumen.py [--catalog RUTA] [--audio-dir RUTA] [--target -16] [--force] [--limit N] [--dry-run]
"""

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from sonidos import catalog, loudness  # noqa: E402

CATALOG = ROOT / "audio-library" / "indexes" / "catalog.json"
AUDIO_DIR = ROOT / "audio-library" / "audio"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Calcula y guarda gain_db (normalización de volumen) en el catálogo.")
    parser.add_argument("--catalog", type=Path, default=CATALOG)
    parser.add_argument("--audio-dir", type=Path, default=AUDIO_DIR)
    parser.add_argument("--target", type=float, default=loudness.LOUDNESS_TARGET_LUFS, help="LUFS de referencia (por defecto -16)")
    parser.add_argument("--force", action="store_true", help="remide también las que ya tienen gain_db")
    parser.add_argument("--limit", type=int, default=None, help="mide como mucho N canciones (tandas)")
    parser.add_argument("--dry-run", action="store_true", help="no guarda el catálogo; solo informa")
    args = parser.parse_args(argv)

    data = catalog.load(args.catalog)
    summary = loudness.backfill_gain(
        data, args.audio_dir, target=args.target, force=args.force, limit=args.limit,
    )
    if summary["actualizadas"] > 0 and not args.dry_run:
        catalog.save(args.catalog, data)
    print(
        "Normalización de volumen: "
        f"{summary['actualizadas']} actualizadas, {summary['medidas']} medidas, "
        f"{summary['omitidas']} ya tenían, {summary['sin_audio']} sin audio, {summary['sin_medir']} no se pudieron medir"
        + (" (dry-run, no guardado)" if args.dry_run else "")
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
