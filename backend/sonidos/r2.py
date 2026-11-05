"""Sincronización del audio público con un bucket de Cloudflare R2 (ADR-0020).

Es solo la preparación: Vercel sigue sirviendo el audio y nada de la web ni de la APK lee de R2 todavía. Aquí se
calcula qué hay que subir (el audio es inmutable: el id es el SHA-256 del contenido, así que basta comparar nombre y
tamaño) y se sube con la API S3 de R2. Por defecto no borra nada del bucket.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol

AUDIO_PREFIX = "audio/"
AUDIO_SUFFIX = ".opus"
CONTENT_TYPE = "audio/ogg; codecs=opus"
CACHE_CONTROL = "public, max-age=31536000, immutable"


class R2Error(Exception):
    pass


@dataclass
class Plan:
    upload: list[str] = field(default_factory=list)
    unchanged: list[str] = field(default_factory=list)
    extra: list[str] = field(default_factory=list)  # en el bucket y ya no en la biblioteca pública


class Bucket(Protocol):
    def list_sizes(self) -> Mapping[str, int]: ...
    def put(self, key: str, path: Path) -> None: ...
    def delete(self, key: str) -> None: ...


def local_audio(directory: Path) -> dict[str, Path]:
    """Claves del bucket (`audio/<id>.opus`) de los ficheros públicos de la web. Ignora enlaces y otros ficheros."""
    found: dict[str, Path] = {}
    if directory.is_symlink() or not directory.is_dir():
        return found
    for item in sorted(directory.iterdir()):
        if item.is_symlink() or not item.is_file() or not item.name.endswith(AUDIO_SUFFIX):
            continue
        found[AUDIO_PREFIX + item.name] = item
    return found


def plan_sync(local: Mapping[str, Path], remote: Mapping[str, int]) -> Plan:
    plan = Plan()
    for key, path in local.items():
        if remote.get(key) == path.stat().st_size:
            plan.unchanged.append(key)
        else:
            plan.upload.append(key)
    plan.extra = sorted(key for key in remote if key not in local and key.startswith(AUDIO_PREFIX))
    return plan


def apply_plan(bucket: Bucket, local: Mapping[str, Path], plan: Plan, *, delete_extra: bool = False) -> dict[str, int]:
    for key in plan.upload:
        bucket.put(key, local[key])
    deleted = 0
    if delete_extra:
        for key in plan.extra:
            bucket.delete(key)
            deleted += 1
    return {"subidos": len(plan.upload), "sin_cambios": len(plan.unchanged), "borrados": deleted}


class S3Bucket:
    """Bucket R2 por su API compatible con S3. `boto3` se importa aquí para que el resto no dependa de él."""

    def __init__(self, *, account_id: str, access_key_id: str, secret_access_key: str, bucket: str, client: Any = None):
        if client is None:
            try:
                import boto3  # type: ignore[import-not-found]
            except ImportError as error:
                raise R2Error("falta boto3: pip install boto3") from error
            client = boto3.client(
                "s3",
                endpoint_url=f"https://{account_id}.r2.cloudflarestorage.com",
                aws_access_key_id=access_key_id,
                aws_secret_access_key=secret_access_key,
                region_name="auto",
            )
        self._client = client
        self._bucket = bucket

    def list_sizes(self) -> dict[str, int]:
        sizes: dict[str, int] = {}
        token = None
        while True:
            args: dict[str, Any] = {"Bucket": self._bucket, "Prefix": AUDIO_PREFIX}
            if token:
                args["ContinuationToken"] = token
            page = self._client.list_objects_v2(**args)
            for item in page.get("Contents", []):
                sizes[item["Key"]] = item["Size"]
            if not page.get("IsTruncated"):
                return sizes
            token = page.get("NextContinuationToken")

    def put(self, key: str, path: Path) -> None:
        with path.open("rb") as handle:
            self._client.put_object(
                Bucket=self._bucket, Key=key, Body=handle, ContentType=CONTENT_TYPE, CacheControl=CACHE_CONTROL
            )

    def delete(self, key: str) -> None:
        self._client.delete_object(Bucket=self._bucket, Key=key)
