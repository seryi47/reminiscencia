"""Subidas de la web y la APK guardadas en el bucket privado de R2 (ADR-0017, revisada por ADR-0024).

La función de Vercel /api/subir (frontend/web/api/subir.js) guarda cada trozo de un Ogg Opus en
`entrada/<UUID>/<índice>.part` del bucket privado y, con el último, `entrada/<UUID>/manifiesto.json`; después lanza el
workflow buzon (repository_dispatch). Nada de eso pasa por Git.

- recoger (job 'recoger' de buzon.yml, con credenciales de R2 y sin token de GitHub): descarga TODAS las subidas
  completas (las que tienen manifiesto), no solo la del aviso que lanzó la ejecución, hasta un tope por ejecución, a una
  carpeta que viaja como artefacto a 'procesar', que no tiene secretos. Las toma por orden de llegada (la fecha del
  manifiesto, que se escribe con el último trozo), así el tope deja para la ejecución siguiente las más nuevas. Deja en
  `orden.json` el orden en que el buzón las cataloga: el de la cola de quien las subió. La web y la APK envían hasta
  dos archivos a la vez, así que pueden completarse desordenados; por eso numeran cada subida con un UUID versión 7
  (RFC 9562), que empieza por el instante en que empezaron a prepararla, en el orden de su cola. Una subida con otro
  UUID (un cliente anterior) cuenta con la fecha de su manifiesto. Así las pistas de un álbum reciben su número en el
  orden en que se eligieron (ADR-0030). Solo lee.
- limpiar (job 'publicar', después de subir a main): borra `entrada/<UUID>/` de las subidas que se recogieron (y, por
  tanto, se publicaron o se rechazaron en esa ejecución); nunca las que llegaron después.

Este módulo solo usa la biblioteca estándar y sonidos.r2: los pasos con credenciales no instalan nada. El contenido de
los trozos y del manifiesto no se interpreta aquí: lo valida sonidos.buzon al unirlos, en 'procesar'.
"""

from __future__ import annotations

import json
import re
from collections.abc import Iterable, Mapping
from datetime import datetime, timezone
from pathlib import Path

from sonidos.r2 import Bucket, R2Error

ENTRY_PREFIX = "entrada/"
MANIFEST = "manifiesto.json"
# Los mismos formatos que sonidos.buzon (_UPLOAD_ID, _PART_NAME y MAX_MANIFEST_BYTES; lo comprueban las pruebas).
UPLOAD_ID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
PART_NAME = re.compile(r"(?:0|[1-9][0-9]{0,2})\.part")
# El mayor trozo que admite /api/subir: 4 MiB en Vercel y 32 MiB en el Worker de Cloudflare (ADR-0029;
# WORKER_CHUNK_BYTES de frontend/web/js/api-config.js, lo comprueban las pruebas).
MAX_PART_BYTES = 32 * 1024 * 1024
MAX_MANIFEST_BYTES = 4096
MAX_UPLOAD_BYTES = 100 * 1024 * 1024  # sonidos.buzon.MAX_FILE_BYTES: el buzón rechaza un archivo unido mayor
MAX_UPLOADS_PER_RUN = 50
MAX_BYTES_PER_RUN = 2 * 1024 * 1024 * 1024
# El orden de catalogar lo recogido (sonidos.buzon.ENTRY_ORDER_FILE): {"subidas": ["<UUID>", ...]}.
ORDER_FILE = "orden.json"


def complete_uploads(listing: Mapping[str, int]) -> tuple[dict[str, dict[str, int]], list[str]]:
    """Agrupa el listado de `entrada/` por subida. Devuelve las subidas completas (con manifiesto), cada una con sus
    ficheros y tamaños, y las subidas que no se pueden recoger (un nombre o un tamaño fuera de lo que escribe
    /api/subir). Las subidas sin manifiesto están en curso y no aparecen en ninguna de las dos."""
    groups: dict[str, dict[str, int]] = {}
    broken: set[str] = set()
    for key, size in listing.items():
        if not key.startswith(ENTRY_PREFIX):
            continue
        upload_id, separator, name = key[len(ENTRY_PREFIX):].partition("/")
        if not separator or not UPLOAD_ID.fullmatch(upload_id):
            broken.add(upload_id or key)
            continue
        groups.setdefault(upload_id, {})[name] = size
        valid = (name == MANIFEST and 0 < size <= MAX_MANIFEST_BYTES) or (
            PART_NAME.fullmatch(name) is not None and 0 < size <= MAX_PART_BYTES
        )
        if not valid:
            broken.add(upload_id)
    for upload_id, files in groups.items():
        if sum(files.values()) > MAX_UPLOAD_BYTES:
            broken.add(upload_id)  # el buzón la rechazaría igual: no se descarga
    complete = {
        upload_id: files for upload_id, files in sorted(groups.items())
        if MANIFEST in files and upload_id not in broken
    }
    return complete, sorted(item for item in broken if item in groups and MANIFEST in groups[item])


def arrival_order(complete: Iterable[str], modified: Mapping[str, str]) -> list[str]:
    """Los UUID de las subidas completas por orden de llegada: la fecha de su manifiesto (R2 la da en ISO 8601, en UTC)
    y, a igualdad o sin fecha (primero), el UUID. Así la ejecución toma primero las más antiguas, y lo que no cabe en el
    tope es lo más nuevo. La fecha la pone R2: quien sube no la elige."""
    return sorted(complete, key=lambda upload_id: (_manifest_ms(upload_id, modified), upload_id))


def queue_order(ids: Iterable[str], modified: Mapping[str, str]) -> list[str]:
    """El orden en que el buzón cataloga las subidas recogidas: el de la cola de quien las subió. Un UUID versión 7
    lleva delante los milisegundos en que el cliente empezó a preparar la subida (y un contador, si coinciden); otro
    UUID cuenta con la fecha de su manifiesto. A igualdad, el UUID (en un v7, el contador). Solo ordena lo ya recogido:
    no cambia qué entra en una ejecución."""
    def key(upload_id: str) -> tuple[int, str]:
        client = uuid7_ms(upload_id)
        return (client if client is not None else _manifest_ms(upload_id, modified), upload_id)

    return sorted(ids, key=key)


def uuid7_ms(upload_id: str) -> int | None:
    """Los milisegundos Unix de un UUID versión 7 (RFC 9562: 48 bits de tiempo, versión 7, variante 10), o None."""
    if not UPLOAD_ID.fullmatch(upload_id) or upload_id[14] != "7" or upload_id[19] not in "89ab":
        return None
    return int(upload_id[:8] + upload_id[9:13], 16)


def _manifest_ms(upload_id: str, modified: Mapping[str, str]) -> int:
    """Los milisegundos Unix (UTC) de la fecha del manifiesto, o -1 si no hay o no se entiende."""
    value = modified.get(f"{ENTRY_PREFIX}{upload_id}/{MANIFEST}", "")
    try:
        moment = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except (AttributeError, ValueError):
        return -1
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return int(moment.timestamp() * 1000)


def collect(bucket: Bucket, destination: Path, *, max_uploads: int = MAX_UPLOADS_PER_RUN,
            max_bytes: int = MAX_BYTES_PER_RUN) -> dict:
    """Descarga a destination/<UUID>/ todas las subidas completas del bucket privado, por orden de llegada, como mucho
    max_uploads y max_bytes por ejecución (las demás las recoge la siguiente ejecución de la cola). Escribe en
    destination/orden.json el orden de catalogarlas (queue_order). Devuelve los UUID recogidos, por orden de llegada, y
    los que no se pueden recoger. Comprueba que cada fichero descargado tiene el tamaño del listado."""
    details = bucket.list_details(ENTRY_PREFIX)
    complete, broken = complete_uploads({key: size for key, (size, _) in details.items()})
    modified = {key: when for key, (_, when) in details.items()}
    destination.mkdir(parents=True, exist_ok=True)
    collected: list[str] = []
    total = 0
    for upload_id in arrival_order(complete, modified):
        files = complete[upload_id]
        size = sum(files.values())
        if len(collected) >= max_uploads or (collected and total + size > max_bytes):
            break
        folder = destination / upload_id
        folder.mkdir()
        for name, expected in sorted(files.items()):
            data = bucket.get(f"{ENTRY_PREFIX}{upload_id}/{name}")
            if len(data) != expected:
                raise R2Error(f"el bucket privado devolvió {upload_id}/{name} con un tamaño distinto del listado")
            (folder / name).write_bytes(data)
        collected.append(upload_id)
        total += size
    if collected:
        order = queue_order(collected, modified)
        (destination / ORDER_FILE).write_text(json.dumps({"subidas": order}) + "\n", encoding="utf-8")
    return {"recogidas": collected, "no_validas": broken, "pendientes": len(complete) - len(collected), "bytes": total}


def valid_ids(raw: str) -> list[str]:
    """Los UUID de una lista separada por espacios (la salida 'ids' del job 'recoger'). Cualquier otra cosa es un error:
    nunca se borra fuera de entrada/<UUID>/."""
    ids = raw.split()
    for upload_id in ids:
        if not UPLOAD_ID.fullmatch(upload_id):
            raise R2Error("la lista de subidas que borrar no es una lista de UUID")
    return ids


def cleanup(bucket: Bucket, ids: Iterable[str]) -> int:
    """Borra del bucket privado todo lo que haya bajo entrada/<UUID>/ de cada subida. Devuelve cuántos objetos borró."""
    deleted = 0
    for upload_id in ids:
        if not UPLOAD_ID.fullmatch(upload_id):
            raise R2Error("identificador de subida no válido")
        prefix = f"{ENTRY_PREFIX}{upload_id}/"
        for key in sorted(bucket.list_sizes(prefix)):
            if key.startswith(prefix):
                bucket.delete(key)
                deleted += 1
    return deleted
