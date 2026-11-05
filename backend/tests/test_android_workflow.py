"""Contrato de los disparadores de android.yml: todo cambio de mobile/ que llega a main se analiza, se prueba y
compila el APK de depuración (antes solo corría a mano o con una etiqueta android-v*)."""

from pathlib import Path

WORKFLOWS = Path(__file__).resolve().parents[2] / ".github" / "workflows"


def _text(name: str) -> str:
    return (WORKFLOWS / name).read_text(encoding="utf-8")


def _block(text: str, start: str, end: str) -> str:
    begin = text.index(start)
    return text[begin: text.index(end, begin + len(start))]


def test_android_runs_on_every_push_to_main_and_pull_request_that_touches_the_app():
    trigger = _block(_text("android.yml"), "\non:\n", "\npermissions:")
    push = _block(trigger, "\n  push:\n", "\n  pull_request:\n")
    pull_request = trigger[trigger.index("\n  pull_request:\n"):]

    assert "branches: [main]" in push
    assert '- "android-v*"' in push
    for section in (push, pull_request):
        assert '- "mobile/**"' in section
        assert '- ".github/workflows/android.yml"' in section
    assert "workflow_dispatch:" in trigger


def test_android_debug_job_analyzes_tests_and_builds_the_apk():
    text = _text("android.yml")
    debug = _block(text, "\n  depurar:\n", "\n  produccion:\n")

    for command in ("flutter analyze", "flutter test", "flutter build apk --debug", "scripts/android/verify_apk.sh"):
        assert command in debug
    assert "persist-credentials: false" in debug


def test_production_apk_only_on_demand_or_with_a_release_tag():
    text = _text("android.yml")
    production = _block(text, "\n  produccion:\n", "\n    steps:\n")

    assert "if: github.event_name == 'workflow_dispatch' || startsWith(github.ref, 'refs/tags/android-v')" in production


def test_flutter_is_not_duplicated_in_the_backend_workflow():
    text = _text("backend.yml")

    assert "subosito/flutter-action" not in text
    assert "flutter test" not in text and "flutter analyze" not in text
