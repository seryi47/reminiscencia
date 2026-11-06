"""Audio de la biblioteca en dos buckets de Cloudflare R2 (ADR-0020 y ADR-0024).

- Bucket privado (R2_PRIVATE_BUCKET): la fuente de verdad de todo el audio, público y privado, en `audio/<id>.opus`.
  También guarda, en `entrada/<UUID>/`, los trozos de las subidas de la web y la APK (sonidos.entrada).
- Bucket público (R2_BUCKET): solo el audio de las canciones públicas (las de frontend/web/data/songs.json). Es el único
  sitio desde el que se sirve el audio (ADR-0020, fase 3): la web lo pide a R2 (el service worker, y Vercel redirige
  /audio/<id>.opus al bucket) y la APK también.

El job 'publicar' (plan_publication y apply_publication) sube al privado el audio nuevo que trae el paquete (el que está
en audio-library/audio/ de la copia de trabajo), copia al público lo que le falte de las canciones públicas (desde la
copia local o, si no está, desde el privado) y borra del público el de las despublicadas. El audio es inmutable (el id
sale del SHA-256 del original), así que basta comparar nombre y tamaño. Cliente S3 propio (SigV4Client), solo con la
biblioteca estándar: ningún paso con credenciales instala paquetes.
"""

from __future__ import annotations

import hashlib
import hmac
import io
import json
import re
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Iterable, Mapping
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


@dataclass
class PublicationPlan:
    """Lo que hace 'publicar' con los dos buckets (ADR-0024)."""

    to_private: list[str] = field(default_factory=list)  # audio local que falta en el privado (o con otro tamaño)
    public_from_local: list[str] = field(default_factory=list)  # al público desde la copia local
    public_from_private: list[str] = field(default_factory=list)  # al público desde el privado (GET y PUT)
    public_unchanged: list[str] = field(default_factory=list)
    public_extra: list[str] = field(default_factory=list)  # en el público y ya no públicas
    missing: list[str] = field(default_factory=list)  # públicas sin audio en ningún sitio: se detiene la publicación
    not_in_private: list[str] = field(default_factory=list)  # del catálogo y sin audio en el privado: solo aviso
    public_total: int = 0
    expected_sizes: dict[str, int] = field(default_factory=dict)


class Bucket(Protocol):
    def list_sizes(self, prefix: str = AUDIO_PREFIX) -> Mapping[str, int]: ...
    def list_details(self, prefix: str = AUDIO_PREFIX) -> Mapping[str, tuple[int, str]]: ...
    def put(self, key: str, path: Path) -> None: ...
    def put_bytes(self, key: str, data: bytes) -> None: ...
    def get(self, key: str) -> bytes: ...
    def delete(self, key: str) -> None: ...


def local_audio(directory: Path) -> dict[str, Path]:
    """Claves del bucket (`audio/<id>.opus`) del audio de la copia local (audio-library/audio/). Solo ficheros regulares
    con nombre de canción de la biblioteca (S + 16 hexadecimales): ignora enlaces y cualquier otro fichero. Con el audio
    en Git (antes de ADR-0024, parte 2) es toda la biblioteca; sin él, solo el que acaba de traer el paquete."""
    found: dict[str, Path] = {}
    if directory.is_symlink() or not directory.is_dir():
        return found
    for item in sorted(directory.iterdir()):
        if item.is_symlink() or not item.is_file() or not item.name.endswith(AUDIO_SUFFIX):
            continue
        if not SONG_ID.fullmatch(item.name[:-len(AUDIO_SUFFIX)]):
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


def public_keys(songs_json: Path) -> list[str]:
    """Claves (`audio/<id>.opus`) de las canciones públicas de data/songs.json, sin mirar si hay audio local. Falla si
    songs.json no es válido o si una canción no tiene el formato de la biblioteca: así nunca se toma una lista rota por
    una biblioteca vacía."""
    try:
        songs = json.loads(songs_json.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise R2Error(f"no se pudo leer {songs_json.name}: {error}") from error
    if not isinstance(songs, list):
        raise R2Error(f"{songs_json.name} no es una lista de canciones")
    keys: list[str] = []
    for song in songs:
        song_id = song.get("id") if isinstance(song, dict) else None
        if not isinstance(song_id, str) or not SONG_ID.fullmatch(song_id):
            raise R2Error(f"canción con un id no válido en {songs_json.name}: {song_id!r}")
        key = f"{AUDIO_PREFIX}{song_id}{AUDIO_SUFFIX}"
        if song.get("audio") != key:
            raise R2Error(f"ruta de audio inesperada en {song_id}: {song.get('audio')!r}")
        keys.append(key)
    return keys


def catalog_keys(catalog_json: Path) -> list[str]:
    """Claves de todas las canciones del catálogo de la biblioteca (públicas y privadas). Solo para avisar del audio que
    falta en el bucket privado: no falla por un id que no sea de la biblioteca (eso lo para la regeneración)."""
    try:
        data = json.loads(catalog_json.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise R2Error(f"no se pudo leer {catalog_json.name}: {error}") from error
    songs = data.get("songs") if isinstance(data, dict) else None
    if not isinstance(songs, list):
        raise R2Error(f"{catalog_json.name} no tiene la lista de canciones")
    return sorted({
        f"{AUDIO_PREFIX}{song['id']}{AUDIO_SUFFIX}" for song in songs
        if isinstance(song, dict) and isinstance(song.get("id"), str) and SONG_ID.fullmatch(song["id"])
    })


def plan_publication(*, local: Mapping[str, Path], private: Mapping[str, int], public_keys: list[str],
                     public: Mapping[str, int], catalog: Iterable[str] = ()) -> PublicationPlan:
    """Qué hace 'publicar' (ADR-0024): el audio local que falta en el privado se sube allí; cada canción pública que
    falta en el público (o tiene otro tamaño) se copia desde la copia local o, si no está, desde el privado; lo que
    sobra en el público son canciones despublicadas. Una canción pública sin audio en la copia local ni en ningún
    bucket es un error ('missing'): la publicación se detiene antes de subir a main."""
    plan = PublicationPlan(public_total=len(public_keys))
    sizes = dict(private)
    for key, path in sorted(local.items()):
        size = path.stat().st_size
        if private.get(key) != size:
            plan.to_private.append(key)
        sizes[key] = size
    plan.expected_sizes = sizes
    wanted = set(public_keys)
    for key in sorted(wanted):
        expected = sizes.get(key)
        if expected is None:
            (plan.public_unchanged if key in public else plan.missing).append(key)
        elif public.get(key) == expected:
            plan.public_unchanged.append(key)
        elif key in local:
            plan.public_from_local.append(key)
        else:
            plan.public_from_private.append(key)
    plan.public_extra = sorted(key for key in public if key not in wanted and key.startswith(AUDIO_PREFIX))
    plan.not_in_private = sorted(key for key in set(catalog) | wanted if key not in sizes)
    return plan


def apply_publication(private: Bucket, public: Bucket, local: Mapping[str, Path], plan: PublicationPlan, *,
                      delete_extra: bool = False) -> dict[str, int]:
    """Aplica el plan: primero el privado (la fuente de verdad tiene el audio antes de que main lo anuncie), después el
    público y, con delete_extra, los borrados. Comprueba todo antes de escribir nada: una canción pública sin audio
    detiene la publicación, y nunca se vacía el bucket público."""
    if plan.missing:
        ids = ", ".join(key[len(AUDIO_PREFIX):-len(AUDIO_SUFFIX)] for key in plan.missing[:10])
        raise R2Error(f"falta el audio de {len(plan.missing)} canción(es) pública(s) en la copia local y en los dos "
                      f"buckets: {ids}")
    if delete_extra and plan.public_extra and not plan.public_total:
        raise R2Error("no hay canciones públicas: no se vacía el bucket")
    for key in plan.to_private:
        private.put(key, local[key])
    for key in plan.public_from_local:
        public.put(key, local[key])
    for key in plan.public_from_private:
        data = private.get(key)
        if len(data) != plan.expected_sizes.get(key):
            raise R2Error(f"el bucket privado devolvió {key} con un tamaño distinto del listado")
        public.put_bytes(key, data)
    deleted = 0
    if delete_extra:
        for key in plan.public_extra:
            public.delete(key)
            deleted += 1
    return {
        "al_privado": len(plan.to_private), "al_publico_desde_local": len(plan.public_from_local),
        "al_publico_desde_privado": len(plan.public_from_private), "sin_cambios": len(plan.public_unchanged),
        "borrados": deleted,
    }


class SigV4Client:
    """Cliente mínimo de la API S3 de R2 (ListObjectsV2, GetObject, PutObject y DeleteObject) con firma AWS Signature
    V4, solo con la biblioteca estándar. Lo usa el job 'publicar', que tiene permiso de escritura y por eso no instala
    paquetes (pip): así no depende de boto3. Tiene la misma interfaz que el cliente de boto3 para esas operaciones.
    La copia entre buckets se hace con GetObject y PutObject: la documentación de R2 admite CopyObject
    (x-amz-copy-source), pero no dice que el origen pueda estar en otro bucket (consultado el 2026-11-05)."""

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
            {"Key": item.findtext("s3:Key", "", ns), "Size": int(item.findtext("s3:Size", "0", ns)),
             "LastModified": item.findtext("s3:LastModified", "", ns)}
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

    def get_object(self, *, Bucket: str, Key: str) -> dict:  # noqa: N803
        return {"Body": io.BytesIO(self._request("GET", Bucket, Key))}

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

    @property
    def name(self) -> str:
        return self._bucket

    def list_sizes(self, prefix: str = AUDIO_PREFIX) -> dict[str, int]:
        return {key: size for key, (size, _) in self.list_details(prefix).items()}

    def list_details(self, prefix: str = AUDIO_PREFIX) -> dict[str, tuple[int, str]]:
        """Clave -> (tamaño, fecha de la última modificación tal como la da R2, «» si no la da). La fecha solo sirve
        para ordenar (sonidos.entrada: las subidas, por el momento en que se completaron)."""
        details: dict[str, tuple[int, str]] = {}
        token = None
        while True:
            args: dict[str, Any] = {"Bucket": self._bucket, "Prefix": prefix}
            if token:
                args["ContinuationToken"] = token
            page = self._client.list_objects_v2(**args)
            for item in page.get("Contents", []):
                modified = item.get("LastModified", "")
                details[item["Key"]] = (item["Size"], modified if isinstance(modified, str) else str(modified))
            if not page.get("IsTruncated"):
                return details
            token = page.get("NextContinuationToken")

    def put(self, key: str, path: Path) -> None:
        with path.open("rb") as handle:
            self._client.put_object(
                Bucket=self._bucket, Key=key, Body=handle, ContentType=CONTENT_TYPE, CacheControl=CACHE_CONTROL
            )

    def put_bytes(self, key: str, data: bytes) -> None:
        self._client.put_object(
            Bucket=self._bucket, Key=key, Body=data, ContentType=CONTENT_TYPE, CacheControl=CACHE_CONTROL
        )

    def get(self, key: str) -> bytes:
        return self._client.get_object(Bucket=self._bucket, Key=key)["Body"].read()

    def delete(self, key: str) -> None:
        self._client.delete_object(Bucket=self._bucket, Key=key)


CREDENTIALS = ("R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY")


def missing_variables(env: Mapping[str, str], *buckets: str) -> list[str]:
    """Variables de entorno que faltan para usar R2 con los buckets nombrados por 'buckets' (R2_BUCKET,
    R2_PRIVATE_BUCKET)."""
    return [name for name in (*CREDENTIALS, *buckets) if not env.get(name)]


def bucket_from_env(env: Mapping[str, str], variable: str, *, client: Any = None) -> S3Bucket:
    """El bucket cuyo nombre está en la variable 'variable', con las credenciales de R2_ACCOUNT_ID, R2_ACCESS_KEY_ID y
    R2_SECRET_ACCESS_KEY (el mismo token de R2 sirve para los dos buckets)."""
    return S3Bucket(
        account_id=env["R2_ACCOUNT_ID"], access_key_id=env["R2_ACCESS_KEY_ID"],
        secret_access_key=env["R2_SECRET_ACCESS_KEY"], bucket=env[variable], client=client,
    )
