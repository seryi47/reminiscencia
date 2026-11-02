// Pruebas del reproductor (frontend/web/js/player.js): funciones puras y reglas de DESIGN 8.1, 8.2 y 7.4.
// No hay DOM: el elemento de audio, el reloj, los servicios del navegador y el AudioContext son dobles
// de prueba que simulan solo lo que el reproductor usa. Las pistas son ficticias.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ARRIVAL_STEP,
  FADE_IN_MS,
  NOTICES,
  PREVIOUS_RESTART_SECONDS,
  SESSION_IDLE_MS,
  VOLUME_STEP_MAX,
  applyVolumeLimit,
  clampVolumeStep,
  createPlayer,
  extendSleepMinutes,
  fadeInGain,
  isSessionIdle,
  limitStepFromPercent,
  nextIndex,
  previousIndex,
  shouldRestartOnPrevious,
  shouldWarnSleep,
  skipDelayAfterError,
  sleepMinutesLeft,
  sleepWarningAt,
  volumeFromStep,
} from '../../frontend/web/js/player.js';

const TRACK_A = {
  id: 'cancion-a',
  title: 'Canción ficticia A',
  artist: 'Artista ficticio A',
  year: 1960,
  coverUrl: 'covers/a.jpg',
  audioUrl: 'audio/a.mp3',
  folderId: 'carpeta-1',
};
const TRACK_B = {
  id: 'cancion-b',
  title: 'Canción ficticia B',
  artist: 'Artista ficticio B',
  year: 1961,
  coverUrl: 'covers/b.jpg',
  audioUrl: 'audio/b.mp3',
  folderId: 'carpeta-1',
};
const TRACK_C = {
  id: 'cancion-c',
  title: 'Canción ficticia C',
  artist: 'Artista ficticio C',
  year: 1962,
  coverUrl: 'covers/c.jpg',
  audioUrl: 'audio/c.mp3',
  folderId: 'carpeta-2',
};

function profile(overrides = {}) {
  return {
    id: 'perfil-prueba',
    alias: 'Persona de prueba',
    repeatList: true,
    seekOnTap: false,
    resumeOnOpen: false,
    volumeLimit: 100,
    ...overrides,
  };
}

// Reloj con temporizadores controlados: nada corre en tiempo real.
function createClock() {
  let time = 1_700_000_000_000;
  let nextId = 1;
  const timers = new Map();
  return {
    now: () => time,
    setTimeout(fn, ms) {
      const id = nextId++;
      timers.set(id, { at: time + ms, fn, every: null });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    setInterval(fn, ms) {
      const id = nextId++;
      timers.set(id, { at: time + ms, fn, every: ms });
      return id;
    },
    clearInterval(id) {
      timers.delete(id);
    },
    pending: () => timers.size,
    advance(ms) {
      const end = time + ms;
      for (;;) {
        let dueId = null;
        let due = null;
        for (const [id, timer] of timers) {
          if (timer.at <= end && (due === null || timer.at < due.at)) {
            dueId = id;
            due = timer;
          }
        }
        if (due === null) break;
        time = due.at;
        if (due.every) due.at += due.every;
        else timers.delete(dueId);
        due.fn();
      }
      time = end;
    },
  };
}

// Doble del elemento de audio: solo lo que usa el reproductor.
class FakeAudio {
  constructor() {
    this.listeners = new Map();
    this.currentTime = 0;
    this.duration = NaN;
    this.paused = true;
    this.ended = false;
    this.volume = 1;
    this.currentSrc = '';
    this.loads = [];
    this.playCalls = 0;
    this.pauseCalls = 0;
  }

  get src() {
    return this.currentSrc;
  }

  set src(value) {
    this.currentSrc = value;
    this.loads.push(value);
    this.currentTime = 0;
    this.duration = NaN;
    this.ended = false;
    this.paused = true;
  }

  play() {
    this.playCalls += 1;
    this.paused = false;
    return Promise.resolve();
  }

  pause() {
    this.pauseCalls += 1;
    this.paused = true;
  }

  load() {
    this.paused = true;
  }

  removeAttribute(name) {
    if (name === 'src') this.currentSrc = '';
  }

  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(handler);
  }

  removeEventListener(type, handler) {
    this.listeners.get(type)?.delete(handler);
  }

  emit(type) {
    for (const handler of [...(this.listeners.get(type) ?? [])]) handler({ type });
  }
}

class FakeSentinel {
  constructor() {
    this.released = false;
    this.releaseListeners = [];
  }

  addEventListener(type, handler) {
    if (type === 'release') this.releaseListeners.push(handler);
  }

  // Liberación por el sistema (por ejemplo, al ocultar la pestaña).
  systemRelease() {
    for (const handler of this.releaseListeners) handler();
  }

  release() {
    this.released = true;
    this.systemRelease();
    return Promise.resolve();
  }
}

function createFakeNavigator() {
  return {
    mediaSession: {
      playbackState: 'none',
      metadata: null,
      handlers: {},
      setActionHandler(action, handler) {
        this.handlers[action] = handler;
      },
    },
    wakeLock: {
      requests: 0,
      sentinels: [],
      request() {
        this.requests += 1;
        const sentinel = new FakeSentinel();
        this.sentinels.push(sentinel);
        return Promise.resolve(sentinel);
      },
    },
  };
}

class FakeMediaMetadata {
  constructor(init) {
    this.title = init.title;
    this.artist = init.artist;
    this.artwork = init.artwork;
  }
}

class FakeDocument {
  constructor() {
    this.visibilityState = 'visible';
    this.listeners = new Map();
  }

  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(handler);
  }

  removeEventListener(type, handler) {
    this.listeners.get(type)?.delete(handler);
  }

  dispatch(type) {
    for (const handler of [...(this.listeners.get(type) ?? [])]) handler({ type });
  }

  count(type) {
    return this.listeners.get(type)?.size ?? 0;
  }
}

class FakeParam {
  constructor() {
    this.value = 1;
    this.calls = [];
  }

  setValueAtTime(value, time) {
    this.calls.push(['set', value, time]);
    this.value = value;
  }

  linearRampToValueAtTime(value, time) {
    this.calls.push(['ramp', value, time]);
  }

  cancelScheduledValues(time) {
    this.calls.push(['cancel', time]);
  }
}

class FakeGainNode {
  constructor() {
    this.gain = new FakeParam();
    this.connections = [];
  }

  connect(target) {
    this.connections.push(target);
  }

  disconnect() {
    this.connections = [];
  }
}

class FakeSourceNode {
  constructor(element) {
    this.element = element;
    this.connections = [];
  }

  connect(target) {
    this.connections.push(target);
  }

  disconnect() {
    this.connections = [];
  }
}

class FakeAudioContext {
  static instances = [];

  constructor() {
    this.currentTime = 0;
    this.state = 'suspended';
    this.destination = { name: 'destino' };
    this.gains = [];
    this.sources = [];
    FakeAudioContext.instances.push(this);
  }

  createMediaElementSource(element) {
    const source = new FakeSourceNode(element);
    this.sources.push(source);
    return source;
  }

  createGain() {
    const gain = new FakeGainNode();
    this.gains.push(gain);
    return gain;
  }

  resume() {
    this.state = 'running';
    return Promise.resolve();
  }
}

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

function loadMetadata(audio, seconds) {
  audio.duration = seconds;
  audio.emit('loadedmetadata');
}

function moveTo(audio, seconds) {
  audio.currentTime = seconds;
  audio.emit('timeupdate');
}

// Secuencia real de fin de pista: pausa con ended activo y después el evento ended.
function endTrack(audio) {
  audio.currentTime = audio.duration;
  audio.ended = true;
  audio.paused = true;
  audio.emit('timeupdate');
  audio.emit('pause');
  audio.emit('ended');
}

function harness({
  mode = 'paciente',
  profile: profileOption = profile(),
  isAvailable,
  navigator = createFakeNavigator(),
  document = new FakeDocument(),
  AudioContext = null,
  wakeLockEnabled = true,
} = {}) {
  const clock = createClock();
  const audio = new FakeAudio();
  const studyEvents = [];
  const notices = [];
  const sleepWarnings = [];
  const counters = { sleeps: 0 };
  const player = createPlayer({
    audio,
    profile: profileOption,
    mode,
    wakeLockEnabled,
    isAvailable,
    onStudyEvent: (event) => studyEvents.push(event),
    onNotice: (text) => notices.push(text),
    onSleepWarning: (seconds) => sleepWarnings.push(seconds),
    onSleep: () => {
      counters.sleeps += 1;
    },
    env: {
      now: clock.now,
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
      setInterval: clock.setInterval,
      clearInterval: clock.clearInterval,
      navigator,
      document,
      AudioContext,
      MediaMetadata: FakeMediaMetadata,
    },
  });
  return { player, audio, clock, document, navigator, studyEvents, notices, sleepWarnings, counters };
}

// ---------- Funciones puras ----------

test('nextIndex: avanza, termina sin repetir y vuelve a la primera repitiendo', () => {
  assert.equal(nextIndex(0, 3, false), 1);
  assert.equal(nextIndex(2, 3, false), null);
  assert.equal(nextIndex(2, 3, true), 0);
  assert.equal(nextIndex(-1, 3, false), 0);
  assert.equal(nextIndex(0, 0, true), null);
});

test('previousIndex: pista anterior; en la primera, la última si se repite, o null', () => {
  assert.equal(previousIndex(2, 3, false), 1);
  assert.equal(previousIndex(0, 3, false), null);
  assert.equal(previousIndex(0, 3, true), 2);
  assert.equal(previousIndex(0, 1, true), null);
  assert.equal(previousIndex(-1, 3, true), null);
  assert.equal(previousIndex(3, 3, true), null);
});

test('volumen: pasos de 10 % entre 0 y 10, y el límite del perfil nunca se supera', () => {
  assert.equal(clampVolumeStep(-2), 0);
  assert.equal(clampVolumeStep(15), VOLUME_STEP_MAX);
  assert.equal(clampVolumeStep(NaN), 0);
  assert.equal(volumeFromStep(0), 0);
  assert.equal(volumeFromStep(6), 0.6);
  assert.equal(volumeFromStep(10), 1);
  assert.equal(applyVolumeLimit(8, 6), 6);
  assert.equal(applyVolumeLimit(4, 6), 4);
  assert.equal(applyVolumeLimit(12, 10), 10);
  assert.equal(applyVolumeLimit(-3, 10), 0);
  assert.equal(applyVolumeLimit(7, NaN), 7);
});

test('límite del perfil: de 50 a 100 % en pasos, redondeado hacia abajo', () => {
  assert.equal(limitStepFromPercent(50), 5);
  assert.equal(limitStepFromPercent(55), 5);
  assert.equal(limitStepFromPercent(100), 10);
  assert.equal(limitStepFromPercent(49), 5);
  assert.equal(limitStepFromPercent(120), 10);
  for (const invalid of [null, undefined, '', 'abc', true]) {
    assert.equal(limitStepFromPercent(invalid), null);
  }
});

test('fundido de entrada: lineal durante 1,5 s y después el volumen objetivo', () => {
  assert.equal(FADE_IN_MS, 1500);
  assert.equal(fadeInGain(0, 0.6), 0);
  assert.ok(Math.abs(fadeInGain(750, 0.6) - 0.3) < 1e-9);
  assert.equal(fadeInGain(1500, 0.6), 0.6);
  assert.equal(fadeInGain(9000, 0.6), 0.6);
  assert.equal(fadeInGain(-100, 0.6), 0);
});

test('constantes de DESIGN: arranque 60 %, salto a los 6 s, reinicio a los 3 s, aviso a los 30 s y 15 minutos', () => {
  assert.equal(ARRIVAL_STEP, 6);
  assert.equal(skipDelayAfterError, 6);
  assert.equal(PREVIOUS_RESTART_SECONDS, 3);
  assert.equal(sleepWarningAt, 30);
  assert.equal(extendSleepMinutes, 15);
});

test('textos de aviso exactos de DESIGN 8.1', () => {
  assert.equal(NOTICES.error, 'No se puede reproducir esta canción. Pasamos a la siguiente.');
  assert.equal(NOTICES.unavailable, 'No disponible sin internet');
  assert.equal(NOTICES.endOfList, 'Fin de la lista');
});

test('anterior en cuidador: reinicia solo si la posición supera 3 s; en paciente, nunca', () => {
  assert.equal(shouldRestartOnPrevious(3.5, 'cuidador'), true);
  assert.equal(shouldRestartOnPrevious(3, 'cuidador'), false);
  assert.equal(shouldRestartOnPrevious(0.5, 'cuidador'), false);
  assert.equal(shouldRestartOnPrevious(60, 'paciente'), false);
});

test('temporizador: aviso con 30 s o menos; minutos mostrados hacia arriba', () => {
  assert.equal(shouldWarnSleep(30000), true);
  assert.equal(shouldWarnSleep(30001), false);
  assert.equal(shouldWarnSleep(0), false);
  assert.equal(sleepMinutesLeft(60000), 1);
  assert.equal(sleepMinutesLeft(60001), 2);
  assert.equal(sleepMinutesLeft(0), 0);
});

test('sesión: termina tras 3 horas sin reproducción', () => {
  const t0 = 1_700_000_000_000;
  assert.equal(SESSION_IDLE_MS, 3 * 60 * 60 * 1000);
  assert.equal(isSessionIdle(t0, t0 + SESSION_IDLE_MS), true);
  assert.equal(isSessionIdle(t0, t0 + SESSION_IDLE_MS - 1), false);
});

// ---------- Reproductor (reglas de DESIGN 8.1) ----------

test('al crearse no suena nada, no hay pista y play no hace nada', () => {
  const { player, audio } = harness();
  const state = player.getState();
  assert.equal(audio.playCalls, 0);
  assert.equal(state.playing, false);
  assert.equal(state.track, null);
  assert.equal(state.index, -1);
  assert.equal(state.queueLength, 0);
  player.play();
  assert.equal(audio.playCalls, 0);
});

test('restoreLast deja la última pista en pausa en su posición, sin reproducir', () => {
  const { player, audio } = harness();
  player.load([TRACK_A, TRACK_B], 0, 'lista', 'C1');
  player.restoreLast(TRACK_B, 42.5);
  const state = player.getState();
  assert.equal(state.track.id, TRACK_B.id);
  assert.equal(state.index, 1);
  assert.equal(state.playing, false);
  assert.equal(state.position, 42.5);
  assert.equal(audio.paused, true);
  assert.equal(audio.playCalls, 0);
  assert.equal(audio.currentTime, 42.5);
  assert.equal(audio.src, TRACK_B.audioUrl);
});

test('restoreLast con una pista fuera de la cola la añade con origen continua', () => {
  const { player, studyEvents } = harness();
  player.load([TRACK_A], 0, 'lista', 'C0');
  player.restoreLast(TRACK_C, 12);
  player.play();
  const start = studyEvents.find((event) => event.type === 'start');
  assert.equal(start.songId, TRACK_C.id);
  assert.equal(start.origin, 'continua');
  assert.equal(start.position, 12);
});

test('empezar sesión carga la cola sin iniciar el audio', () => {
  const { player, audio, studyEvents } = harness();
  player.load([TRACK_A, TRACK_B], 1, 'lista', 'C2');
  const state = player.getState();
  assert.equal(state.index, 1);
  assert.equal(state.track.id, TRACK_B.id);
  assert.equal(state.playing, false);
  assert.equal(audio.playCalls, 0);
  assert.deepEqual(studyEvents, []);
});

test('siguiente pasa a la pista siguiente y la reproducción continúa', () => {
  const { player, audio, studyEvents } = harness();
  player.load([TRACK_A, TRACK_B, TRACK_C], 0, 'lista', 'C0');
  player.play();
  player.next();
  const state = player.getState();
  assert.equal(state.index, 1);
  assert.equal(state.playing, true);
  assert.equal(audio.paused, false);
  assert.deepEqual(
    studyEvents.map((event) => [event.type, event.songId]),
    [
      ['start', TRACK_A.id],
      ['track-end', TRACK_A.id],
      ['start', TRACK_B.id],
    ],
  );
  assert.equal(studyEvents[1].completed, false);
});

test('siguiente en pausa cambia de pista sin empezar a sonar', () => {
  const { player, audio } = harness();
  player.load([TRACK_A, TRACK_B], 0, 'lista', 'C0');
  player.next();
  assert.equal(player.getState().index, 1);
  assert.equal(player.getState().playing, false);
  assert.equal(audio.playCalls, 0);
});

test('al terminar la cola con repetición vuelve a la primera pista y sigue sonando', () => {
  const { player, audio, studyEvents } = harness({ profile: profile({ repeatList: true }) });
  player.load([TRACK_A, TRACK_B], 1, 'lista', 'C0');
  player.play();
  loadMetadata(audio, 180);
  endTrack(audio);
  const state = player.getState();
  assert.equal(state.index, 0);
  assert.equal(state.playing, true);
  assert.equal(state.notice, null);
  const trackEnds = studyEvents.filter((event) => event.type === 'track-end');
  assert.equal(trackEnds.length, 1);
  assert.equal(trackEnds[0].songId, TRACK_B.id);
  assert.equal(trackEnds[0].completed, true);
});

test('al terminar la cola sin repetir se detiene con el aviso Fin de la lista', () => {
  const { player, audio, notices } = harness({ profile: profile({ repeatList: false }) });
  player.load([TRACK_A, TRACK_B], 1, 'lista', 'C0');
  player.play();
  loadMetadata(audio, 180);
  const playsBefore = audio.playCalls;
  endTrack(audio);
  const state = player.getState();
  assert.equal(state.playing, false);
  assert.equal(state.index, 1);
  assert.equal(state.notice, NOTICES.endOfList);
  assert.equal(audio.playCalls, playsBefore);
  assert.equal(notices.at(-1), NOTICES.endOfList);
});

test('siguiente en la última pista sin repetir se detiene con Fin de la lista', () => {
  const { player } = harness({ profile: profile({ repeatList: false }) });
  player.load([TRACK_A, TRACK_B], 1, 'lista', 'C0');
  player.play();
  player.next();
  const state = player.getState();
  assert.equal(state.playing, false);
  assert.equal(state.index, 1);
  assert.equal(state.notice, NOTICES.endOfList);
});

test('anterior en paciente va siempre a la pista anterior, aunque lleve tiempo sonando', () => {
  const { player, audio } = harness({ mode: 'paciente' });
  player.load([TRACK_A, TRACK_B, TRACK_C], 2, 'lista', 'C0');
  player.play();
  loadMetadata(audio, 200);
  moveTo(audio, 10);
  player.previous();
  assert.equal(player.getState().index, 1);
  assert.equal(player.getState().playing, true);
});

test('anterior en cuidador: más de 3 s vuelve al inicio; 3 s o menos, a la pista anterior', () => {
  const { player, audio } = harness({ mode: 'cuidador' });
  player.load([TRACK_A, TRACK_B], 1, 'lista', 'C0');
  player.play();
  loadMetadata(audio, 200);
  moveTo(audio, 10);
  player.previous();
  assert.equal(player.getState().index, 1);
  assert.equal(player.getState().position, 0);
  assert.equal(player.getState().playing, true);
  moveTo(audio, 2);
  player.previous();
  assert.equal(player.getState().index, 0);
});

test('anterior en la primera pista sin repetir vuelve al inicio de la actual', () => {
  const { player, audio } = harness({ mode: 'paciente', profile: profile({ repeatList: false }) });
  player.load([TRACK_A, TRACK_B], 0, 'lista', 'C0');
  player.play();
  loadMetadata(audio, 200);
  moveTo(audio, 7);
  player.previous();
  const state = player.getState();
  assert.equal(state.index, 0);
  assert.equal(state.position, 0);
  assert.equal(state.playing, true);
});

test('error de audio: aviso exacto que se mantiene y salta a los 6 s si sonaba', () => {
  const { player, audio, clock, studyEvents } = harness();
  player.load([TRACK_A, TRACK_B, TRACK_C], 0, 'lista', 'C0');
  player.play();
  audio.emit('error');
  let state = player.getState();
  assert.equal(state.playing, false);
  assert.equal(state.notice, NOTICES.error);
  assert.equal(state.index, 0);
  const errorEvent = studyEvents.at(-1);
  assert.equal(errorEvent.type, 'error');
  assert.equal(errorEvent.songId, TRACK_A.id);
  clock.advance(skipDelayAfterError * 1000 - 1);
  assert.equal(player.getState().index, 0);
  assert.equal(player.getState().notice, NOTICES.error);
  clock.advance(1);
  state = player.getState();
  assert.equal(state.index, 1);
  assert.equal(state.playing, true);
  assert.equal(state.notice, null);
});

test('error de audio sin reproducción continua: no salta y el aviso se queda', () => {
  const { player, audio, clock } = harness();
  player.load([TRACK_A, TRACK_B], 0, 'lista', 'C0');
  audio.emit('error');
  clock.advance(60000);
  const state = player.getState();
  assert.equal(state.index, 0);
  assert.equal(state.playing, false);
  assert.equal(state.notice, NOTICES.error);
});

test('pausar durante el aviso de error cancela el salto automático', () => {
  const { player, audio, clock } = harness();
  player.load([TRACK_A, TRACK_B], 0, 'lista', 'C0');
  player.play();
  audio.emit('error');
  player.pause();
  clock.advance(10000);
  assert.equal(player.getState().index, 0);
  assert.equal(player.getState().notice, NOTICES.error);
});

test('pista sin conexión: se omite con el aviso No disponible sin internet', () => {
  const { player } = harness({ isAvailable: (item) => item.id !== TRACK_B.id });
  player.load([TRACK_A, TRACK_B, TRACK_C], 0, 'lista', 'C0');
  player.play();
  player.next();
  const state = player.getState();
  assert.equal(state.index, 2);
  assert.equal(state.playing, true);
  assert.equal(state.notice, NOTICES.unavailable);
});

test('carga en una pista sin conexión: salta a la siguiente disponible', () => {
  const { player } = harness({ isAvailable: (item) => item.id !== TRACK_B.id });
  player.load([TRACK_B, TRACK_A], 0, 'lista', 'C0');
  const state = player.getState();
  assert.equal(state.index, 1);
  assert.equal(state.notice, NOTICES.unavailable);
  assert.equal(state.playing, false);
});

test('pista sin fuente de audio: se trata como no disponible y se omite', () => {
  const { player, audio } = harness();
  player.load([{ id: 'sin-fuente', title: 'Canción ficticia sin fuente' }, TRACK_A], 0, 'lista', 'C0');
  const state = player.getState();
  assert.equal(state.index, 1);
  assert.equal(state.notice, NOTICES.unavailable);
  player.play();
  assert.equal(audio.playCalls, 1);
  assert.equal(audio.src, TRACK_A.audioUrl);
});

test('sin ninguna pista disponible no suena nada y avisa', () => {
  const { player, audio } = harness({ isAvailable: () => false });
  player.load([TRACK_A, TRACK_B], 0, 'lista', 'C0');
  player.play();
  assert.equal(audio.playCalls, 0);
  assert.equal(player.getState().playing, false);
  assert.equal(player.getState().notice, NOTICES.noneAvailable);
});

test('volumen: pasos de 10 % sin superar el límite del perfil', () => {
  const { player } = harness({ mode: 'cuidador' });
  assert.equal(player.getState().volumeStep, ARRIVAL_STEP);
  assert.equal(player.getState().volumeLimitStep, 10);
  player.setVolumeStep(12);
  assert.equal(player.getState().volumeStep, 10);
  player.setVolumeStep(-1);
  assert.equal(player.getState().volumeStep, 0);
  player.setVolumeStep(7);
  player.setProfileLimit(50);
  assert.equal(player.getState().volumeLimitStep, 5);
  assert.equal(player.getState().volumeStep, 5);
  player.setVolumeStep(9);
  assert.equal(player.getState().volumeStep, 5);
  player.setProfileLimit(55);
  assert.equal(player.getState().volumeLimitStep, 5);
  player.setProfileLimit(NaN);
  assert.equal(player.getState().volumeLimitStep, 5);
});

test('volumen: el límite del perfil al crear el reproductor se aplica al arranque', () => {
  const { player } = harness({ profile: profile({ volumeLimit: 50 }) });
  assert.equal(player.getState().volumeLimitStep, 5);
  assert.equal(player.getState().volumeStep, 5);
});

test('sin Web Audio el volumen va en el elemento (volumeMode element)', () => {
  const { player, audio } = harness({ AudioContext: null });
  assert.equal(player.getState().volumeMode, 'element');
  assert.equal(audio.volume, 0.6);
  player.setVolumeStep(5);
  assert.equal(audio.volume, 0.5);
});

test('Web Audio: el grafo se crea en el primer gesto del usuario, no antes', () => {
  FakeAudioContext.instances = [];
  const { player, document, audio } = harness({ AudioContext: FakeAudioContext, mode: 'cuidador' });
  assert.equal(FakeAudioContext.instances.length, 0);
  assert.equal(player.getState().volumeMode, 'element');
  document.dispatch('pointerdown');
  assert.equal(FakeAudioContext.instances.length, 1);
  assert.equal(player.getState().volumeMode, 'gain');
  assert.equal(audio.volume, 1);
  assert.equal(FakeAudioContext.instances[0].state, 'running');
  document.dispatch('keydown');
  assert.equal(FakeAudioContext.instances.length, 1);
});

test('Web Audio: el arranque es un fundido de 1,5 s en el GainNode y el volumen lo fija el GainNode', () => {
  FakeAudioContext.instances = [];
  const { player, document } = harness({ AudioContext: FakeAudioContext, mode: 'paciente' });
  document.dispatch('pointerdown');
  const [context] = FakeAudioContext.instances;
  const gain = context.gains[0].gain;
  assert.equal(gain.value, 0.6);
  player.load([TRACK_A], 0, 'lista', 'C0');
  player.play();
  assert.deepEqual(gain.calls.slice(-3), [
    ['cancel', 0],
    ['set', 0, 0],
    ['ramp', 0.6, 1.5],
  ]);
  player.setVolumeStep(3);
  assert.deepEqual(gain.calls.at(-2), ['cancel', 0]);
  assert.deepEqual(gain.calls.at(-1), ['set', 0.3, 0]);
  assert.equal(gain.value, 0.3);
  assert.equal(player.getState().volumeMode, 'gain');
});

test('arranque: primera reproducción de la sesión al 60 % con fundido de 1,5 s; la pista siguiente no repite el fundido', () => {
  const { player, audio, clock } = harness({ mode: 'paciente' });
  player.load([TRACK_A, TRACK_B], 0, 'lista', 'C0');
  player.play();
  assert.equal(player.getState().volumeStep, 6);
  assert.equal(audio.volume, 0);
  clock.advance(750);
  assert.ok(Math.abs(audio.volume - 0.3) < 1e-9);
  clock.advance(750);
  assert.equal(audio.volume, 0.6);
  player.next();
  assert.equal(audio.volume, 0.6);
  assert.equal(player.getState().playing, true);
});

test('sesión: pausar y reanudar dentro de la misma sesión no vuelve a aplicar el arranque', () => {
  const { player, audio, clock } = harness({ mode: 'paciente' });
  player.load([TRACK_A], 0, 'lista', 'C0');
  player.play();
  clock.advance(1500);
  player.setVolumeStep(3);
  player.pause();
  player.play();
  assert.equal(player.getState().volumeStep, 3);
  assert.ok(Math.abs(audio.volume - 0.3) < 1e-9);
});

test('sesión: cambiar de lista dentro de la sesión no vuelve a aplicar el arranque', () => {
  const { player, audio, clock } = harness({ mode: 'paciente' });
  player.load([TRACK_A], 0, 'lista', 'C0');
  player.play();
  clock.advance(1500);
  player.setVolumeStep(4);
  player.pause();
  player.load([TRACK_B, TRACK_C], 0, 'lista', 'C0');
  player.play();
  assert.equal(player.getState().volumeStep, 4);
  assert.ok(Math.abs(audio.volume - 0.4) < 1e-9);
});

test('sesión nueva tras cambiar de modo: el arranque vuelve a aplicarse', () => {
  const { player, audio, clock } = harness({ mode: 'paciente' });
  player.load([TRACK_A], 0, 'lista', 'C0');
  player.play();
  clock.advance(1500);
  player.setVolumeStep(2);
  player.setMode('cuidador');
  player.setMode('paciente');
  player.pause();
  player.play();
  assert.equal(player.getState().volumeStep, 6);
  assert.equal(audio.volume, 0);
});

test('setProfile con el mismo perfil no pisa un límite fijado con setProfileLimit', () => {
  const { player } = harness({ mode: 'paciente', profile: profile({ volumeLimit: 100 }) });
  player.setProfileLimit(60);
  player.setProfile(profile({ volumeLimit: 100 }));
  assert.equal(player.getState().volumeLimitStep, 6);
  player.setProfile(profile({ id: 'perfil-otro', volumeLimit: 80 }));
  assert.equal(player.getState().volumeLimitStep, 8);
});

test('sesión nueva al cambiar de perfil: el arranque vuelve a aplicarse', () => {
  const { player, clock } = harness({ mode: 'paciente' });
  player.load([TRACK_A], 0, 'lista', 'C0');
  player.play();
  clock.advance(1500);
  player.setVolumeStep(2);
  player.pause();
  player.setProfile(profile({ id: 'perfil-otro' }));
  player.play();
  assert.equal(player.getState().volumeStep, 6);
});

test('sesión: tras 3 horas sin reproducción, la siguiente reproducción abre una sesión nueva', () => {
  const { player, clock } = harness({ mode: 'paciente' });
  player.load([TRACK_A], 0, 'lista', 'C0');
  player.play();
  clock.advance(1500);
  player.setVolumeStep(2);
  player.pause();
  clock.advance(SESSION_IDLE_MS - 1000);
  player.play();
  assert.equal(player.getState().volumeStep, 2);
  player.pause();
  clock.advance(SESSION_IDLE_MS);
  player.play();
  assert.equal(player.getState().volumeStep, 6);
});

test('cuidador: no aplica arranque ni fundido; el volumen se mantiene', () => {
  const { player, audio } = harness({ mode: 'cuidador' });
  player.load([TRACK_A], 0, 'lista', 'C0');
  player.setVolumeStep(8);
  player.play();
  assert.equal(player.getState().volumeStep, 8);
  assert.equal(audio.volume, 0.8);
});

test('arranque limitado por el perfil: con límite 50 % la sesión arranca al 50 %', () => {
  const { player, audio, clock } = harness({ mode: 'paciente' });
  player.setProfileLimit(50);
  player.load([TRACK_A], 0, 'lista', 'C0');
  player.play();
  clock.advance(1500);
  assert.equal(player.getState().volumeStep, 5);
  assert.equal(audio.volume, 0.5);
});

test('temporizador: aviso 30 s antes, pausa al final y avisa; el reproductor no se cierra', () => {
  const { player, audio, clock, sleepWarnings, counters } = harness({ mode: 'paciente' });
  player.load([TRACK_A], 0, 'lista', 'C0');
  player.play();
  player.setSleepTimer(1);
  clock.advance(29000);
  assert.deepEqual(sleepWarnings, []);
  clock.advance(1000);
  assert.deepEqual(sleepWarnings, [30]);
  clock.advance(29000);
  assert.equal(counters.sleeps, 0);
  assert.equal(player.getState().playing, true);
  clock.advance(1000);
  assert.equal(counters.sleeps, 1);
  assert.equal(player.getState().playing, false);
  assert.equal(audio.paused, true);
  assert.equal(player.getState().sleepMinutesLeft, null);
});

test('temporizador: no cuenta mientras está en pausa', () => {
  const { player, clock, sleepWarnings, counters } = harness({ mode: 'paciente' });
  player.load([TRACK_A], 0, 'lista', 'C0');
  player.setSleepTimer(1);
  clock.advance(120000);
  assert.equal(counters.sleeps, 0);
  assert.equal(player.getState().sleepMinutesLeft, 1);
  player.play();
  clock.advance(29000);
  assert.deepEqual(sleepWarnings, []);
  clock.advance(1000);
  assert.deepEqual(sleepWarnings, [30]);
});

test('extendSleepTimer suma 15 minutos, vuelve a avisar y no cierra la aplicación', () => {
  const { player, clock, sleepWarnings, counters } = harness({ mode: 'paciente' });
  player.load([TRACK_A], 0, 'lista', 'C0');
  player.play();
  player.setSleepTimer(1);
  clock.advance(30000);
  assert.deepEqual(sleepWarnings, [30]);
  player.extendSleepTimer(extendSleepMinutes);
  clock.advance(899000);
  assert.deepEqual(sleepWarnings, [30]);
  clock.advance(1000);
  assert.deepEqual(sleepWarnings, [30, 30]);
  assert.equal(counters.sleeps, 0);
  clock.advance(30000);
  assert.equal(counters.sleeps, 1);
  assert.equal(player.getState().playing, false);
});

test('pantalla: se pide el bloqueo al reproducir en paciente y se libera al pausar', async () => {
  const { player, navigator } = harness({ mode: 'paciente' });
  player.load([TRACK_A], 0, 'lista', 'C0');
  player.play();
  assert.equal(navigator.wakeLock.requests, 1);
  await flush();
  const [sentinel] = navigator.wakeLock.sentinels;
  player.pause();
  assert.equal(sentinel.released, true);
  player.play();
  assert.equal(navigator.wakeLock.requests, 2);
});

test('pantalla: no se pide en cuidador ni cuando wakeLockEnabled es false', () => {
  const cuidador = harness({ mode: 'cuidador' });
  cuidador.player.load([TRACK_A], 0, 'lista', 'C0');
  cuidador.player.play();
  assert.equal(cuidador.navigator.wakeLock.requests, 0);
  const sinAjuste = harness({ mode: 'paciente', wakeLockEnabled: false });
  sinAjuste.player.load([TRACK_A], 0, 'lista', 'C0');
  sinAjuste.player.play();
  assert.equal(sinAjuste.navigator.wakeLock.requests, 0);
});

test('pantalla: al volver a la pestaña visible se vuelve a pedir si sigue sonando', async () => {
  const { player, navigator, document } = harness({ mode: 'paciente' });
  player.load([TRACK_A], 0, 'lista', 'C0');
  player.play();
  await flush();
  const [sentinel] = navigator.wakeLock.sentinels;
  sentinel.systemRelease();
  document.visibilityState = 'hidden';
  document.visibilityState = 'visible';
  document.dispatch('visibilitychange');
  assert.equal(navigator.wakeLock.requests, 2);
});

test('Media Session: título, artista y portada; acciones play, pause, anterior y siguiente', () => {
  const { player, navigator } = harness({ mode: 'paciente' });
  player.load([TRACK_A, TRACK_B], 0, 'lista', 'C0');
  player.play();
  const session = navigator.mediaSession;
  assert.equal(session.metadata.title, TRACK_A.title);
  assert.equal(session.metadata.artist, TRACK_A.artist);
  assert.deepEqual(session.metadata.artwork, [{ src: TRACK_A.coverUrl, sizes: '512x512' }]);
  assert.equal(session.playbackState, 'playing');
  for (const action of ['play', 'pause', 'previoustrack', 'nexttrack']) {
    assert.equal(typeof session.handlers[action], 'function');
  }
  session.handlers.nexttrack();
  assert.equal(player.getState().index, 1);
  assert.equal(session.metadata.title, TRACK_B.title);
  session.handlers.pause();
  assert.equal(session.playbackState, 'paused');
});

test('eventos de estudio: start, pause, resume, track-end, origen y presentación en cada evento', () => {
  const { player, audio, studyEvents } = harness({ mode: 'paciente' });
  player.load([TRACK_A, TRACK_B], 0, 'lista', 'C2');
  player.play();
  loadMetadata(audio, 180);
  moveTo(audio, 4);
  player.pause();
  player.play();
  endTrack(audio);
  assert.deepEqual(
    studyEvents.map((event) => event.type),
    ['start', 'pause', 'resume', 'track-end', 'start'],
  );
  const [start, pause, resume, trackEnd, nextStart] = studyEvents;
  assert.equal(start.songId, TRACK_A.id);
  assert.equal(start.position, 0);
  assert.equal(pause.position, 4);
  assert.equal(resume.position, 4);
  assert.equal(trackEnd.completed, true);
  assert.equal(trackEnd.position, 180);
  assert.equal(nextStart.songId, TRACK_B.id);
  for (const event of studyEvents) {
    assert.equal(event.origin, 'lista');
    assert.equal(event.presentation, 'C2');
    assert.equal(new Date(event.at).toISOString(), event.at);
  }
});

test('eventos de estudio: cambiar de lista con una pista en curso la cierra con completed false', () => {
  const { player, studyEvents } = harness({ mode: 'paciente' });
  player.load([TRACK_A], 0, 'lista', 'C0');
  player.play();
  player.load([TRACK_C], 0, 'carpeta', 'C1');
  assert.deepEqual(
    studyEvents.map((event) => [event.type, event.songId, event.completed]),
    [
      ['start', TRACK_A.id, undefined],
      ['track-end', TRACK_A.id, false],
    ],
  );
});

test('presentación por pista: admite una función que recibe la pista', () => {
  const { player, studyEvents } = harness({ mode: 'paciente' });
  player.load([TRACK_A, TRACK_B], 0, 'lista', (item) => (item.id === TRACK_A.id ? 'C1' : 'C0'));
  player.play();
  player.next();
  assert.deepEqual(
    studyEvents.filter((event) => event.type === 'start').map((event) => event.presentation),
    ['C1', 'C0'],
  );
});

test('error de audio registra un evento error y no genera track-end para esa pista', () => {
  const { player, audio, studyEvents } = harness({ mode: 'paciente' });
  player.load([TRACK_A, TRACK_B], 0, 'lista', 'C0');
  player.play();
  audio.emit('error');
  assert.deepEqual(
    studyEvents.map((event) => event.type),
    ['start', 'error'],
  );
});

test('seekBy y seekTo: saltos de 5 s dentro de la duración', () => {
  const { player, audio } = harness({ mode: 'cuidador' });
  player.load([TRACK_A], 0, 'lista', 'C0');
  loadMetadata(audio, 100);
  player.seekBy(5);
  assert.equal(player.getState().position, 5);
  player.seekBy(-10);
  assert.equal(player.getState().position, 0);
  player.seekTo(250);
  assert.equal(player.getState().position, 100);
  assert.equal(audio.currentTime, 100);
});

test('jumpTo salta a la pista indicada y conserva el estado de reproducción', () => {
  const { player } = harness({ mode: 'paciente' });
  player.load([TRACK_A, TRACK_B, TRACK_C], 0, 'lista', 'C0');
  player.play();
  player.jumpTo(2);
  assert.equal(player.getState().index, 2);
  assert.equal(player.getState().playing, true);
  player.pause();
  player.jumpTo(1);
  assert.equal(player.getState().index, 1);
  assert.equal(player.getState().playing, false);
  player.jumpTo(9);
  assert.equal(player.getState().index, 1);
});

test('cambiar de modo no detiene la reproducción', () => {
  const { player } = harness({ mode: 'paciente' });
  player.load([TRACK_A], 0, 'lista', 'C0');
  player.play();
  player.setMode('cuidador');
  assert.equal(player.getState().playing, true);
});

test('destroy detiene el audio, cancela temporizadores y deja de responder', () => {
  const { player, audio, clock, document, counters, studyEvents } = harness({ mode: 'paciente' });
  player.load([TRACK_A, TRACK_B], 0, 'lista', 'C0');
  player.play();
  player.setSleepTimer(15);
  player.destroy();
  assert.equal(audio.paused, true);
  const eventsBefore = studyEvents.length;
  audio.emit('ended');
  audio.emit('error');
  player.play();
  player.next();
  player.setVolumeStep(2);
  assert.equal(studyEvents.length, eventsBefore);
  assert.equal(audio.playCalls, 1);
  clock.advance(60 * 60 * 1000);
  assert.equal(counters.sleeps, 0);
  assert.equal(clock.pending(), 0);
  assert.equal(document.count('pointerdown'), 0);
});

test('un aviso del llamador que lanza un error no detiene la reproducción', (t) => {
  t.mock.method(console, 'error', () => {});
  const clock = createClock();
  const audio = new FakeAudio();
  const player = createPlayer({
    audio,
    profile: profile(),
    mode: 'paciente',
    onStudyEvent: () => {
      throw new Error('fallo ficticio del llamador');
    },
    env: {
      now: clock.now,
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
      setInterval: clock.setInterval,
      clearInterval: clock.clearInterval,
      navigator: null,
      document: null,
      AudioContext: null,
    },
  });
  player.load([TRACK_A], 0, 'lista', 'C0');
  player.play();
  assert.equal(player.getState().playing, true);
  assert.equal(audio.playCalls, 1);
});

test('pausa externa (interrupción del sistema) se refleja en el estado y en el registro', () => {
  const { player, audio, studyEvents } = harness({ mode: 'paciente' });
  player.load([TRACK_A], 0, 'lista', 'C0');
  player.play();
  moveTo(audio, 3);
  audio.paused = true;
  audio.emit('pause');
  assert.equal(player.getState().playing, false);
  assert.deepEqual(
    studyEvents.map((event) => event.type),
    ['start', 'pause'],
  );
  assert.equal(studyEvents[1].position, 3);
});

test('anterior en la primera pista con repetición va a la última', () => {
  const { player } = harness({ mode: 'paciente', profile: profile({ repeatList: true }) });
  player.load([TRACK_A, TRACK_B, TRACK_C], 0, 'lista', 'C0');
  player.play();
  player.previous();
  assert.equal(player.getState().index, 2);
  assert.equal(player.getState().playing, true);
});

test('cargar una cola vacía deja el reproductor sin pista y play no suena', () => {
  const { player, audio } = harness();
  player.load([TRACK_A], 0, 'lista', 'C0');
  player.load([], 0, 'lista', 'C0');
  const state = player.getState();
  assert.equal(state.track, null);
  assert.equal(state.index, -1);
  assert.equal(state.queueLength, 0);
  player.play();
  assert.equal(audio.playCalls, 0);
});

test('temporizador: extender sin temporizador activo lo inicia; null lo quita', () => {
  const { player } = harness({ mode: 'paciente' });
  player.load([TRACK_A], 0, 'lista', 'C0');
  player.extendSleepTimer(extendSleepMinutes);
  assert.equal(player.getState().sleepMinutesLeft, extendSleepMinutes);
  player.setSleepTimer(null);
  assert.equal(player.getState().sleepMinutesLeft, null);
});

test('pantalla: al pasar a cuidador se libera el bloqueo activo y la reproducción sigue', async () => {
  const { player, navigator } = harness({ mode: 'paciente' });
  player.load([TRACK_A], 0, 'lista', 'C0');
  player.play();
  await flush();
  const [sentinel] = navigator.wakeLock.sentinels;
  player.setMode('cuidador');
  assert.equal(sentinel.released, true);
  assert.equal(player.getState().playing, true);
});

test('restoreLast de una pista sin conexión no carga audio y play no la reproduce', () => {
  const { player, audio } = harness({ isAvailable: (item) => item.id !== TRACK_A.id });
  player.restoreLast(TRACK_A, 30);
  assert.equal(player.getState().notice, NOTICES.unavailable);
  assert.equal(audio.loads.length, 0);
  player.play();
  assert.equal(audio.playCalls, 0);
  assert.equal(player.getState().playing, false);
  assert.equal(player.getState().notice, NOTICES.noneAvailable);
});
