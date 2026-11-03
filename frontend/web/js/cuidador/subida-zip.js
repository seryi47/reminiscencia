// Archivos ZIP en «Subir canciones»: la selección (canciones sueltas y uno o varios ZIP, mezclados) se convierte en
// la lista de subidas que recibe el gestor (subida-estado.js). De cada ZIP solo se lee el directorio central
// (zip.js); cada canción queda como una fuente perezosa que se descomprime cuando le llega el turno en la cola, de una
// en una, así que nunca hay más de una canción del ZIP descomprimida en memoria. El ZIP no se sube nunca: solo se
// envía el Opus de cada canción, y el gestor suelta la referencia al ZIP en cuanto cada canción está en GitHub.
//
// Cada canción del ZIP lleva su grupo ({ key, name, songs, ignored }), con el que la hoja pinta «Álbum.zip:
// 12 canciones» y cuántos archivos se ignoraron. Un ZIP que no se puede abrir (dañado, en varias partes o sin
// canciones) es una sola subida con su error. Sin límites de tamaño (orden del propietario).
//
// Sin DOM: se prueba en node (tests/web-unit/subida-zip.test.mjs).

import { titleFromFileName } from './subida-local.js';
import { audioEntries, readZipDirectory, readZipEntry, ZipError } from './zip.js';

export const ZIP_ACCEPT = '.zip,application/zip,application/x-zip-compressed';
const ZIP_TYPES = new Set(['application/zip', 'application/x-zip-compressed', 'application/x-zip']);
const NO_SONGS_TEXT = 'No hay canciones de audio en este ZIP (WAV, MP3, M4A, FLAC, OGG u OPUS).';
const OPEN_FAILED_TEXT = 'No se ha podido abrir este ZIP.';

/** ¿Es un ZIP? Por la extensión .zip o por su tipo. */
export function isZipFile(file) {
  if (!file) return false;
  return /\.zip$/i.test(String(file.name ?? '')) || ZIP_TYPES.has(String(file.type ?? '').toLowerCase());
}

/** Fuente perezosa de una canción del ZIP: open() la descomprime (un File) solo cuando hace falta. */
export function zipSongSource(zipFile, entry) {
  return {
    name: entry.name,
    size: entry.size,
    fromZip: true,
    open: () => readZipEntry(zipFile, entry),
  };
}

let groupSeq = 0;
function defaultGroupKey() {
  try {
    if (typeof globalThis.crypto?.randomUUID === 'function') return `zip-${globalThis.crypto.randomUUID()}`;
  } catch {
    // Sin crypto: un contador basta para esta visita.
  }
  groupSeq += 1;
  return `zip-${Date.now().toString(36)}-${groupSeq}`;
}

/**
 * Convierte la selección en subidas, en el mismo orden: [{ file, name, title, group, error }].
 * - Canción suelta: { file, name: su nombre, title: el nombre sin extensión, group: null }.
 * - Canción de un ZIP: { file: fuente perezosa, name: nombre base dentro del ZIP, title: ese nombre sin extensión,
 *   group }. Las rutas del ZIP solo sirven para sacar el nombre base.
 * - ZIP que no se puede abrir o sin canciones: una subida { file: null, name: el ZIP, error: <motivo>, group }.
 */
export async function expandSelection(files, { readDirectory = readZipDirectory, newGroupKey = defaultGroupKey } = {}) {
  const sources = [];
  for (const file of Array.from(files ?? [])) {
    if (!isZipFile(file)) {
      sources.push({ file, name: file?.name || 'Sin nombre', title: titleFromFileName(file?.name), group: null, error: null });
      continue;
    }
    const zipName = file.name || 'Archivo.zip';
    let entries;
    try {
      entries = await readDirectory(file);
    } catch (error) {
      const message = error instanceof ZipError ? error.message : OPEN_FAILED_TEXT;
      if (!(error instanceof ZipError)) console.error('Reminiscencia: fallo al abrir un ZIP.', error);
      sources.push({ file: null, name: zipName, title: titleFromFileName(zipName), group: { key: newGroupKey(), name: zipName, songs: 0, ignored: 0 }, error: message });
      continue;
    }
    const { songs, ignored } = audioEntries(entries);
    const group = { key: newGroupKey(), name: zipName, songs: songs.length, ignored };
    if (songs.length === 0) {
      sources.push({ file: null, name: zipName, title: titleFromFileName(zipName), group, error: NO_SONGS_TEXT });
      continue;
    }
    for (const entry of songs) {
      sources.push({ file: zipSongSource(file, entry), name: entry.name, title: titleFromFileName(entry.name), group, error: null });
    }
  }
  return sources;
}

// ---------------------------------------------------------------------------------------------
// Textos y agrupado de la hoja
// ---------------------------------------------------------------------------------------------

/** Cabecera de un grupo: «Álbum.zip: 12 canciones». */
export function groupTitle(group) {
  const songs = Number(group?.songs) || 0;
  const count = songs === 0 ? 'ninguna canción' : songs === 1 ? '1 canción' : `${songs} canciones`;
  return `${group?.name ?? 'Archivo.zip'}: ${count}`;
}

/** Nota de un grupo con lo que se ha ignorado, o '' si no se ignoró nada. */
export function groupNote(group) {
  const ignored = Number(group?.ignored) || 0;
  if (ignored <= 0) return '';
  return ignored === 1
    ? 'Se ignoró 1 archivo que no es una canción (carpetas del sistema, ocultos u otros tipos).'
    : `Se ignoraron ${ignored} archivos que no son canciones (carpetas del sistema, ocultos u otros tipos).`;
}

/**
 * Agrupa las subidas para pintarlas: [{ group: null | grupo, items }] en el orden en que aparecen. Las sueltas
 * seguidas van juntas; las de un ZIP, en su grupo (aunque no vengan seguidas).
 */
export function groupUploads(items) {
  const blocks = [];
  const byGroup = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    const key = item?.group?.key;
    if (key) {
      let block = byGroup.get(key);
      if (!block) {
        block = { group: item.group, items: [] };
        byGroup.set(key, block);
        blocks.push(block);
      }
      block.items.push(item);
    } else {
      const last = blocks.at(-1);
      if (last && last.group === null) last.items.push(item);
      else blocks.push({ group: null, items: [item] });
    }
  }
  return blocks;
}
