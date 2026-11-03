"""Buzón de canciones (ADR-0014): nombre a título, licencia desde el mensaje del commit, pública o privada, rechazos y
borrado del buzón. Las conversiones son reales (ffmpeg con tonos sintéticos) y git es real, sin red ni remoto."""

import json
import os
import shutil
import subprocess
import unicodedata
from pathlib import Path

import pytest

from conftest import SONG_ID, make_tone
from sonidos import buzon, catalog, paquete
from sonidos.buzon import BuzonError, licencia_desde_mensaje, nombre_valido, procesar_buzon, titulo_desde_nombre
from sonidos.paquete import PaqueteError

ROOT = Path(__file__).resolve().parents[2]
CATALOG = "audio-library/indexes/catalog.json"
BUZON = "audio-library/buzon"
CON_LICENCIA = "Add files via upload\n\nLicencia: CC BY 4.0 (grabación propia)"
SIN_LICENCIA = "Add files via upload"


def _git(repo: Path, *args: str) -> str:
    return subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True, text=True).stdout


def _commit(repo: Path, message: str = "subida") -> None:
    _git(repo, "add", "-A")
    _git(repo, "-c", "user.name=prueba", "-c", "user.email=prueba@example.invalid", "commit", "-q", "-m", message)


def _evento(*commits: tuple[str, list[str]]) -> dict:
    return {"commits": [{"message": message, "added": added, "modified": [], "removed": []} for message, added in commits]}


def _catalogo(repo: Path) -> dict:
    return json.loads((repo / CATALOG).read_text(encoding="utf-8"))


def _cancion(repo: Path, song_id: str) -> dict:
    return next(song for song in _catalogo(repo)["songs"] if song["id"] == song_id)


@pytest.fixture
def repo(main_publicado: Path) -> Path:
    """main con una canción pública y el buzón con su README, ya confirmado."""
    (main_publicado / BUZON).mkdir(parents=True)
    (main_publicado / BUZON / "README.md").write_text("buzón\n", encoding="utf-8")
    _commit(main_publicado, "buzón")
    return main_publicado


def _subir(repo: Path, name: str, *, frequency: int = 440) -> str:
    make_tone(repo / BUZON / name, seconds=1.0, frequency=frequency)
    return f"{BUZON}/{name}"


# --- Nombre a título --------------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "nombre, titulo",
    [
        ("Mi canción.mp3", "Mi canción"),
        ("Tango de 1935.FLAC", "Tango de 1935"),
        ("a.b.c.wav", "a.b.c"),
        ("Copla (versión 2).ogg", "Copla (versión 2)"),
        ("sin-extension", "sin-extension"),
        (unicodedata.normalize("NFD", "Canción.m4a"), "Canción"),
        ("x" * 300 + ".mp3", "x" * 200),
    ],
)
def test_el_titulo_es_el_nombre_sin_extension(nombre, titulo):
    resultado = titulo_desde_nombre(nombre)
    assert resultado == titulo
    assert unicodedata.is_normalized("NFC", resultado)


# --- Licencia desde el mensaje del commit -----------------------------------------------------------------------


@pytest.mark.parametrize(
    "mensaje, licencia",
    [
        ("Add files via upload\n\nLicencia: CC BY 4.0", "CC BY 4.0"),
        ("Licencia: CC0 1.0", "CC0 1.0"),
        ("Subida\n  licencia :   Dominio público  \nOtra línea", "Dominio público"),
        ("Subida\nLICENCIA: CC BY-SA 4.0\nLicencia: otra", "CC BY-SA 4.0"),
        ("Subida\r\nLicencia: CC BY 4.0\r\n", "CC BY 4.0"),
    ],
)
def test_la_licencia_sale_de_la_linea_licencia(mensaje, licencia):
    assert licencia_desde_mensaje(mensaje) == licencia


@pytest.mark.parametrize(
    "mensaje",
    [
        "Add files via upload",
        "",
        None,
        "Licencia:",
        "Licencia:    ",
        "La licencia: CC BY 4.0",  # no empieza la línea
        "Licencias: CC BY 4.0",
        "Licencia: CC BY‮ 4.0",  # carácter de formato (bidi)
        "Licencia: " + "x" * 301,
        f"Licencia: {catalog.LICENSE_UNDECLARED}",
    ],
)
def test_sin_linea_de_licencia_valida_no_hay_licencia(mensaje):
    assert licencia_desde_mensaje(mensaje) is None


# --- Nombres y rutas --------------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "nombre", ["Mi canción.mp3", "Tango_1935-v2.flac", "Ça va (live) [1960].ogg", "Rock & roll, ¡ya!.m4a", "日本の歌.wav"],
)
def test_nombres_validos(nombre):
    assert nombre_valido(nombre)


@pytest.mark.parametrize(
    "nombre",
    [
        "", ".", "..", "../x.mp3", "a/b.mp3", "a\\b.mp3", ".oculto.mp3", "-x.mp3", " x.mp3", "x.mp3 ", "x.",
        "x\n.mp3", "x\x00.mp3", "x‮3pm.wav", "x​.mp3", 'a"b.mp3', "a<b>.mp3", "a`b`.mp3", "a:b.mp3",
        "x" * 201, "á" * 150,
    ],
)
def test_nombres_con_rutas_o_caracteres_raros_no_son_validos(nombre):
    assert not nombre_valido(nombre)


def test_el_evento_da_el_ultimo_mensaje_y_quita_lo_borrado_y_lo_de_fuera_del_buzon():
    evento = {"commits": [
        {"message": "uno", "added": [f"{BUZON}/a.mp3", f"{BUZON}/b.mp3", "README.md"], "modified": [], "removed": []},
        {"message": "dos", "added": [], "modified": [f"{BUZON}/a.mp3"], "removed": [f"{BUZON}/b.mp3"]},
    ]}

    assert buzon.archivos_del_evento(evento) == {f"{BUZON}/a.mp3": "dos"}


def test_un_evento_sin_commits_se_rechaza():
    with pytest.raises(BuzonError):
        buzon.archivos_del_evento({"ref": "refs/heads/main"})


# --- Procesado: pública o privada ------------------------------------------------------------------------------


def test_con_licencia_entra_publica_con_su_fuente_y_sale_del_buzon(repo):
    ruta = _subir(repo, "Mi canción.wav")
    _commit(repo, CON_LICENCIA)

    result = procesar_buzon(repo=repo, event=_evento((CON_LICENCIA, [ruta])), actor="ana-1")

    [entrada] = result["publicas"]
    song = _cancion(repo, entrada["song_id"])
    assert song["title"] == "Mi canción"
    assert song["license"] == "CC BY 4.0 (grabación propia)"
    assert song["source"] == "Subida por ana-1"
    assert song["public"] is True
    assert song["codec"] == "pcm_s16le"
    audio = repo / "audio-library" / "audio" / f"{song['id']}.opus"
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries", "stream=codec_name", "-of", "csv=p=0",
         str(audio)], check=True, capture_output=True, text=True,
    ).stdout.strip()
    assert probe == "opus"
    assert not (repo / ruta).exists()
    assert (repo / BUZON / "README.md").exists()
    publicas = json.loads((repo / "frontend/web/data/songs.json").read_text(encoding="utf-8"))
    assert song["id"] in {item["id"] for item in publicas}
    assert (repo / "frontend/web/audio" / f"{song['id']}.opus").exists()


@pytest.mark.parametrize("extension", [".mp3", ".flac", ".ogg", ".m4a", ".WAV"])
def test_cada_formato_admitido_se_convierte_a_opus(repo, extension):
    ruta = _subir(repo, f"Formato{extension}")
    _commit(repo, CON_LICENCIA)

    result = procesar_buzon(repo=repo, event=_evento((CON_LICENCIA, [ruta])), actor="ana")

    [entrada] = result["publicas"]
    assert entrada["titulo"] == "Formato"
    assert (repo / "audio-library" / "audio" / f"{entrada['song_id']}.opus").stat().st_size > 0


def test_sin_licencia_entra_privada_y_no_llega_a_la_web(repo):
    ruta = _subir(repo, "Sin papeles.wav")
    _commit(repo, SIN_LICENCIA)

    result = procesar_buzon(repo=repo, event=_evento((SIN_LICENCIA, [ruta])), actor="ana")

    [entrada] = result["privadas"]
    song = _cancion(repo, entrada["song_id"])
    assert song["public"] is False
    assert song["license"] == catalog.LICENSE_UNDECLARED
    assert song["source"] == "Subida por ana"
    assert (repo / "audio-library" / "audio" / f"{song['id']}.opus").exists()
    assert not (repo / ruta).exists()
    publicas = json.loads((repo / "frontend/web/data/songs.json").read_text(encoding="utf-8"))
    assert song["id"] not in {item["id"] for item in publicas}
    assert "Privadas" in buzon.resumen_markdown(result)


def test_una_cancion_sin_licencia_no_se_puede_publicar_a_mano():
    data = catalog.empty()
    song, _ = catalog.add_song(
        data, sha256="cd" * 32, title="t", license=catalog.LICENSE_UNDECLARED, source="Subida por ana",
        codec="mp3", duration_s=1.0, size_bytes=1,
    )
    with pytest.raises(catalog.CatalogError):
        catalog.update_song(data, song["id"], {"public": True})


def test_subir_de_nuevo_con_licencia_declara_y_publica_la_privada(repo):
    ruta = _subir(repo, "Bolero.wav")
    _commit(repo, SIN_LICENCIA)
    primera = procesar_buzon(repo=repo, event=_evento((SIN_LICENCIA, [ruta])), actor="ana")
    _commit(repo, "procesado")
    _subir(repo, "Bolero (con licencia).wav")
    ruta2 = f"{BUZON}/Bolero (con licencia).wav"
    _commit(repo, CON_LICENCIA)

    segunda = procesar_buzon(repo=repo, event=_evento((CON_LICENCIA, [ruta2])), actor="luis")

    song_id = primera["privadas"][0]["song_id"]
    assert segunda["publicas"] == [{
        "archivo": "Bolero (con licencia).wav", "song_id": song_id, "titulo": "Bolero",
        "licencia": "CC BY 4.0 (grabación propia)", "nueva": False,
    }]
    song = _cancion(repo, song_id)
    assert song["public"] is True and song["source"] == "Subida por luis"


def test_la_misma_grabacion_no_se_duplica(repo):
    ruta = _subir(repo, "Uno.wav")
    shutil.copyfile(repo / ruta, repo / BUZON / "Dos.wav")
    _commit(repo, CON_LICENCIA)

    result = procesar_buzon(repo=repo, event=_evento((CON_LICENCIA, [ruta, f"{BUZON}/Dos.wav"])), actor="ana")

    assert len(result["publicas"]) == 1 and len(result["duplicadas"]) == 1
    assert len(_catalogo(repo)["songs"]) == 2  # la de main y la nueva
    assert not any((repo / BUZON).glob("*.wav"))


# --- Procesado: rechazos ------------------------------------------------------------------------------------------


def test_lo_que_no_es_audio_se_rechaza_y_se_borra(repo):
    (repo / BUZON / "notas.txt").write_text("hola\n", encoding="utf-8")
    (repo / BUZON / "falso.mp3").write_text("esto no es audio\n", encoding="utf-8")
    (repo / BUZON / "vacio.wav").write_bytes(b"")
    _commit(repo, CON_LICENCIA)
    antes = _catalogo(repo)

    result = procesar_buzon(
        repo=repo, event=_evento((CON_LICENCIA, [f"{BUZON}/notas.txt", f"{BUZON}/falso.mp3", f"{BUZON}/vacio.wav"])),
        actor="ana",
    )

    motivos = {item["archivo"]: item["motivo"] for item in result["rechazados"]}
    assert set(motivos) == {"notas.txt", "falso.mp3", "vacio.wav"}
    assert "no es un archivo de audio" in motivos["notas.txt"]
    assert "no es audio" in motivos["falso.mp3"]
    assert _catalogo(repo) == antes
    assert sorted(path.name for path in (repo / BUZON).iterdir()) == ["README.md"]


def test_mas_de_100_mib_se_rechaza(repo, monkeypatch):
    ruta = _subir(repo, "Grande.wav")
    _commit(repo, CON_LICENCIA)
    monkeypatch.setattr(buzon, "MAX_FILE_BYTES", 1000)

    result = procesar_buzon(repo=repo, event=_evento((CON_LICENCIA, [ruta])), actor="ana")

    assert result["rechazados"] == [{"archivo": "Grande.wav", "motivo": "pasa de 100 MiB"}]
    assert buzon.MAX_FILE_BYTES == 1000 and buzon.GIT_BLOCK_FILE_BYTES == 100 * 1024**2


def test_enlaces_subcarpetas_y_nombres_raros_se_dejan_para_revisar(repo):
    destino = repo / BUZON / "real.txt"
    destino.write_text("x", encoding="utf-8")
    os.symlink("../indexes/catalog.json", repo / BUZON / "enlace.mp3")
    _subir(repo, "sub/dentro.wav")
    _subir(repo, "-raro.wav")
    _commit(repo, CON_LICENCIA)
    rutas = [f"{BUZON}/enlace.mp3", f"{BUZON}/sub/dentro.wav", f"{BUZON}/-raro.wav", f"{BUZON}/../indexes/catalog.json"]

    result = procesar_buzon(repo=repo, event=_evento((CON_LICENCIA, rutas)), actor="ana")

    assert {item["ruta"] for item in result["revisar"]} == set(rutas)
    assert result["publicas"] == result["privadas"] == []
    assert (repo / BUZON / "enlace.mp3").is_symlink()
    assert (repo / BUZON / "sub" / "dentro.wav").exists() and (repo / BUZON / "-raro.wav").exists()
    assert (repo / CATALOG).is_file()


def test_lo_que_ya_no_esta_en_el_buzon_y_los_ficheros_fijos_se_ignoran(repo):
    result = procesar_buzon(
        repo=repo, event=_evento((CON_LICENCIA, [f"{BUZON}/README.md", f"{BUZON}/ya.mp3"])), actor="ana",
    )

    assert result["ya_no_estan"] == ["ya.mp3"]
    assert (repo / BUZON / "README.md").exists()


@pytest.mark.parametrize("actor", ["", "ana;rm -rf /", "-ana", "a" * 40, None])
def test_una_cuenta_con_nombre_no_valido_detiene_el_procesado(repo, actor):
    with pytest.raises(BuzonError):
        procesar_buzon(repo=repo, event=_evento(), actor=actor)


def test_un_buzon_que_es_un_enlace_simbolico_detiene_el_procesado(repo):
    shutil.rmtree(repo / BUZON)
    os.symlink("audio", repo / BUZON)
    with pytest.raises(BuzonError):
        procesar_buzon(repo=repo, event=_evento(), actor="ana")


def test_el_resumen_escapa_lo_que_escribe_quien_sube():
    texto = buzon.resumen_markdown({
        "actor": "ana", "publicas": [], "privadas": [], "duplicadas": [], "rechazados": [], "ya_no_estan": [],
        "revisar": [{"ruta": f"{BUZON}/x\n## Falso\n<img src=x onerror=alert(1)>.mp3", "motivo": "nombre"}],
    })

    assert "\n## Falso" not in texto
    linea = next(line for line in texto.splitlines() if "onerror" in line)
    assert linea.startswith("    \"")


# --- Del procesado a main: el paquete borra del buzón y nada más ----------------------------------------------


def test_procesar_empaquetar_y_publicar_borra_del_buzon_y_publica(repo, tmp_path):
    ruta = _subir(repo, "Vals.wav")
    _commit(repo, CON_LICENCIA)
    trabajo = tmp_path / "procesar"
    subprocess.run(["git", "clone", "-q", str(repo), str(trabajo)], check=True)

    result = procesar_buzon(repo=trabajo, event=_evento((CON_LICENCIA, [ruta])), actor="ana")
    package = tmp_path / "paquete"
    paquete.package_processing_changes(trabajo, package, action="buzon")
    manifiesto = json.loads((package / "manifiesto.json").read_text(encoding="utf-8"))
    song_id = result["publicas"][0]["song_id"]
    assert {(item["ruta"], item["estado"]) for item in manifiesto["cambios"]} == {
        (ruta, "D"), (CATALOG, "M"), (f"audio-library/audio/{song_id}.opus", "A"),
    }

    summary = paquete.publish_package(package, repo, head=paquete.head_commit(repo))

    staged = _git(repo, "diff", "--cached", "--name-status", "--no-renames").splitlines()
    assert f"D\t{ruta}" in staged
    assert f"A\tfrontend/web/audio/{song_id}.opus" in staged
    assert "M\tfrontend/web/data/songs.json" in staged
    assert summary["eliminados"] == 1
    assert SONG_ID in (repo / "frontend/web/data/songs.json").read_text(encoding="utf-8")


def _manifiesto(tmp_path: Path, accion: str, cambios: list) -> Path:
    tmp_path.mkdir(parents=True, exist_ok=True)
    (tmp_path / "manifiesto.json").write_text(
        json.dumps({"base": "a" * 40, "accion": accion, "cambios": cambios}), encoding="utf-8",
    )
    return tmp_path


def test_el_paquete_solo_borra_del_buzon_y_solo_con_la_accion_buzon(tmp_path):
    borrar = [{"ruta": f"{BUZON}/Vals.wav", "estado": "D"}]
    accion, cambios = paquete.read_manifest(_manifiesto(tmp_path / "ok", "buzon", borrar), head="a" * 40)
    assert accion == "buzon" and cambios[0].state == "D"

    for nombre, accion, cambios in [
        ("import", "import", borrar),
        ("organize", "organize", borrar),
        ("anadir", "buzon", [{"ruta": f"{BUZON}/Vals.wav", "estado": "A"}]),
        ("modificar", "buzon", [{"ruta": f"{BUZON}/Vals.wav", "estado": "M"}]),
        ("readme", "buzon", [{"ruta": f"{BUZON}/README.md", "estado": "D"}]),
        ("gitkeep", "buzon", [{"ruta": f"{BUZON}/.gitkeep", "estado": "D"}]),
        ("sub", "buzon", [{"ruta": f"{BUZON}/sub/x.wav", "estado": "D"}]),
        ("raro", "buzon", [{"ruta": f"{BUZON}/-x.wav", "estado": "D"}]),
        ("codigo", "buzon", [{"ruta": "scripts/buzon.py", "estado": "D"}]),
    ]:
        with pytest.raises(PaqueteError):
            paquete.read_manifest(_manifiesto(tmp_path / nombre, accion, cambios), head="a" * 40)


def test_empaquetar_rechaza_un_buzon_cambiado_o_fuera_de_la_accion_buzon(repo, tmp_path):
    ruta = _subir(repo, "Vals.wav")
    _commit(repo, CON_LICENCIA)
    (repo / ruta).write_bytes(b"otra cosa")
    with pytest.raises(PaqueteError):
        paquete.package_processing_changes(repo, tmp_path / "p1", action="buzon")

    (repo / ruta).unlink()
    with pytest.raises(PaqueteError):
        paquete.package_processing_changes(repo, tmp_path / "p2", action="import")


# --- El script del job -------------------------------------------------------------------------------------------


def _script():
    import importlib.util

    spec = importlib.util.spec_from_file_location("buzon_script_under_test", ROOT / "scripts" / "buzon.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_el_script_lee_el_evento_y_escribe_resultado_y_resumen(repo, tmp_path, capsys):
    ruta = _subir(repo, "Copla.wav")
    _commit(repo, SIN_LICENCIA)
    evento = tmp_path / "evento.json"
    evento.write_text(json.dumps(_evento((SIN_LICENCIA, [ruta]))), encoding="utf-8")
    resumen = tmp_path / "resumen.md"
    resultado = tmp_path / "paquete" / "resultado.json"
    env = {"ACTOR": "ana", "GITHUB_EVENT_PATH": str(evento), "GITHUB_STEP_SUMMARY": str(resumen)}

    assert _script().main(["--resultado", str(resultado)], env=env, root=repo) == 0

    datos = json.loads(resultado.read_text(encoding="utf-8"))
    assert datos["privadas"][0]["archivo"] == "Copla.wav"
    assert "Privadas" in resumen.read_text(encoding="utf-8")
    salida = capsys.readouterr().out
    assert "::warning title=Buzón::1 canción(es)" in salida
    assert "Copla" not in next(line for line in salida.splitlines() if line.startswith("::warning"))


def test_el_script_sin_evento_falla_con_un_json_de_error(repo, tmp_path, capsys):
    resultado = tmp_path / "resultado.json"

    assert _script().main(["--resultado", str(resultado)], env={"ACTOR": "ana"}, root=repo) == 1

    assert "error" in json.loads(resultado.read_text(encoding="utf-8"))


# --- Eventos sin listas de archivos y lanzamiento manual -------------------------------------------------------------


def test_si_el_evento_no_trae_listas_se_procesa_lo_que_hay_en_el_buzon(repo):
    ruta = _subir(repo, "Sin listas.wav")
    _commit(repo, CON_LICENCIA)
    evento = {"commits": [{"message": CON_LICENCIA}], "head_commit": {"message": CON_LICENCIA}}

    result = procesar_buzon(repo=repo, event=evento, actor="ana")

    [entrada] = result["publicas"]
    assert _cancion(repo, entrada["song_id"])["title"] == "Sin listas"
    assert not (repo / ruta).exists()


def test_un_lanzamiento_manual_sin_commits_procesa_lo_pendiente_como_privado(repo):
    _subir(repo, "Pendiente.wav")
    _commit(repo, SIN_LICENCIA)

    result = procesar_buzon(repo=repo, event={"ref": "refs/heads/main", "inputs": {}}, actor="ana")

    [entrada] = result["privadas"]
    assert _cancion(repo, entrada["song_id"])["public"] is False


def test_sin_archivos_pendientes_no_hace_nada(repo):
    result = procesar_buzon(repo=repo, event={"ref": "refs/heads/main"}, actor="ana")

    assert result["publicas"] == [] and result["privadas"] == []


def test_un_opus_ya_convertido_en_el_navegador_entra_como_cualquier_audio(repo):
    # La web y la APK convierten a Opus antes de subir, para no llenar el historial de git de WAV (ADR-0017).
    make_tone(repo / BUZON / "Desde el navegador.opus", seconds=1.0, sample_rate=48000)
    ruta = f"{BUZON}/Desde el navegador.opus"
    _commit(repo, CON_LICENCIA)

    result = procesar_buzon(repo=repo, event=_evento((CON_LICENCIA, [ruta])), actor="ana")

    [entrada] = result["publicas"]
    assert _cancion(repo, entrada["song_id"])["title"] == "Desde el navegador"
    assert not (repo / ruta).exists()


# --- Subidas por trozos desde la web (ADR-0017) ---------------------------------------------------------------------

PARTES = f"{BUZON}/.partes"
UPLOAD_ID = "0f8fad5b-d9cb-469f-a165-70867728950e"
LICENCIA_WEB = "Subida desde la web: Vals\n\nLicencia: Subida desde la web pública; quien la sube declara tener derecho a publicarla"


@pytest.fixture
def opus_bytes(tmp_path: Path) -> bytes:
    """Un Ogg Opus sintético de 2 s a 48 kHz, como el que convierte el navegador."""
    return make_tone(tmp_path / "fuente" / "tono.opus", seconds=2.0, sample_rate=48000).read_bytes()


def _trozos(repo: Path, data: bytes, partes: int, *, upload_id: str = UPLOAD_ID, nombre: str = "Vals.opus",
            manifiesto: object = True, faltan: tuple[int, ...] = ()) -> list[str]:
    """Escribe los trozos de data (y el manifiesto) en .partes/<upload_id>/ y devuelve sus rutas."""
    folder = repo / PARTES / upload_id
    folder.mkdir(parents=True, exist_ok=True)
    size = -(-len(data) // partes)
    rutas = []
    for index in range(partes):
        if index in faltan:
            continue
        (folder / f"{index}.part").write_bytes(data[index * size:(index + 1) * size])
        rutas.append(f"{PARTES}/{upload_id}/{index}.part")
    if manifiesto is not None and manifiesto is not False:
        contenido = {"nombre": nombre, "partes": partes} if manifiesto is True else manifiesto
        texto = contenido if isinstance(contenido, str) else json.dumps(contenido)
        (folder / "manifiesto.json").write_text(texto, encoding="utf-8")
        rutas.append(f"{PARTES}/{upload_id}/manifiesto.json")
    return rutas


def test_las_partes_con_manifiesto_se_unen_en_orden_y_entran_publicas(repo, opus_bytes):
    rutas = _trozos(repo, opus_bytes, 3)
    _commit(repo, LICENCIA_WEB)

    result = procesar_buzon(repo=repo, event=_evento((LICENCIA_WEB, rutas)), actor="ana")

    [entrada] = result["publicas"]
    assert entrada["archivo"] == "Vals.opus"
    assert entrada["licencia"] == buzon.WEB_LICENSE
    cancion = _cancion(repo, entrada["song_id"])
    assert cancion["title"] == "Vals" and cancion["public"] is True
    assert cancion["sha256"] == __import__("hashlib").sha256(opus_bytes).hexdigest()
    assert not (repo / PARTES / UPLOAD_ID).exists()
    assert not (repo / BUZON / "Vals.opus").exists()
    assert result["revisar"] == [] and result["rechazados"] == []


def test_una_subida_en_curso_sin_manifiesto_se_ignora(repo, opus_bytes):
    rutas = _trozos(repo, opus_bytes, 3, manifiesto=None)
    _commit(repo, "Subida desde la web: Vals (trozo 3 de 3)")

    result = procesar_buzon(repo=repo, event=_evento(("trozos", rutas)), actor="ana")

    assert result["publicas"] == [] and result["privadas"] == []
    assert result["revisar"] == [] and result["rechazados"] == []
    assert sorted(path.name for path in (repo / PARTES / UPLOAD_ID).iterdir()) == ["0.part", "1.part", "2.part"]


def test_un_push_solo_de_trozos_no_procesa_lo_demas_del_buzon(repo, opus_bytes):
    _subir(repo, "Pendiente.wav")
    rutas = _trozos(repo, opus_bytes, 2, manifiesto=None)
    _commit(repo, "trozos")

    result = procesar_buzon(repo=repo, event=_evento(("trozos", rutas)), actor="ana")

    assert result["privadas"] == [] and result["publicas"] == []
    assert (repo / BUZON / "Pendiente.wav").exists()


def test_si_faltan_partes_se_deja_para_revisar_sin_borrar_nada(repo, opus_bytes):
    rutas = _trozos(repo, opus_bytes, 3, faltan=(1,))
    _commit(repo, LICENCIA_WEB)

    result = procesar_buzon(repo=repo, event=_evento((LICENCIA_WEB, rutas)), actor="ana")

    assert result["publicas"] == []
    assert result["revisar"] == [{"ruta": f"{PARTES}/{UPLOAD_ID}", "motivo": "faltan 1 de 3 partes"}]
    assert (repo / PARTES / UPLOAD_ID / "manifiesto.json").exists()


def test_si_hay_mas_partes_que_en_el_manifiesto_se_deja_para_revisar(repo, opus_bytes):
    rutas = _trozos(repo, opus_bytes, 3, manifiesto={"nombre": "Vals.opus", "partes": 2})
    _commit(repo, LICENCIA_WEB)

    result = procesar_buzon(repo=repo, event=_evento((LICENCIA_WEB, rutas)), actor="ana")

    assert result["revisar"][0]["motivo"] == "hay más partes de las que dice el manifiesto"
    assert (repo / PARTES / UPLOAD_ID / "2.part").exists()


@pytest.mark.parametrize(
    "manifiesto",
    [
        "esto no es JSON",
        {"nombre": "Vals.opus"},
        {"nombre": "Vals.opus", "partes": 2, "otra": 1},
        {"nombre": "Vals.wav", "partes": 2},
        {"nombre": ".opus", "partes": 2},
        {"nombre": "../Vals.opus", "partes": 2},
        {"nombre": "Vals.opus", "partes": 0},
        {"nombre": "Vals.opus", "partes": 1001},
        {"nombre": "Vals.opus", "partes": "2"},
        {"nombre": "Vals.opus", "partes": True},
        ["Vals.opus", 2],
    ],
)
def test_un_manifiesto_incorrecto_se_rechaza_y_se_borra_la_carpeta(repo, opus_bytes, manifiesto):
    rutas = _trozos(repo, opus_bytes, 2, manifiesto=manifiesto)
    _commit(repo, LICENCIA_WEB)

    result = procesar_buzon(repo=repo, event=_evento((LICENCIA_WEB, rutas)), actor="ana")

    assert result["rechazados"] == [{"archivo": f".partes/{UPLOAD_ID}", "motivo": "el manifiesto de partes no es válido"}]
    assert result["publicas"] == [] and result["privadas"] == []
    assert not (repo / PARTES / UPLOAD_ID).exists()


@pytest.mark.parametrize(
    "upload_id",
    ["no-es-un-uuid", UPLOAD_ID.upper(), UPLOAD_ID[:-1], UPLOAD_ID + "0", "0f8fad5bd9cb469fa16570867728950e"],
)
def test_un_id_que_no_es_un_uuid_se_deja_para_revisar(repo, opus_bytes, upload_id):
    rutas = _trozos(repo, opus_bytes, 2, upload_id=upload_id)
    _commit(repo, LICENCIA_WEB)

    result = procesar_buzon(repo=repo, event=_evento((LICENCIA_WEB, rutas)), actor="ana")

    assert result["revisar"] == [{"ruta": f"{PARTES}/{upload_id}", "motivo": "carpeta de partes con un id que no es un UUID"}]
    assert result["publicas"] == []
    assert (repo / PARTES / upload_id / "manifiesto.json").exists()


def test_elementos_que_no_son_partes_se_dejan_para_revisar(repo, opus_bytes):
    rutas = _trozos(repo, opus_bytes, 2)
    (repo / PARTES / UPLOAD_ID / "otro.txt").write_text("x", encoding="utf-8")
    _commit(repo, LICENCIA_WEB)

    result = procesar_buzon(repo=repo, event=_evento((LICENCIA_WEB, rutas)), actor="ana")

    assert result["revisar"][0]["motivo"] == "la carpeta de partes tiene elementos que no son partes"
    assert (repo / PARTES / UPLOAD_ID / "0.part").exists()


def test_al_unir_nunca_se_sobrescribe_un_archivo_del_buzon(repo, opus_bytes):
    (repo / BUZON / "Vals.opus").write_bytes(b"otro archivo que espera en el buzon")
    rutas = _trozos(repo, opus_bytes, 2)
    _commit(repo, LICENCIA_WEB)

    result = procesar_buzon(repo=repo, event=_evento((LICENCIA_WEB, rutas)), actor="ana")

    [entrada] = result["publicas"]
    assert entrada["archivo"] == "Vals (2).opus"
    assert _cancion(repo, entrada["song_id"])["title"] == "Vals (2)"
    assert (repo / BUZON / "Vals.opus").read_bytes() == b"otro archivo que espera en el buzon"


def test_si_el_push_no_trae_el_manifiesto_se_usa_la_licencia_de_la_web(repo, opus_bytes):
    # Otra ejecución de la cola (por ejemplo, la de un trozo anterior) llega a main cuando el manifiesto ya está.
    _trozos(repo, opus_bytes, 2)
    _commit(repo, LICENCIA_WEB)

    result = procesar_buzon(repo=repo, event=_evento(("otra cosa", [f"{BUZON}/README.md"])), actor="ana")

    [entrada] = result["publicas"]
    assert entrada["licencia"] == buzon.WEB_LICENSE


def test_ruta_de_partes():
    for ruta in (f"{PARTES}/{UPLOAD_ID}/0.part", f"{PARTES}/{UPLOAD_ID}/999.part", f"{PARTES}/{UPLOAD_ID}/manifiesto.json"):
        assert buzon.ruta_de_partes(ruta), ruta
    for ruta in (
        f"{PARTES}/{UPLOAD_ID}/1000.part", f"{PARTES}/{UPLOAD_ID}/01.part", f"{PARTES}/{UPLOAD_ID}/a.part",
        f"{PARTES}/{UPLOAD_ID.upper()}/0.part", f"{PARTES}/{UPLOAD_ID}/sub/0.part", f"{PARTES}/{UPLOAD_ID}",
        f"{PARTES}/../catalog.json", f"{BUZON}/{UPLOAD_ID}/0.part", None,
    ):
        assert not buzon.ruta_de_partes(ruta), ruta


def test_el_paquete_borra_las_partes_solo_con_la_accion_buzon(tmp_path):
    borrar = [{"ruta": f"{PARTES}/{UPLOAD_ID}/0.part", "estado": "D"},
              {"ruta": f"{PARTES}/{UPLOAD_ID}/manifiesto.json", "estado": "D"}]
    accion, cambios = paquete.read_manifest(_manifiesto(tmp_path / "ok", "buzon", borrar), head="a" * 40)
    assert accion == "buzon" and [cambio.state for cambio in cambios] == ["D", "D"]
    for nombre, accion, cambios in [
        ("import", "import", borrar),
        ("anadir", "buzon", [{"ruta": f"{PARTES}/{UPLOAD_ID}/0.part", "estado": "A"}]),
        ("uuid", "buzon", [{"ruta": f"{PARTES}/no-uuid/0.part", "estado": "D"}]),
    ]:
        with pytest.raises(PaqueteError):
            paquete.read_manifest(_manifiesto(tmp_path / nombre, accion, cambios), head="a" * 40)


def test_procesar_empaquetar_y_publicar_una_subida_por_trozos(repo, tmp_path, opus_bytes):
    rutas = _trozos(repo, opus_bytes, 2)
    _commit(repo, LICENCIA_WEB)
    trabajo = tmp_path / "procesar"
    subprocess.run(["git", "clone", "-q", str(repo), str(trabajo)], check=True)

    result = procesar_buzon(repo=trabajo, event=_evento((LICENCIA_WEB, rutas)), actor="ana")
    package = tmp_path / "paquete"
    paquete.package_processing_changes(trabajo, package, action="buzon")
    manifiesto = json.loads((package / "manifiesto.json").read_text(encoding="utf-8"))
    song_id = result["publicas"][0]["song_id"]
    assert {(item["ruta"], item["estado"]) for item in manifiesto["cambios"]} == {
        *((ruta, "D") for ruta in rutas), (CATALOG, "M"), (f"audio-library/audio/{song_id}.opus", "A"),
    }

    paquete.publish_package(package, repo, head=paquete.head_commit(repo))

    staged = _git(repo, "diff", "--cached", "--name-status", "--no-renames").splitlines()
    assert f"D\t{PARTES}/{UPLOAD_ID}/manifiesto.json" in staged
    assert f"A\tfrontend/web/audio/{song_id}.opus" in staged
