// Subida local de audio del cuidador (ADR-0012). Los archivos que el cuidador elige en SU navegador se decodifican
// con decodeAudioData, se remuestrean a 48 kHz y se codifican a Opus con AudioEncoder (WebCodecs). El resultado se
// empaqueta como Ogg Opus (el mismo contenedor que el catálogo) y se guarda en una base de IndexedDB de este navegador.
// Nada sale del dispositivo: no hay fetch ni POST con el audio, no entra en la copia cifrada ni en el catálogo público.
//
// Las funciones puras (título, límites, tamaño, espacio, empaquetado Ogg) van exportadas para las pruebas
// (tests/web-unit/subida-local.test.mjs) y no tocan el navegador. Lo que usa el navegador se resuelve dentro de las
// funciones, nunca al cargar el módulo.

export const LOCAL_DB_NAME = 'reminiscencia-audio-local';
export const LOCAL_DB_VERSION = 1;
const STORE = 'pistas';
// Prefijo de los identificadores locales. El catálogo usa «S» + hexadecimal, así que no colisionan.
export const LOCAL_ID_PREFIX = 'L';
export const OPUS_RATE = 48000;
// Límites por archivo. El de duración acota la memoria: el audio decodificado ocupa 4 bytes por muestra y canal.
export const MAX_FILE_BYTES = 60 * 1024 * 1024;
export const MAX_DURATION_S = 20 * 60;
// Espacio que no se usa para canciones nuevas, para que el navegador no se quede sin margen.
export const SPACE_RESERVE_BYTES = 50 * 1024 * 1024;
export const LOCAL_AUDIO_ACCEPT = 'audio/*,.wav,.mp3,.m4a,.aac,.ogg,.oga,.opus,.flac';
export const UNSUPPORTED_TEXT = 'Este navegador no puede convertir audio a Opus, así que no se pueden añadir archivos desde aquí. Usa Chrome o Edge actualizados.';

// Tasas de Opus elegidas para escucha (ADR-0012). El catálogo publicado va por encima (~64 kbps estéreo).
const BITRATE_MONO = 32000;
const BITRATE_STEREO = 48000;
const OVERHEAD = 1.03; // páginas Ogg, cabeceras y margen sobre el flujo de Opus
const HEADER_BYTES = 16 * 1024;
const DEFAULT_PRE_SKIP = 312; // retardo típico del codificador Opus a 48 kHz
const DEFAULT_PACKET_SAMPLES = 960; // 20 ms a 48 kHz
const FRAME_FRAMES = OPUS_RATE; // bloques de 1 s al alimentar el codificador
const MAX_QUEUE = 8;
const PAGE_TARGET_BYTES = 4096;
const MAX_TITLE = 200;
const OGG_POLY = 0x04c11db7;
const TEXT = new TextEncoder();

/** Error con mensaje para el cuidador. Cualquier otro error se muestra como fallo genérico. */
export class LocalAudioError extends Error {
  constructor(message) {
    super(message);
    this.name = 'LocalAudioError';
  }
}

// ---------------------------------------------------------------------------------------------
// Funciones puras
// ---------------------------------------------------------------------------------------------

/** Título de la canción: el nombre del archivo sin la última extensión. Sin nombre útil, «Sin título». */
export function titleFromFileName(fileName) {
  const base = String(fileName ?? '').split(/[\\/]/).pop() ?? '';
  const title = base.replace(/\.[^.]*$/, '').trim();
  return (Array.from(title).slice(0, MAX_TITLE).join('') || 'Sin título');
}

/** Canales y tasa de salida: mono o estéreo (lo que tenga más de dos canales se mezcla a estéreo). */
export function outputFormat(channels) {
  const count = Number.isInteger(channels) && channels >= 2 ? 2 : 1;
  return { channels: count, bitrate: count === 2 ? BITRATE_STEREO : BITRATE_MONO };
}

/** Bytes aproximados del Ogg Opus de una canción de durationS segundos. */
export function estimateOpusBytes(durationS, channels) {
  const seconds = Number.isFinite(durationS) && durationS > 0 ? durationS : 0;
  const { bitrate } = outputFormat(channels);
  return Math.ceil((seconds * bitrate / 8) * OVERHEAD) + HEADER_BYTES;
}

/** Texto en megabytes con coma decimal, para los mensajes. */
export function formatMegabytes(bytes) {
  const mb = (Number.isFinite(bytes) ? bytes : 0) / (1024 * 1024);
  return `${mb.toFixed(1).replace('.', ',')} MB`;
}

/** Límites por archivo. Devuelve el motivo en texto o null si el archivo cabe. */
export function checkFileLimits({ bytes, durationS } = {}) {
  if (!(bytes > 0)) return 'El archivo está vacío.';
  if (bytes > MAX_FILE_BYTES) {
    return `El archivo pesa ${formatMegabytes(bytes)} y el límite es ${formatMegabytes(MAX_FILE_BYTES)}.`;
  }
  if (durationS !== undefined && durationS > MAX_DURATION_S) {
    return `La canción dura más de ${MAX_DURATION_S / 60} minutos. Divídela en partes más cortas.`;
  }
  return null;
}

/**
 * Comprueba si cabe la canción. quota/usage vienen de navigator.storage.estimate(). Sin cifras (quota no finita),
 * no se puede comprobar: se permite y se marca como no comprobado.
 */
export function checkSpace({ neededBytes, quota, usage = 0, reserveBytes = SPACE_RESERVE_BYTES } = {}) {
  if (!Number.isFinite(quota) || quota <= 0) {
    return { ok: true, known: false, availableBytes: null, neededBytes, message: null };
  }
  const used = Number.isFinite(usage) ? usage : 0;
  const availableBytes = Math.max(0, quota - used - reserveBytes);
  const ok = neededBytes <= availableBytes;
  return {
    ok,
    known: true,
    availableBytes,
    neededBytes,
    message: ok ? null
      : `No hay espacio suficiente en este navegador: la canción necesita unos ${formatMegabytes(neededBytes)} y quedan ${formatMegabytes(availableBytes)} libres (se reservan ${formatMegabytes(reserveBytes)}).`,
  };
}

/** Identificador local a partir de 8 bytes aleatorios: «L» + 16 hexadecimales. */
export function newLocalSongId(randomBytes) {
  if (!randomBytes || randomBytes.length !== 8) throw new RangeError('Hacen falta 8 bytes aleatorios.');
  return LOCAL_ID_PREFIX + Array.from(randomBytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Muestras a 48 kHz de un paquete Opus según su duración en microsegundos. */
export function packetSamples(durationUs) {
  return Number.isFinite(durationUs) && durationUs > 0 ? Math.round(durationUs * OPUS_RATE / 1e6) : DEFAULT_PACKET_SAMPLES;
}

/** Pre-skip de una cabecera OpusHead (bytes 10 y 11, little endian), o null si no es una cabecera válida. */
export function preSkipFromHead(description) {
  const bytes = description instanceof ArrayBuffer ? new Uint8Array(description)
    : ArrayBuffer.isView(description) ? new Uint8Array(description.buffer, description.byteOffset, description.byteLength)
      : null;
  if (!bytes || bytes.length < 12) return null;
  if (String.fromCharCode(...bytes.subarray(0, 8)) !== 'OpusHead') return null;
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(10, true);
}

// CRC de Ogg: polinomio 0x04C11DB7 sin reflejar, valor inicial 0 y sin xor final.
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let r = i << 24;
    for (let bit = 0; bit < 8; bit += 1) r = (r & 0x80000000) ? ((r << 1) ^ OGG_POLY) : (r << 1);
    table[i] = r >>> 0;
  }
  return table;
})();

/** CRC de una página Ogg (con el campo de CRC a cero). */
export function oggCrc(bytes) {
  let crc = 0;
  for (const byte of bytes) crc = ((crc << 8) ^ CRC_TABLE[((crc >>> 24) ^ byte) & 0xff]) >>> 0;
  return crc;
}

function u32le(value) {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value >>> 0, true);
  return out;
}

function concatBytes(parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function opusHeadPacket({ channels, preSkip, inputRate }) {
  const packet = new Uint8Array(19);
  const view = new DataView(packet.buffer);
  packet.set(TEXT.encode('OpusHead'), 0);
  packet[8] = 1; // versión
  packet[9] = channels;
  view.setUint16(10, preSkip, true);
  view.setUint32(12, inputRate, true);
  view.setInt16(16, 0, true); // ganancia de salida
  packet[18] = 0; // familia de mapeo 0: mono o estéreo
  return packet;
}

function opusTagsPacket(vendor, comments) {
  const vendorBytes = TEXT.encode(vendor);
  const parts = [TEXT.encode('OpusTags'), u32le(vendorBytes.length), vendorBytes, u32le(comments.length)];
  for (const comment of comments) {
    const bytes = TEXT.encode(comment);
    parts.push(u32le(bytes.length), bytes);
  }
  return concatBytes(parts);
}

// Una página Ogg: cabecera de 27 bytes, tabla de segmentos y los paquetes. Los paquetes no se parten entre páginas.
function oggPage({ headerType, granule, serial, seq, packets }) {
  const segments = [];
  let payload = 0;
  for (const packet of packets) {
    payload += packet.length;
    let left = packet.length;
    while (left >= 255) {
      segments.push(255);
      left -= 255;
    }
    segments.push(left);
  }
  if (segments.length > 255) throw new RangeError('Demasiados segmentos en una página Ogg.');
  const page = new Uint8Array(27 + segments.length + payload);
  const view = new DataView(page.buffer);
  page.set([0x4f, 0x67, 0x67, 0x53], 0); // "OggS"
  page[5] = headerType;
  view.setBigUint64(6, BigInt(granule), true);
  view.setUint32(14, serial >>> 0, true);
  view.setUint32(18, seq >>> 0, true);
  page[26] = segments.length;
  page.set(segments, 27);
  let offset = 27 + segments.length;
  for (const packet of packets) {
    page.set(packet, offset);
    offset += packet.length;
  }
  view.setUint32(22, oggCrc(page), true);
  return page;
}

/**
 * Empaqueta paquetes Opus en un Ogg Opus (RFC 7845). packets: [{ data: Uint8Array, samples }]. La posición de granule
 * cuenta el pre-skip y, al final, se recorta a totalSamples para que la duración sea exacta.
 */
export function buildOggOpus({
  packets,
  channels,
  preSkip = DEFAULT_PRE_SKIP,
  inputRate = OPUS_RATE,
  totalSamples,
  title = '',
  vendor = 'Reminiscencia',
  serial = 0x52454d49,
} = {}) {
  if (!Array.isArray(packets) || packets.length === 0) throw new RangeError('No hay audio que empaquetar.');
  if (channels !== 1 && channels !== 2) throw new RangeError('Solo se admiten mono o estéreo.');
  // La granule cuenta las muestras del codificador (con el pre-skip dentro) y se recorta a pre-skip + total al final.
  const cap = Number.isFinite(totalSamples) ? preSkip + totalSamples : Infinity;
  const pages = [
    oggPage({ headerType: 0x02, granule: 0, serial, seq: 0, packets: [opusHeadPacket({ channels, preSkip, inputRate })] }),
    oggPage({
      headerType: 0x00,
      granule: 0,
      serial,
      seq: 1,
      packets: [opusTagsPacket(vendor, title ? [`TITLE=${title}`] : [])],
    }),
  ];
  let seq = 2;
  let group = [];
  let groupBytes = 0;
  let groupSegments = 0;
  let cumulative = 0;
  let granule = 0;
  const emit = (last) => {
    pages.push(oggPage({ headerType: last ? 0x04 : 0x00, granule, serial, seq, packets: group }));
    seq += 1;
    group = [];
    groupBytes = 0;
    groupSegments = 0;
  };
  for (const packet of packets) {
    const segments = Math.floor(packet.data.length / 255) + 1;
    if (group.length > 0 && (groupSegments + segments > 255 || groupBytes >= PAGE_TARGET_BYTES)) emit(false);
    cumulative += packet.samples;
    granule = Math.min(cumulative, cap);
    group.push(packet.data);
    groupBytes += packet.data.length;
    groupSegments += segments;
  }
  emit(true);
  return concatBytes(pages);
}

/** Decide si una URL es de una canción local (blob de este navegador). */
export function isLocalAudioUrl(url) {
  return typeof url === 'string' && url.startsWith('blob:');
}

// ---------------------------------------------------------------------------------------------
// Navegador: soporte, espacio, conversión, base de datos local
// ---------------------------------------------------------------------------------------------

/** Dice si el navegador puede codificar Opus con WebCodecs y decodificar con Web Audio. */
export async function opusSupport(env = globalThis) {
  const hasDecoding = typeof env.AudioContext === 'function' || typeof env.webkitAudioContext === 'function';
  const hasRendering = typeof env.OfflineAudioContext === 'function' || typeof env.webkitOfflineAudioContext === 'function';
  if (typeof env.AudioEncoder !== 'function' || typeof env.AudioData !== 'function' || !hasDecoding || !hasRendering) {
    return { ok: false, reason: 'sin-api' };
  }
  try {
    for (const channels of [1, 2]) {
      const result = await env.AudioEncoder.isConfigSupported({
        codec: 'opus',
        sampleRate: OPUS_RATE,
        numberOfChannels: channels,
        bitrate: outputFormat(channels).bitrate,
      });
      if (!result?.supported) return { ok: false, reason: 'sin-opus' };
    }
    return { ok: true, reason: null };
  } catch {
    return { ok: false, reason: 'sin-opus' };
  }
}

/** Cifras de almacenamiento del origen, o nulls si el navegador no las da. */
export async function storageStatus(env = globalThis) {
  try {
    const estimate = await env.navigator?.storage?.estimate?.();
    if (estimate) return { quota: estimate.quota ?? null, usage: estimate.usage ?? null };
  } catch {
    // Sin estimación: el espacio no se puede comprobar.
  }
  return { quota: null, usage: null };
}

async function requestPersistence(env = globalThis) {
  try {
    await env.navigator?.storage?.persist?.();
  } catch {
    // Sin permiso de almacenamiento persistente, las canciones siguen guardadas hasta que el navegador las libere.
  }
}

function openLocalDb(env = globalThis) {
  return new Promise((resolve, reject) => {
    const factory = env.indexedDB;
    if (!factory) {
      reject(new LocalAudioError('Este navegador no permite guardar audio en el dispositivo.'));
      return;
    }
    let request;
    try {
      request = factory.open(LOCAL_DB_NAME, LOCAL_DB_VERSION);
    } catch {
      reject(new LocalAudioError('No se pudo abrir el almacenamiento de audio de este navegador.'));
      return;
    }
    // Migración: la versión 1 crea solo el almacén de canciones locales. No toca la base principal (store.js).
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new LocalAudioError('No se pudo abrir el almacenamiento de audio de este navegador.'));
    request.onblocked = () => reject(new LocalAudioError('El almacenamiento está abierto en otra pestaña. Ciérrala e inténtalo de nuevo.'));
  });
}

async function withStore(mode, work, env = globalThis) {
  const db = await openLocalDb(env);
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const store = tx.objectStore(STORE);
      let result;
      const req = work(store);
      if (req) req.onsuccess = () => { result = req.result; };
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('Transacción cancelada.'));
    });
  } finally {
    db.close();
  }
}

async function putRecord(record, env = globalThis) {
  try {
    await withStore('readwrite', (store) => store.put(record), env);
  } catch (error) {
    if (error?.name === 'QuotaExceededError') {
      throw new LocalAudioError('No hay espacio suficiente en este navegador para guardar la canción.');
    }
    throw new LocalAudioError('No se pudo guardar la canción en este navegador.');
  }
}

function readAllRecords(env = globalThis) {
  return withStore('readonly', (store) => store.getAll(), env);
}

// URL de objeto de cada canción local cargada, para revocarlas antes de volver a cargarlas.
const objectUrls = new Map();

function revokeObjectUrls() {
  for (const url of objectUrls.values()) URL.revokeObjectURL(url);
  objectUrls.clear();
}

/** Canción con la forma del catálogo. El audio es una URL de objeto del blob guardado en este navegador. */
export function songFromRecord(record) {
  const url = URL.createObjectURL(record.blob);
  objectUrls.set(record.id, url);
  return {
    id: record.id,
    title: record.title,
    artist: '',
    year: null,
    tags: [],
    folder_id: null,
    duration_s: record.durationS,
    local: true,
    audio: url,
  };
}

/** Canciones subidas desde este navegador, listas para añadir al catálogo en memoria. Nunca falla el arranque. */
export async function loadLocalSongs(env = globalThis) {
  revokeObjectUrls();
  try {
    const records = await readAllRecords(env);
    return records
      .filter((record) => record && typeof record.id === 'string' && record.blob instanceof Blob)
      .map(songFromRecord);
  } catch (error) {
    console.error('Reminiscencia: no se pudieron cargar las canciones subidas desde este dispositivo.', error);
    return [];
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Codifica el audio ya remuestreado a 48 kHz y devuelve los paquetes Opus y el pre-skip del codificador.
async function encodePlanar(buffer, { channels, bitrate }, onFraction, env = globalThis) {
  const packets = [];
  let preSkip = null;
  let failure = null;
  const encoder = new env.AudioEncoder({
    output: (chunk, metadata) => {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      packets.push({ data, samples: packetSamples(chunk.duration) });
      if (preSkip === null) {
        const description = metadata?.decoderConfig?.description;
        if (description) preSkip = preSkipFromHead(description);
      }
    },
    error: (error) => {
      failure = error;
    },
  });
  try {
    encoder.configure({
      codec: 'opus',
      sampleRate: OPUS_RATE,
      numberOfChannels: channels,
      bitrate,
      opus: { frameDuration: 20000 },
    });
    const total = buffer.length;
    for (let start = 0; start < total; start += FRAME_FRAMES) {
      const frames = Math.min(FRAME_FRAMES, total - start);
      const planar = new Float32Array(frames * channels);
      for (let c = 0; c < channels; c += 1) {
        planar.set(buffer.getChannelData(c).subarray(start, start + frames), c * frames);
      }
      const audio = new env.AudioData({
        format: 'f32-planar',
        sampleRate: OPUS_RATE,
        numberOfFrames: frames,
        numberOfChannels: channels,
        timestamp: Math.round((start * 1e6) / OPUS_RATE),
        data: planar,
      });
      encoder.encode(audio);
      audio.close();
      while (encoder.encodeQueueSize > MAX_QUEUE) {
        if (failure) break;
        await sleep(5);
      }
      if (failure) break;
      onFraction((start + frames) / total);
    }
    if (!failure) await encoder.flush();
  } catch {
    failure = failure ?? new Error('encoder');
  } finally {
    if (encoder.state !== 'closed') encoder.close();
  }
  if (failure || packets.length === 0) {
    throw new LocalAudioError('No se pudo convertir este archivo a Opus.');
  }
  return { packets, preSkip: preSkip ?? DEFAULT_PRE_SKIP };
}

/**
 * Convierte un archivo de audio a Ogg Opus en el navegador. onProgress recibe { stage, fraction } con fraction de 0 a 1.
 * Lanza LocalAudioError con un mensaje para el cuidador si el archivo no cabe, no se puede leer o no hay espacio.
 */
export async function convertToOpus(file, { onProgress = () => {}, env = globalThis } = {}) {
  const bytes = file?.size ?? 0;
  const sizeProblem = checkFileLimits({ bytes });
  if (sizeProblem) throw new LocalAudioError(sizeProblem);

  onProgress({ stage: 'leer', fraction: 0 });
  const data = await file.arrayBuffer();
  let decoded;
  const AudioContextClass = env.AudioContext || env.webkitAudioContext;
  const ctx = new AudioContextClass();
  try {
    decoded = await ctx.decodeAudioData(data);
  } catch {
    throw new LocalAudioError('No se puede leer este archivo. Comprueba que es audio válido (WAV, MP3, M4A, OGG o FLAC).');
  } finally {
    ctx.close?.()?.catch?.(() => {});
  }

  const durationProblem = checkFileLimits({ bytes, durationS: decoded.duration });
  if (durationProblem) throw new LocalAudioError(durationProblem);

  const format = outputFormat(decoded.numberOfChannels);
  const space = checkSpace({ neededBytes: estimateOpusBytes(decoded.duration, format.channels), ...(await storageStatus(env)) });
  if (!space.ok) throw new LocalAudioError(space.message);

  onProgress({ stage: 'convertir', fraction: 0.05 });
  const frames = Math.max(1, Math.ceil(decoded.duration * OPUS_RATE));
  const OfflineContext = env.OfflineAudioContext || env.webkitOfflineAudioContext;
  const offline = new OfflineContext(format.channels, frames, OPUS_RATE);
  // La mezcla de canales la hace el destino (altavoces): estéreo o mono sin pasos a mano.
  offline.destination.channelCountMode = 'explicit';
  offline.destination.channelCount = format.channels;
  offline.destination.channelInterpretation = 'speakers';
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start(0);
  const rendered = await offline.startRendering();

  onProgress({ stage: 'codificar', fraction: 0.15 });
  const { packets, preSkip } = await encodePlanar(
    rendered,
    format,
    (fraction) => onProgress({ stage: 'codificar', fraction: 0.15 + fraction * 0.8 }),
    env,
  );
  onProgress({ stage: 'guardar', fraction: 0.97 });
  const ogg = buildOggOpus({
    packets,
    channels: format.channels,
    preSkip,
    totalSamples: rendered.length,
    title: titleFromFileName(file.name),
  });
  return {
    bytes: ogg,
    durationS: rendered.length / OPUS_RATE,
    channels: format.channels,
    bitrate: format.bitrate,
  };
}

function randomId() {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  return newLocalSongId(bytes);
}

/**
 * Añade varios archivos. Cada uno se convierte y se guarda por separado: un fallo no para los demás.
 * Devuelve { added: canciones con forma de catálogo, failed: [{ name, message }] }.
 */
export async function addLocalFiles(files, { onProgress = () => {}, env = globalThis } = {}) {
  const list = Array.from(files ?? []);
  const support = await opusSupport(env);
  if (!support.ok) throw new LocalAudioError(UNSUPPORTED_TEXT);
  await requestPersistence(env);
  const added = [];
  const failed = [];
  for (let index = 0; index < list.length; index += 1) {
    const file = list[index];
    const title = titleFromFileName(file?.name);
    try {
      const converted = await convertToOpus(file, {
        env,
        onProgress: ({ stage, fraction }) => onProgress({
          index, total: list.length, name: title, stage, fraction,
        }),
      });
      const blob = new Blob([converted.bytes], { type: 'audio/ogg; codecs=opus' });
      const record = {
        id: randomId(),
        title,
        durationS: converted.durationS,
        channels: converted.channels,
        bitrate: converted.bitrate,
        bytes: blob.size,
        createdAt: Date.now(),
        blob,
      };
      await putRecord(record, env);
      added.push(songFromRecord(record));
    } catch (error) {
      const message = error instanceof LocalAudioError ? error.message : 'No se pudo añadir este archivo.';
      if (!(error instanceof LocalAudioError)) console.error('Reminiscencia: fallo al añadir audio local.', error);
      failed.push({ name: file?.name || title, message });
    }
  }
  return { added, failed };
}
