"""Contrato común de las peticiones de la biblioteca (ADR-0028): el backend da exactamente los resultados de
tests/contrato/peticiones.json, que ejecutan también la web (tests/web-unit/contrato-peticiones.test.mjs) y la APK
(mobile/test/contrato_peticiones_test.dart). El backend es la referencia: es quien aplica los cambios."""

import json
import sys
from pathlib import Path

import pytest

from sonidos import catalog, issue_request, portadas
from sonidos.issue_request import RequestError, parse_request, validate_payload

ROOT = Path(__file__).resolve().parents[2]
CONTRATO = json.loads((ROOT / "tests" / "contrato" / "peticiones.json").read_text(encoding="utf-8"))
OPERACIONES = CONTRATO["operaciones"]
VALIDAS = [caso for caso in OPERACIONES if caso["valido"]]
CON_CUERPO = [caso for caso in VALIDAS if "cuerpo" in caso]
NO_VALIDAS = [caso for caso in OPERACIONES if not caso["valido"]]


def _nombre(caso):
    return caso["caso"]


def test_limites_del_contrato():
    limites = CONTRATO["limites"]
    assert limites == {
        "peticion": issue_request.MAX_REQUEST_CHARS,
        "payload": issue_request.MAX_PAYLOAD_CHARS,
        "url": issue_request.MAX_URL_CHARS,
        "licencia": issue_request.MAX_LICENSE_CHARS,
        "nombre_album": issue_request.MAX_FOLDER_NAME_CHARS,
        "artista_album": issue_request.MAX_FOLDER_ARTIST_CHARS,
        "titulo_cancion": issue_request.MAX_TITLE_CHARS,
        "artista_cancion": issue_request.MAX_ARTIST_CHARS,
        "etiquetas": issue_request.MAX_TAGS,
        "etiqueta": issue_request.MAX_TAG_CHARS,
        "anio_min": issue_request.YEAR_MIN,
        "anio_max": issue_request.YEAR_MAX,
        "move_songs": issue_request.MAX_MOVE_SONGS,
        "order_album": issue_request.MAX_ORDER_SONGS,
        "canciones_playlist_youtube": issue_request.MAX_PLAYLIST_SONGS,
        # El título de la incidencia solo lo recortan la web y la APK; el backend no lo lee.
        "titulo_incidencia": 120,
    }
    assert issue_request.MAX_ARTIST_CHARS == catalog.SONG_ARTIST_MAX_CHARS


def test_espacios_son_los_de_str_strip():
    esperados = [f"U+{code:04X}" for code in range(sys.maxunicode + 1) if chr(code).isspace()]
    assert CONTRATO["espacios"] == esperados


def test_operaciones_conocidas():
    ops = {caso["payload"]["op"] for caso in OPERACIONES if isinstance(caso["payload"], dict) and caso["payload"].get("op") in issue_request.OPERATIONS}
    # Hay casos válidos e inválidos de todas las operaciones del backend.
    assert ops == set(issue_request.OPERATIONS)
    for op in issue_request.OPERATIONS:
        assert any(c["valido"] and c["payload"]["op"] == op for c in OPERACIONES if isinstance(c["payload"], dict)), op
        assert any(not c["valido"] and c["payload"]["op"] == op for c in OPERACIONES if isinstance(c["payload"], dict) and "op" in c["payload"]), op
    assert set(CONTRATO["operaciones_api_editar"]) < set(issue_request.OPERATIONS)


@pytest.mark.parametrize("caso", VALIDAS, ids=_nombre)
def test_operacion_valida(caso):
    assert validate_payload(caso["payload"]) == caso["normalizado"]


@pytest.mark.parametrize("caso", NO_VALIDAS, ids=_nombre)
def test_operacion_no_valida(caso):
    with pytest.raises(RequestError) as error:
        validate_payload(caso["payload"])
    assert error.value.code == caso["motivo"]
    assert error.value.field == caso.get("campo")


@pytest.mark.parametrize("caso", CON_CUERPO, ids=_nombre)
def test_el_cuerpo_de_la_web_y_la_apk_lo_acepta_el_backend(caso):
    """El cuerpo es el que generan la web (buildIssueBody) y la APK (LibraryRequest.body): sus pruebas lo comparan
    carácter a carácter. Aquí, el backend lo lee y da el mismo payload normalizado."""
    cuerpo = caso["cuerpo"]
    lineas = cuerpo.split("\n")
    assert len(lineas) == 2
    assert lineas[0] == "action: organize"
    assert lineas[1].startswith("payload: ")
    enviado = json.loads(lineas[1][len("payload: "):])
    # JSON compacto, en una línea y sin escapar lo que no es ASCII.
    assert lineas[1] == "payload: " + json.dumps(enviado, ensure_ascii=False, separators=(",", ":"))
    pedido = parse_request(cuerpo)
    assert pedido["action"] == "organize"
    assert pedido["payload"] == caso["normalizado"]
    # Lo que se envía ya va normalizado: el backend no cambia ningún texto.
    for clave in ("name", "title", "artist", "tags"):
        if clave in enviado:
            assert enviado[clave] == caso["normalizado"][clave], clave


@pytest.mark.parametrize("peticion", CONTRATO["peticiones"], ids=_nombre)
def test_peticion_completa(peticion):
    if peticion["valido"]:
        assert parse_request(peticion["cuerpo"])["payload"] == validate_payload(peticion["payload"])
    else:
        with pytest.raises(RequestError) as error:
            parse_request(peticion["cuerpo"])
        assert error.value.code == peticion["motivo"]


def test_ids():
    for valor, valido in CONTRATO["ids"]["cancion"]:
        assert bool(issue_request.SONG_ID_RE.fullmatch(valor)) is valido, valor
    for valor, valido in CONTRATO["ids"]["album"]:
        assert bool(issue_request.FOLDER_ID_RE.fullmatch(valor)) is valido, valor
    for valor, valido in CONTRATO["ids"]["portada"]:
        assert bool(portadas.COVER_ID.fullmatch(valor)) is valido, valor
