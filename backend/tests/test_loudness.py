"""Pruebas de la normalización de volumen (ADR-0046). Necesitan ffmpeg (como el resto del backend)."""

from pathlib import Path

from sonidos import catalog, loudness, publish

FIXTURE = Path(__file__).resolve().parents[2] / "tests" / "fixtures" / "tono-prueba.opus"


def _catalog_con(*songs):
    return {"folders": [], "songs": list(songs)}


def _song(song_id, **extra):
    base = {
        "id": song_id, "title": "T", "artist": "A", "year": None, "tags": [], "folder_id": None,
        "license": "CC", "source": "x", "sha256": song_id, "duration_s": 180.0, "codec": "opus",
        "size_bytes": 1000, "added_at": "2026-01-01T00:00:00Z", "public": True,
    }
    base.update(extra)
    return base


def test_mide_lufs_del_fixture():
    lufs = loudness.measure_lufs(FIXTURE)
    assert lufs is not None
    # El tono de prueba mide ~-21.8 LUFS; se deja un margen por si cambia la versión de ffmpeg.
    assert -26 < lufs < -18


def test_gain_acerca_a_la_referencia():
    # Un tema fuerte se ATENÚA (gain negativo).
    assert loudness.gain_db_for(-8.0, target=-16.0) == -8.0
    # Uno flojo da gain positivo (el reproductor lo recortará a 1.0).
    assert loudness.gain_db_for(-22.0, target=-16.0) == 6.0
    # Justo en la referencia, 0.
    assert loudness.gain_db_for(-16.0, target=-16.0) == 0.0


def test_gain_acotado():
    assert loudness.gain_db_for(10.0) == loudness.GAIN_MIN_DB  # muy fuerte → tope de atenuación
    assert loudness.gain_db_for(-60.0) == loudness.GAIN_MAX_DB  # muy flojo → tope de ganancia


def test_sin_medicion_devuelve_none():
    assert loudness.gain_db_for(None) is None
    # Un fichero inexistente no mide.
    assert loudness.measure_gain_db(FIXTURE.parent / "no-existe.opus") is None


def test_measure_gain_db_del_fixture():
    gain = loudness.measure_gain_db(FIXTURE, target=-16.0)
    assert gain is not None
    # ~-16 - (-21.8) = +5.8, dentro de límites.
    assert 3.0 < gain < 9.0


def test_add_song_guarda_gain_solo_cuando_se_da():
    data = {"folders": [], "songs": []}
    song, _ = catalog.add_song(data, sha256="a" * 64, title="T", license="CC", source="x",
                               codec="opus", duration_s=180, size_bytes=1000, gain_db=-7.25)
    assert song["gain_db"] == -7.2  # se redondea a 1 decimal
    song2, _ = catalog.add_song(data, sha256="b" * 64, title="T2", license="CC", source="x",
                                codec="opus", duration_s=180, size_bytes=1000)
    assert "gain_db" not in song2  # sin valor, no se guarda el campo


def test_set_gain_idempotente():
    data = _catalog_con(_song("S1"))
    assert catalog.set_gain(data, "S1", -6.0) is True
    assert data["songs"][0]["gain_db"] == -6.0
    assert catalog.set_gain(data, "S1", -6.0) is False  # mismo valor: no cambia
    assert catalog.set_gain(data, "S1", None) is True  # quitarlo sí cambia
    assert "gain_db" not in data["songs"][0]


def test_publish_gain_of_valida():
    assert publish._gain_of(_song("S1", gain_db=-8.0)) == -8.0
    assert publish._gain_of(_song("S1")) is None
    assert publish._gain_of(_song("S1", gain_db=True)) is None  # un bool no es gain
    assert publish._gain_of(_song("S1", gain_db="x")) is None


def test_backfill_gain_mide_solo_lo_que_falta(tmp_path):
    (tmp_path / "S1.opus").write_bytes(b"x")
    (tmp_path / "S2.opus").write_bytes(b"x")
    # S3 sin fichero; S2 ya tiene gain previo.
    data = _catalog_con(_song("S1"), _song("S2", gain_db=-3.0), _song("S3"))
    medidas = []

    def fake_measure(path, *, target):
        medidas.append(Path(path).stem)
        return -5.0

    summary = loudness.backfill_gain(data, tmp_path, measure=fake_measure)
    assert medidas == ["S1"]  # S2 ya tenía (omitida), S3 sin audio
    assert data["songs"][0]["gain_db"] == -5.0
    assert data["songs"][1]["gain_db"] == -3.0  # intacta
    assert summary == {"medidas": 1, "actualizadas": 1, "sin_audio": 1, "sin_medir": 0, "omitidas": 1}


def test_backfill_gain_force_y_limit(tmp_path):
    (tmp_path / "S1.opus").write_bytes(b"x")
    (tmp_path / "S2.opus").write_bytes(b"x")
    data = _catalog_con(_song("S1", gain_db=-3.0), _song("S2", gain_db=-3.0))
    summary = loudness.backfill_gain(data, tmp_path, force=True, limit=1, measure=lambda p, *, target: -9.0)
    assert summary["medidas"] == 1  # el límite corta
    assert summary["actualizadas"] == 1
