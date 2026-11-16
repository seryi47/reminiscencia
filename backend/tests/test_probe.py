from pathlib import Path

import pytest

from sonidos import probe as probe_module
from sonidos.probe import ProbeError, probe


def test_probe_reads_format_of_generated_wav(tone_wav):
    info = probe(tone_wav)

    assert info.codec == "pcm_s16le"
    assert info.sample_rate == 44100
    assert info.channels == 2
    assert info.duration_s == pytest.approx(2.0, abs=0.05)
    assert info.size_bytes == tone_wav.stat().st_size


def test_probe_rejects_file_without_audio(tmp_path):
    broken = tmp_path / "no_es_audio.wav"
    broken.write_bytes(b"esto no es un wav")

    with pytest.raises(ProbeError):
        probe(broken)


def test_opus_ignora_oggs_incrustado_en_el_audio(tmp_path):
    """Una secuencia «OggS» dentro de los datos de audio comprimido NO debe confundirse con la última página: si lo
    hiciera, _opus_info tomaría un granule falso y daría una duración errónea (afecta a duplicados ±2 s y a la UI).
    Se inyecta un «OggS\\x00…» basura justo antes de la última página real y se comprueba que la duración no cambia."""
    original = Path(__file__).resolve().parent.parent.parent / "tests" / "fixtures" / "tono-prueba.opus"
    datos = bytearray(original.read_bytes())
    esperado = probe(original).duration_s
    # Inserta una página Ogg falsa (versión 0, un granule enorme) 40 bytes antes del final, dentro del flujo de audio.
    falsa = b"OggS" + bytes([0, 0]) + (0xDEADBEEF).to_bytes(8, "little") + bytes(20)
    punto = len(datos) - 40
    envenenado = tmp_path / "con-oggs-falso.opus"
    envenenado.write_bytes(bytes(datos[:punto] + bytearray(falsa) + datos[punto:]))

    # La duración sigue siendo la real (±1 s), no la del granule falso (que daría horas).
    assert probe(envenenado).duration_s == pytest.approx(esperado, abs=1.0)


def test_probe_degrada_a_probeerror_si_falta_ffprobe(tmp_path, monkeypatch):
    """En la ruta sin ffmpeg (buzon.yml, ADR-0042) ffprobe no está en el PATH. Un contenido que no es Opus válido
    (aquí, bytes arbitrarios) debe caer a ffprobe y, al no existir, convertirse en ProbeError (rechazo limpio), NUNCA
    en un FileNotFoundError que reviente el job. Regresión del DoS de subidas públicas."""
    envenenado = tmp_path / "envenenado.opus"
    envenenado.write_bytes(b"hola, esto no empieza por OggS")

    def sin_ffprobe(*_args, **_kwargs):
        raise FileNotFoundError(2, "No such file or directory: 'ffprobe'")

    monkeypatch.setattr(probe_module.subprocess, "run", sin_ffprobe)

    with pytest.raises(ProbeError):
        probe(envenenado)


def test_probe_degrada_a_probeerror_con_opus_invalido_sin_ffprobe(tmp_path, monkeypatch):
    """Un «polyglot» que empieza por OggS/OpusHead pero con 0 canales hace que _opus_info devuelva None y se caiga a
    ffprobe igualmente; sin ffprobe, también debe ser ProbeError, no un crash."""
    # OggS + cabecera de página v0 + OpusHead con channels=0 (opus_head[9]) → _opus_info None.
    datos = bytearray(b"OggS")
    datos += bytes([0])  # versión 0
    datos += bytes(22)   # resto de la cabecera de página (tipo, granule, serial, seq, crc, segmentos)
    datos += b"OpusHead"
    datos += bytes([1, 0])          # versión Opus, canales = 0
    datos += bytes(9)               # pre-skip, input rate, etc.
    envenenado = tmp_path / "polyglot.opus"
    envenenado.write_bytes(bytes(datos))

    monkeypatch.setattr(
        probe_module.subprocess, "run",
        lambda *_a, **_k: (_ for _ in ()).throw(FileNotFoundError(2, "ffprobe")),
    )

    with pytest.raises(ProbeError):
        probe(envenenado)
