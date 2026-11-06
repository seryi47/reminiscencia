"""Guardas de seguridad del workflow buzon.yml (ADR-0014), como las de biblioteca.yml (ADR-0008, ADR-0010), con la
entrada desde el bucket privado de R2 (ADR-0024) y la subida a main que reintenta si main avanzó (ADR-0025).

Sin dependencias de YAML: se leen los bloques por indentación. Ningún nombre de archivo ni mensaje de commit debe
llegar a un intérprete de shell por interpolación de ${{ }}; el procesado los lee del evento.
"""

import re
from pathlib import Path

from sonidos import paquete
from test_biblioteca_workflow import _run_blocks, _steps, _token_violations

ROOT = Path(__file__).resolve().parents[2]
WORKFLOWS = ROOT / ".github" / "workflows"
WORKFLOW = WORKFLOWS / "buzon.yml"
R2_SECRETS = ("R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_PRIVATE_BUCKET")
CONDITION = (
    "if: >-\n      needs.autorizar.outputs.permitido == 'true' &&\n"
    "      (needs.autorizar.outputs.pendiente == 'true' || needs.recoger.outputs.cantidad != '0')\n"
)


def _text() -> str:
    return WORKFLOW.read_text(encoding="utf-8")


def _jobs(text: str) -> tuple[str, str, str, str]:
    _, _, jobs = text.partition("\njobs:\n")
    blocks = [part for part in re.split(r"^(?=  \w+:\n)", jobs, flags=re.MULTILINE) if part.strip()]
    assert [block.split(":", 1)[0].strip() for block in blocks] == ["autorizar", "recoger", "procesar", "publicar"]
    return blocks[0], blocks[1], blocks[2], blocks[3]


def _block(text: str, start: str, end: str) -> str:
    return text[text.index(start): text.index(end)]


def test_runs_on_pushes_to_main_that_touch_the_mailbox_on_web_uploads_and_by_hand():
    trigger = _block(_text(), "\non:\n", "\nconcurrency:")

    assert "\n  push:\n    branches: [main]\n" in trigger
    assert '"audio-library/buzon/**"' in trigger
    assert '"!audio-library/buzon/README.md"' in trigger
    assert '"!audio-library/buzon/portadas/.gitkeep"' in trigger  # la carpeta de portadas no lanza el workflow
    assert "\n  repository_dispatch:\n    types: [subida-web]\n" in trigger  # lo lanza /api/subir (ADR-0024)
    assert "\n  workflow_dispatch:\n" in trigger
    for other in ("issues", "pull_request", "workflow_run", "schedule"):
        assert other not in trigger


def test_the_dispatch_type_is_the_one_the_vercel_function_sends():
    function = (ROOT / "frontend" / "web" / "api" / "subir.js").read_text(encoding="utf-8")
    assert "export const DISPATCH_EVENT = 'subida-web';" in function
    assert "/dispatches" in function


def test_shares_the_single_write_queue_with_the_library_workflow():
    bloques = []
    for name in ("buzon.yml", "biblioteca.yml"):
        text = (WORKFLOWS / name).read_text(encoding="utf-8")
        bloques.append(_block(text, "\nconcurrency:", "\njobs:"))

    assert bloques[0] == bloques[1]
    assert "\n  group: library-catalog\n" in bloques[0]
    assert "\n  cancel-in-progress: false\n" in bloques[0]
    assert "\n  queue: max\n" in bloques[0]


def test_no_expression_is_interpolated_inside_a_run_block():
    blocks = _run_blocks(_text())

    assert len(blocks) >= 9
    assert not any("${{" in block for block in blocks)
    assert not any("github.event" in block for block in blocks)


def test_commit_messages_and_file_names_never_reach_the_workflow_text():
    text = _text()

    for field in ("head_commit", "github.event.commits", "github.event.pusher", "client_payload"):
        assert field not in text


def test_authorization_checks_the_pusher_and_whoever_reruns_with_the_collaborator_endpoint():
    autorizar, _, _, _ = _jobs(_text())

    assert "ACTOR: ${{ github.actor }}" in autorizar
    assert "RELANZA: ${{ github.triggering_actor }}" in autorizar
    assert 'gh api "repos/$GITHUB_REPOSITORY/collaborators/$CUENTA/permission" --jq .permission' in autorizar
    assert "PERMISO=none" in autorizar
    assert "admin|maintain|write) ;;" in autorizar
    assert "*) permitido=false ;;" in autorizar
    assert "permitido: ${{ steps.permiso.outputs.permitido }}" in autorizar
    assert "actions/checkout" not in autorizar
    assert "contents: write" not in autorizar


def test_every_job_after_authorization_needs_it():
    _, recoger, procesar, publicar = _jobs(_text())

    assert "needs: autorizar\n    if: needs.autorizar.outputs.permitido == 'true'\n" in recoger
    assert "needs: [autorizar, recoger]\n" in procesar
    assert "needs: [autorizar, recoger, procesar]" in publicar
    for block in (procesar, publicar):
        assert CONDITION in block
        assert "always()" not in block


def test_collecting_reads_the_private_bucket_without_github_token_nor_installs_and_skips_pushes():
    _, recoger, _, _ = _jobs(_text())
    steps = _steps(recoger)
    with_secrets = [step for step in steps if "secrets.R2_" in step]

    assert "permissions:\n      contents: read\n" in recoger and "contents: write" not in recoger
    assert "GH_TOKEN" not in recoger and "github.token" not in recoger
    assert "pip install" not in recoger and "ffmpeg" not in recoger
    assert "persist-credentials: false" in recoger and "ref: main" in recoger
    assert len(with_secrets) == 1
    step = with_secrets[0]
    for name in R2_SECRETS:
        assert f"{name}: ${{{{ secrets.{name} }}}}" in step
    assert "R2_BUCKET:" not in step  # solo el privado
    assert step.index('"$GITHUB_REF_NAME" != "main"') < step.index("python scripts/entrada_r2.py recoger")
    assert '"$GITHUB_EVENT_NAME" = "push"' in step and 'echo "cantidad=0"' in step
    assert "cantidad: ${{ steps.recoger.outputs.cantidad }}" in recoger
    assert "ids: ${{ steps.recoger.outputs.ids }}" in recoger
    assert "actions/upload-artifact" in recoger and "name: buzon-entrada" in recoger


def test_processing_has_no_token_and_no_credentials_on_disk():
    _, _, procesar, _ = _jobs(_text())

    assert "permissions:\n      contents: read\n" in procesar
    assert "contents: write" not in procesar
    assert "GH_TOKEN" not in procesar and "github.token" not in procesar
    assert "secrets." not in procesar
    assert "persist-credentials: false" in procesar
    assert "scripts/buzon.py" in procesar and '--entrada "$RUNNER_TEMP/entrada"' in procesar
    assert "ACTION: buzon" in procesar and "scripts/empaquetar_cambios.py" in procesar
    assert "actions/upload-artifact" in procesar
    assert "name: buzon-entrada" in procesar and "actions/download-artifact" in procesar


def test_branch_guard_runs_before_any_code_of_the_tree_is_installed():
    _, _, procesar, _ = _jobs(_text())

    assert procesar.index('"$GITHUB_REF_NAME" != "main"') < procesar.index("pip install")


def test_publishing_validates_applies_regenerates_checks_limits_and_runs_no_processing_tool():
    _, _, _, publicar = _jobs(_text())
    steps = _steps(publicar)

    for tool in ("ffmpeg", "scripts/buzon.py", "sonidos.buzon", "pip install", "ci_library.py"):
        assert tool not in publicar
    assert "actions/download-artifact" in publicar
    aplicar = next(index for index, step in enumerate(steps) if "scripts/aplicar_paquete.py" in step)
    confirmar = next(index for index, step in enumerate(steps) if "git commit" in step)
    subir = next(index for index, step in enumerate(steps) if "git push" in step)
    limpiar = next(index for index, step in enumerate(steps) if "entrada_r2.py limpiar" in step)
    assert aplicar < confirmar < subir < limpiar
    assert steps[confirmar].index("scripts/check_repo_limits.py") < steps[confirmar].index("git commit")
    assert "permissions:\n      contents: write\n" in publicar
    assert "issues:" not in publicar


def test_publishing_checks_out_the_history_without_old_file_contents():
    # ADR-0025: hace falta el historial para saber si la base del paquete es un antecesor de main.
    for name in ("buzon.yml", "biblioteca.yml"):
        publicar = (WORKFLOWS / name).read_text(encoding="utf-8").split("\n  publicar:\n", 1)[1]
        checkout = next(step for step in _steps(publicar) if "actions/checkout" in step)
        assert "fetch-depth: 0" in checkout and "filter: blob:none" in checkout, name


def test_token_reaches_only_the_push_step_and_only_main_is_written():
    text = _text()
    _, _, _, publicar = _jobs(text)
    push_steps = [step for step in _steps(text) if "git push" in step]

    assert _token_violations(text) == []
    assert len(push_steps) == 1
    assert "GH_TOKEN: ${{ github.token }}" in push_steps[0]
    guard = push_steps[0].find('"$GITHUB_REF_NAME" != "main"')
    assert guard != -1 and guard < push_steps[0].index("git push")
    assert "https://x-access-token:${GH_TOKEN}@github.com/${GITHUB_REPOSITORY}.git" in push_steps[0]
    assert publicar.count("GH_TOKEN") == 2  # la declaración y el uso, en el mismo paso


def _push_step(name: str) -> str:
    text = (WORKFLOWS / name).read_text(encoding="utf-8")
    return next(step for step in _steps(text) if "git push" in step)


def test_a_rejected_push_is_rebased_on_main_and_retried_three_times_if_main_did_not_touch_the_library():
    for name in ("buzon.yml", "biblioteca.yml"):
        step = _push_step(name)
        assert "for intento in 1 2 3 4; do" in step, name
        assert 'git fetch -q --no-tags "$REMOTO" main' in step
        assert 'git merge-base --is-ancestor "$BASE" FETCH_HEAD' in step
        assert "git rebase -q FETCH_HEAD" in step and "git rebase --abort" in step
        assert step.index("git merge-base") < step.index("CHOQUE=") < step.index("git rebase -q")
        assert 'BASE=$(git rev-parse FETCH_HEAD)' in step
        assert "secrets." not in step and "python" not in step  # solo git, con el token y nada más


def test_the_push_step_protects_the_same_paths_as_the_package_validation():
    # La expresión del workflow y sonidos.paquete.ruta_de_publicacion deben coincidir (ADR-0025).
    for name in ("buzon.yml", "biblioteca.yml"):
        step = _push_step(name)
        pattern = re.search(r"PUBLICACION='([^']+)'", step).group(1)
        rutas = [
            "audio-library/indexes/catalog.json", "audio-library/indexes/catalog.json.bak",
            "audio-library/audio/S0123456789abcdef.opus", "audio-library/covers/F0123456789abcdef.jpg",
            "frontend/web/data/songs.json", "frontend/web/covers/S0123456789abcdef.jpg",
            "frontend/web/audio/S0123456789abcdef.opus", "audio-library/buzon/.partes/x/0.part",
            "audio-library/buzon/cancion.mp3", "frontend/web/js/app.js", "audio-library/audio-extra/x",
            "audio-library/indexes/otro.json", "docs/nota.md",
        ]
        for ruta in rutas:
            assert (re.search(pattern, ruta) is not None) == paquete.ruta_de_publicacion(ruta), (name, ruta)


def test_every_checkout_drops_its_credentials_and_reads_main():
    text = _text()

    assert text.count("uses: actions/checkout") == text.count("persist-credentials: false") == 3
    assert text.count("ref: main") == 3


def test_actions_are_pinned_to_the_same_commits_as_the_library_workflow():
    pins = set()
    for line in _text().splitlines():
        if "uses: " in line:
            assert re.search(r"@[0-9a-f]{40}\b", line), line
            pins.add(line.split("uses: ", 1)[1].split(" ", 1)[0])
    biblioteca = (WORKFLOWS / "biblioteca.yml").read_text(encoding="utf-8")

    assert pins and all(pin in biblioteca for pin in pins)


def test_permissions_are_declared_on_the_jobs_not_on_the_workflow():
    header, _, jobs = _text().partition("\njobs:")

    assert "permissions:" not in header
    assert jobs.count("permissions:") == 4


def test_the_library_workflow_is_unchanged_in_its_shape():
    # El buzón no cambia biblioteca.yml: sigue con sus tres jobs y su entrada por incidencias.
    text = (WORKFLOWS / "biblioteca.yml").read_text(encoding="utf-8")

    assert "types: [opened]" in text
    assert "audio-library/buzon" not in text


def test_the_mailbox_folder_exists_with_its_readme():
    # Sin comprobar que esté vacío: entre una subida y su procesado, el buzón de main tiene audio.
    assert (ROOT / "audio-library" / "buzon" / "README.md").is_file()


def test_runs_with_nothing_pending_skip_processing_and_publishing():
    autorizar, recoger, _, _ = _jobs(_text())
    assert "pendiente: ${{ steps.pendiente.outputs.pendiente }}" in autorizar
    assert "git/trees/main?recursive=1" in autorizar
    assert 'echo "pendiente=false"' in autorizar
    # Si no se puede leer main o el árbol viene truncado, se procesa: nunca se pierde una subida por la comprobación.
    assert 'echo "pendiente=true"' in autorizar
    assert 'TRUNCADO" = "true"' in autorizar
    # Lo pendiente en el bucket privado lo cuenta 'recoger': sin nada en ninguno de los dos, no se procesa.
    assert "if: steps.recoger.outputs.cantidad != '0'" in recoger


def test_the_collected_uploads_are_deleted_only_after_pushing_and_without_the_github_token():
    _, _, _, publicar = _jobs(_text())
    step = next(step for step in _steps(publicar) if "entrada_r2.py limpiar" in step)

    assert "if: needs.recoger.outputs.cantidad != '0'" in step
    assert "IDS: ${{ needs.recoger.outputs.ids }}" in step
    assert "GH_TOKEN" not in step and "git push" not in step and "pip install" not in step
    assert step.index('"$GITHUB_REF_NAME" != "main"') < step.index("python scripts/entrada_r2.py limpiar")
    for name in R2_SECRETS:
        assert f"{name}: ${{{{ secrets.{name} }}}}" in step
