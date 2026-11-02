import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

from sonidos.issue_request import (
    RequestError,
    parse_request,
    request_from_env,
    summarize,
    to_github_env,
    validate_payload,
    write_github_env,
)

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts" / "issue_request.py"
FOLDER = "0123456789"
SONG = "S0123456789abcdef"
IA_URL = "https://archive.org/details/charleston1925"
MP3_URL = "https://ejemplo.com/pistas/tema.mp3"
PLATFORMS = [
    "youtube.com", "youtu.be", "spotify.com", "music.apple.com", "soundcloud.com",
    "vimeo.com", "tiktok.com", "instagram.com", "facebook.com", "bandcamp.com",
]


def body(*lines: str) -> str:
    return "\n".join(lines)


def organize(payload: dict) -> str:
    return body("action: organize", "payload: " + json.dumps(payload))


def run_script(args: list[str], env: dict[str, str]) -> subprocess.CompletedProcess:
    base = {"PATH": os.environ.get("PATH", "")}
    base.update(env)
    return subprocess.run(
        [sys.executable, str(SCRIPT), *args],
        env=base, capture_output=True, text=True, cwd=str(ROOT), check=False,
    )


# --- Import: fuentes y licencia ----------------------------------------------------------------


def test_import_archive_details_is_accepted():
    request = parse_request(body("action: import", f"url: {IA_URL}"))

    assert request == {"action": "import", "url": IA_URL, "license": None, "title": None, "payload": None}


def test_import_archive_download_is_accepted():
    request = parse_request(body("action: import", "url: https://archive.org/download/charleston1925/"))

    assert request["url"] == "https://archive.org/download/charleston1925/"


def test_import_archive_download_with_a_file_is_accepted_without_license():
    url = "https://archive.org/download/charleston1925/charleston.mp3"

    request = parse_request(body("action: import", f"url: {url}"))

    assert request == {"action": "import", "url": url, "license": None, "title": None, "payload": None}


@pytest.mark.parametrize(
    "url",
    [
        "https://archive.org/download/charleston1925/a/b.mp3",
        "https://archive.org/download/../charleston.mp3",
        "https://archive.org/download/charleston1925/..",
        "https://archive.org/download/charleston..1925/charleston.mp3",
        "https://archive.org/details/charleston1925/charleston.mp3",
    ],
)
def test_archive_forms_outside_the_contract_are_refused_in_a_request(url):
    with pytest.raises(RequestError, match="forma archive.org"):
        parse_request(body("action: import", f"url: {url}"))


def test_internet_archive_file_server_is_refused_in_a_request():
    with pytest.raises(RequestError, match="archive.org/details"):
        parse_request(
            body("action: import", "url: https://ia800100.us.archive.org/download/charleston1925/charleston.mp3")
        )


def test_import_direct_audio_with_license_keeps_license_and_title():
    request = parse_request(body("action: import", f"url: {MP3_URL}", "license: CC0 1.0", "title: Un tema"))

    assert request["license"] == "CC0 1.0"
    assert request["title"] == "Un tema"


def test_import_without_url_is_refused():
    with pytest.raises(RequestError, match="necesita la clave url"):
        parse_request("action: import")


def test_import_direct_file_without_license_is_refused():
    with pytest.raises(RequestError, match="indicar la licencia"):
        parse_request(body("action: import", f"url: {MP3_URL}"))


@pytest.mark.parametrize("host", PLATFORMS)
def test_blocked_platform_is_refused(host):
    with pytest.raises(RequestError, match="no se puede importar"):
        parse_request(body("action: import", f"url: https://{host}/watch?v=abc"))


@pytest.mark.parametrize(
    "url",
    [
        "https://m.youtube.com/watch?v=abc",
        "https://es.soundcloud.com/artista/tema",
        "https://open.spotify.com/track/xyz",
        "https://www.tiktok.com/@usuario/video/1",
    ],
)
def test_blocked_subdomain_is_refused(url):
    with pytest.raises(RequestError, match="no se puede importar"):
        parse_request(body("action: import", f"url: {url}"))


@pytest.mark.parametrize(
    "host",
    [
        "youtube.com.",
        "www.youtube.com.",
        "ｙｏｕｔｕｂｅ.com",
        "youtube。com",
    ],
)
def test_blocked_platform_is_refused_whatever_the_spelling_of_the_host(host):
    with pytest.raises(RequestError, match="no se puede importar"):
        parse_request(body("action: import", f"url: https://{host}/tema.mp3", "license: CC0 1.0"))


def test_soft_hyphen_in_a_request_is_refused_as_a_format_character():
    # El guion blando es un carácter de formato: una petición no lo admite (el caso de plataforma con
    # guion blando se prueba con classify en test_sources.py).
    with pytest.raises(RequestError, match="caracteres de control"):
        parse_request(body("action: import", "url: https://youtu­.be/tema.mp3", "license: CC0"))


def test_lookalike_host_is_not_blocked_but_is_unsupported():
    with pytest.raises(RequestError, match="no soportada"):
        parse_request(body("action: import", "url: https://youtube.com.ejemplo.org/tema.html", "license: CC0"))


def test_archive_identifier_cannot_escape_the_staging_folder():
    with pytest.raises(RequestError, match="forma archive.org"):
        parse_request(body("action: import", "url: https://archive.org/details/.."))


def test_url_with_spaces_is_refused():
    with pytest.raises(RequestError, match="espacios"):
        parse_request(body("action: import", "url: https://ejemplo.com/mi tema.mp3", "license: CC0"))


def test_import_rejects_payload():
    with pytest.raises(RequestError, match="import no admite payload"):
        parse_request(body("action: import", f"url: {IA_URL}", 'payload: {"op":"delete_folder"}'))


# --- Formato de la petición --------------------------------------------------------------------


def test_unknown_key_is_refused():
    with pytest.raises(RequestError, match="clave desconocida: comentario"):
        parse_request(body("action: import", f"url: {IA_URL}", "comentario: hola"))


def test_repeated_key_is_refused():
    with pytest.raises(RequestError, match="clave repetida: url"):
        parse_request(body("action: import", f"url: {IA_URL}", f"url: {IA_URL}"))


def test_unknown_action_is_refused_and_publish_no_longer_exists():
    with pytest.raises(RequestError, match="acción desconocida"):
        parse_request(body("action: publish", f"url: {IA_URL}"))


def test_missing_action_is_refused():
    with pytest.raises(RequestError, match="falta la clave action"):
        parse_request(f"url: {IA_URL}")


def test_lines_without_colon_are_ignored():
    request = parse_request(body("Hola, quiero importar esto", "action: import", f"url: {IA_URL}", "gracias"))

    assert request["url"] == IA_URL


def test_empty_value_counts_as_absent_for_optional_keys():
    request = parse_request(body("action: import", f"url: {IA_URL}", "license:", "title:", "payload:"))

    assert request["license"] is None and request["title"] is None


def test_empty_url_counts_as_missing():
    with pytest.raises(RequestError, match="necesita la clave url"):
        parse_request(body("action: import", "url:   "))


def test_control_characters_in_values_are_refused():
    with pytest.raises(RequestError, match="caracteres de control"):
        parse_request(body("action: import", f"url: {IA_URL}", "title: uno\tdos"))


def test_crlf_line_endings_are_accepted():
    request = parse_request(f"action: import\r\nurl: {IA_URL}\r\n")

    assert request["url"] == IA_URL


def test_body_limit_is_8000_characters():
    prefix = body("action: import", f"url: {IA_URL}") + "\n"
    accepted = prefix + "x" * (8000 - len(prefix))

    assert len(accepted) == 8000
    assert parse_request(accepted)["url"] == IA_URL
    with pytest.raises(RequestError, match="8000 caracteres"):
        parse_request(accepted + "x")


def test_url_of_exactly_2048_characters_is_accepted():
    url = "https://ejemplo.com/" + "a" * (2048 - len("https://ejemplo.com/.mp3")) + ".mp3"
    assert len(url) == 2048

    request = parse_request(body("action: import", f"url: {url}", "license: CC0"))

    assert request["url"] == url


def test_url_longer_than_2048_characters_is_refused():
    url = "https://ejemplo.com/" + "a" * (2049 - len("https://ejemplo.com/.mp3")) + ".mp3"
    assert len(url) == 2049

    with pytest.raises(RequestError, match="url supera los 2048 caracteres"):
        parse_request(body("action: import", f"url: {url}", "license: CC0"))


def test_license_longer_than_300_characters_is_refused():
    with pytest.raises(RequestError, match="license supera los 300 caracteres"):
        parse_request(body("action: import", f"url: {MP3_URL}", f"license: {'L' * 301}"))


def test_title_longer_than_200_characters_is_refused():
    with pytest.raises(RequestError, match="title supera los 200 caracteres"):
        parse_request(body("action: import", f"url: {MP3_URL}", "license: CC0", f"title: {'T' * 201}"))


def test_payload_length_limit_is_4000_characters():
    raw = json.dumps({"op": "create_folder", "name": "n" * 4000}, ensure_ascii=False, separators=(",", ":"))
    assert len(raw) > 4000
    with pytest.raises(RequestError, match="payload supera los 4000 caracteres"):
        parse_request(body("action: organize", "payload: " + raw))


# --- Organize: forma y operaciones -------------------------------------------------------------


@pytest.mark.parametrize("key", ["url", "license", "title"])
def test_organize_with_url_license_or_title_is_refused(key):
    with pytest.raises(RequestError, match=f"organize no admite la clave {key}"):
        parse_request(body("action: organize", f"{key}: algo", f"payload: {json.dumps({'op': 'delete_folder', 'folder_id': FOLDER})}"))


def test_organize_with_url_present_and_payload_is_refused():
    with pytest.raises(RequestError, match="organize no admite la clave url"):
        parse_request(body("action: organize", f"url: {IA_URL}", f'payload: {{"op":"delete_folder","folder_id":"{FOLDER}"}}'))


def test_organize_without_payload_is_refused():
    with pytest.raises(RequestError, match="necesita la clave payload"):
        parse_request("action: organize")


def test_payload_that_is_not_json_is_refused():
    with pytest.raises(RequestError, match="no es JSON válido"):
        parse_request(body("action: organize", 'payload: {"op": "delete_folder"'))


def test_multiline_payload_is_refused():
    with pytest.raises(RequestError):
        parse_request(body("action: organize", "payload: {", '  "op": "delete_folder",', f'  "folder_id": "{FOLDER}"', "}"))


def test_payload_that_is_a_list_is_refused():
    with pytest.raises(RequestError, match="objeto JSON"):
        parse_request(body("action: organize", 'payload: [{"op": "delete_folder"}]'))


def test_payload_with_duplicate_keys_is_refused():
    with pytest.raises(RequestError, match="clave repetida en el payload"):
        parse_request(body("action: organize", f'payload: {{"op":"delete_folder","op":"edit_song","folder_id":"{FOLDER}"}}'))


def test_unknown_operation_is_refused():
    with pytest.raises(RequestError, match="operación desconocida"):
        parse_request(organize({"op": "drop_catalog"}))


def test_operation_must_be_a_string():
    with pytest.raises(RequestError, match="operación desconocida"):
        validate_payload({"op": ["edit_song"]})


def test_unknown_field_in_edit_song_is_refused():
    with pytest.raises(RequestError, match="campo desconocido en edit_song: sha256"):
        parse_request(organize({"op": "edit_song", "song_id": SONG, "public": True, "sha256": "x"}))


def test_edit_song_without_any_change_is_refused():
    with pytest.raises(RequestError, match="al menos un campo que cambiar"):
        parse_request(organize({"op": "edit_song", "song_id": SONG}))


@pytest.mark.parametrize(
    "payload",
    [
        {"op": "rename_folder", "folder_id": "ABCDEF0123", "name": "x"},
        {"op": "delete_folder", "folder_id": "0123456789a"},
        {"op": "create_folder", "name": "x", "parent_id": "zzzzzzzzzz"},
        {"op": "edit_song", "song_id": "S0123456789ABCDEF", "public": True},
        {"op": "edit_song", "song_id": "0123456789abcdef", "public": True},
        {"op": "edit_song", "song_id": "S0123456789abcdef\n", "public": True},
        {"op": "edit_song", "song_id": SONG, "folder_id": "0123456789\n", "public": True},
    ],
)
def test_folder_and_song_ids_must_match_their_format(payload):
    with pytest.raises(RequestError, match="id de"):
        parse_request(organize(payload))


@pytest.mark.parametrize("year", [999, 2101, "1925", True, 1925.5])
def test_year_must_be_an_integer_in_range(year):
    with pytest.raises(RequestError, match="year debe ser un entero"):
        parse_request(organize({"op": "edit_song", "song_id": SONG, "year": year}))


@pytest.mark.parametrize("year", [1000, 2100, None])
def test_year_limits_and_null_are_accepted(year):
    payload = validate_payload({"op": "edit_song", "song_id": SONG, "year": year})

    assert payload["year"] == year


@pytest.mark.parametrize("public", ["true", "false", 1, 0, None])
def test_public_must_be_a_json_boolean(public):
    with pytest.raises(RequestError, match="public debe ser true o false"):
        parse_request(organize({"op": "edit_song", "song_id": SONG, "public": public}))


def test_edit_song_public_true_is_accepted():
    request = parse_request(organize({"op": "edit_song", "song_id": SONG, "public": True}))

    assert request["payload"] == {"op": "edit_song", "song_id": SONG, "public": True}


def test_tags_are_normalized_and_deduplicated():
    payload = validate_payload({"op": "edit_song", "song_id": SONG, "tags": ["Jazz", " jazz ", "Años 20", ""]})

    assert payload["tags"] == ["jazz", "años 20"]


def test_tags_limits_are_enforced():
    with pytest.raises(RequestError, match="como máximo 20"):
        validate_payload({"op": "edit_song", "song_id": SONG, "tags": [f"t{i}" for i in range(21)]})
    with pytest.raises(RequestError, match="como máximo 40"):
        validate_payload({"op": "edit_song", "song_id": SONG, "tags": ["x" * 41]})
    assert len(validate_payload({"op": "edit_song", "song_id": SONG, "tags": [f"t{i}" for i in range(20)]})["tags"]) == 20


def test_tags_must_be_a_list_of_strings():
    with pytest.raises(RequestError, match="lista de cadenas"):
        validate_payload({"op": "edit_song", "song_id": SONG, "tags": "jazz, blues"})
    with pytest.raises(RequestError, match="debe ser una cadena"):
        validate_payload({"op": "edit_song", "song_id": SONG, "tags": [1925]})


def test_edit_song_text_fields_have_their_limits():
    with pytest.raises(RequestError, match="title no puede estar vacío"):
        validate_payload({"op": "edit_song", "song_id": SONG, "title": "   "})
    with pytest.raises(RequestError, match="title supera los 200"):
        validate_payload({"op": "edit_song", "song_id": SONG, "title": "t" * 201})
    with pytest.raises(RequestError, match="artist supera los 200"):
        validate_payload({"op": "edit_song", "song_id": SONG, "artist": "a" * 201})
    with pytest.raises(RequestError, match="title debe ser texto"):
        validate_payload({"op": "edit_song", "song_id": SONG, "title": 5})


def test_edit_song_accepts_null_folder_and_empty_artist():
    payload = validate_payload({"op": "edit_song", "song_id": SONG, "folder_id": None, "artist": "  "})

    assert payload == {"op": "edit_song", "song_id": SONG, "folder_id": None, "artist": ""}


def test_create_folder_name_limits_and_null_parent():
    with pytest.raises(RequestError, match="name no puede estar vacío"):
        validate_payload({"op": "create_folder", "name": "   "})
    with pytest.raises(RequestError, match="name supera los 80"):
        validate_payload({"op": "create_folder", "name": "n" * 81})
    payload = validate_payload({"op": "create_folder", "name": "  Jazz  ", "parent_id": None})

    assert payload == {"op": "create_folder", "name": "Jazz", "parent_id": None}


def test_rename_and_delete_folder_are_accepted():
    renamed = validate_payload({"op": "rename_folder", "folder_id": FOLDER, "name": "Blues"})
    deleted = validate_payload({"op": "delete_folder", "folder_id": FOLDER})

    assert renamed == {"op": "rename_folder", "folder_id": FOLDER, "name": "Blues"}
    assert deleted == {"op": "delete_folder", "folder_id": FOLDER}


def test_payload_must_include_op():
    with pytest.raises(RequestError, match="falta el campo op"):
        validate_payload({"name": "x"})


# --- Entorno de GitHub y ejecución por subproceso ----------------------------------------------


def test_to_github_env_puts_compact_payload_on_one_line():
    request = parse_request(organize({"op": "edit_song", "song_id": SONG, "tags": ["Jazz"], "public": True}))

    env = to_github_env(request)

    assert env["ACTION"] == "organize" and env["URL"] == "" and env["LICENSE"] == "" and env["TITLE"] == ""
    assert "\n" not in env["PAYLOAD"] and " " not in env["PAYLOAD"]
    assert json.loads(env["PAYLOAD"]) == request["payload"]


def test_to_github_env_for_import_has_empty_payload():
    env = to_github_env(parse_request(body("action: import", f"url: {IA_URL}")))

    assert env == {"ACTION": "import", "URL": IA_URL, "LICENSE": "", "TITLE": "", "PAYLOAD": ""}


def test_write_github_env_rejects_line_breaks(tmp_path):
    destination = tmp_path / "github_env"

    for value in ("a\nb", "a\rb", "uno\n", "dos\r\n"):
        with pytest.raises(RequestError, match="salto de línea"):
            write_github_env(destination, {"TITLE": value})
    assert not destination.exists()


def test_write_github_env_appends_key_value_lines(tmp_path):
    destination = tmp_path / "github_env"
    destination.write_text("PREVIA=1\n", encoding="utf-8")

    write_github_env(destination, {"ACTION": "import", "TITLE": "Tema: con dos puntos"})

    assert destination.read_text(encoding="utf-8") == "PREVIA=1\nACTION=import\nTITLE=Tema: con dos puntos\n"


def test_request_from_env_builds_the_same_request_as_the_text():
    manual = request_from_env({"ACTION": "import", "URL": IA_URL, "LICENSE": "", "TITLE": "", "PAYLOAD": ""})

    assert manual == parse_request(body("action: import", f"url: {IA_URL}"))


def test_manual_mode_skips_empty_inputs_so_organize_is_not_refused():
    request = request_from_env({
        "ACTION": "organize", "URL": "", "LICENSE": "", "TITLE": "",
        "PAYLOAD": json.dumps({"op": "delete_folder", "folder_id": FOLDER}),
    })

    assert request["payload"] == {"op": "delete_folder", "folder_id": FOLDER}


def test_manual_values_with_line_breaks_are_refused():
    with pytest.raises(RequestError, match="PAYLOAD contiene un salto de línea"):
        request_from_env({"ACTION": "organize", "PAYLOAD": '{"op":"delete_folder",\n"folder_id":"0123456789"}'})


def test_script_in_incidencia_mode_writes_github_env_and_prints_summary(tmp_path):
    github_env = tmp_path / "github_env"
    text = organize({"op": "edit_song", "song_id": SONG, "public": True, "title": "Secreto de ejemplo"})

    result = run_script(["--modo", "incidencia"], {"BODY": text, "GITHUB_ENV": str(github_env)})

    assert result.returncode == 0, result.stdout + result.stderr
    lines = github_env.read_text(encoding="utf-8").splitlines()
    assert lines[0] == "ACTION=organize"
    assert lines[4].startswith("PAYLOAD=") and json.loads(lines[4][len("PAYLOAD="):])["public"] is True
    summary = json.loads(result.stdout)
    assert summary == {
        "action": "organize", "url": None, "title": None, "op": "edit_song",
        "campos": ["public", "song_id", "title"],
    }
    assert SONG not in result.stdout and "Secreto de ejemplo" not in result.stdout


def test_script_error_prints_json_exits_1_and_writes_nothing(tmp_path):
    github_env = tmp_path / "github_env"

    result = run_script(["--modo", "incidencia"], {"BODY": "action: import", "GITHUB_ENV": str(github_env)})

    assert result.returncode == 1
    assert json.loads(result.stdout) == {"error": "import necesita la clave url"}
    assert not github_env.exists()


def test_script_manual_mode_reads_the_environment(tmp_path):
    github_env = tmp_path / "github_env"
    env = {
        "ACTION": "import", "URL": IA_URL, "LICENSE": "", "TITLE": "Charleston", "PAYLOAD": "",
        "GITHUB_ENV": str(github_env),
    }

    result = run_script(["--modo", "manual"], env)

    assert result.returncode == 0, result.stdout + result.stderr
    assert "TITLE=Charleston" in github_env.read_text(encoding="utf-8").splitlines()


def test_script_refuses_to_run_without_github_env():
    result = run_script(["--modo", "incidencia"], {"BODY": f"action: import\nurl: {IA_URL}"})

    assert result.returncode == 1
    assert "GITHUB_ENV" in json.loads(result.stdout)["error"]


# --- Corrección de la ronda 2 (2026-11-02) -----------------------------------------------------


def test_title_with_bidi_override_or_zero_width_characters_is_refused():
    for title in ("Hola‮mundo", "Hola​mundo"):
        with pytest.raises(RequestError, match="caracteres de control"):
            parse_request(body("action: import", f"url: {MP3_URL}", "license: CC0", f"title: {title}"))


def test_summary_never_shows_the_query_of_the_url():
    # Las firmas temporales de un enlace no deben salir en el registro del workflow ni en el comentario.
    request = parse_request(
        body("action: import", "url: https://files.example/a.mp3?X-Amz-Signature=SECRETO123", "license: CC0")
    )

    summary = summarize(request)

    assert summary["url"] == "https://files.example/a.mp3"
    assert "SECRETO123" not in json.dumps(summary)
