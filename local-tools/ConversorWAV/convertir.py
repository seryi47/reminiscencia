#!/usr/bin/env python3
"""
Conversor de playlist de YouTube a WAV (vía yttowav.org).

Pensado para convertir TUS PROPIOS vídeos o contenido sobre el que tengas
derechos. Tú le pasas la URL de la playlist; el script hace el resto.

  - Lanza las canciones DE 4 EN 4 (límite de la web).
  - Cada WAV terminado se guarda en una carpeta del Escritorio.
  - Es REANUDABLE: si el .wav ya existe, salta esa canción.

USO:
  ./.venv/bin/python convertir.py "URL_DE_TU_PLAYLIST"
  ./.venv/bin/python convertir.py "URL_DE_TU_PLAYLIST" "Nombre carpeta"
  ./.venv/bin/python convertir.py "URL_DE_TU_PLAYLIST" "Nombre carpeta" 4   (nº de prueba)
"""
import os, re, sys, json, time, pathlib, threading, subprocess
from concurrent.futures import ThreadPoolExecutor, as_completed
import requests

# ---------------- Config ----------------
API      = "https://api.yttowav.org"
ORIGIN   = "https://www.yttowav.org"
FORMAT   = "wav"
QUALITY  = "original"
LOTE     = 4                      # 4 en 4 (límite de la web)
POLL_S   = 3                      # cada cuánto preguntar el estado
JOB_TIMEOUT = 600                 # máx. segundos por canción
# ----------------------------------------

AQUI = pathlib.Path(__file__).resolve().parent
YTDLP = AQUI / ".venv" / "bin" / "yt-dlp"

HEADERS = {
    "Content-Type": "application/json",
    "Accept": "*/*",
    "Accept-Encoding": "gzip, deflate",   # evitamos zstd a propósito
    "Origin": ORIGIN,
    "Referer": ORIGIN + "/",
    "User-Agent": ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                   "(KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36 OPR/138.0.0.0"),
}

print_lock = threading.Lock()
def log(msg):
    with print_lock:
        print(time.strftime("[%H:%M:%S] ") + msg, flush=True)

def sanitizar(nombre):
    nombre = re.sub(r'[\\/:*?"<>|]+', " ", nombre or "").strip()
    nombre = re.sub(r"\s+", " ", nombre)
    return (nombre or "audio")[:120]

def listar_playlist(url):
    """Devuelve lista de (url, titulo) usando yt-dlp, sin descargar nada."""
    ytdlp = str(YTDLP) if YTDLP.exists() else "yt-dlp"
    out = subprocess.run(
        [ytdlp, "--flat-playlist", "--print", "%(url)s\t%(title)s", url],
        capture_output=True, text=True)
    pares = []
    for linea in out.stdout.splitlines():
        if "\t" in linea:
            u, t = linea.split("\t", 1)
        else:
            u, t = linea, ""
        if u.strip():
            pares.append((u.strip(), t.strip()))
    return pares

def sess():
    s = requests.Session(); s.headers.update(HEADERS); return s

def crear_job(s, url, title):
    body = {"url": url, "title": title or "", "format": FORMAT, "quality": QUALITY}
    r = s.post(f"{API}/api/convert", data=json.dumps(body), timeout=30)
    r.raise_for_status(); j = r.json()
    return j.get("jobId") or j.get("id") or (j.get("job") or {}).get("id")

def esperar_y_bajar(s, jobId, destino_base):
    t0 = time.time()
    while time.time() - t0 < JOB_TIMEOUT:
        r = s.get(f"{API}/api/status", params={"jobId": jobId}, timeout=30)
        if not r.ok:
            time.sleep(POLL_S); continue
        j = r.json()
        estado = (j.get("status") or "").lower()
        dl = j.get("downloadUrl") or j.get("downloadPath") or j.get("url")
        if estado == "error":
            raise RuntimeError(j.get("errorText") or j.get("error") or "error del servidor")
        if estado in ("completed", "done") or dl:
            if dl and dl.startswith("/"): dl = API + dl
            if not dl: dl = f"{API}/api/download/?jobId={jobId}"
            with s.get(dl, stream=True, timeout=180) as resp:
                resp.raise_for_status()
                tmp = destino_base.with_suffix(".wav.part")
                with open(tmp, "wb") as f:
                    for chunk in resp.iter_content(1 << 16):
                        if chunk: f.write(chunk)
                tmp.rename(destino_base.with_suffix(".wav"))
            return
        time.sleep(POLL_S)
    raise TimeoutError("tiempo agotado esperando el job")

def procesar(url, title, idx, total, dest):
    s = sess()
    try:
        nombre = sanitizar(title or url.split("v=")[-1])
        destino = dest / nombre
        final = destino.with_suffix(".wav")
        if final.exists() and final.stat().st_size > 1024:
            log(f"[{idx}/{total}] skip (ya existe): {nombre}"); return "skip"
        jobId = crear_job(s, url, title)
        if not jobId: raise RuntimeError("no devolvió jobId")
        log(f"[{idx}/{total}] convirtiendo: {nombre}")
        esperar_y_bajar(s, jobId, destino)
        log(f"[{idx}/{total}] OK guardado: {nombre}.wav"); return "ok"
    except Exception as e:
        log(f"[{idx}/{total}] FALLO: {url} -> {e}"); return "fail"

def main():
    if len(sys.argv) < 2:
        print(__doc__); sys.exit(1)
    playlist = sys.argv[1]
    carpeta  = sys.argv[2] if len(sys.argv) > 2 else "WAVs Convertidos"
    limite   = int(sys.argv[3]) if len(sys.argv) > 3 else None
    dest = pathlib.Path.home() / "Desktop" / carpeta
    dest.mkdir(parents=True, exist_ok=True)

    log("Leyendo la playlist…")
    pares = listar_playlist(playlist)
    if limite: pares = pares[:limite]
    total = len(pares)
    if total == 0:
        log("No encontré vídeos en esa URL. ¿Es una playlist pública válida?"); sys.exit(1)
    log(f"Carpeta destino: {dest}")
    log(f"Canciones: {total}  (de {LOTE} en {LOTE})")

    res = {"ok": 0, "skip": 0, "fail": 0}
    with ThreadPoolExecutor(max_workers=LOTE) as ex:
        futs = [ex.submit(procesar, u, t, i + 1, total, dest)
                for i, (u, t) in enumerate(pares)]
        for f in as_completed(futs):
            res[f.result()] += 1
    log("─" * 50)
    log(f"TERMINADO: OK {res['ok']} | ya estaban {res['skip']} | fallidas {res['fail']}")

if __name__ == "__main__":
    main()
