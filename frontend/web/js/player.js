// Reproductor de Reminiscencia: cola, aleatorio, repetir (no, todo, una), volumen y Media Session.
// Sin dependencias. No toca el DOM: recibe el elemento de audio y, de forma opcional, los servicios del navegador en
// `env` (navigator, MediaMetadata, temporizadores y azar), así que la lógica se prueba en Node con dobles
// (tests/web-unit/player.test.mjs). Al crearse no suena nada.
//
// La cola es una secuencia de entradas { key, track, baseIndex, fromQueue }: las canciones del contexto (carpeta, lista,
// «Me gusta», búsqueda…) en su orden o barajadas, y entre ellas las que se añaden con «Añadir a la cola», que suenan
// justo después de la actual, en el orden en que se añadieron, y salen de la cola al dejarlas atrás.

export const REPEAT_MODES = Object.freeze(['off', 'all', 'one']);
export const PREVIOUS_RESTART_SECONDS = 3;
export const ERROR_SKIP_MS = 3000;
/** Si una canción que llega por la red se queda esperando datos (eventos waiting o stalled) y no avanza en este tiempo,
 *  se vuelve a pedir una vez desde el mismo punto; si tampoco avanza, se trata como un error (aviso y siguiente). */
export const STALL_TIMEOUT_MS = 15_000;
export const NOTICES = Object.freeze({
  unavailable: 'Algunas canciones no están disponibles sin conexión y se han saltado.',
  noneAvailable: 'No hay canciones disponibles sin conexión.',
  error: 'No se puede reproducir esta canción. Pasamos a la siguiente.',
});

/** Volumen entre 0 y 1. Un valor no numérico vale 1. */
export function clampVolume(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 1;
  return Math.min(1, Math.max(0, number));
}

/** Modo de repetición siguiente: no → todo → una → no. */
export function nextRepeatMode(mode) {
  const at = REPEAT_MODES.indexOf(mode);
  return REPEAT_MODES[(at + 1) % REPEAT_MODES.length];
}

/**
 * Orden aleatorio de 0..length-1 (Fisher-Yates). Con first, esa posición va delante y el resto se baraja.
 * random() devuelve un número en [0, 1).
 */
export function shuffledIndexes(length, first = null, random = Math.random) {
  const rest = [];
  for (let i = 0; i < length; i += 1) if (i !== first) rest.push(i);
  for (let i = rest.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  return Number.isInteger(first) && first >= 0 && first < length ? [first, ...rest] : rest;
}

const isTrackLike = (item) => Boolean(item) && typeof item === 'object' && typeof item.id === 'string' && item.id !== '';

function copyTrack(item) {
  return {
    id: item.id,
    title: item.title ?? '',
    artist: item.artist ?? '',
    audioUrl: item.audioUrl ?? null,
    folderId: item.folderId ?? null,
    cover: typeof item.cover === 'string' && item.cover !== '' ? item.cover : null,
    durationS: Number.isFinite(item.durationS) ? item.durationS : null,
    gainDb: Number.isFinite(item.gainDb) ? item.gainDb : null, // normalización de volumen (ADR-0046)
    local: item.local === true,
  };
}

function resolveRuntime(env) {
  const has = (key) => Object.prototype.hasOwnProperty.call(env, key);
  const g = globalThis;
  return {
    navigator: has('navigator') ? env.navigator : (g.navigator ?? null),
    MediaMetadata: has('MediaMetadata') ? env.MediaMetadata : (g.MediaMetadata ?? null),
    setTimeout: has('setTimeout') ? env.setTimeout : (fn, ms) => g.setTimeout(fn, ms),
    clearTimeout: has('clearTimeout') ? env.clearTimeout : (id) => g.clearTimeout(id),
    random: has('random') ? env.random : Math.random,
  };
}

// ¿Se puede cambiar el volumen del elemento? En iOS la propiedad volume es de solo lectura (siempre 1).
function detectVolumeControl(audio) {
  try {
    const before = audio.volume;
    audio.volume = 0.5;
    const ok = Math.abs(Number(audio.volume) - 0.5) < 0.01;
    audio.volume = before;
    return ok;
  } catch {
    return false;
  }
}

/**
 * Guarda las preferencias del reproductor (volumen, aleatorio y repetir) solo cuando cambian: onChange llega con cada
 * avance del tiempo (unas 4 veces por segundo) y no hace falta escribir en localStorage cada vez. write(prefs) recibe
 * { volume, shuffle, repeat }; initial (un estado del reproductor) es lo que ya está guardado. Devuelve save(state), que
 * dice si ha escrito.
 */
export function createPrefsSaver(write, initial = null) {
  const pick = (state) => ({ volume: state.volume, shuffle: state.shuffle, repeat: state.repeat });
  let last = initial ? JSON.stringify(pick(initial)) : null;
  return function save(state) {
    const prefs = pick(state);
    const key = JSON.stringify(prefs);
    if (key === last) return false;
    last = key;
    write(prefs);
    return true;
  };
}

/**
 * Crea el reproductor. Opciones: audio (elemento), isAvailable(track) (sin conexión, solo lo guardado),
 * isOnDevice(track) (la canción se sirve desde este dispositivo, descargada o subida aquí, y no por la red: un parón no
 * puede ser de la red y el vigilante de parones no la toca), onChange(state), onNotice(text), volume, shuffle, repeat
 * (estado inicial) y env.
 */
export function createPlayer(options = {}) {
  const {
    audio,
    isAvailable = () => true,
    isOnDevice = () => false,
    onChange = () => {},
    onNotice = () => {},
    volume: initialVolume = 1,
    shuffle: initialShuffle = false,
    repeat: initialRepeat = 'off',
    env = {},
  } = options;
  if (!audio || typeof audio.play !== 'function') throw new TypeError('El reproductor necesita el elemento de audio.');

  const runtime = resolveRuntime(env);
  const volumeAdjustable = detectVolumeControl(audio);
  let destroyed = false;
  let base = [];
  let seq = [];
  let pos = -1;
  let keySeq = 0;
  let contextId = null;
  let contextName = '';
  let playing = false;
  let position = 0;
  let duration = 0;
  let volume = clampVolume(initialVolume);
  let muted = false;
  let shuffle = initialShuffle === true;
  let repeat = REPEAT_MODES.includes(initialRepeat) ? initialRepeat : 'off';
  let notice = null;
  let errored = false;
  let sourceLoaded = false;
  let errorTimer = null;
  // Vigilante de parones de red: temporizador, posición al armarlo, si ya se ha reintentado esta fuente y si la fuente
  // se sirve desde el dispositivo (se decide al cargarla, no con cada avance del tiempo).
  let stallTimer = null;
  let stallFrom = 0;
  let stallRetried = false;
  let sourceOnDevice = false;
  let cachedUpcoming = null;
  const cleanups = [];

  const current = () => (pos >= 0 ? seq[pos] ?? null : null);
  const entry = (track, baseIndex, fromQueue = false) => {
    keySeq += 1;
    return { key: `e${keySeq}`, track, baseIndex, fromQueue };
  };

  function safeCall(callback, ...args) {
    try {
      callback(...args);
    } catch (error) {
      console.error('Reproductor: error en un aviso.', error);
    }
  }

  function notify() {
    if (!destroyed) safeCall(onChange, getState());
  }

  function setNotice(text) {
    notice = text;
    if (text) safeCall(onNotice, text);
  }

  function available(item) {
    if (!item || !item.track.audioUrl) return false;
    try {
      return Boolean(isAvailable(item.track));
    } catch {
      return false;
    }
  }

  // Primera entrada disponible desde `from` en una dirección. Con wrap, da la vuelta a la cola.
  function scan(from, direction, wrap) {
    const length = seq.length;
    let at = from;
    let skipped = false;
    for (let steps = 0; steps < length; steps += 1) {
      if (at < 0 || at >= length) {
        if (!wrap) return null;
        at = (at + length) % length;
      }
      if (available(seq[at])) return { index: at, skipped };
      skipped = true;
      at += direction;
    }
    return null;
  }

  function clearErrorTimer() {
    if (errorTimer !== null) {
      runtime.clearTimeout(errorTimer);
      errorTimer = null;
    }
  }

  function clearStallTimer() {
    if (stallTimer !== null) {
      runtime.clearTimeout(stallTimer);
      stallTimer = null;
    }
  }

  function elementTime() {
    const value = Number(audio.currentTime);
    return Number.isFinite(value) ? value : position;
  }

  function onDevice(track) {
    try {
      return Boolean(track && isOnDevice(track));
    } catch {
      return false;
    }
  }

  // La cola que se ve («A continuación») solo cambia con la secuencia o la posición, no con el tiempo.
  function queueChanged() {
    cachedUpcoming = null;
  }

  // Factor de volumen por normalización (ADR-0046): 10^(gainDb/20), recortado a 1 porque audio.volume no sube de 1 (solo se
  // atenúan los temas fuertes; subir los flojos necesitaría un GainNode). Sin gainDb o sin canción, factor 1 (sin cambios).
  function gainFactor() {
    const gainDb = current()?.track?.gainDb;
    if (typeof gainDb !== 'number' || !Number.isFinite(gainDb)) return 1;
    const factor = Math.pow(10, gainDb / 20);
    return factor < 1 ? factor : 1;
  }

  function applyVolume() {
    try {
      audio.volume = muted ? 0 : Math.min(1, volume * gainFactor());
    } catch {
      // Navegadores que no dejan fijar el volumen (iOS): manda el del sistema.
    }
  }

  function setSource(track) {
    errored = false;
    clearStallTimer();
    stallRetried = false;
    sourceOnDevice = onDevice(track);
    sourceLoaded = Boolean(track && track.audioUrl);
    try {
      if (sourceLoaded) audio.src = track.audioUrl;
      else {
        audio.removeAttribute('src');
        audio.load();
      }
    } catch {
      sourceLoaded = false;
    }
    applyVolume(); // la ganancia de normalización depende de la canción actual (ADR-0046)
  }

  // Precarga la portada de las canciones vecinas (ADR-0046): al saltar, el navegador ya la tiene en caché y la imagen
  // aparece al instante en vez de descargarse en ese momento. `seq` está reordenada también en aleatorio, así que pos±1 son
  // las vecinas reales. Es best-effort: si no hay constructor de imagen (pruebas), no hace nada.
  function prefetchCover(entry) {
    const url = entry?.track?.cover;
    const ImageCtor = runtime.Image || (typeof Image === 'function' ? Image : null);
    if (!url || !ImageCtor) return;
    try { const img = new ImageCtor(); img.decoding = 'async'; img.src = url; } catch { /* sin red o sin soporte: da igual */ }
  }

  function prefetchNeighbors() {
    prefetchCover(seq[pos + 1]);
    prefetchCover(seq[pos - 1]);
  }

  function updateMediaSession() {
    const session = runtime.navigator ? runtime.navigator.mediaSession : null;
    if (!session) return;
    const item = current();
    try {
      session.playbackState = item ? (playing ? 'playing' : 'paused') : 'none';
      if (!item) session.metadata = null;
      else if (typeof runtime.MediaMetadata === 'function') {
        const artwork = item.track.cover ? { artwork: [{ src: item.track.cover, sizes: '640x640', type: 'image/jpeg' }] } : {};
        session.metadata = new runtime.MediaMetadata({ title: item.track.title, artist: item.track.artist, album: contextName, ...artwork });
      }
    } catch {
      // Media Session incompleta: la reproducción no depende de ella.
    }
  }

  function stopPlayback() {
    playing = false;
    clearStallTimer();
    try {
      audio.pause();
    } catch {
      // Sin elemento que pausar.
    }
    updateMediaSession();
  }

  // ---- Vigilante de parones ----
  // Con la reproducción pedida, un waiting o stalled arma el temporizador; cualquier avance real del tiempo lo quita.
  // Pausar, cambiar de canción, terminar o fallar también lo quitan (stopPlayback y setSource), así que no se acumula.
  function armStallWatch() {
    if (destroyed || !playing || !sourceLoaded || errored || stallTimer !== null) return;
    stallFrom = elementTime();
    stallTimer = runtime.setTimeout(onStallTimeout, STALL_TIMEOUT_MS);
  }

  function onStallTimeout() {
    stallTimer = null;
    const item = current();
    if (destroyed || !item || !playing || !sourceLoaded || errored) return;
    if (sourceOnDevice) {
      // Descargada o subida aquí: no depende de la red, así que no se recarga ni se salta; solo se anota.
      console.warn('Reproductor: una canción guardada en este dispositivo lleva un rato sin avanzar.');
      return;
    }
    if (stallRetried) {
      handleError();
      return;
    }
    // Primer intento: se vuelve a pedir la misma fuente desde el mismo punto (la conexión colgada se descarta).
    stallRetried = true;
    const at = elementTime();
    sourceOnDevice = onDevice(item.track);
    try {
      audio.load();
    } catch {
      // Sin elemento que recargar: el siguiente plazo lo trata como error.
    }
    if (at > 0) seekElement(at);
    let attempt;
    try {
      attempt = audio.play();
    } catch (error) {
      attempt = Promise.reject(error);
    }
    if (attempt && typeof attempt.catch === 'function') attempt.catch(handlePlayFailure);
    stallFrom = at;
    stallTimer = runtime.setTimeout(onStallTimeout, STALL_TIMEOUT_MS);
  }

  function noteProgress() {
    if (stallTimer === null || audio.seeking) return;
    if (elementTime() === stallFrom) return;
    clearStallTimer();
    stallRetried = false;
  }

  // Un salto pedido (barra de progreso, teclas multimedia) empieza un plazo nuevo desde el punto de destino.
  function handleSeeking() {
    if (stallTimer === null) return;
    clearStallTimer();
    armStallWatch();
  }

  function handlePlayFailure(error) {
    if (destroyed) return;
    const name = error && error.name;
    // AbortError: otra acción interrumpió la carga. NotSupportedError: lo recoge el evento error.
    if (name === 'AbortError' || name === 'NotSupportedError') return;
    if (playing) {
      stopPlayback();
      notify();
    }
  }

  function startPlayback() {
    const item = current();
    if (destroyed || !item || playing) return;
    clearErrorTimer();
    if (errored) setSource(item.track);
    playing = true;
    updateMediaSession();
    notify();
    let attempt;
    try {
      attempt = audio.play();
    } catch (error) {
      attempt = Promise.reject(error);
    }
    if (attempt && typeof attempt.catch === 'function') attempt.catch(handlePlayFailure);
  }

  // Pasa a la entrada `index`. Una entrada añadida a la cola sale de ella al dejarla atrás.
  function select(index, { autoplay = false, skipped = false } = {}) {
    let target = index;
    const leaving = current();
    if (leaving && leaving.fromQueue && target !== pos) {
      seq.splice(pos, 1);
      if (target > pos) target -= 1;
    }
    stopPlayback();
    clearErrorTimer();
    pos = target;
    queueChanged();
    const item = current();
    position = 0;
    duration = item?.track.durationS ?? 0;
    setSource(item ? item.track : null);
    setNotice(skipped ? NOTICES.unavailable : null);
    if (autoplay && item) startPlayback();
    updateMediaSession();
    prefetchNeighbors();
    notify();
  }

  function seekElement(value) {
    try {
      audio.currentTime = value;
    } catch {
      // Sin metadatos todavía: el navegador rechaza el salto.
    }
  }

  function seekTo(seconds) {
    if (destroyed || !current()) return;
    const value = Number(seconds);
    if (!Number.isFinite(value)) return;
    const max = duration > 0 ? duration : Infinity;
    position = Math.min(Math.max(0, value), max);
    seekElement(position);
    notify();
  }

  // Al final de la cola sin repetir: se para y vuelve al principio de la canción actual.
  function stopAtEnd() {
    stopPlayback();
    position = 0;
    seekElement(0);
    notify();
  }

  function advance(autoplay) {
    const found = scan(pos + 1, 1, repeat !== 'off');
    if (!found) {
      stopAtEnd();
      return;
    }
    select(found.index, { autoplay, skipped: found.skipped });
  }

  function handleEnded() {
    if (destroyed || !current() || !sourceLoaded || errored) return;
    if (repeat === 'one') {
      clearStallTimer();
      position = 0;
      seekElement(0);
      playing = false;
      startPlayback();
      return;
    }
    playing = false;
    advance(true);
  }

  function handleError() {
    if (destroyed || !current() || !sourceLoaded || errored) return;
    const wasPlaying = playing;
    errored = true;
    clearStallTimer();
    stopPlayback();
    setNotice(NOTICES.error);
    if (wasPlaying) {
      errorTimer = runtime.setTimeout(() => {
        errorTimer = null;
        if (!destroyed) advance(true);
      }, ERROR_SKIP_MS);
    }
    notify();
  }

  // Pausa o reproducción que no ha pedido el reproductor (teclas multimedia, interrupciones del sistema).
  function handleElementPause() {
    if (destroyed || !playing || !sourceLoaded || audio.ended || !audio.paused) return;
    stopPlayback();
    notify();
  }

  function handleElementPlay() {
    if (destroyed || playing || !sourceLoaded || audio.paused) return;
    playing = true;
    updateMediaSession();
    notify();
  }

  function onMetadata() {
    if (destroyed || !sourceLoaded) return;
    const value = Number(audio.duration);
    if (Number.isFinite(value) && value > 0) duration = value;
    notify();
  }

  // ---- API pública ----

  function getState() {
    const item = current();
    return {
      track: item ? { ...item.track } : null,
      key: item ? item.key : null,
      contextId,
      contextName,
      playing,
      position: Math.round(position * 10) / 10,
      duration: Math.round(duration * 10) / 10,
      volume,
      muted,
      volumeAdjustable,
      shuffle,
      repeat,
      notice,
      upcoming: upcomingCopy(),
    };
  }

  // Copia de la cola que queda. Se rehace solo cuando cambia (queueChanged): los avisos con cada avance del tiempo
  // reciben la misma copia, sin copiar cientos de canciones cuatro veces por segundo.
  function upcomingCopy() {
    if (cachedUpcoming === null) {
      cachedUpcoming = pos >= 0
        ? seq.slice(pos + 1).map((next) => Object.freeze({ key: next.key, track: Object.freeze({ ...next.track }), fromQueue: next.fromQueue }))
        : [];
      Object.freeze(cachedUpcoming);
    }
    return cachedUpcoming;
  }

  /** Carga un contexto. startAt: índice de la canción en `tracks`; null con aleatorio empieza por una al azar. */
  function load(tracks, startAt = 0, { autoplay = true, contextId: nextContextId = null, contextName: nextContextName = '' } = {}) {
    if (destroyed) return;
    const queued = pos >= 0 ? seq.slice(pos + 1).filter((item) => item.fromQueue) : [];
    stopPlayback();
    clearErrorTimer();
    base = Array.isArray(tracks) ? tracks.filter(isTrackLike).map(copyTrack) : [];
    contextId = nextContextId;
    contextName = String(nextContextName ?? '');
    if (base.length === 0) {
      seq = [];
      pos = -1;
      queueChanged();
      setSource(null);
      setNotice(null);
      notify();
      return;
    }
    let start = Number.isInteger(startAt) ? Math.min(Math.max(0, startAt), base.length - 1) : null;
    if (start === null) start = shuffle ? Math.floor(runtime.random() * base.length) : 0;
    const order = shuffle ? shuffledIndexes(base.length, start, runtime.random) : base.map((_, i) => i);
    seq = order.map((i) => entry(base[i], i));
    const first = shuffle ? 0 : start;
    seq.splice(first + 1, 0, ...queued);
    pos = -1;
    queueChanged();
    const found = scan(first, 1, true);
    if (!found) {
      pos = first;
      queueChanged();
      position = 0;
      duration = seq[first].track.durationS ?? 0;
      setSource(null);
      setNotice(NOTICES.noneAvailable);
      updateMediaSession();
      notify();
      return;
    }
    select(found.index, { autoplay, skipped: found.skipped });
  }

  function play() {
    if (destroyed || playing) return;
    const item = current();
    if (!item) return;
    if (!available(item)) {
      const found = scan(pos, 1, true);
      if (!found) {
        setNotice(NOTICES.noneAvailable);
        notify();
        return;
      }
      select(found.index, { autoplay: true, skipped: true });
      return;
    }
    startPlayback();
  }

  function pause() {
    if (destroyed) return;
    clearErrorTimer();
    if (!playing) return;
    stopPlayback();
    notify();
  }

  function toggle() {
    if (playing) pause();
    else play();
  }

  function next() {
    if (destroyed || !current()) return;
    advance(playing || errorTimer !== null);
  }

  function previous() {
    if (destroyed || !current()) return;
    if (position > PREVIOUS_RESTART_SECONDS) {
      seekTo(0);
      return;
    }
    const found = scan(pos - 1, -1, repeat !== 'off');
    if (!found) {
      seekTo(0);
      return;
    }
    select(found.index, { autoplay: playing, skipped: found.skipped });
  }

  /** Salta a una entrada de la cola (por su key) y la reproduce. */
  function playEntry(key) {
    if (destroyed) return;
    const index = seq.findIndex((item) => item.key === key);
    if (index < 0) return;
    if (!available(seq[index])) {
      setNotice(NOTICES.noneAvailable);
      notify();
      return;
    }
    select(index, { autoplay: true });
  }

  /** Añade una canción a la cola, después de la actual y de las ya añadidas. Sin nada cargado, la carga en pausa. */
  function addToQueue(track) {
    if (destroyed || !isTrackLike(track)) return;
    if (pos < 0) {
      load([track], 0, { autoplay: false, contextId: null, contextName: '' });
      return;
    }
    let at = pos + 1;
    while (at < seq.length && seq[at].fromQueue) at += 1;
    seq.splice(at, 0, entry(copyTrack(track), null, true));
    queueChanged();
    notify();
  }

  /**
   * Sustituye una canción por otra en el contexto y en la cola (por ejemplo, la copia local de una subida por la
   * canción pública). La que está sonando no se corta: el elemento de audio conserva su fuente hasta que se pase a
   * otra canción (o se vuelva a cargar tras un error, ya con la fuente nueva). Devuelve true si estaba.
   */
  function replaceTrack(oldId, track) {
    if (destroyed || typeof oldId !== 'string' || !isTrackLike(track) || track.id === oldId) return false;
    const next = copyTrack(track);
    let changed = false;
    base = base.map((item) => {
      if (item.id !== oldId) return item;
      changed = true;
      return next;
    });
    for (const item of seq) {
      if (item.track.id === oldId) {
        item.track = next;
        changed = true;
      }
    }
    if (changed) {
      queueChanged();
      updateMediaSession();
      notify();
    }
    return changed;
  }

  function setShuffle(on) {
    const value = on === true;
    if (destroyed || value === shuffle) return;
    shuffle = value;
    const item = current();
    if (item) {
      const queued = seq.slice(pos + 1).filter((next) => next.fromQueue);
      if (shuffle) {
        const rest = shuffledIndexes(base.length, item.baseIndex, runtime.random).filter((i) => i !== item.baseIndex);
        seq = [item, ...queued, ...rest.map((i) => entry(base[i], i))];
        pos = 0;
      } else if (item.baseIndex !== null) {
        seq = base.map((track, i) => (i === item.baseIndex ? item : entry(track, i)));
        pos = item.baseIndex;
        seq.splice(pos + 1, 0, ...queued);
      } else {
        seq = [item, ...queued, ...base.map((track, i) => entry(track, i))];
        pos = 0;
      }
      queueChanged();
    }
    notify();
  }

  function setRepeat(mode) {
    if (destroyed || !REPEAT_MODES.includes(mode)) return;
    repeat = mode;
    notify();
  }

  function setVolume(value) {
    if (destroyed) return;
    volume = clampVolume(value);
    muted = volume === 0 ? muted : false;
    applyVolume();
    notify();
  }

  function toggleMute() {
    if (destroyed) return;
    muted = !muted;
    applyVolume();
    notify();
  }

  function installMediaActions() {
    const session = runtime.navigator ? runtime.navigator.mediaSession : null;
    if (!session || typeof session.setActionHandler !== 'function') return;
    const actions = {
      play: () => play(),
      pause: () => pause(),
      previoustrack: () => previous(),
      nexttrack: () => next(),
      seekto: (details) => seekTo(details?.seekTime),
    };
    for (const [action, handler] of Object.entries(actions)) {
      try {
        session.setActionHandler(action, handler);
      } catch {
        // Acción no admitida por este navegador.
      }
    }
    cleanups.push(() => {
      for (const action of Object.keys(actions)) {
        try {
          session.setActionHandler(action, null);
        } catch {
          // Ya no se puede modificar.
        }
      }
    });
  }

  function listen(type, handler) {
    audio.addEventListener(type, handler);
    cleanups.push(() => audio.removeEventListener(type, handler));
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    clearErrorTimer();
    clearStallTimer();
    for (const cleanup of cleanups.splice(0)) cleanup();
    try {
      audio.pause();
    } catch {
      // El elemento ya no admite cambios.
    }
    playing = false;
  }

  // ---- Arranque ----
  applyVolume();
  try {
    audio.pause();
  } catch {
    // Sin elemento que pausar.
  }
  listen('timeupdate', () => {
    if (destroyed || !sourceLoaded) return;
    const value = Number(audio.currentTime);
    if (Number.isFinite(value)) position = value;
    noteProgress();
    notify();
  });
  listen('loadedmetadata', onMetadata);
  listen('durationchange', onMetadata);
  listen('ended', handleEnded);
  listen('error', handleError);
  listen('pause', handleElementPause);
  listen('play', handleElementPlay);
  listen('waiting', armStallWatch);
  listen('stalled', armStallWatch);
  listen('seeking', handleSeeking);
  installMediaActions();

  return {
    load,
    play,
    pause,
    toggle,
    next,
    previous,
    playEntry,
    addToQueue,
    replaceTrack,
    seekTo,
    setShuffle,
    setRepeat,
    setVolume,
    toggleMute,
    getState,
    destroy,
  };
}
