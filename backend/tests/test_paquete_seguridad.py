"""Lo que un paquete del procesado puede publicar o borrar (ADR-0008). Un paquete forjado no puede dejar HTML,
SVG ni JS en la web, ni borrar el catálogo ni los datos públicos."""

import json

import pytest

from sonidos.paquete import PaqueteError, borrado_permitido, read_manifest, ruta_permitida

AUDIO = "S80253b94dd183be7.opus"
HEAD = "a" * 40


@pytest.mark.parametrize(
    "ruta",
    [
        "frontend/web/data/songs.json",
        "frontend/web/data/folders.json",
        "frontend/web/data/catalog.json",
        f"frontend/web/audio/{AUDIO}",
        f"audio-library/audio/{AUDIO}",
        "audio-library/indexes/catalog.json",
    ],
)
def test_rutas_de_la_biblioteca_son_permitidas(ruta):
    assert ruta_permitida(ruta)


@pytest.mark.parametrize(
    "ruta",
    [
        "frontend/web/data/evil.html",
        "frontend/web/data/evil.js",
        "frontend/web/data/songs.json.html",
        "frontend/web/audio/index.html",
        f"frontend/web/audio/{AUDIO.replace('.opus', '.html')}",
        "frontend/web/audio/S80253b94dd183be7.svg",
        "frontend/web/audio/x.opus",
        "frontend/web/index.html",
        "frontend/web/sw.js",
        "backend/sonidos/catalog.py",
    ],
)
def test_ficheros_web_y_codigo_no_son_permitidos(ruta):
    assert not ruta_permitida(ruta)


def test_solo_se_puede_borrar_audio_de_la_biblioteca():
    assert borrado_permitido(f"frontend/web/audio/{AUDIO}")
    assert borrado_permitido(f"audio-library/audio/{AUDIO}")
    assert not borrado_permitido("frontend/web/data/songs.json")
    assert not borrado_permitido("frontend/web/data/catalog.json")
    assert not borrado_permitido("audio-library/indexes/catalog.json")


def _paquete(tmp_path, cambios):
    (tmp_path / "manifiesto.json").write_text(
        json.dumps({"base": HEAD, "accion": "import", "cambios": cambios}), encoding="utf-8"
    )
    return tmp_path


def test_manifiesto_que_borra_los_datos_publicos_se_rechaza(tmp_path):
    paquete = _paquete(tmp_path, [{"ruta": "frontend/web/data/songs.json", "estado": "D"}])
    with pytest.raises(PaqueteError):
        read_manifest(paquete, head=HEAD)


def test_manifiesto_con_html_en_la_web_se_rechaza(tmp_path):
    paquete = _paquete(tmp_path, [{"ruta": "frontend/web/data/evil.html", "estado": "A"}])
    with pytest.raises(PaqueteError):
        read_manifest(paquete, head=HEAD)


def test_manifiesto_con_una_cancion_despublicada_se_acepta(tmp_path):
    paquete = _paquete(tmp_path, [{"ruta": f"frontend/web/audio/{AUDIO}", "estado": "D"}])
    action, changes = read_manifest(paquete, head=HEAD)
    assert action == "import"
    assert [change.state for change in changes] == ["D"]
