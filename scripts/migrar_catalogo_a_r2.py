"""Migración one-shot del catálogo a R2 (ADR-0052).

Sube el contenido actual de `audio-library/indexes/catalog.json` como fuente de verdad del catálogo al bucket público
de R2 (el mismo que ya sirve el audio), junto con el primer evento del historial append-only y el snapshot del día:

    catalog/catalog.json          — JSON con `{version: 1, updated_at, folders, songs}`
    catalog/VERSION.txt           — "1" (sonda rápida; se lee sin parsear JSON)
    history/latest.jsonl          — 1 línea: el evento inicial `migration_initial`
    history/<YYYY>/<MM>/<ulid>.json — mismo evento en inmutable
    snapshots/<YYYY-MM-DD>.json   — foto del catálogo del día de la migración

Idempotente. Si ya existe `catalog/catalog.json` con `version >= 1`, aborta con código 2 y no toca nada; usa `--force`
para volver a subir (sólo tras un borrado deliberado; no es un reset del versioning, lo lleva el Worker a partir de
aquí).

Uso:
    python scripts/migrar_catalogo_a_r2.py                       # simulación sin credenciales (igual que sync_r2.py)
    python scripts/migrar_catalogo_a_r2.py --dry-run             # imprime qué subiría, sin subir
    python scripts/migrar_catalogo_a_r2.py --aplicar             # sube de verdad (necesita R2_* en el entorno)
    python scripts/migrar_catalogo_a_r2.py --aplicar --force     # sube aunque haya catálogo previo

Variables de entorno: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET. El cliente se puede inyectar
desde las pruebas (parámetro `client` de `main`). Solo biblioteca estándar.
"""

from __future__ import annotations

import argparse
import json
import os
import secrets
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))

from sonidos.r2 import R2Error, SigV4Client, missing_variables  # noqa: E402

CATALOG_PATH = ROOT / "audio-library" / "indexes" / "catalog.json"
BUCKET_VAR = "R2_BUCKET"
CATALOG_KEY = "catalog/catalog.json"
VERSION_KEY = "catalog/VERSION.txt"
LATEST_KEY = "history/latest.jsonl"
JSON_TYPE = "application/json; charset=utf-8"
TEXT_TYPE = "text/plain; charset=utf-8"
NDJSON_TYPE = "application/x-ndjson; charset=utf-8"
NO_STORE = "no-store"
LONG_CACHE = "public, max-age=3600"
INITIAL_VERSION = 1

CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"


def _encode_crockford(number: int, length: int) -> str:
    if number < 0:
        raise ValueError("number must be non-negative")
    encoded = ""
    for _ in range(length):
        encoded = CROCKFORD[number & 0x1F] + encoded
        number >>= 5
    return encoded


def ulid(*, now_ms: int | None = None, randomness: bytes | None = None) -> str:
    """ULID de 26 caracteres (Crockford base32): 10 de timestamp (ms) + 16 de aleatoriedad.
    Determinista en tests pasando now_ms y randomness."""
    timestamp = int(time.time() * 1000) if now_ms is None else int(now_ms)
    rand = secrets.token_bytes(10) if randomness is None else randomness[:10].ljust(10, b"\0")
    return _encode_crockford(timestamp, 10) + _encode_crockford(int.from_bytes(rand, "big"), 16)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%S+00:00")


def _event(prev_version: int, new_version: int, *, now: datetime, event_id: str,
           catalog_source: str, songs_count: int, folders_count: int) -> dict[str, Any]:
    # Esquema del Worker (worker/src/history.js::appendEvent): {id, at, kind, by, version_before, version_after, ...}.
    # El evento inicial de la migración es compatible con los consumidores del historial (API y UI).
    return {
        "id": event_id,
        "at": _iso(now),
        "kind": "migration_initial",
        "by": "migration",
        "version_before": prev_version,
        "version_after": new_version,
        "source": catalog_source,
        "songs_count": songs_count,
        "folders_count": folders_count,
    }


def _build_catalog_body(catalog: dict, *, version: int, updated_at: datetime) -> bytes:
    body = {"version": version, "updated_at": _iso(updated_at)}
    # Preserva el resto de las claves del catálogo original sin tocar su orden (folders, songs y cualquier otra).
    for key, value in catalog.items():
        if key in ("version", "updated_at"):
            continue
        body[key] = value
    return (json.dumps(body, ensure_ascii=False, sort_keys=False) + "\n").encode("utf-8")


def _existing_version(client: Any, bucket: str) -> int | None:
    """Devuelve la versión de `catalog/catalog.json` en R2 si existe; None si no existe.
    Un error de red o permisos sube como R2Error (el llamador decide)."""
    try:
        body = client.get_object(Bucket=bucket, Key=CATALOG_KEY)["Body"].read()
    except R2Error as error:
        if "HTTP 404" in str(error):
            return None
        raise
    try:
        payload = json.loads(body)
    except json.JSONDecodeError:
        return None
    version = payload.get("version")
    return int(version) if isinstance(version, int) else None


def _put(client: Any, bucket: str, key: str, body: bytes, *, content_type: str, cache_control: str) -> None:
    client.put_object(Bucket=bucket, Key=key, Body=body, ContentType=content_type, CacheControl=cache_control)


def _source_label(catalog_path: Path) -> str:
    try:
        return str(catalog_path.relative_to(ROOT))
    except ValueError:
        return catalog_path.name


def _plan(catalog_path: Path, *, now: datetime, event_id: str) -> dict[str, tuple[str, bytes, str, str]]:
    """Objetos a subir: clave -> (descripción humana, cuerpo, content-type, cache-control)."""
    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    body = _build_catalog_body(catalog, version=INITIAL_VERSION, updated_at=now)
    event = _event(prev_version=0, new_version=INITIAL_VERSION, now=now, event_id=event_id,
                   catalog_source=_source_label(catalog_path),
                   songs_count=len(catalog.get("songs", []) or []),
                   folders_count=len(catalog.get("folders", []) or []))
    event_bytes = (json.dumps(event, ensure_ascii=False, sort_keys=False) + "\n").encode("utf-8")
    event_key = f"history/{now:%Y}/{now:%m}/{event_id}.json"
    snapshot_key = f"snapshots/{now:%Y-%m-%d}.json"
    version_body = (str(INITIAL_VERSION) + "\n").encode("utf-8")
    return {
        CATALOG_KEY: ("catálogo (version=1)", body, JSON_TYPE, NO_STORE),
        VERSION_KEY: ("sonda de versión", version_body, TEXT_TYPE, NO_STORE),
        LATEST_KEY: ("historial rotativo (1 evento)", event_bytes, NDJSON_TYPE, NO_STORE),
        event_key: ("evento inmutable del historial", event_bytes, JSON_TYPE, LONG_CACHE),
        snapshot_key: ("snapshot del día", body, JSON_TYPE, LONG_CACHE),
    }


def main(argv: list[str] | None = None, *, env: dict[str, str] | None = None, client: Any = None,
         now: datetime | None = None, event_id: str | None = None) -> int:
    parser = argparse.ArgumentParser(description="Sube el catálogo actual a R2 (ADR-0052, one-shot).")
    parser.add_argument("--catalog", type=Path, default=CATALOG_PATH,
                        help="catálogo local (por defecto audio-library/indexes/catalog.json)")
    parser.add_argument("--aplicar", action="store_true", help="escribe de verdad (sin esto: simulación)")
    parser.add_argument("--dry-run", action="store_true", help="imprime el plan y no sube nada aunque haya --aplicar")
    parser.add_argument("--force", action="store_true", help="no abortar si ya existe un catálogo en R2")
    args = parser.parse_args(argv)
    env = os.environ if env is None else env

    if not args.catalog.is_file():
        print(f"No encuentro el catálogo local: {args.catalog}")
        return 1

    now = now or _utcnow()
    event_id = event_id or ulid(now_ms=int(now.timestamp() * 1000))

    try:
        plan = _plan(args.catalog, now=now, event_id=event_id)
    except (json.JSONDecodeError, OSError) as error:
        print(f"Catálogo local inválido ({type(error).__name__}): {error}")
        return 1

    aplicar = args.aplicar and not args.dry_run
    missing = missing_variables(env, BUCKET_VAR) if (aplicar or client is None) and client is None else []
    if client is None and aplicar:
        if missing:
            print(f"Faltan variables de entorno: {', '.join(missing)}")
            return 1
        client = SigV4Client(
            account_id=env["R2_ACCOUNT_ID"], access_key_id=env["R2_ACCESS_KEY_ID"],
            secret_access_key=env["R2_SECRET_ACCESS_KEY"],
        )
    bucket = env.get(BUCKET_VAR, "(sin configurar)")

    if client is not None:
        try:
            existing = _existing_version(client, bucket)
        except R2Error as error:
            print(f"R2 no responde: {error}")
            return 1
        if existing is not None and existing >= INITIAL_VERSION and not args.force:
            print(f"R2 ya tiene catálogo (version={existing}). Usa --force si realmente quieres reescribirlo.")
            return 2

    print(f"Catálogo local: {args.catalog}")
    print(f"Bucket: {bucket}")
    print(f"ULID del evento: {event_id}")
    for key, (desc, body, content_type, cache) in plan.items():
        print(f"  {key}  ({desc}, {len(body)} B, {content_type}, {cache})")

    if not aplicar:
        reason = "--dry-run" if args.dry_run else "falta --aplicar"
        print(f"Simulación: no se sube nada ({reason}).")
        return 0

    if client is None:  # defensa de belt-and-braces: no debería llegar aquí
        print("Falta cliente R2.")
        return 1

    for key, (_desc, body, content_type, cache) in plan.items():
        _put(client, bucket, key, body, content_type=content_type, cache_control=cache)
    print(f"Subidos {len(plan)} objetos a {bucket}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
