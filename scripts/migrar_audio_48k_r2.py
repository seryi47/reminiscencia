"""Migración completa de la biblioteca a Opus-48k (ADR-0051). Descarga cada canción del bucket privado de R2,
la re-encoda a 48k si todavía está por encima del umbral, y la deja en `audio-library/audio/` para que
`scripts/sync_r2.py --aplicar` la publique (sube las que hayan cambiado al privado y al público).

Requiere las variables R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY y R2_PRIVATE_BUCKET. No borra nada
del bucket ni toca el público: eso lo hace `sync_r2.py`.

Uso dentro del workflow (.github/workflows/migrar-audio.yml):
    python scripts/migrar_audio_48k_r2.py --aplicar

Local, con las credenciales en un .env:
    python scripts/migrar_audio_48k_r2.py                # simula
    python scripts/migrar_audio_48k_r2.py --aplicar      # descarga y re-encoda de verdad
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "scripts"))
AUDIO_DIR = ROOT / "audio-library" / "audio"
CATALOG = ROOT / "audio-library" / "indexes" / "catalog.json"

# Importamos aquí dentro para no exigir boto3 en una simulación. r2.py construye el bucket con credenciales.
from sonidos.r2 import (  # noqa: E402
    AUDIO_PREFIX, AUDIO_SUFFIX, bucket_from_env, missing_variables,
)
from migrar_audio_48k import (  # type: ignore[import-not-found]  # noqa: E402
    DEFAULT_THRESHOLD_KBPS, SONG_ID, probe_bitrate_bps, transcode_to_48k,
)


def catalog_ids() -> list[str]:
    """Todos los ids de canción del catálogo (fuente: audio-library/indexes/catalog.json)."""
    data = json.loads(CATALOG.read_text(encoding="utf-8"))
    songs = data.get("songs") if isinstance(data, dict) else None
    if not isinstance(songs, list):
        raise SystemExit("catalog.json no tiene la lista de canciones")
    out = []
    for song in songs:
        sid = song.get("id") if isinstance(song, dict) else None
        if isinstance(sid, str) and SONG_ID.fullmatch(sid):
            out.append(sid)
    return sorted(set(out))


def ensure_local_from_r2(ids: list[str]) -> list[str]:
    """Baja a audio-library/audio/<id>.opus los que no estén localmente. Devuelve los ids que están disponibles."""
    missing = missing_variables()
    if missing:
        raise SystemExit(f"faltan variables de entorno de R2: {', '.join(missing)}")
    bucket = bucket_from_env("R2_PRIVATE_BUCKET")
    remote_sizes = bucket.list_sizes(AUDIO_PREFIX)
    AUDIO_DIR.mkdir(parents=True, exist_ok=True)
    present = []
    for sid in ids:
        local = AUDIO_DIR / f"{sid}.opus"
        key = f"{AUDIO_PREFIX}{sid}{AUDIO_SUFFIX}"
        if local.is_file():
            present.append(sid)
            continue
        if key not in remote_sizes:
            print(f"  ! {sid}: no está en el bucket privado, se salta")
            continue
        data = bucket.get(key)
        local.write_bytes(data)
        present.append(sid)
    return present


def run_sync_r2_apply() -> None:
    """Delegado: llama a scripts/sync_r2.py con --aplicar. Lo deja aquí para que el workflow sea de un solo paso."""
    subprocess.run(
        [sys.executable, str(ROOT / "scripts" / "sync_r2.py"), "--aplicar"],
        check=True, cwd=ROOT,
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--aplicar", action="store_true",
                        help="descarga de R2, re-encoda y publica. Sin esto, solo simula.")
    parser.add_argument("--umbral-kbps", type=int, default=DEFAULT_THRESHOLD_KBPS)
    parser.add_argument("--no-publicar", action="store_true",
                        help="deja los ficheros re-encoded en local pero NO llama a sync_r2 (para depurar).")
    args = parser.parse_args()

    ids = catalog_ids()
    print(f"catálogo: {len(ids)} canciones")

    if not args.aplicar:
        print("simulación: no se descarga nada.")
        print("añade --aplicar para bajar de R2, re-encodar y subir el resultado.")
        return 0

    print("descargando lo que falte del bucket privado de R2…")
    available = ensure_local_from_r2(ids)
    print(f"disponibles localmente: {len(available)} (de {len(ids)})")

    print("probando y re-encodando (umbral "
          f"{args.umbral_kbps} kbps)…")
    reencoded = failed = skipped = 0
    bytes_before = bytes_after = 0
    for index, sid in enumerate(available, start=1):
        path = AUDIO_DIR / f"{sid}.opus"
        bps = probe_bitrate_bps(path)
        if bps is None:
            print(f"  ! {sid}: ffprobe falló")
            skipped += 1
            continue
        size_before = path.stat().st_size
        if bps <= args.umbral_kbps * 1000:
            skipped += 1
            continue
        staging = path.with_name(f"{path.stem}.new.opus")
        if not transcode_to_48k(path, staging):
            print(f"  [{index}/{len(available)}] FALLO {sid}")
            staging.unlink(missing_ok=True)
            failed += 1
            continue
        bytes_before += size_before
        staging.replace(path)
        bytes_after += path.stat().st_size
        reencoded += 1
        if index % 25 == 0 or index == len(available):
            saved = (1 - bytes_after / bytes_before) * 100 if bytes_before else 0
            print(f"  [{index}/{len(available)}] re-encoded: {reencoded}, saltos: {skipped}, "
                  f"fallos: {failed}, ahorro acumulado {saved:.1f}%")

    print()
    saved = (1 - bytes_after / bytes_before) * 100 if bytes_before else 0
    print(f"===== Resumen =====")
    print(f"re-encoded: {reencoded}")
    print(f"saltadas (ya a 48k o ffprobe falló): {skipped}")
    print(f"fallidas: {failed}")
    if bytes_before:
        print(f"bytes: {bytes_before / 1024 / 1024:.1f} MiB → {bytes_after / 1024 / 1024:.1f} MiB  (-{saved:.1f} %)")

    if args.no_publicar:
        print("se omite la subida (--no-publicar).")
        return 0 if failed == 0 else 2
    print()
    print("subiendo a R2 (sync_r2.py --aplicar)…")
    run_sync_r2_apply()
    return 0 if failed == 0 else 2


if __name__ == "__main__":
    sys.exit(main())
