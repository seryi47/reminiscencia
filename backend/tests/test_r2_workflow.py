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


def test_only_the_r2_steps_receive_the_r2_credentials_and_never_the_github_token():
    # El paso que sincroniza los dos buckets y, en el buzón, el que borra de entrada/ lo ya publicado (ADR-0024).
    expected = {"biblioteca.yml": ["sync_r2.py"], "buzon.yml": ["sync_r2.py", "entrada_r2.py limpiar"]}
    for path in PUBLISHERS:
        with_secrets = [step for step in _steps(_publicar(path)) if "secrets.R2_" in step]
        assert [next(tool for tool in expected[path.name] if tool in step) for step in with_secrets] == \
            expected[path.name], path.name
        for step in with_secrets:
            assert "GH_TOKEN" not in step and "git push" not in step and "github.token" not in step
        sync = with_secrets[0]
        for name in (*SECRETS, "R2_PRIVATE_BUCKET"):
            assert f"{name}: ${{{{ secrets.{name} }}}}" in sync


def test_the_review_workflow_and_the_migration_know_the_private_bucket():
    assert "R2_PRIVATE_BUCKET: ${{ secrets.R2_PRIVATE_BUCKET }}" in _text()
    migration = (WORKFLOW.parent / "migrar-audio-privado.yml").read_text(encoding="utf-8")
    assert "R2_PRIVATE_BUCKET: ${{ secrets.R2_PRIVATE_BUCKET }}" in migration


def test_the_migration_is_manual_from_main_read_only_on_the_repository_and_never_deletes():
    text = (WORKFLOW.parent / "migrar-audio-privado.yml").read_text(encoding="utf-8")
    trigger = text.split("\non:\n", 1)[1].split("\nconcurrency:", 1)[0]
    assert [line for line in trigger.splitlines() if line.strip() and not line.startswith("#")] == ["  workflow_dispatch:"]
    assert "contents: read" in text and "contents: write" not in text
    assert "GH_TOKEN" not in text and "git push" not in text and "pip install" not in text
    assert "ref: main" in text and "persist-credentials: false" in text
    step = next(step for step in _steps(text) if "secrets.R2_" in step)
    assert step.index('"$GITHUB_REF_NAME" != "main"') < step.index("python scripts/migrar_audio_privado.py --aplicar")
    assert "R2_BUCKET:" not in step  # solo el bucket privado
    assert "--borrar" not in text and "group: library-catalog" not in text
    uses = [line.split("uses:")[1].split()[0] for line in text.splitlines() if "uses:" in line]
    assert uses and all("@" in item and len(item.split("@")[1]) == 40 for item in uses)


def test_the_r2_step_only_runs_from_main_and_skips_when_there_is_nothing_to_publish():
    for path in PUBLISHERS:
        step = next(step for step in _steps(_publicar(path)) if "sync_r2.py" in step)
        assert '"$GITHUB_REF_NAME" != "main"' in step and "exit 1" in step
        assert '"$(git rev-parse HEAD)" = "$BASE"' in step


def test_no_workflow_with_r2_credentials_installs_packages():
    for path in [WORKFLOW, *PUBLISHERS, WORKFLOW.parent / "migrar-audio-privado.yml"]:
        for step in _steps(path.read_text(encoding="utf-8")):
            if "secrets.R2_" in step:
                assert "pip install" not in step, path.name
