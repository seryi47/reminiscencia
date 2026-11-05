// Pruebas del estado de las subidas (frontend/web/js/cuidador/subida-estado.js; ADR-0017), sin navegador: la máquina
// de estados y sus textos, la detección de la canción publicada en un songs.json simulado (también con un título que
// ya existía), lo que se guarda en localStorage y el gestor completo con la conversión, el envío, el reloj y los
// temporizadores simulados. Datos ficticios. Ejecución: node --test tests/web-unit/subida-estado.test.mjs
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, test } from 'node:test';

import {
  activeCount,
  createItem,
  createUploadTracker,
  expectedSongId,
  findNewSong,
  INTERRUPTED_TEXT,
  indicatorText,
  MAX_WAIT_MS,
  normalizeTitle,
  parseItems,
  POLL_MS,
  progressOf,
  publishedNotice,
  SAVED_PAUSE_MS,
  SLOW_POLL_MS,
  serializeItems,
  SONGS_FETCH_TIMEOUT_MS,
  songsFetcher,
  STATES,
  STORAGE_KEY,
  statusText,
  summaryText,
  titleCandidates,
  transition,
} from '../../frontend/web/js/cuidador/subida-estado.js';

const S = STATES;
const NBSP = ' ';

describe('máquina de estados', () => {
  test('el camino completo: en cola → convirtiendo → subiendo por trozos → guardada → publicándose → publicada', () => {
    let item = createItem({ key: 'k1', name: 'Tono de prueba.wav', title: 'Tono de prueba' });
    const texts = [statusText(item)];
    for (const event of [
      { type: 'convert', fraction: 0.3 },
      { type: 'converted', localId: 'L0011223344556677' },
      { type: 'send', fraction: 0.45 },
      { type: 'saved', serverName: 'Tono de prueba.opus', at: 1000, knownIds: ['S1'] },
      { type: 'publishing' },
      { type: 'published', songId: 'S2', songTitle: 'Tono de prueba' },
    ]) {
      item = transition(item, event);
      texts.push(statusText(item));
    }
    assert.deepEqual(texts, [
      'En cola',
      'Convirtiendo a Opus…',
      `Subiendo… 0${NBSP}%`,
      `Subiendo… 45${NBSP}%`,
      'Guardada en GitHub',
      'Publicándose… (suele tardar 2–3 minutos)',
      'Publicada',
    ]);
    assert.equal(item.songId, 'S2');
    assert.equal(item.localId, 'L0011223344556677');
    assert.equal(item.savedAt, 1000);
    assert.deepEqual(item.knownIds, ['S1']);
  });

  test('un evento que no toca en ese paso no cambia nada (devuelve la misma subida)', () => {
    const queued = createItem({ key: 'k', name: 'a.wav', title: 'a' });
    for (const type of ['send', 'saved', 'publishing', 'published', 'slow', 'retry']) assert.equal(transition(queued, { type }), queued, type);
    assert.equal(transition(queued, { type: 'desconocido' }), queued);
    const published = { ...queued, state: S.PUBLISHED };
    for (const type of ['fail', 'convert', 'slow', 'retry']) assert.equal(transition(published, { type }), published, type);
  });

  test('conserva artista y álbum en la cola persistida', () => {
    const item = createItem({
      key: 'k-artist',
      name: 'Cada vez.wav',
      title: 'Cada vez',
      album: { id: 'PLVU-jIOit29A', name: 'Nuestro desacato' },
      artist: 'Desakato',
    });
    const restored = parseItems(serializeItems([{ ...item, localId: 'L0011223344556677' }]));
    assert.equal(restored[0].artist, 'Desakato');
    assert.deepEqual(restored[0].album, { id: 'PLVU-jIOit29A', name: 'Nuestro desacato' });
  });

  test('un error lleva su motivo y se puede reintentar; sin archivo ni copia, no', () => {
    const sending = { ...createItem({ key: 'k', name: 'a.wav', title: 'a' }), state: S.SENDING, fraction: 0.5 };
    const failed = transition(sending, { type: 'fail', message: 'El archivo no es Ogg Opus.' });
    assert.equal(statusText(failed), 'Error: El archivo no es Ogg Opus.');
    assert.equal(failed.retryable, true);
    const again = transition(failed, { type: 'retry' });
    assert.equal(again.state, S.QUEUED);
    assert.equal(again.error, null);
    const lost = transition(sending, { type: 'fail', message: 'x', retryable: false });
    assert.equal(transition(lost, { type: 'retry' }), lost);
  });

  test('si tarda demasiado sigue pendiente de aparecer y aún puede publicarse después', () => {
    const publishing = { ...createItem({ key: 'k', name: 'a.wav', title: 'a' }), state: S.PUBLISHING, savedAt: 0 };
    const slow = transition(publishing, { type: 'slow' });
    assert.equal(statusText(slow), 'Aún no aparece en la biblioteca; seguiremos comprobando');
    assert.equal(transition(slow, { type: 'published', songId: 'S9' }).state, S.PUBLISHED);
  });

  test('la barra sigue el paso actual: medida, indeterminada mientras se publica u oculta al terminar mal', () => {
    const base = createItem({ key: 'k', name: 'a.wav', title: 'a' });
    assert.deepEqual(progressOf({ ...base, state: S.SENDING, fraction: 0.456 }), { value: 46, hidden: false });
    assert.deepEqual(progressOf({ ...base, state: S.PUBLISHING }), { value: null, hidden: false });
    assert.deepEqual(progressOf({ ...base, state: S.PUBLISHED }), { value: 100, hidden: false });
    assert.equal(progressOf({ ...base, state: S.ERROR }).hidden, true);
    assert.equal(progressOf({ ...base, state: S.SLOW }).hidden, true);
  });

  test('resumen, indicador de la barra lateral y aviso', () => {
    const item = (state) => ({ ...createItem({ key: state, name: 'x', title: 'x' }), state });
    assert.equal(summaryText([]), '');
    assert.equal(summaryText([item(S.PUBLISHED), item(S.PUBLISHED), item(S.PUBLISHING)]), '2 de 3 publicadas');
    assert.equal(summaryText([item(S.SENDING)]), '0 de 1 publicada');
    assert.equal(summaryText([item(S.PUBLISHED), item(S.ERROR), item(S.SLOW)]), '1 de 3 publicadas · 1 con error · 1 pendiente de aparecer');
    assert.equal(activeCount([item(S.QUEUED), item(S.CONVERTING), item(S.SENDING), item(S.SAVED), item(S.PUBLISHING), item(S.PUBLISHED), item(S.ERROR), item(S.SLOW)]), 5);
    assert.equal(indicatorText(0), '');
    assert.equal(indicatorText(1), 'Publicándose 1 canción');
    assert.equal(indicatorText(3), 'Publicándose 3 canciones');
    assert.equal(publishedNotice(['Tono de prueba']), '“Tono de prueba” ya está en la biblioteca');
    assert.equal(publishedNotice(['A', 'B']), '2 canciones nuevas ya están en la biblioteca');
  });
});

describe('detección de la canción publicada', () => {
  const before = [
    { id: 'S1', title: 'Tono de prueba' },
    { id: 'S2', title: 'Otra canción' },
  ];

  test('una canción con el mismo título que ya estaba antes de subir no cuenta', () => {
    const titles = titleCandidates({ title: 'Tono de prueba' });
    assert.equal(findNewSong(before, { titles, knownIds: ['S1', 'S2'] }), null);
    const after = [...before, { id: 'S3', title: 'Tono de prueba' }];
    assert.equal(findNewSong(after, { titles, knownIds: ['S1', 'S2'] })?.id, 'S3');
  });

  test('una canción nueva con otro título no cuenta', () => {
    const after = [...before, { id: 'S3', title: 'Otra distinta' }];
    assert.equal(findNewSong(after, { titles: ['Tono de prueba'], knownIds: ['S1', 'S2'] }), null);
  });

  test('el título se compara en NFC, sin mayúsculas ni espacios de más', () => {
    assert.equal(normalizeTitle('  Canción   DE prueba '), normalizeTitle('canción de prueba'));
    const after = [{ id: 'S7', title: 'CANCIÓN de prueba' }];
    assert.equal(findNewSong(after, { titles: ['Canción de prueba'], knownIds: [] })?.id, 'S7');
  });

  test('vale también el nombre que le dio el buzón («Tono de prueba (2).opus»)', () => {
    assert.deepEqual(titleCandidates({ title: 'Tono de prueba', serverName: 'Tono de prueba (2).opus' }), ['tono de prueba', 'tono de prueba (2)']);
    const after = [...before, { id: 'S4', title: 'Tono de prueba (2)' }];
    assert.equal(findNewSong(after, { titles: titleCandidates({ title: 'Tono de prueba', serverName: 'Tono de prueba (2).opus' }), knownIds: ['S1', 'S2'] })?.id, 'S4');
  });

  test('ignora lo que no es una canción y una lista que no es lista', () => {
    assert.equal(findNewSong(null, { titles: ['x'] }), null);
    assert.equal(findNewSong([null, { title: 'x' }, { id: '', title: 'x' }], { titles: ['x'] }), null);
  });

  test('songsFetcher pide songs.json sin caché y rechaza lo que no vale', async () => {
    const calls = [];
    const ok = songsFetcher(async (url, init) => {
      calls.push([url, init]);
      return new Response('[{"id":"S1","title":"a"}]', { status: 200 });
    }, 'data/songs.json');
    assert.deepEqual(await ok(), [{ id: 'S1', title: 'a' }]);
    assert.equal(calls[0][0], 'data/songs.json');
    assert.equal(calls[0][1].cache, 'no-store');
    assert.ok(calls[0][1].signal instanceof AbortSignal);
    await assert.rejects(songsFetcher(async () => new Response('x', { status: 500 }))());
    await assert.rejects(songsFetcher(async () => new Response('{}', { status: 200 }))());
  });

  test('songsFetcher aborta una lectura que no responde', async () => {
    let aborted = false;
    const fetch = songsFetcher((_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => {
        aborted = true;
        reject(signal.reason);
      }, { once: true });
    }), 'data/songs.json', 5);

    await assert.rejects(fetch(), { name: 'AbortError' });
    assert.equal(aborted, true);
    assert.equal(SONGS_FETCH_TIMEOUT_MS, 15_000);
  });
});

describe('localStorage', () => {
  test('guarda lo que espera y lo que tiene copia local; al leerlo, sigue publicándose o queda para reintentar', () => {
    const album = { id: 'PLVU-jIOit29A', name: 'Nuestro desacato' };
    const base = (key, extra) => ({ ...createItem({ key, name: `${key}.wav`, title: key, album }), ...extra });
    const raw = serializeItems([
      base('esperando', { state: S.PUBLISHING, savedAt: 50, knownIds: ['S1'], serverName: 'esperando.opus' }),
      base('subiendo', { state: S.SENDING, localId: 'L0000000000000001' }),
      base('fallida', { state: S.ERROR, localId: 'L0000000000000002', error: 'GitHub no ha aceptado la subida.' }),
      base('sin-copia', { state: S.CONVERTING }),
      base('hecha', { state: S.PUBLISHED, songId: 'S5' }),
    ]);
    const restored = parseItems(raw);
    assert.deepEqual(restored.map((item) => [item.key, item.state, item.error]), [
      ['esperando', S.PUBLISHING, null],
      ['subiendo', S.ERROR, INTERRUPTED_TEXT],
      ['fallida', S.ERROR, 'GitHub no ha aceptado la subida.'],
    ]);
    assert.equal(restored[0].savedAt, 50);
    assert.deepEqual(restored[0].knownIds, ['S1']);
    assert.equal(restored[0].serverName, 'esperando.opus');
    assert.deepEqual(restored[0].album, album);
    assert.equal(restored[1].retryable, true);
  });

  test('lo que no se puede leer se descarta sin fallar', () => {
    for (const raw of [null, '', '{', '[]', '{"version":99,"items":[]}', '{"version":1,"items":[null,{"key":1}]}']) {
      assert.deepEqual(parseItems(raw), [], String(raw));
    }
  });
});

// ---------------------------------------------------------------------------------------------
// Gestor con dependencias simuladas
// ---------------------------------------------------------------------------------------------

function fakeTimers() {
  let seq = 0;
  const timers = new Map();
  return {
    setTimer(fn, ms) {
      seq += 1;
      timers.set(seq, { fn, ms });
      return seq;
    },
    clearTimer(id) {
      timers.delete(id);
    },
    pending: () => [...timers.values()].map((timer) => timer.ms).sort((a, b) => a - b),
    /** Ejecuta los temporizadores de ms milisegundos (o todos). */
    run(ms = null) {
      for (const [id, timer] of [...timers]) {
        if (ms !== null && timer.ms !== ms) continue;
        timers.delete(id);
        timer.fn();
      }
    },
  };
}

function fakeStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
  };
}

// Gestores creados por setup(): settle() espera a que terminen lo que lanzaron sin esperar.
const live = new Set();

const settle = async () => {
  // Sin vueltas fijas al bucle de eventos: el id de contenido (crypto.subtle.digest) termina en otro hilo y en un
  // ejecutor lento (CI) ni 30 setImmediate ni 20 setTimeout bastaban siempre.
  for (const tracker of live) await tracker.idle();
};

class FakeUploadError extends Error {
  constructor(message, { stop = false } = {}) {
    super(message);
    this.name = 'PublicUploadError';
    this.stop = stop;
  }
}

function setup({ songs = [{ id: 'S1', title: 'Tono de prueba' }], send, storage = fakeStorage(), convert } = {}) {
  const timers = fakeTimers();
  const clock = { now: 1_000 };
  const server = { songs: [...songs], fetches: 0, fail: false };
  const calls = { convert: 0, send: [], copies: [], published: [] };
  let localSeq = 0;
  const tracker = createUploadTracker({
    convert: convert ?? (async (file, { onProgress }) => {
      calls.convert += 1;
      onProgress({ fraction: 0.5 });
      onProgress({ fraction: 1 });
      return { bytes: new Uint8Array([1, 2, 3]), durationS: 1, channels: 1, bitrate: 32000, file: file.name };
    }),
    saveCopy: async ({ title }) => {
      localSeq += 1;
      const song = { id: `L${String(localSeq).padStart(16, '0')}`, title, local: true, pending: true };
      calls.copies.push(song);
      return song;
    },
    readCopy: async () => new Uint8Array([9, 9]),
    send: send ?? (async (bytes, { fileName, album, artist, onChunk }) => {
      calls.send.push({ fileName, bytes: [...bytes], album, artist });
      for (let index = 0; index < 3; index += 1) onChunk({ index, total: 3 });
      return { ok: true, nombre: fileName.replace(/\.[^.]*$/, '.opus') };
    }),
    fetchSongs: async () => {
      server.fetches += 1;
      if (server.fail) throw new TypeError('Sin conexión');
      return server.songs.map((song) => ({ ...song }));
    },
    currentIds: () => ['S1'],
    onPublished: (found, list) => calls.published.push({ found, list }),
    storage,
    now: () => clock.now,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });
  live.add(tracker);
  const history = [];
  tracker.subscribe((items) => history.push(items.map((item) => `${item.name}:${statusText(item)}`)));
  return { tracker, timers, clock, server, calls, history, storage };
}

const states = (tracker) => tracker.items().map((item) => item.state);

describe('gestor de subidas', () => {
  test('pasa y conserva álbum y artista de una playlist al subir sus canciones', async () => {
    const { tracker, calls, storage } = setup();
    const album = { id: 'PLVU-jIOit29A', name: 'Nuestro desacato' };
    tracker.addSources([{
      file: { name: 'Cada vez.wav' },
      name: 'Cada vez.wav',
      title: 'Cada vez',
      album,
    }], { trackArtists: ['Desakato'] });
    await settle();
    assert.deepEqual(calls.send[0].album, album);
    assert.equal(calls.send[0].artist, 'Desakato');
    assert.deepEqual(JSON.parse(storage.getItem(STORAGE_KEY)).items[0].album, album);
    assert.equal(JSON.parse(storage.getItem(STORAGE_KEY)).items[0].artist, 'Desakato');
  });

  test('con el id de contenido lento (CI cargada), settle espera a que la subida quede guardada', async () => {
    // crypto.subtle.digest termina en otro hilo: con el ejecutor cargado tarda lo que tarde. Antes, settle daba un
    // número fijo de vueltas al bucle de eventos y a veces miraba el estado antes de tiempo.
    const subtle = globalThis.crypto.subtle;
    const digest = subtle.digest;
    subtle.digest = async (...args) => {
      await new Promise((resolve) => setTimeout(resolve, 150));
      return digest.apply(subtle, args);
    };
    try {
      const { tracker, calls } = setup();
      tracker.add([{ name: 'Lenta.wav' }], { titleOf: () => 'Lenta' });
      await settle();
      assert.deepEqual(states(tracker), [S.SAVED]);
      assert.equal(calls.send.length, 1);
    } finally {
      // La propia de la instancia tapa la del prototipo: al borrarla vuelve la original.
      delete subtle.digest;
      assert.equal(subtle.digest, digest);
    }
  });

  test('una subida pasa por todos los pasos y se da por publicada solo cuando songs.json trae un id nuevo con su título', async () => {
    const { tracker, timers, clock, server, calls, history, storage } = setup();
    tracker.add([{ name: 'Tono de prueba.wav' }], { titleOf: () => 'Tono de prueba' });
    await settle();
    assert.deepEqual(states(tracker), [S.SAVED]);
    const seen = [...new Set(history.map((items) => items[0]))];
    assert.deepEqual(seen, [
      'Tono de prueba.wav:En cola',
      'Tono de prueba.wav:Convirtiendo a Opus…',
      `Tono de prueba.wav:Subiendo… 0${NBSP}%`,
      `Tono de prueba.wav:Subiendo… 33${NBSP}%`,
      `Tono de prueba.wav:Subiendo… 67${NBSP}%`,
      `Tono de prueba.wav:Subiendo… 100${NBSP}%`,
      'Tono de prueba.wav:Guardada en GitHub',
    ]);
    assert.equal(calls.copies.length, 1, 'la copia local se guarda en cuanto termina la conversión');
    assert.equal(tracker.items()[0].localId, calls.copies[0].id);
    assert.deepEqual(timers.pending(), [SAVED_PAUSE_MS, POLL_MS]);
    assert.ok(JSON.parse(storage.getItem(STORAGE_KEY)).items.length === 1, 'la pendiente se guarda en localStorage');

    timers.run(SAVED_PAUSE_MS);
    assert.deepEqual(states(tracker), [S.PUBLISHING]);

    // Primera comprobación: solo está la canción de antes con el mismo título.
    const fetchesBefore = server.fetches;
    timers.run(POLL_MS);
    await settle();
    assert.equal(server.fetches, fetchesBefore + 1);
    assert.deepEqual(states(tracker), [S.PUBLISHING]);
    assert.deepEqual(timers.pending(), [POLL_MS], 'vuelve a comprobar dentro de 15 s');

    // Aparece la nueva.
    server.songs.push({ id: 'S9', title: 'Tono de prueba' });
    clock.now += POLL_MS;
    timers.run(POLL_MS);
    await settle();
    assert.deepEqual(states(tracker), [S.PUBLISHED]);
    assert.equal(tracker.items()[0].songId, 'S9');
    assert.equal(calls.published.length, 1);
    assert.equal(calls.published[0].found[0].song.id, 'S9');
    assert.equal(calls.published[0].found[0].item.localId, calls.copies[0].id);
    assert.deepEqual(timers.pending(), [], 'deja de comprobar');
    assert.equal(storage.getItem(STORAGE_KEY), null, 'sin pendientes, no queda nada guardado');
    assert.equal(tracker.byLocalId(calls.copies[0].id).state, S.PUBLISHED);
  });

  test('tras 10 minutos sigue comprobando más despacio y reconoce una publicación tardía', async () => {
      const { tracker, timers, clock, server, storage } = setup();
    tracker.add([{ name: 'Lenta.wav' }], { titleOf: () => 'Lenta' });
    await settle();
    timers.run(SAVED_PAUSE_MS);
    for (let elapsed = POLL_MS; elapsed < MAX_WAIT_MS; elapsed += POLL_MS) {
      clock.now += POLL_MS;
      timers.run(POLL_MS);
      await settle();
      assert.deepEqual(states(tracker), [S.PUBLISHING], `a los ${elapsed / 1000} s`);
    }
    clock.now += POLL_MS;
    timers.run(POLL_MS);
    await settle();
    assert.deepEqual(states(tracker), [S.SLOW]);
    assert.equal(statusText(tracker.items()[0]), 'Aún no aparece en la biblioteca; seguiremos comprobando');
    assert.deepEqual(timers.pending(), [SLOW_POLL_MS]);

    server.songs.push({ id: 'S10', title: 'Lenta' });
    clock.now += SLOW_POLL_MS;
    timers.run(SLOW_POLL_MS);
    await settle();
    assert.deepEqual(states(tracker), [S.PUBLISHED]);
    assert.equal(tracker.items()[0].songId, 'S10');
    assert.deepEqual(timers.pending(), []);
    assert.equal(storage.getItem(STORAGE_KEY), null);
  });

  test('una pista duplicada de la misma playlist se reconoce por álbum, título y artista', async () => {
    const playlistId = 'PLVU-jIOit29A';
    const folderId = `F${createHash('sha256').update(`youtube:${playlistId}`).digest('hex').slice(0, 16)}`;
    const existing = { id: 'S9', title: 'Cada vez', artist: 'Desakato', folder_id: folderId };
    const { tracker, calls } = setup({ songs: [existing] });
    tracker.addSources([{
      file: { name: 'Cada vez.wav' },
      name: 'Cada vez.wav',
      title: 'Cada vez',
    }], {
      album: { id: playlistId, name: 'Nuestro desacato' },
      trackArtists: ['Desakato'],
    });
    await settle();
    assert.deepEqual(states(tracker), [S.SAVED]);

    await tracker.checkNow();

    assert.deepEqual(states(tracker), [S.PUBLISHED]);
    assert.equal(tracker.items()[0].songId, 'S9');
    assert.equal(tracker.items()[0].alreadyPresent, true);
    assert.equal(statusText(tracker.items()[0]), 'Ya estaba en la biblioteca');
    assert.equal(calls.published[0].found[0].song.id, 'S9');
  });

  test('un título coincidente no se reconoce como duplicado si cambia el álbum o el artista', async () => {
    const playlistId = 'PLVU-jIOit29A';
    const folderId = `F${createHash('sha256').update(`youtube:${playlistId}`).digest('hex').slice(0, 16)}`;
    const otherFolderId = `F${createHash('sha256').update('youtube:PL-otra-playlist').digest('hex').slice(0, 16)}`;
    const { tracker } = setup({
      songs: [
        { id: 'S8', title: 'Cada vez', artist: 'Desakato', folder_id: otherFolderId },
        { id: 'S9', title: 'Cada vez', artist: 'Otro artista', folder_id: folderId },
      ],
    });
    tracker.addSources([{
      file: { name: 'Cada vez.wav' },
      name: 'Cada vez.wav',
      title: 'Cada vez',
    }], {
      album: { id: playlistId, name: 'Nuestro desacato' },
      trackArtists: ['Desakato'],
    });
    await settle();

    await tracker.checkNow();

    assert.deepEqual(states(tracker), [S.SAVED]);
    assert.equal(tracker.items()[0].songId, null);
  });

  test('un Opus que el buzón ya tenía se reconoce por su id de contenido, aunque cambie el título', async () => {
    const id = await expectedSongId(new Uint8Array([1, 2, 3]));
    assert.match(id, /^S[0-9a-f]{16}$/);
    const { tracker, calls } = setup({ songs: [{ id, title: 'Otro título distinto' }] });
    tracker.add([{ name: 'Tono.wav' }], { titleOf: () => 'Tono' });
    await settle();
    await tracker.checkNow();
    assert.deepEqual(states(tracker), [S.PUBLISHED]);
    assert.equal(tracker.items()[0].songId, id);
    assert.equal(calls.published.length, 1);
  });

  test('al reabrir, una copia local con error cuyo Opus ya está publicado se da por resuelta', async () => {
    const id = await expectedSongId(new Uint8Array([9, 9]));
    const { tracker, calls } = setup({ songs: [{ id, title: 'Sudores Frios' }] });
    tracker.restore({ pendingCopies: [{ id: 'L0000000000000009', title: 'Sudores Frios' }] });
    await settle();
    assert.deepEqual(states(tracker), [S.PUBLISHED]);
    assert.equal(statusText(tracker.items()[0]), 'Ya estaba en la biblioteca');
    assert.equal(calls.published[0].found[0].item.localId, 'L0000000000000009');
  });

  test('al reabrir, una copia local con error cuyo Opus no está publicado sigue con Reintentar', async () => {
    const { tracker } = setup();
    tracker.restore({ pendingCopies: [{ id: 'L0000000000000009', title: 'Sudores Frios' }] });
    await settle();
    assert.deepEqual(states(tracker), [S.ERROR]);
  });

  test('sin red, una comprobación fallida no rompe nada: se vuelve a intentar', async () => {
    const { tracker, timers, server } = setup();
    tracker.add([{ name: 'Tono.wav' }], { titleOf: () => 'Tono' });
    await settle();
    server.fail = true;
    timers.run(POLL_MS);
    await settle();
    assert.deepEqual(states(tracker), [S.SAVED]);
    assert.ok(timers.pending().includes(POLL_MS));
    server.fail = false;
    server.songs.push({ id: 'S5', title: 'Tono' });
    timers.run(POLL_MS);
    await settle();
    assert.deepEqual(states(tracker), [S.PUBLISHED]);
  });

  test('un error del servidor queda en su fila con el motivo; «Reintentar» vuelve a enviar sin convertir otra vez', async () => {
    let attempts = 0;
    const sent = [];
    const { tracker, calls } = setup({
      send: async (bytes, { fileName, onChunk }) => {
        attempts += 1;
        sent.push([...bytes]);
        if (attempts === 1) throw new FakeUploadError('GitHub no ha aceptado la subida. Inténtalo de nuevo en un momento.');
        onChunk({ index: 0, total: 1 });
        return { nombre: `${fileName}.opus` };
      },
    });
    tracker.add([{ name: 'Falla.wav' }], { titleOf: () => 'Falla' });
    await settle();
    const [failed] = tracker.items();
    assert.equal(failed.state, S.ERROR);
    assert.equal(statusText(failed), 'Error: GitHub no ha aceptado la subida. Inténtalo de nuevo en un momento.');
    assert.equal(failed.retryable, true);
    assert.equal(tracker.retry(failed.key), true);
    await settle();
    assert.deepEqual(states(tracker), [S.SAVED]);
    assert.equal(calls.convert, 1, 'no se vuelve a convertir');
    assert.equal(calls.copies.length, 1, 'ni se guarda otra copia');
    assert.deepEqual(sent[1], sent[0], 'se reenvían los mismos bytes');
    assert.equal(tracker.retry(failed.key), false, 'lo que no es un error no se reintenta');
  });

  test('un fallo inesperado da un mensaje genérico y un fallo de configuración del servidor para los demás', async () => {
    const errors = console.error;
    console.error = () => {};
    try {
      let n = 0;
      const { tracker } = setup({
        send: async () => {
          n += 1;
          if (n === 1) throw new TypeError('raro');
          throw new FakeUploadError('La subida no está configurada en el servidor.', { stop: true });
        },
      });
      tracker.add([{ name: 'a.wav' }, { name: 'b.wav' }, { name: 'c.wav' }], { titleOf: (file) => file.name });
      await settle();
      assert.deepEqual(tracker.items().map((item) => [item.name, item.state, item.error]), [
        ['a.wav', S.ERROR, 'No se ha podido subir este archivo.'],
        ['b.wav', S.ERROR, 'La subida no está configurada en el servidor.'],
        ['c.wav', S.ERROR, 'La subida no está configurada en el servidor.'],
      ]);
      assert.equal(n, 2, 'c no se llega a enviar');
    } finally {
      console.error = errors;
    }
  });

  test('varias subidas, de una en una y en orden; con el mismo título, cada una reconoce una canción distinta', async () => {
    const order = [];
    const { tracker, timers, server } = setup({
      send: async (bytes, { fileName, onChunk }) => {
        order.push(`inicio ${fileName}`);
        await new Promise((resolve) => setImmediate(resolve));
        onChunk({ index: 0, total: 1 });
        order.push(`fin ${fileName}`);
        return { nombre: 'Tono de prueba.opus' };
      },
    });
    tracker.add([{ name: 'Tono de prueba.wav' }, { name: 'Tono de prueba.mp3' }], { titleOf: () => 'Tono de prueba' });
    await settle();
    assert.deepEqual(order, ['inicio Tono de prueba.wav', 'fin Tono de prueba.wav', 'inicio Tono de prueba.mp3', 'fin Tono de prueba.mp3']);
    server.songs.push({ id: 'S8', title: 'Tono de prueba' }, { id: 'S9', title: 'Tono de prueba' });
    timers.run(POLL_MS);
    await settle();
    assert.deepEqual(tracker.items().map((item) => item.songId), ['S8', 'S9']);
  });

  test('al volver a abrir la página sigue comprobando las pendientes y ofrece reintentar las interrumpidas', async () => {
    const storage = fakeStorage();
    const first = setup({ storage });
    first.tracker.add([{ name: 'Tono.wav' }], { titleOf: () => 'Tono' });
    await settle();
    first.tracker.dispose();

    const second = setup({ storage, songs: [{ id: 'S1', title: 'Tono de prueba' }, { id: 'S6', title: 'Tono' }] });
    second.tracker.restore({ pendingCopies: [{ id: 'L00000000000000ff', title: 'Huérfana', createdAt: 3 }] });
    await settle();
    assert.deepEqual(second.tracker.items().map((item) => [item.name, item.state]), [
      ['Tono.wav', S.PUBLISHED],
      ['Huérfana', S.ERROR],
    ]);
    assert.equal(second.tracker.items()[0].songId, 'S6');
    assert.equal(second.tracker.items()[1].error, INTERRUPTED_TEXT);
    assert.equal(second.calls.published.length, 1);
    // La interrumpida se reenvía desde su copia local (sin archivo).
    assert.equal(second.tracker.retry(second.tracker.items()[1].key), true);
    await settle();
    assert.equal(second.tracker.items()[1].state, S.SAVED);
    assert.deepEqual(second.calls.send.at(-1).bytes, [9, 9]);
  });

  test('con localStorage bloqueado, las subidas siguen igual', async () => {
    const blocked = {
      getItem() { throw new Error('bloqueado'); },
      setItem() { throw new Error('bloqueado'); },
      removeItem() { throw new Error('bloqueado'); },
    };
    const { tracker } = setup({ storage: blocked });
    tracker.restore();
    tracker.add([{ name: 'Tono.wav' }], { titleOf: () => 'Tono' });
    await settle();
    assert.deepEqual(states(tracker), [S.SAVED]);
  });

  test('busy dice si hay archivos convirtiéndose o subiéndose', async () => {
    let release;
    let sending;
    const started = new Promise((resolve) => { sending = resolve; });
    const { tracker } = setup({ send: () => new Promise((resolve) => { release = resolve; sending(); }) });
    assert.equal(tracker.busy(), false);
    tracker.add([{ name: 'a.wav' }], { titleOf: () => 'a' });
    // El envío queda colgado hasta release(): settle() esperaría para siempre. Basta con que haya empezado.
    await started;
    assert.equal(tracker.busy(), true);
    release({ nombre: 'a.opus' });
    await settle();
    assert.equal(tracker.busy(), false);
  });
});
