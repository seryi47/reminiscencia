"""Biblioteca musical en SQLite.

Reglas:
- Cada canción tiene un ID estable derivado del SHA-256 del archivo original.
  Importar dos veces el mismo contenido no duplica la canción.
- No se importa nada sin una licencia declarada. Es una barrera legal, no un
  campo opcional (ver docs/decisions/ADR-0002-fuentes-de-audio.md).
- Las versiones transcodificadas (playback) se guardan como variantes de la
  misma canción.
"""

from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS songs (
    id TEXT PRIMARY KEY,
    sha256 TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    source TEXT NOT NULL,
    license TEXT NOT NULL,
    codec TEXT NOT NULL,
    sample_rate INTEGER NOT NULL,
    channels INTEGER NOT NULL,
    duration_s REAL NOT NULL,
    bitrate INTEGER,
    size_bytes INTEGER NOT NULL,
    added_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS variants (
    song_id TEXT NOT NULL REFERENCES songs(id),
    profile TEXT NOT NULL,
    path TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    PRIMARY KEY (song_id, profile)
);
"""


class LicenseRequiredError(ValueError):
    pass


@dataclass(frozen=True)
class ImportResult:
    song_id: str
    created: bool


def song_id_from_sha256(sha256: str) -> str:
    return f"S{sha256[:16]}"


class Library:
    def __init__(self, db_path: Path) -> None:
        db_path.parent.mkdir(parents=True, exist_ok=True)
        self.connection = sqlite3.connect(db_path)
        self.connection.row_factory = sqlite3.Row
        self.connection.execute("PRAGMA foreign_keys = ON")
        self.connection.executescript(SCHEMA)

    def close(self) -> None:
        self.connection.close()

    def add_song(
        self,
        *,
        sha256: str,
        title: str,
        source: str,
        license: str,
        codec: str,
        sample_rate: int,
        channels: int,
        duration_s: float,
        bitrate: int | None,
        size_bytes: int,
    ) -> ImportResult:
        if not license or not license.strip():
            raise LicenseRequiredError("no se puede importar una canción sin licencia declarada")

        song_id = song_id_from_sha256(sha256)
        existing = self.connection.execute(
            "SELECT id FROM songs WHERE sha256 = ?", (sha256,)
        ).fetchone()
        if existing:
            return ImportResult(song_id=existing["id"], created=False)

        self.connection.execute(
            """
            INSERT INTO songs (
                id, sha256, title, source, license, codec, sample_rate,
                channels, duration_s, bitrate, size_bytes, added_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                song_id,
                sha256,
                title,
                source,
                license.strip(),
                codec,
                sample_rate,
                channels,
                duration_s,
                bitrate,
                size_bytes,
                datetime.now(timezone.utc).isoformat(timespec="seconds"),
            ),
        )
        self.connection.commit()
        return ImportResult(song_id=song_id, created=True)

    def add_variant(self, song_id: str, profile: str, path: Path, size_bytes: int) -> None:
        self.connection.execute(
            """
            INSERT OR REPLACE INTO variants (song_id, profile, path, size_bytes)
            VALUES (?, ?, ?, ?)
            """,
            (song_id, profile, str(path), size_bytes),
        )
        self.connection.commit()

    def get_song(self, song_id: str) -> dict | None:
        row = self.connection.execute("SELECT * FROM songs WHERE id = ?", (song_id,)).fetchone()
        return dict(row) if row else None

    def list_songs(self) -> list[dict]:
        rows = self.connection.execute("SELECT * FROM songs ORDER BY added_at, id").fetchall()
        return [dict(row) for row in rows]

    def variants_for(self, song_id: str) -> list[dict]:
        rows = self.connection.execute(
            "SELECT profile, path, size_bytes FROM variants WHERE song_id = ? ORDER BY profile",
            (song_id,),
        ).fetchall()
        return [dict(row) for row in rows]

    def stats(self) -> dict:
        row = self.connection.execute(
            "SELECT COUNT(*) AS songs, COALESCE(SUM(size_bytes), 0) AS original_bytes FROM songs"
        ).fetchone()
        variant_row = self.connection.execute(
            "SELECT COALESCE(SUM(size_bytes), 0) AS variant_bytes FROM variants"
        ).fetchone()
        return {
            "songs": row["songs"],
            "original_bytes": row["original_bytes"],
            "variant_bytes": variant_row["variant_bytes"],
        }

    def export_index(self, destination: Path) -> None:
        """Exporta un índice JSON sin rutas locales, apto para versionarse en Git."""
        songs = []
        for song in self.list_songs():
            songs.append(
                {
                    "id": song["id"],
                    "title": song["title"],
                    "source": song["source"],
                    "license": song["license"],
                    "codec": song["codec"],
                    "sample_rate": song["sample_rate"],
                    "channels": song["channels"],
                    "duration_s": song["duration_s"],
                    "bitrate": song["bitrate"],
                    "size_bytes": song["size_bytes"],
                    "sha256": song["sha256"],
                    "added_at": song["added_at"],
                }
            )
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(json.dumps(songs, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
