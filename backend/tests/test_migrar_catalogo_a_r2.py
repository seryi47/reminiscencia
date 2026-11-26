"""Migración one-shot del catálogo a R2 (ADR-0052). Verifica el script `scripts/migrar_catalogo_a_r2.py` con un bucket
en memoria: idempotencia, dry-run, snapshot del día y evento inicial del historial."""

from __future__ import annotations

import importlib.util
import io
import json
from datetime import datetime, timezone
from pathlib import Path

import pytest

from sonidos import r2

ROOT = Path(__file__).resolve().parents[2]
BUCKET = "publico"
ENV = {"R2_ACCOUNT_ID": "acc", "R2_ACCESS_KEY_ID": "AK", "R2_SECRET_ACCESS_KEY": "SK", "R2_BUCKET": BUCKET}
FIXED_NOW = datetime(2026, 11, 26, 9, 40, 12, tzinfo=timezone.utc)
FIXED_ULID = "01ABCDEFGHJKMNPQRSTVWXYZ00"


class FakeS3Json:
    """Un bucket en memoria con la interfaz del cliente SigV4 (list/put/get/delete) sin restringir tipo ni cache."""

    def __init__(self, objects: dict[str, tuple[bytes, str, str]] | None = None):
        # clave -> (body, content_type, cache_control)
        self.objects: dict[str, tuple[bytes, str, str]] = dict(objects or {})
        self.puts: list[tuple[str, str, str, int]] = []  # (key, content_type, cache_control, size)

    def list_objects_v2(self, *, Bucket, Prefix="", ContinuationToken=None):  # noqa: N803
        self._bucket(Bucket)
        items = [{"Key": key, "Size": len(body), "LastModified": ""}
                 for key, (body, _, _) in sorted(self.objects.items()) if key.startswith(Prefix)]
        return {"Contents": items, "IsTruncated": False}

    def put_object(self, *, Bucket, Key, Body, ContentType, CacheControl):  # noqa: N803
        self._bucket(Bucket)
        body = Body.read() if hasattr(Body, "read") else bytes(Body)
        self.objects[Key] = (body, ContentType, CacheControl)
        self.puts.append((Key, ContentType, CacheControl, len(body)))

    def get_object(self, *, Bucket, Key):  # noqa: N803
        self._bucket(Bucket)
        try:
            body, _, _ = self.objects[Key]
        except KeyError:
            # El SigV4Client real lanza R2Error con "HTTP 404" (ver _request en backend/sonidos/r2.py).
            raise r2.R2Error(f"R2 respondió HTTP 404 a GET {Key}")
        return {"Body": io.BytesIO(body)}

    def delete_object(self, *, Bucket, Key):  # noqa: N803
        self._bucket(Bucket)
        self.objects.pop(Key, None)

    def _bucket(self, name: str) -> None:
        assert name == BUCKET, f"bucket inesperado: {name}"


def _script():
    spec = importlib.util.spec_from_file_location("migrar_catalogo_a_r2_under_test",
                                                  ROOT / "scripts" / "migrar_catalogo_a_r2.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _catalog(tmp_path: Path, *, extra: dict | None = None) -> Path:
    """Catálogo local mínimo (una carpeta, una canción) para la migración."""
    catalog = {
        "folders": [{"id": "F1234567890abcdef", "name": "Jazz", "parent_id": None}],
        "songs": [{
            "id": "S1234567890abcdef", "title": "Ejemplo", "artist": "Autor",
            "folder_id": "F1234567890abcdef", "duration_s": 12.3, "codec": "opus",
            "size_bytes": 42, "public": True,
        }],
    }
    if extra:
        catalog.update(extra)
    path = tmp_path / "audio-library" / "indexes" / "catalog.json"
    path.parent.mkdir(parents=True)
    path.write_text(json.dumps(catalog, ensure_ascii=False), encoding="utf-8")
    return path


def _run(argv: list[str], *, s3: FakeS3Json | None, now: datetime = FIXED_NOW, event_id: str = FIXED_ULID) -> int:
    return _script().main(argv, env=ENV, client=s3, now=now, event_id=event_id)


def test_dry_run_no_escribe(tmp_path, capsys):
    catalog = _catalog(tmp_path)
    s3 = FakeS3Json()

    code = _run(["--aplicar", "--dry-run", "--catalog", str(catalog)], s3=s3)

    assert code == 0
    assert s3.puts == [], "dry-run no debe subir nada"
    out = capsys.readouterr().out
    assert "catalog/catalog.json" in out and "Simulación" in out


def test_primera_ejecucion_sube_catalogo_historial_y_snapshot(tmp_path):
    catalog = _catalog(tmp_path)
    s3 = FakeS3Json()

    code = _run(["--aplicar", "--catalog", str(catalog)], s3=s3)

    assert code == 0
    assert set(s3.objects) == {
        "catalog/catalog.json",
        "catalog/VERSION.txt",
        "history/latest.jsonl",
        f"history/2026/11/{FIXED_ULID}.json",
        "snapshots/2026-11-26.json",
    }

    # Catálogo sube con version=1 y conserva folders y songs intactos.
    body, content_type, cache = s3.objects["catalog/catalog.json"]
    payload = json.loads(body)
    assert payload["version"] == 1
    assert payload["updated_at"] == "2026-11-26T09:40:12+00:00"
    assert payload["folders"] == json.loads(catalog.read_text())["folders"]
    assert payload["songs"] == json.loads(catalog.read_text())["songs"]
    assert content_type == "application/json; charset=utf-8" and cache == "no-store"

    # Sonda de versión en texto plano.
    sonda, sonda_ct, sonda_cache = s3.objects["catalog/VERSION.txt"]
    assert sonda.strip() == b"1" and "text/plain" in sonda_ct and sonda_cache == "no-store"

    # Historial rotativo: 1 línea con el evento inicial.
    latest, latest_ct, latest_cache = s3.objects["history/latest.jsonl"]
    lineas = [json.loads(linea) for linea in latest.splitlines() if linea.strip()]
    assert len(lineas) == 1
    evento = lineas[0]
    # Esquema del Worker (worker/src/history.js): kind, by, at, version_before, version_after.
    assert evento["kind"] == "migration_initial"
    assert evento["by"] == "migration"
    assert evento["version_before"] == 0 and evento["version_after"] == 1
    assert evento["id"] == FIXED_ULID
    assert isinstance(evento["at"], str) and evento["at"].startswith("2026-11-26T")
    assert "songs_count" in evento and "folders_count" in evento
    # El esquema viejo NO debe aparecer: evita regresión silenciosa si alguien reintroduce las claves antiguas.
    for clave_vieja in ("ts", "actor", "action", "target", "changes", "prev_version", "new_version"):
        assert clave_vieja not in evento, f"clave vieja del esquema previo no debe estar: {clave_vieja}"
    assert "x-ndjson" in latest_ct and latest_cache == "no-store"

    # Evento inmutable: el mismo contenido en history/YYYY/MM/<ulid>.json con cache larga.
    inmutable, inmutable_ct, inmutable_cache = s3.objects[f"history/2026/11/{FIXED_ULID}.json"]
    assert json.loads(inmutable.splitlines()[0]) == evento
    assert "application/json" in inmutable_ct and inmutable_cache == "public, max-age=3600"

    # Snapshot del día: idéntico cuerpo al catálogo con cache larga (un día es inmutable).
    snapshot, snap_ct, snap_cache = s3.objects["snapshots/2026-11-26.json"]
    assert json.loads(snapshot) == payload
    assert "application/json" in snap_ct and snap_cache == "public, max-age=3600"


def test_segunda_ejecucion_sin_force_aborta(tmp_path, capsys):
    catalog = _catalog(tmp_path)
    s3 = FakeS3Json()

    # Primera ejecución: deja todo en R2.
    assert _run(["--aplicar", "--catalog", str(catalog)], s3=s3) == 0
    s3.puts.clear()
    capsys.readouterr()

    # Segunda sin --force: aborta con 2 y no toca nada.
    code = _run(["--aplicar", "--catalog", str(catalog)], s3=s3)
    assert code == 2
    assert s3.puts == []
    out = capsys.readouterr().out
    assert "ya tiene catálogo" in out and "--force" in out


def test_segunda_ejecucion_con_force_sobrescribe(tmp_path):
    catalog = _catalog(tmp_path)
    s3 = FakeS3Json()

    assert _run(["--aplicar", "--catalog", str(catalog)], s3=s3) == 0
    primera_version_body = s3.objects["catalog/catalog.json"][0]
    s3.puts.clear()

    # Cambiamos el catálogo local para que el segundo PUT sea observable.
    cambios = json.loads(catalog.read_text())
    cambios["songs"][0]["title"] = "Ejemplo (reescrito)"
    catalog.write_text(json.dumps(cambios, ensure_ascii=False), encoding="utf-8")

    code = _run(["--aplicar", "--force", "--catalog", str(catalog)], s3=s3,
                now=FIXED_NOW, event_id="01ABCDEFGHJKMNPQRSTVWXYZ99")
    assert code == 0
    nueva_body = s3.objects["catalog/catalog.json"][0]
    assert nueva_body != primera_version_body
    assert json.loads(nueva_body)["songs"][0]["title"] == "Ejemplo (reescrito)"
    # No se duplica el archivo inmutable: tiene otro ULID.
    assert "history/2026/11/01ABCDEFGHJKMNPQRSTVWXYZ99.json" in s3.objects
    # El rotativo se reescribe con el evento del force (una sola línea, no dos: es un one-shot).
    latest = s3.objects["history/latest.jsonl"][0]
    lineas = [linea for linea in latest.splitlines() if linea.strip()]
    assert len(lineas) == 1 and json.loads(lineas[0])["id"] == "01ABCDEFGHJKMNPQRSTVWXYZ99"


def test_catalogo_local_inexistente_devuelve_1(tmp_path, capsys):
    s3 = FakeS3Json()
    inexistente = tmp_path / "no" / "esta" / "catalog.json"

    code = _run(["--aplicar", "--catalog", str(inexistente)], s3=s3)

    assert code == 1
    assert "No encuentro el catálogo local" in capsys.readouterr().out
    assert s3.puts == []
