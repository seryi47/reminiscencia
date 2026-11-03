// Catálogo de prueba ficticio. Ningún título, artista ni carpeta es real.
// Solo lo usan las pruebas: sustituye a data/songs.json y data/folders.json en el servidor de pruebas.
// Motivo: el catálogo público tiene 10 canciones y ninguna carpeta, y las pruebas necesitan 20 canciones, dos
// carpetas con ocho canciones cada una y una carpeta vacía.
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { WEB_ROOT } from "./servidor.mjs";

const SONG_COUNT = 20;

const FOLDERS = Object.freeze([
  { id: "F0000000000000001", name: "Carpeta de prueba A", parent_id: null },
  { id: "F0000000000000002", name: "Carpeta de prueba B", parent_id: null },
  // Vacía a propósito: la página de una carpeta vacía lo dice (DESIGN §7).
  { id: "F0000000000000003", name: "Carpeta vacía de prueba", parent_id: null },
]);

function folderFor(index) {
  if (index < 8) return FOLDERS[0].id;
  if (index < 16) return FOLDERS[1].id;
  return null;
}

// Audios reales de frontend/web/audio, reutilizados como fichero de cada canción ficticia
// para que la reproducción funcione de verdad en Chrome. Si no hay ninguno, no se sustituye el audio.
function listRealAudioFiles() {
  try {
    return readdirSync(join(WEB_ROOT, "audio"))
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
    };
  });

  const overrides = new Map([
    ["/data/songs.json", { body: JSON.stringify(songs, null, 2), type: "application/json; charset=utf-8" }],
    ["/data/folders.json", { body: JSON.stringify(FOLDERS, null, 2), type: "application/json; charset=utf-8" }],
  ]);

  if (realAudio.length > 0) {
    songs.forEach((song, index) => {
      overrides.set(`/${song.audio}`, {
        file: join(WEB_ROOT, "audio", realAudio[index % realAudio.length]),
        type: "audio/ogg; codecs=opus",
      });
    });
  }

  return overrides;
}
