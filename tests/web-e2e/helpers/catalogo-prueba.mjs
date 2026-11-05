// Catálogo de prueba ficticio. Ningún título, artista ni carpeta es real.
// Solo lo usan las pruebas: sustituye a data/songs.json y data/folders.json en el servidor de pruebas.
// Motivo: el catálogo público tiene 10 canciones y ningún álbum, y las pruebas necesitan 20 canciones, dos álbumes
// con ocho canciones cada una y uno vacío. Los álbumes tienen el identificador nuevo del backend (F + 16 hexadecimales).
// Portadas (contrato "cover": "covers/<id>.jpg"): el álbum A y la canción 1 tienen una que se sirve; la canción 2
// declara una que no existe (404), para comprobar que entonces se ve la portada generada.
import { fileURLToPath } from "node:url";
import { PORTADA_AZUL, PORTADA_NARANJA } from "./portadas.mjs";

const SONG_COUNT = 20;

const FOLDERS = Object.freeze([
  { id: "F0000000000000001", name: "Álbum de prueba A", parent_id: null, artist: "Artista de prueba A", cover: "covers/F0000000000000001.jpg" },
  { id: "F0000000000000002", name: "Álbum de prueba B", parent_id: null },
  // Vacío a propósito: la página de un álbum vacío lo dice (DESIGN §7).
  { id: "F0000000000000003", name: "Álbum vacío de prueba", parent_id: null },
]);

function folderFor(index) {
  if (index < 8) return FOLDERS[0].id;
  if (index < 16) return FOLDERS[1].id;
  return null;
}

// Un Ogg Opus mínimo versionado en tests/fixtures (10 s de un tono de 440 Hz, mono, 12 kb/s; generado con
// `ffmpeg -f lavfi -i sine=frequency=440:duration=10 -ac 1 -ar 48000 -c:a libopus -b:a 12k -map_metadata -1
// -fflags +bitexact tono-prueba.opus`). Es el audio de todas las canciones ficticias, para que la reproducción funcione
// de verdad en Chrome. No depende de audio-library/audio, que deja de estar en Git (ADR-0024).
export const TEST_AUDIO_FILE = fileURLToPath(new URL("../../fixtures/tono-prueba.opus", import.meta.url));

/** Devuelve el Map de sustituciones que espera startStaticServer({ overrides }). */
export function createTestCatalogOverrides() {

  const songs = Array.from({ length: SONG_COUNT }, (_, index) => {
    const id = `S${String(index + 1).padStart(16, "0")}`;
    const cover = index < 2 ? { cover: `covers/${id}.jpg` } : {};
    return {
      id,
      title: `Canción de prueba ${String(index + 1).padStart(2, "0")}`,
      artist: `Artista de prueba ${(index % 4) + 1}`,
      year: 1960 + (index % 20),
      tags: [],
      folder_id: folderFor(index),
      duration_s: 120 + index * 7,
      license: "Dato ficticio para pruebas automáticas",
      audio: `audio/${id}.opus`,
      ...cover,
    };
  });

  const overrides = new Map([
    ["/data/songs.json", { body: JSON.stringify(songs, null, 2), type: "application/json; charset=utf-8" }],
    ["/data/folders.json", { body: JSON.stringify(FOLDERS, null, 2), type: "application/json; charset=utf-8" }],
    ["/covers/S0000000000000001.jpg", { body: PORTADA_NARANJA, type: "image/jpeg" }],
    ["/covers/F0000000000000001.jpg", { body: PORTADA_AZUL, type: "image/jpeg" }],
  ]);

  for (const song of songs) {
    overrides.set(`/${song.audio}`, { file: TEST_AUDIO_FILE, type: "audio/ogg; codecs=opus" });
  }

  return overrides;
}
