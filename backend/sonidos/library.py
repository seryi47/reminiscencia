"""Biblioteca musical en SQLite.

Reglas:
- Cada canción tiene un ID estable derivado del SHA-256 del archivo original.
  Importar dos veces el mismo contenido no duplica la canción.
- No se importa nada sin una licencia declarada (ADR-0002, ADR-0005).
- Las versiones transcodificadas (playback) se guardan como variantes de la misma canción.
- Las carpetas forman un árbol (parent_id). Una canción está en una carpeta o en la raíz.
"""

from __future__ import annotations

import json
import sqlite3
import uuid
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

CREATE TABLE IF NOT EXISTS folders (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    parent_id TEXT REFERENCES folders(id),
    created_at TEXT NOT NULL
);
"""

# Columnas añadidas después de la primera versión; se migran sin perder datos.
MIGRATIONS = {
    "songs": {
        "artist": "TEXT NOT NULL DEFAULT ''",
        "year": "INTEGER",
        "tags": "TEXT NOT NULL DEFAULT ''",
        "folder_id": "TEXT REFERENCES folders(id)",
    }
}

EDITABLE_SONG_FIELDS = ("title", "artist", "year", "tags", "folder_id")


class LicenseRequiredError(ValueError):
    pass


class NotFoundError(LookupError):
    pass


@dataclass(frozen=True)
class ImportResult:
    song_id: str
    created: bool


def song_id_from_sha256(sha256: str) -> str:
    return f"S{sha256[:16]}"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class Library:
    def __init__(self, db_path: Path) -> None:
        db_path.parent.mkdir(parents=True, exist_ok=True)
        self.connection = sqlite3.connect(db_path)
        self.connection.row_factory = sqlite3.Row
        self.connection.execute("PRAGMA foreign_keys = ON")
        self.connection.executescript(SCHEMA)
        self._migrate()

    def _migrate(self) -> None:
        for table, columns in MIGRATIONS.items():
            existing = {row["name"] for row in self.connection.execute(f"PRAGMA table_info({table})")}
            for name, definition in columns.items():
                if name not in existing:
                    self.connection.execute(f"ALTER TABLE {table} ADD COLUMN {name} {definition}")
        self.connection.commit()

    def close(self) -> None:
        self.connection.close()

    # ---- canciones -------------------------------------------------------

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
        existing = self.connection.execute("SELECT id FROM songs WHERE sha256 = ?", (sha256,)).fetchone()
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
                song_id, sha256, title, source, license.strip(), codec, sample_rate,
                channels, duration_s, bitrate, size_bytes, _now(),
            ),
        )
        self.connection.commit()
        return ImportResult(song_id=song_id, created=True)

    def add_variant(self, song_id: str, profile: str, path: Path, size_bytes: int) -> None:
        self.connection.execute(
            "INSERT OR REPLACE INTO variants (song_id, profile, path, size_bytes) VALUES (?, ?, ?, ?)",
            (song_id, profile, str(path), size_bytes),
        )
        self.connection.commit()

    def update_song(self, song_id: str, **fields) -> dict:
        """Edita metadatos de una canción. Sólo cambia los campos permitidos."""
        if self.get_song(song_id) is None:
            raise NotFoundError(f"no existe la canción {song_id}")
        unknown = set(fields) - set(EDITABLE_SONG_FIELDS)
        if unknown:
            raise ValueError(f"campos no editables: {', '.join(sorted(unknown))}")
        if "title" in fields and not str(fields["title"]).strip():
            raise ValueError("el título no puede estar vacío")
        if "folder_id" in fields and fields["folder_id"] is not None:
            self._require_folder(fields["folder_id"])
        if "tags" in fields:
            fields["tags"] = _normalize_tags(fields["tags"])
        if "year" in fields and fields["year"] is not None:
            fields["year"] = int(fields["year"])
        if fields:
            assignments = ", ".join(f"{name} = ?" for name in fields)
            self.connection.execute(
                f"UPDATE songs SET {assignments} WHERE id = ?",
                (*fields.values(), song_id),
            )
            self.connection.commit()
        return self.get_song(song_id)

    def get_song(self, song_id: str) -> dict | None:
        row = self.connection.execute("SELECT * FROM songs WHERE id = ?", (song_id,)).fetchone()
        return _song_dict(row) if row else None

    def list_songs(self, *, folder: str | None = None, query: str | None = None) -> list[dict]:
        """folder: None = todas; '' = sin carpeta; otro valor = id de carpeta."""
        clauses, params = [], []
        if folder == "":
            clauses.append("folder_id IS NULL")
        elif folder is not None:
            clauses.append("folder_id = ?")
            params.append(folder)
        if query:
            clauses.append("(title LIKE ? OR artist LIKE ? OR tags LIKE ? OR source LIKE ?)")
            like = f"%{query}%"
            params.extend([like, like, like, like])
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        rows = self.connection.execute(
            f"SELECT * FROM songs {where} ORDER BY added_at, id", params
        ).fetchall()
        return [_song_dict(row) for row in rows]

    def variants_for(self, song_id: str) -> list[dict]:
        rows = self.connection.execute(
            "SELECT profile, path, size_bytes FROM variants WHERE song_id = ? ORDER BY profile",
            (song_id,),
        ).fetchall()
        return [dict(row) for row in rows]

    def playback_path(self, song_id: str) -> Path | None:
        """Ruta del fichero de reproducción (opus-64k si existe, si no la primera variante)."""
        variants = self.variants_for(song_id)
        preferred = next((v for v in variants if v["profile"] == "opus-64k"), None) or (variants[0] if variants else None)
        if preferred is None or not Path(preferred["path"]).exists():
            return None
        return Path(preferred["path"])

    # ---- carpetas --------------------------------------------------------

    def _require_folder(self, folder_id: str) -> dict:
        row = self.connection.execute("SELECT * FROM folders WHERE id = ?", (folder_id,)).fetchone()
        if row is None:
            raise NotFoundError(f"no existe la carpeta {folder_id}")
        return dict(row)

    def create_folder(self, name: str, parent_id: str | None = None) -> dict:
        clean = name.strip()
        if not clean:
            raise ValueError("el nombre de la carpeta no puede estar vacío")
        if parent_id is not None:
            self._require_folder(parent_id)
        folder_id = uuid.uuid4().hex[:10]
        self.connection.execute(
            "INSERT INTO folders (id, name, parent_id, created_at) VALUES (?, ?, ?, ?)",
            (folder_id, clean, parent_id, _now()),
        )
        self.connection.commit()
        return self._require_folder(folder_id)

    def rename_folder(self, folder_id: str, name: str) -> dict:
        clean = name.strip()
        if not clean:
            raise ValueError("el nombre de la carpeta no puede estar vacío")
        self._require_folder(folder_id)
        self.connection.execute("UPDATE folders SET name = ? WHERE id = ?", (clean, folder_id))
        self.connection.commit()
        return self._require_folder(folder_id)

    def delete_folder(self, folder_id: str) -> None:
        """Borra la carpeta. Sus canciones y subcarpetas suben al nivel de la carpeta borrada."""
        folder = self._require_folder(folder_id)
        parent = folder["parent_id"]
        self.connection.execute("UPDATE songs SET folder_id = ? WHERE folder_id = ?", (parent, folder_id))
        self.connection.execute("UPDATE folders SET parent_id = ? WHERE parent_id = ?", (parent, folder_id))
        self.connection.execute("DELETE FROM folders WHERE id = ?", (folder_id,))
        self.connection.commit()

    def list_folders(self) -> list[dict]:
        rows = self.connection.execute("SELECT * FROM folders ORDER BY name COLLATE NOCASE").fetchall()
        counts = dict(
            self.connection.execute(
                "SELECT folder_id, COUNT(*) FROM songs WHERE folder_id IS NOT NULL GROUP BY folder_id"
            ).fetchall()
        )
        return [
            {**dict(row), "songs": counts.get(row["id"], 0)}
            for row in rows
        ]

    # ---- estadísticas y exportación ------------------------------------

    def stats(self) -> dict:
        row = self.connection.execute(
            "SELECT COUNT(*) AS songs, COALESCE(SUM(size_bytes), 0) AS original_bytes FROM songs"
        ).fetchone()
        variant_row = self.connection.execute(
            "SELECT COALESCE(SUM(size_bytes), 0) AS variant_bytes FROM variants"
        ).fetchone()
        folders = self.connection.execute("SELECT COUNT(*) AS n FROM folders").fetchone()
        return {
            "songs": row["songs"],
            "original_bytes": row["original_bytes"],
            "variant_bytes": variant_row["variant_bytes"],
            "folders": folders["n"],
        }

    def export_index(self, destination: Path) -> None:
        """Exporta el índice JSON sin rutas locales, apto para versionarse en Git."""
        songs = []
        for song in self.list_songs():
            songs.append(
                {
                    "id": song["id"],
                    "title": song["title"],
                    "artist": song["artist"],
                    "year": song["year"],
                    "tags": song["tags"],
                    "folder_id": song["folder_id"],
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


def _normalize_tags(tags) -> str:
    if isinstance(tags, str):
        items = tags.split(",")
    else:
        items = list(tags or [])
    seen, clean = set(), []
    for item in items:
        value = str(item).strip().lower()
        if value and value not in seen:
            seen.add(value)
            clean.append(value)
    return ",".join(clean)


def _song_dict(row) -> dict:
    data = dict(row)
    data["tags"] = [tag for tag in (data.get("tags") or "").split(",") if tag]
    return data
