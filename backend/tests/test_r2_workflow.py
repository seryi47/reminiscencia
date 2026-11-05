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
