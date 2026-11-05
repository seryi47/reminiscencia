import importlib.util
import io
import json
import urllib.error
from datetime import datetime, timezone
from pathlib import Path

import pytest

from sonidos import r2

ID_A = "S0123456789abcdef"
ID_B = "Sfedcba9876543210"


def _write(directory: Path, name: str, size: int) -> None:
    (directory / name).write_bytes(b"x" * size)


def test_local_audio_only_lists_regular_opus_files(tmp_path):  # lo usan las pruebas de plan_sync
    _write(tmp_path, "S1.opus", 3)
    _write(tmp_path, "notas.txt", 3)
    (tmp_path / "enlace.opus").symlink_to(tmp_path / "S1.opus")
    assert list(r2.local_audio(tmp_path)) == ["audio/S1.opus"]


def test_plan_uploads_missing_and_resized_and_keeps_extras_separate(tmp_path):
    _write(tmp_path, "S1.opus", 3)
    _write(tmp_path, "S2.opus", 5)
    _write(tmp_path, "S3.opus", 7)
    local = r2.local_audio(tmp_path)
    plan = r2.plan_sync(local, {"audio/S1.opus": 3, "audio/S2.opus": 4, "audio/Sold.opus": 9})
    assert plan.unchanged == ["audio/S1.opus"]
    assert sorted(plan.upload) == ["audio/S2.opus", "audio/S3.opus"]
    assert plan.extra == ["audio/Sold.opus"]


class FakeBucket:
    def __init__(self):
        self.put_keys, self.deleted = [], []

    def list_sizes(self):
        return {}

    def put(self, key, path):
        self.put_keys.append(key)

    def delete(self, key):
        self.deleted.append(key)


def test_apply_never_deletes_unless_asked(tmp_path):
    _write(tmp_path, "S1.opus", 3)
    local = r2.local_audio(tmp_path)
    plan = r2.plan_sync(local, {"audio/Sold.opus": 1})
    bucket = FakeBucket()
    assert r2.apply_plan(bucket, local, plan) == {"subidos": 1, "sin_cambios": 0, "borrados": 0}
    assert bucket.deleted == []
    assert r2.apply_plan(bucket, local, plan, delete_extra=True)["borrados"] == 1


class FakeS3:
    def __init__(self):
        self.puts = []

    def list_objects_v2(self, **args):
        if "ContinuationToken" not in args:
            return {"Contents": [{"Key": "audio/A.opus", "Size": 1}], "IsTruncated": True, "NextContinuationToken": "t"}
        return {"Contents": [{"Key": "audio/B.opus", "Size": 2}], "IsTruncated": False}

    def put_object(self, **args):
        self.puts.append(args)


def test_s3_bucket_pages_the_listing_and_sets_cache_headers(tmp_path):
    _write(tmp_path, "S1.opus", 3)
    s3 = FakeS3()
    bucket = r2.S3Bucket(account_id="a", access_key_id="k", secret_access_key="s", bucket="b", client=s3)
    assert bucket.list_sizes() == {"audio/A.opus": 1, "audio/B.opus": 2}
    bucket.put("audio/S1.opus", tmp_path / "S1.opus")
    assert s3.puts[0]["ContentType"] == "audio/ogg; codecs=opus"
    assert "immutable" in s3.puts[0]["CacheControl"]


def _library(tmp_path: Path, songs: list[dict], files: dict[str, int]) -> Path:
    """Repositorio mínimo: audio-library/audio con 'files' y frontend/web/data/songs.json con 'songs'."""
    audio = tmp_path / "audio-library" / "audio"
    audio.mkdir(parents=True)
    for name, size in files.items():
        _write(audio, name, size)
    data = tmp_path / "frontend" / "web" / "data"
    data.mkdir(parents=True)
    (data / "songs.json").write_text(json.dumps(songs), encoding="utf-8")
    return tmp_path


def _song(song_id: str) -> dict:
    return {"id": song_id, "title": "t", "audio": f"audio/{song_id}.opus"}


def test_public_audio_takes_only_the_public_songs_from_the_library(tmp_path):
    root = _library(tmp_path, [_song(ID_A)], {f"{ID_A}.opus": 3, f"{ID_B}.opus": 5})
    found = r2.public_audio(root / "audio-library" / "audio", root / "frontend/web/data/songs.json")
    assert found == {f"audio/{ID_A}.opus": root / "audio-library" / "audio" / f"{ID_A}.opus"}


@pytest.mark.parametrize("songs, files, message", [
    ([_song(ID_A)], {}, "falta el audio"),
    ([{"id": "../etc", "audio": "audio/../etc.opus"}], {}, "id no válido"),
    ([{"id": ID_A, "audio": f"audio/{ID_B}.opus"}], {f"{ID_A}.opus": 1}, "ruta de audio inesperada"),
    ({"songs": []}, {}, "no es una lista"),
])
def test_public_audio_refuses_a_broken_list_or_a_missing_file(tmp_path, songs, files, message):
    root = _library(tmp_path, songs, files)
    with pytest.raises(r2.R2Error, match=message):
        r2.public_audio(root / "audio-library" / "audio", root / "frontend/web/data/songs.json")


def test_public_audio_refuses_a_symlink_in_place_of_the_audio(tmp_path):
    root = _library(tmp_path, [_song(ID_A)], {"otro.opus": 3})
    (root / "audio-library" / "audio" / f"{ID_A}.opus").symlink_to(root / "audio-library" / "audio" / "otro.opus")
    with pytest.raises(r2.R2Error, match="falta el audio"):
        r2.public_audio(root / "audio-library" / "audio", root / "frontend/web/data/songs.json")


def test_apply_never_empties_the_bucket(tmp_path):
    plan = r2.plan_sync({}, {f"audio/{ID_A}.opus": 3})
    bucket = FakeBucket()
    with pytest.raises(r2.R2Error, match="no se vacía el bucket"):
        r2.apply_plan(bucket, {}, plan, delete_extra=True)
    assert bucket.deleted == []


# --- Cliente S3 propio (SigV4Client): el job 'publicar' no instala boto3 -------------------------------------------

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


def test_client_lists_every_page_of_the_bucket():
    opener = FakeOpener(
        LISTING.format(truncated="true", token="<NextContinuationToken>t+1</NextContinuationToken>",
                       key=ID_A, size=3).encode(),
        LISTING.format(truncated="false", token="", key=ID_B, size=5).encode(),
    )
    bucket = r2.S3Bucket(account_id=ACCOUNT, access_key_id="AK", secret_access_key="SK", bucket="b",
                         client=_client(opener))
    assert bucket.list_sizes() == {f"audio/{ID_A}.opus": 3, f"audio/{ID_B}.opus": 5}
    first, second = opener.requests
    assert first.full_url == f"https://{ACCOUNT}.r2.cloudflarestorage.com/b?list-type=2&prefix=audio%2F"
    assert "continuation-token=t%2B1" in second.full_url
    assert first.get_header("Authorization").startswith(f"AWS4-HMAC-SHA256 Credential=AK/")


def test_client_puts_the_audio_with_its_type_and_cache_and_deletes_by_key(tmp_path):
    _write(tmp_path, f"{ID_A}.opus", 4)
    opener = FakeOpener(b"", b"")
    bucket = r2.S3Bucket(account_id=ACCOUNT, access_key_id="AK", secret_access_key="SK", bucket="b",
                         client=_client(opener))
    bucket.put(f"audio/{ID_A}.opus", tmp_path / f"{ID_A}.opus")
    bucket.delete(f"audio/{ID_B}.opus")
    put, delete = opener.requests
    assert (put.get_method(), put.full_url, put.data) == (
        "PUT", f"https://{ACCOUNT}.r2.cloudflarestorage.com/b/audio/{ID_A}.opus", b"xxxx")
    assert put.get_header("Content-type") == r2.CONTENT_TYPE
    assert put.get_header("Cache-control") == r2.CACHE_CONTROL
    assert (delete.get_method(), delete.data) == ("DELETE", None)


def test_client_errors_say_the_status_but_never_the_body():
    error = urllib.error.HTTPError("u", 403, "Forbidden", {}, io.BytesIO(b"<Error>cuenta secreta</Error>"))
    with pytest.raises(r2.R2Error) as raised:
        _client(FakeOpener(error)).delete_object(Bucket="b", Key=f"audio/{ID_A}.opus")
    assert "HTTP 403" in str(raised.value) and "secreta" not in str(raised.value)


def test_client_refuses_an_account_id_that_would_change_the_host():
    with pytest.raises(r2.R2Error, match="R2_ACCOUNT_ID"):
        r2.SigV4Client(account_id="evil.example.com/x", access_key_id="AK", secret_access_key="SK")


def _script():
    root = Path(__file__).resolve().parents[2]
    spec = importlib.util.spec_from_file_location("sync_r2", root / "scripts" / "sync_r2.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_script_simulates_without_credentials(monkeypatch, capsys, tmp_path):
    module = _script()
    root = _library(tmp_path, [_song(ID_A)], {f"{ID_A}.opus": 3})
    for name in ("R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"):
        monkeypatch.delenv(name, raising=False)
    assert module.main(["--raiz", str(root)]) == 0
    out = capsys.readouterr().out
    assert "Simulación: no se ha cambiado nada." in out and "Por subir: 1" in out
    assert module.main(["--aplicar", "--raiz", str(root)]) == 1


def test_script_stops_if_a_public_song_has_no_audio(capsys, tmp_path):
    root = _library(tmp_path, [_song(ID_A)], {})
    assert _script().main(["--raiz", str(root)]) == 1
    assert "falta el audio" in capsys.readouterr().out


def test_script_simulates_the_real_repository(capsys):
    # Todas las canciones públicas del repositorio tienen su audio en audio-library/audio.
    assert _script().main([]) == 0
