import importlib.util
from pathlib import Path

from sonidos import r2


def _write(directory: Path, name: str, size: int) -> None:
    (directory / name).write_bytes(b"x" * size)


def test_local_audio_only_lists_regular_opus_files(tmp_path):
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


def test_script_simulates_without_credentials(monkeypatch, capsys):
    root = Path(__file__).resolve().parents[2]
    spec = importlib.util.spec_from_file_location("sync_r2", root / "scripts" / "sync_r2.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    for name in ("R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"):
        monkeypatch.delenv(name, raising=False)
    assert module.main([]) == 0
    assert "Simulación: no se ha cambiado nada." in capsys.readouterr().out
    assert module.main(["--aplicar"]) == 1
