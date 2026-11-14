"""Normalización de volumen (ADR-0046): mide la sonoridad integrada (EBU R128 / LUFS) de un audio con ffmpeg y calcula el
`gain_db` que lo acerca a una referencia común. Los reproductores (web y APK) aplican ese `gain_db` como atenuación al
reproducir, así toda la biblioteca suena a un nivel parecido sin tener que subir y bajar el volumen entre canciones.

Como ni el elemento <audio> de la web ni just_audio en la APK permiten volumen por encima de 1.0, el `gain_db` POSITIVO
(temas flojos) no se puede aplicar subiendo volumen; el reproductor lo recorta a 1.0. Por eso la referencia es relativamente
baja (-16 LUFS): la mayoría de las grabaciones modernas están MÁS altas que eso, así que se ATENÚAN hacia la referencia
(que es justo la queja: «unas suenan excesivamente fuertes»). Los pocos temas más flojos que la referencia se quedan como
están (subirlos requeriría un GainNode en web / bakear la ganancia en el fichero; queda como mejora futura).

El cálculo necesita ffmpeg (decodifica el audio). En el pipeline, el camino de copia de Opus (ADR-0042) NO usa ffmpeg, así
que el `gain_db` se calcula en un paso aparte (scripts/analizar_volumen.py) que sí tiene ffmpeg, en vez de reintroducir la
dependencia en cada subida.
"""

from __future__ import annotations

import math
import re
import shutil
import subprocess
from pathlib import Path

# Referencia de sonoridad. ReplayGain clásico usa -18 LUFS; el streaming ~-14. -16 es un término medio: uniforme sin dejar
# la biblioteca demasiado baja.
LOUDNESS_TARGET_LUFS = -16.0
# Límites de cordura para el gain calculado (dB). Evita atenuar/ganar en exceso por una medición rara.
GAIN_MIN_DB = -15.0
GAIN_MAX_DB = 12.0
# Por debajo de esto es prácticamente silencio: la medición no es fiable y no se aplica ganancia.
SILENCE_LUFS = -70.0

_INTEGRATED_RE = re.compile(r"\bI:\s*(-?\d+(?:\.\d+)?)\s*LUFS")


def measure_lufs(path: str | Path, *, ffmpeg: str = "ffmpeg") -> float | None:
    """Sonoridad integrada en LUFS, medida con `ffmpeg -af ebur128`; None si no se puede medir (sin ffmpeg, error o silencio)."""
    executable = shutil.which(ffmpeg) or ffmpeg
    try:
        result = subprocess.run(
            [executable, "-nostats", "-hide_banner", "-i", str(path), "-af", "ebur128", "-f", "null", "-"],
            capture_output=True,
            text=True,
            check=False,
        )
    except (OSError, ValueError):
        return None
    matches = _INTEGRATED_RE.findall(result.stderr or "")
    if not matches:
        return None
    try:
        lufs = float(matches[-1])
    except ValueError:
        return None
    if not math.isfinite(lufs) or lufs <= SILENCE_LUFS:
        return None
    return lufs


def gain_db_for(lufs: float | None, *, target: float = LOUDNESS_TARGET_LUFS) -> float | None:
    """Ganancia en dB (acotada) para llevar `lufs` a `target`; None si no hay medición."""
    if lufs is None:
        return None
    gain = target - lufs
    return round(max(GAIN_MIN_DB, min(GAIN_MAX_DB, gain)), 1)


def measure_gain_db(path: str | Path, *, target: float = LOUDNESS_TARGET_LUFS, ffmpeg: str = "ffmpeg") -> float | None:
    """Mide y devuelve directamente el `gain_db` de un archivo; None si no se puede medir."""
    return gain_db_for(measure_lufs(path, ffmpeg=ffmpeg), target=target)


def backfill_gain(
    data: dict,
    audio_dir: str | Path,
    *,
    target: float = LOUDNESS_TARGET_LUFS,
    force: bool = False,
    limit: int | None = None,
    measure=measure_gain_db,
    set_gain=None,
) -> dict:
    """Rellena `gain_db` en el catálogo `data` midiendo el audio de `audio_dir/<id>.opus` (ADR-0046). Idempotente: por defecto
    solo mide las canciones que aún no tienen `gain_db` (con `force`, todas). `limit` acota cuántas se miden por ejecución (para
    repartir el coste en tandas). `measure`/`set_gain` se inyectan en las pruebas. Devuelve un resumen."""
    from sonidos import catalog as _catalog  # import perezoso: evita un ciclo de importación

    apply_gain = set_gain or _catalog.set_gain
    audio_dir = Path(audio_dir)
    summary = {"medidas": 0, "actualizadas": 0, "sin_audio": 0, "sin_medir": 0, "omitidas": 0}
    for song in data.get("songs", []):
        if limit is not None and summary["medidas"] >= limit:
            break
        if not force and song.get("gain_db") is not None:
            summary["omitidas"] += 1
            continue
        path = audio_dir / f"{song['id']}.opus"
        if not path.exists():
            summary["sin_audio"] += 1
            continue
        summary["medidas"] += 1
        gain = measure(path, target=target)
        if gain is None:
            summary["sin_medir"] += 1
            continue
        if apply_gain(data, song["id"], gain):
            summary["actualizadas"] += 1
    return summary
