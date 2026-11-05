// Arranque de Reminiscencia (ADR-0015): una sola biblioteca pública para todos, sin perfiles ni modos, con la
// distribución del reproductor web de Spotify: barra superior (nombre, Inicio y buscador), tres paneles («Tu
// biblioteca», el contenido y «Reproduciendo») y el reproductor abajo; en el teléfono, barra inferior y
// minirreproductor. Las listas propias y «Me gusta» viven solo en este navegador (js/local-library.js) y las
// canciones subidas aquí, en su propia base (js/cuidador/subida-local.js).
//
// Este módulo guarda el estado, enruta por hash (#/, #/buscar, #/biblioteca, #/album/<id> —también el antiguo
// #/carpeta/<id>—, #/lista/<id>, #/me-gusta, #/canciones, #/locales y #/seccion/<estante>), pinta la pantalla activa y
// «Tu biblioteca», y conecta el reproductor con la interfaz. Al abrir la página no se mueve el foco (el primer Tab
// llega al enlace de salto); al cambiar de pantalla por una acción, el foco va al H1.

import {
  albumYear,
  ALL_SONGS_COLOR,
  buildCatalog,
  childFolders,
  coverColor,
  LIKED_COLOR,
  LOCAL_COLOR,
  localSongsOf,
  pendingSongsOf,
  songCountText,
  songCover,
  songsInFolder,
} from './catalog.js';
import { cachedDominantColor } from './cover-color.js';
import { isSongId } from './cuidador/incidencias.js';
import { openLocalLibrary } from './local-library.js';
import { createPlayer, nextRepeatMode } from './player.js';
import { cachedAudioPaths, registerPwa, removeOfflineSongs, saveLibraryOffline } from './pwa.js';
import {
  convertToOpus,
  deleteLocalSong as removeLocalRecord,
  loadLocalSongs,
  markLocalPublished,
  readLocalBytes,
  saveUploadCopy,
} from './cuidador/subida-local.js';
import { sendOpus } from './cuidador/subida-publica.js';
import { expandSelection } from './cuidador/subida-zip.js';
import {
  activeCount,
  createUploadTracker,
  indicatorText,
  publishedNotice,
  songsFetcher,
  STATES as UPLOAD_STATES,
} from './cuidador/subida-estado.js';
import { closeMenu, confirmDialog, el, toast } from './ui/dom.js';
import { icon } from './ui/icons.js';
import { DOT, likeButton, setPlayButtonState } from './views/components.js';
import {
  openCoverSheet,
  openCreateAlbumSheet,
  openEditAlbumSheet,
  openEditSongSheet,
  openAddSongsToAlbumSheet,
  openMoveToAlbumSheet,
  openPlaylistEditor,
  openRemoveFromAlbumSheet,
} from './views/edit.js';
import { renderHome } from './views/home.js';
import { refreshSearchResults, renderSearch } from './views/search.js';
import { renderCollection } from './views/collection.js';
import { libraryPanel, renderLibraryPage, renderSection } from './views/library.js';
import { mountPlayerUi } from './views/player-ui.js';
import { openUploadSheet } from './views/upload.js';
import { openHomeostasiaSheet } from './views/homeostasia.js';

const DATA_URLS = Object.freeze({ songs: 'data/songs.json', folders: 'data/folders.json' });
const PLAYER_PREFS_KEY = 'reminiscencia.reproductor';
const RECENTS_KEY = 'reminiscencia.recientes';
const LIBRARY_PREFS_KEY = 'reminiscencia.biblioteca';
const APP_NAME = 'Reminiscencia';
const OWNER = 'Reminiscencia';
const LIBRARY_WIDTH = Object.freeze({ min: 280, max: 420, step: 16 });
const RECENTS_MAX = 50;

// ---------------------------------------------------------------------------
// Preferencias (solo comodidad: si el navegador no deja guardar, valen durante la visita)
// ---------------------------------------------------------------------------

function readJson(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Almacenamiento bloqueado: no pasa nada.
  }
}

const libraryPrefs = readJson(LIBRARY_PREFS_KEY);

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
  recents: new Map(Object.entries(readJson(RECENTS_KEY)).filter(([, time]) => Number.isFinite(time))),
  online: typeof navigator === 'undefined' ? true : navigator.onLine !== false,
  homeFilter: 'todo',
  libraryFilter: null,
  libraryQuery: '',
  librarySearchOpen: false,
  librarySort: ['recientes', 'alfabetico', 'creador'].includes(libraryPrefs.sort) ? libraryPrefs.sort : 'recientes',
  searchQuery: '',
  searchFilter: 'todo',
  addQuery: '',
  route: { name: 'inicio', id: null },
  ready: false,
};

let library = null;
let player = null;
let playerUi = null;
let userNavigated = false;
let keepFocusOnce = false;
let persistenceRequested = false;
let lastSync = '';
let uploads = null;
let uploadSignature = '';
// Copias locales de subidas ya publicadas que se borran en cuanto dejan de sonar (id → URL de su audio).
const retiredCopies = new Map();

const dom = {};

function rebuildCatalog() {
  state.catalog = buildCatalog(state.publicSongs, state.publicFolders, state.localSongs);
}

function savePlayerPrefs(playerState) {
  writeJson(PLAYER_PREFS_KEY, { volume: playerState.volume, shuffle: playerState.shuffle, repeat: playerState.repeat });
}

// ---------------------------------------------------------------------------
// Canciones y colecciones (contextos de reproducción)
// ---------------------------------------------------------------------------

function songColor(song) {
  if (song.local) return LOCAL_COLOR;
  return coverColor(song.folderId ?? song.id);
}

const songCoverSrc = (song) => (song?.local ? null : songCover(state.catalog, song));
/** Etiqueta de una subida que se está publicando: «Publicándose…» o, si ha fallado, «No se ha podido subir». */
function uploadLabel(song) {
  return uploads?.byLocalId(song.id)?.state === UPLOAD_STATES.ERROR ? 'No se ha podido subir' : 'Publicándose…';
}
const isPendingSong = (song) => Boolean(song && (song.pending ?? state.catalog.songById.get(song.id)?.pending));
const artistOf = (song) => {
  if (isPendingSong(song)) return uploadLabel(song);
  return song.artist || (song.local ? 'Subida a este navegador' : 'Artista desconocido');
};
const albumHref = (id) => `#/album/${encodeURIComponent(id)}`;

/** Color de una colección para los degradados: el dominante de su portada si ya se conoce; si no, el generado. */
function colorOf(item) {
  const src = item.cover ?? item.mosaic?.[0] ?? null;
  return (src && cachedDominantColor(src)) || item.color;
}

function albumContext(folder) {
  const songs = songsInFolder(state.catalog, folder.id);
  return {
    contextId: `album:${folder.id}`,
    kind: 'album',
    title: folder.name,
    owner: folder.artist || null,
    subtitle: `Álbum${DOT}${folder.artist || OWNER}`,
    cardSubtitle: folder.artist || songCountText(songs.length),
    href: albumHref(folder.id),
    color: coverColor(folder.id),
    iconName: 'album',
    cover: folder.cover,
    mosaic: null,
    year: albumYear(songs),
  };
}

function playlistSongs(list) {
  return list.songIds.map((id) => state.catalog.songById.get(id)).filter(Boolean);
}

/** Portada de una lista: la propia; si no, un mosaico de cuatro portadas distintas o la primera que haya. */
function playlistArt(list, songs) {
  if (list.cover) return { cover: list.cover, mosaic: null };
  const covers = [...new Set(songs.map(songCoverSrc).filter(Boolean))];
  if (covers.length >= 4) return { cover: null, mosaic: covers.slice(0, 4) };
  return { cover: covers[0] ?? null, mosaic: null };
}

function playlistContext(list) {
  const songs = playlistSongs(list);
  return {
    contextId: `lista:${list.id}`,
    kind: 'playlist',
    title: list.name,
    owner: OWNER,
    description: list.description || '',
    subtitle: `Lista${DOT}${OWNER}`,
    cardSubtitle: list.description || `Lista${DOT}${songCountText(songs.length)}`,
    href: `#/lista/${encodeURIComponent(list.id)}`,
    color: coverColor(list.id),
    iconName: 'list',
    ...playlistArt(list, songs),
  };
}

function likedSongs() {
  return [...state.likes.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => state.catalog.songById.get(id))
    .filter(Boolean);
}

function likedContext() {
  const count = songCountText(likedSongs().length);
  return {
    contextId: 'me-gusta',
    kind: 'liked',
    title: 'Me gusta',
    owner: OWNER,
    subtitle: `Lista${DOT}${count}`,
    cardSubtitle: `Lista${DOT}${count}`,
    href: '#/me-gusta',
    color: LIKED_COLOR,
    iconName: 'heart-filled',
    cover: null,
    mosaic: null,
  };
}

function allSongsContext() {
  const count = songCountText(state.catalog.songs.length);
  return {
    contextId: 'canciones',
    kind: 'all',
    title: 'Todas las canciones',
    owner: OWNER,
    subtitle: `Biblioteca${DOT}${count}`,
    cardSubtitle: count,
    href: '#/canciones',
    color: ALL_SONGS_COLOR,
    iconName: 'note',
    cover: null,
    mosaic: null,
  };
}

function localContext() {
  const count = songCountText(localSongsOf(state.catalog).length);
  return {
    contextId: 'locales',
    kind: 'local',
    title: 'Subidas a este navegador',
    owner: 'Solo aquí',
    subtitle: `Solo aquí${DOT}${count}`,
    cardSubtitle: count,
    href: '#/locales',
    color: LOCAL_COLOR,
    iconName: 'device',
    cover: null,
    mosaic: null,
  };
}

/** «Tus subidas»: las canciones subidas para todos que todavía se están publicando (suenan desde su copia local). */
function uploadsContext() {
  const songs = pendingSongsOf(state.catalog);
  const count = songCountText(songs.length);
  const label = songs.some((song) => uploadLabel(song) !== 'Publicándose…') ? 'Subidas' : 'Publicándose…';
  return {
    contextId: 'subidas',
    kind: 'uploads',
    title: 'Tus subidas',
    owner: 'Solo aquí',
    subtitle: `${label}${DOT}${count}`,
    cardSubtitle: `${label}${DOT}${count}`,
    href: '#/subidas',
    color: LOCAL_COLOR,
    iconName: 'upload',
    cover: null,
    mosaic: null,
  };
}

/** Álbumes de la raíz (parentId null), de un álbum padre o, con undefined, todos. */
function albumContexts(parentId) {
  const folders = parentId === undefined ? state.catalog.folders : childFolders(state.catalog, parentId);
  return folders.map(albumContext);
}

function playlistContexts() {
  return state.playlists.map(playlistContext);
}

/** Elementos de la biblioteca: «Me gusta», (todas), las subidas aquí, las listas y todos los álbumes. */
function libraryContexts({ includeAll = false } = {}) {
  const items = [likedContext()];
  if (pendingSongsOf(state.catalog).length > 0) items.push(uploadsContext());
  if (includeAll && state.catalog.songs.length > 0) items.push(allSongsContext());
  if (localSongsOf(state.catalog).length > 0) items.push(localContext());
  items.push(...playlistContexts());
  items.push(...albumContexts(undefined));
  return items;
}

/** Colección completa por su id de contexto, con sus canciones, o null si no existe. */
function getContext(contextId) {
  if (typeof contextId !== 'string') return null;
  if (contextId === 'me-gusta') return { ...likedContext(), typeLabel: 'Lista', songs: likedSongs() };
  if (contextId === 'canciones') return { ...allSongsContext(), typeLabel: 'Biblioteca', songs: state.catalog.songs };
  if (contextId === 'locales') return { ...localContext(), typeLabel: 'Canciones locales', songs: localSongsOf(state.catalog) };
  if (contextId === 'subidas') return { ...uploadsContext(), typeLabel: 'Subidas', songs: pendingSongsOf(state.catalog) };
  if (contextId.startsWith('album:')) {
    const folder = state.catalog.folderById.get(contextId.slice('album:'.length));
    if (!folder) return null;
    return {
      ...albumContext(folder),
      typeLabel: 'Álbum',
      folder,
      songs: songsInFolder(state.catalog, folder.id),
      subfolders: childFolders(state.catalog, folder.id).map(albumContext),
    };
  }
  if (contextId.startsWith('lista:')) {
    const list = state.playlists.find((item) => item.id === contextId.slice('lista:'.length));
    if (!list) return null;
    return { ...playlistContext(list), typeLabel: 'Lista', playlist: list, songs: playlistSongs(list) };
  }
  return null;
}

const EXTRA_CONTEXT_NAMES = Object.freeze({ busqueda: 'Búsqueda', recientes: 'Añadidas recientemente' });

/** Colecciones escuchadas, de la más reciente a la más antigua (solo las que siguen existiendo). */
function recentContexts() {
  return [...state.recents.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => getContext(id))
    .filter(Boolean);
}

/** Accesos rápidos de Inicio: lo escuchado hace poco y, después, «Me gusta», las listas y los álbumes. */
function quickContexts() {
  const seen = new Set();
  return [...recentContexts(), ...libraryContexts({ includeAll: true })].filter((item) => {
    if (seen.has(item.contextId)) return false;
    seen.add(item.contextId);
    return true;
  });
}

/** Orden de «Tu biblioteca». «Me gusta» va siempre arriba (fijada, como en Spotify) y, debajo, «Tus subidas». */
function sortContexts(items, sort) {
  const pinned = items.filter((item) => item.kind === 'liked' || item.kind === 'uploads');
  const rest = items.filter((item) => item.kind !== 'liked' && item.kind !== 'uploads');
  const byTitle = (a, b) => a.title.localeCompare(b.title, 'es', { sensitivity: 'base' });
  if (sort === 'alfabetico') rest.sort(byTitle);
  else if (sort === 'creador') rest.sort((a, b) => (a.owner ?? OWNER).localeCompare(b.owner ?? OWNER, 'es', { sensitivity: 'base' }) || byTitle(a, b));
  else {
    const order = new Map(rest.map((item, index) => [item.contextId, index]));
    rest.sort((a, b) => (state.recents.get(b.contextId) ?? 0) - (state.recents.get(a.contextId) ?? 0) || order.get(a.contextId) - order.get(b.contextId));
  }
  return [...pinned, ...rest];
}

function rememberContext(contextId) {
  if (!getContext(contextId)) return;
  state.recents.set(contextId, Date.now());
  const kept = [...state.recents.entries()].sort((a, b) => b[1] - a[1]).slice(0, RECENTS_MAX);
  state.recents = new Map(kept);
  writeJson(RECENTS_KEY, Object.fromEntries(kept));
}

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
    // La portada ya resuelta (la de la canción o la de su álbum): la usan la barra y Media Session.
    cover: songCoverSrc(song),
    durationS: song.durationS,
    local: song.local,
  };
}

function playSongs(songs, index, { contextId = null } = {}) {
  const name = getContext(contextId)?.title ?? EXTRA_CONTEXT_NAMES[contextId] ?? '';
  rememberContext(contextId);
  player.load(songs.map(trackOf), index, { contextId, contextName: name, autoplay: true });
  // «Recientes» de Tu biblioteca cambia de orden: se vuelve a pintar el panel (no la pantalla).
  if (state.ready && state.librarySort === 'recientes') renderSidebar();
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

/** Marca lo que suena: botones verdes, filas, tarjetas y elementos de la biblioteca. Solo trabaja si cambia algo. */
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
  for (const item of document.querySelectorAll('.library-item, .tile')) {
    const isCurrent = current.track && item.dataset.context === current.contextId;
    item.classList.toggle('is-current', Boolean(isCurrent));
    item.classList.toggle('is-playing', Boolean(isCurrent && current.playing));
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
  if (retiredCopies.size > 0) deleteRetiredCopies();
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
  playerUi?.update(player.getState());
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
}

/** «Me gusta» de una colección entera: marca o quita todas sus canciones. */
async function setLikedMany(songIds, liked) {
  requestPersistence();
  try {
    for (const id of songIds) {
      if (state.likes.has(id) !== liked) await library.setLiked(id, liked);
    }
    toast(liked ? 'Se han guardado en Me gusta.' : 'Se han quitado de Me gusta.');
  } catch (error) {
    toast('No se ha podido guardar el cambio en este navegador.');
    console.error(error);
  }
  await refreshLibrary();
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

/** Guarda nombre, descripción y portada de una lista. Resuelve true si se ha guardado. */
async function updatePlaylist(id, changes) {
  requestPersistence();
  try {
    await library.updatePlaylist(id, changes);
  } catch (error) {
    toast(error instanceof Error ? error.message : 'No se ha podido guardar la lista.');
    return false;
  }
  await refreshLibrary();
  toast('Se han guardado los cambios.');
  return true;
}

function editPlaylist(id) {
  const list = state.playlists.find((item) => item.id === id);
  if (list) openPlaylistEditor(ctx, list);
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
  state.recents.delete(`lista:${id}`);
  writeJson(RECENTS_KEY, Object.fromEntries(state.recents));
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

function addManyToQueue(songs) {
  for (const song of songs) player.addToQueue(trackOf(song));
  toast(songs.length === 1 ? 'Se ha añadido a la cola.' : `Se han añadido ${songs.length} canciones a la cola.`);
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
  const simple = { '': 'inicio', buscar: 'buscar', biblioteca: 'biblioteca', 'me-gusta': 'me-gusta', canciones: 'canciones', locales: 'locales', subidas: 'subidas' };
  if (name in simple) return { name: simple[name], id: null };
  // #/carpeta/<id> es la ruta anterior de un álbum: se conserva para los enlaces guardados.
  if ((name === 'album' || name === 'carpeta') && id) return { name: 'album', id };
  if ((name === 'lista' || name === 'seccion') && id) return { name, id };
  return { name: 'inicio', id: null };
}

function activeContextId() {
  const { name, id } = state.route;
  if (name === 'album') return `album:${id}`;
  if (name === 'lista') return `lista:${id}`;
  if (name === 'me-gusta' || name === 'canciones' || name === 'locales' || name === 'subidas') return name;
  return null;
}

function goTo(hash, { replace = false, keepFocus = false } = {}) {
  userNavigated = true;
  keepFocusOnce = keepFocus;
  if (replace) {
    history.replaceState(null, '', hash);
    onRoute();
  } else if (location.hash === hash) {
    onRoute();
  } else {
    location.hash = hash;
  }
}

function goBack() {
  if (userNavigated && history.length > 1) history.back();
  else goTo('#/');
}

// Sección de la navegación que se marca como activa (teléfono: tres destinos; barra superior: Inicio y Explorar).
function navSection(route) {
  if (route.name === 'buscar') return 'buscar';
  if (['biblioteca', 'lista', 'me-gusta', 'locales', 'subidas'].includes(route.name)) return 'biblioteca';
  if (route.name === 'inicio') return 'inicio';
  return null;
}

function updateNav() {
  const section = navSection(state.route);
  for (const link of document.querySelectorAll('[data-nav]')) {
    const active = link.dataset.nav === section;
    link.classList.toggle('is-active', active);
    if (active && link.dataset.nav === state.route.name) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
    const iconSlot = link.querySelector('[data-icon-active]');
    if (iconSlot) {
      // Los SVG no tienen la propiedad hidden: se cambia el atributo.
      iconSlot.querySelector('.nav-icon-off').toggleAttribute('hidden', active);
      iconSlot.querySelector('.nav-icon-on').toggleAttribute('hidden', !active);
    }
  }
}

function syncTopSearch() {
  if (document.activeElement !== dom.topInput && dom.topInput.value !== state.searchQuery) dom.topInput.value = state.searchQuery;
  dom.topClear.hidden = dom.topInput.value === '';
}

function pageTitle() {
  const { name } = state.route;
  if (name === 'buscar') return 'Buscar';
  if (name === 'biblioteca') return 'Tu biblioteca';
  if (name === 'seccion') return document.querySelector('#view h1')?.textContent ?? 'Inicio';
  const context = getContext(activeContextId());
  return context ? context.title : 'Inicio';
}

/** Marca la cabecera de las tablas cuando se queda fija arriba (fondo y borde, como en Spotify). */
function updateStickyHeads() {
  const top = dom.main.getBoundingClientRect().top;
  for (const head of dom.view.querySelectorAll('.track-table thead')) {
    const rect = head.parentElement.getBoundingClientRect();
    head.classList.toggle('is-stuck', rect.top < top - 1 && rect.bottom > top + 60);
  }
}

/** Pinta «Tu biblioteca» en el panel izquierdo, conservando su desplazamiento y el foco. */
function renderSidebar() {
  const sidebarScroll = dom.sidebar.querySelector('.library-list')?.scrollTop ?? 0;
  const active = document.activeElement;
  const focusKey = dom.sidebar.contains(active) ? active.closest?.('[data-key]')?.dataset.key ?? null : null;
  dom.sidebar.replaceChildren(...libraryPanel(ctx, 'sidebar'), dom.uploadIndicator, dom.resize);
  const list = dom.sidebar.querySelector('.library-list');
  if (list) list.scrollTop = sidebarScroll;
  syncPlaying(true);
  if (focusKey) focusByKey(focusKey);
}

/** Pinta la pantalla activa y «Tu biblioteca», conservando el foco y el desplazamiento si la ruta no cambia. */
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
  syncTopSearch();
  dom.offline.hidden = state.online;
  document.title = name === 'inicio' ? APP_NAME : `${pageTitle()} · ${APP_NAME}`;
  syncPlaying(true);

  if (routeChanged) {
    dom.main.scrollTop = 0;
    // Quien escribe en el buscador de la barra superior sigue en él al llegar a Buscar.
    if (userNavigated && !keepFocusOnce && document.activeElement !== dom.topInput) document.querySelector('#view h1')?.focus({ preventScroll: true });
    keepFocusOnce = false;
    updateStickyHeads();
    return;
  }
  dom.main.scrollTop = scroll;
  updateStickyHeads();
  if (focusKey) focusByKey(focusKey, selection);
}

function focusByKey(key, selection = null) {
  const target = [...document.querySelectorAll('[data-key]')].find((node) => node.dataset.key === key && node.getClientRects().length > 0);
  if (!target || target === document.activeElement) return;
  target.focus({ preventScroll: true });
  if (selection && 'setSelectionRange' in target) {
    try {
      target.setSelectionRange(selection[0], selection[1]);
    } catch {
      // Algunos tipos de campo no admiten selección.
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
// Buscador de la barra superior y ancho de «Tu biblioteca»
// ---------------------------------------------------------------------------

function setSearchQuery(value) {
  state.searchQuery = value;
  syncTopSearch();
  if (state.route.name !== 'buscar') {
    if (value.trim() !== '') goTo('#/buscar', { keepFocus: true });
    return;
  }
  refreshSearchResults(dom.view, ctx);
  syncPlaying(true);
}

function mountTopSearch() {
  dom.topInput.addEventListener('input', () => setSearchQuery(dom.topInput.value));
  dom.topInput.closest('form').addEventListener('submit', (event) => {
    event.preventDefault();
    if (state.route.name !== 'buscar') goTo('#/buscar', { keepFocus: true });
  });
  dom.topInput.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && dom.topInput.value !== '') {
      event.preventDefault();
      dom.topInput.value = '';
      setSearchQuery('');
    }
  });
  dom.topClear.addEventListener('click', () => {
    dom.topInput.value = '';
    setSearchQuery('');
    dom.topInput.focus();
  });
}

function setLibraryWidth(width, { save = true } = {}) {
  const value = Math.round(Math.min(LIBRARY_WIDTH.max, Math.max(LIBRARY_WIDTH.min, width)));
  dom.app.style.setProperty('--lib-w', `${value}px`);
  dom.resize.setAttribute('aria-valuenow', String(value));
  if (save) {
    libraryPrefs.width = value;
    writeJson(LIBRARY_PREFS_KEY, libraryPrefs);
  }
}

/** Separador entre «Tu biblioteca» y el contenido: se arrastra o se mueve con las flechas (de 280 a 420 px). */
function mountResize() {
  if (Number.isFinite(libraryPrefs.width)) setLibraryWidth(libraryPrefs.width, { save: false });
  const current = () => dom.sidebar.getBoundingClientRect().width;
  dom.resize.setAttribute('aria-valuenow', String(Math.round(current()) || LIBRARY_WIDTH.min));
  dom.resize.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    dom.resize.setPointerCapture?.(event.pointerId);
    const left = dom.sidebar.getBoundingClientRect().left;
    const move = (moveEvent) => setLibraryWidth(moveEvent.clientX - left, { save: false });
    const up = (upEvent) => {
      dom.resize.removeEventListener('pointermove', move);
      dom.resize.removeEventListener('pointerup', up);
      dom.resize.removeEventListener('pointercancel', up);
      setLibraryWidth(upEvent.clientX - left);
    };
    dom.resize.addEventListener('pointermove', move);
    dom.resize.addEventListener('pointerup', up);
    dom.resize.addEventListener('pointercancel', up);
  });
  dom.resize.addEventListener('keydown', (event) => {
    const width = current();
    const moves = { ArrowLeft: width - LIBRARY_WIDTH.step, ArrowRight: width + LIBRARY_WIDTH.step, Home: LIBRARY_WIDTH.min, End: LIBRARY_WIDTH.max };
    if (!(event.key in moves)) return;
    event.preventDefault();
    setLibraryWidth(moves[event.key]);
  });
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
  songCoverSrc,
  artistOf,
  uploadLabel,
  colorOf,
  folderName: (id) => state.catalog.folderById.get(id)?.name ?? null,
  albumContext,
  playlistContext,
  albumContexts,
  playlistContexts,
  libraryContexts,
  quickContexts,
  recentContexts,
  sortContexts,
  getContext,
  activeContextId,
  localSongs: () => localSongsOf(state.catalog),
  isPlayable,
  isLiked: (songId) => state.likes.has(songId),
  isEditableSong: (song) => !song.local && isSongId(song.id),
  likeButtonFor: (track, testid, size) => likeButton(ctx, track, { testid, size }),
  isContextPlaying,
  toggleContext,
  playSongs,
  toggleShuffle: () => player.setShuffle(!player.getState().shuffle),
  cycleRepeat: () => player.setRepeat(nextRepeatMode(player.getState().repeat)),
  setVolume: (value) => player.setVolume(value),
  toggleLike,
  setLikedMany,
  createPlaylist,
  updatePlaylist,
  editPlaylist,
  deletePlaylist,
  addToPlaylist,
  removeFromPlaylist,
  addToQueue,
  addManyToQueue,
  deleteLocalSong,
  toggleDownload,
  editSong: (song) => openEditSongSheet(ctx, song),
  moveSongToAlbum: (song) => openMoveToAlbumSheet(ctx, song),
  removeSongFromAlbum: (song, folderId) => {
    const folder = state.catalog.folderById.get(folderId);
    return folder ? openRemoveFromAlbumSheet(ctx, song, folder) : null;
  },
  addSongsToAlbum: (folder) => openAddSongsToAlbumSheet(ctx, folder),
  createAlbum: () => openCreateAlbumSheet(ctx),
  editAlbum: (folder) => openEditAlbumSheet(ctx, folder),
  changeCover: (target) => openCoverSheet(ctx, target),
  openUpload: () => openUploadSheet(ctx),
  openHomeostasia: () => openHomeostasiaSheet(ctx),
  addUploads: (files, options) => addUploads(files, options),
  get uploads() {
    return uploads;
  },
  /** Reproduce una canción ya publicada desde la hoja de subida. */
  playSongById: (songId) => {
    const song = state.catalog.songById.get(songId);
    if (!song) return false;
    playSongs([song], 0, { contextId: null });
    return true;
  },
  setSearchQuery,
  setSearchFilter: (filter) => {
    state.searchFilter = filter;
    refreshSearchResults(dom.view, ctx);
    syncPlaying(true);
    focusByKey(`search-chip-${filter}`);
  },
  setHomeFilter: (filter) => {
    state.homeFilter = filter;
    render();
  },
  setLibraryFilter: (filter) => {
    state.libraryFilter = filter;
    render();
  },
  setLibrarySort: (sort) => {
    state.librarySort = sort;
    libraryPrefs.sort = sort;
    writeJson(LIBRARY_PREFS_KEY, libraryPrefs);
    render();
  },
  setLibrarySearch: ({ open, query, focus = null }) => {
    state.librarySearchOpen = open;
    state.libraryQuery = query;
    render();
    if (focus) focusByKey(focus);
  },
  navigate: (hash) => goTo(hash),
  goBack,
};

// ---------------------------------------------------------------------------
// Subidas para todos (js/cuidador/subida-estado.js): siguen aunque se cierre la hoja
// ---------------------------------------------------------------------------

function safeLocalStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Indicador discreto de «Tu biblioteca» (barra lateral): «Publicándose 1 canción». Abre la hoja. */
function createUploadIndicator() {
  const text = el('span', { class: 'upload-indicator-text' });
  const button = el('button', {
    type: 'button',
    class: 'upload-indicator',
    'data-testid': 'upload-indicator',
    hidden: true,
    on: { click: () => openUploadSheet(ctx) },
  }, el('span', { class: 'upload-indicator-dot', 'aria-hidden': 'true' }), icon('upload', { size: 16 }), text);
  return { button, text };
}

function onUploadsChange(items) {
  const count = activeCount(items);
  dom.uploadIndicatorText.textContent = indicatorText(count);
  dom.uploadIndicator.hidden = count === 0;
  dom.uploadIndicator.setAttribute('aria-label', `${indicatorText(count)}. Ver las subidas`);
  // Solo los cambios de estado (no los porcentajes) cambian las etiquetas de la biblioteca.
  const signature = items.map((item) => `${item.localId}:${item.state}`).join('|');
  if (signature !== uploadSignature) {
    uploadSignature = signature;
    if (state.ready) render();
  }
}

/** Borra las copias locales de subidas ya publicadas que no estén sonando. */
function deleteRetiredCopies() {
  const current = document.getElementById('audio')?.src ?? '';
  for (const [id, url] of [...retiredCopies]) {
    if (url && current === new URL(url, location.href).href) continue;
    retiredCopies.delete(id);
    removeLocalRecord(id).catch(() => {});
  }
}

/**
 * Las subidas que ya están en /data/songs.json: la biblioteca se pone al día sin recargar, la copia local se
 * sustituye por la canción pública (en «Me gusta», en las listas y en el reproductor, sin cortar lo que suena) y se
 * avisa: «“<título>” ya está en la biblioteca».
 */
async function applyPublished(found, songs) {
  if (Array.isArray(songs)) state.publicSongs = songs;
  try {
    const folders = await fetchJson(DATA_URLS.folders, { cache: 'no-store' });
    if (Array.isArray(folders)) state.publicFolders = folders;
  } catch {
    // Sin carpetas nuevas: valen las de antes.
  }
  const replaced = [];
  for (const { item, song } of found) {
    if (!item.localId) continue;
    const copy = state.localSongs.find((local) => local.id === item.localId);
    state.localSongs = state.localSongs.filter((local) => local.id !== item.localId);
    replaced.push({ localId: item.localId, songId: song.id, audio: copy?.audio ?? null });
  }
  rebuildCatalog();
  for (const { localId, songId, audio } of replaced) {
    const publicSong = state.catalog.songById.get(songId);
    if (publicSong) player.replaceTrack(localId, trackOf(publicSong));
    try {
      await library.replaceSong(localId, songId);
    } catch (error) {
      console.error('Reminiscencia: no se han podido pasar los «Me gusta» y las listas a la canción publicada.', error);
    }
    await markLocalPublished(localId, songId);
    retiredCopies.set(localId, audio);
  }
  deleteRetiredCopies();
  await refreshLibrary();
  toast(publishedNotice(found.map(({ song }) => song.title)), { ms: 6000 });
}

function createUploads() {
  return createUploadTracker({
    convert: (file, { onProgress }) => convertToOpus(file, { limits: false, checkStorage: false, onProgress }),
    saveCopy: (data) => saveUploadCopy(data),
    readCopy: (id) => readLocalBytes(id),
    send: (bytes, { fileName, album, artist, onChunk }) => sendOpus(bytes, { fileName, uploadId: crypto.randomUUID(), album, artist, onChunk }),
    fetchSongs: songsFetcher((url, init) => fetch(url, init), DATA_URLS.songs),
    currentIds: () => state.publicSongs.map((song) => song?.id),
    onCopy: (song) => {
      // La canción sale ya en la biblioteca, con la etiqueta «Publicándose…», y se puede escuchar.
      state.localSongs = [...state.localSongs, song];
      rebuildCatalog();
      if (state.ready) render();
    },
    onPublished: applyPublished,
    storage: safeLocalStorage(),
  });
}

// Las selecciones se preparan en orden (abrir el directorio de un ZIP es asíncrono): así, una segunda selección hecha
// mientras se abre un ZIP grande no se cuela delante.
let pendingSelection = Promise.resolve();

/**
 * Archivos elegidos en la hoja: a la cola de subidas, con el título del nombre del archivo. Cada ZIP se abre aquí (solo
 * su directorio) y cada canción suya entra como una subida de su grupo (subida-zip.js); el ZIP no se sube.
 */
function addUploads(files, { album = null, trackArtists = [] } = {}) {
  requestPersistence();
  const list = Array.from(files ?? []);
  const run = pendingSelection.then(async () => uploads.addSources(await expandSelection(list), { album, trackArtists }));
  pendingSelection = run.catch((error) => console.error('Reminiscencia: fallo al preparar la selección de archivos.', error));
  return run;
}

// ---------------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------------

async function fetchJson(url, init = undefined) {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return response.json();
}

async function loadPublicCatalog() {
  const [songs, folders] = await Promise.allSettled([fetchJson(DATA_URLS.songs, { cache: 'no-cache' }), fetchJson(DATA_URLS.folders, { cache: 'no-cache' })]);
  state.publicSongs = songs.status === 'fulfilled' && Array.isArray(songs.value) ? songs.value : [];
  state.publicFolders = folders.status === 'fulfilled' && Array.isArray(folders.value) ? folders.value : [];
  state.loadError = songs.status === 'fulfilled' ? null : 'No se ha podido cargar la biblioteca. Comprueba la conexión y vuelve a intentarlo.';
}

async function start() {
  dom.app = document.getElementById('app');
  dom.main = document.getElementById('main');
  dom.view = document.getElementById('view');
  dom.sidebar = document.getElementById('sidebar');
  dom.resize = document.getElementById('library-resize');
  dom.offline = document.getElementById('offline-banner');
  dom.topInput = document.getElementById('top-search-input');
  dom.topClear = document.getElementById('top-search-clear');
  const indicator = createUploadIndicator();
  dom.uploadIndicator = indicator.button;
  dom.uploadIndicatorText = indicator.text;
  uploads = createUploads();
  uploads.subscribe(onUploadsChange);
  // Cerrar la página con un archivo convirtiéndose o subiéndose lo perdería: el navegador lo pregunta antes.
  window.addEventListener('beforeunload', (event) => {
    if (!uploads.busy()) return;
    event.preventDefault();
    event.returnValue = '';
  });

  const prefs = readJson(PLAYER_PREFS_KEY);
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
    nowPanel: document.getElementById('now-panel'),
  });
  playerUi.update(player.getState());
  mountTopSearch();
  mountResize();

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
  dom.main.addEventListener('scroll', updateStickyHeads, { passive: true });
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
  uploads.restore({ pendingCopies: state.localSongs.filter((song) => song.pending) });
  render();
  playerUi.update(player.getState());
  document.documentElement.dataset.ready = 'true';
}

start().catch((error) => {
  console.error('Reminiscencia: fallo al arrancar.', error);
  const view = document.getElementById('view');
  if (view) view.textContent = 'No se ha podido abrir Reminiscencia. Recarga la página.';
});
