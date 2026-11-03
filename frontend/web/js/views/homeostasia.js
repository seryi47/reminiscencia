
import { PUBLIC_AUDIO_ACCEPT } from '../cuidador/subida-publica.js';

import { summaryText } from '../cuidador/subida-estado.js';
import { ZIP_ACCEPT } from '../cuidador/subida-zip.js';
import { el, openDialog, uid } from '../ui/dom.js';
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
  jobTimeout: 600000
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
  } catch (error) {
    console.warn('Homeostasia: no se pudo guardar el estado de YouTube.', error);
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
  return data.items
    .filter((item) => item && typeof item.url === 'string' && item.url)
    .map((item) => ({
      url: item.url,
      title: typeof item.title === 'string' && item.title ? item.title : 'audio'
    }))
    .filter((item) => {
      const videoId = getVideoId(item.url);
      if (!videoId || seen.has(videoId)) return false;
      seen.add(videoId);
      return true;
    });
}

// ==================================================
// CREAR CONVERSIÓN EN YTTOWAV
// ==================================================

async function crearJob(url, title, signal, deadline, onRetry) {
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
            Accept: '*/*'
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

  return jobId;
}

// ==================================================
// CONSULTAR ESTADO Y DESCARGAR WAV
// ==================================================

async function esperarYDescargar(jobId, signal, deadline) {
  let consecutiveStatusErrors = 0;

  while (Date.now() < deadline) {
    let data;
    try {
      data = await fetchJson(
        `${CONVERTER_ENDPOINTS.status}?jobId=${encodeURIComponent(jobId)}`,
        { headers: { Accept: 'application/json' } },
        signal
      );
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      if (error.status >= 400 && error.status < 500 && error.status !== 408 && error.status !== 429) {
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

    if (status === 'error') {
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

async function convertirCancion(item, index, total, signal, onRetry) {
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
    const deadline = Date.now() + CONFIG.jobTimeout;
    const cached = await readCachedWav(videoId);
    const blob = cached?.blob || await (async () => {
      const jobId = await crearJob(item.url, item.title, signal, deadline, onRetry);
      return esperarYDescargar(jobId, signal, deadline);
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
    saveImportRecord(videoId, { title: item.title, filename, state: 'converted' });

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

async function convertirPlaylist(items, onProgress, signal) {
  const files = [];
  const completedIds = [];
  const errors = [];

  let processed = 0;
  let started = 0;

  const total = items.length;

  for (
    let i = 0;
    i < items.length;
    i += CONFIG.batchSize
  ) {
    const batch = items.slice(
      i,
      i + CONFIG.batchSize
    );

    // Ejecutar un máximo de cuatro conversiones simultáneas.
    await Promise.all(
      batch.map(async (item, position) => {
        started++;
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
          })
        );
        processed++;

        if (result.success) {
          files.push(result.file);
          completedIds.push(result.videoId);
        } else if (!result.skipped) {
          errors.push(result);
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
  }

  return {
    files,
    completedIds,
    errors,
    total,
    processed
  };
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
  let pendingQueueFiles = [];
  let pendingQueueIds = [];

  // ------------------------------------------------
  // SELECTOR DE ARCHIVOS
  // ------------------------------------------------

  const input = el('input', {
    id: uid('homeostasia'),
    type: 'file',
    accept: `${PUBLIC_AUDIO_ACCEPT},${ZIP_ACCEPT}`,
    multiple: true,
    hidden: true,
    'data-testid': 'homeostasia-file-input'
  });

  const pick = el('button', {
    type: 'button',
    class: 'button button-primary upload-pick',
    'data-testid': 'homeostasia-pick',
    on: {
      click: () => input.click()
    }
  },
    icon('upload', { size: 20 }),
    'Añadir archivos'
  );

  // ------------------------------------------------
  // IMPORTADOR DE PLAYLIST
  // ------------------------------------------------

  const playlistInput = el('input', {
    type: 'url',
    class: 'input',
    placeholder: 'Pega aquí una playlist o vídeo de YouTube',
    'aria-label': 'Playlist o vídeo de YouTube',
    'data-testid': 'homeostasia-playlist-input'
  });

  const playlistButton = el('button', {
    type: 'button',
    class: 'button button-primary',
    'data-testid': 'homeostasia-playlist',
    on: {
      click: importarPlaylist
    }
  },
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
  // SUBIDA MANUAL DE ARCHIVOS
  // ------------------------------------------------

  input.addEventListener('change', async () => {
    const files = [...input.files];

    input.value = '';

    if (files.length === 0) return;

    try {
      await ctx.addUploads(files);
      status.textContent = files.length === 1
        ? `Añadiendo «${files[0].name}»…`
        : `Añadiendo ${files.length} archivos…`;
      progress.hidden = false;
    } catch (error) {
      console.error('Error añadiendo archivos a la cola de Homeostasia:', error);
      status.textContent = error.message || 'No se pudieron añadir los archivos a la cola de subidas.';
    }
  });

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
    pick.disabled = true;
    playlistInput.disabled = true;

    progress.hidden = true;

    try {
      status.textContent =
        'Leyendo YouTube…';

      const items = await listarPlaylist(playlistUrl, controller.signal);

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

          status.textContent =
            `Conversión: ${processed} de ${total} terminadas; ${active} en curso. ` +
            `Correctas: ${completed}. ` +
            `Errores: ${failed}.` +
            (current ? ` Última: ${current}` : '');
        },
        controller.signal
      );

      // IMPORTANTE:
      // Los WAV pasan por la misma cola de publicación
      // que los archivos seleccionados manualmente.
      failedItems = result.errors.map(({ item }) => item).filter(Boolean);
      let queueError = '';
      if (result.files.length > 0) {
        try {
          await ctx.addUploads(result.files);
          result.completedIds.forEach((videoId) => {
            completedVideos.add(videoId);
            saveImportRecord(videoId, { state: 'queued' });
          });
          pendingQueueFiles = [];
          pendingQueueIds = [];
          progress.hidden = false;
        } catch (error) {
          console.error('Error añadiendo WAV a la cola de Homeostasia:', error);
          pendingQueueFiles = result.files;
          pendingQueueIds = result.completedIds;
          queueError = error.message || 'Los WAV se descargaron, pero no se pudieron añadir a la cola de subidas.';
        }
      }

      retryButton.hidden = failedItems.length === 0 && pendingQueueFiles.length === 0;
      const conversionError = result.errors[0]?.error?.message;
      status.textContent = [
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

      status.textContent =
        error.message ||
        'Error procesando la playlist.';

    } finally {
      conversionActive = false;
      if (importerController === controller) importerController = null;

      if (!destroyed) {
        playlistButton.disabled = false;
        pick.disabled = false;
        playlistInput.disabled = false;
      }
    }
  }

  async function gestionarReintento() {
    if (pendingQueueFiles.length > 0) {
      const files = pendingQueueFiles;
      try {
        await ctx.addUploads(files);
        pendingQueueIds.forEach((videoId) => {
          completedVideos.add(videoId);
          saveImportRecord(videoId, { state: 'queued' });
        });
        pendingQueueFiles = [];
        pendingQueueIds = [];
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
    pick.disabled = true;
    playlistInput.disabled = true;

    try {
      const result = await convertirPlaylist(
        retryItems,
        ({ processed, total, completed, failed, active, retryAttempt, retryInSeconds, error, current }) => {
          if (destroyed) return;
          if (retryAttempt) {
            status.textContent =
              `yttowav está temporalmente saturado. Reintento ${retryAttempt}/${CONFIG.convertCreateAttempts} en ${retryInSeconds} s. ` +
              (error || '');
            return;
          }
          status.textContent =
            `Reintentando: ${processed} de ${total} terminadas; ${active} en curso. ` +
            `Correctas: ${completed}. Errores: ${failed}.` +
            (current ? ` Última: ${current}` : '');
        },
        controller.signal
      );

      failedItems = result.errors.map(({ item }) => item).filter(Boolean);
      let queueError = '';
      if (result.files.length > 0) {
        try {
          await ctx.addUploads(result.files);
          result.completedIds.forEach((videoId) => {
            completedVideos.add(videoId);
            saveImportRecord(videoId, { state: 'queued' });
          });
          pendingQueueFiles = [];
          pendingQueueIds = [];
          progress.hidden = false;
        } catch (error) {
          console.error('Error añadiendo WAV reintentados a la cola:', error);
          pendingQueueFiles = result.files;
          pendingQueueIds = result.completedIds;
          queueError = error.message || 'Los WAV se descargaron, pero no se pudieron añadir a la cola de subidas.';
        }
      }

      retryButton.hidden = failedItems.length === 0 && pendingQueueFiles.length === 0;
      const conversionError = result.errors[0]?.error?.message;
      status.textContent =
        `Reintento terminado: ${result.files.length} WAV preparados para subir; ` +
        `${failedItems.length} canciones siguen con error.` +
        (conversionError ? ` Primer error: ${conversionError}` : '') +
        (queueError ? ` ${queueError}` : '');
    } finally {
      conversionActive = false;
      if (importerController === controller) importerController = null;
      if (!destroyed) {
        playlistButton.disabled = false;
        pick.disabled = false;
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
      { class: 'homeostasia-options' },
      el(
        'section',
        { class: 'homeostasia-option' },
        el('div', { class: 'homeostasia-option-head' },
          el('span', { class: 'homeostasia-option-icon' }, icon('upload', { size: 22 })),
          el('h3', { class: 'homeostasia-option-title' }, 'Añadir archivos')),
        el('div', { class: 'upload-row' }, input, pick)
      ),
      el(
        'section',
        { class: 'homeostasia-option homeostasia-playlist' },
        el('div', { class: 'homeostasia-option-head' },
          el('span', { class: 'homeostasia-option-icon' }, icon('note', { size: 22 })),
          el('h3', { class: 'homeostasia-option-title' }, 'Desde YouTube')),
        el('div', { class: 'upload-row' }, playlistInput, playlistButton)
      )
    ),

    retryButton,
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
