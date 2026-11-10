// Pruebas de las ediciones pendientes (frontend/web/js/edit-pending.js; ADR-0027): el contrato común con la APK
// (tests/contrato/ediciones-pendientes.json), la persistencia, el gestor (envío, duplicados, sustitución, revisión con
// espera creciente, confirmación, fallo, reintento y sin conexión) y fetchEditStatus. Sin red ni DOM.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

import {
  applyPendingEdits,
  checkDelayMs,
  CHECK_DELAYS_S,
  CLOSED_GRACE_MS,
  confirmedText,
  COVER_ASSUME_MS,
  COVER_KEY_CHECK_MS,
  createEditTracker,
  describeEdit,
  duplicateText,
  failedText,
  indicatorText,
  isDuplicateEdit,
  isEditReflected,
  MAX_PENDING_MS,
  MAX_STORED_PREVIEW_CHARS,
  parseEdits,
  reviewEdit,
  serializeEdits,
  STORAGE_KEY,
  supersedesEdit,
} from '../../frontend/web/js/edit-pending.js';
import { fetchEditStatus, sendCover, sendOrganize } from '../../frontend/web/js/edit-remote.js';

const contrato = JSON.parse(readFileSync(new URL('../contrato/ediciones-pendientes.json', import.meta.url), 'utf8'));
const MIN = 60_000;

/** Catálogo base del contrato con los «cambios» aplicados (campos sustituidos tal cual) y los álbumes nuevos. */
function patched({ canciones = {}, albumes = {}, albumesNuevos = [] } = {}) {
  const songs = contrato.catalogo.songs.map((song) => (canciones[song.id] ? { ...song, ...canciones[song.id] } : { ...song }));
  const folders = contrato.catalogo.folders.map((folder) => (albumes[folder.id] ? { ...folder, ...albumes[folder.id] } : { ...folder }));
  return { songs, folders: [...folders, ...albumesNuevos] };
}

describe('contrato común (tests/contrato/ediciones-pendientes.json)', () => {
  test('constantes', () => {
    assert.deepEqual([...CHECK_DELAYS_S], contrato.constantes.esperasSegundos);
    assert.equal(MAX_PENDING_MS, contrato.constantes.maxPendienteMin * MIN);
    assert.equal(CLOSED_GRACE_MS, contrato.constantes.graciaCerradaMin * MIN);
    assert.equal(COVER_ASSUME_MS, contrato.constantes.portadaSupuestaMin * MIN);
  });

  for (const caso of contrato.aplicar) {
    test(`aplicar: ${caso.nombre}`, () => {
      const { songs, folders } = contrato.catalogo;
      const before = JSON.stringify({ songs, folders });
      const view = applyPendingEdits(songs, folders, caso.ediciones);
      assert.equal(JSON.stringify({ songs, folders }), before, 'El catálogo real no cambia.');
      for (const [id, fields] of Object.entries(caso.canciones ?? {})) {
        const song = view.songs.find((item) => item.id === id);
        assert.ok(song, id);
        for (const [field, value] of Object.entries(fields)) assert.deepEqual(song[field] ?? null, value, `${id}.${field}`);
      }
      for (const [id, fields] of Object.entries(caso.albumes ?? {})) {
        const folder = view.folders.find((item) => item.id === id);
        assert.ok(folder, id);
        for (const [field, value] of Object.entries(fields)) assert.deepEqual(folder[field] ?? '', value, `${id}.${field}`);
      }
      if (caso.totalAlbumes !== undefined) assert.equal(view.folders.length, caso.totalAlbumes);
      assert.deepEqual([...view.songIds].sort(), [...caso.marcadas.canciones].sort());
      assert.deepEqual([...view.folderIds].sort(), [...caso.marcadas.albumes].sort());
    });
  }

  for (const caso of contrato.reflejada) {
    test(`reflejada: ${caso.nombre}`, () => {
      const { songs, folders } = patched(caso.cambios);
      assert.equal(isEditReflected(caso.edicion, songs, folders), caso.esperado);
    });
  }

  test('unpublish_song: quita la canción al instante y se confirma cuando ya no está (ADR-0041)', () => {
    const songs = [
      { id: 'S0000000000000001', title: 'Uno', folder_id: null },
      { id: 'S0000000000000002', title: 'Dos', folder_id: null },
    ];
    const edit = { kind: 'organize', payload: { op: 'unpublish_song', song_id: 'S0000000000000001' }, state: 'pendiente' };
    const view = applyPendingEdits(songs, [], [edit]);
    assert.ok(!view.songs.some((s) => s.id === 'S0000000000000001'), 'la eliminada desaparece al instante');
    assert.ok(view.songs.some((s) => s.id === 'S0000000000000002'), 'las demás siguen');
    assert.deepEqual([...view.songIds], [], 'una eliminada no se marca como «Pendiente», desaparece');
    assert.equal(isEditReflected(edit, songs, []), false, 'sigue en el catálogo → no reflejada');
    assert.equal(isEditReflected(edit, songs.filter((s) => s.id !== 'S0000000000000001'), []), true, 'ya no está → reflejada');
  });

  for (const caso of contrato.duplicado) {
    test(`duplicado: ${caso.nombre}`, () => {
      assert.equal(isDuplicateEdit(caso.a, caso.b), caso.igual);
      assert.equal(isDuplicateEdit(caso.b, caso.a), caso.igual);
    });
  }

  for (const caso of contrato.sustituye) {
    test(`sustituye: ${caso.nombre}`, () => {
      assert.equal(supersedesEdit(caso.nueva, caso.anterior), caso.esperado);
    });
  }

  for (const caso of contrato.revisar) {
    test(`revisar: ${caso.nombre}`, () => {
      const { edicion } = caso;
      const edit = {
        kind: edicion.kind,
        issue: edicion.issue,
        createdAt: edicion.createdAtMin * MIN,
        closedAt: edicion.closedAtMin === null ? null : edicion.closedAtMin * MIN,
        hadCover: edicion.hadCover,
        ...(edicion.coverKey ? { coverKey: edicion.coverKey } : {}),
      };
      const result = reviewEdit(edit, { now: caso.ahoraMin * MIN, status: caso.estado, reflected: caso.reflejada, catalogOk: caso.catalogoOk });
      assert.equal(result.outcome, caso.esperado);
      if (caso.esperado === 'pendiente') assert.equal(result.closedAt, caso.closedAtMin === null ? null : caso.closedAtMin * MIN);
    });
  }
});

describe('textos y espera', () => {
  test('mensajes', () => {
    assert.equal(failedText('Charleston'), 'No se ha podido guardar «Charleston». Inténtalo de nuevo.');
    assert.equal(duplicateText('Charleston'), 'Ya está pendiente: «Charleston».');
    assert.equal(confirmedText('Charleston'), 'Ya está guardado: «Charleston».');
  });

  test('describeEdit da el nombre de lo editado y qué se hizo', () => {
    const { songs, folders } = contrato.catalogo;
    const S1 = songs[0].id;
    const F1 = folders[0].id;
    const F2 = folders[1].id;
    assert.deepEqual(describeEdit({ op: 'edit_song', song_id: S1, title: ' Nuevo ', artist: 'A' }, songs, folders), { label: 'Nuevo', action: 'Detalles de la canción' });
    assert.deepEqual(describeEdit({ op: 'edit_song', song_id: S1, folder_id: F2 }, songs, folders), { label: 'Uno', action: 'Añadir a «Álbum B»' });
    assert.deepEqual(describeEdit({ op: 'edit_song', song_id: S1, folder_id: null }, songs, folders), { label: 'Uno', action: 'Quitar del álbum' });
    assert.deepEqual(describeEdit({ op: 'move_songs', song_ids: [S1, songs[1].id], folder_id: F2 }, songs, folders), { label: '2 canciones', action: 'Mover a «Álbum B»' });
    assert.deepEqual(describeEdit({ op: 'move_songs', song_ids: [S1], folder_id: null }, songs, folders), { label: 'Uno', action: 'Quitar del álbum' });
    assert.deepEqual(describeEdit({ op: 'order_album', folder_id: F1, song_ids: [S1] }, songs, folders), { label: 'Álbum A', action: 'Orden de las canciones' });
    assert.deepEqual(describeEdit({ op: 'edit_folder', folder_id: F1, artist: 'X' }, songs, folders), { label: 'Álbum A', action: 'Detalles del álbum' });
    assert.deepEqual(describeEdit({ op: 'create_folder', name: 'Valses' }, songs, folders), { label: 'Valses', action: 'Álbum nuevo' });
  });

  test('indicador de Tu biblioteca', () => {
    assert.equal(indicatorText([]), null);
    assert.equal(indicatorText([{ state: 'pendiente' }]), '1 cambio pendiente');
    assert.equal(indicatorText([{ state: 'pendiente' }, { state: 'pendiente' }]), '2 cambios pendientes');
    assert.equal(indicatorText([{ state: 'pendiente' }, { state: 'error' }]), 'No se ha podido guardar 1 cambio');
    assert.equal(indicatorText([{ state: 'error' }, { state: 'error' }]), 'No se ha podido guardar 2 cambios');
  });

  test('espera creciente con tope', () => {
    assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7, 20].map(checkDelayMs), [20, 30, 45, 60, 90, 120, 180, 180, 180].map((s) => s * 1000));
  });
});

describe('persistencia', () => {
  const edit = {
    key: 'e1', kind: 'organize', payload: { op: 'edit_song', song_id: 'S0000000000000001', title: 'X' }, issue: 7, label: 'X',
    action: 'Detalles de la canción', createdAt: 1000, closedAt: null, state: 'pendiente', error: null,
  };

  test('ida y vuelta', () => {
    const cover = { key: 'e2', kind: 'cover', targetId: 'S0000000000000002', hadCover: true, preview: 'data:image/jpeg;base64,/9j/2Q==', issue: null, label: 'Dos', action: 'Portada nueva', createdAt: 5, closedAt: 9, state: 'error', error: 'Mal' };
    assert.deepEqual(parseEdits(serializeEdits([edit, cover])), [edit, cover]);
  });

  test('lo que no vale se descarta y nunca lanza', () => {
    assert.deepEqual(parseEdits('{no'), []);
    assert.deepEqual(parseEdits(null), []);
    assert.deepEqual(parseEdits(JSON.stringify({ version: 99, items: [edit] })), []);
    const raros = [{ ...edit, key: '' }, { ...edit, createdAt: 'ayer' }, { ...edit, payload: null }, { key: 'c', kind: 'cover', targetId: '../x', createdAt: 1 }, 7, null];
    assert.deepEqual(parseEdits(JSON.stringify({ version: 1, items: raros })), []);
    const [limpia] = parseEdits(JSON.stringify({ version: 1, items: [{ key: 'c', kind: 'cover', targetId: 'F0000000000000001', createdAt: 1, preview: 'javascript:alert(1)', issue: -3 }] }));
    assert.equal(limpia.preview, null);
    assert.equal(limpia.issue, null);
  });

  test('una vista previa demasiado grande no se guarda (la edición sí)', () => {
    const big = `data:image/jpeg;base64,${'A'.repeat(MAX_STORED_PREVIEW_CHARS)}`;
    const [stored] = JSON.parse(serializeEdits([{ ...edit, kind: 'cover', targetId: 'S0000000000000001', preview: big }])).items;
    assert.equal(stored.preview, undefined);
    assert.equal(stored.targetId, 'S0000000000000001');
  });
});

// ---------------------------------------------------------------------------------------------
// Gestor con dependencias falsas
// ---------------------------------------------------------------------------------------------

function memoryStorage() {
  const data = new Map();
  return {
    data,
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
  };
}

function harness({ storage = memoryStorage(), songs, folders } = {}) {
  const base = structuredClone(contrato.catalogo);
  const world = {
    clock: 0,
    catalog: { songs: songs ?? base.songs, folders: folders ?? base.folders },
    published: null, // catálogo que devuelve la red; null: sin conexión
    statuses: new Map(),
    sent: [],
    covers: [],
    notices: [],
    timers: [],
    issue: 100,
    sendError: null,
  };
  const tracker = createEditTracker({
    sendOrganize: async (payload) => {
      if (world.sendError) throw new Error(world.sendError);
      world.sent.push(payload);
      world.issue += 1;
      return { message: 'Guardado: llegará a todos en un par de minutos.', issue: world.issue };
    },
    sendCover: async (id, bytes) => {
      world.covers.push({ id, bytes });
      return { message: 'Guardado: llegará a todos en un par de minutos.', issue: null, ...(world.coverKey ? { cover: world.coverKey(id) } : {}) };
    },
    fetchStatus: async (issue) => {
      if (!world.statuses.has(issue)) throw new Error('sin conexión');
      return world.statuses.get(issue);
    },
    fetchCatalog: async () => {
      if (!world.published) throw new Error('sin conexión');
      return structuredClone(world.published);
    },
    catalog: () => world.catalog,
    previewBytes: () => new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
    onCatalog: (s, f) => { world.catalog = { songs: s, folders: f }; },
    onNotice: (notice) => world.notices.push(notice),
    storage,
    now: () => world.clock,
    setTimer: (fn, ms) => { const timer = { fn, ms, cleared: false }; world.timers.push(timer); return timer; },
    clearTimer: (timer) => { if (timer) timer.cleared = true; },
    newKey: (() => { let n = 0; return () => `e${(n += 1)}`; })(),
  });
  const pendingTimers = () => world.timers.filter((timer) => !timer.cleared);
  return { tracker, world, storage, pendingTimers };
}

const S1 = 'S0000000000000001';
const S4 = 'S0000000000000004';
const F1 = 'F0000000000000001';
const F2 = 'F0000000000000002';

describe('gestor', () => {
  test('al enviar, queda pendiente con su incidencia, se guarda y se revisa a los 20 s', async () => {
    const { tracker, world, storage, pendingTimers } = harness();
    const message = await tracker.submit({ op: 'edit_song', song_id: S1, title: 'Uno nuevo', artist: 'Artista' });
    assert.equal(message, 'Guardado: llegará a todos en un par de minutos.');
    const [item] = tracker.items();
    assert.deepEqual([item.state, item.issue, item.label, item.action], ['pendiente', 101, 'Uno nuevo', 'Detalles de la canción']);
    assert.ok(storage.data.get(STORAGE_KEY).includes('Uno nuevo'));
    assert.deepEqual(pendingTimers().map((timer) => timer.ms), [20_000]);
    const view = applyPendingEdits(world.catalog.songs, world.catalog.folders, tracker.items());
    assert.equal(view.songs.find((song) => song.id === S1).title, 'Uno nuevo');
  });

  test('si el envío falla, no queda nada pendiente y se lanza el motivo', async () => {
    const { tracker, world } = harness();
    world.sendError = 'El servidor no tiene permiso.';
    await assert.rejects(tracker.submit({ op: 'edit_song', song_id: S1, title: 'X' }), /no tiene permiso/);
    assert.deepEqual(tracker.items(), []);
  });

  test('una edición igual a otra pendiente no se reenvía: «Ya está pendiente»', async () => {
    const { tracker, world } = harness();
    await tracker.submit({ op: 'edit_song', song_id: S1, title: 'X', artist: 'Y' });
    const message = await tracker.submit({ artist: 'Y', title: 'X', song_id: S1, op: 'edit_song' });
    assert.equal(message, 'Ya está pendiente: «X».');
    assert.equal(world.sent.length, 1);
    assert.equal(tracker.items().length, 1);
  });

  test('una edición que cambia todo lo de otra pendiente la sustituye', async () => {
    const { tracker, world } = harness();
    await tracker.submit({ op: 'edit_song', song_id: S1, title: 'X', artist: 'A' });
    await tracker.submit({ op: 'edit_song', song_id: S1, title: 'Y', artist: 'A' });
    assert.equal(world.sent.length, 2);
    assert.deepEqual(tracker.items().map((item) => item.payload.title), ['Y']);
  });

  test('pendiente → confirmada cuando el catálogo la refleja (aviso y fuera de la lista)', async () => {
    const { tracker, world, pendingTimers } = harness();
    await tracker.submit({ op: 'edit_song', song_id: S1, title: 'Uno nuevo' });
    world.published = structuredClone(world.catalog);
    world.statuses.set(101, 'abierta');
    world.clock = 20_000;
    await tracker.check();
    assert.equal(tracker.items().length, 1, 'Aún no está en el catálogo.');
    assert.deepEqual(pendingTimers().map((timer) => timer.ms), [30_000], 'Segunda revisión a los 30 s.');
    world.published.songs = world.published.songs.map((song) => (song.id === S1 ? { ...song, title: 'Uno nuevo' } : song));
    world.clock = 50_000;
    await tracker.check();
    assert.deepEqual(tracker.items(), []);
    assert.deepEqual(world.notices.map((notice) => [notice.type, notice.text]), [['confirmed', 'Ya está guardado: «Uno nuevo».']]);
    assert.equal(world.catalog.songs.find((song) => song.id === S1).title, 'Uno nuevo', 'La app recibe el catálogo nuevo.');
    assert.deepEqual(pendingTimers(), [], 'Sin pendientes no se revisa más.');
  });

  test('pendiente → error: se marca fallida, deja de aplicarse y se avisa; «Reintentar» la reenvía', async () => {
    const { tracker, world } = harness();
    await tracker.submit({ op: 'edit_song', song_id: S1, title: 'Uno nuevo' });
    world.published = structuredClone(world.catalog);
    world.statuses.set(101, 'error');
    world.clock = 20_000;
    await tracker.check();
    const [item] = tracker.items();
    assert.equal(item.state, 'error');
    assert.equal(world.notices.at(-1).text, 'No se ha podido guardar «Uno nuevo». Inténtalo de nuevo.');
    const view = applyPendingEdits(world.catalog.songs, world.catalog.folders, tracker.items());
    assert.equal(view.songs.find((song) => song.id === S1).title, 'Uno', 'Se deshace la vista optimista.');
    assert.equal(indicatorText(tracker.items()), 'No se ha podido guardar 1 cambio');
    // «Reintentar» envía la misma operación con una incidencia nueva y vuelve a estar pendiente.
    await tracker.retry(item.key);
    const [again] = tracker.items();
    assert.deepEqual([again.state, again.issue, again.createdAt], ['pendiente', 102, 20_000]);
    assert.equal(world.sent.length, 2);
    tracker.discard(again.key);
    assert.equal(tracker.items().length, 1, 'Una pendiente no se descarta.');
  });

  test('enviar otra vez lo mismo que una fallida no es un duplicado: se envía y sustituye a la fallida', async () => {
    const { tracker, world } = harness();
    await tracker.submit({ op: 'edit_song', song_id: S1, title: 'X' });
    world.published = structuredClone(world.catalog);
    world.statuses.set(101, 'error');
    await tracker.check();
    await tracker.submit({ op: 'edit_song', song_id: S1, title: 'X' });
    assert.deepEqual(tracker.items().map((item) => [item.state, item.issue]), [['pendiente', 102]]);
  });

  test('«Descartar» quita una fallida', async () => {
    const { tracker, world } = harness();
    await tracker.submit({ op: 'rename_folder', folder_id: F1, name: 'Otro' });
    world.published = structuredClone(world.catalog);
    world.statuses.set(101, 'error');
    await tracker.check();
    tracker.discard(tracker.items()[0].key);
    assert.deepEqual(tracker.items(), []);
  });

  test('sin conexión nunca caduca; con conexión, a los 30 minutos sin confirmar se da por fallida', async () => {
    const { tracker, world } = harness();
    await tracker.submit({ op: 'edit_folder', folder_id: F1, name: 'Otro' });
    world.clock = 45 * MIN;
    await tracker.check();
    assert.equal(tracker.items()[0].state, 'pendiente', 'Sin catálogo ni estado: sigue pendiente.');
    world.published = structuredClone(world.catalog);
    world.statuses.set(101, 'abierta');
    await tracker.check();
    assert.equal(tracker.items()[0].state, 'error');
    assert.match(tracker.items()[0].error, /30 minutos/);
  });

  test('cerrada sin reflejarse: a los 10 minutos se da por guardada', async () => {
    const { tracker, world } = harness();
    await tracker.submit({ op: 'edit_song', song_id: S1, title: 'X' });
    world.published = structuredClone(world.catalog);
    world.statuses.set(101, 'cerrada');
    world.clock = MIN;
    await tracker.check();
    assert.equal(tracker.items()[0].closedAt, MIN);
    world.clock = 11 * MIN;
    await tracker.check();
    assert.deepEqual(tracker.items(), []);
    assert.equal(world.notices.at(-1).type, 'confirmed');
  });

  test('tras recargar sigue pendiente y se revisa enseguida', async () => {
    const storage = memoryStorage();
    const first = harness({ storage });
    await first.tracker.submit({ op: 'move_songs', song_ids: [S4], folder_id: F2 });
    first.tracker.dispose();
    const second = harness({ storage });
    second.tracker.restore();
    assert.deepEqual(second.tracker.items().map((item) => [item.state, item.issue, item.action]), [['pendiente', 101, 'Mover a «Álbum B»']]);
    assert.deepEqual(second.pendingTimers().map((timer) => timer.ms), [0]);
  });

  test('reconcile confirma lo que ya refleja un catálogo cargado, sin dar nada por fallido', async () => {
    const { tracker, world } = harness();
    await tracker.submit({ op: 'edit_song', song_id: S1, title: 'X' });
    await tracker.submit({ op: 'edit_song', song_id: S4, title: 'Y' });
    world.clock = 60 * MIN;
    const songs = world.catalog.songs.map((song) => (song.id === S1 ? { ...song, title: 'X' } : song));
    tracker.reconcile(songs, world.catalog.folders);
    assert.deepEqual(tracker.items().map((item) => [item.label, item.state]), [['Y', 'pendiente']]);
  });

  test('portada: se guarda con su vista previa, sabe si ya tenía portada y se reintenta con los mismos bytes', async () => {
    const { tracker, world } = harness();
    const dataUrl = 'data:image/jpeg;base64,/9j/2Q==';
    await tracker.submitCover({ id: F1, bytes: new Uint8Array([1]), dataUrl });
    assert.equal(await tracker.submitCover({ id: F1, bytes: new Uint8Array([1]), dataUrl }), 'Ya está pendiente: «Álbum A».');
    const [item] = tracker.items();
    assert.deepEqual([item.kind, item.targetId, item.hadCover, item.preview, item.label, item.action], ['cover', F1, true, dataUrl, 'Álbum A', 'Portada nueva']);
    // Ya tenía portada: no se puede ver en el catálogo; a los 10 minutos se da por guardada.
    world.published = structuredClone(world.catalog);
    world.clock = 10 * MIN;
    await tracker.check();
    assert.deepEqual(tracker.items(), []);
    // Una portada nueva para algo sin portada se confirma cuando el catálogo la trae.
    await tracker.submitCover({ id: S4, bytes: new Uint8Array([2]), dataUrl });
    assert.equal(tracker.items()[0].hadCover, false);
    world.published.songs = world.published.songs.map((song) => (song.id === S4 ? { ...song, cover: `covers/${S4}.jpg` } : song));
    await tracker.check();
    assert.deepEqual(tracker.items(), []);
    assert.equal(world.covers.length, 2);
  });

  test('portada por el Worker: guarda su fichero, se revisa a los 3 s y se confirma cuando el índice la refleja', async () => {
    const { tracker, world, storage, pendingTimers } = harness();
    const key = `portadas/${F1}-0123456789abcdef.jpg`;
    world.coverKey = () => key;
    const dataUrl = 'data:image/jpeg;base64,/9j/2Q==';
    await tracker.submitCover({ id: F1, bytes: new Uint8Array([1]), dataUrl });
    const [item] = tracker.items();
    assert.deepEqual([item.hadCover, item.coverKey], [true, key]);
    assert.deepEqual(pendingTimers().map((timer) => timer.ms), [COVER_KEY_CHECK_MS]);
    assert.equal(COVER_KEY_CHECK_MS, 3000);
    assert.equal(parseEdits(storage.data.get(STORAGE_KEY))[0].coverKey, key);
    // A los 10 minutos no se supone nada: sigue pendiente mientras el índice no la tenga.
    world.published = structuredClone(world.catalog);
    world.clock = 10 * MIN;
    await tracker.check();
    assert.equal(tracker.items().length, 1);
    // El catálogo con el índice encima ya apunta al fichero: confirmada.
    world.published.folders = world.published.folders.map((folder) => (folder.id === F1 ? { ...folder, cover: `https://pub-8a005187082e401abad47cdee4ec88ab.r2.dev/${key}` } : folder));
    await tracker.check();
    assert.deepEqual(tracker.items(), []);
    assert.equal(world.notices.at(-1).type, 'confirmed');
  });

  test('portada por el Worker: un fichero de otro id en el recibo no se guarda', async () => {
    const { tracker, world } = harness();
    world.coverKey = () => `portadas/${F2}-0123456789abcdef.jpg`;
    await tracker.submitCover({ id: F1, bytes: new Uint8Array([1]), dataUrl: 'data:image/jpeg;base64,/9j/2Q==' });
    assert.equal(tracker.items()[0].coverKey, undefined);
  });

  test('create_folder recuerda los álbumes de antes y se confirma con el nuevo', async () => {
    const { tracker, world } = harness();
    await tracker.submit({ op: 'create_folder', name: 'Valses' });
    assert.deepEqual(tracker.items()[0].knownFolderIds, [F1, F2]);
    world.published = structuredClone(world.catalog);
    world.published.folders.push({ id: 'F0000000000000003', name: 'Valses', parent_id: null });
    await tracker.check();
    assert.deepEqual(tracker.items(), []);
  });

  test('el almacenamiento bloqueado no rompe nada', async () => {
    const storage = { getItem: () => { throw new Error('bloqueado'); }, setItem: () => { throw new Error('bloqueado'); }, removeItem: () => { throw new Error('bloqueado'); } };
    const { tracker } = harness({ storage });
    tracker.restore();
    await tracker.submit({ op: 'edit_song', song_id: S1, title: 'X' });
    assert.equal(tracker.items().length, 1);
  });
});

describe('edit-remote: recibo y estado', () => {
  const reply = (status, body) => async () => new Response(JSON.stringify(body), { status });

  test('sendOrganize devuelve el mensaje y el número de incidencia; sendCover, sin número', async () => {
    assert.deepEqual(await sendOrganize({ op: 'create_folder', name: 'A' }, reply(200, { ok: true, incidencia: 42, mensaje: 'Hecho.' })), { message: 'Hecho.', issue: 42, cover: null });
    assert.deepEqual(await sendOrganize({ op: 'create_folder', name: 'A' }, reply(200, { ok: true, incidencia: 'x' })), { message: 'Guardado: llegará a todos en un par de minutos.', issue: null, cover: null });
    assert.deepEqual(await sendCover('S0000000000000001', new Uint8Array([1]), reply(200, { ok: true, mensaje: 'Hecho.' })), { message: 'Hecho.', issue: null, cover: null });
    // Por el Worker: el fichero de R2, solo si es de esa portada.
    const key = 'portadas/S0000000000000001-0123456789abcdef.jpg';
    assert.equal((await sendCover('S0000000000000001', new Uint8Array([1]), reply(200, { ok: true, portada: key }))).cover, key);
    assert.equal((await sendCover('S0000000000000002', new Uint8Array([1]), reply(200, { ok: true, portada: key }))).cover, null);
    assert.equal((await sendCover('S0000000000000001', new Uint8Array([1]), reply(200, { ok: true, portada: '../x.jpg' }))).cover, null);
  });

  test('fetchEditStatus pide el estado sin caché y valida la respuesta', async () => {
    let seen;
    const estado = await fetchEditStatus(12, async (url, init) => {
      seen = { url, init };
      return new Response(JSON.stringify({ ok: true, incidencia: 12, estado: 'cerrada' }), { status: 200 });
    });
    assert.equal(estado, 'cerrada');
    assert.equal(seen.url, '/api/editar?incidencia=12');
    assert.equal(seen.init.cache, 'no-store');
    await assert.rejects(fetchEditStatus(12, reply(200, { ok: true, estado: 'rara' })));
    await assert.rejects(fetchEditStatus(12, reply(502, { ok: false })));
    await assert.rejects(fetchEditStatus(0, reply(200, {})));
    await assert.rejects(fetchEditStatus(12, async () => { throw new TypeError('fetch failed'); }));
  });
});
