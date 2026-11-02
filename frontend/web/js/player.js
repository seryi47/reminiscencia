// Reproductor de Reminiscencia (contrato 2.2) con las reglas de reproducción de DESIGN 8.1, 8.2 y 7.4.
// Sin dependencias ni framework. No toca el DOM: recibe el elemento de audio y, de forma opcional,
// los servicios del navegador en `env` (reloj, temporizadores, AudioContext, navigator, document),
// de modo que la lógica se puede probar en Node con dobles de prueba.
//
// Decisiones que el contrato deja abiertas:
// - Sesión: `sessionStarted` se reinicia al cambiar de modo, al cambiar de perfil y tras 3 horas sin
//   reproducción (DESIGN 8.2). La primera reproducción de la sesión (play() en modo paciente) aplica el
//   arranque al 60 % y el fundido de entrada de 1,5 s. load() no reinicia la sesión: cambiar de lista
//   dentro de la sesión no baja el volumen.
// - Web Audio: el grafo (AudioContext, MediaElementAudioSourceNode, GainNode) se crea en el primer gesto
//   del usuario (pointerdown, keydown o touchend en el documento). Antes, o sin Web Audio, el volumen va
//   en la propiedad volume del elemento (volumeMode "element").
// - Temporizador de apagado: cuenta solo el tiempo de reproducción, con precisión de 1 s.
// - Eventos de estudio: "start" (pista nueva), "resume" (reanudar la misma pista), "pause", "track-end"
//   (completed true al terminar; false si se salta con next, previous, jumpTo o load) y "error". Un error
//   cierra la pista: después no se emite track-end.
// - El reproductor emite eventos en cualquier modo; quien llama decide si los registra (vista previa).
// - Un límite de volumen que no es múltiplo de 10 se redondea hacia abajo (55 % es 50 %) para no superarlo.

export const MODES = Object.freeze(['paciente', 'cuidador']);
export const VOLUME_STEP_MAX = 10;
export const ARRIVAL_STEP = 6;
export const FADE_IN_MS = 1500;
export const SEEK_STEP_SECONDS = 5;
export const skipDelayAfterError = 6;
export const PREVIOUS_RESTART_SECONDS = 3;
export const sleepWarningAt = 30;
export const extendSleepMinutes = 15;
export const SESSION_IDLE_MS = 3 * 60 * 60 * 1000;
export const NOTICES = Object.freeze({
  unavailable: 'No disponible sin internet',
  noneAvailable: 'No hay canciones disponibles sin internet.',
  error: 'No se puede reproducir esta canción. Pasamos a la siguiente.',
  endOfList: 'Fin de la lista',
});

const FADE_TICK_MS = 50;
const SLEEP_TICK_MS = 1000;
const MINUTE_MS = 60 * 1000;
// Un elemento de audio solo admite un MediaElementAudioSourceNode: el grafo se guarda por elemento.
const audioGraphs = new WeakMap();

/** Paso de volumen entero de 0 a 10 (cada paso es un 10 %). */
export function clampVolumeStep(step) {
  const value = Math.round(Number(step));
  if (!Number.isFinite(value)) return 0;
  return Math.min(VOLUME_STEP_MAX, Math.max(0, value));
}

/** Ganancia de 0 a 1 correspondiente a un paso de volumen. */
export function volumeFromStep(step) {
  return clampVolumeStep(step) / VOLUME_STEP_MAX;
}

/** Paso de volumen que nunca supera el límite del perfil (límite también en pasos). */
export function applyVolumeLimit(step, limitStep) {
  const limit = Math.round(Number(limitStep));
  const cap = Number.isFinite(limit) ? Math.min(VOLUME_STEP_MAX, Math.max(0, limit)) : VOLUME_STEP_MAX;
  return Math.min(clampVolumeStep(step), cap);
}

/**
 * Límite del perfil en pasos (de 5 a 10) a partir de un porcentaje de 50 a 100.
 * El porcentaje se redondea hacia abajo: 55 % equivale a 50 %. Devuelve null si no es un número válido.
 */
export function limitStepFromPercent(percent) {
  if (percent === null || percent === undefined || percent === '' || typeof percent === 'boolean') {
    return null;
  }
  const value = Number(percent);
  if (!Number.isFinite(value)) return null;
  return Math.floor(Math.min(100, Math.max(50, value)) / 10);
}

/** Ganancia durante el fundido de entrada, `elapsedMs` después de empezar (lineal, 1,5 s). */
export function fadeInGain(elapsedMs, targetGain = 1) {
  const elapsed = Number(elapsedMs);
  if (!Number.isFinite(elapsed) || elapsed <= 0) return 0;
  return targetGain * Math.min(1, elapsed / FADE_IN_MS);
}

/** Índice de la siguiente pista, o null si la cola termina y no se repite. */
export function nextIndex(index, length, repeatList) {
  if (!Number.isInteger(length) || length < 1) return null;
  const current = Number.isInteger(index) ? Math.max(-1, index) : -1;
  if (current + 1 < length) return current + 1;
  return repeatList ? 0 : null;
}

/** Índice de la pista anterior, o null si no hay anterior (primera pista sin repetir). */
export function previousIndex(index, length, repeatList) {
  if (!Number.isInteger(length) || length < 1) return null;
  if (!Number.isInteger(index) || index < 0 || index >= length) return null;
  if (index > 0) return index - 1;
  return repeatList && length > 1 ? length - 1 : null;
}

/** En cuidador, «Anterior» vuelve al inicio si la pista lleva más de 3 s. En paciente, siempre salta. */
export function shouldRestartOnPrevious(positionSeconds, mode) {
  return mode === 'cuidador' && Number(positionSeconds) > PREVIOUS_RESTART_SECONDS;
}

/** El aviso del temporizador se emite cuando quedan 30 s o menos. */
export function shouldWarnSleep(remainingMs) {
  return remainingMs > 0 && remainingMs <= sleepWarningAt * 1000;
}

/** Minutos que muestra el temporizador (redondeados hacia arriba). */
export function sleepMinutesLeft(remainingMs) {
  return remainingMs > 0 ? Math.ceil(remainingMs / MINUTE_MS) : 0;
}

/** Una sesión sin reproducción durante 3 horas o más termina (DESIGN 8.2). */
export function isSessionIdle(lastPlaybackAt, nowMs) {
  return Number.isFinite(lastPlaybackAt) && nowMs - lastPlaybackAt >= SESSION_IDLE_MS;
}

function roundSeconds(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 10) / 10 : 0;
}

function clampPosition(value, max = Infinity) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const upper = Number.isFinite(max) && max > 0 ? max : Infinity;
  return Math.min(Math.max(0, n), upper);
}

function clampIndex(value, length) {
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n)) return 0;
  return Math.min(Math.max(0, n), Math.max(0, length - 1));
}

function finiteDuration(value) {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function isTrackLike(item) {
  return Boolean(item) && typeof item === 'object' && item.id !== undefined && item.id !== null;
}

function copyTrack(item) {
  return {
    id: item.id,
    title: item.title ?? '',
    artist: item.artist ?? '',
    year: item.year ?? null,
    coverUrl: item.coverUrl ?? null,
    audioUrl: item.audioUrl ?? null,
    folderId: item.folderId ?? null,
  };
}

function profileKey(profile) {
  if (!profile) return null;
  return profile.id ?? '';
}

function resolveRuntime(env) {
  const has = (key) => Object.prototype.hasOwnProperty.call(env, key);
  const g = globalThis;
  return {
    now: has('now') ? env.now : () => Date.now(),
    setTimeout: has('setTimeout') ? env.setTimeout : (fn, ms) => g.setTimeout(fn, ms),
    clearTimeout: has('clearTimeout') ? env.clearTimeout : (id) => g.clearTimeout(id),
    setInterval: has('setInterval') ? env.setInterval : (fn, ms) => g.setInterval(fn, ms),
    clearInterval: has('clearInterval') ? env.clearInterval : (id) => g.clearInterval(id),
    AudioContext: has('AudioContext') ? env.AudioContext : (g.AudioContext ?? g.webkitAudioContext ?? null),
    navigator: has('navigator') ? env.navigator : (g.navigator ?? null),
    document: has('document') ? env.document : (g.document ?? null),
    MediaMetadata: has('MediaMetadata') ? env.MediaMetadata : (g.MediaMetadata ?? null),
  };
}

/**
 * Crea el reproductor sobre un elemento de audio. Al crearse no suena nada.
 * Devuelve la API de la sección 2.2 del contrato (load, restoreLast, play, pause, toggle, next, previous,
 * jumpTo, seekBy, seekTo, setVolumeStep, setProfileLimit, setSleepTimer, extendSleepTimer, getState,
 * setProfile, setMode y destroy).
 */
export function createPlayer(options = {}) {
  const {
    audio,
    profile: initialProfile = null,
    mode: initialMode = 'cuidador',
    wakeLockEnabled = true,
    isAvailable = () => true,
    onChange = () => {},
    onStudyEvent = () => {},
    onNotice = () => {},
    onSleepWarning = () => {},
    onSleep = () => {},
    env = {},
  } = options;

  if (!audio || typeof audio.play !== 'function') {
    throw new TypeError('El reproductor necesita el elemento de audio.');
  }

  const runtime = resolveRuntime(env);
  const checkAvailable = typeof isAvailable === 'function' ? isAvailable : () => true;
  const wakeLockAllowed = wakeLockEnabled !== false;

  let destroyed = false;
  let currentProfile = initialProfile ?? null;
  let currentMode = MODES.includes(initialMode) ? initialMode : 'cuidador';
  let queueItems = [];
  let currentIndex = -1;
  let track = null;
  let origin = null;
  let presentation = null;
  let playing = false;
  let position = 0;
  let duration = 0;
  let volumeLimitStep = VOLUME_STEP_MAX;
  let volumeStep = ARRIVAL_STEP;
  let notice = null;
  let sleep = null;
  let sessionStarted = false;
  let lastPlaybackAt = null;
  let trackOpen = false;
  let trackPaused = false;
  let errored = false;
  let sourceLoaded = false;
  let pendingSeek = null;
  let trackSeq = 0;
  let graph = null;
  let graphFailed = false;
  let wakeSentinel = null;
  let fadeTimer = null;
  let errorTimer = null;
  let sleepTimer = null;
  const cleanups = [];

  function safeCall(callback, ...args) {
    if (typeof callback !== 'function') return;
    try {
      callback(...args);
    } catch (error) {
      // Un fallo en un aviso del llamador no debe detener la reproducción.
      console.error('El reproductor: error en un aviso.', error);
    }
  }

  function notify() {
    if (!destroyed) safeCall(onChange, getState());
  }

  function setNotice(text) {
    if (notice === text) return;
    notice = text;
    safeCall(onNotice, text);
  }

  function resolvePresentation() {
    if (typeof presentation === 'function') {
      try {
        return presentation(track) ?? null;
      } catch {
        return null;
      }
    }
    return presentation ?? null;
  }

  function emitStudy(type, extra = {}) {
    safeCall(onStudyEvent, {
      type,
      at: new Date(runtime.now()).toISOString(),
      songId: track ? track.id : null,
      position: roundSeconds(position),
      origin,
      presentation: resolvePresentation(),
      ...extra,
    });
  }

  function repeatEnabled() {
    return currentProfile ? currentProfile.repeatList !== false : true;
  }

  // Una pista sin fuente de audio no se puede reproducir: se trata como no disponible.
  function isAvailableNow(item) {
    if (!item || !item.audioUrl) return false;
    try {
      return Boolean(checkAvailable(item));
    } catch {
      return false;
    }
  }

  // Recorre la cola desde `from` en una sola dirección y devuelve la primera pista disponible.
  function scanAvailable(from, direction) {
    let at = from;
    let skipped = false;
    for (let steps = 0; steps < queueItems.length && at !== null; steps += 1) {
      if (isAvailableNow(queueItems[at])) return { index: at, skipped };
      skipped = true;
      at = direction > 0
        ? nextIndex(at, queueItems.length, repeatEnabled())
        : previousIndex(at, queueItems.length, repeatEnabled());
    }
    return null;
  }

  function listen(type, handler) {
    audio.addEventListener(type, handler);
    cleanups.push(() => audio.removeEventListener(type, handler));
  }

  // ---- Volumen ----

  function setElementVolume(value) {
    try {
      audio.volume = value;
    } catch {
      // Algunos navegadores (iOS) no permiten fijar el volumen del elemento: ahí manda Web Audio.
    }
  }

  function setGraphGain(value) {
    try {
      const now = graph.context.currentTime;
      graph.gain.gain.cancelScheduledValues(now);
      graph.gain.gain.setValueAtTime(value, now);
    } catch {
      // El contexto no admite el cambio en este momento: se mantiene el valor anterior.
    }
  }

  function cancelFade() {
    if (fadeTimer !== null) {
      runtime.clearInterval(fadeTimer);
      fadeTimer = null;
    }
  }

  function applyVolumeNow() {
    const target = volumeFromStep(volumeStep);
    cancelFade();
    if (graph) {
      setGraphGain(target);
    } else {
      setElementVolume(target);
    }
  }

  function startFadeIn(target) {
    cancelFade();
    if (graph) {
      try {
        const now = graph.context.currentTime;
        const param = graph.gain.gain;
        param.cancelScheduledValues(now);
        param.setValueAtTime(0, now);
        param.linearRampToValueAtTime(target, now + FADE_IN_MS / 1000);
      } catch {
        setGraphGain(target);
      }
      return;
    }
    setElementVolume(0);
    const startedAt = runtime.now();
    fadeTimer = runtime.setInterval(() => {
      const elapsed = runtime.now() - startedAt;
      if (elapsed >= FADE_IN_MS) {
        cancelFade();
        setElementVolume(target);
      } else {
        setElementVolume(fadeInGain(elapsed, target));
      }
    }, FADE_TICK_MS);
  }

  // Se llama en el primer gesto del usuario: un contexto creado antes queda suspendido y silencia el audio.
  function unlockAudioGraph() {
    if (graph || graphFailed || destroyed || !runtime.AudioContext) return;
    try {
      let entry = audioGraphs.get(audio);
      if (!entry) {
        const context = new runtime.AudioContext();
        entry = { context, source: context.createMediaElementSource(audio) };
        audioGraphs.set(audio, entry);
      }
      const gainNode = entry.context.createGain();
      gainNode.gain.value = volumeFromStep(volumeStep);
      entry.source.disconnect();
      entry.source.connect(gainNode);
      gainNode.connect(entry.context.destination);
      graph = { context: entry.context, source: entry.source, gain: gainNode };
      setElementVolume(1);
      if (entry.context.state === 'suspended' && typeof entry.context.resume === 'function') {
        const pending = entry.context.resume();
        if (pending && typeof pending.catch === 'function') pending.catch(() => {});
      }
    } catch {
      graphFailed = true;
    }
  }

  function applyProfileLimit(item) {
    const step = limitStepFromPercent(item.volumeLimit);
    if (step === null) return;
    volumeLimitStep = step;
    if (volumeStep > volumeLimitStep) {
      volumeStep = volumeLimitStep;
      applyVolumeNow();
    }
  }

  // ---- Sesión ----

  // Solo en modo paciente. Se llama desde play() (no desde el paso automático de pista).
  function startSessionIfNeeded() {
    if (currentMode !== 'paciente') return;
    if (lastPlaybackAt !== null && isSessionIdle(lastPlaybackAt, runtime.now())) {
      sessionStarted = false;
    }
    if (sessionStarted) return;
    sessionStarted = true;
    volumeStep = Math.min(ARRIVAL_STEP, volumeLimitStep);
    startFadeIn(volumeFromStep(volumeStep));
  }

  // ---- Fuente, pistas y registro ----

  function clearErrorTimer() {
    if (errorTimer !== null) {
      runtime.clearTimeout(errorTimer);
      errorTimer = null;
    }
  }

  function seekElement(value) {
    try {
      audio.currentTime = value;
    } catch {
      // Sin metadatos el navegador puede rechazar el salto: se aplica al cargar.
      pendingSeek = value;
    }
  }

  function setSource(item) {
    errored = false;
    pendingSeek = null;
    if (!item || !item.audioUrl) {
      clearSource();
      return;
    }
    sourceLoaded = true;
    try {
      audio.src = item.audioUrl;
    } catch {
      sourceLoaded = false;
    }
  }

  function clearSource() {
    sourceLoaded = false;
    pendingSeek = null;
    try {
      audio.removeAttribute('src');
      audio.load();
    } catch {
      // Sin fuente que liberar.
    }
  }

  function closeCurrentTrack() {
    if (!trackOpen) return;
    trackOpen = false;
    trackPaused = false;
    emitStudy('track-end', { completed: false });
  }

  function updateMediaSession() {
    const session = runtime.navigator ? runtime.navigator.mediaSession : null;
    if (!session) return;
    try {
      session.playbackState = track ? (playing ? 'playing' : 'paused') : 'none';
      if (!track) {
        session.metadata = null;
      } else if (typeof runtime.MediaMetadata === 'function') {
        session.metadata = new runtime.MediaMetadata({
          title: track.title || '',
          artist: track.artist || '',
          artwork: track.coverUrl ? [{ src: track.coverUrl, sizes: '512x512' }] : [],
        });
      }
    } catch {
      // Navegadores sin Media Session completa: la reproducción no depende de esto.
    }
  }

  function installMediaActions() {
    const session = runtime.navigator ? runtime.navigator.mediaSession : null;
    if (!session || typeof session.setActionHandler !== 'function') return;
    const actions = {
      play: () => play(),
      pause: () => pause(),
      previoustrack: () => previous(),
      nexttrack: () => next(),
    };
    for (const [action, handler] of Object.entries(actions)) {
      try {
        session.setActionHandler(action, handler);
      } catch {
        // Acción no soportada por este navegador.
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
      try {
        session.metadata = null;
        session.playbackState = 'none';
      } catch {
        // Ya no se puede modificar.
      }
    });
  }

  // ---- Pantalla ----

  function shouldHoldWakeLock() {
    return currentMode === 'paciente' && wakeLockAllowed && playing;
  }

  function releaseSentinel(sentinel) {
    if (!sentinel || typeof sentinel.release !== 'function') return;
    try {
      Promise.resolve(sentinel.release()).catch(() => {});
    } catch {
      // Ya liberado.
    }
  }

  function releaseWakeLock() {
    const sentinel = wakeSentinel;
    wakeSentinel = null;
    releaseSentinel(sentinel);
  }

  function requestWakeLock() {
    if (destroyed || wakeSentinel || !shouldHoldWakeLock()) return;
    const locks = runtime.navigator ? runtime.navigator.wakeLock : null;
    if (!locks || typeof locks.request !== 'function') return;
    let request;
    try {
      request = locks.request('screen');
    } catch {
      return;
    }
    Promise.resolve(request)
      .then((sentinel) => {
        if (destroyed || wakeSentinel || !shouldHoldWakeLock()) {
          releaseSentinel(sentinel);
          return;
        }
        wakeSentinel = sentinel;
        if (sentinel && typeof sentinel.addEventListener === 'function') {
          sentinel.addEventListener('release', () => {
            if (wakeSentinel === sentinel) wakeSentinel = null;
          });
        }
      })
      .catch(() => {
        // Sin permiso o sin soporte: la reproducción sigue sin bloquear la pantalla.
      });
  }

  // ---- Estado de reproducción ----

  // Detiene el audio sin emitir eventos de estudio. Lo usan pause(), load() y los cambios de pista.
  function stopPlayback() {
    const wasPlaying = playing;
    playing = false;
    if (wasPlaying) lastPlaybackAt = runtime.now();
    applyVolumeNow();
    try {
      audio.pause();
    } catch {
      // El elemento ya no admite cambios.
    }
    releaseWakeLock();
    updateMediaSession();
  }

  function handlePlayFailure(error) {
    if (destroyed) return;
    const name = error && error.name;
    // AbortError: lo interrumpió otra acción. NotSupportedError: lo recoge el evento de error del elemento.
    if (name === 'AbortError' || name === 'NotSupportedError') return;
    // NotAllowedError (el navegador pide un gesto) u otro: se refleja en el estado.
    if (playing) {
      stopPlayback();
      notify();
    }
  }

  // Empieza a sonar la pista actual. No aplica arranque: eso lo hace startSessionIfNeeded en play().
  function startPlayback() {
    if (destroyed || !track || playing) return;
    clearErrorTimer();
    if (errored) setSource(track);
    const resumed = trackOpen && trackPaused;
    playing = true;
    trackPaused = false;
    setNotice(null);
    if (!trackOpen) {
      trackOpen = true;
      emitStudy('start');
    } else if (resumed) {
      emitStudy('resume');
    }
    requestWakeLock();
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

  // Cambia a la pista `targetIndex` (ya disponible). Cierra la anterior con track-end y la deja en pausa
  // salvo que `autoplay` sea true.
  function select(targetIndex, { autoplay = false, skipped = false } = {}) {
    closeCurrentTrack();
    stopPlayback();
    clearErrorTimer();
    trackSeq += 1;
    currentIndex = targetIndex;
    track = queueItems[targetIndex] ?? null;
    position = 0;
    duration = 0;
    trackOpen = false;
    trackPaused = false;
    setSource(track);
    if (autoplay && track) startPlayback();
    if (skipped) setNotice(NOTICES.unavailable);
    updateMediaSession();
    notify();
  }

  // Fin de la pista por sí misma: track-end completed true y paso a la siguiente, o fin de la lista.
  function handleEnded() {
    if (destroyed || !track || !sourceLoaded || errored) return;
    const wasPlaying = playing;
    position = duration > 0 ? duration : position;
    if (trackOpen) {
      trackOpen = false;
      trackPaused = false;
      emitStudy('track-end', { completed: true });
    }
    stopPlayback();
    const from = wasPlaying ? nextIndex(currentIndex, queueItems.length, repeatEnabled()) : null;
    const found = from === null ? null : scanAvailable(from, 1);
    if (found) {
      select(found.index, { autoplay: true, skipped: found.skipped });
      return;
    }
    if (wasPlaying) setNotice(NOTICES.endOfList);
    notify();
  }

  function handleError() {
    if (destroyed || !track || !sourceLoaded || errored) return;
    const wasPlaying = playing;
    errored = true;
    trackOpen = false;
    trackPaused = false;
    emitStudy('error');
    stopPlayback();
    setNotice(NOTICES.error);
    if (wasPlaying) scheduleErrorSkip(trackSeq);
    notify();
  }

  // Con reproducción continua, la siguiente pista suena a los 6 s. El aviso se queda hasta que empiece.
  function scheduleErrorSkip(seq) {
    clearErrorTimer();
    errorTimer = runtime.setTimeout(() => {
      errorTimer = null;
      if (destroyed || seq !== trackSeq) return;
      const from = nextIndex(currentIndex, queueItems.length, repeatEnabled());
      const found = from === null ? null : scanAvailable(from, 1);
      if (found) {
        select(found.index, { autoplay: true, skipped: found.skipped });
      } else {
        notify();
      }
    }, skipDelayAfterError * 1000);
  }

  // Pausa que no ha pedido el reproductor (por ejemplo, una interrupción del sistema).
  function handleElementPause() {
    if (destroyed || !playing || !sourceLoaded) return;
    if (audio.ended || !audio.paused) return;
    trackPaused = true;
    emitStudy('pause');
    stopPlayback();
    notify();
  }

  function onMetadata() {
    if (destroyed || !sourceLoaded) return;
    duration = finiteDuration(Number(audio.duration));
    if (pendingSeek !== null) {
      const target = clampPosition(pendingSeek, duration);
      pendingSeek = null;
      seekElement(target);
      position = target;
    }
    notify();
  }

  // ---- Temporizador de apagado ----

  function startSleepTick() {
    if (sleepTimer === null) sleepTimer = runtime.setInterval(tickSleep, SLEEP_TICK_MS);
  }

  function stopSleepTick() {
    if (sleepTimer !== null) {
      runtime.clearInterval(sleepTimer);
      sleepTimer = null;
    }
  }

  function tickSleep() {
    if (destroyed || !sleep) {
      stopSleepTick();
      return;
    }
    const now = runtime.now();
    if (playing) sleep.remainingMs -= Math.max(0, now - sleep.lastTickAt);
    sleep.lastTickAt = now;
    if (sleep.remainingMs <= 0) {
      sleep = null;
      stopSleepTick();
      if (playing) pause();
      safeCall(onSleep);
      notify();
      return;
    }
    if (!sleep.warned && shouldWarnSleep(sleep.remainingMs)) {
      sleep.warned = true;
      safeCall(onSleepWarning, Math.ceil(sleep.remainingMs / 1000));
    }
    const minutes = sleepMinutesLeft(sleep.remainingMs);
    if (minutes !== sleep.lastMinutes) {
      sleep.lastMinutes = minutes;
      notify();
    }
  }

  // ---- Atajos y entorno ----

  function attachEnvironmentListeners() {
    const doc = runtime.document;
    if (!doc || typeof doc.addEventListener !== 'function') return;
    const gestureTypes = ['pointerdown', 'keydown', 'touchend'];
    const gestureOptions = { capture: true, passive: true };
    const detachGesture = () => {
      for (const type of gestureTypes) doc.removeEventListener(type, onFirstGesture, gestureOptions);
    };
    const onFirstGesture = () => {
      detachGesture();
      unlockAudioGraph();
    };
    for (const type of gestureTypes) doc.addEventListener(type, onFirstGesture, gestureOptions);
    cleanups.push(detachGesture);

    const onVisibility = () => {
      if (doc.visibilityState === 'visible') requestWakeLock();
    };
    doc.addEventListener('visibilitychange', onVisibility);
    cleanups.push(() => doc.removeEventListener('visibilitychange', onVisibility));
  }

  // ---- API pública ----

  function getState() {
    return {
      track: track ? { ...track } : null,
      index: currentIndex,
      queueLength: queueItems.length,
      playing,
      position: roundSeconds(position),
      duration: roundSeconds(duration),
      volumeStep,
      volumeLimitStep,
      notice,
      sleepMinutesLeft: sleep ? sleepMinutesLeft(sleep.remainingMs) : null,
      volumeMode: graph ? 'gain' : 'element',
    };
  }

  function load(items, startAt = 0, nextOrigin = null, nextPresentation = null) {
    if (destroyed) return;
    closeCurrentTrack();
    stopPlayback();
    clearErrorTimer();
    queueItems = Array.isArray(items) ? items.filter(isTrackLike).map(copyTrack) : [];
    origin = nextOrigin ?? null;
    presentation = nextPresentation ?? null;
    trackSeq += 1;
    setNotice(null);
    if (queueItems.length === 0) {
      currentIndex = -1;
      track = null;
      position = 0;
      duration = 0;
      trackOpen = false;
      trackPaused = false;
      clearSource();
      updateMediaSession();
      notify();
      return;
    }
    const first = clampIndex(startAt, queueItems.length);
    const found = scanAvailable(first, 1) || scanAvailable(first, -1);
    if (!found) {
      currentIndex = first;
      track = queueItems[first];
      position = 0;
      duration = 0;
      trackOpen = false;
      trackPaused = false;
      clearSource();
      setNotice(NOTICES.noneAvailable);
      updateMediaSession();
      notify();
      return;
    }
    select(found.index, { autoplay: false, skipped: found.skipped });
  }

  function restoreLast(item, startAt = 0) {
    if (destroyed || !isTrackLike(item)) return;
    closeCurrentTrack();
    stopPlayback();
    clearErrorTimer();
    const existing = queueItems.findIndex((entry) => entry.id === item.id);
    if (existing >= 0) {
      currentIndex = existing;
    } else {
      queueItems = [copyTrack(item)];
      currentIndex = 0;
      origin = 'continua';
    }
    track = queueItems[currentIndex];
    trackSeq += 1;
    trackOpen = false;
    trackPaused = false;
    duration = 0;
    position = clampPosition(startAt);
    if (isAvailableNow(track)) {
      setSource(track);
      seekElement(position);
      setNotice(null);
    } else {
      clearSource();
      setNotice(NOTICES.unavailable);
    }
    updateMediaSession();
    notify();
  }

  function play() {
    if (destroyed || !track || playing) return;
    clearErrorTimer();
    let skipped = false;
    if (!isAvailableNow(track)) {
      const found = scanAvailable(currentIndex, 1) || scanAvailable(currentIndex, -1);
      if (!found) {
        setNotice(NOTICES.noneAvailable);
        notify();
        return;
      }
      select(found.index, { autoplay: false, skipped: true });
      skipped = true;
    }
    startSessionIfNeeded();
    startPlayback();
    if (skipped) setNotice(NOTICES.unavailable);
  }

  function pause() {
    if (destroyed) return;
    clearErrorTimer();
    if (!playing) return;
    trackPaused = true;
    emitStudy('pause');
    stopPlayback();
    notify();
  }

  function toggle() {
    if (playing) pause();
    else play();
  }

  function next() {
    if (destroyed || !track) return;
    const wasPlaying = playing;
    const from = nextIndex(currentIndex, queueItems.length, repeatEnabled());
    const found = from === null ? null : scanAvailable(from, 1);
    if (!found) {
      closeCurrentTrack();
      stopPlayback();
      clearErrorTimer();
      setNotice(NOTICES.endOfList);
      notify();
      return;
    }
    select(found.index, { autoplay: wasPlaying, skipped: found.skipped });
  }

  function previous() {
    if (destroyed || !track) return;
    if (shouldRestartOnPrevious(position, currentMode)) {
      seekTo(0);
      return;
    }
    const from = previousIndex(currentIndex, queueItems.length, repeatEnabled());
    const found = from === null ? null : scanAvailable(from, -1);
    if (!found) {
      seekTo(0);
      return;
    }
    select(found.index, { autoplay: playing, skipped: found.skipped });
  }

  function jumpTo(itemIndex) {
    if (destroyed || !Number.isInteger(itemIndex) || itemIndex < 0 || itemIndex >= queueItems.length) return;
    const wasPlaying = playing;
    const found = scanAvailable(itemIndex, 1) || scanAvailable(itemIndex, -1);
    if (!found) {
      setNotice(NOTICES.noneAvailable);
      notify();
      return;
    }
    select(found.index, { autoplay: wasPlaying, skipped: found.skipped });
  }

  function seekTo(seconds) {
    if (destroyed || !track) return;
    const value = Number(seconds);
    if (!Number.isFinite(value)) return;
    position = clampPosition(value, duration);
    seekElement(position);
    notify();
  }

  function seekBy(seconds) {
    if (destroyed || !track) return;
    seekTo(position + Number(seconds));
  }

  function setVolumeStep(step) {
    if (destroyed) return;
    const value = Number(step);
    if (!Number.isFinite(value)) return;
    volumeStep = applyVolumeLimit(value, volumeLimitStep);
    applyVolumeNow();
    notify();
  }

  function setProfileLimit(percent) {
    if (destroyed) return;
    const step = limitStepFromPercent(percent);
    if (step === null) return;
    volumeLimitStep = step;
    if (volumeStep > volumeLimitStep) {
      volumeStep = volumeLimitStep;
      applyVolumeNow();
    }
    notify();
  }

  function setSleepTimer(minutes) {
    if (destroyed) return;
    const value = minutes === null ? 0 : Number(minutes);
    if (!(value > 0)) {
      sleep = null;
      stopSleepTick();
      notify();
      return;
    }
    sleep = {
      remainingMs: value * MINUTE_MS,
      warned: false,
      lastTickAt: runtime.now(),
      lastMinutes: null,
    };
    startSleepTick();
    notify();
  }

  // Suma minutos al temporizador. Si no hay temporizador activo, lo inicia con esos minutos.
  function extendSleepTimer(minutes) {
    if (destroyed) return;
    const value = Number(minutes);
    if (!(value > 0)) return;
    const extraMs = value * MINUTE_MS;
    if (sleep) {
      sleep.remainingMs += extraMs;
      sleep.warned = false;
    } else {
      sleep = { remainingMs: extraMs, warned: false, lastTickAt: runtime.now(), lastMinutes: null };
    }
    startSleepTick();
    notify();
  }

  // El límite guardado del perfil se aplica al cambiar de perfil o cuando cambia ese valor guardado.
  // Si no, un límite fijado con setProfileLimit se pisaría al repetir la misma llamada.
  function setProfile(nextProfile) {
    if (destroyed) return;
    const previousLimit = currentProfile ? currentProfile.volumeLimit : undefined;
    const changed = profileKey(currentProfile) !== profileKey(nextProfile ?? null);
    currentProfile = nextProfile ?? null;
    if (changed) sessionStarted = false;
    if (currentProfile && (changed || currentProfile.volumeLimit !== previousLimit)) {
      applyProfileLimit(currentProfile);
    }
    notify();
  }

  function setMode(nextMode) {
    if (destroyed || !MODES.includes(nextMode) || nextMode === currentMode) return;
    currentMode = nextMode;
    // Cambiar de modo cierra la sesión de escucha (DESIGN 8.2), pero no detiene la reproducción (DESIGN 8.1).
    sessionStarted = false;
    if (currentMode === 'paciente') requestWakeLock();
    else releaseWakeLock();
    notify();
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    clearErrorTimer();
    stopSleepTick();
    cancelFade();
    sleep = null;
    releaseWakeLock();
    for (const cleanup of cleanups.splice(0)) {
      try {
        cleanup();
      } catch {
        // El listener ya no existe.
      }
    }
    try {
      audio.pause();
    } catch {
      // El elemento ya no admite cambios.
    }
    playing = false;
    if (graph) {
      try {
        graph.source.disconnect();
        graph.gain.disconnect();
      } catch {
        // Nodos ya desconectados.
      }
      graph = null;
    }
  }

  // ---- Arranque ----

  if (currentProfile) applyProfileLimit(currentProfile);
  volumeStep = Math.min(ARRIVAL_STEP, volumeLimitStep);
  setElementVolume(volumeFromStep(volumeStep));
  try {
    audio.pause();
  } catch {
    // Sin elemento que pausar.
  }

  listen('timeupdate', () => {
    if (destroyed || !sourceLoaded) return;
    const current = Number(audio.currentTime);
    if (Number.isFinite(current)) position = current;
    notify();
  });
  listen('loadedmetadata', onMetadata);
  listen('durationchange', onMetadata);
  listen('ended', handleEnded);
  listen('error', handleError);
  listen('pause', handleElementPause);

  installMediaActions();
  attachEnvironmentListeners();

  return {
    load,
    restoreLast,
    play,
    pause,
    toggle,
    next,
    previous,
    jumpTo,
    seekBy,
    seekTo,
    setVolumeStep,
    setProfileLimit,
    setSleepTimer,
    extendSleepTimer,
    getState,
    setProfile,
    setMode,
    destroy,
  };
}
