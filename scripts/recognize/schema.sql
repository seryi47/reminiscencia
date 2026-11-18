-- Esquema D1 del reconocedor (ADR-0048). Dos tablas ligeras que indexan la huella acústica de la biblioteca.
--
--   songs: una fila por canción conocida. El Worker enriquece la respuesta con `title`/`artist` tras el match.
--   hashes: un hash de huella + canción + offset dentro de la canción. Hay varios por canción (miles). El índice por
--           `hash` es lo que hace que la búsqueda sea O(log n) por hash y no O(n_total).

PRAGMA foreign_keys = ON;

DROP INDEX IF EXISTS idx_hashes_hash;
DROP TABLE IF EXISTS hashes;
DROP TABLE IF EXISTS songs;

CREATE TABLE songs (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  artist TEXT NOT NULL
);

CREATE TABLE hashes (
  hash INTEGER NOT NULL,
  song_id TEXT NOT NULL,
  offset INTEGER NOT NULL
);

CREATE INDEX idx_hashes_hash ON hashes(hash);
