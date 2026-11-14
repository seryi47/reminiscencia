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
    # R2_ACCOUNT_ID se reutiliza como el id de cuenta de Cloudflare para desplegar el Worker (ADR-0034); no es una
    # credencial, así que lo que se vigila es la CLAVE de R2 (R2_ACCESS_KEY_ID y, con ella, el secreto y los buckets).
    expected = {"biblioteca.yml": ["sync_r2.py"], "buzon.yml": ["sync_r2.py", "entrada_r2.py limpiar"]}
    for path in PUBLISHERS:
        steps = _steps(_publicar(path))
        with_keys = [step for step in steps if "secrets.R2_ACCESS_KEY_ID" in step]
        assert [next(tool for tool in expected[path.name] if tool in step) for step in with_keys] == \
            expected[path.name], path.name
        for step in with_keys:
            assert "GH_TOKEN" not in step and "git push" not in step and "github.token" not in step
        sync = with_keys[0]
        for name in (*SECRETS, "R2_PRIVATE_BUCKET"):
            assert f"{name}: ${{{{ secrets.{name} }}}}" in sync
        # Un paso que use solo el id de cuenta (p. ej. desplegar el Worker) nunca recibe la clave ni el secreto de R2.
        for step in steps:
            if "secrets.R2_ACCOUNT_ID" in step and "secrets.R2_ACCESS_KEY_ID" not in step:
                assert "secrets.R2_SECRET_ACCESS_KEY" not in step, path.name


def test_the_review_workflow_knows_the_private_bucket_and_no_longer_watches_the_audio_folder():
    text = _text()
    assert "R2_PRIVATE_BUCKET: ${{ secrets.R2_PRIVATE_BUCKET }}" in text
    assert '"audio-library/audio/**"' not in text  # el audio ya no está en Git (ADR-0024, parte 2)


def test_the_one_off_migration_is_gone():
    # La migración de la parte 1 copiaba el audio de Git al bucket privado; sin audio en Git ya no sirve.
    assert not (WORKFLOW.parent / "migrar-audio-privado.yml").exists()


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
