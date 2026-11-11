
import { summaryText } from '../cuidador/subida-estado.js';
import { el, openDialog } from '../ui/dom.js';
import { icon } from '../ui/icons.js';

// ==================================================
// CONFIGURACIÓN
// ==================================================

// El navegador solo habla con el mismo origen. Estas funciones serverless ocultan
// yttowav.org y permiten mantener la CSP `connect-src 'self'`.
const CONVERTER_ENDPOINTS = {
  convert: '/api/youtube/convert',
  status: '/api/youtube/status',
  download: '/api/youtube/download'
};

// Endpoint del backend que utiliza yt-dlp para listar los vídeos sin descargarlos.
const PLAYLIST_ENDPOINT = '/api/youtube/playlist';

const CONFIG = {
  format: 'wav',
  quality: 'original',
  batchSize: 4,
  convertCreateAttempts: 6,
  convertCreateGap: 2000,
  pollInterval: 3000,
  statusErrorRetries: 5,
  jobTimeout: 600000,
  transferPasses: 4, // reintentos de la LISTA completa: tras cada pasada se reintentan solo las pistas que fallaron
  transferPassGap: 30000, // espera entre pasadas para que el conversor (yttowav) se recupere del throttling
  circuitBreak: 15, // si fallan N conversiones SEGUIDAS, el conversor está capado: se corta la tanda (lo hecho queda subido)
};

const IMPORT_STORAGE_KEY = 'reminiscencia.youtube-imports';
const IMPORT_STORAGE_VERSION = 1;
const YOUTUBE_DB_NAME = 'reminiscencia-youtube-import';
const YOUTUBE_DB_VERSION = 1;
const YOUTUBE_DB_STORE = 'wav';

// Evita repetir canciones ya convertidas durante la sesión. La copia WAV en IndexedDB
// permite reanudar si se cierra la hoja antes de añadirla a la cola.
const completedVideos = new Set();
const activeVideos = new Set();
let nextConvertCreateAt = 0;

// ==================================================
// UTILIDADES
// ==================================================

function importRecords() {
  try {
    const parsed = JSON.parse(globalThis.localStorage?.getItem(IMPORT_STORAGE_KEY) ?? 'null');
    return parsed?.version === IMPORT_STORAGE_VERSION && parsed.records && typeof parsed.records === 'object'
      ? parsed.records : {};
  } catch (error) {
    console.warn('Homeostasia: no se pudo leer el estado de YouTube guardado.', error);
    return {};
  }
}

function saveImportRecord(videoId, record) {
  try {
    const records = importRecords();
    records[videoId] = { ...records[videoId], ...record, updatedAt: Date.now() };
    globalThis.localStorage?.setItem(IMPORT_STORAGE_KEY, JSON.stringify({ version: IMPORT_STORAGE_VERSION, records }));
    return true;
  } catch (error) {
    console.warn('Homeostasia: no se pudo guardar el estado de YouTube.', error);
    return false;
  }
}

function cachedRecord(videoId) { return importRecords()[videoId] ?? null; }

function openYoutubeDb() {
  if (!globalThis.indexedDB) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const request = globalThis.indexedDB.open(YOUTUBE_DB_NAME, YOUTUBE_DB_VERSION);
    request.onupgradeneeded = () => request.result.createObjectStore(YOUTUBE_DB_STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('No se pudo abrir el almacenamiento de YouTube.'));
  });
}

async function cacheWav(videoId, title, blob) {
  try {
    const db = await openYoutubeDb();
    if (!db) return;
    await new Promise((resolve, reject) => {
      const tx = db.transaction(YOUTUBE_DB_STORE, 'readwrite');
      tx.objectStore(YOUTUBE_DB_STORE).put({ videoId, title, blob, savedAt: Date.now() }, videoId);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error || new Error('No se pudo guardar el WAV.'));
    });
    db.close();
  } catch (error) {
    console.warn('Homeostasia: no se pudo guardar temporalmente el WAV.', error);
  }
}

async function readCachedWav(videoId) {
  try {
    const db = await openYoutubeDb();
    if (!db) return null;
    const result = await new Promise((resolve, reject) => {
      const request = db.transaction(YOUTUBE_DB_STORE, 'readonly').objectStore(YOUTUBE_DB_STORE).get(videoId);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return result?.blob instanceof Blob ? result : null;
  } catch (error) {
    console.warn('Homeostasia: no se pudo recuperar un WAV temporal.', error);
    return null;
  }
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException('La importación fue cancelada.', 'AbortError')); return; }
    const abort = () => { clearTimeout(timer); reject(new DOMException('La importación fue cancelada.', 'AbortError')); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
    signal?.addEventListener('abort', abort, { once: true });
  });
}

async function esperarTurnoCreacion(signal, deadline) {
  const now = Date.now();
  const scheduledAt = Math.max(now, nextConvertCreateAt);
  if (scheduledAt >= deadline) {
    throw new Error('Se ha agotado el tiempo de espera de la conversión.');
  }
  nextConvertCreateAt = scheduledAt + CONFIG.convertCreateGap;
  if (scheduledAt > now) await sleep(scheduledAt - now, signal);
}

function sanitizeFilename(name) {
  return (name || 'audio')
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'audio';
}

function getVideoId(url) {
  try {
    const parsed = new URL(url);

    if (parsed.hostname === 'youtu.be') {
      return parsed.pathname.slice(1).split('/')[0] || null;
    }

    if (parsed.pathname === '/watch') return parsed.searchParams.get('v') || null;
    return parsed.pathname.match(/^\/(?:shorts|embed)\/([A-Za-z0-9_-]{11})$/)?.[1] || null;
  } catch {
    return null;
  }
}

function validateYoutubeImportUrl(value) {
  try {
    const url = new URL(value);

    const validHosts = [
      'youtube.com',
      'www.youtube.com',
      'm.youtube.com',
      'music.youtube.com',
      'youtu.be'
    ];

    const host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || !validHosts.includes(host)) {
      return false;
    }

    if (host === 'youtu.be') {
      return /^[A-Za-z0-9_-]{11}$/.test(url.pathname.slice(1).split('/')[0] || '');
    }
    if (url.searchParams.has('list')) {
      return /^[A-Za-z0-9_-]{1,200}$/.test(url.searchParams.get('list') || '');
    }
    if (url.pathname === '/watch') {
      return /^[A-Za-z0-9_-]{11}$/.test(url.searchParams.get('v') || '');
    }
    return /^\/(?:shorts|embed)\/[A-Za-z0-9_-]{11}$/.test(url.pathname);
  } catch {
    return false;
  }
}

// ==================================================
// OBTENER CANCIONES DE LA PLAYLIST
// ==================================================

async function fetchJson(url, init = {}, signal) {
  const response = await fetch(url, { ...init, signal });
  let data = null;
  try { data = await response.json(); } catch { /* se usa el código HTTP */ }
  if (!response.ok) {
    const error = new Error(data?.error || `Error de red: ${response.status}`);
    error.status = response.status;
    error.retryAfter = response.headers.get('retry-after');
    throw error;
  }
  return data;
}

function retryDelay(error, attempt) {
  const retryAfter = error.retryAfter?.trim();
  if (retryAfter) {
    const seconds = Number(retryAfter);
    const serverDelay = Number.isFinite(seconds)
      ? seconds * 1000
      : Date.parse(retryAfter) - Date.now();
    if (Number.isFinite(serverDelay)) {
      const delay = Math.min(Math.max(0, serverDelay), 300000);
      return delay + Math.random() * Math.min(3000, Math.max(500, delay * 0.1));
    }
  }
  const delay = Math.min(10000 * (2 ** (attempt - 1)), 90000);
  return delay + Math.random() * Math.min(3000, Math.max(500, delay * 0.1));
}

function conversionStatusLabel({ status, queuePosition, queueLength, progress } = {}) {
  if (status === 'resuming') return 'retomando el trabajo anterior';
  if (status === 'queued') {
    const queue = Number.isSafeInteger(queuePosition) && Number.isSafeInteger(queueLength)
      ? ` (posición ${queuePosition} de ${queueLength})`
      : '';
    return `en cola${queue}`;
  }
  if (status === 'processing') {
    const percentage = typeof progress === 'number' && Number.isFinite(progress)
      ? ` (${Math.round(progress)} %)`
      : '';
    return `procesándose${percentage}`;
  }
  if (status === 'completed' || status === 'done') return 'preparando la descarga WAV';
  return status || 'estado desconocido';
}

async function listarPlaylist(playlistUrl, signal) {
  const data = await fetchJson(
    `${PLAYLIST_ENDPOINT}?url=${encodeURIComponent(playlistUrl)}`,
    {
      method: 'GET',
      headers: {
        Accept: 'application/json'
      }
    },
    signal
  );

  if (!Array.isArray(data.items)) {
    throw new Error(
      'La respuesta del servidor no contiene una lista válida de canciones.'
    );
  }

  const seen = new Set();
  const items = data.items
    .filter((item) => item && typeof item.url === 'string' && item.url)
    .map((item) => ({
      url: item.url,
      title: typeof item.title === 'string' && item.title ? item.title : 'audio',
      artist: typeof item.artist === 'string' ? Array.from(item.artist.trim()).slice(0, 200).join('') : ''
    }))
    .filter((item) => {
      const videoId = getVideoId(item.url);
      if (!videoId || seen.has(videoId)) return false;
      seen.add(videoId);
      return true;
    });
  const hasPlaylistId = new URL(playlistUrl).searchParams.has('list');
  let album = null;
  if (hasPlaylistId) {
    const playlist = data.playlist;
    if (!playlist || typeof playlist.id !== 'string' || typeof playlist.title !== 'string' || !playlist.title.trim()) {
      throw new Error('YouTube no ha devuelto el nombre de la playlist; no se iniciará una importación sin álbum.');
    }
    album = { id: playlist.id, name: playlist.title.trim() };
  }
  return { items, album };
}

// ==================================================
// CREAR CONVERSIÓN EN YTTOWAV
// ==================================================

async function crearJob(url, title, signal, deadline, onRetry, traceId, onCreated) {
  let data;
  for (let attempt = 1; attempt <= CONFIG.convertCreateAttempts; attempt++) {
    await esperarTurnoCreacion(signal, deadline);
    try {
      data = await fetchJson(
        CONVERTER_ENDPOINTS.convert,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: '*/*',
            'X-Homeostasia-Trace': traceId
          },
          body: JSON.stringify({ url, title: title || '' })
        },
        signal
      );
      break;
    } catch (error) {
      const retryable = error?.name !== 'AbortError' && (
        error.status === undefined ||
        [408, 425, 429, 503, 504].includes(error.status)
      );
      if (!retryable || attempt === CONFIG.convertCreateAttempts) throw error;
      const delay = retryDelay(error, attempt);
      if (Date.now() + delay >= deadline) {
        throw new Error('Se ha agotado el tiempo de espera de la conversión.');
      }
      const retryInSeconds = Math.ceil(delay / 1000);
      console.warn(
        `Homeostasia: yttowav rechazó temporalmente la creación; reintento ${attempt + 1}/${CONFIG.convertCreateAttempts} en ${retryInSeconds} s.`,
        error.message
      );
      onRetry?.({ attempt: attempt + 1, retryInSeconds, message: error.message });
      await sleep(delay, signal);
    }
  }

  const jobId =
    data.jobId ||
    data.id ||
    data.job?.id;

  if (!jobId) {
    throw new Error(
      'El conversor no ha devuelto un identificador de trabajo.'
    );
  }

  onCreated?.(jobId);
  return jobId;
}

// ==================================================
// CONSULTAR ESTADO Y DESCARGAR WAV
// ==================================================

async function esperarYDescargar(jobId, signal, deadline, onStatus, traceId, videoId) {
  let consecutiveStatusErrors = 0;
  let poll = 0;

  while (Date.now() < deadline) {
    let data;
    try {
      poll++;
      data = await fetchJson(
        `${CONVERTER_ENDPOINTS.status}?jobId=${encodeURIComponent(jobId)}`,
        {
          headers: {
            Accept: 'application/json',
            'X-Homeostasia-Trace': traceId,
            'X-Homeostasia-Poll': String(poll)
          }
        },
        signal
      );
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      if (error.status >= 400 && error.status < 500 && error.status !== 408 && error.status !== 429) {
        if (error.status === 404) {
          saveImportRecord(videoId, { state: 'expired', jobId: null });
          error.message = 'La conversión ya no está disponible. Puedes iniciar una nueva.';
        }
        throw error;
      }
      consecutiveStatusErrors++;
      if (consecutiveStatusErrors >= CONFIG.statusErrorRetries) {
        throw new Error(
          `No se pudo consultar el estado de la conversión tras ${consecutiveStatusErrors} intentos: ${error.message}`
        );
      }
      await sleep(Math.min(CONFIG.pollInterval, deadline - Date.now()), signal);
      continue;
    }
    consecutiveStatusErrors = 0;

    const status = (
      data.status || ''
    ).toLowerCase();
    onStatus?.({
      status,
      queuePosition: data.queuePosition,
      queueLength: data.queueLength,
      progress: data.progress
    });
    if (poll === 1 || poll % 10 === 0 || (status !== 'queued' && status !== 'processing')) {
      console.info('Homeostasia: estado de conversión', {
        traceId,
        poll,
        status,
        queuePosition: data.queuePosition,
        queueLength: data.queueLength,
        progress: data.progress
      });
    }

    if (status === 'error') {
      saveImportRecord(videoId, { state: 'failed', jobId: null });
      throw new Error(
        data.errorText ||
        data.error ||
        'Error del servidor de conversión.'
      );
    }

    if (
      status === 'completed' ||
      status === 'done'
    ) {
      const download = await fetch(
        `${CONVERTER_ENDPOINTS.download}?jobId=${encodeURIComponent(jobId)}`,
        { headers: { Accept: 'audio/wav' }, signal }
      );

      if (!download.ok) {
        throw new Error(
          'No se ha podido descargar el archivo WAV.'
        );
      }

      const blob = await download.blob();

      if (blob.size <= 44) {
        throw new Error(
          'El archivo WAV está vacío o incompleto.'
        );
      }

      const header = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
      if (
        String.fromCharCode(...header.slice(0, 4)) !== 'RIFF' ||
        String.fromCharCode(...header.slice(8, 12)) !== 'WAVE'
      ) {
        throw new Error(
          'El archivo descargado no tiene una cabecera WAV válida.'
        );
      }

      return blob;
    }

    await sleep(Math.min(CONFIG.pollInterval, deadline - Date.now()), signal);
  }

  throw new Error(
    'Se ha agotado el tiempo de espera de la conversión.'
  );
}

// ==================================================
// CONVERTIR UNA CANCIÓN A WAV
// ==================================================

async function convertirCancion(item, index, total, signal, onRetry, onStatus) {
  const videoId = getVideoId(item.url);

  if (!videoId || completedVideos.has(videoId) || activeVideos.has(videoId) || cachedRecord(videoId)?.state === 'queued') {
    return {
      success: false,
      skipped: true,
      title: item.title
    };
  }

  activeVideos.add(videoId);
  try {
    const saved = cachedRecord(videoId);
    const pendingJob = saved?.state === 'converting' && typeof saved.jobId === 'string'
      ? saved.jobId
      : null;
    const traceId = pendingJob && typeof saved.traceId === 'string'
      ? saved.traceId
      : globalThis.crypto.randomUUID();
    const deadline = Date.now() + CONFIG.jobTimeout;
    const cached = await readCachedWav(videoId);
    const blob = cached?.blob || await (async () => {
      const jobId = pendingJob || await crearJob(
        item.url,
        item.title,
        signal,
        deadline,
        onRetry,
        traceId,
        (createdJobId) => {
          if (!saveImportRecord(videoId, {
            title: item.title,
            state: 'converting',
            jobId: createdJobId,
            traceId
          })) {
            throw new Error(
              'La conversión se creó, pero no se pudo guardar su seguimiento. No vuelvas a iniciarla todavía.'
            );
          }
        }
      );
      if (pendingJob) {
        onStatus?.({ status: 'resuming' });
      }
      return esperarYDescargar(jobId, signal, deadline, onStatus, traceId, videoId);
    })();

    const filename =
      `${sanitizeFilename(item.title)}.wav`;

    const file = new File(
      [blob],
      filename,
      {
        type: 'audio/wav',
        lastModified: Date.now()
      }
    );

    completedVideos.add(videoId);
    await cacheWav(videoId, item.title, blob);
    saveImportRecord(videoId, { title: item.title, filename, state: 'converted', jobId: null });

    return {
      success: true,
      file,
      videoId,
      index,
      total
    };

  } catch (error) {
    console.error(
      `[${index}/${total}] Error convirtiendo ${item.title}:`,
      error
    );

    return {
      success: false,
      skipped: false,
      title: item.title,
      item,
      error
    };
  } finally {
    activeVideos.delete(videoId);
  }
}

// ==================================================
// PROCESAR PLAYLIST EN LOTES DE CUATRO
// ==================================================

async function convertirPlaylist(items, onProgress, signal, onBatch) {
  const files = [];
  const trackArtists = [];
  const completedIds = [];
  const errors = [];
  let delivered = 0; // cuántos de `files` ya se han entregado por onBatch (subida incremental)

  let processed = 0;
  let started = 0;
  // Cortacircuitos: si el conversor externo rechaza muchas conversiones SEGUIDAS, está capado por cuota; no tiene sentido
  // seguir machacándolo (haría que la tanda durase horas). Se corta: lo ya convertido queda subido y el resto queda como
  // error (pendiente) para un reintento posterior, que al ir por caché salta lo ya hecho.
  let consecutiveFails = 0;
  let circuitOpen = false;

  const total = items.length;

  for (
    let i = 0;
    i < items.length;
    i += CONFIG.batchSize
  ) {
    if (signal?.aborted) break;
    const batch = items.slice(
      i,
      i + CONFIG.batchSize
    );

    // Ejecutar un máximo de cuatro conversiones simultáneas.
    await Promise.all(
      batch.map(async (item, position) => {
        started++;
        // Si el cortacircuitos ya saltó, no se intenta: se marca como pendiente al instante (sin golpear al conversor).
        if (circuitOpen) {
          processed++;
          errors.push({ success: false, skipped: false, title: item.title, item, error: new Error('El conversor alcanzó su límite; reintenta más tarde.') });
          return;
        }
        onProgress({
          processed,
          total,
          completed: files.length,
          failed: errors.length,
          active: started - processed,
          current: item.title
        });

        const result = await convertirCancion(
          item,
          i + position + 1,
          total,
          signal,
          ({ attempt, retryInSeconds, message }) => onProgress({
            processed,
            total,
            completed: files.length,
            failed: errors.length,
            active: started - processed,
            current: item.title,
            retryAttempt: attempt,
            retryInSeconds,
            error: message
          }),
          (conversionStatus) => onProgress({
            processed,
            total,
            completed: files.length,
            failed: errors.length,
            active: started - processed,
            current: item.title,
            conversionStatus
          })
        );
        processed++;

        if (result.success) {
          files.push(result.file);
          trackArtists.push(item.artist || '');
          completedIds.push(result.videoId);
          consecutiveFails = 0;
        } else if (!result.skipped) {
          errors.push(result);
          consecutiveFails++;
          if (consecutiveFails >= CONFIG.circuitBreak) circuitOpen = true;
        }

        onProgress({
          processed,
          total,
          completed: files.length,
          failed: errors.length,
          active: started - processed,
          current: result.title || result.file?.name
        });
      })
    );

    // Entrega incremental: en cuanto una tanda termina de convertir, se suben sus WAV (no se espera a toda la lista). Así,
    // si el conversor se satura a mitad, lo ya convertido queda subido y publicándose, no en el limbo (ADR-0044).
    if (onBatch && files.length > delivered) {
      const newFiles = files.slice(delivered);
      const newArtists = trackArtists.slice(delivered);
      const newIds = completedIds.slice(delivered);
      delivered = files.length;
      await onBatch(newFiles, newArtists, newIds);
    }
  }

  return {
    files,
    trackArtists,
    completedIds,
    errors,
    total,
    processed
  };
}

// ==================================================
// IMPORTAR UN VÍDEO SUELTO (buscador, ADR-0021)
// ==================================================

/** Importa un vídeo de YouTube por el mismo camino que pegar su URL en Homeostasia: lee título y artista con el proxy,
 *  convierte a WAV y lo entrega a la cola de subidas, donde se pasa a Opus y se publica.
 *  Devuelve 'queued' si lo ha añadido a la cola o 'already' si ya estaba hecho o en marcha. Lanza Error si falla. */
export async function importYoutubeVideo(ctx, url, { signal, onStatus, fallbackArtist = '' } = {}) {
  if (!validateYoutubeImportUrl(url)) throw new Error('La URL de YouTube no es válida.');
  const videoId = getVideoId(url);
  // Un registro «en cola» de otra sesión no prueba que la canción esté en la biblioteca (la subida pudo no terminar):
  // desde el buscador se vuelve a descargar; el servidor reconoce por contenido lo que ya está publicado.
  if (!videoId || activeVideos.has(videoId)) {
    return 'already';
  }
  completedVideos.delete(videoId);
  if (cachedRecord(videoId)?.state === 'queued') saveImportRecord(videoId, { state: 'retry' });
  onStatus?.('Leyendo YouTube…');
  const { items, album } = await listarPlaylist(url, signal);
  if (items.length === 0) throw new Error('No se han encontrado canciones en YouTube.');
  const result = await convertirPlaylist(items, ({ retryAttempt, retryInSeconds, conversionStatus }) => {
    if (retryAttempt) {
      onStatus?.(`El conversor está saturado. Reintento ${retryAttempt}/${CONFIG.convertCreateAttempts} en ${retryInSeconds} s.`);
    } else if (conversionStatus) {
      onStatus?.(`Convirtiendo: ${conversionStatusLabel(conversionStatus)}.`);
    }
  }, signal);
  if (result.files.length === 0) {
    if (result.errors.length > 0) throw result.errors[0].error ?? new Error('No se pudo convertir la canción.');
    return 'already';
  }
  // Si el proxy no da artista, vale el canal del resultado de la búsqueda.
  const trackArtists = result.trackArtists.map((artist) => artist || fallbackArtist);
  await ctx.addUploads(result.files, { album, trackArtists });
  result.completedIds.forEach((id) => {
    completedVideos.add(id);
    saveImportRecord(id, { state: 'queued' });
  });
  return 'queued';
}

// ==================================================
// TRANSFERIR DESDE SPOTIFY (ADR-0044)
// ==================================================

/** Convierte una lista de pistas ya resueltas a YouTube [{url, title, artist}] y las entrega a la cola de subidas bajo un
 *  mismo álbum (el de la colección de Spotify), por el MISMO camino que una playlist de YouTube: convertir a WAV, pasar a
 *  Opus y publicar, conservando orden (UUIDv7) y con el dedup del pipeline. Devuelve {files, trackArtists, completedIds,
 *  errors, total, processed}. */
export async function importYoutubeTracks(ctx, tracks, { album = null, onProgress = () => {}, signal } = {}) {
  const items = (tracks ?? []).filter((track) => track && track.url);
  if (items.length === 0) return { files: [], trackArtists: [], completedIds: [], errors: [], total: 0, processed: 0 };
  // Subida incremental por tandas: cada grupo convertido se entrega a la cola de subidas al momento.
  const uploadBatch = async (files, trackArtists, completedIds) => {
    await ctx.addUploads(files, { album, trackArtists });
    completedIds.forEach((id) => { completedVideos.add(id); saveImportRecord(id, { state: 'queued' }); });
  };
  // Varias PASADAS sobre la lista: el conversor externo (yttowav) hace throttling con listas grandes y rechaza algunas
  // pistas con 503. Tras cada pasada se reintentan SOLO las que fallaron, con una espera para que yttowav se recupere; lo
  // ya convertido y subido se omite al instante (completedVideos / estado 'queued' en caché, y la WAV en IndexedDB). Así
  // una lista larga termina subiéndose ENTERA sin intervención, en vez de dejar un resto colgado (ADR-0044).
  const aggregate = { files: [], trackArtists: [], completedIds: [], errors: [], total: items.length, processed: 0 };
  let pending = items;
  for (let pass = 0; pass < CONFIG.transferPasses; pass++) {
    if (signal?.aborted) break;
    const result = await convertirPlaylist(pending, onProgress, signal, uploadBatch);
    aggregate.files.push(...result.files);
    aggregate.trackArtists.push(...result.trackArtists);
    aggregate.completedIds.push(...result.completedIds);
    aggregate.processed += result.processed;
    aggregate.errors = result.errors; // solo cuentan como error las que siguen fallando tras la última pasada
    const failedItems = result.errors.map((entry) => entry.item).filter(Boolean);
    if (failedItems.length === 0) break; // todo convertido
    // Si esta pasada no logró NINGUNA conversión nueva, el conversor está capado ahora mismo: no se sigue machacando.
    // Lo ya subido queda guardado; el resto se completa en un reintento posterior (la caché salta lo hecho).
    if (result.files.length === 0) break;
    pending = failedItems;
    if (pass < CONFIG.transferPasses - 1) {
      try { await sleep(CONFIG.transferPassGap, signal); } catch { break; } // cancelado durante la espera
    }
  }
  return aggregate;
}

// ==================================================
// ABRIR HOJA HOMEOSTASIA
// ==================================================

export function openHomeostasiaSheet(ctx) {
  return openDialog({
    title: 'Homeostasia',
    className: 'dialog-homeostasia',
    testid: 'homeostasia-sheet',

    render: (body, close, dialog) => {
      const panel = homeostasiaPanel(ctx, close);

      dialog?.addEventListener(
        'close',
        () => panel.cleanup()
      );

      body.replaceChildren(panel.node);

      body.querySelector(
        '[data-autofocus]'
      )?.focus();
    }
  });
}

// ==================================================
// PANEL PRINCIPAL
// ==================================================

function homeostasiaPanel(ctx, close) {
  let conversionActive = false;
  let destroyed = false;
  let importerController = null;
  let failedItems = [];
  let failedAlbum = null;
  let pendingQueueFiles = [];
  let pendingQueueIds = [];
  let pendingQueueAlbum = null;
  let pendingQueueArtists = [];

  // ------------------------------------------------
  // IMPORTADOR DE VÍDEOS Y PLAYLISTS
  // ------------------------------------------------

  const playlistInput = el('input', {
    type: 'url',
    class: 'input',
    placeholder: 'Pega el enlace de un vídeo o playlist',
    'aria-label': 'Enlace de vídeo o playlist de YouTube',
    autocomplete: 'url',
    'data-testid': 'homeostasia-playlist-input'
  });

  const playlistButton = el('button', {
    type: 'button',
    class: 'homeostasia-submit',
    'data-testid': 'homeostasia-playlist',
    on: {
      click: importarPlaylist
    }
  },
    icon('note', { size: 18 }),
    'Importar de YouTube'
  );

  const retryButton = el('button', {
    type: 'button',
    class: 'button button-text',
    'data-testid': 'homeostasia-retry',
    hidden: true,
    on: {
      click: gestionarReintento
    }
  }, 'Reintentar canciones fallidas');

  const stopButton = el('button', {
    type: 'button',
    class: 'button button-text',
    'data-testid': 'homeostasia-stop',
    hidden: true,
    on: {
      click: () => {
        importerController?.abort();
        stopButton.disabled = true;
        status.textContent = 'Deteniendo consultas… La conversión externa puede continuar.';
      }
    }
  }, 'Detener seguimiento');

  // ------------------------------------------------
  // ESTADO Y PROGRESO
  // ------------------------------------------------

  const status = el('p', {
    class: 'upload-status',
    role: 'status',
    'data-testid': 'homeostasia-status'
  });

  const progress = el('button', {
    type: 'button',
    class: 'button button-text',
    'data-testid': 'homeostasia-progress',
    hidden: true,
    on: {
      click: () => {
        close?.();
        ctx.openUpload();
      }
    }
  }, 'Ver el progreso');

  // ------------------------------------------------
  // IMPORTAR PLAYLIST DE YOUTUBE
  // ------------------------------------------------

  async function importarPlaylist() {
    if (conversionActive || destroyed) return;

    const playlistUrl = playlistInput.value.trim();

    if (!playlistUrl) {
      status.textContent =
        'Introduce una URL de YouTube.';

      return;
    }

    if (!validateYoutubeImportUrl(playlistUrl)) {
      status.textContent =
        'La URL de YouTube no es válida.';

      return;
    }

    conversionActive = true;
    const controller = new AbortController();
    importerController = controller;

    playlistButton.disabled = true;
    playlistInput.disabled = true;
    stopButton.hidden = false;
    stopButton.disabled = false;

    progress.hidden = true;

    try {
      status.textContent =
        'Leyendo YouTube…';

      const { items, album } = await listarPlaylist(playlistUrl, controller.signal);
      failedAlbum = album;

      if (items.length === 0) {
        throw new Error(
          'No se han encontrado canciones en YouTube.'
        );
      }

      status.textContent =
        `Se han encontrado ${items.length} canciones. Iniciando conversiones…`;

      const result = await convertirPlaylist(
        items,
        ({
          processed,
          total,
          completed,
          failed,
          active,
          retryAttempt,
          retryInSeconds,
          conversionStatus,
          error,
          current
        }) => {
          if (destroyed) return;

          if (retryAttempt) {
            status.textContent =
              `yttowav está temporalmente saturado. Reintento ${retryAttempt}/${CONFIG.convertCreateAttempts} en ${retryInSeconds} s. ` +
              (error || '');
            return;
          }

          if (conversionStatus) {
            status.textContent =
              `«${current || 'Canción'}»: ${conversionStatusLabel(conversionStatus)}. ` +
              `${processed} de ${total} terminadas; ${active} en curso.`;
            return;
          }

          status.textContent =
            `Conversión: ${processed} de ${total} terminadas; ${active} en curso. ` +
            `Correctas: ${completed}. ` +
            `Errores: ${failed}.` +
            (current ? ` Última: ${current}` : '');
        },
        controller.signal
      );
      stopButton.hidden = true;

      // IMPORTANTE:
      // Los WAV pasan por la misma cola de publicación
      // que los archivos seleccionados manualmente.
      failedItems = result.errors.map(({ item }) => item).filter(Boolean);
      let queueError = '';
      if (result.files.length > 0) {
        try {
          await ctx.addUploads(result.files, { album, trackArtists: result.trackArtists });
          result.completedIds.forEach((videoId) => {
            completedVideos.add(videoId);
            saveImportRecord(videoId, { state: 'queued' });
          });
          pendingQueueFiles = [];
          pendingQueueIds = [];
          pendingQueueAlbum = null;
          pendingQueueArtists = [];
          progress.hidden = false;
        } catch (error) {
          console.error('Error añadiendo WAV a la cola de Homeostasia:', error);
          pendingQueueFiles = result.files;
          pendingQueueIds = result.completedIds;
          pendingQueueAlbum = album;
          pendingQueueArtists = result.trackArtists;
          queueError = error.message || 'Los WAV se descargaron, pero no se pudieron añadir a la cola de subidas.';
        }
      }

      retryButton.hidden = failedItems.length === 0 && pendingQueueFiles.length === 0;
      if (failedItems.length === 0) failedAlbum = null;
      const conversionError = result.errors[0]?.error?.message;
      status.textContent = controller.signal.aborted
        ? `Seguimiento detenido. ${result.files.length} WAV listos para añadir; ` +
          `${failedItems.length} canciones se podrán reanudar después. La conversión externa puede continuar.`
        : [
        `Importación procesada: ${result.processed} canciones.`,
        `${result.files.length} WAV preparados para subir.`,
        `${result.errors.length} errores de conversión.`,
        conversionError ? `Primer error: ${conversionError}` : '',
        queueError
      ].filter(Boolean).join(' ');

      if (result.errors.length > 0) {
        console.warn(
          'Errores de conversión:',
          result.errors
        );
      }

      if (result.files.length > 0) {
        playlistInput.value = '';
      }

    } catch (error) {
      console.error(
        'Error importando desde YouTube:',
        error
      );

      status.textContent = controller.signal.aborted
        ? 'Seguimiento detenido. La conversión externa puede continuar; puedes reanudarla con el mismo trabajo.'
        : error.message || 'Error procesando la playlist.';

    } finally {
      conversionActive = false;
      if (importerController === controller) importerController = null;
      stopButton.hidden = true;
      stopButton.disabled = false;

      if (!destroyed) {
        playlistButton.disabled = false;
        playlistInput.disabled = false;
      }
    }
  }

  async function gestionarReintento() {
    if (pendingQueueFiles.length > 0) {
      const files = pendingQueueFiles;
      try {
        await ctx.addUploads(files, { album: pendingQueueAlbum, trackArtists: pendingQueueArtists });
        pendingQueueIds.forEach((videoId) => {
          completedVideos.add(videoId);
          saveImportRecord(videoId, { state: 'queued' });
        });
        pendingQueueFiles = [];
        pendingQueueIds = [];
        pendingQueueAlbum = null;
        pendingQueueArtists = [];
        progress.hidden = false;
        retryButton.hidden = failedItems.length === 0;
        status.textContent = 'WAV añadidos a la cola de subidas.';
      } catch (error) {
        console.error('Error reintentando añadir WAV a la cola:', error);
        status.textContent = error.message || 'No se pudieron añadir los WAV a la cola de subidas.';
      }
      return;
    }

    await reintentarFallidas();
  }

  async function reintentarFallidas() {
    if (conversionActive || destroyed || failedItems.length === 0) return;

    const retryItems = failedItems;
    failedItems = [];
    retryButton.hidden = true;
    conversionActive = true;
    const controller = new AbortController();
    importerController = controller;
    playlistButton.disabled = true;
    playlistInput.disabled = true;
    stopButton.hidden = false;
    stopButton.disabled = false;

    try {
      const result = await convertirPlaylist(
        retryItems,
        ({ processed, total, completed, failed, active, retryAttempt, retryInSeconds, conversionStatus, error, current }) => {
          if (destroyed) return;
          if (retryAttempt) {
            status.textContent =
              `yttowav está temporalmente saturado. Reintento ${retryAttempt}/${CONFIG.convertCreateAttempts} en ${retryInSeconds} s. ` +
              (error || '');
            return;
          }
          if (conversionStatus) {
            status.textContent =
              `«${current || 'Canción'}»: ${conversionStatusLabel(conversionStatus)}. ` +
              `${processed} de ${total} terminadas; ${active} en curso.`;
            return;
          }
          status.textContent =
            `Reintentando: ${processed} de ${total} terminadas; ${active} en curso. ` +
            `Correctas: ${completed}. Errores: ${failed}.` +
            (current ? ` Última: ${current}` : '');
        },
        controller.signal
      );
      stopButton.hidden = true;

      failedItems = result.errors.map(({ item }) => item).filter(Boolean);
      const album = failedAlbum;
      let queueError = '';
      if (result.files.length > 0) {
        try {
          await ctx.addUploads(result.files, { album, trackArtists: result.trackArtists });
          result.completedIds.forEach((videoId) => {
            completedVideos.add(videoId);
            saveImportRecord(videoId, { state: 'queued' });
          });
          pendingQueueFiles = [];
          pendingQueueIds = [];
          pendingQueueAlbum = null;
          pendingQueueArtists = [];
          progress.hidden = false;
        } catch (error) {
          console.error('Error añadiendo WAV reintentados a la cola:', error);
          pendingQueueFiles = result.files;
          pendingQueueIds = result.completedIds;
          pendingQueueAlbum = album;
          pendingQueueArtists = result.trackArtists;
          queueError = error.message || 'Los WAV se descargaron, pero no se pudieron añadir a la cola de subidas.';
        }
      }

      if (failedItems.length === 0) failedAlbum = null;
      retryButton.hidden = failedItems.length === 0 && pendingQueueFiles.length === 0;
      const conversionError = result.errors[0]?.error?.message;
      status.textContent = controller.signal.aborted
        ? `Seguimiento detenido. ${result.files.length} WAV listos para añadir; ` +
          `${failedItems.length} canciones se podrán reanudar después. La conversión externa puede continuar.`
        : `Reintento terminado: ${result.files.length} WAV preparados para subir; ` +
          `${failedItems.length} canciones siguen con error.` +
          (conversionError ? ` Primer error: ${conversionError}` : '') +
          (queueError ? ` ${queueError}` : '');
    } finally {
      conversionActive = false;
      if (importerController === controller) importerController = null;
      stopButton.hidden = true;
      stopButton.disabled = false;
      if (!destroyed) {
        playlistButton.disabled = false;
        playlistInput.disabled = false;
      }
    }
  }

  // ------------------------------------------------
  // RESUMEN DE LA COLA ORIGINAL DE SUBIDAS
  // ------------------------------------------------

  const paint = (items) => {
    if (
      destroyed ||
      conversionActive ||
      items.length === 0 ||
      progress.hidden
    ) {
      return;
    }

    status.textContent = summaryText(items);
  };

  const unsubscribe =
    ctx.uploads?.subscribe(paint) ?? (() => {});

  // ------------------------------------------------
  // INTERFAZ
  // ------------------------------------------------

  const node = el(
    'div',
    {
      class: 'upload-panel',
      'data-testid': 'homeostasia-panel'
    },

    el(
      'div',
      { class: 'homeostasia-card' },
      el('div', { class: 'homeostasia-card-head' },
        el('span', { class: 'homeostasia-card-icon' }, icon('note', { size: 24 })),
        el('div', {},
          el('h3', { class: 'homeostasia-card-title' }, 'Tu música, desde YouTube'),
          el('p', { class: 'homeostasia-card-description' }, 'Pega un vídeo o una playlist. Prepararemos las canciones para añadirlas a la biblioteca.'))),
      el('div', { class: 'homeostasia-form' }, playlistInput, playlistButton)
    ),

    retryButton,
    stopButton,
    status,
    progress
  );

  return {
    node,

    cleanup: () => {
      destroyed = true;
      importerController?.abort();
      unsubscribe();
    }
  };
}
