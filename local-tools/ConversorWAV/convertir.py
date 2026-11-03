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
import os, random, re, sys, json, time, pathlib, threading, subprocess
from concurrent.futures import ThreadPoolExecutor, as_completed
from urllib.parse import parse_qs, urljoin, urlparse
import requests

# ---------------- Config ----------------
API      = "https://api.yttowav.org"
ORIGIN   = "https://www.yttowav.org"
FORMAT   = "wav"
QUALITY  = "original"
LOTE     = 4                      # 4 en 4 (límite de la web)
POLL_S   = 3                      # cada cuánto preguntar el estado
JOB_TIMEOUT = 600                 # máx. segundos por canción
CREATE_ATTEMPTS = 6               # intentos ante saturación o errores transitorios
DOWNLOAD_ATTEMPTS = 4             # reintentos de una descarga cortada
CREATE_GAP_S = 2                  # separa el arranque de trabajos para no hacer ráfaga
HTTP_RETRYABLE = {408, 425, 429, 500, 502, 503, 504}
VIDEO_ID_RE = re.compile(r'^[A-Za-z0-9_-]{11}$')
YOUTUBE_HOSTS = {'youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be'}
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
create_rate_lock = threading.Lock()
next_create_at = 0.0

def log(msg):
    with print_lock:
        print(time.strftime("[%H:%M:%S] ") + msg, flush=True)

def sanitizar(nombre):
    nombre = re.sub(r'[\\/:*?"<>|]+', " ", nombre or "").strip()
    nombre = re.sub(r"\s+", " ", nombre)
    nombre = re.sub(r'\.(?:wav|mp3|m4a|flac|ogg|opus)$', '', nombre, flags=re.IGNORECASE)
    return (nombre if nombre not in {"", ".", ".."} else "audio")[:120]

def video_id(url):
    try:
        parsed = urlparse(url)
    except ValueError:
        return None
    host = (parsed.hostname or '').lower()
    if host == 'youtu.be':
        candidate = parsed.path.lstrip('/').split('/')[0]
    elif host in YOUTUBE_HOSTS and parsed.path == '/watch':
        candidate = (parse_qs(parsed.query).get('v') or [''])[0]
    elif host in YOUTUBE_HOSTS and parsed.path.startswith(('/shorts/', '/embed/')):
        candidate = parsed.path.split('/')[2]
    else:
        return None
    return candidate if VIDEO_ID_RE.fullmatch(candidate or '') else None

def canonical_video_url(url):
    identifier = video_id(url)
    return f'https://www.youtube.com/watch?v={identifier}' if identifier else None

def retry_delay(attempt, response=None, base=10, cap=90):
    """Devuelve backoff exponencial con jitter y respeta Retry-After numérico."""
    retry_after = response.headers.get('Retry-After') if response is not None else None
    try:
        server_delay = max(0.0, min(float(retry_after), 300.0)) if retry_after else None
    except (TypeError, ValueError):
        server_delay = None
    delay = server_delay if server_delay is not None else min(base * (2 ** (attempt - 1)), cap)
    return delay + random.uniform(0, min(3.0, max(0.5, delay * 0.1)))

def response_detail(response):
    try:
        data = response.json()
        detail = data.get('error') or data.get('message') or data.get('errorText')
        if detail:
            return str(detail)[:240]
    except (ValueError, requests.RequestException):
        pass
    return response.text.strip()[:240]

def esperar_turno_creacion():
    """Evita que los cuatro workers abran trabajos en la misma milésima."""
    global next_create_at
    with create_rate_lock:
        ahora = time.monotonic()
        espera = max(0.0, next_create_at - ahora)
        next_create_at = max(ahora, next_create_at) + CREATE_GAP_S
    if espera:
        time.sleep(espera)

def listar_playlist(url):
    """Devuelve lista de (url, titulo) usando yt-dlp, sin descargar nada."""
    ytdlp = str(YTDLP) if YTDLP.exists() else "yt-dlp"
    try:
        out = subprocess.run(
            [ytdlp, '--no-warnings', '--ignore-errors', '--flat-playlist', '--skip-download',
             '--print', '%(url,webpage_url,original_url)s\t%(title)s', url],
            capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=120)
    except subprocess.TimeoutExpired as exc:
        raise TimeoutError('yt-dlp tardó más de 120 segundos en leer la playlist') from exc
    except OSError as exc:
        raise RuntimeError(f'no se pudo ejecutar yt-dlp: {exc}') from exc
    if out.returncode != 0 and not out.stdout.strip():
        detalle = out.stderr.strip().splitlines()[-1] if out.stderr.strip() else 'sin detalles'
        raise RuntimeError(f'yt-dlp no pudo leer la playlist: {detalle[:240]}')
    pares = []
    vistos = set()
    for linea in out.stdout.splitlines():
        if "\t" in linea:
            u, t = linea.split("\t", 1)
        else:
            u, t = linea, ""
        normalizada = canonical_video_url(u.strip())
        if normalizada and normalizada not in vistos:
            vistos.add(normalizada)
            pares.append((normalizada, t.strip()))
    if out.returncode != 0:
        log('Aviso: yt-dlp devolvió errores parciales; se usarán las entradas válidas encontradas.')
    return pares

def sess():
    s = requests.Session(); s.headers.update(HEADERS); return s

def crear_job(s, url, title):
    body = {"url": url, "title": title or "", "format": FORMAT, "quality": QUALITY}
    for intento in range(1, CREATE_ATTEMPTS + 1):
        esperar_turno_creacion()
        try:
            with s.post(f'{API}/api/convert', json=body, timeout=30) as response:
                if response.status_code in HTTP_RETRYABLE:
                    if intento == CREATE_ATTEMPTS:
                        raise RuntimeError(f'yttowav sigue ocupado o no disponible (HTTP {response.status_code})')
                    espera = retry_delay(intento, response)
                    log(f'    conversor HTTP {response.status_code}, reintento {intento}/{CREATE_ATTEMPTS} en {espera:.0f}s…')
                    time.sleep(espera)
                    continue
                if not response.ok:
                    raise RuntimeError(f'yttowav rechazó el trabajo (HTTP {response.status_code}): {response_detail(response)}')
                try:
                    data = response.json()
                except ValueError as exc:
                    raise RuntimeError('yttowav devolvió una respuesta que no es JSON') from exc
                job_id = data.get('jobId') or data.get('id') or (data.get('job') or {}).get('id')
                if not job_id:
                    raise RuntimeError('yttowav no devolvió jobId')
                return str(job_id)
        except requests.RequestException as exc:
            if intento == CREATE_ATTEMPTS:
                raise RuntimeError(f'fallo de red al crear el job: {exc}') from exc
            espera = retry_delay(intento)
            log(f'    red no disponible al crear el job, reintento {intento}/{CREATE_ATTEMPTS} en {espera:.0f}s…')
            time.sleep(espera)
    raise RuntimeError('no se pudo crear el job de conversión')

def resolver_descarga(valor, job_id):
    destino = urljoin(f'{API}/', str(valor)) if valor else f'{API}/api/download/?jobId={job_id}'
    parsed = urlparse(destino)
    api = urlparse(API)
    if parsed.scheme != api.scheme or parsed.netloc != api.netloc:
        raise RuntimeError('el servidor devolvió una URL de descarga no autorizada')
    return destino

def descargar_wav(s, url, destino, deadline):
    tmp = destino.with_name(destino.name + '.part')
    for intento in range(1, DOWNLOAD_ATTEMPTS + 1):
        tmp.unlink(missing_ok=True)
        try:
            restante = max(1.0, deadline - time.monotonic())
            with s.get(url, stream=True, timeout=(15, min(180, restante))) as response:
                if response.status_code in HTTP_RETRYABLE:
                    if intento == DOWNLOAD_ATTEMPTS:
                        raise RuntimeError(f'falló la descarga (HTTP {response.status_code})')
                    espera = min(retry_delay(intento, response, base=3, cap=20), max(0.0, restante))
                    log(f'    descarga HTTP {response.status_code}, reintento {intento}/{DOWNLOAD_ATTEMPTS} en {espera:.0f}s…')
                    time.sleep(espera)
                    continue
                if not response.ok:
                    raise RuntimeError(f'falló la descarga (HTTP {response.status_code}): {response_detail(response)}')
                with open(tmp, 'wb') as archivo:
                    for chunk in response.iter_content(1 << 16):
                        if chunk:
                            archivo.write(chunk)
            with open(tmp, 'rb') as archivo:
                cabecera = archivo.read(12)
            if len(cabecera) < 12 or cabecera[:4] not in (b'RIFF', b'RF64') or cabecera[8:12] != b'WAVE':
                raise RuntimeError('la descarga no contiene un WAV válido')
            os.replace(tmp, destino)
            return
        except requests.RequestException as exc:
            if intento == DOWNLOAD_ATTEMPTS:
                raise RuntimeError(f'fallo de red al descargar el WAV: {exc}') from exc
            restante = max(0.0, deadline - time.monotonic())
            espera = min(retry_delay(intento, base=3, cap=20), restante)
            log(f'    red interrumpida durante la descarga, reintento {intento}/{DOWNLOAD_ATTEMPTS} en {espera:.0f}s…')
            time.sleep(espera)
        finally:
            # Nunca dejamos un parcial que parezca recuperable en una ejecución futura.
            if tmp.exists():
                tmp.unlink(missing_ok=True)

def esperar_y_bajar(s, job_id, destino):
    deadline = time.monotonic() + JOB_TIMEOUT
    fallos_status = 0
    while time.monotonic() < deadline:
        restante = max(1.0, min(30.0, deadline - time.monotonic()))
        try:
            with s.get(f'{API}/api/status', params={'jobId': job_id}, timeout=restante) as response:
                if response.status_code in HTTP_RETRYABLE:
                    fallos_status += 1
                    espera = min(retry_delay(fallos_status, response, base=POLL_S, cap=30), max(0.0, deadline - time.monotonic()))
                    time.sleep(espera)
                    continue
                if response.status_code == 404:
                    raise RuntimeError('yttowav no encuentra el job; puede haber caducado')
                if not response.ok:
                    raise RuntimeError(f'error consultando el job (HTTP {response.status_code}): {response_detail(response)}')
                try:
                    data = response.json()
                except ValueError as exc:
                    raise RuntimeError('yttowav devolvió un estado que no es JSON') from exc
        except requests.RequestException:
            fallos_status += 1
            espera = min(retry_delay(fallos_status, base=POLL_S, cap=30), max(0.0, deadline - time.monotonic()))
            time.sleep(espera)
            continue

        fallos_status = 0
        estado = str(data.get('status') or '').lower()
        descarga = data.get('downloadUrl') or data.get('downloadPath') or data.get('url')
        if estado in {'error', 'failed', 'failure', 'cancelled', 'expired'}:
            raise RuntimeError(data.get('errorText') or data.get('error') or f'job terminado con estado {estado}')
        if estado in {'completed', 'done'} or descarga:
            descargar_wav(s, resolver_descarga(descarga, job_id), destino, deadline)
            return
        time.sleep(min(POLL_S + random.uniform(0, 0.5), max(0.0, deadline - time.monotonic())))
    raise TimeoutError('tiempo agotado esperando el job')

def procesar(url, title, idx, total, dest):
    s = sess()
    try:
        identifier = video_id(url)
        nombre = sanitizar(title or identifier or 'audio')
        legacy = dest / f'{nombre}.wav'
        if legacy.exists() and legacy.stat().st_size > 1024:
            log(f'[{idx}/{total}] skip (ya existe): {legacy.stem}'); return 'skip'
        nombre_unico = f'{nombre} [{identifier}]' if identifier else nombre
        final = dest / f'{nombre_unico}.wav'
        if final.exists() and final.stat().st_size > 1024:
            log(f'[{idx}/{total}] skip (ya existe): {final.stem}'); return 'skip'
        jobId = crear_job(s, url, title)
        if not jobId: raise RuntimeError("no devolvió jobId")
        log(f'[{idx}/{total}] convirtiendo: {final.stem}')
        esperar_y_bajar(s, jobId, final)
        log(f'[{idx}/{total}] OK guardado: {final.name}'); return 'ok'
    except Exception as e:
        log(f"[{idx}/{total}] FALLO: {url} -> {e}"); return "fail"
    finally:
        s.close()

def main():
    if len(sys.argv) < 2:
        print(__doc__); sys.exit(1)
    playlist = sys.argv[1]
    carpeta  = sys.argv[2] if len(sys.argv) > 2 else "WAVs Convertidos"
    try:
        limite = int(sys.argv[3]) if len(sys.argv) > 3 else None
    except ValueError:
        log('El número de prueba debe ser un entero positivo.'); sys.exit(2)
    if limite is not None and limite <= 0:
        log('El número de prueba debe ser mayor que cero.'); sys.exit(2)
    dest = pathlib.Path.home() / "Desktop" / carpeta
    dest.mkdir(parents=True, exist_ok=True)

    log("Leyendo la playlist…")
    try:
        pares = listar_playlist(playlist)
    except Exception as e:
        log(f'FALLO leyendo la playlist: {e}'); sys.exit(1)
    if limite is not None: pares = pares[:limite]
    total = len(pares)
    if total == 0:
        log("No encontré vídeos en esa URL. ¿Es una playlist pública válida?"); sys.exit(1)
    log(f"Carpeta destino: {dest}")
    log(f"Canciones: {total}  (de {LOTE} en {LOTE})")

    res = {"ok": 0, "skip": 0, "fail": 0}
    for inicio in range(0, total, LOTE):
        lote = pares[inicio:inicio + LOTE]
        log(f'Lote {inicio // LOTE + 1}: {len(lote)} canción(es)')
        with ThreadPoolExecutor(max_workers=len(lote)) as ex:
            futs = [ex.submit(procesar, u, t, i + 1, total, dest)
                    for i, (u, t) in enumerate(lote, start=inicio)]
            for f in as_completed(futs):
                res[f.result()] += 1
    log("─" * 50)
    log(f"TERMINADO: OK {res['ok']} | ya estaban {res['skip']} | fallidas {res['fail']}")

if __name__ == "__main__":
    main()
