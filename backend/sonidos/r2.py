"""Sincronización del audio público con un bucket de Cloudflare R2 (ADR-0020).

R2 es el único sitio desde el que se sirve el audio público (fase 3): la web lo pide a R2 (el service worker, y Vercel
redirige /audio/<id>.opus al bucket) y la APK también. El audio de origen está en audio-library/audio/ y las canciones
públicas son las de frontend/web/data/songs.json: solo esas se suben, así que el audio privado nunca llega al bucket.
Aquí se calcula qué hay que subir (el audio es inmutable: el id es el SHA-256 del contenido, así que basta comparar
nombre y tamaño) y qué sobra (canciones despublicadas), y se aplica con la API S3 de R2.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import re
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Protocol
from xml.etree import ElementTree

AUDIO_PREFIX = "audio/"
AUDIO_SUFFIX = ".opus"
CONTENT_TYPE = "audio/ogg; codecs=opus"
CACHE_CONTROL = "public, max-age=31536000, immutable"
SONG_ID = re.compile(r"S[0-9a-f]{16}")


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


def public_audio(audio_dir: Path, songs_json: Path) -> dict[str, Path]:
    """Claves del bucket (`audio/<id>.opus`) de las canciones públicas (data/songs.json) y su fichero en la biblioteca.
    Falla si songs.json no es válido, si una canción no tiene el formato de la biblioteca o si falta su audio: así
    nunca se publica una canción sin audio ni se toma una lista rota por una biblioteca vacía."""
    try:
        songs = json.loads(songs_json.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise R2Error(f"no se pudo leer {songs_json.name}: {error}") from error
    if not isinstance(songs, list):
        raise R2Error(f"{songs_json.name} no es una lista de canciones")
    found: dict[str, Path] = {}
    for song in songs:
        song_id = song.get("id") if isinstance(song, dict) else None
        if not isinstance(song_id, str) or not SONG_ID.fullmatch(song_id):
            raise R2Error(f"canción con un id no válido en {songs_json.name}: {song_id!r}")
        name = f"{song_id}{AUDIO_SUFFIX}"
        if song.get("audio") != f"{AUDIO_PREFIX}{name}":
            raise R2Error(f"ruta de audio inesperada en {song_id}: {song.get('audio')!r}")
        source = audio_dir / name
        if source.is_symlink() or not source.is_file():
            raise R2Error(f"falta el audio de {song_id} en {audio_dir}")
        found[AUDIO_PREFIX + name] = source
    return found


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
    """Sube lo que falta y, con delete_extra, borra lo que ya no es público. Nunca vacía el bucket: si no queda ninguna
    canción pública y en el bucket sí hay, es más probable un error que una biblioteca vacía, y no se borra nada."""
    if delete_extra and plan.extra and not local:
        raise R2Error("no hay canciones públicas: no se vacía el bucket")
    for key in plan.upload:
        bucket.put(key, local[key])
    deleted = 0
    if delete_extra:
        for key in plan.extra:
            bucket.delete(key)
            deleted += 1
    return {"subidos": len(plan.upload), "sin_cambios": len(plan.unchanged), "borrados": deleted}


class SigV4Client:
    """Cliente mínimo de la API S3 de R2 (ListObjectsV2, PutObject y DeleteObject) con firma AWS Signature V4, solo con
    la biblioteca estándar. Lo usa el job 'publicar', que tiene permiso de escritura y por eso no instala paquetes
    (pip): así no depende de boto3. Tiene la misma interfaz que el cliente de boto3 para esas tres operaciones."""

    REGION = "auto"
    SERVICE = "s3"

    def __init__(self, *, account_id: str, access_key_id: str, secret_access_key: str, timeout: float = 60.0,
                 opener: Any = None):
        if not re.fullmatch(r"[0-9a-f]{32}", account_id or ""):
            raise R2Error("R2_ACCOUNT_ID no tiene el formato de Cloudflare (32 hexadecimales)")
        self._host = f"{account_id}.r2.cloudflarestorage.com"
        self._access_key_id = access_key_id
        self._secret_access_key = secret_access_key
        self._timeout = timeout
        self._open = opener or urllib.request.urlopen

    def list_objects_v2(self, *, Bucket: str, Prefix: str = "", ContinuationToken: str | None = None) -> dict:  # noqa: N803
        query = {"list-type": "2", "prefix": Prefix}
        if ContinuationToken:
            query["continuation-token"] = ContinuationToken
        body = self._request("GET", Bucket, "", query=query)
        try:
            root = ElementTree.fromstring(body)
        except ElementTree.ParseError as error:
            raise R2Error("respuesta de R2 no reconocida al listar el bucket") from error
        ns = {"s3": "http://s3.amazonaws.com/doc/2006-03-01/"}
        contents = [
            {"Key": item.findtext("s3:Key", "", ns), "Size": int(item.findtext("s3:Size", "0", ns))}
            for item in root.findall("s3:Contents", ns)
        ]
        page: dict[str, Any] = {"Contents": contents, "IsTruncated": root.findtext("s3:IsTruncated", "", ns) == "true"}
        token = root.findtext("s3:NextContinuationToken", None, ns)
        if token:
            page["NextContinuationToken"] = token
        return page

    def put_object(self, *, Bucket: str, Key: str, Body: Any, ContentType: str, CacheControl: str) -> None:  # noqa: N803
        data = Body.read() if hasattr(Body, "read") else bytes(Body)
        self._request("PUT", Bucket, Key, body=data, headers={"content-type": ContentType, "cache-control": CacheControl})

    def delete_object(self, *, Bucket: str, Key: str) -> None:  # noqa: N803
        self._request("DELETE", Bucket, Key)

    def _request(self, method: str, bucket: str, key: str, *, query: Mapping[str, str] | None = None,
                 body: bytes = b"", headers: Mapping[str, str] | None = None) -> bytes:
        path = "/" + urllib.parse.quote(bucket, safe="") + ("/" + urllib.parse.quote(key, safe="/") if key else "")
        query_string = canonical_query(query or {})
        signed = sign_v4(
            method=method, host=self._host, path=path, query=query_string, payload=body,
            access_key_id=self._access_key_id, secret_access_key=self._secret_access_key,
            region=self.REGION, service=self.SERVICE, when=datetime.now(timezone.utc),
        )
        url = f"https://{self._host}{path}" + (f"?{query_string}" if query_string else "")
        request = urllib.request.Request(url, data=body if method == "PUT" else None, method=method,
                                         headers={**(headers or {}), **signed})
        try:
            with self._open(request, timeout=self._timeout) as response:
                return response.read()
        except urllib.error.HTTPError as error:
            # Solo el código: el cuerpo del error puede llevar datos de la cuenta y el registro del workflow es público.
            raise R2Error(f"R2 respondió HTTP {error.code} a {method} {key or bucket}") from None
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            raise R2Error(f"no se pudo conectar con R2 ({type(error).__name__})") from None


def canonical_query(query: Mapping[str, str]) -> str:
    """Query canónica de SigV4: claves ordenadas y todo codificado según RFC 3986."""
    return "&".join(
        f"{urllib.parse.quote(name, safe='-_.~')}={urllib.parse.quote(value, safe='-_.~')}"
        for name, value in sorted(query.items())
    )


def sign_v4(*, method: str, host: str, path: str, query: str, payload: bytes, access_key_id: str,
            secret_access_key: str, region: str, service: str, when: datetime,
            extra_headers: Mapping[str, str] | None = None) -> dict[str, str]:
    """Cabeceras de la firma AWS Signature Version 4 (x-amz-date, x-amz-content-sha256 y Authorization). 'path' y
    'query' ya van codificados (canonical_query). 'extra_headers' son cabeceras que también se firman (en minúsculas)."""
    amz_date = when.strftime("%Y%m%dT%H%M%SZ")
    day = when.strftime("%Y%m%d")
    payload_hash = hashlib.sha256(payload).hexdigest()
    to_sign = {"host": host, "x-amz-content-sha256": payload_hash, "x-amz-date": amz_date, **(extra_headers or {})}
    names = sorted(to_sign)
    canonical_headers = "".join(f"{name}:{str(to_sign[name]).strip()}\n" for name in names)
    signed_headers = ";".join(names)
    canonical_request = "\n".join((method, path, query, canonical_headers, signed_headers, payload_hash))
    scope = f"{day}/{region}/{service}/aws4_request"
    string_to_sign = "\n".join(
        ("AWS4-HMAC-SHA256", amz_date, scope, hashlib.sha256(canonical_request.encode()).hexdigest())
    )
    key = ("AWS4" + secret_access_key).encode()
    for part in (day, region, service, "aws4_request"):
        key = hmac.new(key, part.encode(), hashlib.sha256).digest()
    signature = hmac.new(key, string_to_sign.encode(), hashlib.sha256).hexdigest()
    return {
        "x-amz-date": amz_date,
        "x-amz-content-sha256": payload_hash,
        "Authorization": (
            f"AWS4-HMAC-SHA256 Credential={access_key_id}/{scope}, SignedHeaders={signed_headers}, "
            f"Signature={signature}"
        ),
    }


class S3Bucket:
    """Bucket R2 por su API compatible con S3 (SigV4Client, sin dependencias; 'client' permite otro en las pruebas)."""

    def __init__(self, *, account_id: str, access_key_id: str, secret_access_key: str, bucket: str, client: Any = None):
        if client is None:
            client = SigV4Client(
                account_id=account_id, access_key_id=access_key_id, secret_access_key=secret_access_key,
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
