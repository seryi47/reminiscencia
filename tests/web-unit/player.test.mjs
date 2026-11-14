// Pruebas del reproductor (frontend/web/js/player.js): funciones puras, cola, aleatorio, repetir, volumen,
// canciones no disponibles sin conexión, errores, parones de la red (vigilante), preferencias guardadas solo al cambiar
// y Media Session. Sin DOM: el elemento de audio, los temporizadores
// y el navegador son dobles de prueba. Las pistas son ficticias.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ERROR_SKIP_MS,
  NOTICES,
  PREVIOUS_RESTART_SECONDS,
  REPEAT_MODES,
  STALL_TIMEOUT_MS,
  clampVolume,
  createPlayer,
  createPrefsSaver,
  nextRepeatMode,
  shuffledIndexes,
} from '../../frontend/web/js/player.js';

const track = (letter, extra = {}) => ({
  id: `cancion-${letter}`,
  title: `Canción ficticia ${letter.toUpperCase()}`,
  artist: `Artista ficticio ${letter.toUpperCase()}`,
  audioUrl: `audio/${letter}.opus`,
  folderId: null,
  durationS: 180,
  ...extra,
});
const A = track('a');
const B = track('b');
const C = track('c');
const D = track('d');

// Doble del elemento de audio: solo lo que usa el reproductor.
class FakeAudio {
  constructor({ fixedVolume = false } = {}) {
    this.listeners = new Map();
    this.currentTime = 0;
    this.duration = NaN;
    this.paused = true;
    this.ended = false;
    this.fixedVolume = fixedVolume;
    this.volumeValue = 1;
    this.currentSrc = '';
    this.playCalls = 0;
    this.loadCalls = 0;
    this.seeking = false;
  }

  get volume() {
    return this.volumeValue;
  }

  set volume(value) {
    // En iOS la propiedad no cambia: siempre vale 1.
    if (!this.fixedVolume) this.volumeValue = value;
  }

  get src() {
    return this.currentSrc;
  }

  set src(value) {
    this.currentSrc = value;
    this.currentTime = 0;
    this.paused = true;
    this.ended = false;
  }

  play() {
    this.playCalls += 1;
    this.paused = false;
    return Promise.resolve();
  }

  pause() {
    this.paused = true;
  }

  load() {
    this.loadCalls += 1;
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

  // Fin natural de la pista.
  finish() {
    this.ended = true;
    this.paused = true;
    this.emit('ended');
  }
}

function createTimers() {
  let nextId = 1;
  const timers = new Map();
  return {
    setTimeout(fn, ms) {
      const id = nextId++;
      timers.set(id, { fn, ms });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    runAll() {
      for (const [id, timer] of [...timers]) {
        timers.delete(id);
        timer.fn();
      }
    },
    pending: () => [...timers.values()].map((timer) => timer.ms),
    // Ejecuta solo los temporizadores de esa duración (por ejemplo, el del vigilante de parones).
    run(ms) {
      for (const [id, timer] of [...timers]) {
        if (timer.ms !== ms) continue;
        timers.delete(id);
        timer.fn();
      }
    },
  };
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
  };
}

class FakeMediaMetadata {
  constructor(init) {
    Object.assign(this, init);
  }
}

// Azar determinista: siempre 0, así Fisher-Yates intercambia cada elemento con el primero.
const zero = () => 0;

function setup(options = {}) {
  const audio = new FakeAudio(options.audio);
  const timers = createTimers();
  const navigator = createFakeNavigator();
  const changes = [];
  const notices = [];
  const player = createPlayer({
    audio,
    onChange: (state) => changes.push(state),
    onNotice: (text) => notices.push(text),
    isAvailable: options.isAvailable,
    isOnDevice: options.isOnDevice,
    shuffle: options.shuffle,
    repeat: options.repeat,
    volume: options.volume,
    env: { navigator, MediaMetadata: FakeMediaMetadata, setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout, random: options.random ?? zero },
  });
  return { audio, timers, navigator, changes, notices, player };
}

const ids = (state) => [state.track?.id, ...state.upcoming.map((item) => item.track.id)];

describe('funciones puras', () => {
  test('clampVolume acota entre 0 y 1 y un valor no numérico vale 1', () => {
    assert.equal(clampVolume(0.4), 0.4);
    assert.equal(clampVolume(-2), 0);
    assert.equal(clampVolume(3), 1);
    assert.equal(clampVolume('nada'), 1);
  });

  test('repetir pasa de no a toda la cola, a esta canción y vuelve a no', () => {
    assert.deepEqual(REPEAT_MODES, ['off', 'all', 'one']);
    assert.equal(nextRepeatMode('off'), 'all');
    assert.equal(nextRepeatMode('all'), 'one');
    assert.equal(nextRepeatMode('one'), 'off');
    assert.equal(nextRepeatMode('raro'), 'off');
  });

  test('shuffledIndexes es una permutación y deja delante la elegida', () => {
    const order = shuffledIndexes(6, 3, Math.random);
    assert.equal(order[0], 3);
    assert.deepEqual([...order].sort(), [0, 1, 2, 3, 4, 5]);
    assert.deepEqual([...shuffledIndexes(5, null, Math.random)].sort(), [0, 1, 2, 3, 4]);
    assert.deepEqual(shuffledIndexes(0, null), []);
  });
});

describe('carga y reproducción', () => {
  test('al crearse no suena nada y el estado está vacío', () => {
    const { player, audio } = setup();
    const state = player.getState();
    assert.equal(state.track, null);
    assert.equal(state.playing, false);
    assert.equal(audio.playCalls, 0);
  });

  test('load reproduce desde la canción elegida y guarda el contexto', () => {
    const { player, audio, navigator } = setup();
    player.load([A, B, C], 1, { contextId: 'carpeta:x', contextName: 'Carpeta X' });
    const state = player.getState();
    assert.equal(state.track.id, B.id);
    assert.equal(state.playing, true);
    assert.equal(state.contextId, 'carpeta:x');
    assert.equal(state.contextName, 'Carpeta X');
    assert.equal(audio.src, B.audioUrl);
    assert.equal(audio.playCalls, 1);
    assert.deepEqual(ids(state), [B.id, C.id]);
    assert.equal(navigator.mediaSession.metadata.title, B.title);
    assert.equal(navigator.mediaSession.metadata.album, 'Carpeta X');
    assert.equal(navigator.mediaSession.playbackState, 'playing');
  });

  test('load sin autoplay deja la canción en pausa', () => {
    const { player, audio } = setup();
    player.load([A, B], 0, { autoplay: false });
    assert.equal(player.getState().playing, false);
    assert.equal(audio.playCalls, 0);
    player.toggle();
    assert.equal(player.getState().playing, true);
    player.toggle();
    assert.equal(player.getState().playing, false);
  });

  test('al terminar una canción pasa a la siguiente y, al final sin repetir, se para', () => {
    const { player, audio } = setup();
    player.load([A, B], 0);
    audio.finish();
    assert.equal(player.getState().track.id, B.id);
    assert.equal(player.getState().playing, true);
    audio.finish();
    assert.equal(player.getState().track.id, B.id);
    assert.equal(player.getState().playing, false);
  });

  test('«Anterior» vuelve al principio si la canción lleva más de 3 s; si no, va a la anterior', () => {
    const { player, audio } = setup();
    player.load([A, B], 1);
    audio.currentTime = PREVIOUS_RESTART_SECONDS + 2;
    audio.emit('timeupdate');
    player.previous();
    assert.equal(player.getState().track.id, B.id);
    assert.equal(audio.currentTime, 0);
    player.previous();
    assert.equal(player.getState().track.id, A.id);
  });

  test('seekTo mueve la posición dentro de la duración', () => {
    const { player, audio } = setup();
    player.load([A], 0);
    audio.duration = 200;
    audio.emit('loadedmetadata');
    player.seekTo(50);
    assert.equal(audio.currentTime, 50);
    player.seekTo(999);
    assert.equal(player.getState().position, 200);
  });

  test('una pausa del sistema se refleja en el estado', () => {
    const { player, audio } = setup();
    player.load([A], 0);
    audio.paused = true;
    audio.emit('pause');
    assert.equal(player.getState().playing, false);
    audio.paused = false;
    audio.emit('play');
    assert.equal(player.getState().playing, true);
  });
});

describe('sustituir una canción (copia local → pública)', () => {
  test('replaceTrack cambia la pista en el contexto y en la cola sin cortar la que suena', () => {
    const { player, audio } = setup();
    const local = track('l', { id: 'L0011223344556677', audioUrl: 'audio/L0011223344556677.opus', local: true });
    const pub = track('p', { id: 'S0011223344556677', audioUrl: 'audio/S0011223344556677.opus', title: 'Canción ficticia L' });
    player.load([local, B], 0);
    player.addToQueue(local);
    audio.currentTime = 42;
    const playCalls = audio.playCalls;
    assert.equal(player.replaceTrack(local.id, pub), true);
    const state = player.getState();
    assert.equal(state.track.id, pub.id);
    assert.equal(state.track.local, false);
    assert.deepEqual(ids(state), [pub.id, pub.id, B.id]);
    assert.equal(state.playing, true, 'sigue sonando');
    assert.equal(audio.src, local.audioUrl, 'el audio conserva su fuente: no se corta');
    assert.equal(audio.currentTime, 42);
    assert.equal(audio.playCalls, playCalls);
    // Al volver a la canción más tarde, ya suena la pública.
    player.next();
    player.next();
    player.previous();
    assert.equal(audio.src, pub.audioUrl);
  });

  test('replaceTrack no hace nada con una canción que no está o con el mismo id', () => {
    const { player } = setup();
    player.load([A, B], 0);
    assert.equal(player.replaceTrack('no-esta', C), false);
    assert.equal(player.replaceTrack(A.id, A), false);
    assert.deepEqual(ids(player.getState()), [A.id, B.id]);
  });
});

describe('repetir', () => {
  test('repetir toda la cola vuelve al principio al terminar la última', () => {
    const { player, audio } = setup({ repeat: 'all' });
    player.load([A, B], 1);
    audio.finish();
    assert.equal(player.getState().track.id, A.id);
    assert.equal(player.getState().playing, true);
  });

  test('repetir esta canción la vuelve a empezar al terminar', () => {
    const { player, audio } = setup();
    player.load([A, B], 0);
    player.setRepeat('one');
    const before = audio.playCalls;
    audio.currentTime = 170;
    audio.finish();
    assert.equal(player.getState().track.id, A.id);
    assert.equal(player.getState().playing, true);
    assert.equal(audio.currentTime, 0);
    assert.equal(audio.playCalls, before + 1);
  });

  test('con repetir, «Siguiente» en la última pasa a la primera', () => {
    const { player } = setup({ repeat: 'one' });
    player.load([A, B], 1);
    player.next();
    assert.equal(player.getState().track.id, A.id);
  });

  test('un modo desconocido no cambia nada', () => {
    const { player } = setup();
    player.setRepeat('siempre');
    assert.equal(player.getState().repeat, 'off');
  });
});

describe('aleatorio', () => {
  test('con aleatorio, la canción elegida suena primero y el resto se baraja', () => {
    const { player } = setup({ shuffle: true });
    player.load([A, B, C, D], 2);
    const state = player.getState();
    assert.equal(state.track.id, C.id);
    assert.deepEqual([...ids(state)].sort(), [A.id, B.id, C.id, D.id].sort());
  });

  test('activar el aleatorio conserva la canción actual y baraja las que quedan', () => {
    const { player } = setup({ random: () => 0.99 });
    player.load([A, B, C, D], 1);
    player.setShuffle(true);
    const state = player.getState();
    assert.equal(state.shuffle, true);
    assert.equal(state.track.id, B.id);
    assert.deepEqual([...ids(state)].sort(), [A.id, B.id, C.id, D.id].sort());
  });

  test('desactivarlo vuelve al orden original desde la canción actual', () => {
    const { player } = setup({ shuffle: true });
    player.load([A, B, C, D], 2);
    player.setShuffle(false);
    assert.deepEqual(ids(player.getState()), [C.id, D.id]);
    player.previous();
    assert.equal(player.getState().track.id, B.id);
  });

  test('sin canción elegida y con aleatorio, empieza por una al azar', () => {
    const { player } = setup({ shuffle: true, random: () => 0.6 });
    player.load([A, B, C, D], null);
    assert.equal(player.getState().track.id, C.id);
  });
});

describe('cola', () => {
  test('«Añadir a la cola» pone la canción después de la actual, en orden de llegada', () => {
    const { player } = setup();
    player.load([A, B], 0);
    player.addToQueue(C);
    player.addToQueue(D);
    const state = player.getState();
    assert.deepEqual(ids(state), [A.id, C.id, D.id, B.id]);
    assert.deepEqual(state.upcoming.map((item) => item.fromQueue), [true, true, false]);
  });

  test('una canción añadida sale de la cola cuando se deja atrás', () => {
    const { player, audio } = setup();
    player.load([A, B], 0);
    player.addToQueue(C);
    audio.finish();
    assert.equal(player.getState().track.id, C.id);
    audio.finish();
    assert.equal(player.getState().track.id, B.id);
    player.previous();
    assert.equal(player.getState().track.id, A.id);
  });

  test('lo añadido a la cola se conserva al cambiar de contexto', () => {
    const { player } = setup();
    player.load([A, B], 0);
    player.addToQueue(D);
    player.load([B, C], 0, { contextId: 'otra' });
    assert.deepEqual(ids(player.getState()), [B.id, D.id, C.id]);
  });

  test('playEntry salta a una entrada concreta de la cola', () => {
    const { player } = setup();
    player.load([A, B, C], 0);
    const target = player.getState().upcoming[1];
    player.playEntry(target.key);
    assert.equal(player.getState().track.id, C.id);
  });

  test('sin nada cargado, añadir a la cola la deja preparada en pausa', () => {
    const { player, audio } = setup();
    player.addToQueue(A);
    assert.equal(player.getState().track.id, A.id);
    assert.equal(player.getState().playing, false);
    assert.equal(audio.playCalls, 0);
  });
});

describe('volumen', () => {
  test('setVolume cambia el volumen del elemento y silenciar lo pone a 0 sin perderlo', () => {
    const { player, audio } = setup({ volume: 0.8 });
    assert.equal(audio.volume, 0.8);
    assert.equal(player.getState().volumeAdjustable, true);
    player.setVolume(0.3);
    assert.equal(audio.volume, 0.3);
    player.toggleMute();
    assert.equal(audio.volume, 0);
    assert.equal(player.getState().muted, true);
    player.toggleMute();
    assert.equal(audio.volume, 0.3);
  });

  test('donde el volumen no se puede cambiar (iOS), lo indica el estado', () => {
    const { player } = setup({ audio: { fixedVolume: true } });
    assert.equal(player.getState().volumeAdjustable, false);
  });
});

describe('sin conexión y errores', () => {
  const offline = (item) => item.id !== B.id;

  test('salta las canciones no disponibles y avisa', () => {
    const { player, notices } = setup({ isAvailable: offline });
    player.load([A, B, C], 1);
    assert.equal(player.getState().track.id, C.id);
    assert.deepEqual(notices, [NOTICES.unavailable]);
  });

  test('si no hay ninguna disponible, no suena y lo dice', () => {
    const { player, audio, notices } = setup({ isAvailable: () => false });
    player.load([A, B], 0);
    assert.equal(player.getState().playing, false);
    assert.equal(audio.playCalls, 0);
    assert.deepEqual(notices, [NOTICES.noneAvailable]);
  });

  test('un error de reproducción avisa y pasa a la siguiente tras una espera', () => {
    const { player, audio, timers, notices } = setup();
    player.load([A, B], 0);
    audio.emit('error');
    assert.equal(player.getState().playing, false);
    assert.deepEqual(notices, [NOTICES.error]);
    assert.deepEqual(timers.pending(), [ERROR_SKIP_MS]);
    timers.runAll();
    assert.equal(player.getState().track.id, B.id);
    assert.equal(player.getState().playing, true);
  });

  test('una canción sin audio no se puede reproducir', () => {
    const { player, notices } = setup();
    player.load([{ ...A, audioUrl: null }], 0);
    assert.equal(player.getState().playing, false);
    assert.deepEqual(notices, [NOTICES.noneAvailable]);
  });
});

describe('parones de la red (vigilante)', () => {
  // El elemento avanza: cambia currentTime y avisa con timeupdate.
  const advanceTo = (audio, seconds) => {
    audio.currentTime = seconds;
    audio.emit('timeupdate');
  };

  test('un waiting con la reproducción pedida arma el plazo y un avance real lo quita', () => {
    const { player, audio, timers } = setup();
    player.load([A, B], 0);
    audio.emit('waiting');
    assert.deepEqual(timers.pending(), [STALL_TIMEOUT_MS]);
    audio.emit('stalled');
    assert.deepEqual(timers.pending(), [STALL_TIMEOUT_MS], 'no se acumulan plazos');
    advanceTo(audio, 0.3);
    assert.deepEqual(timers.pending(), []);
    assert.equal(STALL_TIMEOUT_MS >= 15_000 && STALL_TIMEOUT_MS <= 20_000, true);
  });

  test('sin avance, primero vuelve a pedir la misma canción desde el mismo punto y después la trata como un error', () => {
    const { player, audio, timers, notices } = setup();
    player.load([A, B], 0);
    advanceTo(audio, 42);
    audio.emit('waiting');
    const plays = audio.playCalls;
    timers.run(STALL_TIMEOUT_MS);
    // Reintento: misma fuente, recargada, en el mismo segundo y sonando.
    assert.equal(audio.loadCalls, 1);
    assert.equal(audio.src, A.audioUrl);
    assert.equal(audio.currentTime, 42);
    assert.equal(audio.playCalls, plays + 1);
    assert.equal(player.getState().playing, true);
    assert.equal(player.getState().track.id, A.id);
    assert.deepEqual(notices, []);
    assert.deepEqual(timers.pending(), [STALL_TIMEOUT_MS]);
    // Tampoco avanza: como un error de reproducción (aviso y, tras ERROR_SKIP_MS, la siguiente).
    timers.run(STALL_TIMEOUT_MS);
    assert.deepEqual(notices, [NOTICES.error]);
    assert.equal(player.getState().playing, false);
    assert.deepEqual(timers.pending(), [ERROR_SKIP_MS]);
    timers.runAll();
    assert.equal(player.getState().track.id, B.id);
    assert.equal(player.getState().playing, true);
  });

  test('si tras el reintento vuelve a avanzar, un parón posterior se reintenta otra vez (no salta)', () => {
    const { player, audio, timers, notices } = setup();
    player.load([A, B], 0);
    audio.emit('waiting');
    timers.run(STALL_TIMEOUT_MS);
    advanceTo(audio, 5);
    assert.deepEqual(timers.pending(), []);
    audio.emit('waiting');
    timers.run(STALL_TIMEOUT_MS);
    assert.equal(audio.loadCalls, 2);
    assert.deepEqual(notices, []);
    assert.equal(player.getState().track.id, A.id);
  });

  test('en pausa no vigila, y pausar, pasar de canción o terminar quitan el plazo', () => {
    const { player, audio, timers } = setup();
    player.load([A, B, C], 0, { autoplay: false });
    audio.emit('waiting');
    assert.deepEqual(timers.pending(), [], 'en pausa (sin reproducción pedida)');
    player.play();
    audio.emit('waiting');
    player.pause();
    assert.deepEqual(timers.pending(), [], 'al pausar');
    player.play();
    audio.emit('waiting');
    player.next();
    assert.deepEqual(timers.pending(), [], 'al pasar de canción');
    audio.emit('waiting');
    player.load([C], 0);
    assert.deepEqual(timers.pending(), [], 'al cargar otra colección');
    audio.emit('waiting');
    audio.emit('error');
    assert.deepEqual(timers.pending(), [ERROR_SKIP_MS], 'tras un error solo queda el salto');
    player.destroy();
  });

  test('un salto dentro de la canción empieza un plazo nuevo y no cuenta como avance', () => {
    const { player, audio, timers } = setup();
    player.load([A], 0);
    advanceTo(audio, 10);
    audio.emit('waiting');
    // La persona salta a 90 s: el elemento busca (seeking) y avisa con timeupdate en el destino, aún sin datos.
    audio.seeking = true;
    audio.currentTime = 90;
    audio.emit('seeking');
    audio.emit('timeupdate');
    assert.deepEqual(timers.pending(), [STALL_TIMEOUT_MS]);
    audio.seeking = false;
    audio.emit('timeupdate');
    assert.deepEqual(timers.pending(), [STALL_TIMEOUT_MS], 'seguir en el destino no es avanzar');
    advanceTo(audio, 90.25);
    assert.deepEqual(timers.pending(), []);
  });

  test('una canción guardada en el dispositivo no se recarga ni se salta: solo se anota', (t) => {
    const warn = t.mock.method(console, 'warn', () => {});
    const { player, audio, timers, notices } = setup({ isOnDevice: (item) => item.id === A.id });
    player.load([A, B], 0);
    audio.emit('waiting');
    audio.emit('stalled');
    assert.equal(warn.mock.callCount(), 0, 'esperar datos al empezar no se anota');
    timers.run(STALL_TIMEOUT_MS);
    assert.deepEqual(timers.pending(), []);
    assert.equal(audio.loadCalls, 0);
    assert.deepEqual(notices, []);
    assert.equal(player.getState().track.id, A.id);
    assert.equal(warn.mock.callCount() >= 1, true);
    // La siguiente llega por la red: esa sí se vigila.
    player.next();
    audio.emit('waiting');
    assert.deepEqual(timers.pending(), [STALL_TIMEOUT_MS]);
  });

  test('si isOnDevice falla, la canción se trata como de la red', () => {
    const { player, audio, timers } = setup({ isOnDevice: () => { throw new Error('sin caché'); } });
    player.load([A], 0);
    audio.emit('waiting');
    assert.deepEqual(timers.pending(), [STALL_TIMEOUT_MS]);
  });
});

describe('estado con cada avance del tiempo', () => {
  test('la cola que queda es la misma copia mientras no cambia, y otra al cambiar', () => {
    const { player, audio, changes } = setup();
    player.load([A, B, C], 0);
    audio.currentTime = 1;
    audio.emit('timeupdate');
    audio.currentTime = 2;
    audio.emit('timeupdate');
    const [first, second] = changes.slice(-2);
    assert.equal(first.position, 1);
    assert.equal(second.position, 2);
    assert.equal(first.upcoming, second.upcoming);
    assert.equal(Object.isFrozen(second.upcoming), true);
    player.addToQueue(D);
    assert.notEqual(player.getState().upcoming, second.upcoming);
    assert.deepEqual(ids(player.getState()), [A.id, D.id, B.id, C.id]);
    player.next();
    assert.deepEqual(ids(player.getState()), [D.id, B.id, C.id]);
    player.replaceTrack(C.id, { ...C, id: 'cancion-c2' });
    assert.deepEqual(ids(player.getState()), [D.id, B.id, 'cancion-c2']);
    // Con aleatorio, la actual (añadida a la cola) sigue delante y detrás va todo el contexto barajado.
    player.setShuffle(true);
    const shuffled = ids(player.getState());
    assert.equal(shuffled[0], D.id);
    assert.deepEqual(shuffled.slice(1).sort(), [A.id, B.id, 'cancion-c2'].sort());
  });
});

describe('preferencias guardadas (createPrefsSaver)', () => {
  test('solo escribe cuando cambian el volumen, el aleatorio o la repetición', () => {
    const writes = [];
    const { player, audio } = setup();
    const save = createPrefsSaver((prefs) => writes.push(prefs), player.getState());
    player.load([A, B], 0);
    for (let second = 1; second <= 20; second += 1) {
      audio.currentTime = second;
      audio.emit('timeupdate');
      save(player.getState());
    }
    assert.deepEqual(writes, [], 'el avance del tiempo no escribe');
    player.setVolume(0.5);
    save(player.getState());
    save(player.getState());
    player.setShuffle(true);
    save(player.getState());
    player.setRepeat('one');
    save(player.getState());
    player.pause();
    save(player.getState());
    assert.deepEqual(writes, [
      { volume: 0.5, shuffle: false, repeat: 'off' },
      { volume: 0.5, shuffle: true, repeat: 'off' },
      { volume: 0.5, shuffle: true, repeat: 'one' },
    ]);
  });

  test('sin estado inicial, la primera llamada escribe una vez', () => {
    const writes = [];
    const save = createPrefsSaver((prefs) => writes.push(prefs));
    const state = { volume: 1, shuffle: false, repeat: 'off', position: 3 };
    assert.equal(save(state), true);
    assert.equal(save({ ...state, position: 4 }), false);
    assert.equal(writes.length, 1);
  });
});

describe('Media Session y destrucción', () => {
  test('las teclas multimedia llaman a reproducir, pausar, anterior y siguiente', () => {
    const { player, navigator } = setup();
    player.load([A, B], 0, { autoplay: false });
    navigator.mediaSession.handlers.play();
    assert.equal(player.getState().playing, true);
    navigator.mediaSession.handlers.nexttrack();
    assert.equal(player.getState().track.id, B.id);
    navigator.mediaSession.handlers.pause();
    assert.equal(player.getState().playing, false);
    navigator.mediaSession.handlers.previoustrack();
    assert.equal(player.getState().track.id, A.id);
  });

  test('destroy quita los manejadores y para el audio', () => {
    const { player, audio, navigator } = setup();
    player.load([A], 0);
    player.destroy();
    assert.equal(audio.paused, true);
    assert.equal(navigator.mediaSession.handlers.play, null);
    assert.equal(audio.listeners.get('ended').size, 0);
  });
});

describe('normalización de volumen (ADR-0046)', () => {
  const loud = track('loud', { gainDb: -6 }); // factor 10^(-6/20) ≈ 0.501
  const quiet = track('quiet', { gainDb: 6 }); // positivo: el reproductor lo recorta a 1
  const plain = track('plain'); // sin gainDb

  test('atenúa un tema fuerte, no sube uno flojo de 1 y sin dato deja el volumen pleno', () => {
    const { audio, player } = setup({ volume: 1 });
    player.load([loud, quiet, plain], 0);
    assert.ok(Math.abs(audio.volumeValue - Math.pow(10, -6 / 20)) < 1e-9, 'el fuerte se atenúa');
    player.next();
    assert.equal(audio.volumeValue, 1, 'el flojo no pasa de 1 (audio.volume no sube de 1)');
    player.next();
    assert.equal(audio.volumeValue, 1, 'sin gainDb, volumen pleno');
  });

  test('la ganancia se combina con el volumen base del usuario', () => {
    const { audio, player } = setup({ volume: 0.5 });
    player.load([loud], 0);
    assert.ok(Math.abs(audio.volumeValue - 0.5 * Math.pow(10, -6 / 20)) < 1e-9);
  });
});
