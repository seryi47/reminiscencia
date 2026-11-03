#!/usr/bin/env python3
"""
Mini-conversor LOCAL con interfaz (botón) para sacar el audio (WAV) de TUS
vídeos de YouTube. Es una herramienta privada: vive en local-tools (ignorado
por git) y NO forma parte de la app Reminiscencia ni se publica.

Arranca un servidor sólo en tu Mac (127.0.0.1) y abre una página con un
campo + botón "Convertir". Reutiliza la lógica de convertir.py.
"""
import os, json, threading, webbrowser, http.server, socketserver, pathlib, urllib.parse
from concurrent.futures import ThreadPoolExecutor
import convertir  # reutilizamos la lógica ya probada

PORT = 8787
AQUI = pathlib.Path(__file__).resolve().parent

# ---- estado compartido para la interfaz ----
estado = {"running": False, "total": 0, "ok": 0, "skip": 0, "fail": 0,
          "log": [], "dest": ""}
estado_lock = threading.Lock()

def ui_log(msg):
    import time
    linea = time.strftime("[%H:%M:%S] ") + msg
    with estado_lock:
        estado["log"].append(linea)
        estado["log"] = estado["log"][-400:]
    print(linea, flush=True)

# redirigimos los logs de convertir.py a nuestra interfaz
convertir.log = ui_log

def run_job(url, carpeta):
    try:
        with estado_lock:
            estado.update({"running": True, "total": 0, "ok": 0, "skip": 0, "fail": 0, "log": []})
        dest = pathlib.Path.home() / "Desktop" / (carpeta or "Mis videos")
        dest.mkdir(parents=True, exist_ok=True)
        with estado_lock:
            estado["dest"] = str(dest)
        ui_log("Leyendo la lista…")
        pares = convertir.listar_playlist(url)
        with estado_lock:
            estado["total"] = len(pares)
        if not pares:
            ui_log("No encontré vídeos en esa URL."); return
        ui_log(f"{len(pares)} elemento(s). Convirtiendo de {convertir.LOTE} en {convertir.LOTE}…")
        with ThreadPoolExecutor(max_workers=convertir.LOTE) as ex:
            futs = [ex.submit(convertir.procesar, u, t, i + 1, len(pares), dest)
                    for i, (u, t) in enumerate(pares)]
            for f in futs:
                r = f.result()
                with estado_lock:
                    estado[r] = estado.get(r, 0) + 1
        ui_log(f"TERMINADO: OK {estado['ok']} | ya estaban {estado['skip']} | fallidas {estado['fail']}")
        ui_log(f"Carpeta: {dest}")
    except Exception as e:
        ui_log(f"ERROR: {e}")
    finally:
        with estado_lock:
            estado["running"] = False

PAGINA = """<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Conversor local a WAV</title>
<style>
 :root{color-scheme:dark}
 body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
  background:#0a0a0a;color:#fff;display:flex;justify-content:center;padding:32px}
 .card{width:100%;max-width:560px;background:#181818;border:1px solid #2a2a2a;
  border-radius:16px;padding:24px}
 h1{font-size:1.3rem;margin:0 0 4px}
 p.sub{color:#9a9aab;margin:0 0 20px;font-size:.9rem}
 label{display:block;font-size:.85rem;color:#b3b3b3;margin:14px 0 6px}
 input{width:100%;box-sizing:border-box;padding:12px 14px;border-radius:10px;
  border:1px solid #333;background:#0f0f0f;color:#fff;font-size:1rem}
 button{margin-top:20px;width:100%;padding:14px;border:none;border-radius:999px;
  background:#a21caf;color:#fff;font-size:1rem;font-weight:700;cursor:pointer}
 button:disabled{opacity:.5;cursor:default}
 #log{margin-top:20px;background:#0f0f0f;border:1px solid #2a2a2a;border-radius:10px;
  padding:12px;height:260px;overflow:auto;font-family:ui-monospace,Menlo,monospace;
  font-size:.8rem;white-space:pre-wrap;color:#cfcfcf}
 .badge{display:inline-block;background:#2a2a2a;border-radius:999px;padding:2px 10px;
  font-size:.75rem;color:#b3b3b3;margin-left:8px}
</style></head><body>
<div class="card">
 <h1>Conversor local a WAV <span class="badge">solo en tu Mac</span></h1>
 <p class="sub">Para sacar el audio de TUS vídeos de YouTube. No forma parte de Reminiscencia ni se publica.</p>
 <label>URL de tu vídeo o playlist de YouTube</label>
 <input id="url" placeholder="https://www.youtube.com/playlist?list=...">
 <label>Carpeta de salida (en el Escritorio)</label>
 <input id="carpeta" value="Mis videos">
 <button id="go" onclick="arrancar()">Convertir a WAV</button>
 <div id="log">Listo. Pega una URL y pulsa Convertir.</div>
</div>
<script>
async function arrancar(){
 const url=document.getElementById('url').value.trim();
 const carpeta=document.getElementById('carpeta').value.trim()||'Mis videos';
 if(!url){alert('Pega una URL');return;}
 document.getElementById('go').disabled=true;
 await fetch('/convertir',{method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({url,carpeta})});
 sondear();
}
async function sondear(){
 const r=await fetch('/estado'); const s=await r.json();
 document.getElementById('log').textContent=s.log.join('\\n')||'…';
 document.getElementById('log').scrollTop=1e9;
 document.getElementById('go').disabled=s.running;
 if(s.running) setTimeout(sondear,1000);
}
</script></body></html>"""

class Handler(http.server.BaseHTTPRequestHandler):
    def _send(self, code, body, ctype="application/json"):
        data = body.encode() if isinstance(body, str) else body
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        # CORS abierto: solo escucha en 127.0.0.1, así que únicamente tu propio
        # navegador (p. ej. el userscript sobre la app en local) puede llamarlo.
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):
        self._send(204, b"")

    def do_GET(self):
        if self.path == "/" :
            self._send(200, PAGINA, "text/html; charset=utf-8")
        elif self.path == "/estado":
            with estado_lock:
                self._send(200, json.dumps(estado))
        else:
            self._send(404, "{}")

    def do_POST(self):
        if self.path == "/convertir":
            n = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(n) or b"{}")
            if not estado["running"]:
                threading.Thread(target=run_job,
                                 args=(body.get("url", ""), body.get("carpeta", "Mis videos")),
                                 daemon=True).start()
            self._send(200, json.dumps({"ok": True}))
        else:
            self._send(404, "{}")

    def log_message(self, *a):  # silencio
        pass

def main():
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.ThreadingTCPServer(("127.0.0.1", PORT), Handler) as httpd:
        url = f"http://127.0.0.1:{PORT}/"
        print(f"Conversor local en {url}  (Ctrl+C para parar)")
        if not os.environ.get("CONV_NO_BROWSER"):
            try:
                webbrowser.open(url)
            except Exception:
                pass
        httpd.serve_forever()

if __name__ == "__main__":
    main()
