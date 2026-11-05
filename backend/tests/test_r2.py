import base64
import importlib.util
import io
import json
import urllib.error
from datetime import datetime, timezone
from pathlib import Path

import pytest

from sonidos import r2

ROOT = Path(__file__).resolve().parents[2]
ID_A = "S0123456789abcdef"
ID_B = "Sfedcba9876543210"
ID_C = "S00000000000000cc"
KEY_A, KEY_B, KEY_C = (f"audio/{song_id}.opus" for song_id in (ID_A, ID_B, ID_C))


def _write(directory: Path, name: str, size: int, fill: bytes = b"x") -> None:
    directory.mkdir(parents=True, exist_ok=True)
    (directory / name).write_bytes(fill * size)


def test_local_audio_only_lists_regular_opus_files_with_a_song_id(tmp_path):
    _write(tmp_path, f"{ID_A}.opus", 3)
    _write(tmp_path, "S1.opus", 3)  # no es un id de la biblioteca
    _write(tmp_path, "notas.txt", 3)
    (tmp_path / f"{ID_B}.opus").symlink_to(tmp_path / f"{ID_A}.opus")
    assert list(r2.local_audio(tmp_path)) == [KEY_A]


def test_plan_uploads_missing_and_resized_and_keeps_extras_separate(tmp_path):
    for song_id, size in ((ID_A, 3), (ID_B, 5), (ID_C, 7)):
        _write(tmp_path, f"{song_id}.opus", size)
    local = r2.local_audio(tmp_path)
    plan = r2.plan_sync(local, {KEY_A: 3, KEY_B: 4, "audio/Sold.opus": 9})
    assert plan.unchanged == [KEY_A]
    assert sorted(plan.upload) == sorted([KEY_B, KEY_C])
    assert plan.extra == ["audio/Sold.opus"]


class FakeBucket:
    """Un bucket en memoria con la interfaz de r2.Bucket."""

    def __init__(self, objects: dict[str, bytes] | None = None):
        self.objects = dict(objects or {})
        self.put_keys, self.deleted, self.got = [], [], []

    def list_sizes(self, prefix: str = r2.AUDIO_PREFIX):
        return {key: len(data) for key, data in self.objects.items() if key.startswith(prefix)}

    def put(self, key, path):
        self.put_keys.append(key)
        self.objects[key] = Path(path).read_bytes()

    def put_bytes(self, key, data):
        self.put_keys.append(key)
        self.objects[key] = bytes(data)

    def get(self, key):
        self.got.append(key)
        return self.objects[key]

    def delete(self, key):
        self.deleted.append(key)
        self.objects.pop(key, None)


def test_apply_never_deletes_unless_asked(tmp_path):
    _write(tmp_path, f"{ID_A}.opus", 3)
    local = r2.local_audio(tmp_path)
    plan = r2.plan_sync(local, {"audio/Sold.opus": 1})
    bucket = FakeBucket()
    assert r2.apply_plan(bucket, local, plan) == {"subidos": 1, "sin_cambios": 0, "borrados": 0}
    assert bucket.deleted == []
    assert r2.apply_plan(bucket, local, plan, delete_extra=True)["borrados"] == 1


def test_apply_never_empties_the_bucket():
    plan = r2.plan_sync({}, {KEY_A: 3})
    bucket = FakeBucket()
    with pytest.raises(r2.R2Error, match="no se vacía el bucket"):
        r2.apply_plan(bucket, {}, plan, delete_extra=True)
    assert bucket.deleted == []


# --- Publicación con los dos buckets (ADR-0024) ----------------------------------------------------------------------

def _song(song_id: str) -> dict:
    return {"id": song_id, "title": "t", "audio": f"audio/{song_id}.opus"}


def test_public_keys_come_from_songs_json_without_needing_local_audio(tmp_path):
    songs = tmp_path / "songs.json"
    songs.write_text(json.dumps([_song(ID_A), _song(ID_B)]), encoding="utf-8")
    assert r2.public_keys(songs) == [KEY_A, KEY_B]


@pytest.mark.parametrize("songs, message", [
    ([{"id": "../etc", "audio": "audio/../etc.opus"}], "id no válido"),
    ([{"id": ID_A, "audio": f"audio/{ID_B}.opus"}], "ruta de audio inesperada"),
    ({"songs": []}, "no es una lista"),
])
def test_public_keys_refuse_a_broken_list(tmp_path, songs, message):
    path = tmp_path / "songs.json"
    path.write_text(json.dumps(songs), encoding="utf-8")
    with pytest.raises(r2.R2Error, match=message):
        r2.public_keys(path)


def test_catalog_keys_list_every_song_public_or_private(tmp_path):
    path = tmp_path / "catalog.json"
    path.write_text(json.dumps({"songs": [{"id": ID_B, "public": False}, {"id": ID_A}, {"id": "raro"}]}), encoding="utf-8")
    assert r2.catalog_keys(path) == [KEY_A, KEY_B]


def test_publication_uploads_new_local_audio_to_the_private_bucket_and_fills_the_public_one(tmp_path):
    audio = tmp_path / "audio"
    _write(audio, f"{ID_A}.opus", 4, b"a")  # nueva y pública: llega en el paquete
    _write(audio, f"{ID_C}.opus", 2, b"c")  # nueva y privada
    local = r2.local_audio(audio)
    private = FakeBucket({KEY_B: b"bbbbb"})  # pública de antes que se despublicó y se vuelve a publicar
    public = FakeBucket({"audio/Sfffffffffffffff0.opus": b"zz"})  # despublicada

    plan = r2.plan_publication(local=local, private=private.list_sizes(), public_keys=[KEY_A, KEY_B],
                               public=public.list_sizes(), catalog=[KEY_A, KEY_B, KEY_C])
    assert (plan.to_private, plan.public_from_local, plan.public_from_private) == ([KEY_C, KEY_A], [KEY_A], [KEY_B])
    assert plan.public_extra == ["audio/Sfffffffffffffff0.opus"] and plan.missing == [] and plan.not_in_private == []

    result = r2.apply_publication(private, public, local, plan, delete_extra=True)

    assert result == {"al_privado": 2, "al_publico_desde_local": 1, "al_publico_desde_privado": 1, "sin_cambios": 0,
                      "borrados": 1}
    assert set(private.objects) == {KEY_A, KEY_B, KEY_C}
    assert public.objects == {KEY_A: b"aaaa", KEY_B: b"bbbbb"}  # nunca el audio privado
    assert private.deleted == []  # el privado nunca pierde nada


def test_publication_stops_before_writing_if_a_public_song_has_no_audio_anywhere(tmp_path):
    private, public = FakeBucket(), FakeBucket({"audio/Sfffffffffffffff0.opus": b"z"})
    plan = r2.plan_publication(local={}, private={}, public_keys=[KEY_A], public=public.list_sizes())
    assert plan.missing == [KEY_A]
    with pytest.raises(r2.R2Error, match=f"falta el audio de 1 .*{ID_A}"):
        r2.apply_publication(private, public, {}, plan, delete_extra=True)
    assert public.deleted == [] and public.put_keys == [] and private.put_keys == []


def test_publication_keeps_what_the_public_bucket_already_has_and_warns_if_the_private_one_lacks_it():
    public = FakeBucket({KEY_A: b"aaa"})
    plan = r2.plan_publication(local={}, private={}, public_keys=[KEY_A], public=public.list_sizes(),
                               catalog=[KEY_A, KEY_B])
    assert plan.public_unchanged == [KEY_A] and plan.missing == []
    assert plan.not_in_private == [KEY_A, KEY_B]


def test_publication_never_empties_the_public_bucket():
    public = FakeBucket({KEY_A: b"a"})
    plan = r2.plan_publication(local={}, private={}, public_keys=[], public=public.list_sizes())
    with pytest.raises(r2.R2Error, match="no se vacía"):
        r2.apply_publication(FakeBucket(), public, {}, plan, delete_extra=True)


def test_publication_refuses_a_private_object_whose_size_changed_between_listing_and_reading():
    private = FakeBucket({KEY_A: b"aaaa"})
    plan = r2.plan_publication(local={}, private={KEY_A: 3}, public_keys=[KEY_A], public={})
    with pytest.raises(r2.R2Error, match="tamaño distinto"):
        r2.apply_publication(private, FakeBucket(), {}, plan)


# --- Cliente S3 propio (SigV4Client): el job 'publicar' no instala boto3 -------------------------------------------

VECTORS = json.loads((ROOT / "tests" / "fixtures" / "sigv4-vectores.json").read_text(encoding="utf-8"))["casos"]


def test_sign_v4_matches_the_aws_example_for_s3():
    # Ejemplo «GET Object» de la documentación de AWS Signature Version 4 para S3.
    headers = r2.sign_v4(
        method="GET", host="examplebucket.s3.amazonaws.com", path="/test.txt", query="", payload=b"",
        access_key_id="AKIAIOSFODNN7EXAMPLE", secret_access_key="wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
        region="us-east-1", service="s3", when=datetime(2013, 5, 24, tzinfo=timezone.utc),
        extra_headers={"range": "bytes=0-9"},
    )
    assert headers["Authorization"] == (
        "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, "
        "SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, "
        "Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41"
    )
    assert VECTORS[0]["esperado"]["Authorization"] == headers["Authorization"]


@pytest.mark.parametrize("case", VECTORS, ids=[case["nombre"] for case in VECTORS])
def test_sign_v4_matches_the_vectors_shared_with_the_vercel_function(case):
    # Los mismos vectores los comprueba tests/web-unit/api-subir.test.mjs con la firma de Node (signV4).
    when = datetime.strptime(case["when"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    headers = r2.sign_v4(
        method=case["method"], host=case["host"], path=case["path"], query=case["query"],
        payload=base64.b64decode(case["payload_b64"]), access_key_id=case["access_key_id"],
        secret_access_key=case["secret_access_key"], region=case["region"], service=case["service"], when=when,
        extra_headers=case["extra_headers"],
    )
    assert headers == case["esperado"]


def test_canonical_query_sorts_and_encodes_like_rfc_3986():
    assert r2.canonical_query({"prefix": "audio/", "list-type": "2", "continuation-token": "a b+c/="}) == (
        "continuation-token=a%20b%2Bc%2F%3D&list-type=2&prefix=audio%2F"
    )


ACCOUNT = "0123456789abcdef0123456789abcdef"
LISTING = """<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <IsTruncated>{truncated}</IsTruncated>{token}
  <Contents><Key>audio/{key}.opus</Key><Size>{size}</Size></Contents>
</ListBucketResult>"""


class FakeOpener:
    """Hace de urllib.request.urlopen: guarda cada petición y responde con lo que se le da."""

    def __init__(self, *bodies):
        self.requests, self._bodies = [], list(bodies)

    def __call__(self, request, timeout):
        self.requests.append(request)
        body = self._bodies.pop(0)
        if isinstance(body, Exception):
            raise body
        return io.BytesIO(body)


def _client(opener) -> r2.SigV4Client:
    return r2.SigV4Client(account_id=ACCOUNT, access_key_id="AK", secret_access_key="SK", opener=opener)


def _bucket(opener, name="b") -> r2.S3Bucket:
    return r2.S3Bucket(account_id=ACCOUNT, access_key_id="AK", secret_access_key="SK", bucket=name,
                       client=_client(opener))


def test_client_lists_every_page_of_the_bucket():
    opener = FakeOpener(
        LISTING.format(truncated="true", token="<NextContinuationToken>t+1</NextContinuationToken>",
                       key=ID_A, size=3).encode(),
        LISTING.format(truncated="false", token="", key=ID_B, size=5).encode(),
    )
    assert _bucket(opener).list_sizes() == {KEY_A: 3, KEY_B: 5}
    first, second = opener.requests
    assert first.full_url == f"https://{ACCOUNT}.r2.cloudflarestorage.com/b?list-type=2&prefix=audio%2F"
    assert "continuation-token=t%2B1" in second.full_url
    assert first.get_header("Authorization").startswith("AWS4-HMAC-SHA256 Credential=AK/")


def test_client_lists_another_prefix():
    opener = FakeOpener(LISTING.format(truncated="false", token="", key=ID_A, size=3).encode())
    _bucket(opener).list_sizes("entrada/")
    assert opener.requests[0].full_url.endswith("prefix=entrada%2F")


def test_client_puts_gets_and_deletes_by_key(tmp_path):
    _write(tmp_path, f"{ID_A}.opus", 4)
    opener = FakeOpener(b"", b"", b"contenido", b"")
    bucket = _bucket(opener)
    bucket.put(KEY_A, tmp_path / f"{ID_A}.opus")
    bucket.put_bytes(KEY_B, b"yy")
    assert bucket.get(KEY_B) == b"contenido"
    bucket.delete(KEY_B)
    put, put_bytes, get, delete = opener.requests
    assert (put.get_method(), put.full_url, put.data) == (
        "PUT", f"https://{ACCOUNT}.r2.cloudflarestorage.com/b/{KEY_A}", b"xxxx")
    assert put.get_header("Content-type") == r2.CONTENT_TYPE
    assert put.get_header("Cache-control") == r2.CACHE_CONTROL
    assert (put_bytes.get_method(), put_bytes.data) == ("PUT", b"yy")
    assert put_bytes.get_header("Content-type") == r2.CONTENT_TYPE
    assert (get.get_method(), get.data, get.full_url.endswith(KEY_B)) == ("GET", None, True)
    assert (delete.get_method(), delete.data) == ("DELETE", None)


def test_client_errors_say_the_status_but_never_the_body():
    error = urllib.error.HTTPError("u", 403, "Forbidden", {}, io.BytesIO(b"<Error>cuenta secreta</Error>"))
    with pytest.raises(r2.R2Error) as raised:
        _client(FakeOpener(error)).delete_object(Bucket="b", Key=KEY_A)
    assert "HTTP 403" in str(raised.value) and "secreta" not in str(raised.value)


def test_client_refuses_an_account_id_that_would_change_the_host():
    with pytest.raises(r2.R2Error, match="R2_ACCOUNT_ID"):
        r2.SigV4Client(account_id="evil.example.com/x", access_key_id="AK", secret_access_key="SK")


def test_the_same_credentials_serve_both_buckets():
    env = {"R2_ACCOUNT_ID": ACCOUNT, "R2_ACCESS_KEY_ID": "AK", "R2_SECRET_ACCESS_KEY": "SK",
           "R2_BUCKET": "publico", "R2_PRIVATE_BUCKET": "privado"}
    assert r2.missing_variables(env, "R2_BUCKET", "R2_PRIVATE_BUCKET") == []
    assert r2.missing_variables({**env, "R2_PRIVATE_BUCKET": ""}, "R2_PRIVATE_BUCKET") == ["R2_PRIVATE_BUCKET"]
    assert r2.bucket_from_env(env, "R2_PRIVATE_BUCKET").name == "privado"
    assert r2.bucket_from_env(env, "R2_BUCKET").name == "publico"


# --- scripts/sync_r2.py ------------------------------------------------------------------------------------------

class FakeS3:
    """Varios buckets en memoria con la interfaz del cliente (list_objects_v2, put_object, get_object, delete_object)."""

    def __init__(self, buckets: dict[str, dict[str, bytes]]):
        self.buckets = buckets

    def list_objects_v2(self, *, Bucket, Prefix="", ContinuationToken=None):  # noqa: N803
        items = [{"Key": key, "Size": len(data)} for key, data in sorted(self.buckets[Bucket].items())
                 if key.startswith(Prefix)]
        return {"Contents": items, "IsTruncated": False}

    def put_object(self, *, Bucket, Key, Body, ContentType, CacheControl):  # noqa: N803
        assert ContentType == r2.CONTENT_TYPE and "immutable" in CacheControl
        self.buckets[Bucket][Key] = Body.read() if hasattr(Body, "read") else bytes(Body)

    def get_object(self, *, Bucket, Key):  # noqa: N803
        return {"Body": io.BytesIO(self.buckets[Bucket][Key])}

    def delete_object(self, *, Bucket, Key):  # noqa: N803
        del self.buckets[Bucket][Key]


ENV = {"R2_ACCOUNT_ID": ACCOUNT, "R2_ACCESS_KEY_ID": "AK", "R2_SECRET_ACCESS_KEY": "SK",
       "R2_BUCKET": "publico", "R2_PRIVATE_BUCKET": "privado"}


def _library(tmp_path: Path, songs: list[dict], files: dict[str, int], catalog: list[str] | None = None) -> Path:
    """Repositorio mínimo: audio-library/audio con 'files', el catálogo y frontend/web/data/songs.json."""
    audio = tmp_path / "audio-library" / "audio"
    audio.mkdir(parents=True)
    for name, size in files.items():
        _write(audio, name, size)
    data = tmp_path / "frontend" / "web" / "data"
    data.mkdir(parents=True)
    (data / "songs.json").write_text(json.dumps(songs), encoding="utf-8")
    ids = catalog if catalog is not None else [song["id"] for song in songs if isinstance(song, dict)]
    index = tmp_path / "audio-library" / "indexes"
    index.mkdir(parents=True)
    (index / "catalog.json").write_text(json.dumps({"songs": [{"id": song_id} for song_id in ids]}), encoding="utf-8")
    return tmp_path


def _script(name: str = "sync_r2"):
    spec = importlib.util.spec_from_file_location(f"{name}_under_test", ROOT / "scripts" / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_script_simulates_without_credentials(capsys, tmp_path):
    root = _library(tmp_path, [_song(ID_A)], {f"{ID_A}.opus": 3})
    assert _script().main(["--raiz", str(root)], env={}) == 0
    out = capsys.readouterr().out
    assert "Simulación: no se ha cambiado nada." in out and "Al bucket privado: 1" in out
    assert _script().main(["--aplicar", "--raiz", str(root)], env={}) == 1
    assert "R2_PRIVATE_BUCKET" in capsys.readouterr().out


def test_script_without_credentials_cannot_know_if_the_buckets_have_the_audio(capsys, tmp_path):
    root = _library(tmp_path, [_song(ID_A)], {})
    assert _script().main(["--raiz", str(root)], env={}) == 0
    assert "Sin audio local" in capsys.readouterr().out


def test_script_publishes_with_both_buckets(capsys, tmp_path):
    root = _library(tmp_path, [_song(ID_A), _song(ID_B)], {f"{ID_A}.opus": 3, f"{ID_C}.opus": 2},
                    catalog=[ID_A, ID_B, ID_C])
    s3 = FakeS3({"privado": {KEY_B: b"bbbb"}, "publico": {"audio/Sfffffffffffffff0.opus": b"z"}})

    assert _script().main(["--aplicar", "--borrar-sobrantes", "--raiz", str(root)], env=ENV, client=s3) == 0

    assert set(s3.buckets["privado"]) == {KEY_A, KEY_B, KEY_C}
    assert set(s3.buckets["publico"]) == {KEY_A, KEY_B}
    assert "'borrados': 1" in capsys.readouterr().out


def test_script_stops_if_a_public_song_has_no_audio_anywhere(capsys, tmp_path):
    root = _library(tmp_path, [_song(ID_A)], {f"{ID_C}.opus": 2}, catalog=[ID_A, ID_C])
    s3 = FakeS3({"privado": {}, "publico": {"audio/Sfffffffffffffff0.opus": b"z"}})

    assert _script().main(["--aplicar", "--borrar-sobrantes", "--raiz", str(root)], env=ENV, client=s3) == 1

    assert "falta el audio de 1" in capsys.readouterr().out
    assert s3.buckets == {"privado": {}, "publico": {"audio/Sfffffffffffffff0.opus": b"z"}}  # nada escrito


def test_script_without_delete_flag_never_deletes(tmp_path):
    root = _library(tmp_path, [_song(ID_A)], {f"{ID_A}.opus": 3})
    s3 = FakeS3({"privado": {}, "publico": {"audio/Sfffffffffffffff0.opus": b"z"}})
    assert _script().main(["--aplicar", "--raiz", str(root)], env=ENV, client=s3) == 0
    assert "audio/Sfffffffffffffff0.opus" in s3.buckets["publico"]


def test_script_simulates_the_real_repository(capsys):
    assert _script().main([], env={}) == 0


# --- scripts/migrar_audio_privado.py -----------------------------------------------------------------------------

def test_migration_uploads_everything_verifies_sizes_and_never_deletes(capsys, tmp_path):
    root = _library(tmp_path, [_song(ID_A)], {f"{ID_A}.opus": 3, f"{ID_B}.opus": 5}, catalog=[ID_A, ID_B])
    s3 = FakeS3({"privado": {KEY_A: b"xxx", "audio/Sfffffffffffffff0.opus": b"z", "entrada/x": b"y"}})

    assert _script("migrar_audio_privado").main(["--aplicar", "--raiz", str(root)], env=ENV, client=s3) == 0

    assert set(s3.buckets["privado"]) == {KEY_A, KEY_B, "audio/Sfffffffffffffff0.opus", "entrada/x"}
    assert "mismo tamaño" in capsys.readouterr().out


def test_migration_fails_if_a_catalog_song_ends_without_audio_in_the_bucket(capsys, tmp_path):
    root = _library(tmp_path, [], {f"{ID_A}.opus": 3}, catalog=[ID_A, ID_B])
    s3 = FakeS3({"privado": {}})

    assert _script("migrar_audio_privado").main(["--aplicar", "--raiz", str(root)], env=ENV, client=s3) == 1

    assert f"{KEY_B}: canción del catálogo sin audio" in capsys.readouterr().out


def test_migration_simulates_without_credentials_and_needs_them_to_apply(tmp_path):
    root = _library(tmp_path, [_song(ID_A)], {f"{ID_A}.opus": 3})
    module = _script("migrar_audio_privado")
    assert module.main(["--raiz", str(root)], env={}) == 0
    assert module.main(["--aplicar", "--raiz", str(root)], env={}) == 1
