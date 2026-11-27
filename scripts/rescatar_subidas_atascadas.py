"""Rescata subidas atascadas en el bucket privado R2 de Reminiscencia (ADR-0052, 2026-11-27).

El Worker expone en https://reminiscencia.cometia.es:
  GET  /api/admin/entradas-pendientes
  POST /api/admin/rescate/preparar?uploadId=…
  POST /api/admin/rescate/finalizar?uploadId=…
  POST /api/buzon/publish

Flujo:
  1. Lista las entradas pendientes.
  2. Por cada una: preparar → obtiene {sha256, duration_s, size_bytes, title}.
  3. Lote de publish al catálogo (una canción por entrada, public=true).
  4. Por cada canción publicada: finalizar → mueve el opus a audio/<song_id>.opus del público.

Uso:
  python3 scripts/rescatar_subidas_atascadas.py --dry-run
  python3 scripts/rescatar_subidas_atascadas.py --aplicar
"""
import argparse
import json
import subprocess
import sys
import time
import urllib.request

BASE = "https://reminiscencia.cometia.es"


def get_auth():
    r = subprocess.run(
        ["security", "find-generic-password", "-a", subprocess.getoutput("echo $USER"),
         "-s", "reminiscencia-worker-auth", "-w"],
        capture_output=True, text=True,
    )
    if r.returncode != 0:
        print("No se pudo leer AUTH_PASSWORD del llavero.")
        sys.exit(1)
    return r.stdout.strip()


def http(method, url, auth=None, body=None, timeout=60):
    headers = {
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36",
    }
    data = None
    if auth:
        headers["X-Auth"] = auth
        headers["X-Actor"] = "rescate-script"
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, json.loads(resp.read())
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read())
        except Exception:
            return e.code, {"ok": False, "error": str(e)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--aplicar", action="store_true")
    args = ap.parse_args()
    if not (args.dry_run or args.aplicar):
        ap.error("elige --dry-run o --aplicar")

    auth = get_auth()
    status, data = http("GET", f"{BASE}/api/admin/entradas-pendientes", auth=auth)
    if status != 200:
        print("Error listando:", data); sys.exit(1)
    entries = data["entries"]
    print(f"Entradas pendientes: {len(entries)}")
    if not entries:
        print("Nada que rescatar."); return

    # Paso 1: preparar todas (calcula sha256/duración).
    prepared = []
    errors = []
    for i, e in enumerate(entries, 1):
        uid = e["uploadId"]
        print(f"[{i}/{len(entries)}] preparando {uid[:12]}… ", end="", flush=True)
        if args.dry_run:
            prepared.append({"uploadId": uid, "title": "(dry-run)"}); print("(dry-run)"); continue
        st, p = http("POST", f"{BASE}/api/admin/rescate/preparar?uploadId={uid}", auth=auth)
        if st != 200 or not p.get("ok"):
            print("ERROR", p.get("error", p)); errors.append((uid, "preparar", p))
            continue
        print(f"sha256={p['sha256'][:12]} dur={p['duration_s']} size={p['size_bytes']} title={p['title'][:40]}")
        prepared.append(p)

    if args.dry_run:
        print(f"\nDry-run: {len(prepared)} listas para rescatar, {len(errors)} errores.")
        return

    # Paso 2: lee versión actual, publica todas en 1 llamada.
    st, cat = http("GET", f"{BASE}/api/catalogo/latest")
    if st != 200:
        print("Error leyendo catálogo:", cat); sys.exit(1)
    current_version = cat["version"]
    print(f"\nCatálogo v{current_version} - publicando {len(prepared)} canciones en bulk…")

    songs_payload = [
        {
            "title": p["title"],
            "sha256": p["sha256"],
            "duration_s": p["duration_s"],
            "size_bytes": p["size_bytes"],
            "codec": "opus",
            "public": True,
            "source": "rescate-2026-11-27",
        }
        for p in prepared
    ]
    st, pub = http("POST", f"{BASE}/api/buzon/publish", auth=auth,
                    body={"songs": songs_payload, "if_match": current_version}, timeout=120)
    if st != 200 or not pub.get("ok"):
        print(f"Error publicando (HTTP {st}):", pub)
        print("ABORTO — revisa manualmente.")
        sys.exit(1)
    added = pub["event"]["added"]
    print(f"Publicadas en v{pub['version']}: {len(added)} canciones.")

    # Paso 3: emparejar uploadId ↔ song.id por el orden (addBuzonSongs mantiene el orden).
    if len(added) != len(prepared):
        print(f"AVISO: añadidas {len(added)} ≠ preparadas {len(prepared)}. Puede haber duplicadas saltadas.")
    pairs = list(zip(prepared, added))

    # Paso 4: finalizar (mover opus al público).
    movidas = 0
    for i, (p, song) in enumerate(pairs, 1):
        uid = p["uploadId"]
        sid = song["id"]
        print(f"[{i}/{len(pairs)}] finalizando {uid[:12]} → {sid}… ", end="", flush=True)
        st, f = http("POST", f"{BASE}/api/admin/rescate/finalizar?uploadId={uid}", auth=auth,
                      body={"songId": sid})
        if st != 200 or not f.get("ok"):
            print("ERROR", f.get("error", f)); errors.append((uid, "finalizar", f))
        else:
            print(f"OK ({round(f['movedBytes']/1024, 1)} KB)")
            movidas += 1

    print(f"\n=== RESUMEN ===")
    print(f"Preparadas: {len(prepared)}")
    print(f"Publicadas en catálogo: {len(added)} (nueva versión v{pub['version']})")
    print(f"Audios movidos a público: {movidas}/{len(pairs)}")
    print(f"Errores: {len(errors)}")
    if errors:
        for e in errors[:10]:
            print(" ", e)

    print("\nLimpia el localStorage de la web con:")
    print("  localStorage.removeItem('reminiscencia.subidas'); location.reload();")


if __name__ == "__main__":
    main()
