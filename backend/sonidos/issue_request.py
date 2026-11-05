"""Contrato de las peticiones de biblioteca (ADR-0008).

Una petición es un texto con líneas 'clave: valor'. Llega como cuerpo de una incidencia de
GitHub con la etiqueta 'biblioteca' o como campos del formulario manual del workflow.
Este módulo la valida antes de tocar la red o el catálogo:

- Claves permitidas: action, url, license, title, payload. Una clave desconocida o repetida es
  un error. Una línea sin dos puntos se ignora. Una clave con valor vacío equivale a no enviarla.
  Límite total: 8000 caracteres.
- action import: url obligatoria (http o https, sin plataformas bloqueadas). Internet Archive
  (archive.org/details/<id>, archive.org/download/<id> o archive.org/download/<id>/<fichero>; el fichero
  no se usa), o un fichero de audio directo que exige license. title y license son opcionales en el resto
  de casos. No admite payload.
- action organize: payload obligatorio, un objeto JSON en una sola línea. No admite url, license ni title.
  Operaciones: create_folder (name, parent_id y artist opcionales), rename_folder, edit_folder (name obligatorio y
  artist opcional, ADR-0016), delete_folder, edit_song, move_songs (pasar de 1 a 100 canciones a un álbum, o sacarlas
  de su álbum con folder_id null, en una sola petición atómica; ADR-0023), order_album (el orden nuevo de las canciones
  de un álbum: la lista completa y exacta de sus canciones, de 1 a 190; ADR-0026) y organize_youtube_playlist (reparar
  un álbum y los artistas de todas sus canciones en una petición).

Las URL se validan con sonidos.sources (classify, resolve_direct_file, ia_identifier): la misma
lógica que usa la importación.
"""

from __future__ import annotations

import json
import re
import unicodedata
from collections.abc import Mapping
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

from sonidos import catalog
from sonidos.sources import SourceError, classify, ia_identifier, resolve_direct_file

MAX_REQUEST_CHARS = 8000
ALLOWED_KEYS = ("action", "url", "license", "title", "payload")
ACTIONS = ("import", "organize")
MAX_URL_CHARS = 2048
MAX_LICENSE_CHARS = 300
MAX_TITLE_CHARS = 200
MAX_PAYLOAD_CHARS = 4000
MAX_FOLDER_NAME_CHARS = 80
MAX_FOLDER_ARTIST_CHARS = 80
MAX_ARTIST_CHARS = catalog.SONG_ARTIST_MAX_CHARS
MAX_TAGS = 20
MAX_TAG_CHARS = 40
YEAR_MIN = catalog.YEAR_MIN
YEAR_MAX = catalog.YEAR_MAX

# Carpetas nuevas: F seguida de 16 hexadecimales (ADR-0016). Las anteriores, de 10 hexadecimales, siguen valiendo.
FOLDER_ID_RE = re.compile(r"F[0-9a-f]{16}|[0-9a-f]{10}")
SONG_ID_RE = re.compile(r"S[0-9a-f]{16}")
ENV_NAME_RE = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")
YOUTUBE_PLAYLIST_ID_RE = re.compile(r"[A-Za-z0-9_-]{1,200}")

# Operaciones de organize: campos obligatorios y opcionales, además de "op".
OPERATIONS = {
    "create_folder": (frozenset({"name"}), frozenset({"parent_id", "artist"})),
    "rename_folder": (frozenset({"folder_id", "name"}), frozenset()),
    "edit_folder": (frozenset({"folder_id", "name"}), frozenset({"artist"})),
    "delete_folder": (frozenset({"folder_id"}), frozenset()),
    "edit_song": (
        frozenset({"song_id"}),
        frozenset({"title", "artist", "year", "tags", "folder_id", "public"}),
    ),
    "move_songs": (frozenset({"song_ids", "folder_id"}), frozenset()),
    "order_album": (frozenset({"folder_id", "song_ids"}), frozenset()),
    "organize_youtube_playlist": (
        frozenset({"playlist_id", "name", "songs"}),
        frozenset(),
    ),
}
# Canciones por petición de move_songs: 100 ids caben de sobra en los 4000 caracteres del payload.
MAX_MOVE_SONGS = 100
# Canciones de un álbum que se pueden ordenar en una petición de order_album (ADR-0026): con ids de álbum F + 16
# hexadecimales, el payload normalizado ocupa 65 + 20 × n caracteres; 190 dan 3865, dentro de los 4000.
MAX_ORDER_SONGS = 190

# Claves de la petición manual y la variable de entorno de la que se leen.
_MANUAL_FIELDS = (
    ("action", "ACTION"),
    ("url", "URL"),
    ("license", "LICENSE"),
    ("title", "TITLE"),
    ("payload", "PAYLOAD"),
)


class RequestError(ValueError):
    """La petición no es válida. El mensaje se publica en la incidencia."""


def parse_request(body: str | None) -> dict:
    """Valida el texto de una petición y devuelve la petición normalizada.

    Resultado: {"action", "url", "license", "title", "payload"}. Los campos que no aplican son None.
    En organize, "payload" es el objeto ya normalizado por validate_payload.
    """
    text = "" if body is None else body
    if len(text) > MAX_REQUEST_CHARS:
        raise RequestError(f"la petición supera los {MAX_REQUEST_CHARS} caracteres")
    fields = _read_fields(text)
    action = fields.get("action", "")
    if not action:
        raise RequestError("falta la clave action (import u organize)")
    if action not in ACTIONS:
        raise RequestError(f"acción desconocida: {_shown(action)}; usa import u organize")
    if action == "import":
        return _import_request(fields)
    return _organize_request(fields)


def request_from_env(env: Mapping[str, str]) -> dict:
    """Petición manual: arma el texto con ACTION, URL, LICENSE, TITLE y PAYLOAD (los vacíos se omiten)
    y lo valida por la misma ruta que una incidencia."""
    lines = []
    for key, name in _MANUAL_FIELDS:
        value = (env.get(name) or "").strip()
        if not value:
            continue
        if _has_control(value):
            raise RequestError(f"{name} contiene un salto de línea o un carácter de control")
        lines.append(f"{key}: {value}")
    return parse_request("\n".join(lines))


def validate_payload(data: object) -> dict:
    """Valida y normaliza el objeto JSON de una operación de organize (contrato C de ADR-0008)."""
    if not isinstance(data, dict):
        raise RequestError("el payload debe ser un objeto JSON")
    if "op" not in data:
        raise RequestError("falta el campo op en el payload")
    operation = data["op"]
    if not isinstance(operation, str) or operation not in OPERATIONS:
        raise RequestError(f"operación desconocida: {_shown(str(operation))}")
    required, optional = OPERATIONS[operation]
    unknown = sorted(set(data) - {"op"} - required - optional)
    if unknown:
        raise RequestError(f"campo desconocido en {operation}: {', '.join(unknown)}")
    missing = sorted(required - set(data))
    if missing:
        raise RequestError(f"falta el campo {', '.join(missing)} en {operation}")

    if operation == "create_folder":
        result = {
            "op": operation,
            "name": _text(data["name"], "name", 1, MAX_FOLDER_NAME_CHARS),
            "parent_id": _folder_id(data.get("parent_id"), field="parent_id", nullable=True),
        }
        if "artist" in data:
            result["artist"] = _text(data["artist"], "artist", 0, MAX_FOLDER_ARTIST_CHARS)
        return result
    if operation == "edit_folder":
        result = {
            "op": operation,
            "folder_id": _folder_id(data["folder_id"], field="folder_id"),
            "name": _text(data["name"], "name", 1, MAX_FOLDER_NAME_CHARS),
        }
        if "artist" in data:
            result["artist"] = _text(data["artist"], "artist", 0, MAX_FOLDER_ARTIST_CHARS)
        return result
    if operation == "rename_folder":
        return {
            "op": operation,
            "folder_id": _folder_id(data["folder_id"], field="folder_id"),
            "name": _text(data["name"], "name", 1, MAX_FOLDER_NAME_CHARS),
        }
    if operation == "delete_folder":
        return {"op": operation, "folder_id": _folder_id(data["folder_id"], field="folder_id")}
    if operation == "move_songs":
        return {
            "op": operation,
            "song_ids": _song_ids(data["song_ids"], MAX_MOVE_SONGS),
            "folder_id": _folder_id(data["folder_id"], field="folder_id", nullable=True),
        }
    if operation == "order_album":
        # La lista tiene que ser exactamente la de las canciones del álbum; eso lo comprueba quien la aplica
        # (catalog.order_album), porque aquí no se conoce el catálogo.
        return {
            "op": operation,
            "folder_id": _folder_id(data["folder_id"], field="folder_id"),
            "song_ids": _song_ids(data["song_ids"], MAX_ORDER_SONGS),
        }
    if operation == "organize_youtube_playlist":
        playlist_id = data["playlist_id"]
        if not isinstance(playlist_id, str) or not YOUTUBE_PLAYLIST_ID_RE.fullmatch(playlist_id):
            raise RequestError("playlist_id no es válido")
        raw_songs = data["songs"]
        if not isinstance(raw_songs, list) or not 1 <= len(raw_songs) <= 200:
            raise RequestError("songs debe contener entre 1 y 200 canciones")
        songs = []
        seen = set()
        for entry in raw_songs:
            if not isinstance(entry, dict) or set(entry) != {"song_id", "artist"}:
                raise RequestError("cada canción debe incluir solo song_id y artist")
            song_id = _song_id(entry["song_id"])
            if song_id in seen:
                raise RequestError(f"song_id repetido en songs: {song_id}")
            seen.add(song_id)
            songs.append({
                "song_id": song_id,
                "artist": _text(entry["artist"], "artist", 0, MAX_ARTIST_CHARS),
            })
        return {
            "op": operation,
            "playlist_id": playlist_id,
            "name": _text(data["name"], "name", 1, MAX_TITLE_CHARS),
            "songs": songs,
        }
    return _edit_song(data)


def to_github_env(request: Mapping) -> dict[str, str]:
    """Variables para GITHUB_ENV: ACTION, URL, LICENSE, TITLE y PAYLOAD (JSON compacto en una línea)."""
    payload = request.get("payload")
    return {
        "ACTION": request["action"],
        "URL": request.get("url") or "",
        "LICENSE": request.get("license") or "",
        "TITLE": request.get("title") or "",
        "PAYLOAD": _compact_json(payload) if payload is not None else "",
    }


def write_github_env(path: str | Path, env: Mapping[str, str]) -> None:
    """Añade líneas KEY=VALUE al fichero GITHUB_ENV. Valida todo antes de escribir y rechaza saltos de línea."""
    lines = []
    for name, value in env.items():
        if not isinstance(name, str) or not ENV_NAME_RE.fullmatch(name):
            raise RequestError(f"nombre de variable no válido: {name!r}")
        if not isinstance(value, str):
            raise RequestError(f"el valor de {name} debe ser texto")
        if "\n" in value or "\r" in value or _has_control(value):
            raise RequestError(f"el valor de {name} contiene un salto de línea o un carácter de control")
        lines.append(f"{name}={value}\n")
    with Path(path).open("a", encoding="utf-8") as handle:
        handle.writelines(lines)


def summarize(request: Mapping) -> dict:
    """Resumen para el registro del workflow: nunca los valores del payload ni la query de la URL (firmas)."""
    payload = request.get("payload") or {}
    return {
        "action": request["action"],
        "url": _url_sin_datos(request.get("url")),
        "title": request.get("title"),
        "op": payload.get("op"),
        "campos": sorted(key for key in payload if key != "op"),
    }


# --- Lectura del texto -------------------------------------------------------------------------


def _read_fields(text: str) -> dict[str, str]:
    fields: dict[str, str] = {}
    for raw in text.split("\n"):
        line = raw.rstrip("\r")
        if ":" not in line:
            continue
        key, _, value = line.partition(":")
        key = key.strip()
        if key not in ALLOWED_KEYS:
            raise RequestError(f"clave desconocida: {_shown(key) or '(vacía)'}")
        if key in fields:
            raise RequestError(f"clave repetida: {key}")
        value = value.strip()
        if _has_control(value):
            raise RequestError(f"el valor de {key} contiene caracteres de control")
        fields[key] = value
    return fields


def _import_request(fields: dict[str, str]) -> dict:
    if fields.get("payload"):
        raise RequestError("import no admite payload")
    url = fields.get("url", "")
    if not url:
        raise RequestError("import necesita la clave url")
    _check_length(url, MAX_URL_CHARS, "url")
    if any(char.isspace() for char in url):
        raise RequestError("la url no puede contener espacios")
    license_text = _optional(fields, "license", MAX_LICENSE_CHARS)
    title = _optional(fields, "title", MAX_TITLE_CHARS)
    if _checked(classify, url) == "internet-archive":
        _checked(ia_identifier, url)
    else:
        _checked(resolve_direct_file, url, license_text)
    return {"action": "import", "url": url, "license": license_text, "title": title, "payload": None}


def _organize_request(fields: dict[str, str]) -> dict:
    for key in ("url", "license", "title"):
        if fields.get(key):
            raise RequestError(f"organize no admite la clave {key}")
    raw = fields.get("payload", "")
    if not raw:
        raise RequestError("organize necesita la clave payload (un objeto JSON en una sola línea)")
    _check_length(raw, MAX_PAYLOAD_CHARS, "payload")
    payload = validate_payload(_load_json_object(raw))
    if len(_compact_json(payload)) > MAX_PAYLOAD_CHARS:
        raise RequestError(f"payload supera los {MAX_PAYLOAD_CHARS} caracteres una vez normalizado")
    return {"action": "organize", "url": None, "license": None, "title": None, "payload": payload}


def _load_json_object(raw: str) -> dict:
    try:
        data = json.loads(raw, object_pairs_hook=_object_without_duplicates)
    except RequestError:
        raise
    except (ValueError, RecursionError) as error:
        raise RequestError("payload no es JSON válido") from error
    if not isinstance(data, dict):
        raise RequestError("payload debe ser un objeto JSON entre llaves, no una lista ni un valor suelto")
    return data


def _object_without_duplicates(pairs: list[tuple[str, object]]) -> dict:
    result: dict = {}
    for key, value in pairs:
        if key in result:
            raise RequestError(f"clave repetida en el payload: {_shown(key)}")
        result[key] = value
    return result


# --- Operaciones de organize -------------------------------------------------------------------


def _edit_song(data: dict) -> dict:
    result: dict = {"op": "edit_song", "song_id": _song_id(data["song_id"])}
    if "title" in data:
        result["title"] = _text(data["title"], "title", 1, MAX_TITLE_CHARS)
    if "artist" in data:
        result["artist"] = _text(data["artist"], "artist", 0, MAX_ARTIST_CHARS)
    if "year" in data:
        result["year"] = _year(data["year"])
    if "tags" in data:
        result["tags"] = _tags(data["tags"])
    if "folder_id" in data:
        result["folder_id"] = _folder_id(data["folder_id"], field="folder_id", nullable=True)
    if "public" in data:
        result["public"] = _strict_bool(data["public"], "public")
    if not [key for key in result if key not in ("op", "song_id")]:
        raise RequestError("edit_song necesita al menos un campo que cambiar")
    return result


def _text(value: object, field: str, minimum: int, maximum: int) -> str:
    if not isinstance(value, str):
        raise RequestError(f"{field} debe ser texto")
    clean = value.strip()
    if _has_control(clean):
        raise RequestError(f"{field} contiene caracteres de control")
    if len(clean) < minimum:
        raise RequestError(f"{field} no puede estar vacío")
    if len(clean) > maximum:
        raise RequestError(f"{field} supera los {maximum} caracteres")
    return clean


def _folder_id(value: object, *, field: str, nullable: bool = False) -> str | None:
    if value is None and nullable:
        return None
    if not isinstance(value, str) or not FOLDER_ID_RE.fullmatch(value):
        raise RequestError(
            f"{field} no es un id de carpeta válido (F seguida de 16 caracteres hexadecimales en minúscula, o 10 "
            "hexadecimales en minúscula en las carpetas anteriores)"
        )
    return value


def _song_id(value: object) -> str:
    if not isinstance(value, str) or not SONG_ID_RE.fullmatch(value):
        raise RequestError("song_id no es un id de canción válido (S seguida de 16 caracteres hexadecimales en minúscula)")
    return value


def _song_ids(value: object, maximum: int) -> list[str]:
    """Lista de 1 a maximum ids de canción válidos y sin repetir (move_songs y order_album)."""
    if not isinstance(value, list) or not 1 <= len(value) <= maximum:
        raise RequestError(f"song_ids debe contener entre 1 y {maximum} canciones")
    song_ids = [_song_id(item) for item in value]
    if len(set(song_ids)) != len(song_ids):
        raise RequestError("song_ids tiene canciones repetidas")
    return song_ids


def _year(value: object) -> int | None:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int) or not YEAR_MIN <= value <= YEAR_MAX:
        raise RequestError(f"year debe ser un entero entre {YEAR_MIN} y {YEAR_MAX}, o null")
    return value


def _tags(value: object) -> list[str]:
    if not isinstance(value, list):
        raise RequestError("tags debe ser una lista de cadenas")
    if len(value) > MAX_TAGS:
        raise RequestError(f"tags admite como máximo {MAX_TAGS} etiquetas")
    for item in value:
        if not isinstance(item, str):
            raise RequestError("cada etiqueta de tags debe ser una cadena")
        if _has_control(item):
            raise RequestError("una etiqueta contiene caracteres de control")
        if len(item.strip().lower()) > MAX_TAG_CHARS:
            raise RequestError(f"cada etiqueta admite como máximo {MAX_TAG_CHARS} caracteres")
    return catalog.normalize_tags(value)


def _strict_bool(value: object, field: str) -> bool:
    if not isinstance(value, bool):
        raise RequestError(f"{field} debe ser true o false (booleano JSON, no texto)")
    return value


# --- Utilidades --------------------------------------------------------------------------------


def _optional(fields: dict[str, str], key: str, limit: int) -> str | None:
    value = fields.get(key, "")
    if not value:
        return None
    _check_length(value, limit, key)
    return value


def _check_length(value: str, limit: int, name: str) -> None:
    if len(value) > limit:
        raise RequestError(f"{name} supera los {limit} caracteres")


def _checked(function, *args):
    """Ejecuta una validación de sonidos.sources y convierte su error en RequestError."""
    try:
        return function(*args)
    except SourceError as error:
        raise RequestError(str(error)) from error


def _compact_json(payload: Mapping) -> str:
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def _has_control(text: str) -> bool:
    """Caracteres de control, separadores de línea, surrogates y caracteres de formato (bidi, ancho cero):
    nunca van en una petición, porque suavizan o esconden lo que se lee."""
    return any(unicodedata.category(char) in ("Cc", "Zl", "Zp", "Cs", "Cf") for char in text)


def _url_sin_datos(url: str | None) -> str | None:
    """La URL sin query, fragmento ni credenciales. Las firmas temporales no deben salir en el registro."""
    if not url:
        return url
    parts = urlsplit(url)
    return urlunsplit((parts.scheme, parts.netloc.rsplit("@", 1)[-1], parts.path, "", ""))


def _shown(text: str, limit: int = 40) -> str:
    return text if len(text) <= limit else text[:limit] + "..."
