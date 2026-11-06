"""Subidas de la web y la APK en el bucket privado de R2 (ADR-0024): recoger (job 'recoger'), unir y procesar en el
buzón sin tocar Git (job 'procesar') y limpiar (job 'publicar'). Con buckets en memoria, ffmpeg real y git real."""

import hashlib
import importlib.util
import json
import subprocess
from datetime import datetime, timezone
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
    assert entrada.ORDER_FILE == buzon.ENTRY_ORDER_FILE


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


UPLOAD_C = "2c4e28ba-2fa1-41d2-883f-0016d3cca427"


def _manifest_dates(**dates: str) -> dict[str, str]:
    return {f"entrada/{upload_id}/manifiesto.json": when for upload_id, when in dates.items()}


def test_collect_takes_every_complete_upload_in_arrival_order_and_writes_it(tmp_path):
    # ADR-0030: una ejecución recoge todo lo completo, no solo la subida de su aviso, por orden de llegada (la fecha del
    # manifiesto, que se escribe con el último trozo), no por UUID.
    objects = {**_subida(UPLOAD_A, b"abcdef", 2), **_subida(UPLOAD_B, b"ghij", 1), **_subida(UPLOAD_C, b"kl", 1)}
    dates = {UPLOAD_A: "2026-11-06T09:08:21.500Z", UPLOAD_B: "2026-11-06T09:08:19Z", UPLOAD_C: "2026-11-06T09:08:21.2Z"}
    bucket = FakeBucket(objects, modified=_manifest_dates(**dates))

    result = entrada.collect(bucket, tmp_path / "salida")

    assert result["recogidas"] == [UPLOAD_B, UPLOAD_C, UPLOAD_A] and result["pendientes"] == 0
    assert json.loads((tmp_path / "salida" / entrada.ORDER_FILE).read_text()) == {"subidas": [UPLOAD_B, UPLOAD_C,
                                                                                               UPLOAD_A]}


def test_the_cap_per_run_takes_the_oldest_first_and_leaves_the_rest_for_the_next_run(tmp_path):
    objects = {**_subida(UPLOAD_A, b"abcdef", 2), **_subida(UPLOAD_B, b"ghij", 1), **_subida(UPLOAD_C, b"kl", 1)}
    dates = {UPLOAD_A: "2026-11-06T09:00:03Z", UPLOAD_B: "2026-11-06T09:00:01Z", UPLOAD_C: "2026-11-06T09:00:02Z"}
    bucket = FakeBucket(objects, modified=_manifest_dates(**dates))

    first = entrada.collect(bucket, tmp_path / "uno", max_uploads=2)
    assert first["recogidas"] == [UPLOAD_B, UPLOAD_C] and first["pendientes"] == 1
    entrada.cleanup(bucket, first["recogidas"])  # 'publicar' borra solo lo que recogió esta ejecución
    second = entrada.collect(bucket, tmp_path / "dos", max_uploads=2)
    assert second["recogidas"] == [UPLOAD_A] and second["pendientes"] == 0
    entrada.cleanup(bucket, second["recogidas"])
    third = entrada.collect(bucket, tmp_path / "tres", max_uploads=2)
    assert third["recogidas"] == [] and not (tmp_path / "tres" / entrada.ORDER_FILE).exists()


def test_arrival_order_tolerates_missing_or_odd_dates():
    complete = {UPLOAD_A: {}, UPLOAD_B: {}, UPLOAD_C: {}}
    # Sin fecha (o ilegible) va primero y por UUID; las fechas con zona horaria se comparan en UTC.
    modified = _manifest_dates(**{UPLOAD_A: "2026-11-06T10:00:00+01:00", UPLOAD_B: "2026-11-06T09:30:00Z",
                                  UPLOAD_C: "no es una fecha"})
    assert entrada.arrival_order(complete, modified) == [UPLOAD_C, UPLOAD_A, UPLOAD_B]


# UUID versión 7 (RFC 9562) como los de la web y la APK: los 48 primeros bits son milisegundos Unix y, si coinciden, el
# contador de los 12 bits siguientes desempata.
V7_FIRST = "019a5b2c-3d4e-7000-8a1b-2c3d4e5f6a7b"
V7_SECOND = "019a5b2c-3d4e-7001-9a1b-2c3d4e5f6a7b"
V7_THIRD = "019a5b2c-3d4f-7000-ba1b-2c3d4e5f6a7b"


def test_uuid7_ms_reads_the_client_time_only_from_version_7():
    assert entrada.uuid7_ms(V7_FIRST) == 0x019A5B2C3D4E
    assert entrada.uuid7_ms(UPLOAD_A) is None  # versión 4
    assert entrada.uuid7_ms("019a5b2c-3d4e-7000-0a1b-2c3d4e5f6a7b") is None  # variante que no es la de RFC 9562
    assert entrada.uuid7_ms("../a") is None


def test_queue_order_follows_the_client_queue_even_if_uploads_completed_out_of_order(tmp_path):
    # Dos envíos a la vez: la tercera de la cola terminó antes que la primera. El orden es el de la cola (UUID v7), y
    # una subida de un cliente anterior (v4) cuenta con la fecha de su manifiesto.
    objects = {**_subida(V7_FIRST, b"abcdef", 2), **_subida(V7_SECOND, b"ghij", 1), **_subida(V7_THIRD, b"kl", 1),
               **_subida(UPLOAD_A, b"mn", 1)}
    first_ms = 0x019A5B2C3D4E
    iso = lambda ms: datetime.fromtimestamp(ms / 1000, tz=timezone.utc).isoformat().replace("+00:00", "Z")  # noqa: E731
    dates = {V7_THIRD: iso(first_ms + 500), V7_SECOND: iso(first_ms + 900), V7_FIRST: iso(first_ms + 1200),
             UPLOAD_A: iso(first_ms)}
    bucket = FakeBucket(objects, modified=_manifest_dates(**dates))

    result = entrada.collect(bucket, tmp_path / "salida")

    assert result["recogidas"] == [UPLOAD_A, V7_THIRD, V7_SECOND, V7_FIRST]  # por llegada (el tope, igual que antes)
    orden = json.loads((tmp_path / "salida" / entrada.ORDER_FILE).read_text())["subidas"]
    assert orden == [V7_FIRST, V7_SECOND, UPLOAD_A, V7_THIRD]


def test_cleanup_never_touches_an_upload_that_arrived_after_collecting(tmp_path):
    bucket = FakeBucket({**_subida(UPLOAD_A, b"abcdef", 2)})
    ids = entrada.collect(bucket, tmp_path / "salida")["recogidas"]
    bucket.objects.update(_subida(UPLOAD_B, b"ghij", 1))  # llega mientras se procesa

    entrada.cleanup(bucket, ids)

    assert sorted(bucket.objects) == sorted(_subida(UPLOAD_B, b"ghij", 1))


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
    assert sorted(path.name for path in (tmp_path / "e").iterdir()) == [UPLOAD_A, UPLOAD_B, entrada.ORDER_FILE]
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


def _tone_bytes(tmp_path: Path, frequency: int) -> bytes:
    return make_tone(tmp_path / "tonos" / f"{frequency}.opus", seconds=1.0, sample_rate=48000,
                     frequency=frequency).read_bytes()


def _catalog(repo: Path) -> dict:
    return json.loads((repo / "audio-library/indexes/catalog.json").read_text(encoding="utf-8"))


def test_web_uploads_of_an_album_get_their_track_numbers_in_arrival_order(repo, tmp_path):
    # Los nombres van al revés del orden de llegada y los UUID tampoco lo siguen: manda orden.json (ADR-0030).
    album = {"album": {"id": "PLorden", "name": "Lista"}}
    objects = {
        **_subida(UPLOAD_A, _tone_bytes(tmp_path, 300), 1, nombre="A tercera.opus", extra=album),
        **_subida(UPLOAD_B, _tone_bytes(tmp_path, 400), 2, nombre="B segunda.opus", extra=album),
        **_subida(UPLOAD_C, _tone_bytes(tmp_path, 500), 1, nombre="C primera.opus", extra=album),
    }
    dates = {UPLOAD_C: "2026-11-06T09:00:01Z", UPLOAD_B: "2026-11-06T09:00:02Z", UPLOAD_A: "2026-11-06T09:00:03Z"}
    origen = tmp_path / "recogidas"
    entrada.collect(FakeBucket(objects, modified=_manifest_dates(**dates)), origen)

    result = procesar_buzon(repo=repo, event={}, actor="seryi47", entrada=origen, solo_entrada=True)

    assert [item["archivo"] for item in result["publicas"]] == ["C primera.opus", "B segunda.opus", "A tercera.opus"]
    assert result["subidas_web"] == [UPLOAD_C, UPLOAD_B, UPLOAD_A] and result["rechazados"] == []
    songs = {song["title"]: song for song in _catalog(repo)["songs"]}
    assert [songs[title]["track"] for title in ("C primera", "B segunda", "A tercera")] == [1, 2, 3]


def test_a_broken_order_file_falls_back_to_name_order_and_loses_nothing(repo, tmp_path):
    origen = tmp_path / "recogidas"
    entrada.collect(FakeBucket({**_subida(UPLOAD_A, _tone_bytes(tmp_path, 300), 1, nombre="Uno.opus"),
                                **_subida(UPLOAD_B, _tone_bytes(tmp_path, 400), 1, nombre="Dos.opus")}), origen)
    (origen / entrada.ORDER_FILE).write_text('{"subidas": ["../x"]}', encoding="utf-8")

    result = procesar_buzon(repo=repo, event={}, actor="seryi47", entrada=origen, solo_entrada=True)

    assert sorted(item["archivo"] for item in result["publicas"]) == ["Dos.opus", "Uno.opus"]
    assert result["rechazados"] == [] and result["revisar"] == []


def test_the_same_upload_twice_in_a_run_enters_once(repo, tmp_path, opus_bytes):
    # Dos avisos (o un reintento del cliente con otro UUID) con los mismos bytes: una canción y una duplicada.
    origen = _recogidas(tmp_path, {**_subida(UPLOAD_A, opus_bytes, 2), **_subida(UPLOAD_B, opus_bytes, 3)})

    result = procesar_buzon(repo=repo, event={}, actor="seryi47", entrada=origen, solo_entrada=True)

    assert len(result["publicas"]) == 1 and len(result["duplicadas"]) == 1
    assert result["duplicadas"][0]["song_id"] == result["publicas"][0]["song_id"]
    assert sum(song["sha256"] == hashlib.sha256(opus_bytes).hexdigest() for song in _catalog(repo)["songs"]) == 1


def test_processing_what_was_already_published_changes_nothing(repo, tmp_path, opus_bytes):
    # Si 'publicar' sube a main pero no llega a borrar del bucket (o llegan varios avisos), la ejecución siguiente vuelve
    # a recoger lo mismo: el resultado es idéntico y el paquete no trae cambios.
    objects = {**_subida(UPLOAD_A, opus_bytes, 2),
               **_subida(UPLOAD_B, _tone_bytes(tmp_path, 700), 1, nombre="Otra.opus")}
    procesar_buzon(repo=repo, event={}, actor="seryi47", entrada=_recogidas(tmp_path / "1", objects), solo_entrada=True)
    _git(repo, "add", "-A")
    _git(repo, "-c", "user.name=p", "-c", "user.email=p@example.invalid", "commit", "-qm", "publicado")
    catalogo = _catalog(repo)

    again = procesar_buzon(repo=repo, event={}, actor="seryi47", entrada=_recogidas(tmp_path / "2", objects),
                           solo_entrada=True)

    assert again["publicas"] == [] and len(again["duplicadas"]) == 2 and again["rechazados"] == []
    assert again["subidas_web"] == [UPLOAD_A, UPLOAD_B]  # se borran del bucket igual
    assert _catalog(repo) == catalogo and _git(repo, "status", "--porcelain") == ""
    package = tmp_path / "paquete"
    paquete.package_processing_changes(repo, package, action="buzon")
    assert json.loads((package / "manifiesto.json").read_text(encoding="utf-8"))["cambios"] == []


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


def test_processing_in_the_sparse_checkout_of_the_job_packages_the_same_as_a_full_checkout(repo, tmp_path, opus_bytes):
    # ADR-0030: 'procesar' solo baja de main lo de su sparse-checkout (modo cone). El paquete debe ser el mismo.
    from test_buzon_workflow import _jobs, _sparse, _text

    for ruta, texto in {"docs/nota.md": "nota\n", "mobile/lib/app.dart": "// app\n", "frontend/web/js/app.js": "//\n",
                        "scripts/buzon.py": "# script\n", "backend/sonidos/__init__.py": "\n"}.items():
        (repo / ruta).parent.mkdir(parents=True, exist_ok=True)
        (repo / ruta).write_text(texto, encoding="utf-8")
    _git(repo, "add", "-A")
    _git(repo, "-c", "user.name=p", "-c", "user.email=p@example.invalid", "commit", "-qm", "más árbol")
    _, _, procesar, _ = _jobs(_text())
    clones = {}
    for name in ("completo", "sparse"):
        clone = tmp_path / name
        subprocess.run(["git", "clone", "-q", "--no-local", str(repo), str(clone)], check=True)
        if name == "sparse":
            _git(clone, "sparse-checkout", "set", "--cone", *_sparse(procesar))
            assert not (clone / "docs").exists() and not (clone / "mobile").exists()
            assert not (clone / "frontend/web/js").exists() and (clone / "frontend/web/data/songs.json").is_file()
        clones[name] = clone
    objects = _subida(UPLOAD_A, opus_bytes, 2, extra={"album": {"id": "PLx", "name": "Lista"}})

    manifests = {}
    for name, clone in clones.items():
        procesar_buzon(repo=clone, event={}, actor="seryi47", entrada=_recogidas(tmp_path / f"e-{name}", objects),
                       solo_entrada=True)
        package = tmp_path / f"paquete-{name}"
        paquete.package_processing_changes(clone, package, action="buzon")
        manifest = json.loads((package / "manifiesto.json").read_text(encoding="utf-8"))
        # El Opus que produce ffmpeg cambia en cada ejecución (número de serie Ogg aleatorio): se compara el catálogo.
        manifest["catalogo"] = hashlib.sha256(
            (package / paquete.CHANGES_DIR / "audio-library/indexes/catalog.json").read_bytes()).hexdigest()
        manifests[name] = manifest

    assert manifests["sparse"] == manifests["completo"]
    assert {item["ruta"].split("/")[1] for item in manifests["sparse"]["cambios"]} == {"indexes", "audio"}
