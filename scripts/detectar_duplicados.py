"""Detecta canciones duplicadas en el catálogo de Reminiscencia (ADR-0052) por título + artista normalizados
y propone cuál conservar comparando la duración local con la "oficial" de Deezer (fallback MusicBrainz).

NO borra nada. Deja tres ficheros en ~/Desktop/limpiar-duplicados-<fecha>/ :

- informe.html       — tabla legible por grupos, estilo claro/oscuro, decisión propuesta por canción.
- plan-borrado.json  — lista plana de {id, title, artist, duration_s, reason} para que el compañero
                       `scripts/aplicar_borrado_duplicados.py` las borre del catálogo.
- plan-revisar.json  — grupos que no se han podido decidir (sin referencia o con todas las variantes
                       dentro del margen de tolerancia).

Uso:
    python3 scripts/detectar_duplicados.py              # catálogo local (rápido para test)
    python3 scripts/detectar_duplicados.py --remote     # /api/catalogo/latest del Worker (fuente de verdad)
    python3 scripts/detectar_duplicados.py --limit 10   # solo los 10 primeros grupos (depuración)

Fuentes externas sin auth: `api.deezer.com/search` (preferida) y `musicbrainz.org/ws/2/recording`
(fallback con `User-Agent` obligatorio). Si ambas fallan, el grupo queda en REVIEW.

Solo biblioteca estándar: urllib, json, re, unicodedata, html, pathlib. Nada de requests ni terceros,
para que el script sea portable y no exija entorno virtual.
"""

from __future__ import annotations

import argparse
import json
import re
import statistics
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from html import escape
from pathlib import Path
from typing import Iterable

ROOT = Path(__file__).resolve().parent.parent
CATALOG_LOCAL = ROOT / "audio-library" / "indexes" / "catalog.json"
CATALOG_REMOTE = "https://reminiscencia.cometia.es/api/catalogo/latest"

DEEZER_URL = "https://api.deezer.com/search"
MB_URL = "https://musicbrainz.org/ws/2/recording"
USER_AGENT = "ReminiscenciaDuplicates/1.0 (herramientas@especialistasweb.es)"

# Palabras clave dentro de paréntesis que indican una variante del mismo tema (no se consideran parte del título).
VARIANT_KEYWORDS = (
    "feat", "ft", "featuring", "con", "with",
    "remix", "remaster", "remasterizado", "remastered",
    "live", "en directo", "en vivo",
    "acustic", "acustica", "acoustic", "acoustica",
    "radio edit", "edit", "version", "versión",
    "ladieresis", "ladiëresis",
)


# ---------------------------------------------------------------------------
# Normalización de título / artista
# ---------------------------------------------------------------------------

def strip_accents(text: str) -> str:
    """Quita acentos manteniendo el resto de caracteres."""
    return "".join(c for c in unicodedata.normalize("NFKD", text) if not unicodedata.combining(c))


_PAREN_RE = re.compile(r"[\(\[][^\)\]]*[\)\]]")
_OPEN_PAREN_RE = re.compile(r"[\(\[].*$")
_WS_RE = re.compile(r"\s+")


def extract_variants(raw: str) -> list[str]:
    """Devuelve las etiquetas de variante (feat, remix, live…) presentes en el título para informar."""
    variants: list[str] = []
    for match in re.findall(r"[\(\[]([^\)\]]+)[\)\]]", raw or ""):
        low = strip_accents(match).lower()
        for keyword in VARIANT_KEYWORDS:
            if keyword in low:
                variants.append(match.strip())
                break
    # También detecta paréntesis abiertos sin cerrar ("(Ladiëresis" al final).
    tail = re.search(r"[\(\[]([^\)\]]+)$", raw or "")
    if tail and tail.group(1).strip() and tail.group(1).strip() not in variants:
        variants.append(tail.group(1).strip())
    return variants


def normalize_title(raw: str) -> str:
    """Normaliza un título a su forma canónica para agrupar duplicados.

    Quita paréntesis con variantes, acentos, pasa a minúsculas y colapsa espacios.
    """
    if not raw:
        return ""
    text = raw
    # Quita paréntesis balanceados primero.
    text = _PAREN_RE.sub(" ", text)
    # Quita cualquier paréntesis abierto sin cerrar.
    text = _OPEN_PAREN_RE.sub(" ", text)
    text = strip_accents(text).lower()
    text = re.sub(r"[¡!¿?.,:;\"'’`]", " ", text)
    text = _WS_RE.sub(" ", text).strip()
    return text


_ARTIST_SPLIT_RE = re.compile(r"\s+(?:feat\.?|ft\.?|con|with|y|&|,|/|\+)\s+", re.IGNORECASE)


def normalize_artist(raw: str) -> str:
    """Devuelve el artista principal normalizado: sin colaboraciones ni acentos."""
    if not raw:
        return ""
    primary = _ARTIST_SPLIT_RE.split(raw, maxsplit=1)[0]
    primary = strip_accents(primary).lower()
    primary = re.sub(r"[¡!¿?.,:;\"'’`]", " ", primary)
    return _WS_RE.sub(" ", primary).strip()


def group_key(song: dict) -> str:
    """Clave canónica (`artist|title`) usada para detectar duplicados."""
    return f"{normalize_artist(song.get('artist', ''))}|{normalize_title(song.get('title', ''))}"


# ---------------------------------------------------------------------------
# Fuentes externas (sin auth, respetando ratelimit mínimo).
# ---------------------------------------------------------------------------

def _get_json(url: str, *, headers: dict | None = None, timeout: float = 10.0) -> dict | list | None:
    """GET con cabeceras opcionales, devuelve JSON o None si falla cualquier cosa."""
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            raw = response.read()
        return json.loads(raw.decode("utf-8"))
    except (urllib.error.URLError, json.JSONDecodeError, TimeoutError):
        return None


def query_deezer(artist: str, title: str) -> tuple[float, str] | None:
    """Devuelve (duración_en_segundos, 'deezer') o None si no hay match claro."""
    q = f'artist:"{artist}" track:"{title}"'
    url = f"{DEEZER_URL}?q={urllib.parse.quote(q)}&limit=5"
    data = _get_json(url)
    if not data or not isinstance(data, dict) or not data.get("data"):
        return None
    target_title = normalize_title(title)
    target_artist = normalize_artist(artist)
    durations: list[int] = []
    for item in data["data"]:
        it_title = normalize_title(item.get("title", ""))
        it_artist = normalize_artist((item.get("artist") or {}).get("name", ""))
        if it_title == target_title and it_artist == target_artist:
            duration = item.get("duration")
            if isinstance(duration, (int, float)) and duration > 0:
                durations.append(int(duration))
    if not durations:
        return None
    return float(statistics.median(durations)), "deezer"


def query_musicbrainz(artist: str, title: str) -> tuple[float, str] | None:
    """Fallback con MusicBrainz. Duración viene en milisegundos."""
    q = f'artist:"{artist}" AND recording:"{title}"'
    url = f"{MB_URL}?query={urllib.parse.quote(q)}&fmt=json&limit=5"
    data = _get_json(url, headers={"Accept": "application/json"}, timeout=12.0)
    if not data or not isinstance(data, dict) or not data.get("recordings"):
        return None
    target_title = normalize_title(title)
    target_artist = normalize_artist(artist)
    durations: list[int] = []
    for rec in data["recordings"]:
        rec_title = normalize_title(rec.get("title", ""))
        credits = rec.get("artist-credit") or []
        rec_artist = normalize_artist(
            credits[0]["name"] if credits and isinstance(credits[0], dict) else ""
        )
        if rec_title == target_title and rec_artist == target_artist:
            length = rec.get("length")
            if isinstance(length, (int, float)) and length > 0:
                durations.append(int(length))
    if not durations:
        return None
    return float(statistics.median(durations)) / 1000.0, "musicbrainz"


def official_duration(artist: str, title: str) -> tuple[float, str] | None:
    """Prueba Deezer y, si no, MusicBrainz. None si ninguna responde con coincidencia."""
    result = query_deezer(artist, title)
    if result is not None:
        return result
    # MusicBrainz pide pausa entre consultas (1 rps).
    time.sleep(1.0)
    return query_musicbrainz(artist, title)


# ---------------------------------------------------------------------------
# Decisión por grupo
# ---------------------------------------------------------------------------

@dataclass
class Decision:
    song_id: str
    title: str
    artist: str
    album_id: str | None
    duration_s: float
    delta: float | None
    verdict: str          # KEEP | DELETE | REVIEW
    reason: str
    variants: list[str] = field(default_factory=list)


@dataclass
class GroupResult:
    key: str
    artist_display: str
    title_display: str
    official_duration: float | None
    source: str | None
    decisions: list[Decision]


def tolerance(official: float) -> float:
    return max(30.0, 0.15 * official)


def decide_group(songs: list[dict], ref: tuple[float, str] | None) -> list[Decision]:
    """Elige KEEP / DELETE / REVIEW para cada canción del grupo según la duración de referencia."""
    if ref is None:
        return [
            Decision(
                song_id=s["id"], title=s.get("title", ""), artist=s.get("artist", ""),
                album_id=s.get("folder_id"), duration_s=float(s.get("duration_s", 0)),
                delta=None, verdict="REVIEW",
                reason="Sin referencia de duración (Deezer y MusicBrainz no responden).",
                variants=extract_variants(s.get("title", "")),
            )
            for s in songs
        ]

    official, source = ref
    tol = tolerance(official)
    scored = sorted(
        songs, key=lambda s: abs(float(s.get("duration_s", 0)) - official)
    )
    keeper = scored[0]
    decisions: list[Decision] = []
    for s in scored:
        delta = abs(float(s.get("duration_s", 0)) - official)
        variants = extract_variants(s.get("title", ""))
        if s["id"] == keeper["id"]:
            decisions.append(Decision(
                song_id=s["id"], title=s.get("title", ""), artist=s.get("artist", ""),
                album_id=s.get("folder_id"), duration_s=float(s.get("duration_s", 0)),
                delta=delta, verdict="KEEP",
                reason=f"Más cercano a {official:.0f}s ({source}); delta {delta:.1f}s.",
                variants=variants,
            ))
        elif delta > tol:
            decisions.append(Decision(
                song_id=s["id"], title=s.get("title", ""), artist=s.get("artist", ""),
                album_id=s.get("folder_id"), duration_s=float(s.get("duration_s", 0)),
                delta=delta, verdict="DELETE",
                reason=f"Delta {delta:.1f}s > tolerancia {tol:.1f}s (ref {official:.0f}s por {source}).",
                variants=variants,
            ))
        else:
            decisions.append(Decision(
                song_id=s["id"], title=s.get("title", ""), artist=s.get("artist", ""),
                album_id=s.get("folder_id"), duration_s=float(s.get("duration_s", 0)),
                delta=delta, verdict="REVIEW",
                reason=f"Delta {delta:.1f}s dentro de la tolerancia {tol:.1f}s: posible variante legítima.",
                variants=variants,
            ))
    return decisions


# ---------------------------------------------------------------------------
# I/O del catálogo
# ---------------------------------------------------------------------------

def load_catalog(remote: bool) -> tuple[list[dict], int]:
    """Devuelve (songs, version). Local tiene version=0 si no la trae."""
    if remote:
        data = _get_json(CATALOG_REMOTE, timeout=20.0)
        if not data:
            raise RuntimeError(f"No se pudo leer {CATALOG_REMOTE}")
        return data.get("songs", []), int(data.get("version", 0))
    data = json.loads(CATALOG_LOCAL.read_text())
    return data.get("songs", []), int(data.get("version", 0))


def build_groups(songs: Iterable[dict]) -> list[tuple[str, list[dict]]]:
    groups: dict[str, list[dict]] = {}
    for s in songs:
        groups.setdefault(group_key(s), []).append(s)
    return [(k, v) for k, v in groups.items() if len(v) >= 2]


# ---------------------------------------------------------------------------
# Informe HTML
# ---------------------------------------------------------------------------

HTML_HEAD = """<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>Limpieza de duplicados · Reminiscencia</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 2rem auto; max-width: 1100px; padding: 0 1rem; line-height: 1.5; }
  h1 { margin-top: 0; }
  .summary { display: flex; gap: 1.5rem; flex-wrap: wrap; padding: 1rem; border-radius: 10px; background: color-mix(in srgb, Canvas 90%, CanvasText 10%); margin-bottom: 2rem; }
  .summary div { min-width: 7rem; }
  .summary strong { font-size: 1.5rem; display: block; }
  details { border: 1px solid color-mix(in srgb, Canvas 70%, CanvasText 30%); border-radius: 10px; padding: 0.75rem 1rem; margin-bottom: 0.75rem; }
  details[open] { background: color-mix(in srgb, Canvas 97%, CanvasText 3%); }
  summary { cursor: pointer; font-weight: 600; }
  table { border-collapse: collapse; margin-top: 0.75rem; width: 100%; font-size: 0.94rem; }
  th, td { text-align: left; padding: 0.4rem 0.6rem; border-bottom: 1px solid color-mix(in srgb, Canvas 80%, CanvasText 20%); }
  th { font-weight: 600; }
  tr.keep td { background: color-mix(in srgb, Canvas 90%, limegreen 10%); }
  tr.delete td { background: color-mix(in srgb, Canvas 80%, crimson 20%); }
  tr.review td { background: color-mix(in srgb, Canvas 90%, gold 10%); }
  code { font-family: ui-monospace, "SF Mono", monospace; font-size: 0.85em; }
  .verdict { font-weight: 600; letter-spacing: 0.05em; }
  .footer { margin-top: 2rem; color: color-mix(in srgb, Canvas 50%, CanvasText 50%); font-size: 0.85rem; }
</style>
</head>
<body>
"""

HTML_TAIL = """
<p class="footer">Generado por scripts/detectar_duplicados.py. Revisa y ejecuta
<code>scripts/aplicar_borrado_duplicados.py</code> cuando estés conforme con los <strong>DELETE</strong>.</p>
</body></html>
"""


def fmt_duration(seconds: float | None) -> str:
    if seconds is None:
        return "—"
    s = int(round(seconds))
    return f"{s // 60}:{s % 60:02d}"


def render_group(group: GroupResult) -> str:
    rows = []
    for d in group.decisions:
        rows.append(
            f'<tr class="{d.verdict.lower()}">'
            f'<td><code>{escape(d.song_id)}</code></td>'
            f'<td>{escape(d.title)}</td>'
            f'<td>{escape(d.artist)}</td>'
            f'<td>{escape(d.album_id or "—")}</td>'
            f'<td>{fmt_duration(d.duration_s)}</td>'
            f'<td>{"" if d.delta is None else f"{d.delta:.1f} s"}</td>'
            f'<td class="verdict">{d.verdict}</td>'
            f'<td>{escape(d.reason)}</td>'
            f'</tr>'
        )
    header = (
        f'<summary>{escape(group.artist_display)} · {escape(group.title_display)} '
        f'<small>({len(group.decisions)} candidatas — referencia {fmt_duration(group.official_duration)} '
        f'por {group.source or "sin fuente"})</small></summary>'
    )
    table = (
        '<table><thead><tr>'
        '<th>ID</th><th>Título</th><th>Artista</th><th>Álbum</th><th>Duración</th><th>Delta</th><th>Decisión</th><th>Motivo</th>'
        '</tr></thead><tbody>' + "".join(rows) + "</tbody></table>"
    )
    return f"<details open>{header}{table}</details>"


def write_report(dest: Path, groups: list[GroupResult], *, catalog_version: int) -> tuple[int, int, int]:
    """Escribe informe.html, plan-borrado.json y plan-revisar.json. Devuelve (n_delete, n_review, n_keep)."""
    dest.mkdir(parents=True, exist_ok=True)

    # Orden del informe: grupos con más candidatos a borrar primero.
    def sort_key(g: GroupResult) -> tuple[int, int]:
        n_del = sum(1 for d in g.decisions if d.verdict == "DELETE")
        return (-n_del, -len(g.decisions))

    groups_sorted = sorted(groups, key=sort_key)

    plan_delete = []
    plan_review = []
    n_del = n_rev = n_keep = 0
    for g in groups_sorted:
        for d in g.decisions:
            if d.verdict == "DELETE":
                n_del += 1
                plan_delete.append({
                    "id": d.song_id, "title": d.title, "artist": d.artist,
                    "duration_s": d.duration_s, "reason": d.reason,
                })
            elif d.verdict == "REVIEW":
                n_rev += 1
            else:
                n_keep += 1
        if any(d.verdict == "REVIEW" for d in g.decisions) and not any(d.verdict == "DELETE" for d in g.decisions):
            plan_review.append({
                "key": g.key,
                "artist": g.artist_display,
                "title": g.title_display,
                "reference": g.official_duration,
                "source": g.source,
                "candidates": [
                    {"id": d.song_id, "duration_s": d.duration_s, "delta": d.delta, "reason": d.reason}
                    for d in g.decisions
                ],
            })

    html_parts = [HTML_HEAD]
    html_parts.append(f"<h1>Limpieza de duplicados · catálogo v{catalog_version}</h1>")
    html_parts.append(
        '<div class="summary">'
        f'<div><strong>{len(groups_sorted)}</strong>grupos con duplicados</div>'
        f'<div><strong>{n_del}</strong>a borrar</div>'
        f'<div><strong>{n_rev}</strong>a revisar</div>'
        f'<div><strong>{n_keep}</strong>a mantener</div>'
        f'<div><strong>{datetime.now(tz=timezone.utc).strftime("%Y-%m-%d %H:%M UTC")}</strong>generado</div>'
        '</div>'
    )
    html_parts.extend(render_group(g) for g in groups_sorted)
    html_parts.append(HTML_TAIL)
    (dest / "informe.html").write_text("".join(html_parts), encoding="utf-8")

    (dest / "plan-borrado.json").write_text(
        json.dumps({"catalog_version": catalog_version, "items": plan_delete}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (dest / "plan-revisar.json").write_text(
        json.dumps({"catalog_version": catalog_version, "groups": plan_review}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return n_del, n_rev, n_keep


# ---------------------------------------------------------------------------
# Entrada
# ---------------------------------------------------------------------------

def run(argv: list[str] | None = None, *, lookup=official_duration) -> int:
    parser = argparse.ArgumentParser(description=__doc__.strip().splitlines()[0])
    parser.add_argument("--remote", action="store_true", help="Lee /api/catalogo/latest en vez de catálogo local.")
    parser.add_argument("--limit", type=int, default=0, help="Procesa solo los N primeros grupos (0 = todos).")
    parser.add_argument("--out", type=Path, default=None, help="Carpeta de salida (por defecto ~/Desktop/limpiar-duplicados-<fecha>).")
    args = parser.parse_args(argv)

    songs, version = load_catalog(remote=args.remote)
    print(f"Catálogo cargado: {len(songs)} canciones (v{version}, {'remoto' if args.remote else 'local'}).")
    groups = build_groups(songs)
    if args.limit:
        groups = groups[: args.limit]
    print(f"Grupos con posibles duplicados: {len(groups)}.")

    results: list[GroupResult] = []
    for i, (key, members) in enumerate(groups, start=1):
        display_artist = members[0].get("artist", "")
        display_title = members[0].get("title", "")
        print(f"  [{i}/{len(groups)}] {display_artist} · {display_title}", flush=True)
        ref = lookup(display_artist, display_title)
        decisions = decide_group(members, ref)
        results.append(GroupResult(
            key=key, artist_display=display_artist, title_display=display_title,
            official_duration=(ref[0] if ref else None),
            source=(ref[1] if ref else None),
            decisions=decisions,
        ))
        # Pausa amable entre consultas remotas.
        if ref is not None and not args.limit:
            time.sleep(0.4)

    dest = args.out or (Path.home() / "Desktop" / f"limpiar-duplicados-{datetime.now().strftime('%Y-%m-%d')}")
    n_del, n_rev, n_keep = write_report(dest, results, catalog_version=version)
    print(f"\nInforme en {dest}/informe.html — ábrelo, revisa y cuando des OK ejecuta scripts/aplicar_borrado_duplicados.py")
    print(f"Resumen: {len(results)} grupos · {n_del} a borrar · {n_rev} a revisar · {n_keep} a mantener.")
    return 0


if __name__ == "__main__":
    sys.exit(run())
