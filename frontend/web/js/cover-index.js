// Índice de portadas en R2 (ADR-0029). Una portada cambiada por el Worker (POST /api/portada) se guarda al momento en el
// bucket público con un nombre inmutable, portadas/<id>-<hash>.jpg, y el índice portadas/indice.json ({ id: fichero })
// dice cuál vale para cada canción o álbum. La web y la APK (lib/cover_index.dart) leen el índice sin caché y lo
// superponen al campo «cover» del catálogo: el índice manda. Así la portada nueva se ve para todos en segundos, sin
// pasar por GitHub. Las portadas de Git (covers/<id>.jpg) siguen valiendo para lo que no está en el índice.
//
// Lógica pura (sin DOM): la usan la web (js/app.js), el Worker (worker/src/portadas.js) y las pruebas
// (tests/web-unit/cover-index.test.mjs).

import { AUDIO_ORIGIN } from './offline-core.js';

export const COVER_INDEX_KEY = 'portadas/indice.json';
/** Dirección pública del índice: el bucket público de R2 (tiene CORS para GET desde la web, ADR-0020). */
export const COVER_INDEX_URL = `${AUDIO_ORIGIN}/${COVER_INDEX_KEY}`;
/** Fichero de una portada en el bucket: portadas/<S|F + 16 hex>-<16 hex del SHA-256>.jpg. */
export const COVER_KEY = /^portadas\/([SF][0-9a-f]{16})-([0-9a-f]{16})\.jpg$/;
/** Las mismas portadas con su dirección completa (lo que el catálogo de la web lleva en «cover» tras superponer). */
export const COVER_URL = new RegExp(`^${AUDIO_ORIGIN.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}/portadas/[SF][0-9a-f]{16}-[0-9a-f]{16}\\.jpg$`);
const COVER_ID = /^[SF][0-9a-f]{16}$/;
export const MAX_INDEX_ENTRIES = 50_000;
export const INDEX_TIMEOUT_MS = 8000;

/** Fichero de la portada de [id] con el [hash] (16 hexadecimales) de su contenido. */
export function coverKeyFor(id, hash) {
  const key = `portadas/${id}-${hash}.jpg`;
  if (!COVER_KEY.test(key)) throw new RangeError('Id o hash de portada no válidos.');
  return key;
}

/** True si [key] es un fichero de portada válido y, si se da [id], de ese id. */
export function isCoverKey(key, id = null) {
  const match = typeof key === 'string' ? COVER_KEY.exec(key) : null;
  return Boolean(match) && (id === null || match[1] === id);
}

/** Dirección pública de un fichero de portada del bucket. */
export function coverUrl(key) {
  return `${AUDIO_ORIGIN}/${key}`;
}

/**
 * Índice leído (texto JSON u objeto) como Map id → fichero. Lo que no vale se descarta: ids que no son S/F + 16
 * hexadecimales, ficheros con otro nombre o de otro id. Nunca lanza: un índice roto es un índice vacío.
 */
export function parseCoverIndex(value) {
  let data = value;
  if (typeof value === 'string') {
    try {
      data = JSON.parse(value);
    } catch {
      return new Map();
    }
  }
  const index = new Map();
  if (!data || typeof data !== 'object' || Array.isArray(data)) return index;
  for (const [id, key] of Object.entries(data)) {
    if (index.size >= MAX_INDEX_ENTRIES) break;
    if (COVER_ID.test(id) && isCoverKey(key, id)) index.set(id, key);
  }
  return index;
}

/** Texto del índice para guardar: claves ordenadas, una por línea. */
export function serializeCoverIndex(index) {
  const entries = [...(index instanceof Map ? index.entries() : Object.entries(index ?? {}))].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `${JSON.stringify(Object.fromEntries(entries), null, 1)}\n`;
}

/**
 * Catálogo (tal como viene de data/songs.json y data/folders.json) con las portadas del índice encima: copia las
 * canciones y álbumes que están en el índice con «cover» = dirección pública del fichero. No cambia las listas
 * recibidas. Idempotente.
 */
export function applyCoverIndex(songs, folders, index) {
  const map = index instanceof Map ? index : parseCoverIndex(index);
  const overlay = (item) => {
    if (!item || typeof item !== 'object' || item.local === true) return item;
    const key = map.get(item.id);
    if (!key) return item;
    const url = coverUrl(key);
    return item.cover === url ? item : { ...item, cover: url };
  };
  return {
    songs: map.size === 0 || !Array.isArray(songs) ? songs : songs.map(overlay),
    folders: map.size === 0 || !Array.isArray(folders) ? folders : folders.map(overlay),
  };
}

/**
 * True si el «cover» de un elemento del catálogo es el fichero [key] (con o sin la dirección del bucket delante). Es
 * la regla con la que una portada enviada por el Worker se confirma (tests/contrato/ediciones-pendientes.json).
 */
export function isCoverReflected(cover, key) {
  if (typeof cover !== 'string' || typeof key !== 'string' || key === '') return false;
  return cover === key || cover.endsWith(`/${key}`);
}

/**
 * Lee el índice sin caché. Devuelve el Map (vacío si aún no existe: 404). Lanza si no hay red o la respuesta es otra
 * cosa: quien llama sigue con el catálogo sin superponer.
 */
export async function fetchCoverIndex(fetchImpl = globalThis.fetch, { url = COVER_INDEX_URL, timeoutMs = INDEX_TIMEOUT_MS } = {}) {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetchImpl(url, { cache: 'no-store', ...(controller ? { signal: controller.signal } : {}) });
    if (response.status === 404) return new Map();
    if (!response.ok) throw new Error(`Índice de portadas: ${response.status}`);
    return parseCoverIndex(await response.text());
  } finally {
    if (timer) clearTimeout(timer);
  }
}
