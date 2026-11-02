import subprocess
from pathlib import Path

import pytest

from sonidos import catalog
from sonidos.publish import sync_public


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


SONG_ID = "Sabababababababab"
REAL_AUDIO = b"opus-real"


def _git(repo: Path, *args: str) -> None:
    subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True, text=True)


@pytest.fixture
def main_publicado(tmp_path: Path) -> Path:
    """Repositorio con la forma de main (ADR-0007, ADR-0010): una canción pública con su audio, la parte pública
    regenerada desde el catálogo y un commit inicial. Sin remoto."""
    repo = tmp_path / "repo"
    catalog_path = repo / "audio-library" / "indexes" / "catalog.json"
    audio_dir = repo / "audio-library" / "audio"
    catalog_path.parent.mkdir(parents=True)
    audio_dir.mkdir(parents=True)
    data = catalog.empty()
    folder = catalog.create_folder(data, "Jazz")
    song, _ = catalog.add_song(
        data, sha256="ab" * 32, title="Tema público", license="CC0 1.0",
        source="direct-url:ejemplo.com/t.mp3", codec="opus", duration_s=5.0, size_bytes=len(REAL_AUDIO),
    )
    assert song["id"] == SONG_ID
    catalog.update_song(data, song["id"], {"public": True, "folder_id": folder["id"]})
    catalog.save(catalog_path, data)
    (audio_dir / f"{SONG_ID}.opus").write_bytes(REAL_AUDIO)
    sync_public(catalog_path=catalog_path, audio_dir=audio_dir, web_dir=repo / "frontend" / "web")
    _git(repo, "init", "-q")
    _git(repo, "add", "-A")
    _git(repo, "-c", "user.name=prueba", "-c", "user.email=prueba@example.invalid", "commit", "-q", "-m", "main")
    return repo
