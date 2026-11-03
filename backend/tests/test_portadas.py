"""Portadas de canciones y de álbumes (ADR-0016): conversión real con ffmpeg (imágenes sintéticas), buzón de portadas,
parte pública y paquete. Git real, sin red ni remoto."""

import base64
import json
import os
import subprocess
from pathlib import Path

import pytest

from conftest import SONG_ID, make_tone
from sonidos import catalog, paquete
from sonidos.buzon import procesar_buzon, resumen_markdown
from sonidos.hashing import sha256_file
from sonidos.paquete import PaqueteError, borrado_permitido, ruta_derivada, ruta_permitida
from sonidos.portadas import PortadaError, convertir_portada, cover_ref, formato_por_firma
from sonidos.publish import sync_public

CATALOG = "audio-library/indexes/catalog.json"
BUZON = "audio-library/buzon"
PORTADAS = "audio-library/buzon/portadas"
COVERS = "audio-library/covers"
WEB_COVERS = "frontend/web/covers"
# WebP sin pérdida de 1×1 píxel (el ffmpeg local puede no tener codificador WebP, pero sí decodificador).
WEBP_1X1 = base64.b64decode("UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==")


def _git(repo: Path, *args: str) -> str:
    return subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True, text=True).stdout


def _commit(repo: Path, message: str = "subida") -> None:
    _git(repo, "add", "-A")
    _git(repo, "-c", "user.name=prueba", "-c", "user.email=prueba@example.invalid", "commit", "-q", "-m", message)


def _evento(*paths: str, message: str = "Add files via upload") -> dict:
    return {"commits": [{"message": message, "added": list(paths), "modified": [], "removed": []}]}


def _imagen(destination: Path, *, size: str = "1000x700", codec: str = "png") -> Path:
    """Imagen sintética (patrón de prueba de ffmpeg): no es la portada de ningún disco."""
    destination.parent.mkdir(parents=True, exist_ok=True)
    muxer = {"png": ["-c:v", "png", "-f", "image2"], "jpg": ["-c:v", "mjpeg", "-pix_fmt", "yuvj420p", "-f", "image2"]}
    subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", f"testsrc2=size={size}:duration=1", "-frames:v", "1",
         *muxer[codec], str(destination)],
        check=True,
    )
    return destination


def _probe(path: Path) -> dict:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "stream=codec_name,width,height,pix_fmt", "-of", "json", str(path)],
        check=True, capture_output=True, text=True,
    ).stdout
    return json.loads(out)["streams"][0]


def _json(repo: Path, ruta: str):
    return json.loads((repo / ruta).read_text(encoding="utf-8"))


@pytest.fixture
def repo(main_publicado: Path) -> Path:
    """main con una canción pública (SONG_ID) en la carpeta «Jazz» y el buzón con su README, ya confirmado."""
    (main_publicado / BUZON).mkdir(parents=True)
    (main_publicado / BUZON / "README.md").write_text("buzón\n", encoding="utf-8")
    _commit(main_publicado, "buzón")
    return main_publicado


def _folder_id(repo: Path) -> str:
    return _json(repo, CATALOG)["folders"][0]["id"]


# --- Conversión --------------------------------------------------------------------------------------------------


def test_un_png_sintetico_se_convierte_en_un_jpeg_de_640x640(tmp_path):
    source = _imagen(tmp_path / "fuente.png")

    produced = convertir_portada(source, tmp_path / "salida" / "portada.jpg")

    info = _probe(produced)
    assert info["codec_name"] == "mjpeg" and info["width"] == 640 and info["height"] == 640
    data = produced.read_bytes()
    assert data.startswith(b"\xff\xd8\xff")
    assert b"Exif" not in data and b"Lavc" not in data  # sin metadatos ni firma del codificador


def test_la_conversion_es_determinista_y_recorta_al_centro(tmp_path):
    vertical = _imagen(tmp_path / "vertical.png", size="300x900")

    first = convertir_portada(vertical, tmp_path / "a.jpg").read_bytes()
    second = convertir_portada(vertical, tmp_path / "b.jpg").read_bytes()

    assert first == second
    assert _probe(tmp_path / "a.jpg")["width"] == 640


def test_jpeg_y_webp_tambien_se_convierten(tmp_path):
    jpeg = _imagen(tmp_path / "fuente.jpg", codec="jpg")
    webp = tmp_path / "fuente.webp"
    webp.write_bytes(WEBP_1X1)

    for source in (jpeg, webp):
        info = _probe(convertir_portada(source, tmp_path / f"{source.suffix[1:]}.jpg"))
        assert (info["width"], info["height"]) == (640, 640)


def test_el_formato_se_elige_por_la_firma_no_por_la_extension(tmp_path):
    assert formato_por_firma(b"\x89PNG\r\n\x1a\n....") == ("png_pipe", "png")
    assert formato_por_firma(b"\xff\xd8\xff\xe0") == ("jpeg_pipe", "mjpeg")
    assert formato_por_firma(WEBP_1X1[:16]) == ("webp_pipe", "webp")
    assert formato_por_firma(b"GIF89a") is None
    assert formato_por_firma(b"#EXTM3U\nhttp://") is None  # una lista de reproducción nunca llega a ffmpeg
    png_con_nombre_jpg = _imagen(tmp_path / "x.png")
    renombrado = png_con_nombre_jpg.rename(tmp_path / "x.jpg")
    assert _probe(convertir_portada(renombrado, tmp_path / "y.jpg"))["width"] == 640


@pytest.mark.parametrize(
    "contenido",
    [b"hola, no soy una imagen", b"\x89PNG\r\n\x1a\n" + b"\x00" * 200, b"\xff\xd8\xff" + b"\x13" * 100, b"GIF89a" + b"\0" * 20],
)
def test_lo_que_no_es_una_imagen_valida_se_rechaza(tmp_path, contenido):
    source = tmp_path / "falsa.png"
    source.write_bytes(contenido)

    with pytest.raises(PortadaError):
        convertir_portada(source, tmp_path / "salida.jpg")
    assert not (tmp_path / "salida.jpg").exists()


def test_una_imagen_con_mas_pixeles_del_limite_se_rechaza_sin_convertir(tmp_path, monkeypatch):
    from sonidos import portadas

    monkeypatch.setattr(portadas, "MAX_SOURCE_PIXELS", 1000)
    with pytest.raises(PortadaError, match="demasiado grande"):
        convertir_portada(_imagen(tmp_path / "grande.png", size="64x64"), tmp_path / "salida.jpg")


def test_cover_ref_solo_admite_ids_de_cancion_o_de_carpeta():
    assert cover_ref(SONG_ID) == f"covers/{SONG_ID}.jpg"
    assert cover_ref("F0123456789abcdef") == "covers/F0123456789abcdef.jpg"
    for malo in ("0123456789", "../x", "S0123", "F0123456789ABCDEF", None):
        with pytest.raises(ValueError):
            cover_ref(malo)


# --- Buzón de portadas -------------------------------------------------------------------------------------------


def test_la_portada_de_una_cancion_publica_llega_al_catalogo_y_a_la_web(repo):
    ruta = f"{PORTADAS}/{SONG_ID}.png"
    _imagen(repo / ruta)
    _commit(repo)

    result = procesar_buzon(repo=repo, event=_evento(ruta), actor="ana")

    assert result["portadas"] == [{"archivo": f"portadas/{SONG_ID}.png", "id": SONG_ID, "tipo": "canción", "nueva": True}]
    assert not (repo / ruta).exists()
    assert _probe(repo / COVERS / f"{SONG_ID}.jpg")["width"] == 640
    song = next(song for song in _json(repo, CATALOG)["songs"] if song["id"] == SONG_ID)
    assert song["cover"] == f"covers/{SONG_ID}.jpg"
    assert (repo / WEB_COVERS / f"{SONG_ID}.jpg").read_bytes() == (repo / COVERS / f"{SONG_ID}.jpg").read_bytes()
    [publica] = _json(repo, "frontend/web/data/songs.json")
    assert publica["cover"] == f"covers/{SONG_ID}.jpg"
    assert _json(repo, "frontend/web/data/catalog.json")["songs"][0]["cover"] == f"covers/{SONG_ID}.jpg"
    assert "Portadas" in resumen_markdown(result)


def test_la_portada_de_una_carpeta_sale_en_folders_y_catalog(repo):
    folder_id = _folder_id(repo)
    assert folder_id.startswith("F") and len(folder_id) == 17
    ruta = f"{PORTADAS}/{folder_id}.JPG"
    _imagen(repo / ruta, codec="jpg")
    _commit(repo)

    result = procesar_buzon(repo=repo, event=_evento(ruta), actor="ana")

    assert result["portadas"][0]["tipo"] == "carpeta"
    [carpeta] = _json(repo, "frontend/web/data/folders.json")
    assert carpeta["cover"] == f"covers/{folder_id}.jpg"
    assert _json(repo, "frontend/web/data/catalog.json")["folders"] == [carpeta]
    assert (repo / WEB_COVERS / f"{folder_id}.jpg").is_file()


def test_la_portada_de_una_cancion_privada_no_se_publica(repo):
    data = _json(repo, CATALOG)
    catalog.update_song(data, SONG_ID, {"public": False})
    catalog.save(repo / CATALOG, data)
    ruta = f"{PORTADAS}/{SONG_ID}.png"
    _imagen(repo / ruta)
    _commit(repo)

    procesar_buzon(repo=repo, event=_evento(ruta), actor="ana")

    assert (repo / COVERS / f"{SONG_ID}.jpg").is_file()
    assert not (repo / WEB_COVERS / f"{SONG_ID}.jpg").exists()
    assert SONG_ID not in (repo / "frontend/web/data/catalog.json").read_text(encoding="utf-8")


def test_una_portada_puede_ser_de_una_cancion_que_entra_en_el_mismo_push(repo):
    # El id de una canción sale de la huella del archivo subido: quien sube puede calcularlo antes.
    wav = make_tone(repo / BUZON / "Vals.wav", seconds=1.0, frequency=523)
    song_id = catalog.song_id_for(sha256_file(wav))
    _imagen(repo / PORTADAS / f"{song_id}.png")
    _commit(repo)

    result = procesar_buzon(
        repo=repo, event=_evento(f"{BUZON}/Vals.wav", f"{PORTADAS}/{song_id}.png"), actor="ana",
    )

    assert result["privadas"][0]["song_id"] == song_id
    assert result["portadas"][0]["id"] == song_id
    song = next(song for song in _json(repo, CATALOG)["songs"] if song["id"] == song_id)
    assert song["cover"] == f"covers/{song_id}.jpg"


def test_subir_la_misma_portada_otra_vez_no_cambia_nada(repo):
    ruta = f"{PORTADAS}/{SONG_ID}.png"
    _imagen(repo / ruta)
    _commit(repo)
    procesar_buzon(repo=repo, event=_evento(ruta), actor="ana")
    _commit(repo, "procesado")
    _imagen(repo / ruta)
    _commit(repo)

    result = procesar_buzon(repo=repo, event=_evento(ruta), actor="ana")

    assert result["portadas"][0]["nueva"] is False
    assert "sin cambios" in resumen_markdown(result)
    estado = _git(repo, "status", "--porcelain").splitlines()
    assert estado == [f" D {ruta}"]


@pytest.mark.parametrize(
    "nombre, contenido, motivo",
    [
        ("Sffffffffffffffff.png", None, "no hay ninguna canción ni carpeta"),
        ("Fffffffffffffffff.webp", None, "no hay ninguna canción ni carpeta"),
        ("portada del disco.jpg", None, "el nombre no es"),
        (f"{SONG_ID}.gif", None, "el nombre no es"),
        (f"{SONG_ID.upper()}.png", None, "el nombre no es"),
        ("0123456789.png", None, "el nombre no es"),  # carpeta antigua de 10 hexadecimales: sin portada
        (f"{SONG_ID}.png", b"no es una imagen", "no es una imagen"),
        (f"{SONG_ID}.jpg", b"", "está vacío"),
    ],
)
def test_lo_que_no_vale_como_portada_se_rechaza_y_se_borra(repo, nombre, contenido, motivo):
    ruta = f"{PORTADAS}/{nombre}"
    if contenido is None:
        _imagen(repo / ruta)
    else:
        (repo / ruta).parent.mkdir(parents=True, exist_ok=True)
        (repo / ruta).write_bytes(contenido)
    _commit(repo)
    antes = (repo / CATALOG).read_bytes()

    result = procesar_buzon(repo=repo, event=_evento(ruta), actor="ana")

    [rechazo] = result["rechazados"]
    assert rechazo["archivo"] == f"portadas/{nombre}" and motivo in rechazo["motivo"]
    assert not (repo / ruta).exists()
    assert (repo / CATALOG).read_bytes() == antes
    assert not (repo / COVERS).exists()


def test_mas_de_10_mb_se_rechaza(repo):
    ruta = f"{PORTADAS}/{SONG_ID}.png"
    (repo / PORTADAS).mkdir(parents=True)
    with (repo / ruta).open("wb") as handle:
        handle.write(b"\x89PNG\r\n\x1a\n")
        handle.truncate(10 * 1024 * 1024 + 1)
    _commit(repo)

    result = procesar_buzon(repo=repo, event=_evento(ruta), actor="ana")

    assert result["rechazados"][0]["motivo"] == "pasa de 10 MB"
    assert not (repo / ruta).exists()


def test_enlaces_y_subcarpetas_de_portadas_se_dejan_para_revisar(repo, tmp_path):
    fuera = _imagen(tmp_path / "fuera.png")
    (repo / PORTADAS / "sub").mkdir(parents=True)
    _imagen(repo / PORTADAS / "sub" / f"{SONG_ID}.png")
    os.symlink(fuera, repo / PORTADAS / f"{SONG_ID}.png")
    _commit(repo)

    result = procesar_buzon(
        repo=repo, event=_evento(f"{PORTADAS}/sub/{SONG_ID}.png", f"{PORTADAS}/{SONG_ID}.png"), actor="ana",
    )

    assert sorted(item["motivo"] for item in result["revisar"]) == [
        "enlace simbólico", "subcarpeta dentro de las portadas del buzón",
    ]
    assert result["portadas"] == []
    assert (repo / PORTADAS / f"{SONG_ID}.png").is_symlink()


def test_una_carpeta_de_portadas_que_es_un_enlace_detiene_el_procesado(repo, tmp_path):
    (tmp_path / "otra").mkdir()
    os.symlink(tmp_path / "otra", repo / PORTADAS)

    with pytest.raises(ValueError, match="enlace simbólico"):
        procesar_buzon(repo=repo, event=_evento(f"{PORTADAS}/{SONG_ID}.png"), actor="ana")


def test_sin_listas_en_el_evento_tambien_se_procesan_las_portadas_pendientes(repo):
    _imagen(repo / PORTADAS / f"{SONG_ID}.png")
    _commit(repo)

    result = procesar_buzon(repo=repo, event={"ref": "refs/heads/main"}, actor="ana")

    assert result["portadas"][0]["id"] == SONG_ID


# --- Parte pública -----------------------------------------------------------------------------------------------


def test_sync_public_quita_las_portadas_que_sobran_y_rechaza_rutas_forjadas(repo):
    web = repo / "frontend" / "web"
    (web / "covers").mkdir(parents=True, exist_ok=True)
    (web / "covers" / "Saaaaaaaaaaaaaaaa.jpg").write_bytes(b"vieja")
    (web / "covers" / "LEEME.txt").write_text("no es una portada")

    result = sync_public(catalog_path=repo / CATALOG, audio_dir=repo / "audio-library/audio", web_dir=web)

    assert result["covers"] == 0
    assert not (web / "covers" / "Saaaaaaaaaaaaaaaa.jpg").exists()
    assert (web / "covers" / "LEEME.txt").exists()  # solo se borra lo que tiene nombre de portada

    data = _json(repo, CATALOG)
    data["songs"][0]["cover"] = "../../index.html"
    catalog.save(repo / CATALOG, data)
    with pytest.raises(ValueError, match="portada no válida"):
        sync_public(catalog_path=repo / CATALOG, audio_dir=repo / "audio-library/audio", web_dir=web)


def test_sync_public_falla_si_falta_el_fichero_de_una_portada(repo):
    data = _json(repo, CATALOG)
    catalog.set_cover(data, SONG_ID, cover_ref(SONG_ID))
    catalog.save(repo / CATALOG, data)

    with pytest.raises(FileNotFoundError, match="portada"):
        sync_public(catalog_path=repo / CATALOG, audio_dir=repo / "audio-library/audio", web_dir=repo / "frontend/web")


def test_artista_de_la_carpeta_en_folders_y_sin_campos_vacios(tmp_path):
    data = catalog.empty()
    album = catalog.create_folder(data, "Discos de pizarra", artist=" Carlos Gardel ")
    otra = catalog.create_folder(data, "Sueltas", artist="")
    path = tmp_path / "catalog.json"
    catalog.save(path, data)

    sync_public(catalog_path=path, audio_dir=tmp_path / "audio", web_dir=tmp_path / "web")

    folders = json.loads((tmp_path / "web" / "data" / "folders.json").read_text(encoding="utf-8"))
    assert folders == [
        {"id": album["id"], "name": "Discos de pizarra", "parent_id": None, "artist": "Carlos Gardel"},
        {"id": otra["id"], "name": "Sueltas", "parent_id": None},
    ]


# --- Catálogo ----------------------------------------------------------------------------------------------------


def test_carpetas_nuevas_con_id_f_y_album_por_nombre_y_artista():
    data = catalog.empty()
    a = catalog.create_folder(data, "Grandes éxitos", artist="Concha Piquer")
    b = catalog.create_folder(data, "Grandes éxitos", artist="Antonio Machín")
    again = catalog.create_folder(data, "Grandes éxitos", artist="Concha Piquer")

    assert a["id"].startswith("F") and len(a["id"]) == 17
    assert a is again and a is not b and len(data["folders"]) == 2

    catalog.edit_folder(data, a["id"], "Éxitos", "")
    assert a == {"id": a["id"], "name": "Éxitos", "parent_id": None}
    catalog.edit_folder(data, b["id"], "Boleros")
    assert b["artist"] == "Antonio Machín"


def test_set_cover_falla_con_un_id_que_no_existe():
    with pytest.raises(catalog.CatalogError):
        catalog.set_cover(catalog.empty(), SONG_ID, cover_ref(SONG_ID))


# --- Paquete -----------------------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "ruta",
    [f"{COVERS}/{SONG_ID}.jpg", f"{COVERS}/F0123456789abcdef.jpg", f"{WEB_COVERS}/{SONG_ID}.jpg",
     f"{PORTADAS}/{SONG_ID}.png"],
)
def test_rutas_de_portadas_permitidas(ruta):
    assert ruta_permitida(ruta)


@pytest.mark.parametrize(
    "ruta",
    [f"{COVERS}/{SONG_ID}.png", f"{COVERS}/{SONG_ID}.svg", f"{WEB_COVERS}/index.html", f"{WEB_COVERS}/x.jpg",
     f"{WEB_COVERS}/sub/{SONG_ID}.jpg", f"{COVERS}/0123456789.jpg", f"{PORTADAS}/README.md", "frontend/web/covers.jpg"],
)
def test_rutas_de_portadas_no_permitidas(ruta):
    assert not ruta_permitida(ruta)


def test_las_portadas_se_pueden_borrar_y_las_publicadas_se_regeneran():
    assert borrado_permitido(f"{COVERS}/{SONG_ID}.jpg")
    assert borrado_permitido(f"{WEB_COVERS}/{SONG_ID}.jpg")
    assert ruta_derivada(f"{WEB_COVERS}/{SONG_ID}.jpg")
    assert not ruta_derivada(f"{COVERS}/{SONG_ID}.jpg")


def test_procesar_empaquetar_y_publicar_una_portada(repo, tmp_path):
    ruta = f"{PORTADAS}/{SONG_ID}.png"
    _imagen(repo / ruta)
    _commit(repo)
    trabajo = tmp_path / "procesar"
    subprocess.run(["git", "clone", "-q", str(repo), str(trabajo)], check=True)

    procesar_buzon(repo=trabajo, event=_evento(ruta), actor="ana")
    package = tmp_path / "paquete"
    paquete.package_processing_changes(trabajo, package, action="buzon")
    manifiesto = json.loads((package / "manifiesto.json").read_text(encoding="utf-8"))
    assert {(item["ruta"], item["estado"]) for item in manifiesto["cambios"]} == {
        (ruta, "D"), (CATALOG, "M"), (f"{COVERS}/{SONG_ID}.jpg", "A"),
    }

    summary = paquete.publish_package(package, repo, head=paquete.head_commit(repo))

    staged = _git(repo, "diff", "--cached", "--name-status", "--no-renames").splitlines()
    assert f"D\t{ruta}" in staged
    assert f"A\t{COVERS}/{SONG_ID}.jpg" in staged
    assert f"A\t{WEB_COVERS}/{SONG_ID}.jpg" in staged
    assert "M\tfrontend/web/data/songs.json" in staged
    assert summary["parte_publica"]["regenerados"] == sorted([
        "frontend/web/data/catalog.json", "frontend/web/data/songs.json", f"{WEB_COVERS}/{SONG_ID}.jpg",
    ])


def test_un_paquete_que_trae_una_portada_publicada_forjada_se_sustituye(repo, tmp_path):
    ruta = f"{PORTADAS}/{SONG_ID}.png"
    _imagen(repo / ruta)
    _commit(repo)
    trabajo = tmp_path / "procesar"
    subprocess.run(["git", "clone", "-q", str(repo), str(trabajo)], check=True)
    procesar_buzon(repo=trabajo, event=_evento(ruta), actor="ana")
    (trabajo / WEB_COVERS / f"{SONG_ID}.jpg").write_bytes(b"forjada")
    package = tmp_path / "paquete"
    paquete.package_changes(trabajo, package, action="buzon")  # con la parte pública, como un paquete forjado

    summary = paquete.publish_package(package, repo, head=paquete.head_commit(repo))

    assert (repo / WEB_COVERS / f"{SONG_ID}.jpg").read_bytes() == (repo / COVERS / f"{SONG_ID}.jpg").read_bytes()
    assert f"{WEB_COVERS}/{SONG_ID}.jpg" in summary["parte_publica"]["sustituidos_del_paquete"]


def test_publicar_rechaza_una_carpeta_de_portadas_que_es_un_enlace(main_publicado, tmp_path):
    (tmp_path / "fuera").mkdir()
    os.symlink(tmp_path / "fuera", main_publicado / COVERS)
    package = tmp_path / "paquete"
    package.mkdir()
    (package / "manifiesto.json").write_text(json.dumps({
        "base": paquete.head_commit(main_publicado), "accion": "organize", "cambios": [],
    }), encoding="utf-8")

    with pytest.raises(PaqueteError, match="enlace simbólico"):
        paquete.publish_package(package, main_publicado, head=paquete.head_commit(main_publicado))
