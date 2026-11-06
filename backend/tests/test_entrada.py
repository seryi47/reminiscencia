"""Subidas de la web y la APK en el bucket privado de R2 (ADR-0024): recoger (job 'recoger'), unir y procesar en el
buzón sin tocar Git (job 'procesar') y limpiar (job 'publicar'). Con buckets en memoria, ffmpeg real y git real."""

import hashlib
import importlib.util
import json
import re
import subprocess
from pathlib import Path

import pytest

from conftest import make_tone
from sonidos import buzon, entrada, paquete
from sonidos.buzon import procesar_buzon
from sonidos.r2 import R2Error
from test_r2 import ENV, FakeBucket, FakeS3

ROOT = Path(__file__).resolve().parents[2]
UPLOAD_A = "0f8fad5b-d9cb-469f-a165-70867728950e"
UPLOAD_B = "1b4e28ba-2fa1-41d2-883f-0016d3cca427"
BUZON = "audio-library/buzon"


def _subida(upload_id: str, data: bytes, partes: int, *, manifiesto: object = True, nombre: str = "Vals.opus",
            extra: dict | None = None) -> dict[str, bytes]:
    """Objetos del bucket privado de una subida, como los escribe /api/subir."""
    size = -(-len(data) // partes)
    objects = {f"entrada/{upload_id}/{index}.part": data[index * size:(index + 1) * size] for index in range(partes)}
    if manifiesto is True:
        manifiesto = {"nombre": nombre, "partes": partes, **(extra or {})}
    if manifiesto is not None:
        objects[f"entrada/{upload_id}/manifiesto.json"] = json.dumps(manifiesto).encode()
    return objects


def test_the_formats_are_the_same_as_the_mailbox():
    assert entrada.UPLOAD_ID.pattern == buzon._UPLOAD_ID.pattern
    assert entrada.PART_NAME.pattern == buzon._PART_NAME.pattern
    assert entrada.MAX_MANIFEST_BYTES == buzon.MAX_MANIFEST_BYTES
    assert entrada.MAX_UPLOAD_BYTES == buzon.MAX_FILE_BYTES


def test_part_limit_is_the_largest_chunk_that_api_subir_accepts():
    # El Worker de Cloudflare (ADR-0029) admite trozos de 32 MiB; Vercel, de 4 MiB. El bucket recoge los dos.
    config = (ROOT / "frontend" / "web" / "js" / "api-config.js").read_text(encoding="utf-8")
    sizes = {
        name: int(mib) * 1024 * 1024
        for name, mib in re.findall(r"export const (\w+_CHUNK_BYTES) = (\d+) \* 1024 \* 1024;", config)
    }
    assert sizes == {"VERCEL_CHUNK_BYTES": 4 * 1024 * 1024, "WORKER_CHUNK_BYTES": 32 * 1024 * 1024}
    assert entrada.MAX_PART_BYTES == max(sizes.values())


def test_only_complete_and_well_formed_uploads_are_collected():
    listing = {
        **{key: len(value) for key, value in _subida(UPLOAD_A, b"abcdef", 2).items()},
        **{key: len(value) for key, value in _subida(UPLOAD_B, b"abcdef", 2, manifiesto=None).items()},  # en curso
        "entrada/no-es-un-uuid/0.part": 3,
        "entrada/2c4e28ba-2fa1-41d2-883f-0016d3cca427/manifiesto.json": 10,
        "entrada/2c4e28ba-2fa1-41d2-883f-0016d3cca427/notas.txt": 3,  # algo que /api/subir no escribe
        "entrada/3d4e28ba-2fa1-41d2-883f-0016d3cca427/manifiesto.json": 10,
        "entrada/3d4e28ba-2fa1-41d2-883f-0016d3cca427/0.part": entrada.MAX_PART_BYTES + 1,
        "audio/S0123456789abcdef.opus": 9,
    }
    complete, broken = entrada.complete_uploads(listing)
    assert list(complete) == [UPLOAD_A]
    assert broken == ["2c4e28ba-2fa1-41d2-883f-0016d3cca427", "3d4e28ba-2fa1-41d2-883f-0016d3cca427"]


def test_collect_downloads_complete_uploads_and_respects_the_limits(tmp_path):
    bucket = FakeBucket({**_subida(UPLOAD_A, b"abcdef", 2), **_subida(UPLOAD_B, b"ghij", 1)})

    result = entrada.collect(bucket, tmp_path / "salida", max_uploads=1)

    assert result["recogidas"] == [UPLOAD_A] and result["pendientes"] == 1
    assert (tmp_path / "salida" / UPLOAD_A / "0.part").read_bytes() == b"abc"
    assert json.loads((tmp_path / "salida" / UPLOAD_A / "manifiesto.json").read_text()) == {"nombre": "Vals.opus",
                                                                                           "partes": 2}
    assert bucket.deleted == [] and bucket.put_keys == []  # recoger solo lee


def test_valid_ids_only_accepts_uuids():
    assert entrada.valid_ids(f" {UPLOAD_A}  {UPLOAD_B}\n") == [UPLOAD_A, UPLOAD_B]
    assert entrada.valid_ids("") == []
    for raw in ("../audio", f"{UPLOAD_A} *", "audio/S0123456789abcdef.opus"):
        with pytest.raises(R2Error):
            entrada.valid_ids(raw)


def test_cleanup_deletes_only_inside_the_collected_uploads():
    bucket = FakeBucket({**_subida(UPLOAD_A, b"abcdef", 2), **_subida(UPLOAD_B, b"ghij", 1),
                         "audio/S0123456789abcdef.opus": b"x"})

    assert entrada.cleanup(bucket, [UPLOAD_A]) == 3

    assert sorted(bucket.objects) == ["audio/S0123456789abcdef.opus", *sorted(_subida(UPLOAD_B, b"ghij", 1))]


# --- scripts/entrada_r2.py ------------------------------------------------------------------------------------------

def _script():
    spec = importlib.util.spec_from_file_location("entrada_r2_under_test", ROOT / "scripts" / "entrada_r2.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_script_collects_and_writes_the_job_outputs(tmp_path, capsys):
    s3 = FakeS3({"privado": {**_subida(UPLOAD_A, b"abcdef", 2), **_subida(UPLOAD_B, b"ghij", 1)}})
    output = tmp_path / "github_output"

    assert _script().main(["recoger", "--salida", str(tmp_path / "e")], env={**ENV, "GITHUB_OUTPUT": str(output)},
                          client=s3) == 0

    assert output.read_text() == f"cantidad=2\nids={UPLOAD_A} {UPLOAD_B}\n"
    assert sorted(path.name for path in (tmp_path / "e").iterdir()) == [UPLOAD_A, UPLOAD_B]
    assert len(s3.buckets["privado"]) == 5  # no borra nada


def test_script_with_nothing_pending_says_zero(tmp_path):
    output = tmp_path / "github_output"
    assert _script().main(["recoger", "--salida", str(tmp_path / "e")], env={**ENV, "GITHUB_OUTPUT": str(output)},
                          client=FakeS3({"privado": {}})) == 0
    assert output.read_text() == "cantidad=0\nids=\n"


def test_script_cleans_up_the_ids_it_is_given_and_refuses_anything_else(tmp_path, capsys):
    s3 = FakeS3({"privado": {**_subida(UPLOAD_A, b"abcdef", 2), "audio/S0123456789abcdef.opus": b"x"}})

    assert _script().main(["limpiar"], env={**ENV, "IDS": "../audio"}, client=s3) == 1
    assert len(s3.buckets["privado"]) == 4
    assert _script().main(["limpiar"], env={**ENV, "IDS": UPLOAD_A}, client=s3) == 0
    assert list(s3.buckets["privado"]) == ["audio/S0123456789abcdef.opus"]


def test_script_needs_the_private_bucket(tmp_path, capsys):
    env = {key: value for key, value in ENV.items() if key != "R2_PRIVATE_BUCKET"}
    assert _script().main(["recoger", "--salida", str(tmp_path / "e")], env=env) == 1
    assert "R2_PRIVATE_BUCKET" in capsys.readouterr().out


# --- El buzón une las subidas recogidas (job 'procesar') ---------------------------------------------------------------

@pytest.fixture
def opus_bytes(tmp_path: Path) -> bytes:
    return make_tone(tmp_path / "fuente" / "tono.opus", seconds=2.0, sample_rate=48000).read_bytes()


def _git(repo: Path, *args: str) -> str:
    return subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True, text=True).stdout


@pytest.fixture
def repo(main_publicado: Path) -> Path:
    (main_publicado / BUZON).mkdir(parents=True)
    (main_publicado / BUZON / "README.md").write_text("buzón\n", encoding="utf-8")
    _git(main_publicado, "add", "-A")
    _git(main_publicado, "-c", "user.name=p", "-c", "user.email=p@example.invalid", "commit", "-qm", "buzón")
    return main_publicado


def _recogidas(tmp_path: Path, objects: dict[str, bytes]) -> Path:
    destination = tmp_path / "recogidas"
    entrada.collect(FakeBucket(objects), destination)
    return destination


def test_uploads_from_the_bucket_enter_public_with_the_web_license_and_leave_git_untouched(repo, tmp_path, opus_bytes):
    origen = _recogidas(tmp_path, _subida(UPLOAD_A, opus_bytes, 3, extra={"artist": "Artista"}))

    result = procesar_buzon(repo=repo, event={}, actor="seryi47", entrada=origen, solo_entrada=True)

    [cancion] = result["publicas"]
    assert cancion["archivo"] == "Vals.opus" and cancion["licencia"] == buzon.WEB_LICENSE
    data = json.loads((repo / "audio-library/indexes/catalog.json").read_text(encoding="utf-8"))
    song = next(song for song in data["songs"] if song["id"] == cancion["song_id"])
    assert song["sha256"] == hashlib.sha256(opus_bytes).hexdigest() and song["artist"] == "Artista"
    assert song["source"] == "Subida por seryi47" and song["public"] is True
    assert result["subidas_web"] == [UPLOAD_A]
    assert not (repo / BUZON / "Vals.opus").exists()

    package = tmp_path / "paquete"
    paquete.package_processing_changes(repo, package, action="buzon")
    manifest = json.loads((package / "manifiesto.json").read_text(encoding="utf-8"))
    rutas = {item["ruta"] for item in manifest["cambios"]}
    assert rutas == {"audio-library/indexes/catalog.json", f"audio-library/audio/{cancion['song_id']}.opus"}


def test_a_dispatch_run_does_not_take_the_files_someone_uploaded_through_github(repo, tmp_path, opus_bytes):
    # Una subida por la página de GitHub espera su propio run, con la licencia de su commit.
    make_tone(repo / BUZON / "Pendiente.wav", seconds=1.0)
    _git(repo, "add", "-A")
    _git(repo, "-c", "user.name=p", "-c", "user.email=p@example.invalid", "commit", "-qm", "Licencia: CC0")
    origen = _recogidas(tmp_path, _subida(UPLOAD_A, opus_bytes, 2))

    result = procesar_buzon(repo=repo, event={}, actor="seryi47", entrada=origen, solo_entrada=True)

    assert [item["archivo"] for item in result["publicas"]] == ["Vals.opus"] and result["privadas"] == []
    assert (repo / BUZON / "Pendiente.wav").exists()


def test_an_upload_that_cannot_be_joined_is_rejected_not_left_to_review(repo, tmp_path, opus_bytes):
    objects = _subida(UPLOAD_A, opus_bytes, 3)
    del objects[f"entrada/{UPLOAD_A}/1.part"]
    objects.update(_subida(UPLOAD_B, opus_bytes, 1, manifiesto={"nombre": "../x.opus", "partes": 1}))
    origen = _recogidas(tmp_path, objects)

    result = procesar_buzon(repo=repo, event={}, actor="seryi47", entrada=origen, solo_entrada=True)

    assert result["revisar"] == []
    assert {item["archivo"]: item["motivo"] for item in result["rechazados"]} == {
        f"entrada/{UPLOAD_A}": "faltan 1 de 3 partes",
        f"entrada/{UPLOAD_B}": "el manifiesto de partes no es válido",
    }
    assert _git(repo, "status", "--porcelain") == ""


def test_the_job_script_reads_the_event_name_and_the_collected_folder(repo, tmp_path, opus_bytes):
    spec = importlib.util.spec_from_file_location("buzon_script_under_test", ROOT / "scripts" / "buzon.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    make_tone(repo / BUZON / "Pendiente.wav", seconds=1.0)
    event = tmp_path / "evento.json"
    event.write_text(json.dumps({"action": "subida-web", "client_payload": {"id": UPLOAD_A}}), encoding="utf-8")
    origen = _recogidas(tmp_path, _subida(UPLOAD_A, opus_bytes, 2))
    env = {"ACTOR": "seryi47", "GITHUB_EVENT_PATH": str(event), "GITHUB_EVENT_NAME": "repository_dispatch"}

    assert module.main(["--resultado", str(tmp_path / "r.json"), "--entrada", str(origen)], env=env, root=repo) == 0

    result = json.loads((tmp_path / "r.json").read_text(encoding="utf-8"))
    assert [item["archivo"] for item in result["publicas"]] == ["Vals.opus"]
    assert (repo / BUZON / "Pendiente.wav").exists()  # no se procesa sin su commit
    assert module.main(["--resultado", str(tmp_path / "r2.json"), "--entrada", str(tmp_path / "no-existe")],
                       env=env, root=repo) == 0
