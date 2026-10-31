import pytest

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
