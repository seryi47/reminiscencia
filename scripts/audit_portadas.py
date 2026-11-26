"""Auditoría de portadas en R2 (ADR-0052).

Lista los objetos bajo `covers/` del bucket público, comprueba su formato real (JPEG vs WebP vs PNG) leyendo los
magic bytes, mide el tamaño total y reporta el ahorro potencial si se convirtiesen a WebP (ratio estimado 30 %).

NO convierte nada. Solo informa.

Uso:
    python3 scripts/audit_portadas.py
    python3 scripts/audit_portadas.py --bucket reminiscencia-audio --sample 50

Requiere `wrangler` en el PATH (se usa `wrangler r2 bucket list` + `wrangler r2 object get` con `--remote`). Si no
hay wrangler autenticado, el script se limita a estimar sin leer magic bytes.
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path


DEFAULT_BUCKET = "reminiscencia-audio"
COVERS_PREFIX = "covers/"


def detect_mime(buf: bytes) -> str:
    if buf.startswith(b"\xff\xd8\xff"): return "image/jpeg"
    if buf.startswith(b"\x89PNG\r\n\x1a\n"): return "image/png"
    if buf[:4] == b"RIFF" and buf[8:12] == b"WEBP": return "image/webp"
    if buf.startswith(b"GIF8"): return "image/gif"
    return "application/octet-stream"


def _list_bucket(bucket: str) -> list[dict]:
    """wrangler no expone `r2 object list` en el plan abierto. Fallback: usa el endpoint del Worker
    `/api/catalogo/storage-report` para al menos conocer tamaño agregado de covers/.
    Devuelve [] con un warning si no podemos listar objetos individuales."""
    print("[INFO] wrangler no soporta `r2 object list` en esta versión; solo informe agregado.", file=sys.stderr)
    return []


def _aggregate_from_worker() -> dict | None:
    """Pide el agregado al endpoint /api/catalogo/storage-report del Worker con el X-Auth del llavero."""
    try:
        token = subprocess.run(
            ["security", "find-generic-password", "-a", subprocess.getoutput("whoami"),
             "-s", "reminiscencia-worker-auth", "-w"],
            capture_output=True, text=True, timeout=5,
        ).stdout.strip()
        if not token:
            return None
        out = subprocess.run(
            ["curl", "-sS", "-H", f"X-Auth: {token}",
             "https://reminiscencia.cometia.es/api/catalogo/storage-report"],
            capture_output=True, text=True, timeout=30,
        )
        if out.returncode != 0 or not out.stdout:
            return None
        data = json.loads(out.stdout)
        return data if "covers_total_size_bytes" in data else None
    except Exception:
        return None


def _get_bytes_sample(bucket: str, key: str, nbytes: int = 32) -> bytes | None:
    """Descarga el objeto completo a un tempdir y lee los primeros `nbytes`. wrangler no soporta rangos."""
    import tempfile
    with tempfile.TemporaryDirectory() as tmp:
        dst = Path(tmp) / "cover.bin"
        cmd = ["npx", "--yes", "wrangler@4.151.3", "r2", "object", "get", f"{bucket}/{key}", "--file", str(dst), "--remote"]
        try:
            out = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
            if out.returncode != 0:
                return None
            return dst.read_bytes()[:nbytes]
        except Exception:
            return None


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bucket", default=DEFAULT_BUCKET)
    parser.add_argument("--sample", type=int, default=20, help="Muestreo real para magic bytes (coste alto por GET).")
    args = parser.parse_args(argv)
    if not shutil.which("npx"):
        print("[ERROR] npx no está en PATH. Instala Node para usar wrangler.", file=sys.stderr)
        return 2

    objects = _list_bucket(args.bucket)
    if not objects:
        agg = _aggregate_from_worker()
        if agg:
            covers = agg.get("covers_total_size_bytes", 0)
            objcount = (agg.get("object_counts") or {}).get("covers/", 0)
            print(f"[fallback worker] portadas: {objcount} objetos · {covers:,} bytes ({covers / (1024 ** 2):.2f} MB)")
            est = covers * 0.30
            print(f"ahorro estimado si todo pasara a WebP (30 %): ~{int(est):,} bytes ({est / (1024 ** 2):.2f} MB)")
        else:
            print("No he podido listar covers/. Prueba `rclone` con credenciales S3 de R2.")
        return 0
    total = sum(o.get("size", 0) for o in objects)
    print(f"portadas totales     : {len(objects)}")
    print(f"tamaño total         : {total:,} bytes ({total / (1024 ** 2):.2f} MB)")
    sample = objects[: args.sample]
    counts = {"image/jpeg": 0, "image/webp": 0, "image/png": 0, "image/gif": 0, "application/octet-stream": 0}
    for o in sample:
        buf = _get_bytes_sample(args.bucket, o["key"])
        if buf is None:
            counts["application/octet-stream"] += 1
            continue
        counts[detect_mime(buf)] += 1
    print(f"muestreo real (n={len(sample)}):")
    for mime, n in counts.items():
        print(f"  {mime:<28} {n}")
    non_webp = sum(n for m, n in counts.items() if m not in ("image/webp", "application/octet-stream"))
    if non_webp:
        fraction = non_webp / max(1, len(sample))
        est_bytes = total * fraction
        savings = est_bytes * 0.30
        print(f"non-webp en muestreo : {fraction * 100:.1f} %")
        print(f"extrapolado          : ~{int(est_bytes):,} bytes susceptibles de conversión")
        print(f"ahorro estimado 30 % : ~{int(savings):,} bytes ({savings / (1024 ** 2):.2f} MB)")
    else:
        print("todo lo muestreado ya está en WebP o inaccesible; sin ahorro visible.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
