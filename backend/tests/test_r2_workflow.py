from pathlib import Path

WORKFLOW = Path(__file__).resolve().parents[2] / ".github" / "workflows" / "r2.yml"


def _text() -> str:
    return WORKFLOW.read_text(encoding="utf-8")


def test_runs_after_the_workflows_that_add_audio_and_on_demand():
    text = _text()
    assert "workflows: [buzon, biblioteca]" in text
    assert "github.event.workflow_run.conclusion == 'success'" in text
    assert "workflow_dispatch:" in text


def test_only_reads_main_and_never_writes_the_repository():
    text = _text()
    assert "contents: read" in text and "contents: write" not in text
    assert "ref: main" in text and "persist-credentials: false" in text
    assert "GH_TOKEN" not in text and "git push" not in text


def test_uploads_without_deleting_and_credentials_come_only_from_secrets():
    text = _text()
    assert "python scripts/sync_r2.py --aplicar\n" in text
    assert "--borrar-sobrantes" not in text
    for name in ("R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"):
        assert f"{name}: ${{{{ secrets.{name} }}}}" in text


def test_actions_are_pinned_to_commits():
    uses = [line.split("uses:")[1].split()[0] for line in _text().splitlines() if "uses:" in line]
    assert uses and all("@" in item and len(item.split("@")[1]) == 40 for item in uses)


# --- Fase 3 (ADR-0020): el job 'publicar' sube el audio a R2 antes de subir a main --------------------------------

PUBLISHERS = [WORKFLOW.parent / name for name in ("buzon.yml", "biblioteca.yml")]
SECRETS = ("R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET")


def _publicar(path: Path) -> str:
    return path.read_text(encoding="utf-8").split("\n  publicar:\n", 1)[1]


def _steps(job: str) -> list[str]:
    return job.split("\n      - ")[1:]


def test_publishing_uploads_to_r2_and_deletes_unpublished_audio_before_pushing_to_main():
    for path in PUBLISHERS:
        job = _publicar(path)
        sync = job.index("python scripts/sync_r2.py --aplicar --borrar-sobrantes\n")
        assert job.index("scripts/aplicar_paquete.py") < sync < job.index("git push"), path.name


def test_only_the_r2_step_receives_the_r2_credentials_and_never_the_github_token():
    for path in PUBLISHERS:
        with_secrets = [step for step in _steps(_publicar(path)) if "secrets.R2_" in step]
        assert len(with_secrets) == 1, path.name
        step = with_secrets[0]
        assert "sync_r2.py" in step and "GH_TOKEN" not in step and "git push" not in step
        for name in SECRETS:
            assert f"{name}: ${{{{ secrets.{name} }}}}" in step


def test_the_r2_step_only_runs_from_main_and_skips_when_there_is_nothing_to_publish():
    for path in PUBLISHERS:
        step = next(step for step in _steps(_publicar(path)) if "sync_r2.py" in step)
        assert '"$GITHUB_REF_NAME" != "main"' in step and "exit 1" in step
        assert '"$(git rev-parse HEAD)" = "$BASE"' in step


def test_no_workflow_with_r2_credentials_installs_packages():
    for path in [WORKFLOW, *PUBLISHERS]:
        for step in _steps(path.read_text(encoding="utf-8")):
            if "secrets.R2_" in step:
                assert "pip install" not in step, path.name
