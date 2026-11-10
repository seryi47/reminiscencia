"""Buzón de canciones (ADR-0014): nombre a título, licencia desde el mensaje del commit, pública o privada, rechazos y
borrado del buzón. Las conversiones son reales (ffmpeg con tonos sintéticos) y git es real, sin red ni remoto."""

import json
import os
import shutil
import subprocess
import tempfile
import unicodedata
import zipfile
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
    assert not (repo / "frontend/web/audio" / f"{song['id']}.opus").exists()  # el audio público lo sirve R2


def _audio_stream_md5(path: Path) -> str:
    """md5 del FLUJO de audio (sin el contenedor): idéntico = el audio no se recodificó, solo se copió."""
    salida = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(path), "-map", "0:a:0", "-c:a", "copy", "-f", "md5", "-"],
        check=True, capture_output=True, text=True,
    ).stdout
    return salida.strip()


def test_una_subida_ya_en_opus_se_copia_sin_recodificar(repo):
    # La web y la APK suben el audio ya en Opus (lo convierten en el propio dispositivo). El buzón debe copiar ese flujo
    # tal cual, sin una segunda pasada con pérdida que empeoraría la calidad y agrandaría el archivo (ADR-0040).
    # Opus a 48 kHz (lo que produce la app; libopus solo admite 48/24/16/12/8 kHz).
    nombre = "Ya en opus.opus"
    make_tone(repo / BUZON / nombre, seconds=1.0, sample_rate=48000)
    ruta = f"{BUZON}/{nombre}"
    md5_origen = _audio_stream_md5(repo / ruta)
    _commit(repo, CON_LICENCIA)

    result = procesar_buzon(repo=repo, event=_evento((CON_LICENCIA, [ruta])), actor="ana")

    [entrada] = result["publicas"]
    song = _cancion(repo, entrada["song_id"])
    assert song["codec"] == "opus"
    publicado = repo / "audio-library" / "audio" / f"{song['id']}.opus"
    # El flujo de audio publicado es idéntico al subido: se copió, no se recodificó.
    assert _audio_stream_md5(publicado) == md5_origen


def test_una_subida_en_opus_no_usa_ffmpeg_ni_ffprobe(repo, monkeypatch):
    # La publicación de lo que sube la app (ya en Opus) NO debe invocar ningún subproceso de ffmpeg/ffprobe (ADR-0042):
    # los metadatos se leen en Python puro y el audio se copia. Así el runner no necesita instalar ffmpeg (~7 min menos).
    nombre = "Sin ffmpeg.opus"
    make_tone(repo / BUZON / nombre, seconds=1.0, sample_rate=48000)  # el tono se genera con ffmpeg ANTES de prohibirlo
    ruta = f"{BUZON}/{nombre}"
    _commit(repo, CON_LICENCIA)

    def _prohibido(*args, **kwargs):
        raise AssertionError("procesar una subida Opus no debe llamar a ffmpeg/ffprobe")

    monkeypatch.setattr(subprocess, "run", _prohibido)
    result = procesar_buzon(repo=repo, event=_evento((CON_LICENCIA, [ruta])), actor="ana")

    [entrada] = result["publicas"]
    song = _cancion(repo, entrada["song_id"])
    assert song["codec"] == "opus"
    assert song["duration_s"] > 0  # la duración se leyó en Python puro
    assert (repo / "audio-library" / "audio" / f"{song['id']}.opus").exists()


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
    assert f"A\taudio-library/audio/{song_id}.opus" in staged
    assert not any(line.endswith(f"frontend/web/audio/{song_id}.opus") for line in staged)
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
            manifiesto: object = True, faltan: tuple[int, ...] = (), album: dict | None = None) -> list[str]:
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
        contenido = {"nombre": nombre, "partes": partes, **({"album": album} if album else {})} \
            if manifiesto is True else manifiesto
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
        {"nombre": "Vals.opus", "partes": 2, "album": {"id": "../x", "name": "Playlist"}},
        {"nombre": "Vals.opus", "partes": 2, "album": {"id": "PL123", "name": ""}},
        {"nombre": "Vals.opus", "partes": 2, "album": {"id": "PL123", "name": "x" * 201}},
        {"nombre": "Vals.opus", "partes": 2, "album": {"id": "PL123", "name": "Album", "extra": 1}},
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


def test_playlist_crea_un_album_estable_y_asocia_todas_las_canciones_publicas(repo, tmp_path):
    album = {"id": "PLVU-jIOit29A", "name": "Nuestro desacato"}
    first = make_tone(tmp_path / "uno.opus", seconds=1.0, sample_rate=48000, frequency=440).read_bytes()
    second = make_tone(tmp_path / "dos.opus", seconds=1.0, sample_rate=48000, frequency=660).read_bytes()
    first_id = UPLOAD_ID
    second_id = "1f8fad5b-d9cb-469f-a165-70867728950e"
    first_paths = _trozos(repo, first, 1, upload_id=first_id, nombre="Cada vez.opus", album=album)
    second_paths = _trozos(repo, second, 1, upload_id=second_id, nombre="Cuando salga el sol.opus", album=album)
    rutas = first_paths + second_paths
    _commit(repo, LICENCIA_WEB)

    result = procesar_buzon(repo=repo, event=_evento((LICENCIA_WEB, rutas)), actor="ana")

    assert len(result["publicas"]) == 2
    data = _catalogo(repo)
    [folder] = [item for item in data["folders"] if item.get("youtube_playlist_id") == album["id"]]
    assert folder["name"] == "Nuestro desacato"
    assert folder["youtube_playlist_id"] == album["id"]
    assert folder["id"].startswith("F") and len(folder["id"]) == 17
    songs = [song for song in data["songs"] if song["id"] in {item["song_id"] for item in result["publicas"]}]
    assert len(songs) == 2
    assert all(song["folder_id"] == folder["id"] and song["public"] is True for song in songs)
    published_folders = json.loads((repo / "frontend" / "web" / "data" / "folders.json").read_text(encoding="utf-8"))
    assert {"id": folder["id"], "name": "Nuestro desacato", "parent_id": None} in published_folders
    assert all("youtube_playlist_id" not in item for item in published_folders)


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
    assert f"A\taudio-library/audio/{song_id}.opus" in staged


# --- ZIP con canciones ---------------------------------------------------------------------------------------------


def _tono(tmp_path: Path, extension: str, frequency: int) -> bytes:
    rate = 48000 if extension == ".opus" else 44100  # libopus solo codifica a 48 kHz (y submúltiplos)
    destino = tmp_path / "tonos" / f"{frequency}{extension}"
    return make_tone(destino, seconds=0.5, frequency=frequency, sample_rate=rate).read_bytes()


def _zip(repo: Path, nombre: str, entradas: list[tuple], *, compression: int = zipfile.ZIP_DEFLATED) -> str:
    """Escribe audio-library/buzon/<nombre> con las entradas (nombre o ZipInfo, bytes)."""
    destino = repo / BUZON / nombre
    with zipfile.ZipFile(destino, "w", compression=compression) as archive:
        for entrada, data in entradas:
            if isinstance(entrada, zipfile.ZipInfo):
                entrada.compress_type = compression
            archive.writestr(entrada, data)
    return f"{BUZON}/{nombre}"


def _estado(repo: Path) -> list[str]:
    salida = _git(repo, "-c", "core.quotePath=false", "status", "--porcelain", "-z", "--untracked-files=all")
    return sorted(item[3:] for item in salida.split("\0") if item)


@pytest.mark.parametrize("compression", [zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED])
def test_un_zip_publica_cada_cancion_con_el_nombre_de_su_archivo_y_se_borra(repo, tmp_path, compression):
    enlace = zipfile.ZipInfo("Disco/enlace.mp3")
    enlace.external_attr = (0o120777 << 16)
    ruta = _zip(repo, "Álbum de 1960.zip", [
        ("Disco/", b""),
        ("Disco/Cara A/01 Vals.mp3", _tono(tmp_path, ".mp3", 300)),
        ("Disco/Cara B/02 Copla.FLAC", _tono(tmp_path, ".flac", 350)),
        ("Bolero.wav", _tono(tmp_path, ".wav", 400)),
        ("Tango.m4a", _tono(tmp_path, ".m4a", 450)),
        ("Disco/Pasodoble.ogg", _tono(tmp_path, ".ogg", 500)),
        ("Nana.opus", _tono(tmp_path, ".opus", 550)),
        ("__MACOSX/Disco/._01 Vals.mp3", b"\x00\x05\x16\x07basura de macOS"),
        ("Disco/.DS_Store", b"basura"),
        ("Disco/._Bolero.wav", b"basura"),
        ("Disco/portada.jpg", b"\xff\xd8\xff no es audio"),
        ("notas.txt", b"hola"),
        (enlace, b"../../indexes/catalog.json"),
    ], compression=compression)
    _commit(repo, CON_LICENCIA)

    result = procesar_buzon(repo=repo, event=_evento((CON_LICENCIA, [ruta])), actor="ana")

    titulos = {item["titulo"] for item in result["publicas"]}
    # El título es el nombre del archivo, limpio (ADR-0032): sin el número de pista.
    assert titulos == {"Vals", "Copla", "Bolero", "Tango", "Pasodoble", "Nana"}
    assert {item["archivo"] for item in result["publicas"]} == {
        "Álbum de 1960.zip/01 Vals.mp3", "Álbum de 1960.zip/02 Copla.FLAC", "Álbum de 1960.zip/Bolero.wav",
        "Álbum de 1960.zip/Tango.m4a", "Álbum de 1960.zip/Pasodoble.ogg", "Álbum de 1960.zip/Nana.opus",
    }
    for item in result["publicas"]:
        song = _cancion(repo, item["song_id"])
        assert song["public"] is True and song["license"] == "CC BY 4.0 (grabación propia)"
        assert song["source"] == "Subida por ana"
        assert (repo / "audio-library/audio" / f"{song['id']}.opus").stat().st_size > 0
        assert not (repo / "frontend/web/audio" / f"{song['id']}.opus").exists()
    assert result["zips"] == [{
        "archivo": "Álbum de 1960.zip", "canciones": 6,
        "ignorados": {"carpetas": 1, "macosx": 1, "ocultos": 2, "enlaces": 1, "no_audio": 2},
    }]
    assert result["rechazados"] == result["revisar"] == []
    assert not (repo / ruta).exists()
    # Del ZIP solo llegan al repositorio el audio convertido y el catálogo: nada extraído ni temporal.
    ids = {item["song_id"] for item in result["publicas"]}
    permitidas = {
        ruta, CATALOG, *(f"audio-library/audio/{song_id}.opus" for song_id in ids),
        *(f"frontend/web/data/{name}" for name in ("songs.json", "folders.json", "catalog.json")),
    }
    estado = set(_estado(repo))
    assert estado <= permitidas
    assert {ruta, CATALOG, *(f"audio-library/audio/{song_id}.opus" for song_id in ids)} <= estado
    resumen = buzon.resumen_markdown(result)
    assert "ZIP descomprimidos" in resumen and "6 canción(es)" in resumen and "2 que no son audio" in resumen


def test_un_zip_sin_licencia_entra_privado_y_las_repetidas_no_se_duplican(repo, tmp_path):
    tono = _tono(tmp_path, ".wav", 600)
    ruta = _zip(repo, "privado.zip", [("a/Uno.wav", tono), ("b/Uno.wav", tono), ("Dos.wav", _tono(tmp_path, ".wav", 650))])
    _commit(repo, SIN_LICENCIA)

    result = procesar_buzon(repo=repo, event=_evento((SIN_LICENCIA, [ruta])), actor="ana")

    assert sorted(item["titulo"] for item in result["privadas"]) == ["Dos", "Uno"]
    assert [item["titulo"] for item in result["duplicadas"]] == ["Uno"]
    assert all(_cancion(repo, item["song_id"])["public"] is False for item in result["privadas"])
    assert not (repo / ruta).exists()


def test_un_zip_con_rutas_peligrosas_nunca_escribe_fuera_y_usa_solo_el_nombre_base(repo, tmp_path):
    tono = _tono(tmp_path, ".wav", 700)
    ruta = _zip(repo, "trampa.zip", [
        ("../../../../evil.wav", tono),
        ("/tmp/absoluta.wav", tono),
        ("C:/Windows/disco.wav", tono),
        ("..\\..\\invertida.wav", tono),
        ("bien/../../fuera.wav", tono),
        ("carpeta/../../audio-library/indexes/catalog.json", b"{}"),
        ("../../audio-library/audio/Sdeadbeefdeadbeef.opus", tono),
        ("dentro/Buena.wav", _tono(tmp_path, ".wav", 750)),
    ])
    _commit(repo, CON_LICENCIA)
    antes = _catalogo(repo)

    result = procesar_buzon(repo=repo, event=_evento((CON_LICENCIA, [ruta])), actor="ana")

    assert [item["titulo"] for item in result["publicas"]] == ["Buena"]
    assert result["zips"][0]["ignorados"] == {"rutas_peligrosas": 7}
    assert len(_catalogo(repo)["songs"]) == len(antes["songs"]) + 1
    for nombre in ("evil.wav", "absoluta.wav", "disco.wav", "invertida.wav", "fuera.wav"):
        assert not list(tmp_path.rglob(nombre)), nombre
        assert not (Path(tempfile.gettempdir()) / nombre).exists(), nombre
    assert not (repo / "audio-library/audio/Sdeadbeefdeadbeef.opus").exists()


def test_un_zip_danado_se_rechaza_entero_y_se_borra(repo, tmp_path):
    ruta = _zip(repo, "roto.zip", [("Uno.wav", _tono(tmp_path, ".wav", 800)), ("Dos.wav", _tono(tmp_path, ".wav", 850))],
                compression=zipfile.ZIP_STORED)
    data = bytearray((repo / ruta).read_bytes())
    data[len(data) // 2] ^= 0xFF  # un byte del audio de dentro: el CRC ya no cuadra
    (repo / ruta).write_bytes(bytes(data))
    (repo / BUZON / "falso.zip").write_bytes(b"esto no es un zip")
    (repo / BUZON / "vacio.zip").write_bytes(b"")
    _commit(repo, CON_LICENCIA)
    antes = _catalogo(repo)

    result = procesar_buzon(
        repo=repo, event=_evento((CON_LICENCIA, [ruta, f"{BUZON}/falso.zip", f"{BUZON}/vacio.zip"])), actor="ana",
    )

    motivos = {item["archivo"]: item["motivo"] for item in result["rechazados"]}
    assert set(motivos) == {"roto.zip", "falso.zip", "vacio.zip"}
    assert "dañado" in motivos["roto.zip"] and "dañado" in motivos["falso.zip"]
    assert result["publicas"] == result["zips"] == []
    assert _catalogo(repo) == antes
    assert sorted(path.name for path in (repo / BUZON).iterdir()) == ["README.md"]


def test_un_zip_cifrado_se_rechaza_y_se_borra(repo, tmp_path):
    ruta = _zip(repo, "cifrado.zip", [("Secreta.wav", _tono(tmp_path, ".wav", 900)), ("Abierta.wav", _tono(tmp_path, ".wav", 950))],
                compression=zipfile.ZIP_STORED)
    # zipfile no escribe ZIP cifrados: se marca la primera entrada como cifrada en su cabecera local y en el directorio
    # central (bit 0 de los indicadores), como la dejaría un compresor con contraseña.
    data = bytearray((repo / ruta).read_bytes())
    assert data[:4] == b"PK\x03\x04"
    data[6] |= 0x1
    central = data.index(b"PK\x01\x02")
    data[central + 8] |= 0x1
    (repo / ruta).write_bytes(bytes(data))
    _commit(repo, CON_LICENCIA)
    antes = _catalogo(repo)

    result = procesar_buzon(repo=repo, event=_evento((CON_LICENCIA, [ruta])), actor="ana")

    assert result["rechazados"] == [
        {"archivo": "cifrado.zip", "motivo": "el ZIP está cifrado (con contraseña): no se puede descomprimir"},
    ]
    assert _catalogo(repo) == antes
    assert not (repo / ruta).exists()


def test_una_entrada_del_zip_que_no_es_audio_aunque_lo_parezca_se_rechaza_sin_parar_las_demas(repo, tmp_path):
    ruta = _zip(repo, "mezcla.zip", [("falso.mp3", b"no es audio"), ("vacio.wav", b""), ("Real.wav", _tono(tmp_path, ".wav", 1000))])
    _commit(repo, CON_LICENCIA)

    result = procesar_buzon(repo=repo, event=_evento((CON_LICENCIA, [ruta])), actor="ana")

    motivos = {item["archivo"]: item["motivo"] for item in result["rechazados"]}
    assert motivos == {"mezcla.zip/falso.mp3": "no es audio (ffprobe no encuentra una pista de audio)",
                       "mezcla.zip/vacio.wav": "está vacío"}
    assert [item["titulo"] for item in result["publicas"]] == ["Real"]
    assert result["zips"][0]["canciones"] == 3


def test_los_nombres_de_dentro_del_zip_se_limpian_para_el_titulo(repo, tmp_path):
    ruta = _zip(repo, "raros.zip", [("x/Can\u202eción\u0007 rara.wav", _tono(tmp_path, ".wav", 1050)),
                                    ("\u200b.mp3", _tono(tmp_path, ".mp3", 1100))])
    _commit(repo, CON_LICENCIA)

    result = procesar_buzon(repo=repo, event=_evento((CON_LICENCIA, [ruta])), actor="ana")

    assert sorted(item["titulo"] for item in result["publicas"]) == ["Can ción rara", "Sin título"]
    assert all(not buzon._has_control(item["archivo"]) for item in result["publicas"])


def test_un_nombre_utf8_sin_la_marca_se_lee_como_utf8():
    info = zipfile.ZipInfo("Canción.mp3".encode("utf-8").decode("cp437"))
    info.flag_bits = 0
    assert buzon.clasificar_entrada(info) == (None, "Canción.mp3")
    info = zipfile.ZipInfo("Carpeta/Ñu.wav")
    info.flag_bits = 0x800
    assert buzon.clasificar_entrada(info) == (None, "Ñu.wav")


def test_procesar_empaquetar_y_publicar_un_zip(repo, tmp_path):
    ruta = _zip(repo, "Recuerdos.zip", [("CD1/Vals.wav", _tono(tmp_path, ".wav", 1200))])
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

    paquete.publish_package(package, repo, head=paquete.head_commit(repo))

    staged = _git(repo, "diff", "--cached", "--name-status", "--no-renames").splitlines()
    assert f"D\t{ruta}" in staged
    assert f"A\taudio-library/audio/{song_id}.opus" in staged


def test_subida_por_trozos_guarda_artista_y_asocia_la_cancion_al_album(repo, tmp_path):
    upload_id = "123e4567-e89b-12d3-a456-426614174000"
    parts = repo / BUZON / ".partes" / upload_id
    parts.mkdir(parents=True)
    (parts / "0.part").write_bytes(_tono(tmp_path, ".wav", 1250))
    manifest_path = f"{BUZON}/.partes/{upload_id}/manifiesto.json"
    (parts / "manifiesto.json").write_text(json.dumps({
        "nombre": "Cada vez.opus",
        "partes": 1,
        "album": {"id": "PLVU-jIOit29A", "name": "Nuestro desacato"},
        "artist": "Desakato",
    }), encoding="utf-8")
    _commit(repo, CON_LICENCIA)

    result = procesar_buzon(
        repo=repo,
        event=_evento((CON_LICENCIA, [manifest_path])),
        actor="ana",
    )

    song_id = result["publicas"][0]["song_id"]
    song = _cancion(repo, song_id)
    folder = next(
        folder for folder in _catalogo(repo)["folders"]
        if folder.get("youtube_playlist_id") == "PLVU-jIOit29A"
    )
    assert song["title"] == "Cada vez"
    assert song["artist"] == "Desakato"
    assert song["folder_id"] == folder["id"]
    assert folder["name"] == "Nuestro desacato"
