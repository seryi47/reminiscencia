// Listas del modo paciente: «Listas» (P2) y «Lista» (P2b).
// Comparten con carpetas.js y buscar.js los mosaicos, las filas de canción y la reproducción de una cola.
// La lógica de datos (ordenar, elegir, describir) son funciones puras, sin DOM, y se prueban en
// tests/web-unit/paciente-listas.test.mjs. El DOM solo se monta dentro de las funciones mount*.
// Los datos de usuario (nombres de listas, títulos, alias) entran siempre con textContent.
import { audioCacheName, planOfflineDownload } from '../offline-core.js';

// ---------- Valores del diseño (DESIGN 3.1, 6.1 y 8.1) ----------

// «Seguir escuchando» y «Mis listas» muestran hasta seis mosaicos; «Ver todas» aparece desde el séptimo.
export const HOME_TILE_LIMIT = 6;
// «Para [alias]» muestra hasta seis canciones.
export const LIKED_ROW_LIMIT = 6;
// Preferencia «Le gusta» (C-6, valor +1). Los demás valores de la preferencia no cuentan.
export const LIKED_PREFERENCE = 1;
// Desde esta escala de texto, los mosaicos pasan a una columna (DESIGN P-11 y D21).
export const LARGE_TEXT_SCALE = 1.5;
// Presentación cuando la asociación no indica otra (valor inicial de C-7).
export const DEFAULT_PRESENTATION = 'C0';
const PRESENTATIONS = Object.freeze(['C0', 'C1', 'C2']);

// Origen de la reproducción para el registro del estudio (DESIGN 8.4).
export const ORIGIN_LIST = 'lista';
export const ORIGIN_CONTINUE = 'continua';

// ---------- Textos visibles (DESIGN) ----------

export const UNAVAILABLE_TEXT = 'No disponible sin internet';
export const EMPTY_TILE_TEXT = 'Vacía';
export const NO_LISTS_TEXT = 'Todavía no hay listas.';
export const LIST_MISSING_TEXT = 'Esta lista ya no existe.';
export const LIST_EMPTY_TEXT = 'Esta lista no tiene canciones todavía.';
export const LOAD_ERROR_TEXT = 'No se pudieron cargar las listas. Vuelve a intentarlo.';
export const LOADING_TEXT = 'Cargando…';
export const SHOW_ALL_TEXT = 'Ver todas';

// Orden de texto en español: sin distinguir mayúsculas ni acentos, y con números por su valor.
const collator = new Intl.Collator('es', { sensitivity: 'base', numeric: true });

// ---------- Funciones puras ----------

/** Compara dos textos en español (orden alfabético con números por su valor). */
export function compareText(first, second) {
  return collator.compare(first, second);
}

/** Ruta del audio de una canción, igual que offline-core.js (listAudioUrls), para cruzarla con la caché. */
export function songAudioPath(song) {
  return `audio/${song.id}.opus`;
}

/** Título de una canción, o «Sin título» si el catálogo no lo trae. */
export function songTitle(song) {
  const title = typeof song?.title === 'string' ? song.title.trim() : '';
  return title || 'Sin título';
}

/** Nombre de una lista, o «Lista sin nombre» si está vacío. */
export function listName(list) {
  const name = typeof list?.name === 'string' ? list.name.trim() : '';
  return name || 'Lista sin nombre';
}

/** Número de canciones con su palabra en singular o plural. */
export function songCountText(count) {
  return count === 1 ? '1 canción' : `${count} canciones`;
}

/** Inicial en mayúscula para la portada sin imagen (P-4). Sin texto, un punto medio. */
export function initialOf(text) {
  const first = Array.from(typeof text === 'string' ? text.trim() : '')[0];
  return first ? first.toLocaleUpperCase('es') : '•';
}

/** Título de la sección de canciones que le gustan al paciente. */
export function aliasTitle(alias) {
  return `Para ${alias}`;
}

/** Las listas con cambio más reciente primero. No modifica la lista original. */
export function latestLists(lists, count = HOME_TILE_LIMIT) {
  return [...lists].sort((first, second) => (second.updatedAt ?? 0) - (first.updatedAt ?? 0)).slice(0, count);
}

/** Mosaicos de «Mis listas»: seis, o todas si el paciente pulsó «Ver todas». */
export function visibleLists(lists, showAll = false) {
  return showAll ? [...lists] : lists.slice(0, HOME_TILE_LIMIT);
}

/** Indica si hay más elementos de los que se muestran por defecto. */
export function hasMoreThan(items, limit) {
  return items.length > limit;
}

/** Canciones del catálogo con esos identificadores, en el mismo orden. Los que no existen se omiten. */
export function songsByIds(ids, songs) {
  const byId = new Map(songs.map((song) => [song.id, song]));
  return ids.map((id) => byId.get(id)).filter(Boolean);
}

/** Canciones de una lista, en su orden, sin las que ya no están en el catálogo. */
export function songsOfList(list, songs) {
  return songsByIds(list?.songIds ?? [], songs);
}

/** Canciones que el perfil marca como «Le gusta», sin repetir, en el orden de las asociaciones. */
export function likedSongs(links, songs) {
  const byId = new Map(songs.map((song) => [song.id, song]));
  const seen = new Set();
  const liked = [];
  for (const link of links) {
    if (link.preference !== LIKED_PREFERENCE) continue;
    const song = byId.get(link.songId);
    if (!song || seen.has(song.id)) continue;
    seen.add(song.id);
    liked.push(song);
  }
  return liked;
}

/** Pista con la forma que espera player.load (contrato 2.2). El id es el songId del catálogo. */
export function trackOfSong(song) {
  return {
    id: song.id,
    title: song.title ?? '',
    artist: song.artist ?? '',
    year: song.year ?? null,
    coverUrl: null,
    audioUrl: song.audio ?? songAudioPath(song),
    folderId: song.folder_id ?? null,
  };
}

/** Presentación de una asociación (C0, C1 o C2). Si falta o no es válida, C0. */
export function presentationOfLink(link) {
  return PRESENTATIONS.includes(link?.presentation) ? link.presentation : DEFAULT_PRESENTATION;
}

/**
 * Función que el reproductor llama por cada pista para registrar su presentación (player.js, resolvePresentation).
 * Las canciones sin asociación usan C0.
 */
export function createPresentationResolver(links = []) {
  const byId = new Map(links.map((link) => [link.songId, presentationOfLink(link)]));
  return (track) => byId.get(track?.id) ?? DEFAULT_PRESENTATION;
}

/** Una canción se puede escuchar si hay conexión o si su audio está guardado para escuchar sin conexión. */
export function isSongAvailable(song, { online = true, cached = new Set() } = {}) {
  return online || cached.has(songAudioPath(song));
}

/** Etiqueta de la fila activa: «Suena: [artista]», o «Suena ahora» si no hay artista. */
export function soundingLabel(artist) {
  const name = typeof artist === 'string' ? artist.trim() : '';
  return name ? `Suena: ${name}` : 'Suena ahora';
}

/**
 * Estado visible de una fila: si es la que suena, si se puede reproducir y el texto de su segunda línea.
 * Sin conexión y sin copia, el texto es «No disponible sin internet».
 */
export function describeRow(song, { activeId = null, online = true, cached = new Set() } = {}) {
  const available = isSongAvailable(song, { online, cached });
  const active = activeId !== null && song.id === activeId;
  let line;
  if (!available) line = UNAVAILABLE_TEXT;
  else if (active) line = soundingLabel(song.artist);
  else line = typeof song.artist === 'string' ? song.artist.trim() : '';
  return { active, available, line };
}

/** Lectura de la escala de texto desde las preferencias. Con preferencias ausentes, normal. */
export function isLargeText(services) {
  try {
    return Number(services?.prefs?.get('textScale')) >= LARGE_TEXT_SCALE;
  } catch {
    return false;
  }
}

// ---------- Acceso al navegador y a los servicios ----------

/** Hay conexión según el navegador. Sin dato, se supone que sí. */
export function isOnline() {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

/**
 * Rutas de las canciones guardadas en la caché de audio sin conexión (rutas relativas, como audio/<id>.opus).
 * Sin caché o sin acceso a ella, ninguna canción se considera guardada.
 */
export async function cachedSongPaths(songs) {
  const paths = new Set();
  try {
    if (typeof caches === 'undefined' || !(await caches.has(audioCacheName()))) return paths;
    const cache = await caches.open(audioCacheName());
    const keys = await cache.keys();
    const { alreadyCached } = planOfflineDownload(songs, keys.map((request) => request.url));
    for (const path of alreadyCached) paths.add(path);
  } catch {
    // Sin acceso a la caché no es un fallo de la pantalla: la disponibilidad se calcula solo con la conexión.
  }
  return paths;
}

/** Perfil del paciente (el perfil activo del almacén), o null si no hay ninguno. */
export async function getActiveProfile(services) {
  const id = await services.store.getActiveProfileId();
  if (!id) return null;
  const profiles = await services.store.listProfiles();
  return profiles.find((profile) => profile.id === id) ?? null;
}

/** Fija el título de la cabecera. El shell lo escribe en el H1 y mueve el foco a él (DESIGN 7.1). */
export function setScreenTitle(services, text) {
  services.setTitle?.(text);
}

/** Marca el destino activo de la navegación del paciente. */
export function setActiveDestination(services, key) {
  services.setActive?.(key);
}

/** Anuncio para lectores de pantalla (aria-live, services.announce). */
export function announce(services, text) {
  services.announce?.(text);
}

// ---------- Elementos del DOM ----------

/**
 * Crea un elemento. Los atributos booleanos: en aria-* se escriben como texto; en los demás,
 * true añade el atributo y false lo omite. Los hijos de texto entran con createTextNode.
 */
export function createElement(doc, tag, attributes = {}, children = []) {
  const element = doc.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (typeof value === 'boolean') {
      if (name.startsWith('aria-')) element.setAttribute(name, String(value));
      else if (value) element.setAttribute(name, '');
    } else if (value !== undefined && value !== null) {
      element.setAttribute(name, String(value));
    }
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    element.append(typeof child === 'string' ? doc.createTextNode(child) : child);
  }
  return element;
}

/** Añade los nodos que existen (los null se omiten). */
export function appendAll(parent, nodes) {
  for (const node of nodes) {
    if (node) parent.append(node);
  }
}

/** Párrafo con clase y texto fijo o de usuario (siempre textContent). */
export function createParagraph(doc, className, text, attributes = {}) {
  return createElement(doc, 'p', { class: className, ...attributes }, [text]);
}

// Trazados de los iconos propios (trazo de 2 px). Plantillas fijas, sin datos de usuario.
const ICON_PATHS = Object.freeze({
  note: '<path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>',
  play: '<path d="M8 5.5v13l10.5-6.5z" fill="currentColor" stroke="none"/>',
  offline: '<circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
});

/** Icono decorativo (aria-hidden) con los trazados propios. */
export function createIcon(doc, name) {
  const icon = doc.createElement('span');
  icon.className = 'icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" focusable="false">${ICON_PATHS[name] ?? ''}</svg>`;
  return icon;
}

/**
 * Mosaico de lista, carpeta o categoría (P-11). Todo el mosaico es el botón; el H3 lo envuelve.
 * Si está vacío, muestra «Vacía», queda marcado como no disponible y no se abre.
 */
export function makeTile(doc, { title, meta, initial, empty = false, onOpen, attributes = {} }) {
  const button = createElement(doc, 'button', {
    type: 'button',
    class: 'tile',
    'aria-disabled': empty ? 'true' : null,
    ...attributes,
  }, [
    createElement(doc, 'span', { class: 'tile-cover', 'aria-hidden': 'true' }, [initial]),
    createElement(doc, 'span', { class: 'tile-title' }, [title]),
    createElement(doc, 'span', { class: 'tile-meta' }, [meta]),
  ]);
  if (empty) button.classList.add('is-empty');
  else button.addEventListener('click', onOpen);
  return createElement(doc, 'li', { class: 'tile-item' }, [
    createElement(doc, 'h3', { class: 'tile-heading' }, [button]),
  ]);
}

/** Cuadrícula de mosaicos. Con escala de texto de 1,50 o más, una columna. */
export function makeGrid(doc, items, { testid = null, large = false } = {}) {
  return createElement(doc, 'ul', {
    class: large ? 'tiles escala-grande' : 'tiles',
    'data-testid': testid,
  }, items);
}

// ---------- Reproducción y filas de canción ----------

/**
 * Estado compartido de una pantalla de canciones: servicios, disponibilidad sin conexión, la canción activa
 * y las funciones que actualizan cada fila montada.
 */
export function createContext(services) {
  return { services, online: isOnline(), cached: new Set(), activeId: null, refreshers: [] };
}

/** Lee la disponibilidad sin conexión de las canciones dadas. */
export async function loadAvailability(context, songs) {
  context.online = isOnline();
  context.cached = await cachedSongPaths(songs);
}

/** Vuelve a leer la canción que suena del reproductor y actualiza todas las filas montadas. */
export function refreshRows(context) {
  const state = context.services.player?.getState?.() ?? null;
  context.activeId = state?.track?.id ?? null;
  for (const refresh of context.refreshers) refresh();
}

/**
 * Carga la cola en el reproductor y reproduce desde la posición indicada.
 * El reproductor no reproduce al cargar (player.js, load), así que se llama a play después.
 */
export function playQueue(context, { queue, index, origin, presentation }) {
  const { player } = context.services;
  player.load(queue.map(trackOfSong), index, origin, presentation);
  player.play();
  refreshRows(context);
  const state = player.getState();
  if (state.track) announce(context.services, `Reproduciendo «${songTitle(state.track)}».`);
  else announce(context.services, state.notice ?? 'No hay canciones disponibles sin internet.');
}

/**
 * Fila de canción (P-12): portada de 64 o 72 px, título, segunda línea y botón de reproducir de 48 px.
 * La fila activa y las no disponibles se actualizan con refreshRows.
 */
export function makeRow(doc, context, { song, index, queue, origin, presentation }) {
  const title = songTitle(song);
  const line = createElement(doc, 'p', { class: 'song-row-line' });
  const button = createElement(doc, 'button', {
    type: 'button',
    class: 'song-row-play',
    'aria-label': `Reproducir «${title}»`,
    'data-index': index,
  }, [createIcon(doc, 'play')]);
  const row = createElement(doc, 'li', { class: 'song-row', 'data-song-id': song.id }, [
    createElement(doc, 'span', { class: 'song-row-cover' }, [createIcon(doc, 'note')]),
    createElement(doc, 'span', { class: 'song-row-text' }, [
      createElement(doc, 'p', { class: 'song-row-title' }, [title]),
      line,
    ]),
    button,
  ]);

  button.addEventListener('click', () => {
    const state = describeRow(song, context);
    if (!state.available) {
      announce(context.services, UNAVAILABLE_TEXT);
      return;
    }
    playQueue(context, { queue, index, origin, presentation });
  });

  const refresh = () => {
    const state = describeRow(song, context);
    row.classList.toggle('is-active', state.active);
    row.classList.toggle('is-unavailable', !state.available);
    if (state.active) row.setAttribute('aria-current', 'true');
    else row.removeAttribute('aria-current');
    if (state.available) {
      row.removeAttribute('aria-disabled');
      button.removeAttribute('aria-disabled');
    } else {
      row.setAttribute('aria-disabled', 'true');
      button.setAttribute('aria-disabled', 'true');
    }
    line.replaceChildren();
    if (!state.available) line.append(createIcon(doc, 'offline'));
    if (state.line) line.append(doc.createTextNode(state.line));
    line.hidden = state.line === '';
  };
  context.refreshers.push(refresh);
  refresh();
  return row;
}

// ---------- Pantallas ----------

/** Rutas del modo paciente que atiende este módulo: listas (P2) y lista/:listId (P2b). */
export const routes = Object.freeze({
  listas: mountLists,
  lista: mountList,
});

/**
 * «Listas» (P2): «Seguir escuchando», «Mis listas» y «Para [alias]».
 * Los datos vienen del perfil activo; la carga es asíncrona y muestra «Cargando…» mientras tanto.
 */
export function mountLists(root, services) {
  const doc = root.ownerDocument;
  const container = createElement(doc, 'div', { class: 'screen-stack', 'data-testid': 'p2-root' });
  const context = createContext(services);
  const songs = services.catalog?.songs ?? [];
  const view = { profile: null, lists: [], links: [], showAllLists: false, showAllLiked: false };
  let alive = true;

  root.append(container);
  setScreenTitle(services, 'Listas');
  setActiveDestination(services, 'listas');
  container.append(createParagraph(doc, 'loading-text', LOADING_TEXT));
  load();

  async function load() {
    try {
      view.profile = await getActiveProfile(services);
      if (view.profile) {
        view.lists = await services.store.listPlaylists(view.profile.id);
        view.links = await services.store.listSongLinks(view.profile.id);
      }
      await loadAvailability(context, songs);
      if (alive) render();
    } catch (error) {
      console.error('Reminiscencia: no se pudieron cargar las listas.', error);
      if (alive) container.replaceChildren(createParagraph(doc, 'error-text', LOAD_ERROR_TEXT, { role: 'alert' }));
    }
  }

  // Reconstruye la pantalla. focusSelector señala el elemento que recibe el foco tras «Ver todas».
  function render(focusSelector = null) {
    container.replaceChildren();
    context.refreshers = [];
    const liked = view.profile ? likedSongs(view.links, songs) : [];
    const presentation = createPresentationResolver(view.links);
    appendAll(container, [
      view.lists.length > 0 ? homeSection() : null,
      listsSection(),
      liked.length > 0 ? likedSection(liked, presentation) : null,
    ]);
    refreshRows(context);
    if (focusSelector) container.querySelector(focusSelector)?.focus();
  }

  // Mosaico de una lista. Vacía (sin canciones del catálogo) no se abre.
  function listTile(list, attributes = {}) {
    const count = songsOfList(list, songs).length;
    const empty = count === 0;
    return makeTile(doc, {
      title: listName(list),
      meta: empty ? EMPTY_TILE_TEXT : songCountText(count),
      initial: initialOf(listName(list)),
      empty,
      onOpen: () => services.navigate('lista', { listId: list.id }),
      attributes: { 'data-list-id': list.id, ...attributes },
    });
  }

  function homeSection() {
    return createElement(doc, 'section', {
      class: 'section',
      'data-testid': 'p2-continue',
      'aria-labelledby': 'p2-continue-title',
    }, [
      createElement(doc, 'h2', { id: 'p2-continue-title' }, ['Seguir escuchando']),
      makeGrid(doc, latestLists(view.lists).map((list) => listTile(list)), { large: isLargeText(services) }),
    ]);
  }

  function listsSection() {
    const section = createElement(doc, 'section', {
      class: 'section',
      'data-testid': 'p2-lists',
      'aria-labelledby': 'p2-lists-title',
    }, [createElement(doc, 'h2', { id: 'p2-lists-title' }, ['Mis listas'])]);
    if (view.lists.length === 0) {
      section.append(createParagraph(doc, 'empty-text', NO_LISTS_TEXT));
      return section;
    }
    const visible = visibleLists(view.lists, view.showAllLists);
    section.append(makeGrid(
      doc,
      visible.map((list, index) => listTile(list, { 'data-list-index': index })),
      { large: isLargeText(services) },
    ));
    if (hasMoreThan(view.lists, HOME_TILE_LIMIT) && !view.showAllLists) {
      const seeAll = createElement(doc, 'button', {
        type: 'button',
        class: 'action action-secondary',
        'data-testid': 'p2-see-all',
      }, [SHOW_ALL_TEXT]);
      seeAll.addEventListener('click', () => {
        view.showAllLists = true;
        announce(services, 'Se muestran todas las listas.');
        render(`[data-list-index="${HOME_TILE_LIMIT}"]`);
      });
      section.append(seeAll);
    }
    return section;
  }

  function likedSection(liked, presentation) {
    const shown = view.showAllLiked ? liked : liked.slice(0, LIKED_ROW_LIMIT);
    const section = createElement(doc, 'section', {
      class: 'section',
      'data-testid': 'p2-for-alias',
      'aria-labelledby': 'p2-alias-title',
    }, [
      createElement(doc, 'h2', { id: 'p2-alias-title' }, [aliasTitle(view.profile.alias)]),
      createElement(doc, 'ol', { class: 'song-rows' }, shown.map((song, index) => makeRow(doc, context, {
        song,
        index,
        queue: liked,
        origin: ORIGIN_CONTINUE,
        presentation,
      }))),
    ]);
    if (hasMoreThan(liked, LIKED_ROW_LIMIT) && !view.showAllLiked) {
      const seeAll = createElement(doc, 'button', { type: 'button', class: 'action action-secondary' }, [SHOW_ALL_TEXT]);
      seeAll.addEventListener('click', () => {
        view.showAllLiked = true;
        announce(services, 'Se muestran todas las canciones.');
        render(`[data-index="${LIKED_ROW_LIMIT}"]`);
      });
      section.append(seeAll);
    }
    return section;
  }

  return {
    unmount() {
      alive = false;
      container.remove();
    },
  };
}

/**
 * «Lista» (P2b): nombre en el título, número de canciones, «Reproducir lista» (64 px) y filas de 88 px.
 * La lista se busca en el perfil activo por el identificador de la ruta (params.listId).
 */
export function mountList(root, services, params = {}) {
  const doc = root.ownerDocument;
  const container = createElement(doc, 'div', { class: 'screen-stack', 'data-testid': 'p2b-root' });
  const context = createContext(services);
  const songs = services.catalog?.songs ?? [];
  let alive = true;

  root.append(container);
  setScreenTitle(services, 'Lista');
  setActiveDestination(services, 'listas');
  container.append(createParagraph(doc, 'loading-text', LOADING_TEXT));
  load();

  async function load() {
    try {
      const profile = await getActiveProfile(services);
      const lists = profile ? await services.store.listPlaylists(profile.id) : [];
      const links = profile ? await services.store.listSongLinks(profile.id) : [];
      await loadAvailability(context, songs);
      if (!alive) return;
      const list = lists.find((item) => item.id === params?.listId) ?? null;
      if (!list) {
        container.replaceChildren(createParagraph(doc, 'empty-text', LIST_MISSING_TEXT));
        return;
      }
      setScreenTitle(services, listName(list));
      render(list, links);
    } catch (error) {
      console.error('Reminiscencia: no se pudo cargar la lista.', error);
      if (alive) container.replaceChildren(createParagraph(doc, 'error-text', LOAD_ERROR_TEXT, { role: 'alert' }));
    }
  }

  function render(list, links) {
    container.replaceChildren();
    context.refreshers = [];
    const queue = songsOfList(list, songs);
    const presentation = createPresentationResolver(links);
    const playButton = createElement(doc, 'button', {
      type: 'button',
      class: 'action action-primary action-wide',
      'data-testid': 'p2b-play',
      disabled: queue.length === 0,
    }, ['Reproducir lista']);
    playButton.addEventListener('click', () => {
      playQueue(context, { queue, index: 0, origin: ORIGIN_LIST, presentation });
    });
    const rows = queue.map((song, index) => makeRow(doc, context, {
      song,
      index,
      queue,
      origin: ORIGIN_LIST,
      presentation,
    }));
    appendAll(container, [
      createParagraph(doc, 'meta-text', songCountText(queue.length)),
      playButton,
      createElement(doc, 'h2', { class: 'visually-hidden' }, ['Canciones']),
      queue.length === 0 ? createParagraph(doc, 'empty-text', LIST_EMPTY_TEXT) : null,
      createElement(doc, 'ol', { class: 'song-rows', 'data-testid': 'p2b-rows' }, rows),
    ]);
    refreshRows(context);
  }

  return {
    unmount() {
      alive = false;
      container.remove();
    },
  };
}
