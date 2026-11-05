// Catálogo de prueba ficticio. Ningún título, artista ni carpeta es real.
// Solo lo usan las pruebas: sustituye a data/songs.json y data/folders.json en el servidor de pruebas.
// Motivo: el catálogo público tiene 10 canciones y ningún álbum, y las pruebas necesitan 20 canciones, dos álbumes
// con ocho canciones cada una y uno vacío. Los álbumes tienen el identificador nuevo del backend (F + 16 hexadecimales).
// Portadas (contrato "cover": "covers/<id>.jpg"): el álbum A y la canción 1 tienen una que se sirve; la canción 2
// declara una que no existe (404), para comprobar que entonces se ve la portada generada.
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { PORTADA_AZUL, PORTADA_NARANJA } from "./portadas.mjs";
import { WEB_ROOT } from "./servidor.mjs";

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

// Audios reales de la biblioteca (audio-library/audio; la web ya no tiene audio propio, lo sirve R2), reutilizados como
// fichero de cada canción ficticia para que la reproducción funcione de verdad en Chrome. Si no hay ninguno, no se
// sustituye el audio.
const AUDIO_DIR = join(WEB_ROOT, "..", "..", "audio-library", "audio");

function listRealAudioFiles() {
  try {
    return readdirSync(AUDIO_DIR)
      .filter((name) => name.endsWith(".opus"))
      .sort();
  } catch {
    return [];
  }
}

/** Devuelve el Map de sustituciones que espera startStaticServer({ overrides }). */
export function createTestCatalogOverrides() {
  const realAudio = listRealAudioFiles();

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

  if (realAudio.length > 0) {
    songs.forEach((song, index) => {
      overrides.set(`/${song.audio}`, {
        file: join(AUDIO_DIR, realAudio[index % realAudio.length]),
        type: "audio/ogg; codecs=opus",
      });
    });
  }

  return overrides;
}
