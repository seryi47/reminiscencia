// Pruebas de la lógica de las listas (listas.js) y de las carpetas (carpetas.js) del modo paciente.
// Se prueban las funciones puras, la disponibilidad sin conexión con una caché simulada y la
// reproducción con un reproductor simulado. Los datos son ficticios.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HOME_TILE_LIMIT,
  LARGE_TEXT_SCALE,
  UNAVAILABLE_TEXT,
  aliasTitle,
  announce,
  cachedSongPaths,
  compareText,
  createPresentationResolver,
  describeRow,
  getActiveProfile,
  hasMoreThan,
  initialOf,
  isLargeText,
  isSongAvailable,
  latestLists,
  likedSongs,
  listName,
  playQueue,
  presentationOfLink,
  refreshRows,
  routes as listRoutes,
  songAudioPath,
  songCountText,
  songTitle,
  songsByIds,
  songsOfList,
  soundingLabel,
  trackOfSong,
  visibleLists,
} from '../../frontend/web/js/paciente/listas.js';
import {
  ORIGIN_FOLDER,
  findFolder,
  folderName,
  routes as folderRoutes,
  songsInFolder,
  sortFolders,
} from '../../frontend/web/js/paciente/carpetas.js';

// Canciones ficticias. El identificador tiene el formato del catálogo (S + 16 hexadecimales).
const songs = [
  {
    id: 'S0000000000000001',
    title: 'Primera canción',
    artist: 'Artista A',
    year: 1925,
    tags: [],
    folder_id: 'carpeta-1',
    duration_s: 120,
    license: 'Licencia de prueba',
    audio: 'audio/S0000000000000001.opus',
  },
  {
    id: 'S0000000000000002',
    title: 'Segunda canción',
    artist: 'Artista B',
    year: 1931,
    tags: [],
    folder_id: 'carpeta-1',
    duration_s: 150,
    license: 'Licencia de prueba',
    audio: 'audio/S0000000000000002.opus',
  },
  {
    id: 'S0000000000000003',
    title: 'Tercera canción',
    artist: '',
    year: null,
    tags: [],
    folder_id: null,
    duration_s: 90,
    license: 'Licencia de prueba',
    audio: 'audio/S0000000000000003.opus',
  },
];

// Simula la API de caché del navegador (caches.has, caches.open, cache.keys) durante una prueba.
async function withCaches(fakeCaches, body) {
  const previous = globalThis.caches;
  globalThis.caches = fakeCaches;
  try {
    return await body();
  } finally {
    if (previous === undefined) delete globalThis.caches;
    else globalThis.caches = previous;
  }
}

test('seguir escuchando: las listas con cambio más reciente primero, hasta seis, sin alterar el original', () => {
  const lists = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ id: `L${n}`, updatedAt: n * 10 }));
  const latest = latestLists(lists);
  assert.equal(latest.length, HOME_TILE_LIMIT);
  assert.deepEqual(latest.map((list) => list.id), ['L8', 'L7', 'L6', 'L5', 'L4', 'L3']);
  assert.deepEqual(lists.map((list) => list.id), ['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7', 'L8']);
});

test('mis listas: seis mosaicos por defecto, todas tras «Ver todas»; el botón aparece desde la séptima', () => {
  const eight = Array.from({ length: 8 }, (_, index) => ({ id: `L${index}` }));
  assert.equal(visibleLists(eight).length, 6);
  assert.equal(visibleLists(eight, true).length, 8);
  assert.equal(hasMoreThan(eight.slice(0, 6), HOME_TILE_LIMIT), false);
  assert.equal(hasMoreThan(eight.slice(0, 7), HOME_TILE_LIMIT), true);
});

test('para [alias]: solo las canciones con preferencia «Le gusta» (+1), en orden y sin repetir', () => {
  const links = [
    { songId: songs[1].id, preference: 1 },
    { songId: songs[0].id, preference: 0 },
    { songId: songs[2].id, preference: -1 },
    { songId: songs[1].id, preference: 1 },
    { songId: 'S0000000000000099', preference: 1 },
    { songId: songs[0].id, preference: 1 },
  ];
  assert.deepEqual(likedSongs(links, songs).map((song) => song.id), [songs[1].id, songs[0].id]);
  assert.deepEqual(likedSongs([], songs), []);
});

test('una lista da sus canciones en su orden y omite las que ya no están en el catálogo', () => {
  const list = { songIds: [songs[2].id, 'S0000000000000099', songs[0].id] };
  assert.deepEqual(songsOfList(list, songs).map((song) => song.id), [songs[2].id, songs[0].id]);
  assert.deepEqual(songsOfList({}, songs), []);
  assert.deepEqual(songsByIds([songs[1].id], songs).map((song) => song.title), ['Segunda canción']);
});

test('la pista para el reproductor tiene la forma del contrato y toma el audio y la carpeta del catálogo', () => {
  const track = trackOfSong(songs[0]);
  assert.deepEqual(Object.keys(track).sort(), ['artist', 'audioUrl', 'coverUrl', 'folderId', 'id', 'title', 'year']);
  assert.equal(track.id, songs[0].id);
  assert.equal(track.audioUrl, songs[0].audio);
  assert.equal(track.folderId, 'carpeta-1');
  assert.equal(track.coverUrl, null);
  assert.equal(trackOfSong(songs[2]).folderId, null);
});

test('la presentación de cada pista sale de su asociación; sin asociación o no válida, C0', () => {
  const links = [
    { songId: songs[0].id, presentation: 'C1' },
    { songId: songs[1].id, presentation: 'X9' },
  ];
  const resolve = createPresentationResolver(links);
  assert.equal(resolve({ id: songs[0].id }), 'C1');
  assert.equal(resolve({ id: songs[1].id }), 'C0');
  assert.equal(resolve({ id: songs[2].id }), 'C0');
  assert.equal(resolve(null), 'C0');
  assert.equal(presentationOfLink(undefined), 'C0');
});

test('sin conexión solo se escucha lo guardado; con conexión, todo', () => {
  const cached = new Set([songAudioPath(songs[0])]);
  assert.equal(songAudioPath(songs[0]), 'audio/S0000000000000001.opus');
  assert.equal(isSongAvailable(songs[0], { online: false, cached }), true);
  assert.equal(isSongAvailable(songs[1], { online: false, cached }), false);
  assert.equal(isSongAvailable(songs[1], { online: true, cached }), true);
});

test('fila activa: «Suena: [artista]»; sin artista, «Suena ahora»; sin copia, «No disponible sin internet»', () => {
  assert.deepEqual(describeRow(songs[0], { activeId: songs[0].id, online: true }), {
    active: true,
    available: true,
    line: 'Suena: Artista A',
  });
  assert.equal(describeRow(songs[2], { activeId: songs[2].id }).line, 'Suena ahora');
  assert.deepEqual(describeRow(songs[1], { online: false, cached: new Set() }), {
    active: false,
    available: false,
    line: UNAVAILABLE_TEXT,
  });
  assert.equal(describeRow(songs[0], {}).line, 'Artista A');
  assert.equal(describeRow(songs[2], {}).line, '');
  assert.equal(soundingLabel('   '), 'Suena ahora');
  assert.equal(UNAVAILABLE_TEXT, 'No disponible sin internet');
});

test('textos de número de canciones, inicial, nombre y alias', () => {
  assert.equal(songCountText(0), '0 canciones');
  assert.equal(songCountText(1), '1 canción');
  assert.equal(songCountText(12), '12 canciones');
  assert.equal(initialOf('  álbum'), 'Á');
  assert.equal(initialOf(''), '•');
  assert.equal(listName({ name: '   ' }), 'Lista sin nombre');
  assert.equal(listName({ name: ' Domingos ' }), 'Domingos');
  assert.equal(songTitle({ title: '' }), 'Sin título');
  assert.equal(aliasTitle('Persona de prueba'), 'Para Persona de prueba');
});

test('el orden de texto en español pone los números por su valor', () => {
  assert.deepEqual(['Carpeta 10', 'Carpeta 2'].sort(compareText), ['Carpeta 2', 'Carpeta 10']);
});

test('la caché de audio marca como guardadas las canciones que tienen su fichero', async () => {
  const paths = await withCaches(
    {
      has: async () => true,
      open: async () => ({
        keys: async () => [{ url: `https://ejemplo.test/audio/${songs[0].id}.opus` }],
      }),
    },
    () => cachedSongPaths(songs),
  );
  assert.deepEqual([...paths], [songAudioPath(songs[0])]);
});

test('sin caché de audio, ninguna canción se considera guardada', async () => {
  const size = await withCaches(
    {
      has: async () => false,
      open: async () => {
        throw new Error('no debería abrirse una caché que no existe');
      },
    },
    async () => (await cachedSongPaths(songs)).size,
  );
  assert.equal(size, 0);
});

test('si la caché falla, la pantalla sigue sin copias y no lanza', async () => {
  const size = await withCaches(
    { has: async () => { throw new Error('bloqueada'); } },
    async () => (await cachedSongPaths(songs)).size,
  );
  assert.equal(size, 0);
});

test('escala de texto: una columna desde 1,50 (incluido), con preferencias ausentes o rotas, normal', () => {
  const withScale = (value) => ({
    prefs: {
      get(key) {
        assert.equal(key, 'textScale');
        return value;
      },
    },
  });
  assert.equal(LARGE_TEXT_SCALE, 1.5);
  assert.equal(isLargeText(withScale(1)), false);
  assert.equal(isLargeText(withScale(1.25)), false);
  assert.equal(isLargeText(withScale(1.5)), true);
  assert.equal(isLargeText(withScale(1.75)), true);
  assert.equal(isLargeText({}), false);
  assert.equal(isLargeText({ prefs: { get() { throw new Error('sin preferencias'); } } }), false);
});

test('el perfil del paciente es el perfil activo del almacén; sin activo o si ya no existe, null', async () => {
  const profiles = [{ id: 'P1', alias: 'Persona de prueba' }];
  const serviceWith = (activeId) => ({
    store: {
      getActiveProfileId: async () => activeId,
      listProfiles: async () => profiles,
    },
  });
  assert.deepEqual(await getActiveProfile(serviceWith('P1')), profiles[0]);
  assert.equal(await getActiveProfile(serviceWith(null)), null);
  assert.equal(await getActiveProfile(serviceWith('P9')), null);
});

// Reproductor simulado: registra las llamadas y devuelve el estado que se le indique.
function fakeServices(state) {
  const calls = [];
  const announced = [];
  const services = {
    calls,
    announced,
    player: {
      load: (queue, index, origin, presentation) => calls.push({ type: 'load', queue, index, origin, presentation }),
      play: () => calls.push({ type: 'play' }),
      getState: () => state,
    },
    announce: (text) => announced.push(text),
  };
  return services;
}

test('reproducir: carga la cola con la forma de pista, el índice, el origen y la presentación, y luego reproduce', () => {
  const services = fakeServices({ track: { id: songs[1].id, title: 'Segunda canción' }, notice: null });
  const context = { services, online: true, cached: new Set(), activeId: null, refreshers: [] };
  let refreshed = 0;
  context.refreshers.push(() => { refreshed += 1; });
  const presentation = () => 'C0';

  playQueue(context, { queue: songs, index: 1, origin: 'lista', presentation });

  assert.deepEqual(services.calls.map((call) => call.type), ['load', 'play']);
  const [load] = services.calls;
  assert.equal(load.index, 1);
  assert.equal(load.origin, 'lista');
  assert.equal(load.presentation, presentation);
  assert.equal(load.queue.length, 3);
  assert.equal(load.queue[0].audioUrl, songs[0].audio);
  assert.equal(context.activeId, songs[1].id, 'la fila de la canción que suena queda marcada');
  assert.equal(refreshed, 1);
  assert.deepEqual(services.announced, ['Reproduciendo «Segunda canción».']);
});

test('sin pista que sonar, se anuncia el aviso del reproductor', () => {
  const services = fakeServices({ track: null, notice: 'No hay canciones disponibles sin internet.' });
  playQueue(
    { services, online: false, cached: new Set(), activeId: null, refreshers: [] },
    { queue: songs, index: 0, origin: 'carpeta', presentation: null },
  );
  assert.deepEqual(services.announced, ['No hay canciones disponibles sin internet.']);
});

test('refreshRows lee la canción que suena y actualiza cada fila montada', () => {
  const services = fakeServices({ track: { id: songs[0].id, title: 'Primera canción' }, notice: null });
  const seen = [];
  const context = { services, online: true, cached: new Set(), activeId: null, refreshers: [() => seen.push('fila')] };
  refreshRows(context);
  assert.equal(context.activeId, songs[0].id);
  assert.deepEqual(seen, ['fila']);
});

test('announce no falla si el servicio de anuncios no existe', () => {
  assert.doesNotThrow(() => announce({}, 'texto'));
});

test('rutas: listas atiende listas (P2) y lista (P2b)', () => {
  assert.deepEqual(Object.keys(listRoutes).sort(), ['lista', 'listas']);
  assert.equal(typeof listRoutes.listas, 'function');
  assert.equal(typeof listRoutes.lista, 'function');
});

// ---------- Carpetas ----------

const folders = [
  { id: 'carpeta-1', name: 'Años veinte', parent_id: null },
  { id: 'carpeta-2', name: 'Boleros', parent_id: null },
];

test('las carpetas se ordenan por nombre, sin alterar la lista original', () => {
  const ordered = sortFolders([folders[1], folders[0]]);
  assert.deepEqual(ordered.map((folder) => folder.name), ['Años veinte', 'Boleros']);
  assert.equal(folders[0].name, 'Años veinte');
});

test('una canción pertenece a la carpeta de su folder_id; una carpeta sin canciones queda vacía', () => {
  assert.deepEqual(songsInFolder(folders[0], songs).map((song) => song.id), [songs[0].id, songs[1].id]);
  assert.deepEqual(songsInFolder(folders[1], songs), []);
});

test('la carpeta se busca por su identificador; si no existe, null', () => {
  assert.equal(findFolder(folders, 'carpeta-2').name, 'Boleros');
  assert.equal(findFolder(folders, 'no-existe'), null);
  assert.equal(findFolder(folders, undefined), null);
  assert.equal(folderName({ name: '  ' }), 'Carpeta sin nombre');
  assert.equal(ORIGIN_FOLDER, 'carpeta');
});

test('rutas: carpetas atiende carpetas (P3) y carpeta (P3b)', () => {
  assert.deepEqual(Object.keys(folderRoutes).sort(), ['carpeta', 'carpetas']);
  assert.equal(typeof folderRoutes.carpetas, 'function');
  assert.equal(typeof folderRoutes.carpeta, 'function');
});
