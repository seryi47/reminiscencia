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
 * Crea el reproductor. Opciones: audio (elemento), isAvailable(track) (sin conexión, solo lo guardado),
 * onChange(state), onNotice(text), volume, shuffle, repeat (estado inicial) y env.
 */
export function createPlayer(options = {}) {
  const {
    audio,
    isAvailable = () => true,
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

  function applyVolume() {
    try {
      audio.volume = muted ? 0 : volume;
    } catch {
      // Navegadores que no dejan fijar el volumen (iOS): manda el del sistema.
    }
  }

  function setSource(track) {
    errored = false;
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
    try {
      audio.pause();
    } catch {
      // Sin elemento que pausar.
    }
    updateMediaSession();
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
    const item = current();
    position = 0;
    duration = item?.track.durationS ?? 0;
    setSource(item ? item.track : null);
    setNotice(skipped ? NOTICES.unavailable : null);
    if (autoplay && item) startPlayback();
    updateMediaSession();
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
      upcoming: pos >= 0 ? seq.slice(pos + 1).map((next) => ({ key: next.key, track: { ...next.track }, fromQueue: next.fromQueue })) : [],
    };
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
    const found = scan(first, 1, true);
    if (!found) {
      pos = first;
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
    notify();
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
    notify();
  });
  listen('loadedmetadata', onMetadata);
  listen('durationchange', onMetadata);
  listen('ended', handleEnded);
  listen('error', handleError);
  listen('pause', handleElementPause);
  listen('play', handleElementPlay);
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
    seekTo,
    setShuffle,
    setRepeat,
    setVolume,
    toggleMute,
    getState,
    destroy,
  };
}
