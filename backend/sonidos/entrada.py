"""Subidas de la web y la APK guardadas en el bucket privado de R2 (ADR-0017, revisada por ADR-0024).

La función de Vercel /api/subir (frontend/web/api/subir.js) guarda cada trozo de un Ogg Opus en
`entrada/<UUID>/<índice>.part` del bucket privado y, con el último, `entrada/<UUID>/manifiesto.json`; después lanza el
workflow buzon (repository_dispatch). Nada de eso pasa por Git.

- recoger (job 'recoger' de buzon.yml, con credenciales de R2 y sin token de GitHub): descarga las subidas completas
  (las que tienen manifiesto) a una carpeta que viaja como artefacto a 'procesar', que no tiene secretos. Solo lee.
- limpiar (job 'publicar', después de subir a main): borra `entrada/<UUID>/` de las subidas que se recogieron.

Este módulo solo usa la biblioteca estándar y sonidos.r2: los pasos con credenciales no instalan nada. El contenido de
los trozos y del manifiesto no se interpreta aquí: lo valida sonidos.buzon al unirlos, en 'procesar'.
"""

from __future__ import annotations

import re
from collections.abc import Iterable, Mapping
from pathlib import Path

from sonidos.r2 import Bucket, R2Error

ENTRY_PREFIX = "entrada/"
MANIFEST = "manifiesto.json"
# Los mismos formatos que sonidos.buzon (_UPLOAD_ID, _PART_NAME y MAX_MANIFEST_BYTES; lo comprueban las pruebas).
UPLOAD_ID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
PART_NAME = re.compile(r"(?:0|[1-9][0-9]{0,2})\.part")
MAX_PART_BYTES = 4 * 1024 * 1024  # lo que admite /api/subir por trozo
MAX_MANIFEST_BYTES = 4096
MAX_UPLOAD_BYTES = 100 * 1024 * 1024  # sonidos.buzon.MAX_FILE_BYTES: el buzón rechaza un archivo unido mayor
MAX_UPLOADS_PER_RUN = 50
MAX_BYTES_PER_RUN = 2 * 1024 * 1024 * 1024


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


def collect(bucket: Bucket, destination: Path, *, max_uploads: int = MAX_UPLOADS_PER_RUN,
            max_bytes: int = MAX_BYTES_PER_RUN) -> dict:
    """Descarga a destination/<UUID>/ las subidas completas del bucket privado, como mucho max_uploads y max_bytes por
    ejecución (las demás las recoge la siguiente: cada subida lanza su ejecución). Devuelve los UUID recogidos y los
    que no se pueden recoger. Comprueba que cada fichero descargado tiene el tamaño del listado."""
    complete, broken = complete_uploads(bucket.list_sizes(ENTRY_PREFIX))
    destination.mkdir(parents=True, exist_ok=True)
    collected: list[str] = []
    total = 0
    for upload_id, files in complete.items():
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
