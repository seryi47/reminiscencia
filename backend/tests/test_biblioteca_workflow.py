"""Guardas de seguridad del workflow biblioteca.yml (ADR-0008).

Sin dependencias de YAML: se leen los bloques 'run:' por indentación. Lo que escribe alguien en una
incidencia no debe llegar nunca a un intérprete de shell por interpolación de ${{ }}.
"""

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


def test_checkout_does_not_keep_the_token_on_disk_and_push_receives_it_only_in_its_step():
    text = _workflow_text()

    assert "persist-credentials: false" in text
    assert "GH_TOKEN: ${{ github.token }}" in text
    assert "https://x-access-token:${GH_TOKEN}@github.com/${GITHUB_REPOSITORY}.git" in text


def test_web_has_no_administration_code():
    for folder in ("admin", "api", "lib"):
        assert not (ROOT / "frontend" / "web" / folder).exists()
