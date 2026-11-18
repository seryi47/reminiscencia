"""Re-encoda las canciones de la biblioteca de opus-64k (contenido histórico, media medida ~60 kbps) a opus-48k
VBR (ADR-0051). Deja una copia de seguridad en `audio-library/audio-pre-adr-0051/<id>.opus` por si hay que
volver atrás, y conserva el id (el id = `S{sha256[:16]}` del fichero original, se queda en el catálogo).

Para publicar el cambio: después de ejecutar esto, `scripts/sync_r2.py --aplicar --borrar-sobrantes` detectará
el cambio de tamaño y subirá los nuevos al bucket privado y al público (ADR-0024).

El móvil y la web descargarán la nueva versión al próximo refresco; las copias ya guardadas en el dispositivo
se **reemplazan** al re-descargar, nunca se borran de la lista «guardado para sin conexión» ni sin consulta.

Uso:
    python scripts/migrar_audio_48k.py                # simula (lista lo que haría)
    python scripts/migrar_audio_48k.py --aplicar      # re-encoda de verdad
    python scripts/migrar_audio_48k.py --aplicar --umbral-kbps 50   # solo re-encodar las > 50 kbps

Requisitos: ffmpeg y ffprobe en PATH (los mismos que ya usa el pipeline).
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
AUDIO_DIR = ROOT / "audio-library" / "audio"
BACKUP_DIR = ROOT / "audio-library" / "audio-pre-adr-0051"
SONG_ID = re.compile(r"S[0-9a-f]{16}")
TARGET_KBPS = 48
# Solo se migra si la canción está hoy por encima de este umbral: así los archivos ya cercanos a 48 kbps (locales,
# o los que ya se migraron en una pasada anterior) no se tocan ni pagan una recodificación con pérdida.
DEFAULT_THRESHOLD_KBPS = 52


def probe_bitrate_bps(path: Path) -> int | None:
    """Tasa efectiva de un .opus en bps, o None si ffprobe falla."""
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-of", "json",
         "-show_entries", "format=bit_rate,duration", str(path)],
        capture_output=True, text=True,
    )
    if result.returncode != 0:
        return None
    try:
        data = json.loads(result.stdout)
        value = data.get("format", {}).get("bit_rate")
        return int(value) if value is not None else None
    except (ValueError, TypeError):
        return None


def transcode_to_48k(source: Path, destination: Path) -> bool:
    """Re-encoda `source` a `destination` a opus-48k VBR. True si quedó un fichero no vacío."""
    destination.parent.mkdir(parents=True, exist_ok=True)
    result = subprocess.run(
        ["ffmpeg", "-y", "-v", "error",
         "-i", str(source),
         "-map", "0:a:0", "-vn", "-map_metadata", "-1",
         "-c:a", "libopus", "-b:a", f"{TARGET_KBPS}k", "-vbr", "on",
         str(destination)],
        capture_output=True, text=True,
    )
    if result.returncode != 0:
        destination.unlink(missing_ok=True)
        return False
    return destination.is_file() and destination.stat().st_size > 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--aplicar", action="store_true",
                        help="re-encoda de verdad (si no se pasa, solo simula).")
    parser.add_argument("--umbral-kbps", type=int, default=DEFAULT_THRESHOLD_KBPS,
                        help=f"solo tocar canciones por encima de este bitrate (default: {DEFAULT_THRESHOLD_KBPS}).")
    parser.add_argument("--max", type=int, default=0,
                        help="como mucho esta cantidad (0 = todas).")
    args = parser.parse_args()

    if not AUDIO_DIR.is_dir():
        print(f"error: no existe {AUDIO_DIR}", file=sys.stderr)
        return 1

    songs = sorted(p for p in AUDIO_DIR.glob("*.opus")
                   if SONG_ID.fullmatch(p.stem))
    print(f"analizando {len(songs)} canciones en {AUDIO_DIR.relative_to(ROOT)}…")

    to_migrate: list[tuple[Path, int, int]] = []  # (path, bps_before, size_before)
    skipped = 0
    for song_path in songs:
        bps = probe_bitrate_bps(song_path)
        size = song_path.stat().st_size
        if bps is None:
            print(f"  ! {song_path.name}: ffprobe falló, se salta")
            skipped += 1
            continue
        if bps <= args.umbral_kbps * 1000:
            skipped += 1
            continue
        to_migrate.append((song_path, bps, size))

    print(f"a migrar: {len(to_migrate)} (ya al objetivo o salto: {skipped})")
    if args.max > 0:
        to_migrate = to_migrate[: args.max]
        print(f"  limitando a las primeras {len(to_migrate)}")

    if not to_migrate:
        print("nada que hacer.")
        return 0

    total_before = sum(size for _, _, size in to_migrate)
    print(f"  bytes a migrar hoy: {total_before / 1024 / 1024:.1f} MiB")

    if not args.aplicar:
        print("simulación: no se ha escrito nada. Añade --aplicar para re-encodar.")
        return 0

    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    print(f"copia de seguridad en {BACKUP_DIR.relative_to(ROOT)}/")

    ok = failed = 0
    total_after = 0
    for index, (song_path, bps_before, size_before) in enumerate(to_migrate, start=1):
        backup = BACKUP_DIR / song_path.name
        if not backup.is_file():
            shutil.copy2(song_path, backup)
        # Ojo: ffmpeg elige el formato por la extensión del fichero destino. `.opus.new` no es .opus → falla.
        # Guardamos en `.new.opus` y renombramos al original al terminar.
        staging = song_path.with_name(f"{song_path.stem}.new.opus")
        if not transcode_to_48k(backup, staging):
            print(f"  [{index}/{len(to_migrate)}] FALLO transcodificando {song_path.name}")
            staging.unlink(missing_ok=True)
            failed += 1
            continue
        staging.replace(song_path)
        size_after = song_path.stat().st_size
        total_after += size_after
        if index % 25 == 0 or index == len(to_migrate):
            savings = (1 - total_after / sum(s for _, _, s in to_migrate[:index])) * 100
            print(f"  [{index}/{len(to_migrate)}] OK — acumulado {savings:.1f}% de ahorro")
        ok += 1

    savings_pct = (1 - total_after / total_before) * 100 if total_before else 0
    print()
    print("===== Resumen =====")
    print(f"re-encoded: {ok}")
    print(f"fallos:     {failed}")
    print(f"bytes antes: {total_before / 1024 / 1024:.1f} MiB")
    print(f"bytes ahora: {total_after / 1024 / 1024:.1f} MiB  (-{savings_pct:.1f} %)")
    print()
    print("próximo paso: `python scripts/sync_r2.py --aplicar --borrar-sobrantes` para publicar.")
    return 0 if failed == 0 else 2


if __name__ == "__main__":
    sys.exit(main())
