"""Aplica el plan de borrado generado por `scripts/detectar_duplicados.py` contra el Worker (ADR-0052).

Para cada entrada de `plan-borrado.json`, manda `POST /api/catalogo/edit` con la acción `delete_song`.
Toma la contraseña del Worker del llavero del Mac (nombre de servicio `reminiscencia-worker-auth`).

Es idempotente y seguro:

- Refetcha la versión actual del catálogo entre borrados: si varias llamadas se ejecutan rápido, el
  `if_match` siempre refleja la versión real y el Worker rechaza con 412 si algo se ha metido entremedias.
- Si una canción ya no existe (p.ej. porque la borraste a mano desde la web), el Worker responde 404 y
  este script la cuenta como "ya no estaba" y sigue.
- `--dry-run` imprime qué haría sin hacer la petición.
- `--limit N` detiene tras N borrados reales (útil para pruebas pequeñas).

Uso:
    python3 scripts/aplicar_borrado_duplicados.py \
        ~/Desktop/limpiar-duplicados-2026-11-26/plan-borrado.json
    python3 scripts/aplicar_borrado_duplicados.py <ruta> --dry-run
    python3 scripts/aplicar_borrado_duplicados.py <ruta> --limit 5
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

WORKER_BASE = "https://reminiscencia.cometia.es"
CATALOG_URL = f"{WORKER_BASE}/api/catalogo/latest"
EDIT_URL = f"{WORKER_BASE}/api/catalogo/edit"
KEYCHAIN_SERVICE = "reminiscencia-worker-auth"


def read_auth_password() -> str:
    """Lee la contraseña del Worker del llavero del Mac."""
    result = subprocess.run(
        ["security", "find-generic-password", "-s", KEYCHAIN_SERVICE, "-w"],
        capture_output=True, text=True, check=False,
    )
    if result.returncode != 0:
        raise SystemExit(
            f"No se pudo leer la contraseña del Worker del llavero (servicio '{KEYCHAIN_SERVICE}'):"
            f"\n{result.stderr.strip()}"
        )
    return result.stdout.strip()


def read_current_version() -> int:
    req = urllib.request.Request(CATALOG_URL, headers={"Cache-Control": "no-store", "User-Agent": "reminiscencia-aplicar-borrado/1.0"})
    with urllib.request.urlopen(req, timeout=15) as response:
        data = json.loads(response.read().decode("utf-8"))
    return int(data["version"])


def delete_one(song_id: str, auth: str, if_match: int) -> tuple[bool, int, str]:
    """Pide al Worker borrar una canción. Devuelve (ok, status, mensaje)."""
    body = json.dumps({
        "action": "delete_song",
        "params": {"song_id": song_id},
        "if_match": if_match,
    }).encode("utf-8")
    req = urllib.request.Request(
        EDIT_URL,
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "X-Auth": auth,
            "X-Actor": "duplicados-cli",
            "User-Agent": "reminiscencia-aplicar-borrado/1.0",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as response:
            payload = json.loads(response.read().decode("utf-8"))
        version = payload.get("version")
        return True, response.getcode(), f"v{version}"
    except urllib.error.HTTPError as exc:
        try:
            payload = json.loads(exc.read().decode("utf-8"))
            msg = payload.get("error", str(exc))
        except Exception:
            msg = str(exc)
        return False, exc.code, msg


def run(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.strip().splitlines()[0])
    parser.add_argument("plan", type=Path, help="Ruta al plan-borrado.json generado por detectar_duplicados.py")
    parser.add_argument("--dry-run", action="store_true", help="Solo imprime; no borra.")
    parser.add_argument("--limit", type=int, default=0, help="Borra como máximo N canciones (0 = todas).")
    args = parser.parse_args(argv)

    plan = json.loads(args.plan.read_text(encoding="utf-8"))
    items = plan.get("items", [])
    if not items:
        print("Plan vacío: nada que borrar.")
        return 0

    print(f"Plan con {len(items)} canción(es) a borrar. {'DRY-RUN' if args.dry_run else 'EJECUCIÓN REAL'}.")
    if args.dry_run:
        for item in items[: args.limit or len(items)]:
            print(f"  [DRY] {item['id']} · {item['artist']} · {item['title']} ({item['duration_s']:.0f}s)")
        return 0

    auth = read_auth_password()
    version = read_current_version()
    print(f"Versión actual del catálogo: v{version}.")

    borradas = 0
    saltadas = 0
    errores: list[str] = []
    for idx, item in enumerate(items, start=1):
        if args.limit and borradas >= args.limit:
            break
        ok, status, msg = delete_one(item["id"], auth, version)
        if ok:
            borradas += 1
            # El Worker devuelve la nueva versión; la refetchamos para evitar race con otros clientes.
            try:
                version = read_current_version()
            except Exception:
                version += 1
            print(f"  [{idx}/{len(items)}] OK  {item['id']} · {item['artist']} · {item['title']} → {msg}")
        elif status == 404:
            saltadas += 1
            print(f"  [{idx}/{len(items)}] 404 {item['id']} ya no estaba en el catálogo: {msg}")
        elif status == 412:
            # Versión desfasada: refetch y reintentar UNA vez.
            try:
                version = read_current_version()
                ok, status, msg = delete_one(item["id"], auth, version)
            except Exception as exc:
                msg = f"refetch tras 412 falló: {exc}"
            if ok:
                borradas += 1
                version = read_current_version()
                print(f"  [{idx}/{len(items)}] OK (reintento tras 412)  {item['id']} → {msg}")
            else:
                errores.append(f"{item['id']}: {msg}")
                print(f"  [{idx}/{len(items)}] ERR {item['id']}: {msg}")
        else:
            errores.append(f"{item['id']}: HTTP {status} {msg}")
            print(f"  [{idx}/{len(items)}] ERR {item['id']} HTTP {status}: {msg}")
        # Pausa amable al Worker (no es imprescindible).
        time.sleep(0.2)

    print(
        f"\nResumen: {borradas} borradas · {saltadas} ya no estaban · {len(errores)} errores. "
        f"Versión final: v{version}."
    )
    if errores:
        print("Errores:")
        for e in errores:
            print(f"  - {e}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(run())
