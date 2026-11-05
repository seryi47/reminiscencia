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


def test_only_collaborators_with_write_permission_can_trigger_an_issue_run():
    text = _workflow_text()

    assert "github.event.issue.user.login == github.repository_owner" not in text
    assert "contains(github.event.issue.labels.*.name, 'biblioteca')" in text
    assert "github.event_name == 'workflow_dispatch'" in text
    assert "repos/$GITHUB_REPOSITORY/collaborators/$AUTOR/permission" in text
    assert "admin|maintain|write)" in text
    assert "needs.autorizar.outputs.permitido == 'true'" in text


def test_permissions_and_concurrency_match_the_contract():
    text = _workflow_text()

    assert "contents: write" in text and "issues: write" in text
    assert "group: library-catalog" in text
    assert "cancel-in-progress: false" in text
    assert "types: [opened]" in text


def test_library_workflow_is_gone():
    assert not (ROOT / ".github" / "workflows" / "library.yml").exists()


GITHUB_CALLS = ("git push", "gh api ", "gh issue ", "gh label ")


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
    for folder in ("admin", "lib"):
        assert not (ROOT / "frontend" / "web" / folder).exists()
    # Las funciones públicas son la subida al buzón y el importador seguro de YouTube;
    # server solo contiene módulos compartidos, no rutas alternativas de publicación.
    api = ROOT / "frontend" / "web" / "api"
    assert sorted(path.name for path in api.iterdir()) == ["subir.js", "youtube"]
    assert sorted(path.name for path in (api / "youtube").iterdir()) == ["convert.js", "download.js", "playlist.js", "search.js", "status.js"]


# --- Corrección de la ronda 2 (2026-11-02): procesado separado de la publicación -----------------


def _jobs(text: str) -> tuple[str, str, str]:
    """Bloques de los tres jobs, en orden: 'autorizar', 'procesar' y 'publicar'."""
    _, _, jobs = text.partition("\njobs:\n")
    blocks = [part for part in re.split(r"^(?=  \w+:\n)", jobs, flags=re.MULTILINE) if part.strip()]
    assert [block.split(":", 1)[0].strip() for block in blocks] == ["autorizar", "procesar", "publicar"]
    return blocks[0], blocks[1], blocks[2]


LABEL_CONDITION = "contains(github.event.issue.labels.*.name, 'biblioteca')"


def test_processing_job_only_reads_and_never_receives_the_token():
    _, procesar, _ = _jobs(_workflow_text())

    assert "contents: read" in procesar
    assert "contents: write" not in procesar and "issues: write" not in procesar
    assert "GH_TOKEN" not in procesar
    assert "persist-credentials: false" in procesar


def test_publishing_job_depends_on_processing_and_runs_no_processing_tool():
    _, _, publicar = _jobs(_workflow_text())

    assert "needs: [autorizar, procesar]" in publicar
    for processing_tool in ("ffmpeg", "ci_library.py", "issue_request.py", "sonidos.pipeline", "pip install"):
        assert processing_tool not in publicar
    assert "scripts/aplicar_paquete.py" in publicar
    assert "contents: write" in publicar and "issues: write" in publicar


def test_processing_passes_its_changes_on_as_an_artifact_that_publishing_downloads():
    _, procesar, publicar = _jobs(_workflow_text())

    assert "actions/upload-artifact" in procesar and "scripts/empaquetar_cambios.py" in procesar
    assert "actions/download-artifact" in publicar


def test_authorization_runs_only_for_issues_opened_with_the_label():
    autorizar, _, _ = _jobs(_workflow_text())

    assert "github.event_name == 'issues'" in autorizar
    assert LABEL_CONDITION in autorizar
    assert "workflow_dispatch" not in autorizar
    assert "types: [opened]" in _workflow_text()


def test_authorization_job_has_only_issue_write_and_runs_no_code_of_the_repository():
    autorizar, _, _ = _jobs(_workflow_text())

    assert "permissions:\n      issues: write\n" in autorizar
    assert "contents:" not in autorizar
    assert "actions/checkout" not in autorizar
    assert "upload-artifact" not in autorizar and "download-artifact" not in autorizar


def test_permission_is_read_from_the_collaborator_endpoint_and_only_write_levels_pass():
    autorizar, _, _ = _jobs(_workflow_text())
    comprobar, _ = _steps(autorizar)

    assert 'gh api "repos/$GITHUB_REPOSITORY/collaborators/$AUTOR/permission" --jq .permission' in comprobar
    assert "PERMISO=none" in comprobar
    assert 'admin|maintain|write) echo "permitido=true" >> "$GITHUB_OUTPUT" ;;' in comprobar
    assert 'echo "permitido=false" >> "$GITHUB_OUTPUT"' in comprobar
    assert "permitido: ${{ steps.permiso.outputs.permitido }}" in autorizar


def test_the_author_reaches_the_permission_check_only_through_an_environment_variable():
    autorizar, _, _ = _jobs(_workflow_text())
    comprobar, avisar = _steps(autorizar)

    assert "AUTOR: ${{ github.event.issue.user.login }}" in comprobar
    assert "$AUTOR" in comprobar and "$AUTOR" not in avisar
    assert "github.event.issue" not in "\n".join(_run_blocks(autorizar))


def test_unauthorized_authors_get_only_the_spanish_comment_and_nothing_else():
    autorizar, _, _ = _jobs(_workflow_text())
    _, avisar = _steps(autorizar)

    assert "steps.permiso.outputs.permitido != 'true'" in avisar
    assert (
        'gh issue comment "$NUMERO" --repo "$GITHUB_REPOSITORY" '
        '--body "Solo colaboradores con permiso de escritura pueden enviar peticiones a la biblioteca."'
    ) in avisar
    for action in ("gh issue close", "gh issue edit", "gh label", "git push", "actions/checkout"):
        assert action not in autorizar


def test_processing_and_publishing_wait_for_the_authorization_or_run_by_hand():
    _, procesar, publicar = _jobs(_workflow_text())

    assert "needs: autorizar" in procesar
    for block in (procesar, publicar):
        assert "always() && !cancelled()" in block
        assert "github.event_name == 'workflow_dispatch'" in block
        assert "needs.autorizar.outputs.permitido == 'true'" in block


def test_branch_guard_runs_before_any_code_of_the_tree_is_installed_or_run():
    _, procesar, _ = _jobs(_workflow_text())

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
    # Tres checkouts: el job web-unit, duplicado con web.yml, sale de backend.yml.
    text = (ROOT / ".github" / "workflows" / "backend.yml").read_text(encoding="utf-8")

    assert text.count("uses: actions/checkout") == text.count("persist-credentials: false") == 3


# --- Parte pública: publicar la regenera antes de confirmar (ADR-0010, corrección de 2026-11-02) ----------


def test_publishing_regenerates_the_public_part_before_it_commits():
    _, _, publicar = _jobs(_workflow_text())
    steps = _steps(publicar)
    aplicar = next(index for index, step in enumerate(steps) if "scripts/aplicar_paquete.py" in step)
    confirmar = next(index for index, step in enumerate(steps) if "git commit" in step)

    assert aplicar < confirmar
    assert "steps.aplicar_paquete.outcome == 'success'" in steps[confirmar]
    script = (ROOT / "scripts" / "aplicar_paquete.py").read_text(encoding="utf-8")
    assert "publish_package(" in script


def test_processing_packages_without_the_public_part_it_regenerates():
    _, procesar, _ = _jobs(_workflow_text())

    assert "scripts/empaquetar_cambios.py" in procesar
    script = (ROOT / "scripts" / "empaquetar_cambios.py").read_text(encoding="utf-8")
    assert "package_processing_changes(" in script


def test_processing_checks_out_the_current_main_and_not_the_event_commit():
    # Las peticiones esperan en cola: con el commit del evento, la segunda de una tanda partía de un main viejo
    # y publicar la rechazaba por base desfasada (seis incidencias fallidas el 2026-11-03).
    _, procesar, _ = _jobs(_workflow_text())
    checkout = procesar[procesar.index("actions/checkout"):]
    checkout = checkout[: checkout.index("- name:")]
    assert re.search(r"^\s*ref: main\s*$", checkout, re.M)
