import subprocess
from pathlib import Path

import pytest


def make_tone(destination: Path, *, seconds: float = 2.0, channels: int = 2, sample_rate: int = 44100, frequency: int = 440) -> Path:
    """Genera un tono sinusoidal sintético con ffmpeg. No contiene música protegida."""
    destination.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [
            "ffmpeg", "-y", "-v", "error",
            "-f", "lavfi", "-i", f"sine=frequency={frequency}:duration={seconds}",
            "-ac", str(channels), "-ar", str(sample_rate),
            str(destination),
        ],
        check=True,
    )
    return destination


@pytest.fixture
def tone_wav(tmp_path: Path) -> Path:
    return make_tone(tmp_path / "source" / "tono.wav")
