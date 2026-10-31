import subprocess

import pytest

from sonidos import limits
from sonidos.limits import (
    GIT_BLOCK_FILE_BYTES,
    GIT_WARN_FILE_BYTES,
    MiB,
    LimitError,
    audit_repository,
    check_release_asset,
    plan_release_batches,
)


def sparse_file(path, size):
    """Crea un fichero de tamaño dado sin escribir los bytes en disco."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("wb") as handle:
        handle.truncate(size)
    return path


def test_release_asset_under_limit_is_accepted(tmp_path):
    small = sparse_file(tmp_path / "pista.opus", 10 * MiB)

    assert check_release_asset(small) == 10 * MiB


def test_release_asset_at_or_above_limit_is_refused(tmp_path, monkeypatch):
    monkeypatch.setattr(limits, "RELEASE_ASSET_MAX_BYTES", 5 * MiB)
    big = sparse_file(tmp_path / "grande.opus", 5 * MiB)

    with pytest.raises(LimitError):
        check_release_asset(big)


def test_batches_split_by_asset_count(tmp_path, monkeypatch):
    monkeypatch.setattr(limits, "RELEASE_DATA_ASSETS_PER_BATCH", 2)
    files = [sparse_file(tmp_path / f"p{index}.opus", 1024) for index in range(5)]

    batches = plan_release_batches(files)

    assert [len(batch) for batch in batches] == [2, 2, 1]
    assert sum(len(batch) for batch in batches) == 5


def test_batch_planning_refuses_when_any_file_is_too_big(tmp_path, monkeypatch):
    monkeypatch.setattr(limits, "RELEASE_ASSET_MAX_BYTES", 5 * MiB)
    ok = sparse_file(tmp_path / "ok.opus", 1024)
    big = sparse_file(tmp_path / "big.opus", 5 * MiB)

    with pytest.raises(LimitError):
        plan_release_batches([ok, big])


def test_audit_flags_file_over_github_block_limit(tmp_path):
    subprocess.run(["git", "init", "-q", str(tmp_path)], check=True)
    sparse_file(tmp_path / "audio.wav", GIT_BLOCK_FILE_BYTES + MiB)
    subprocess.run(["git", "-C", str(tmp_path), "add", "audio.wav"], check=True)

    problems = audit_repository(tmp_path)

    assert any("audio.wav" in problem and "bloquea" in problem for problem in problems)


def test_audit_warns_between_warn_and_block_limit(tmp_path):
    subprocess.run(["git", "init", "-q", str(tmp_path)], check=True)
    sparse_file(tmp_path / "medio.bin", GIT_WARN_FILE_BYTES + MiB)
    subprocess.run(["git", "-C", str(tmp_path), "add", "medio.bin"], check=True)

    problems = audit_repository(tmp_path)

    assert any("medio.bin" in problem and "aviso" in problem for problem in problems)


def test_audit_ignores_untracked_files(tmp_path):
    subprocess.run(["git", "init", "-q", str(tmp_path)], check=True)
    sparse_file(tmp_path / "sin_versionar.wav", GIT_BLOCK_FILE_BYTES + MiB)

    assert audit_repository(tmp_path) == []
