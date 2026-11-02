"""Guardas de seguridad del workflow biblioteca.yml (ADR-0008).

Sin dependencias de YAML: se leen los bloques 'run:' por indentación. Lo que escribe alguien en una
incidencia no debe llegar nunca a un intérprete de shell por interpolación de ${{ }}.
"""

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = ROOT / ".github" / "workflows" / "biblioteca.yml"


def _workflow_text() -> str:
    return WORKFLOW.read_text(encoding="utf-8")


def _run_blocks(text: str) -> list[str]:
    lines = text.splitlines()
    blocks = []
    for index, line in enumerate(lines):
        stripped = line.lstrip()
        if not stripped.startswith("run:"):
            continue
        indent = len(line) - len(stripped)
        block = [stripped[len("run:"):]]  # contenido en la misma línea (run: echo ...)
        for following in lines[index + 1:]:
            if following.strip() and len(following) - len(following.lstrip()) <= indent:
                break
            block.append(following)
        blocks.append("\n".join(block))
    return blocks


def test_no_expression_is_interpolated_inside_a_run_block():
    blocks = _run_blocks(_workflow_text())

    assert len(blocks) >= 5
    assert not any("${{" in block for block in blocks)


def test_issue_text_reaches_the_scripts_only_through_environment_variables():
    text = _workflow_text()

    assert "BODY: ${{ github.event.issue.body }}" in text
    assert not any("github.event.issue" in block for block in _run_blocks(text))


def test_only_the_owner_with_the_biblioteca_label_can_trigger_an_issue_run():
    text = _workflow_text()

    assert "github.event.issue.user.login == github.repository_owner" in text
    assert "contains(github.event.issue.labels.*.name, 'biblioteca')" in text
    assert "github.event_name == 'workflow_dispatch'" in text


def test_permissions_and_concurrency_match_the_contract():
    text = _workflow_text()

    assert "contents: write" in text and "issues: write" in text
    assert "group: library-catalog" in text
    assert "cancel-in-progress: false" in text
    assert "types: [opened]" in text


def test_library_workflow_is_gone():
    assert not (ROOT / ".github" / "workflows" / "library.yml").exists()


GITHUB_CALLS = ("git push", "gh issue ", "gh label ")


def _steps(text: str) -> list[str]:
    """Bloques de los pasos: cada paso empieza con '      - ' bajo 'steps:'."""
    return text.split("\n      - ")[1:]


def _token_violations(text: str) -> list[str]:
    """Pasos que reciben el token sin llamar a GitHub, y el checkout si lo recibe."""
    violations = []
    for step in _steps(text):
        if "GH_TOKEN: ${{ github.token }}" not in step:
            continue
        if "actions/checkout" in step or not any(call in step for call in GITHUB_CALLS):
            violations.append(step.splitlines()[0])
    return violations


def test_checkout_does_not_keep_the_token_on_disk_and_push_receives_it_only_in_its_step():
    text = _workflow_text()

    assert "persist-credentials: false" in text
    assert "https://x-access-token:${GH_TOKEN}@github.com/${GITHUB_REPOSITORY}.git" in text
    assert _token_violations(text) == []
    assert sum("git push" in step for step in _steps(text)) == 1


def test_token_guard_flags_a_token_in_a_step_that_does_not_call_github():
    text = _workflow_text().replace(
        "      - name: Aplicar\n",
        "      - name: Aplicar\n        env:\n          GH_TOKEN: ${{ github.token }}\n",
    )

    assert _token_violations(text) != []


def test_only_main_writes_to_the_catalog():
    push_steps = [step for step in _steps(_workflow_text()) if "git push" in step]

    assert len(push_steps) == 1
    guard = push_steps[0].find('"$GITHUB_REF_NAME" != "main"')
    assert guard != -1 and guard < push_steps[0].index("git push")


def test_waiting_requests_are_queued_and_not_cancelled_without_a_comment():
    # Sin queue, GitHub cancela una petición en espera cuando llega otra: no se responde y la incidencia queda abierta.
    text = _workflow_text()
    block = text[text.index("\nconcurrency:"): text.index("\njobs:")]

    assert "\n  group: library-catalog\n" in block
    assert "\n  cancel-in-progress: false\n" in block
    assert "\n  queue: max\n" in block


def test_permissions_are_declared_on_the_job_not_on_the_whole_workflow():
    header, _, jobs = _workflow_text().partition("\njobs:")

    assert "permissions:" not in header
    assert "permissions:" in jobs


def test_web_has_no_administration_code():
    for folder in ("admin", "api", "lib"):
        assert not (ROOT / "frontend" / "web" / folder).exists()


# --- Corrección de la ronda 2 (2026-11-02): procesado separado de la publicación -----------------


def _jobs(text: str) -> tuple[str, str]:
    """Bloques de los dos jobs: 'procesar' (sin escritura ni token) y 'publicar' (último job)."""
    _, _, jobs = text.partition("\njobs:\n")
    procesar, marker, publicar = jobs.partition("\n  publicar:\n")
    assert marker and procesar.startswith("  procesar:\n")
    return procesar, publicar


OWNER_CONDITION = "github.event.issue.user.login == github.repository_owner"
LABEL_CONDITION = "contains(github.event.issue.labels.*.name, 'biblioteca')"


def test_processing_job_only_reads_and_never_receives_the_token():
    procesar, _ = _jobs(_workflow_text())

    assert "contents: read" in procesar
    assert "contents: write" not in procesar and "issues: write" not in procesar
    assert "GH_TOKEN" not in procesar
    assert "persist-credentials: false" in procesar


def test_publishing_job_depends_on_processing_and_runs_no_processing_tool():
    _, publicar = _jobs(_workflow_text())

    assert "needs: procesar" in publicar
    for processing_tool in ("ffmpeg", "ci_library.py", "issue_request.py", "sonidos.pipeline", "pip install"):
        assert processing_tool not in publicar
    assert "scripts/aplicar_paquete.py" in publicar
    assert "contents: write" in publicar and "issues: write" in publicar


def test_processing_passes_its_changes_on_as_an_artifact_that_publishing_downloads():
    procesar, publicar = _jobs(_workflow_text())

    assert "actions/upload-artifact" in procesar and "scripts/empaquetar_cambios.py" in procesar
    assert "actions/download-artifact" in publicar


def test_both_jobs_keep_the_owner_and_label_condition():
    procesar, publicar = _jobs(_workflow_text())

    for block in (procesar, publicar):
        assert OWNER_CONDITION in block and LABEL_CONDITION in block
        assert "github.event_name == 'workflow_dispatch'" in block


def test_branch_guard_runs_before_any_code_of_the_tree_is_installed_or_run():
    procesar, _ = _jobs(_workflow_text())

    assert procesar.index('"$GITHUB_REF_NAME" != "main"') < procesar.index("pip install")


def test_persist_credentials_is_off_in_both_checkouts_of_the_library_workflow():
    text = _workflow_text()

    assert text.count("uses: actions/checkout") == text.count("persist-credentials: false") == 2


def test_actions_of_the_library_workflow_are_pinned_to_a_commit():
    for line in _workflow_text().splitlines():
        if "uses: " in line:
            assert re.search(r"@[0-9a-f]{40}\b", line), line


def test_step_summary_does_not_wrap_untrusted_json_in_a_code_fence():
    assert "```json" not in _workflow_text()


def test_backend_workflow_checkouts_do_not_persist_credentials():
    text = (ROOT / ".github" / "workflows" / "backend.yml").read_text(encoding="utf-8")

    assert text.count("uses: actions/checkout") == text.count("persist-credentials: false") == 3
