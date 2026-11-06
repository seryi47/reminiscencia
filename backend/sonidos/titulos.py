"""Regla común de «título limpio» (ADR-0032).

Las canciones subidas toman el nombre del archivo como título, y lo que llega de YouTube trae de todo: «BAD BUNNY -
MONACO (Official Video) nadie sabe lo que va a pasar mañana», «Bad Bunny - DtMF (Letra)»... Esta regla deja título y
artista limpios. La aplica el buzón al crear cada canción (sonidos.buzon) y la operación de organize clean_titles a las
que ya están (scripts/ci_library.py). Solo cambia textos: nunca el id (SHA-256 del audio) ni el archivo.

Los datos (separadores, palabras de etiqueta, marcas de colaboración, partículas, siglas, extensiones y límites) y los
casos de prueba están en tests/contrato/titulos.json; las etiquetas exactas son las de la regla de duplicados
(sonidos.duplicados.TAGS, tests/contrato/duplicados.json), que no se repiten aquí. La web y la APK no aplican esta
regla (el contrato lo marca como no aplicable): el título lo pone el backend al publicar.

Pasos, sobre el título y el artista (clean_song):
1. Espacios: sin espacios a los lados ni dobles.
2. Extensión de vídeo o audio al final («.wmv», «.mp4»...): fuera.
3. Etiquetas (strip_tags): el primer grupo entre paréntesis o corchetes que es una etiqueta («(Official Video)»,
   «[HD]», «(Videoclip Oficial 4K)», «(Remastered 2009)»...) se quita, y con él todo lo que va detrás (subtítulos de
   YouTube), salvo los grupos de colaboración posteriores («(con X)», «(feat. X)»). Si detrás de la etiqueta viene un
   separador («KEVVO (Lyrics) - 105 F Remix»), la etiqueta va en mitad y solo se quita ella. Un grupo es etiqueta si su
   contenido normalizado es una de duplicados.TAGS o si todas sus palabras son TAG_WORDS o años y alguna no es un año.
   Un grupo «(Remix - Official Video)» se queda en «(Remix)». Al final del título, sin paréntesis, se quita una cola de
   dos o más TAG_WORDS («Dead Mom DEMO Music Video») o una sola de TRAILING_WORDS («DILES Oficial»).
4. Número de pista al principio («01 », «01. », «1 - »): fuera.
5. Artista y título separados por el PRIMER « - », « – » o « — » (con espacios), si la parte izquierda es razonable
   (no vacía, hasta MAX_PREFIX_CHARS caracteres, con alguna letra):
   - Sin artista: la izquierda es el artista y la derecha, el título.
   - Con artista, si los nombres de la izquierda (separados por comas, «&», « y », « x », « feat. »...) están todos en
     el artista: se quita el prefijo («Bad Bunny | Bad Bunny - Yonaguni» → «Bad Bunny | Yonaguni»).
   - Si no, y salvo keep_artist (artista de una playlist, ADR-0019): si el artista está entre los nombres de la
     izquierda, la izquierda pasa a ser el artista (más completo); o si todos los nombres de la izquierda son artistas
     conocidos de la biblioteca (known_artists), también (el artista era el canal de YouTube: «iPerol | Bad Bunny - DtMF»
     → «Bad Bunny | DtMF»).
6. Separadores colgando y signos sueltos: fuera («Tema -», «( Tot )»).
7. Mayúsculas: un título ENTERO en mayúsculas con al menos MIN_UPPER_LETTERS letras pasa a «Tipo Título», con las
   PARTICLES en minúscula salvo al principio (o tras «(» o un separador) y las ACRONYMS en mayúsculas. Lo mismo el
   artista que sale del título. Lo que mezcla mayúsculas y minúsculas se respeta, y el artista que ya traía la canción
   también (son nombres oficiales: «SFDK», «ROSALÍA»).
8. Nunca vacío: si el título quedaría vacío, se dejan el título y el artista de entrada.
Los pasos se repiten hasta que no cambia nada (como mucho MAX_ROUNDS veces): limpiar dos veces es limpiar una.
"""

from __future__ import annotations

import re
from collections.abc import Iterable, Mapping

from sonidos import duplicados

SEPARATORS = (" - ", " – ", " — ")
# Palabras (ya normalizadas: minúsculas, sin acentos ni signos) que forman una etiqueta cuando todo el grupo son ellas.
TAG_WORDS = (
    "official", "oficial", "video", "videoclip", "clip", "music", "musical", "audio", "lyric", "lyrics", "letra",
    "visualizer", "visualiser", "hd", "hq", "4k", "8k", "1080p", "720p", "360", "remaster", "remastered",
    "remasterizado", "remasterizada",
)
# Palabras que se quitan solas al final del título, sin paréntesis («DILES Oficial» → «DILES»).
TRAILING_WORDS = ("oficial", "official")
# Primera palabra de un grupo de colaboración, que se conserva aunque vaya detrás de una etiqueta.
COLLAB_MARKS = ("ft", "feat", "featuring", "con", "with")
# Separadores de los nombres de un crédito de artista («A, B y C», «A & B», «A x B», «A feat. B»).
CREDIT_SEPARATORS = (",", "&", "+", "/", "y", "x", "e", "and", "vs", "feat", "ft", "featuring", "con", "with")
PARTICLES = (
    "a", "al", "con", "de", "del", "e", "el", "en", "la", "las", "lo", "los", "o", "para", "por", "sin", "u", "un",
    "una", "y",
)
ACRONYMS = ("DJ", "MC", "TV", "EP", "LP", "UK", "USA", "II", "III", "IV", "VII", "VIII", "IX", "XI", "XII", "XX")
EXTENSIONS = (
    ".mp3", ".mp4", ".m4a", ".wav", ".flac", ".ogg", ".opus", ".wmv", ".avi", ".flv", ".mkv", ".webm", ".mov",
)
MAX_PREFIX_CHARS = 80
MIN_UPPER_LETTERS = 4
MAX_ROUNDS = 8

_TAG_WORDS = frozenset(TAG_WORDS)
_TRAILING_WORDS = frozenset(TRAILING_WORDS)
_COLLAB = frozenset(COLLAB_MARKS)
_PARTICLES = frozenset(PARTICLES)
_ACRONYMS = frozenset(ACRONYMS)
_EXACT_TAGS = frozenset(duplicados.TAGS)
_YEAR = re.compile(r"(?:19|20)[0-9]{2}")
_GROUP = re.compile(r"[(\[]([^()\[\]]*)[)\]]")
_SPACES = re.compile(r"\s+")
_TRACK = re.compile(r"^(?:0[0-9](?:\s*[.)\-–—]\s*|\s+)|[0-9]{1,3}\s*(?:[.)]|\s[-–—])\s+)")
_SEPARATOR = re.compile(r"\s[-–—]\s")
_SEPARATOR_AFTER = re.compile(r"\s*[-–—]\s")
_CREDIT_SPLIT = re.compile(
    r"\s*[,&+/]\s*|\s+(?:y|x|e|and|vs\.?|feat\.?|ft\.?|featuring|con|with)\s+", re.IGNORECASE,
)
_DANGLING = "-–—|:;,/·•"
_SPACE_BEFORE_PUNCT = re.compile(r"\s+([,;:!?)\]])")
_SPACE_AFTER_OPEN = re.compile(r"([(\[])\s+")
_EMPTY_GROUP = re.compile(r"\(\s*\)|\[\s*\]")


def _spaces(text: str) -> str:
    return _SPACES.sub(" ", text).strip()


def _words(text: str) -> list[str]:
    return duplicados.normalize_artist(text).split()


def is_tag(content: str) -> bool:
    """¿El contenido de un grupo entre paréntesis o corchetes es una etiqueta (ver el docstring del módulo)?"""
    words = _words(content)
    if not words:
        return False
    if " ".join(words) in _EXACT_TAGS:
        return True
    return all(word in _TAG_WORDS or _YEAR.fullmatch(word) for word in words) and any(
        not _YEAR.fullmatch(word) for word in words
    )


def _is_collab(content: str) -> bool:
    words = _words(content)
    return bool(words) and words[0] in _COLLAB


def _trailing_tag(text: str) -> str:
    """Quita una cola de dos o más palabras de etiqueta sin paréntesis («Tema Official Video» → «Tema»)."""
    tokens = text.split(" ")
    cut = len(tokens)
    while cut > 0:
        words = _words(tokens[cut - 1])
        if not words or not all(word in _TAG_WORDS for word in words):
            break
        cut -= 1
    tail = tokens[cut:]
    if len(tail) >= 2 or (len(tail) == 1 and _words(tail[0])[0] in _TRAILING_WORDS):
        return " ".join(tokens[:cut])
    return text


def strip_tags(title: str) -> str:
    """Pasos 2 y 3: extensión, etiquetas entre paréntesis o corchetes (y lo que va detrás) y cola de etiquetas."""
    text = title
    lower = text.lower()
    for extension in EXTENSIONS:
        if lower.endswith(extension) and len(text) > len(extension):
            text = text[: -len(extension)]
            break
    position = 0
    while True:
        match = _GROUP.search(text, position)
        if match is None:
            break
        content = match.group(1)
        if is_tag(content) and _SEPARATOR_AFTER.match(text, match.end()):
            # «Artista (Lyrics) - Título»: la etiqueta va en mitad; solo se quita ella.
            text = text[: match.start()].rstrip() + " " + text[match.end():].lstrip()
            position = match.start()
            continue
        if is_tag(content):
            kept = [
                later.group(0) for later in _GROUP.finditer(text, match.end()) if _is_collab(later.group(1))
            ]
            text = " ".join([text[: match.start()].rstrip(), *kept])
            break
        inner = _SEPARATOR.split(content)
        if len(inner) > 1 and is_tag(inner[-1]) and _spaces(" - ".join(inner[:-1])):
            replacement = f"{match.group(0)[0]}{_spaces(content[: _last_separator(content)])}{match.group(0)[-1]}"
            text = text[: match.start()] + replacement + text[match.end():]
            position = match.start() + len(replacement)
            continue
        position = match.end()
    return _trailing_tag(_spaces(text))


def _last_separator(content: str) -> int:
    return [found.start() for found in _SEPARATOR.finditer(content)][-1]


def _tidy(text: str) -> str:
    """Paso 6: sin grupos vacíos, sin espacios dentro de los paréntesis ni antes de un signo y sin separadores a los
    lados."""
    text = _EMPTY_GROUP.sub(" ", text)
    text = _SPACE_AFTER_OPEN.sub(r"\1", text)
    text = _SPACE_BEFORE_PUNCT.sub(r"\1", text)
    text = _spaces(text)
    while text and (text[0] in _DANGLING or text[-1] in _DANGLING):
        text = _spaces(text.strip(_DANGLING))
    return text


def credits(artist: str) -> frozenset[str]:
    """Los nombres de un crédito de artista, normalizados como en la regla de duplicados."""
    names = (duplicados.normalize_artist(part) for part in _CREDIT_SPLIT.split(artist))
    return frozenset(name for name in names if name)


def known_artists(songs: Iterable[Mapping], folders: Iterable[Mapping] = ()) -> frozenset[str]:
    """Los nombres de artista que ya hay en la biblioteca (canciones y álbumes), normalizados."""
    names: set[str] = set()
    for item in [*songs, *folders]:
        artist = item.get("artist")
        if isinstance(artist, str):
            names |= credits(artist)
    return frozenset(names)


def _reasonable_prefix(left: str) -> bool:
    return 0 < len(left) <= MAX_PREFIX_CHARS and any(char.isalpha() for char in left)


def is_all_caps(text: str) -> bool:
    """¿Todo el texto en mayúsculas, con al menos MIN_UPPER_LETTERS letras con mayúscula y minúscula?"""
    cased = [char for char in text if char.isupper() or char.islower()]
    return len(cased) >= MIN_UPPER_LETTERS and not any(char.islower() for char in cased)


def _capitalize(word: str) -> str:
    """Primera letra en mayúscula y el resto en minúscula; también tras un guion interior («SKA-P» → «Ska-P»)."""
    result = []
    upper_next = True
    for char in word.lower():
        if char.isalpha():
            result.append(char.upper() if upper_next else char)
            upper_next = False
        else:
            result.append(char)
            if char == "-":
                upper_next = True
    return "".join(result)


def title_case(text: str) -> str:
    """Paso 7: «Tipo Título» con partículas en minúscula y siglas en mayúscula. Solo si todo está en mayúsculas."""
    if not is_all_caps(text):
        return text
    tokens = text.split(" ")
    result = []
    starts = True
    for token in tokens:
        core = token.strip("([¡¿\"'«“‘)]!?,.;:»”’")
        if core.upper() in _ACRONYMS or any(char.isdigit() for char in token):
            word = token
        elif not starts and core.lower() in _PARTICLES and not token.startswith(("(", "[")):
            word = token.lower()
        else:
            word = _capitalize(token)
        result.append(word)
        starts = token in ("-", "–", "—") or token.endswith((":", "(", "["))
    return " ".join(result)


def _round(title: str, artist: str, *, keep_artist: bool, known: frozenset[str]) -> tuple[str, str]:
    title = _spaces(title)
    artist = _spaces(artist)
    title = strip_tags(title)
    stripped = _TRACK.sub("", title, count=1)
    if stripped.strip():
        title = stripped
    title = _tidy(title)
    match = _SEPARATOR.search(title)
    if match is not None and match.group(0) in SEPARATORS:
        left, right = _tidy(title[: match.start()]), _tidy(title[match.end():])
        if _reasonable_prefix(left) and right:
            if not artist:
                artist, title = title_case(left), right
            else:
                prefix_names, artist_names = credits(left), credits(artist)
                if prefix_names and prefix_names <= artist_names:
                    title = right
                elif not keep_artist and artist_names and artist_names <= prefix_names:
                    artist, title = title_case(left), right
                elif not keep_artist and prefix_names and prefix_names <= known:
                    artist, title = title_case(left), right
    return title_case(_tidy(title)), artist


def clean_song(title: object, artist: object = "", *, keep_artist: bool = False,
               known_artists: Iterable[str] = ()) -> tuple[str, str]:
    """(título, artista) limpios (ver el docstring del módulo). keep_artist: el artista viene de una playlist y se
    respeta (solo se quita del título el prefijo «ese artista - »). known_artists: nombres normalizados de artistas de la
    biblioteca (known_artists()); con ellos se reconoce el artista de un título cuyo artista es el canal de YouTube."""
    original_title = title if isinstance(title, str) else ""
    original_artist = artist if isinstance(artist, str) else ""
    known = frozenset(known_artists)
    current = (original_title, original_artist)
    for _ in range(MAX_ROUNDS):
        following = _round(*current, keep_artist=keep_artist, known=known)
        if following == current:
            break
        current = following
    if not current[0]:
        return original_title, original_artist
    return current


def plan_clean(data: Mapping, song_ids: Iterable[str] | None = None) -> list[dict]:
    """Los cambios que haría clean_titles en el catálogo, sin tocarlo: [{"id", "antes": {...}, "despues": {...}}] con
    título y artista, solo de las canciones que cambian, en el orden del catálogo. song_ids: solo esas (None: todas).

    Los artistas conocidos son los del catálogo más los que salen al limpiar, hasta que no cambian: así volver a
    limpiar no encuentra nada nuevo."""
    songs = list(data.get("songs", []))
    folders = list(data.get("folders", []))
    wanted = None if song_ids is None else set(song_ids)
    targets = [song for song in songs if wanted is None or song.get("id") in wanted]
    known = known_artists(songs, folders)
    results: dict[str, tuple[str, str]] = {}
    for _ in range(MAX_ROUNDS):
        results = {
            song["id"]: clean_song(song.get("title"), song.get("artist") or "", known_artists=known)
            for song in songs
        }
        grown = known | known_artists({"artist": artist} for _, artist in results.values())
        if grown == known:
            break
        known = grown
    changes = []
    for song in targets:
        title, artist = results[song["id"]]
        before = {"title": song.get("title"), "artist": song.get("artist") or ""}
        if (title, artist) != (before["title"], before["artist"]):
            changes.append({"id": song["id"], "antes": before, "despues": {"title": title, "artist": artist}})
    return changes
