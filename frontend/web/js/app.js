// Arranque de Reminiscencia (ADR-0014): una sola biblioteca pública para todos, sin perfiles ni modos.
// La web abre en Inicio con la música. Las listas propias y «Me gusta» viven solo en este navegador
// (js/local-library.js) y las canciones subidas aquí, en su propia base (js/cuidador/subida-local.js).
//
// Este módulo guarda el estado, enruta por hash (#/, #/buscar, #/biblioteca, #/carpeta/<id>, #/lista/<id>,
// #/me-gusta, #/canciones, #/locales y #/seccion/<estante>), pinta la pantalla activa y la barra lateral, y conecta
// el reproductor con la interfaz. Al abrir la página no se mueve el foco (el primer Tab llega al enlace de salto);
// al cambiar de pantalla por una acción, el foco va al H1.

import {
  ALL_SONGS_COLOR,
  buildCatalog,
  childFolders,
  coverColor,
  LIKED_COLOR,
  LOCAL_COLOR,
  localSongsOf,
  songCountText,
  songsInFolder,
} from './catalog.js';
import { openLocalLibrary, validatePlaylistName } from './local-library.js';
import { createPlayer, nextRepeatMode } from './player.js';
import { cachedAudioPaths, registerPwa, removeOfflineSongs, saveLibraryOffline } from './pwa.js';
import { deleteLocalSong as removeLocalRecord, loadLocalSongs } from './cuidador/subida-local.js';
import { closeMenu, confirmDialog, promptDialog, toast } from './ui/dom.js';
import { likeButton, setPlayButtonState } from './views/components.js';
import { renderHome } from './views/home.js';
import { renderSearch } from './views/search.js';
import { renderCollection } from './views/collection.js';
import { libraryActions, libraryChips, renderLibraryList, renderLibraryPage, renderSection } from './views/library.js';
import { mountPlayerUi } from './views/player-ui.js';
import { openUploadSheet } from './views/upload.js';

const DATA_URLS = Object.freeze({ songs: 'data/songs.json', folders: 'data/folders.json' });
const PLAYER_PREFS_KEY = 'reminiscencia.reproductor';
const APP_NAME = 'Reminiscencia';

// ---------------------------------------------------------------------------
// Estado
// ---------------------------------------------------------------------------

const state = {
  publicSongs: [],
  publicFolders: [],
  localSongs: [],
  catalog: buildCatalog(),
  loadError: null,
  playlists: [],
  likes: new Map(),
  cached: new Set(),
  downloading: new Set(),
  online: typeof navigator === 'undefined' ? true : navigator.onLine !== false,
  libraryFilter: null,
  searchQuery: '',
  addQuery: '',
  route: { name: 'inicio', id: null },
  ready: false,
};

let library = null;
let player = null;
let playerUi = null;
let userNavigated = false;
let persistenceRequested = false;
let lastSync = '';

const dom = {};

function rebuildCatalog() {
  state.catalog = buildCatalog(state.publicSongs, state.publicFolders, state.localSongs);
}

// ---------------------------------------------------------------------------
// Preferencias del reproductor (solo comodidad: si el navegador no deja guardar, valen durante la visita)
// ---------------------------------------------------------------------------

function readPlayerPrefs() {
  try {
    const value = JSON.parse(localStorage.getItem(PLAYER_PREFS_KEY) ?? '{}');
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

function savePlayerPrefs(playerState) {
  try {
    localStorage.setItem(PLAYER_PREFS_KEY, JSON.stringify({
      volume: playerState.volume,
      shuffle: playerState.shuffle,
      repeat: playerState.repeat,
    }));
  } catch {
    // Almacenamiento bloqueado: no pasa nada.
  }
}

// ---------------------------------------------------------------------------
// Colecciones (contextos de reproducción)
// ---------------------------------------------------------------------------

function songColor(song) {
  if (song.local) return LOCAL_COLOR;
  return coverColor(song.folderId ?? song.id);
}

function folderContext(folder) {
  const count = songsInFolder(state.catalog, folder.id).length;
  return {
    contextId: `carpeta:${folder.id}`,
    kind: 'folder',
    title: folder.name,
    subtitle: `Carpeta · ${songCountText(count)}`,
    href: `#/carpeta/${encodeURIComponent(folder.id)}`,
    color: coverColor(folder.id),
    iconName: 'folder',
  };
}

function playlistContext(list) {
  return {
    contextId: `lista:${list.id}`,
    kind: 'playlist',
    title: list.name,
    subtitle: `Lista · ${songCountText(list.songIds.filter((id) => state.catalog.songById.has(id)).length)}`,
    href: `#/lista/${encodeURIComponent(list.id)}`,
    color: coverColor(list.id),
    iconName: 'list',
  };
}

function likedSongs() {
  return [...state.likes.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => state.catalog.songById.get(id))
    .filter(Boolean);
}

function likedContext() {
  return {
    contextId: 'me-gusta',
    kind: 'liked',
    title: 'Me gusta',
    subtitle: `Lista · ${songCountText(likedSongs().length)}`,
    href: '#/me-gusta',
    color: LIKED_COLOR,
    iconName: 'heart-filled',
  };
}

function allSongsContext() {
  return {
    contextId: 'canciones',
    kind: 'all',
    title: 'Todas las canciones',
    subtitle: `Biblioteca · ${songCountText(state.catalog.songs.length)}`,
    href: '#/canciones',
    color: ALL_SONGS_COLOR,
    iconName: 'note',
  };
}

function localContext() {
  return {
    contextId: 'locales',
    kind: 'local',
    title: 'Subidas a este navegador',
    subtitle: `Solo aquí · ${songCountText(localSongsOf(state.catalog).length)}`,
    href: '#/locales',
    color: LOCAL_COLOR,
    iconName: 'device',
  };
}

function folderContexts(parentId) {
  const folders = parentId === undefined ? state.catalog.folders : childFolders(state.catalog, parentId);
  return folders.map(folderContext);
}

function playlistContexts() {
  return state.playlists.map(playlistContext);
}

/** Elementos de la biblioteca: «Me gusta», (todas), las subidas aquí, las listas y las carpetas. */
function libraryContexts({ includeAll = false, allFolders = false } = {}) {
  const items = [likedContext()];
  if (includeAll && state.catalog.songs.length > 0) items.push(allSongsContext());
  if (localSongsOf(state.catalog).length > 0) items.push(localContext());
  items.push(...playlistContexts());
  items.push(...folderContexts(allFolders ? undefined : null));
  return items;
}

/** Colección completa por su id de contexto, con sus canciones, o null si no existe. */
function getContext(contextId) {
  if (typeof contextId !== 'string') return null;
  if (contextId === 'me-gusta') return { ...likedContext(), typeLabel: 'Lista', songs: likedSongs() };
  if (contextId === 'canciones') return { ...allSongsContext(), typeLabel: 'Biblioteca', songs: state.catalog.songs };
  if (contextId === 'locales') return { ...localContext(), typeLabel: 'Canciones locales', songs: localSongsOf(state.catalog) };
  if (contextId.startsWith('carpeta:')) {
    const folder = state.catalog.folderById.get(contextId.slice('carpeta:'.length));
    if (!folder) return null;
    return {
      ...folderContext(folder),
      typeLabel: 'Carpeta',
      folder,
      songs: songsInFolder(state.catalog, folder.id),
      subfolders: childFolders(state.catalog, folder.id).map(folderContext),
    };
  }
  if (contextId.startsWith('lista:')) {
    const list = state.playlists.find((item) => item.id === contextId.slice('lista:'.length));
    if (!list) return null;
    return {
      ...playlistContext(list),
      typeLabel: 'Lista',
      playlist: list,
      songs: list.songIds.map((id) => state.catalog.songById.get(id)).filter(Boolean),
    };
  }
  return null;
}

const EXTRA_CONTEXT_NAMES = Object.freeze({ busqueda: 'Búsqueda', recientes: 'Añadidas recientemente' });

// ---------------------------------------------------------------------------
// Reproducción
// ---------------------------------------------------------------------------

function isPlayable(song) {
  if (state.online || song.local) return true;
  return state.cached.has(song.audio ?? song.audioUrl);
}

function trackOf(song) {
  return {
    id: song.id,
    title: song.title,
    artist: song.artist,
    audioUrl: song.audio,
    folderId: song.folderId,
    durationS: song.durationS,
    local: song.local,
  };
}

function playSongs(songs, index, { contextId = null } = {}) {
  const name = getContext(contextId)?.title ?? EXTRA_CONTEXT_NAMES[contextId] ?? '';
  player.load(songs.map(trackOf), index, { contextId, contextName: name, autoplay: true });
}

function playContext(contextId) {
  const context = getContext(contextId);
  if (!context || context.songs.length === 0) return;
  playSongs(context.songs, player.getState().shuffle ? null : 0, { contextId });
}

function toggleContext(contextId) {
  const current = player.getState();
  if (current.track && current.contextId === contextId) player.toggle();
  else playContext(contextId);
}

function isContextPlaying(contextId) {
  const current = player?.getState();
  return Boolean(current && current.playing && current.contextId === contextId);
}

/** Marca lo que suena: botones verdes, filas y tarjetas. Solo trabaja cuando cambia algo relevante. */
function syncPlaying(force = false) {
  const current = player.getState();
  const signature = `${current.key}|${current.playing}|${current.contextId}|${current.shuffle}|${current.track?.id}`;
  if (!force && signature === lastSync) return;
  lastSync = signature;
  for (const button of document.querySelectorAll('[data-play-context]')) {
    setPlayButtonState(button, current.playing && current.contextId === button.dataset.playContext);
  }
  const songId = current.track?.id ?? null;
  for (const row of document.querySelectorAll('.track-row, .card-song')) {
    const isCurrent = songId !== null && row.dataset.songId === songId;
    row.classList.toggle('is-current', isCurrent);
    row.classList.toggle('is-playing', isCurrent && current.playing);
  }
  for (const toggle of document.querySelectorAll('[data-shuffle-toggle]')) {
    toggle.classList.toggle('is-active', current.shuffle);
    toggle.setAttribute('aria-pressed', String(current.shuffle));
  }
}

function onPlayerChange(playerState) {
  playerUi?.update(playerState);
  syncPlaying();
  savePlayerPrefs(playerState);
}

// ---------------------------------------------------------------------------
// Acciones sobre la biblioteca local
// ---------------------------------------------------------------------------

function requestPersistence() {
  if (persistenceRequested) return;
  persistenceRequested = true;
  navigator.storage?.persist?.().catch?.(() => {});
}

async function refreshLibrary() {
  state.playlists = await library.listPlaylists();
  state.likes = await library.listLikes();
  render();
}

async function toggleLike(songId) {
  const liked = !state.likes.has(songId);
  requestPersistence();
  try {
    await library.setLiked(songId, liked);
    toast(liked ? 'Se ha guardado en Me gusta.' : 'Se ha quitado de Me gusta.');
  } catch (error) {
    toast('No se ha podido guardar el cambio en este navegador.');
    console.error(error);
  }
  await refreshLibrary();
  playerUi.update(player.getState());
}

async function createPlaylist({ songIds = [], navigate = true } = {}) {
  requestPersistence();
  try {
    const list = await library.createPlaylist(null, songIds);
    await refreshLibrary();
    toast(songIds.length > 0 ? `Se ha añadido a «${list.name}».` : `Se ha creado «${list.name}».`);
    if (navigate) goTo(`#/lista/${encodeURIComponent(list.id)}`);
    return list;
  } catch (error) {
    toast(error instanceof Error ? error.message : 'No se ha podido crear la lista.');
    return null;
  }
}

async function renamePlaylist(id) {
  const list = state.playlists.find((item) => item.id === id);
  if (!list) return;
  const name = await promptDialog({ title: 'Cambiar el nombre', label: 'Nombre de la lista', value: list.name, validate: validatePlaylistName });
  if (name === null || name === list.name) return;
  await library.renamePlaylist(id, name);
  await refreshLibrary();
  toast(`La lista se llama ahora «${name}».`);
}

async function deletePlaylist(id) {
  const list = state.playlists.find((item) => item.id === id);
  if (!list) return;
  const ok = await confirmDialog({
    title: 'Borrar la lista',
    message: `¿Borrar «${list.name}» de este navegador? Las canciones no se borran.`,
    confirmLabel: 'Borrar',
    danger: true,
  });
  if (!ok) return;
  await library.deletePlaylist(id);
  if (state.route.name === 'lista' && state.route.id === id) goTo('#/', { replace: true });
  await refreshLibrary();
  toast(`Se ha borrado «${list.name}».`);
}

async function addToPlaylist(id, songIds) {
  const list = state.playlists.find((item) => item.id === id);
  if (!list) return;
  const added = await library.addToPlaylist(id, songIds);
  await refreshLibrary();
  toast(added > 0 ? `Se ha añadido a «${list.name}».` : `Ya estaba en «${list.name}».`);
}

async function removeFromPlaylist(id, songId) {
  const list = state.playlists.find((item) => item.id === id);
  if (!list) return;
  await library.removeFromPlaylist(id, songId);
  await refreshLibrary();
  toast(`Se ha quitado de «${list.name}».`);
}

function addToQueue(song) {
  player.addToQueue(trackOf(song));
  toast('Se ha añadido a la cola.');
}

/** Borra una canción subida a este navegador, tras confirmarlo. Resuelve true si se borra. */
async function deleteLocalSong(song) {
  const ok = await confirmDialog({
    title: 'Borrar canción',
    message: '¿Borrar esta canción de este navegador? No se puede deshacer.',
    confirmLabel: 'Borrar',
    danger: true,
  });
  if (!ok) return false;
  try {
    await removeLocalRecord(song.id);
  } catch (error) {
    toast(error instanceof Error ? error.message : 'No se ha podido borrar la canción.');
    return false;
  }
  await library.forgetSong(song.id);
  if (player.getState().track?.id === song.id) player.load([]);
  state.localSongs = state.localSongs.filter((item) => item.id !== song.id);
  rebuildCatalog();
  await refreshLibrary();
  toast(`Se ha borrado «${song.title}» de este navegador.`);
  return true;
}

async function onLocalAdded(songs) {
  state.localSongs = [...state.localSongs, ...songs];
  rebuildCatalog();
  render();
}

async function toggleDownload(contextId, songs, done) {
  if (done) {
    await removeOfflineSongs(songs);
    state.cached = await cachedAudioPaths();
    render();
    toast('Se ha quitado la descarga.');
    return;
  }
  state.downloading.add(contextId);
  render();
  toast('Descargando para escuchar sin conexión…');
  try {
    const result = await saveLibraryOffline(songs);
    toast(result.failed.length === 0
      ? 'Descargada. Ya se puede escuchar sin conexión.'
      : `No se han podido descargar ${result.failed.length} de ${songs.length} canciones.`);
  } catch (error) {
    toast('No se ha podido descargar. Comprueba la conexión y el espacio libre.');
    console.error(error);
  } finally {
    state.downloading.delete(contextId);
    state.cached = await cachedAudioPaths();
    render();
  }
}

// ---------------------------------------------------------------------------
// Rutas
// ---------------------------------------------------------------------------

function parseRoute(hash) {
  const [path] = String(hash ?? '').replace(/^#\/?/, '').split('?');
  const [name = '', rawId = null] = path.split('/');
  let id = null;
  try {
    id = rawId === null ? null : decodeURIComponent(rawId);
  } catch {
    id = null;
  }
  const simple = { '': 'inicio', buscar: 'buscar', biblioteca: 'biblioteca', 'me-gusta': 'me-gusta', canciones: 'canciones', locales: 'locales' };
  if (name in simple) return { name: simple[name], id: null };
  if ((name === 'carpeta' || name === 'lista' || name === 'seccion') && id) return { name, id };
  return { name: 'inicio', id: null };
}

function activeContextId() {
  const { name, id } = state.route;
  if (name === 'carpeta') return `carpeta:${id}`;
  if (name === 'lista') return `lista:${id}`;
  if (name === 'me-gusta' || name === 'canciones' || name === 'locales') return name;
  return null;
}

function goTo(hash, { replace = false } = {}) {
  userNavigated = true;
  if (replace) {
    history.replaceState(null, '', hash);
    onRoute();
  } else if (location.hash === hash) {
    onRoute();
  } else {
    location.hash = hash;
  }
}

// Sección de la navegación que se marca como activa (teléfono: tres destinos; barra lateral: dos).
function navSection(route) {
  if (route.name === 'buscar') return 'buscar';
  if (['biblioteca', 'lista', 'me-gusta', 'locales'].includes(route.name)) return 'biblioteca';
  return 'inicio';
}

function updateNav() {
  const section = navSection(state.route);
  for (const link of document.querySelectorAll('[data-nav]')) {
    const target = link.dataset.nav;
    const active = target === section;
    link.classList.toggle('is-active', active);
    const exact = (target === 'inicio' && state.route.name === 'inicio')
      || (target === 'buscar' && state.route.name === 'buscar')
      || (target === 'biblioteca' && state.route.name === 'biblioteca');
    if (exact) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
    const iconSlot = link.querySelector('[data-icon-active]');
    if (iconSlot) {
      // Los SVG no tienen la propiedad hidden: se cambia el atributo.
      iconSlot.querySelector('.nav-icon-off').toggleAttribute('hidden', active);
      iconSlot.querySelector('.nav-icon-on').toggleAttribute('hidden', !active);
    }
  }
}

function renderSidebar() {
  dom.sidebarActions.replaceChildren(libraryActions(ctx, 'sidebar'));
  dom.sidebarChips.replaceChildren(libraryChips(ctx, 'sidebar'));
  renderLibraryList(dom.sidebarList, ctx, 'sidebar');
}

function pageTitle() {
  const { name } = state.route;
  if (name === 'buscar') return 'Buscar';
  if (name === 'biblioteca') return 'Tu biblioteca';
  if (name === 'seccion') return document.querySelector('#view h1')?.textContent ?? 'Inicio';
  const context = getContext(activeContextId());
  return context ? context.title : 'Inicio';
}

/** Pinta la pantalla activa y la barra lateral, conservando el foco y el desplazamiento si la ruta no cambia. */
function render({ routeChanged = false } = {}) {
  closeMenu({ restoreFocus: false });
  const active = document.activeElement;
  const focusKey = active?.closest?.('[data-key]')?.dataset.key ?? null;
  const selection = active && 'selectionStart' in active && typeof active.selectionStart === 'number'
    ? [active.selectionStart, active.selectionEnd]
    : null;
  const scroll = dom.main.scrollTop;

  const { name, id } = state.route;
  if (!state.ready) {
    // Mientras se leen el catálogo y la biblioteca local (unas décimas de segundo), sin contenido a medias.
    const loading = document.createElement('p');
    loading.className = 'page empty-text';
    loading.setAttribute('role', 'status');
    loading.textContent = 'Cargando la biblioteca…';
    dom.view.replaceChildren(loading);
  } else if (name === 'buscar') renderSearch(dom.view, ctx);
  else if (name === 'biblioteca') renderLibraryPage(dom.view, ctx);
  else if (name === 'seccion') {
    if (!renderSection(dom.view, ctx, id)) renderHome(dom.view, ctx);
  } else if (name === 'inicio') renderHome(dom.view, ctx);
  else renderCollection(dom.view, ctx, activeContextId());
  renderSidebar();
  updateNav();
  dom.offline.hidden = state.online;
  document.title = name === 'inicio' ? APP_NAME : `${pageTitle()} · ${APP_NAME}`;
  syncPlaying(true);

  if (routeChanged) {
    dom.main.scrollTop = 0;
    if (userNavigated) document.querySelector('#view h1')?.focus({ preventScroll: true });
    return;
  }
  dom.main.scrollTop = scroll;
  if (focusKey) {
    const target = [...document.querySelectorAll('[data-key]')].find((node) => node.dataset.key === focusKey);
    if (target && target !== document.activeElement) {
      target.focus({ preventScroll: true });
      if (selection && 'setSelectionRange' in target) {
        try {
          target.setSelectionRange(selection[0], selection[1]);
        } catch {
          // Algunos tipos de campo no admiten selección.
        }
      }
    }
  }
}

function onRoute() {
  const next = parseRoute(location.hash);
  const changed = next.name !== state.route.name || next.id !== state.route.id;
  state.route = next;
  if (changed) state.addQuery = '';
  render({ routeChanged: changed || userNavigated });
}

// ---------------------------------------------------------------------------
// Contexto que reciben las pantallas
// ---------------------------------------------------------------------------

const ctx = {
  state,
  get player() {
    return player;
  },
  songColor,
  folderName: (id) => state.catalog.folderById.get(id)?.name ?? null,
  folderContext,
  playlistContext,
  folderContexts,
  playlistContexts,
  libraryContexts,
  getContext,
  activeContextId,
  localSongs: () => localSongsOf(state.catalog),
  isPlayable,
  isLiked: (songId) => state.likes.has(songId),
  likeButtonFor: (track, testid, size) => likeButton(ctx, track, { testid, size }),
  isContextPlaying,
  toggleContext,
  playSongs,
  toggleShuffle: () => player.setShuffle(!player.getState().shuffle),
  cycleRepeat: () => player.setRepeat(nextRepeatMode(player.getState().repeat)),
  setVolume: (value) => player.setVolume(value),
  toggleLike,
  createPlaylist,
  renamePlaylist,
  deletePlaylist,
  addToPlaylist,
  removeFromPlaylist,
  addToQueue,
  deleteLocalSong,
  onLocalAdded,
  toggleDownload,
  openUpload: () => openUploadSheet(ctx),
  setLibraryFilter: (filter) => {
    state.libraryFilter = filter;
    render();
  },
  navigate: (hash) => goTo(hash),
};

// ---------------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------------

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return response.json();
}

async function loadPublicCatalog() {
  const [songs, folders] = await Promise.allSettled([fetchJson(DATA_URLS.songs), fetchJson(DATA_URLS.folders)]);
  state.publicSongs = songs.status === 'fulfilled' && Array.isArray(songs.value) ? songs.value : [];
  state.publicFolders = folders.status === 'fulfilled' && Array.isArray(folders.value) ? folders.value : [];
  state.loadError = songs.status === 'fulfilled' ? null : 'No se ha podido cargar la biblioteca. Comprueba la conexión y vuelve a intentarlo.';
}

async function start() {
  dom.main = document.getElementById('main');
  dom.view = document.getElementById('view');
  dom.sidebarActions = document.getElementById('sidebar-actions');
  dom.sidebarChips = document.getElementById('sidebar-chips');
  dom.sidebarList = document.getElementById('sidebar-list');
  dom.offline = document.getElementById('offline-banner');

  const prefs = readPlayerPrefs();
  player = createPlayer({
    audio: document.getElementById('audio'),
    isAvailable: (track) => isPlayable({ ...track, audio: track.audioUrl }),
    onChange: onPlayerChange,
    onNotice: (text) => toast(text),
    volume: prefs.volume ?? 1,
    shuffle: prefs.shuffle === true,
    repeat: prefs.repeat ?? 'off',
  });
  playerUi = mountPlayerUi(ctx, {
    bar: document.getElementById('player-bar'),
    mini: document.getElementById('mini-player'),
    queuePanel: document.getElementById('queue-panel'),
  });
  playerUi.update(player.getState());

  // El enlace de salto no cambia el hash (que es la ruta): solo lleva el foco al contenido.
  document.querySelector('.skip-link')?.addEventListener('click', (event) => {
    event.preventDefault();
    dom.main.focus();
  });
  window.addEventListener('hashchange', () => {
    userNavigated = true;
    onRoute();
  });
  // Un clic en un enlace interno cuenta como navegación (aunque lleve al mismo hash).
  document.addEventListener('click', (event) => {
    const link = event.target.closest?.('a[href^="#/"], a[href="#/"]');
    if (link) userNavigated = true;
  }, true);
  const setOnline = () => {
    state.online = navigator.onLine !== false;
    render();
    playerUi.update(player.getState());
  };
  window.addEventListener('online', setOnline);
  window.addEventListener('offline', setOnline);

  state.route = parseRoute(location.hash);
  render();

  registerPwa().catch(() => {});
  library = await openLocalLibrary();
  const [, localSongs, cached] = await Promise.all([loadPublicCatalog(), loadLocalSongs(), cachedAudioPaths()]);
  state.localSongs = localSongs;
  state.cached = cached;
  rebuildCatalog();
  state.playlists = await library.listPlaylists();
  state.likes = await library.listLikes();
  if (!library.persistent) toast('Este navegador no deja guardar las listas: se perderán al cerrar la página.', { ms: 8000 });
  state.ready = true;
  render();
  document.documentElement.dataset.ready = 'true';
}

start().catch((error) => {
  console.error('Reminiscencia: fallo al arrancar.', error);
  const view = document.getElementById('view');
  if (view) view.textContent = 'No se ha podido abrir Reminiscencia. Recarga la página.';
});
