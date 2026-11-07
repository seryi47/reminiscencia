// Descargas para escuchar sin conexión (ADR-0033): un gestor que vive en la app (no en la pantalla), así que la
// descarga sigue al cambiar de página, y que se guarda en localStorage para continuar tras recargar.
// - Varias canciones a la vez, con un límite común a todas las descargas (OFFLINE_CONCURRENCY): el audio lo sirve el
//   Worker, sin el límite de r2.dev (ADR-0031).
// - Lo ya guardado no se vuelve a bajar, y una canción que piden dos descargas a la vez (un álbum y «Todas las
//   canciones») se baja una sola vez.
// - Progreso real y estable por descarga: «3 de 8» (lo guardado de antes cuenta como hecho) y los bytes recibidos.
// - Se puede cancelar: lo que ya se ha guardado se queda; lo que se estaba bajando solo para esa descarga se corta.
// - Una canción que falla se reintenta (OFFLINE_RETRIES) y no detiene a las demás.
// No usa DOM ni la Cache API directamente: listCached y download se inyectan (js/pwa.js en el navegador y
// tests/web-unit/offline-downloads.test.mjs en node).

import { formatBytes, listAudioUrls } from './offline-core.js';

/** Canciones que se bajan a la vez entre todas las descargas. */
export const OFFLINE_CONCURRENCY = 4;
/** Reintentos de una canción que falla (además del primer intento). */
export const OFFLINE_RETRIES = 2;
/** Clave de localStorage con las descargas a medias, para continuarlas al volver a abrir la página. */
export const OFFLINE_JOBS_KEY = 'reminiscencia.descargas';
/** Como mucho, un aviso de progreso de bytes cada este tiempo (los cambios de canción se avisan al momento). */
export const OFFLINE_EMIT_MS = 150;
const STORAGE_VERSION = 1;
const AUDIO_PATH = /^audio\/[A-Za-z0-9_-]+\.opus$/;

/** Texto del progreso: «Descargando 3 de 8 · 2,4 MB» (sin bytes hasta que llega el primero). */
export function downloadStatusText(progress) {
  if (!progress) return '';
  const base = `Descargando ${progress.done} de ${progress.total}`;
  return progress.bytes > 0 ? `${base} · ${formatBytes(progress.bytes)}` : base;
}

/** Aviso al terminar: «Descargada…», «No se han podido descargar 2 de 8 canciones.» o «Se ha cancelado…». */
export function downloadResultText(result) {
  if (!result) return '';
  if (result.cancelled) return 'Se ha cancelado la descarga. Lo ya descargado se queda en este dispositivo.';
  if (result.failed.length === 0) return 'Descargada. Ya se puede escuchar sin conexión.';
  return `No se han podido descargar ${result.failed.length} de ${result.total} canciones. Vuelve a pulsar para reintentarlo.`;
}

/** Lee lo guardado: [{ contextId, urls }] válidos. Nunca lanza. */
export function parseJobs(raw) {
  let data;
  try {
    data = JSON.parse(raw ?? 'null');
  } catch {
    return [];
  }
  if (!data || data.version !== STORAGE_VERSION || !Array.isArray(data.jobs)) return [];
  return data.jobs
    .filter((job) => job && typeof job.contextId === 'string' && job.contextId !== '' && Array.isArray(job.urls))
    .map((job) => ({ contextId: job.contextId, urls: [...new Set(job.urls.filter((url) => typeof url === 'string' && AUDIO_PATH.test(url)))] }))
    .filter((job) => job.urls.length > 0);
}

function abortError() {
  const error = new Error('Descarga cancelada.');
  error.name = 'AbortError';
  return error;
}

/**
 * Crea el gestor. Dependencias:
 * - listCached() → Set (o lista) de rutas 'audio/<id>.opus' ya guardadas
 * - download(url, { signal, onBytes(n) }) → termina cuando la canción está guardada entera (nunca a medias)
 * - storage (localStorage o null), concurrency, retries, setTimer/clearTimer, emitMs
 * - onSaved(url): cada canción guardada (la app la marca como disponible sin releer la caché)
 */
export function createOfflineDownloads(deps = {}) {
  const {
    listCached = async () => new Set(),
    download,
    storage = null,
    concurrency = OFFLINE_CONCURRENCY,
    retries = OFFLINE_RETRIES,
    onSaved = () => {},
    setTimer = (fn, ms) => setTimeout(fn, ms),
    clearTimer = (id) => clearTimeout(id),
    emitMs = OFFLINE_EMIT_MS,
  } = deps;

  const jobs = new Map(); // contextId → job
  const tasks = new Map(); // url → { url, jobs: Set<job>, controller, started, bytes }
  const queue = []; // urls pendientes de empezar, en orden
  const listeners = new Set();
  let active = 0;
  let emitTimer = null;

  function emit() {
    if (emitTimer !== null) {
      clearTimer(emitTimer);
      emitTimer = null;
    }
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch (error) {
        console.error('Reminiscencia: error al pintar una descarga.', error);
      }
    }
  }

  function emitSoon() {
    if (emitTimer !== null) return;
    emitTimer = setTimer(() => {
      emitTimer = null;
      emit();
    }, emitMs);
  }

  function persist() {
    if (!storage) return;
    try {
      // Todas las canciones de cada descarga: al retomarla, lo ya guardado cuenta como hecho («6 de 8», no «0 de 2»).
      const pending = [...jobs.values()].map((job) => ({ contextId: job.contextId, urls: job.urls }));
      if (pending.length === 0) storage.removeItem(OFFLINE_JOBS_KEY);
      else storage.setItem(OFFLINE_JOBS_KEY, JSON.stringify({ version: STORAGE_VERSION, jobs: pending }));
    } catch {
      // Almacenamiento bloqueado: la descarga sigue durante esta visita.
    }
  }

  function finish(job, cancelled = false) {
    if (!jobs.has(job.contextId) || jobs.get(job.contextId) !== job) return;
    jobs.delete(job.contextId);
    persist();
    job.resolve({
      contextId: job.contextId,
      total: job.urls.length,
      added: job.added,
      skipped: job.skipped,
      failed: [...job.failed].map(([url, error]) => ({ url, error })),
      cancelled,
    });
  }

  function settled(job) {
    return job.ready && job.urls.every((url) => job.done.has(url) || job.failed.has(url));
  }

  function pump() {
    while (active < concurrency && queue.length > 0) {
      const task = tasks.get(queue.shift());
      if (!task || task.started || task.jobs.size === 0) continue;
      run(task);
    }
  }

  async function run(task) {
    active += 1;
    task.started = true;
    let error = null;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      if (task.controller.signal.aborted) break;
      task.bytes = 0;
      try {
        await download(task.url, {
          signal: task.controller.signal,
          onBytes: (count) => {
            if (!(count > 0) || task.controller.signal.aborted) return;
            task.bytes += count;
            for (const job of task.jobs) job.bytes += count;
            emitSoon();
          },
        });
        error = null;
        break;
      } catch (failure) {
        // Los bytes de un intento fallido no cuentan.
        for (const job of task.jobs) job.bytes = Math.max(0, job.bytes - task.bytes);
        error = failure instanceof Error ? failure : new Error(String(failure));
        if (task.controller.signal.aborted || error.name === 'AbortError') break;
      }
    }
    active -= 1;
    tasks.delete(task.url);
    const aborted = task.controller.signal.aborted;
    if (!error && !aborted) {
      try {
        onSaved(task.url);
      } catch {
        // Solo es un aviso.
      }
    }
    for (const job of task.jobs) {
      if (aborted) continue;
      if (error) job.failed.set(task.url, error.message || 'No se ha podido descargar.');
      else {
        job.done.add(task.url);
        job.added += 1;
      }
    }
    for (const job of [...task.jobs]) if (settled(job)) finish(job);
    pump();
    emit();
  }

  function enqueue(url, job) {
    let task = tasks.get(url);
    if (!task) {
      task = { url, jobs: new Set(), controller: new AbortController(), started: false, bytes: 0 };
      tasks.set(url, task);
      queue.push(url);
    }
    task.jobs.add(job);
  }

  function startUrls(contextId, urls) {
    const existing = jobs.get(contextId);
    if (existing) return existing.promise;
    const job = {
      contextId,
      urls: [...new Set(urls)],
      done: new Set(),
      failed: new Map(),
      bytes: 0,
      added: 0,
      skipped: 0,
      ready: false,
    };
    job.promise = new Promise((resolve) => { job.resolve = resolve; });
    jobs.set(contextId, job);
    persist();
    emit();
    (async () => {
      let cached = new Set();
      try {
        cached = new Set(await listCached());
      } catch {
        // Sin poder leer la caché se baja todo: guardar dos veces la misma canción no rompe nada.
      }
      if (jobs.get(contextId) !== job) return;
      for (const url of job.urls) {
        if (cached.has(url)) {
          job.done.add(url);
          job.skipped += 1;
        } else {
          enqueue(url, job);
        }
      }
      job.ready = true;
      if (settled(job)) finish(job);
      pump();
      emit();
    })();
    return job.promise;
  }

  return {
    /** Empieza (o devuelve la que ya hay) la descarga de una colección. Resuelve al terminar o cancelarse con
     *  { contextId, total, added, skipped, failed: [{ url, error }], cancelled }. */
    start(contextId, songs) {
      return startUrls(String(contextId), listAudioUrls(songs));
    },
    /** Corta una descarga. Lo guardado se queda; lo que se bajaba solo para ella se aborta. */
    cancel(contextId) {
      const job = jobs.get(String(contextId));
      if (!job) return false;
      for (const url of job.urls) {
        const task = tasks.get(url);
        if (!task) continue;
        task.jobs.delete(job);
        if (task.jobs.size > 0) continue;
        task.controller.abort();
        if (!task.started) tasks.delete(url);
      }
      finish(job, true);
      pump();
      emit();
      return true;
    },
    /** { done, total, failed, bytes } de una descarga en marcha, o null. */
    progress(contextId) {
      const job = jobs.get(String(contextId));
      if (!job) return null;
      return { done: job.done.size, total: job.urls.length, failed: job.failed.size, bytes: job.bytes };
    },
    isRunning: (contextId) => jobs.has(String(contextId)),
    /** Ids de las descargas en marcha. */
    running: () => [...jobs.keys()],
    /** Retoma lo que quedó a medias al cerrar la página (salvo lo que ya está en marcha). Devuelve las promesas, por id. */
    resume() {
      let raw = null;
      try {
        raw = storage?.getItem(OFFLINE_JOBS_KEY) ?? null;
      } catch {
        raw = null;
      }
      const resumed = new Map();
      for (const job of parseJobs(raw)) {
        if (!jobs.has(job.contextId)) resumed.set(job.contextId, startUrls(job.contextId, job.urls));
      }
      return resumed;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    /** Canciones bajándose ahora mismo (pruebas). */
    activeCount: () => active,
  };
}
