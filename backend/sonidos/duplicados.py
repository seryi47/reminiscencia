"""Regla común de «posible duplicado» (ADR-0026).

Hasta ahora solo se detectaban los ficheros idénticos (misma huella SHA-256). Esta regla avisa también de la misma
canción en otro fichero: título normalizado igual y duración dentro de ±2 s; o, si falta alguna duración, título y
artista normalizados iguales. Solo avisa: nunca bloquea una subida.

La web (frontend/web/js/duplicates.js) y la APK (mobile/lib/duplicates.dart) aplican exactamente la misma regla con los
mismos datos. Los datos (pliegue de letras, etiquetas entre paréntesis o corchetes y marcas de featuring) y los casos de
prueba están en tests/contrato/duplicados.json, que leen las tres suites de pruebas y comparan con las constantes de
cada implementación.

Normalización del título: minúsculas; sin marcas diacríticas combinantes (U+0300 a U+036F) y con las letras de FOLD_FROM
plegadas a FOLD_TO; sin los grupos entre paréntesis o corchetes cuyo contenido, sin signos, es una de las TAGS o empieza
por una marca de FEATURING; todo lo que no es letra ni número pasa a espacio; desde la primera marca de featuring que no
es la primera palabra, se corta el resto; espacios simples. El artista se normaliza igual, sin quitar grupos ni cortar.
"""

from __future__ import annotations

import math
import re
from collections.abc import Iterable, Mapping

TOLERANCE_S = 2
FOLD_FROM = "áàäâãåāéèëêēíìïîīóòöôõøōúùüûūñçýÿ"
FOLD_TO = "aaaaaaaeeeeeiiiiiooooooouuuuuncyy"
# Contenido de un paréntesis o corchete que se quita del título («(Official Video)», «[HD]», «(Letra)»…), ya
# normalizado (minúsculas, sin acentos ni signos).
TAGS = (
    "official video",
    "official music video",
    "official audio",
    "official lyric video",
    "official visualizer",
    "lyric video",
    "lyrics video",
    "video lyric",
    "video lyrics",
    "video oficial",
    "videoclip oficial",
    "videoclip",
    "video",
    "audio oficial",
    "audio",
    "letra",
    "con letra",
    "lyrics",
    "lyric",
    "visualizer",
    "hd",
    "hq",
    "4k",
)
FEATURING = ("ft", "feat", "featuring")

_FOLD = str.maketrans(FOLD_FROM, FOLD_TO)
_TAGS = frozenset(TAGS)
_FEATURING = frozenset(FEATURING)
_COMBINING = re.compile("[̀-ͯ]")
# Lo que no es letra ni número (\w de Python son las letras y los números Unicode, más el guion bajo).
_SIGNS = re.compile(r"[\W_]+")
_GROUP = re.compile(r"[(\[]([^()\[\]]*)[)\]]")


def _fold(text: object) -> str:
    value = text if isinstance(text, str) else ""
    return _COMBINING.sub("", value.lower()).translate(_FOLD)


def _words(text: str) -> list[str]:
    return _SIGNS.sub(" ", text).split()


def _drop_group(match: re.Match) -> str:
    words = _words(match.group(1))
    if words and (" ".join(words) in _TAGS or words[0] in _FEATURING):
        return " "
    return f" {match.group(1)} "


def normalize_title(title: object) -> str:
    """El título comparable (ver el docstring del módulo). Puede quedar vacío."""
    words = _words(_GROUP.sub(_drop_group, _fold(title)))
    for index, word in enumerate(words):
        if index > 0 and word in _FEATURING:
            words = words[:index]
            break
    return " ".join(words)


def normalize_artist(artist: object) -> str:
    """El artista comparable: minúsculas, sin acentos ni signos y con espacios simples."""
    return " ".join(_words(_fold(artist)))


def _duration(value: object) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    if not math.isfinite(value) or value <= 0:
        return None
    return float(value)


def is_possible_duplicate(a: Mapping, b: Mapping) -> bool:
    """¿Parecen la misma canción? a y b tienen "title", "artist" y "duration_s" (este puede faltar o ser None)."""
    title = normalize_title(a.get("title"))
    if not title or title != normalize_title(b.get("title")):
        return False
    duration_a = _duration(a.get("duration_s"))
    duration_b = _duration(b.get("duration_s"))
    if duration_a is not None and duration_b is not None:
        return abs(duration_a - duration_b) <= TOLERANCE_S
    return normalize_artist(a.get("artist")) == normalize_artist(b.get("artist"))


def possible_duplicates(candidate: Mapping, songs: Iterable[Mapping]) -> list[Mapping]:
    """Las canciones de songs que parecen la misma que candidate (sin contarla a ella misma, por su "id")."""
    own_id = candidate.get("id")
    return [
        song for song in songs
        if (own_id is None or song.get("id") != own_id) and is_possible_duplicate(candidate, song)
    ]


def format_duration(seconds: object) -> str:
    """«3:21», «1:02:05» o «—», como la web y la APK."""
    value = _duration(seconds)
    if value is None:
        return "—"
    total = int(value)
    hours, rest = divmod(total, 3600)
    minutes, secs = divmod(rest, 60)
    return f"{hours}:{minutes:02d}:{secs:02d}" if hours else f"{minutes}:{secs:02d}"
