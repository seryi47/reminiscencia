// Prebuffer de la siguiente canción (ADR-0052). Verifica que el reproductor dispara un fetch silencioso de la URL del
// siguiente tema cuando queda poco del actual, y que esa precarga es idempotente, cancelable y respeta la ausencia de
// siguiente canción.
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createPlayer } from '../../frontend/web/js/player.js';

const track = (letter, extra = {}) => ({
  id: `cancion-${letter}`,
  title: `Canción ${letter.toUpperCase()}`,
  artist: `Artista ${letter.toUpperCase()}`,
  audioUrl: `audio/${letter}.opus`,
  folderId: null,
  durationS: 100,
  ...extra,
});

class FakeAudio {
  constructor() {
    this.listeners = new Map();
    this.currentTime = 0;
    this.duration = NaN;
    this.volume = 1;
    this.src = '';
  }
  addEventListener(name, fn) { if (!this.listeners.has(name)) this.listeners.set(name, new Set()); this.listeners.get(name).add(fn); }
  removeEventListener(name, fn) { const s = this.listeners.get(name); if (s) s.delete(fn); }
  dispatch(name) { const s = this.listeners.get(name); if (s) for (const fn of s) fn(); }
  async play() { this.paused = false; this.dispatch('play'); }
  pause() { this.paused = true; this.dispatch('pause'); }
  load() { /* no-op */ }
  get currentSrc() { return this.src; }
}

function setup() {
  const audio = new FakeAudio();
  const env = { navigator: null, MediaMetadata: null, setTimeout: (fn) => setTimeout(fn, 0), clearTimeout, random: () => 0 };
  const player = createPlayer({ audio, onChange: () => {}, onNotice: () => {}, env });
  return { audio, player };
}

let fetchCalls = [];
let abortCalls = 0;
let originalFetch;
let originalAbortController;

const A = track('a');
const B = track('b');
const C = track('c');

describe('prebuffer de la siguiente canción', () => {
  // Los hooks SE MOVIERON DENTRO del describe para que solo afecten a este bloque y no contaminen otros
  // ficheros del test runner cuando se cargan en el mismo proceso (p. ej. tests que usan AbortController real).
  beforeEach(() => {
    fetchCalls = [];
    abortCalls = 0;
    originalFetch = globalThis.fetch;
    originalAbortController = globalThis.AbortController;
    globalThis.AbortController = class {
      constructor() { this.signal = { aborted: false, parent: this }; }
      abort() { abortCalls += 1; this.signal.aborted = true; }
    };
    globalThis.fetch = (url, init) => {
      fetchCalls.push({ url, init });
      return Promise.resolve({ ok: true, status: 200 });
    };
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    globalThis.AbortController = originalAbortController;
  });

  test('al pasar el 80 % de la actual se precarga la siguiente', () => {
    const { audio, player } = setup();
    player.load([A, B], 0, { autoplay: false });
    audio.duration = 100;
    audio.dispatch('loadedmetadata');
    audio.currentTime = 81;
    audio.dispatch('timeupdate');
    assert.equal(fetchCalls.length, 1);
    assert.equal(fetchCalls[0].url, 'audio/b.opus');
    assert.equal(fetchCalls[0].init.cache, 'default');
    assert.equal(fetchCalls[0].init.priority, 'low');
  });

  test('no vuelve a precargar la misma URL aunque sigan llegando timeupdates', () => {
    const { audio, player } = setup();
    player.load([A, B], 0, { autoplay: false });
    audio.duration = 100;
    audio.dispatch('loadedmetadata');
    audio.currentTime = 85;
    audio.dispatch('timeupdate');
    audio.currentTime = 90;
    audio.dispatch('timeupdate');
    audio.currentTime = 95;
    audio.dispatch('timeupdate');
    assert.equal(fetchCalls.length, 1, 'debe ser idempotente: una única precarga para esa URL');
  });

  test('si el usuario salta manualmente a la siguiente antes de que acabe, el fetch se cancela', () => {
    const { audio, player } = setup();
    player.load([A, B, C], 0, { autoplay: false });
    audio.duration = 100;
    audio.dispatch('loadedmetadata');
    audio.currentTime = 85;
    audio.dispatch('timeupdate');
    assert.equal(fetchCalls.length, 1);
    player.next(); // salta a B → el prefetch de B queda obsoleto
    assert.ok(abortCalls >= 1, 'debe haber abortado el prefetch anterior al cambiar de fuente');
  });

  test('no precarga nada si no hay siguiente canción en la cola', () => {
    const { audio, player } = setup();
    player.load([A], 0, { autoplay: false });
    audio.duration = 100;
    audio.dispatch('loadedmetadata');
    audio.currentTime = 90;
    audio.dispatch('timeupdate');
    assert.equal(fetchCalls.length, 0);
  });
});
