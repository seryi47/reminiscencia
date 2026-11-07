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
  MAX_CONVERTED_WAITING,
  MAX_PARALLEL_SENDS,
  MAX_WAIT_MS,
  normalizeTitle,
  orderedUploadIds,
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
import { sendOpus } from '../../frontend/web/js/cuidador/subida-publica.js';

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
      // Convertida, a la espera de hueco para enviarse (ADR-0030 y ADR-0033).
      'Esperando para subir',
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
    // En cola no hay nada que medir; enviándose sin ningún trozo confirmado, la barra se mueve sin porcentaje y el texto
    // no se queda en «0 %» (ADR-0033).
    assert.deepEqual(progressOf({ ...base, state: S.QUEUED }), { value: null, hidden: true });
    assert.deepEqual(progressOf({ ...base, state: S.SENDING, fraction: 0 }), { value: null, hidden: false });
    assert.equal(statusText({ ...base, state: S.SENDING, fraction: 0 }), 'Subiendo…');
    assert.deepEqual(progressOf({ ...base, state: S.CONVERTING, fraction: 0.5 }), { value: 50, hidden: false });
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
    send: send ?? (async (bytes, { fileName, uploadId, album, artist, onChunk }) => {
      calls.send.push({ fileName, uploadId, bytes: [...bytes], album, artist });
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
      'Tono de prueba.wav:Esperando para subir',
      'Tono de prueba.wav:Subiendo…',
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

  test('varias subidas se envían a la vez, la lista conserva su orden y, con el mismo título, cada una reconoce una canción distinta', async () => {
    const order = [];
    const releases = new Map();
    let bothStarted;
    const started = new Promise((resolve) => { bothStarted = resolve; });
    const { tracker, timers, server } = setup({
      send: (bytes, { fileName, onChunk }) => new Promise((resolve) => {
        order.push(`inicio ${fileName}`);
        releases.set(fileName, () => {
          onChunk({ index: 0, total: 1 });
          order.push(`fin ${fileName}`);
          resolve({ nombre: 'Tono de prueba.opus' });
        });
        if (releases.size === 2) bothStarted();
      }),
    });
    tracker.add([{ name: 'Tono de prueba.wav' }, { name: 'Tono de prueba.mp3' }], { titleOf: () => 'Tono de prueba' });
    await started;
    // La segunda termina antes que la primera.
    releases.get('Tono de prueba.mp3')();
    releases.get('Tono de prueba.wav')();
    await settle();
    assert.deepEqual(order, ['inicio Tono de prueba.wav', 'inicio Tono de prueba.mp3', 'fin Tono de prueba.mp3', 'fin Tono de prueba.wav']);
    assert.deepEqual(tracker.items().map((item) => item.name), ['Tono de prueba.wav', 'Tono de prueba.mp3']);
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

// --- Canalización (ADR-0030) ----------------------------------------------------------------------------------------

/** Una promesa que se resuelve desde fuera. */
function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

/** Espera, sin tiempos fijos, a que el gestor cumpla una condición: se comprueba con cada cambio que emite. */
function until(tracker, predicate) {
  if (predicate(tracker.items())) return Promise.resolve();
  return new Promise((resolve) => {
    const stop = tracker.subscribe((items) => {
      if (predicate(items)) {
        stop();
        resolve();
      }
    });
  });
}

/**
 * fetch simulado de /api/subir: cada petición queda pendiente hasta que la prueba la responde. Valida, como la función
 * real, que los trozos de cada subida llegan en orden, y lleva la cuenta de cuántas peticiones hay a la vez.
 */
function heldFetch() {
  const pending = [];
  const waiters = [];
  const seen = new Map(); // uploadId → trozos recibidos
  const state = { inFlight: 0, maxInFlight: 0, requests: [] };
  const fetchImpl = (url, { headers, body }) => {
    const uploadId = headers['X-Subida-Id'];
    const index = Number(headers['X-Parte']);
    const parts = Number(headers['X-Partes']);
    assert.equal(url, '/api/subir');
    assert.equal(index, seen.get(uploadId) ?? 0, 'los trozos de un archivo van en orden');
    seen.set(uploadId, index + 1);
    state.inFlight += 1;
    state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
    const request = { uploadId, index, parts, name: decodeURIComponent(headers['X-Nombre-Archivo']), size: body.length };
    state.requests.push(request);
    return new Promise((resolve) => {
      request.reply = (response) => {
        state.inFlight -= 1;
        resolve(response);
      };
      request.respond = () => request.reply({
        ok: true,
        status: 200,
        json: async () => ({ ok: true, parte: index, partes: parts, completa: index === parts - 1, nombre: request.name.replace(/\.[^.]*$/, '.opus') }),
      });
      const waiter = waiters.shift();
      if (waiter) waiter(request);
      else pending.push(request);
    });
  };
  /** La siguiente petición que llega (o la primera que espera respuesta). */
  const next = () => (pending.length > 0 ? Promise.resolve(pending.shift()) : new Promise((resolve) => waiters.push(resolve)));
  return { fetchImpl, next, state, waiting: () => pending.length };
}

function pipelineSetup({ files = 4, chunkBytes = 2 } = {}) {
  const net = heldFetch();
  const conversions = [];
  const converting = [];
  const { tracker, calls } = setup({
    convert: async (file, { onProgress }) => {
      conversions.push(file.name);
      converting.push(file.name);
      onProgress({ fraction: 1 });
      converting.splice(converting.indexOf(file.name), 1);
      return { bytes: new Uint8Array([1, 2, 3, conversions.length]), durationS: 1, channels: 1, bitrate: 32000 };
    },
    send: (bytes, { fileName, uploadId, album, artist, onChunk }) => {
      calls.send.push({ fileName, uploadId });
      return sendOpus(bytes, { fileName, uploadId, album, artist, onChunk, fetchImpl: net.fetchImpl, chunkBytes });
    },
  });
  const names = Array.from({ length: files }, (_, index) => `Pista ${index + 1}.wav`);
  tracker.add(names.map((name) => ({ name })), { titleOf: (file) => file.name.replace(/\.wav$/, '') });
  return { tracker, calls, net, conversions, names };
}

describe('canalización de las subidas (ADR-0030)', () => {
  test('los límites son dos envíos a la vez y un archivo convertido esperando', () => {
    assert.equal(MAX_PARALLEL_SENDS, 2);
    assert.equal(MAX_CONVERTED_WAITING, 1);
  });

  test('el archivo siguiente se convierte mientras se envía el anterior', async () => {
    const { tracker, net, conversions } = pipelineSetup({ files: 2 });
    const first = await net.next();
    assert.equal(first.name, 'Pista 1.wav');
    // El trozo 0 del primero sigue sin respuesta, y el segundo ya está convertido y enviándose.
    await until(tracker, (items) => items[1].state === S.SENDING);
    assert.deepEqual(conversions, ['Pista 1.wav', 'Pista 2.wav']);
    const second = await net.next();
    assert.equal(second.name, 'Pista 2.wav');
    assert.equal(net.state.inFlight, 2);
    for (const request of [first, second]) request.respond();
    for (let index = 0; index < 2; index += 1) (await net.next()).respond();
    await settle();
    assert.deepEqual(states(tracker), [S.SAVED, S.SAVED]);
  });

  test('como mucho dos archivos se envían a la vez y uno convertido espera: la conversión no se adelanta más', async () => {
    const { tracker, net, conversions, calls } = pipelineSetup({ files: 4 });
    const first = await net.next();
    const second = await net.next();
    // La tercera ya está convertida, esperando hueco; la cuarta, en cola sin convertir.
    await until(tracker, (items) => items[2].state === S.SENDING);
    assert.deepEqual(states(tracker), [S.SENDING, S.SENDING, S.SENDING, S.QUEUED]);
    assert.deepEqual(conversions, ['Pista 1.wav', 'Pista 2.wav', 'Pista 3.wav']);
    assert.equal(net.waiting(), 0, 'no hay una tercera petición');
    assert.equal(calls.send.length, 2);
    // La convertida que espera hueco no dice «Subiendo…» ni mueve la barra: aún no se envía (ADR-0033).
    assert.equal(statusText(tracker.items()[2]), 'Esperando para subir');
    assert.deepEqual(progressOf(tracker.items()[2]), { value: null, hidden: true });
    assert.equal(statusText(tracker.items()[0]), 'Subiendo…');
    assert.equal(tracker.busy(), true);

    // La segunda termina antes que la primera: entra la tercera y empieza a convertirse la cuarta.
    second.respond();
    const secondTail = await net.next();
    assert.deepEqual([secondTail.name, secondTail.index], ['Pista 2.wav', 1]);
    secondTail.respond();
    const third = await net.next();
    assert.deepEqual([third.name, third.index], ['Pista 3.wav', 0]);
    await until(tracker, (items) => items[3].state === S.SENDING);
    assert.deepEqual(conversions, ['Pista 1.wav', 'Pista 2.wav', 'Pista 3.wav', 'Pista 4.wav']);
    assert.equal(net.waiting(), 0);

    // Se responde todo lo que quede, por orden de llegada.
    first.respond();
    third.respond();
    for (let index = 0; index < 4; index += 1) (await net.next()).respond();
    await settle();
    assert.deepEqual(states(tracker), [S.SAVED, S.SAVED, S.SAVED, S.SAVED]);
    assert.equal(net.state.maxInFlight, 2);
    assert.deepEqual(tracker.items().map((item) => item.name), ['Pista 1.wav', 'Pista 2.wav', 'Pista 3.wav', 'Pista 4.wav']);
    // Cada subida, su UUID v7; ordenados como la cola aunque terminaran en otro orden.
    const ids = calls.send.map((call) => call.uploadId);
    assert.deepEqual(calls.send.map((call) => call.fileName), ['Pista 1.wav', 'Pista 2.wav', 'Pista 3.wav', 'Pista 4.wav']);
    for (const id of ids) assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.deepEqual([...ids].sort(), ids);
    assert.equal(new Set(ids).size, 4);
    for (const id of ids) {
      assert.deepEqual(net.state.requests.filter((request) => request.uploadId === id).map((request) => request.index), [0, 1]);
    }
  });

  test('un fallo del servidor que para la cola falla la convertida que espera y las de la cola; la que se envía termina sola', async () => {
    const net = heldFetch();
    const { tracker, calls } = setup({
      send: (bytes, { fileName, uploadId, onChunk }) => {
        calls.send.push({ fileName, uploadId });
        return sendOpus(bytes, { fileName, uploadId, onChunk, fetchImpl: net.fetchImpl });
      },
    });
    tracker.add([{ name: 'a.wav' }, { name: 'b.wav' }, { name: 'c.wav' }, { name: 'd.wav' }], { titleOf: (file) => file.name });
    const first = await net.next();
    const second = await net.next();
    await until(tracker, (items) => items[2].state === S.SENDING);
    // b: la función no está configurada (500). Los demás fallarían igual.
    second.reply({ ok: false, status: 500, json: async () => ({ ok: false, error: 'La subida no está configurada en el servidor.' }) });
    await until(tracker, (items) => items[1].state === S.ERROR);
    assert.deepEqual(states(tracker), [S.SENDING, S.ERROR, S.ERROR, S.ERROR]);
    assert.equal(calls.convert, 3, 'd no se llega a convertir');
    first.respond();
    await settle();
    assert.deepEqual(tracker.items().map((item) => [item.name, item.state, item.error]), [
      ['a.wav', S.SAVED, null],
      ['b.wav', S.ERROR, 'La subida no está configurada en el servidor.'],
      ['c.wav', S.ERROR, 'La subida no está configurada en el servidor.'],
      ['d.wav', S.ERROR, 'La subida no está configurada en el servidor.'],
    ]);
    assert.deepEqual(net.state.requests.map((request) => request.name), ['a.wav', 'b.wav']);
    // «Reintentar» en c la envía con lo ya convertido, sin convertir otra vez.
    assert.equal(tracker.retry(tracker.items()[2].key), true);
    (await net.next()).respond();
    await settle();
    assert.equal(tracker.items()[2].state, S.SAVED);
    assert.equal(calls.convert, 3);
  });
});

describe('identificadores de subida en orden (UUID v7, ADR-0030)', () => {
  const V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

  test('llevan el milisegundo delante y crecen aunque coincida el milisegundo o el reloj vaya hacia atrás', () => {
    const clock = { now: 0x019a5b2c3d4e };
    const next = orderedUploadIds({ now: () => clock.now, randomBytes: (size) => new Uint8Array(size).fill(0xff) });
    const first = next();
    assert.equal(first, '019a5b2c-3d4e-7000-bfff-ffffffffffff');
    const second = next();
    assert.equal(second, '019a5b2c-3d4e-7001-bfff-ffffffffffff');
    clock.now -= 5_000;
    const third = next();
    assert.equal(third, '019a5b2c-3d4e-7002-bfff-ffffffffffff');
    clock.now += 10_000;
    const fourth = next();
    assert.equal(fourth.slice(0, 18), (0x019a5b2c3d4e + 5_000).toString(16).padStart(12, '0').replace(/^(.{8})/, '$1-') + '-7000');
    assert.deepEqual([first, second, third, fourth].sort(), [first, second, third, fourth]);
  });

  test('con más de 4096 en el mismo milisegundo pasan al siguiente sin repetirse', () => {
    const next = orderedUploadIds({ now: () => 1_000, randomBytes: (size) => new Uint8Array(size) });
    const ids = Array.from({ length: 4100 }, () => next());
    for (const id of ids.slice(0, 3)) assert.match(id, V7);
    assert.equal(new Set(ids).size, ids.length);
    assert.deepEqual([...ids].sort(), ids);
    assert.equal(ids[4096].slice(0, 13), '00000000-03e9');
  });

  test('con el azar real cumplen el formato y no se repiten', () => {
    const next = orderedUploadIds();
    const ids = Array.from({ length: 200 }, () => next());
    for (const id of ids) assert.match(id, V7);
    assert.equal(new Set(ids).size, 200);
  });
});
