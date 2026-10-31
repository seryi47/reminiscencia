from sonidos import release
from sonidos.release import build_manifest, gh_commands, plan_batches, publish


def test_manifest_lists_sha256_per_file(tmp_path):
    first = tmp_path / "a.opus"
    first.write_bytes(b"uno")
    manifest = build_manifest([first], tmp_path / "out" / "SHA256SUMS.txt")

    line = manifest.read_text(encoding="utf-8").strip()
    digest, name = line.split("  ")
    assert name == "a.opus"
    assert len(digest) == 64


def test_batches_have_tag_and_manifest(tmp_path):
    files = []
    for index in range(2):
        path = tmp_path / "src" / f"p{index}.opus"
        path.parent.mkdir(exist_ok=True)
        path.write_bytes(b"x" * (index + 1))
        files.append(path)

    batches = plan_batches(files, tag_prefix="audio-2026-10-31", work_dir=tmp_path / "work")

    assert [batch.tag for batch in batches] == ["audio-2026-10-31-01"]
    assert batches[0].manifest.exists()


def test_gh_commands_create_then_upload_with_manifest(tmp_path):
    path = tmp_path / "p.opus"
    path.write_bytes(b"x")
    batch = plan_batches([path], tag_prefix="audio-test", work_dir=tmp_path / "work")[0]

    create, upload = gh_commands("seryi47/repo-privado", batch)

    assert create[:4] == ["gh", "release", "create", "audio-test-01"]
    assert upload[:4] == ["gh", "release", "upload", "audio-test-01"]
    assert str(batch.manifest) in upload
    assert str(path) in upload


def test_publish_without_execute_runs_nothing(tmp_path, monkeypatch):
    path = tmp_path / "p.opus"
    path.write_bytes(b"x")
    batches = plan_batches([path], tag_prefix="audio-test", work_dir=tmp_path / "work")

    def fail(*args, **kwargs):
        raise AssertionError("no debe ejecutar gh en modo simulación")

    monkeypatch.setattr(release.subprocess, "run", fail)

    commands = publish("seryi47/repo-privado", batches, execute=False)

    assert len(commands) == 2
