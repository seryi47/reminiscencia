// Carpetas del modo paciente: «Carpetas» (P3) y «Carpeta» (P3b).
// Las carpetas del paciente son todas las de la biblioteca (DESIGN D23), no las del perfil. La carpeta de
// una canción es su campo folder_id del catálogo. Las funciones puras se prueban en
// tests/web-unit/paciente-listas.test.mjs.
import {
  appendAll,
  compareText,
  createContext,
  createElement,
  createParagraph,
  createPresentationResolver,
  EMPTY_TILE_TEXT,
  getActiveProfile,
  initialOf,
  isLargeText,
  loadAvailability,
  makeGrid,
  makeRow,
  makeTile,
  playQueue,
  refreshRows,
  setActiveDestination,
  setScreenTitle,
  songCountText,
  LOADING_TEXT,
  LOAD_ERROR_TEXT,
} from './listas.js';

// Origen de la reproducción para el registro del estudio (DESIGN 8.4).
export const ORIGIN_FOLDER = 'carpeta';

// Textos visibles (DESIGN P3 y P3b).
export const NO_FOLDERS_TEXT = 'Todavía no hay carpetas.';
export const FOLDER_MISSING_TEXT = 'Esta carpeta ya no existe.';
export const FOLDER_EMPTY_TEXT = 'No hay canciones en esta carpeta todavía.';

/** Rutas del modo paciente que atiende este módulo: carpetas (P3) y carpeta/:folderId (P3b). */
export const routes = Object.freeze({
  carpetas: mountFolders,
  carpeta: mountFolder,
});

/** Nombre de una carpeta, o «Carpeta sin nombre» si está vacío. */
export function folderName(folder) {
  const name = typeof folder?.name === 'string' ? folder.name.trim() : '';
  return name || 'Carpeta sin nombre';
}

/** Carpetas ordenadas por nombre. No modifica la lista original. */
export function sortFolders(folders) {
  return [...folders].sort((first, second) => compareText(folderName(first), folderName(second)));
}

/** Canciones cuyo folder_id es la carpeta, en el orden del catálogo. */
export function songsInFolder(folder, songs) {
  return songs.filter((song) => song.folder_id === folder.id);
}

/** Carpeta con ese identificador, o null si ya no existe. */
export function findFolder(folders, folderId) {
  return folders.find((folder) => folder.id === folderId) ?? null;
}

/** Pantalla «Carpetas» (P3): cuadrícula de todas las carpetas con su número de canciones. */
export function mountFolders(root, services) {
  const doc = root.ownerDocument;
  const container = createElement(doc, 'div', { class: 'screen-stack', 'data-testid': 'p3-root' });
  const songs = services.catalog?.songs ?? [];
  const folders = sortFolders(services.catalog?.folders ?? []);

  root.append(container);
  setScreenTitle(services, 'Carpetas');
  setActiveDestination(services, 'carpetas');

  const tiles = folders.map((folder) => {
    const count = songsInFolder(folder, songs).length;
    const empty = count === 0;
    return makeTile(doc, {
      title: folderName(folder),
      meta: empty ? EMPTY_TILE_TEXT : songCountText(count),
      initial: initialOf(folderName(folder)),
      empty,
      onOpen: () => services.navigate('carpeta', { folderId: folder.id }),
      attributes: { 'data-folder-id': folder.id },
    });
  });
  appendAll(container, [
    makeGrid(doc, tiles, { testid: 'p3-folders', large: isLargeText(services) }),
    folders.length === 0 ? createParagraph(doc, 'empty-text', NO_FOLDERS_TEXT) : null,
  ]);

  return {
    unmount() {
      container.remove();
    },
  };
}

/**
 * Pantalla «Carpeta» (P3b): «Reproducir carpeta» (64 px), filas de 88 px y, si está vacía, el aviso.
 * La carpeta se busca por params.folderId. Si ya no existe, se muestra un aviso y no hay reproducción.
 */
export function mountFolder(root, services, params = {}) {
  const doc = root.ownerDocument;
  const container = createElement(doc, 'div', { class: 'screen-stack', 'data-testid': 'p3b-root' });
  const context = createContext(services);
  const songs = services.catalog?.songs ?? [];
  const folder = findFolder(services.catalog?.folders ?? [], params?.folderId);
  let alive = true;

  root.append(container);
  setActiveDestination(services, 'carpetas');

  if (!folder) {
    setScreenTitle(services, 'Carpeta');
    container.append(createParagraph(doc, 'empty-text', FOLDER_MISSING_TEXT));
    return {
      unmount() {
        container.remove();
      },
    };
  }

  setScreenTitle(services, folderName(folder));
  container.append(createParagraph(doc, 'loading-text', LOADING_TEXT));
  load();

  async function load() {
    try {
      const profile = await getActiveProfile(services);
      const links = profile ? await services.store.listSongLinks(profile.id) : [];
      await loadAvailability(context, songs);
      if (alive) render(links);
    } catch (error) {
      console.error('Reminiscencia: no se pudo cargar la carpeta.', error);
      if (alive) container.replaceChildren(createParagraph(doc, 'error-text', LOAD_ERROR_TEXT, { role: 'alert' }));
    }
  }

  function render(links) {
    container.replaceChildren();
    context.refreshers = [];
    const queue = songsInFolder(folder, songs);
    const presentation = createPresentationResolver(links);
    const playButton = createElement(doc, 'button', {
      type: 'button',
      class: 'action action-primary action-wide',
      'data-testid': 'p3b-play',
      disabled: queue.length === 0,
    }, ['Reproducir carpeta']);
    playButton.addEventListener('click', () => {
      playQueue(context, { queue, index: 0, origin: ORIGIN_FOLDER, presentation });
    });
    const rows = queue.map((song, index) => makeRow(doc, context, {
      song,
      index,
      queue,
      origin: ORIGIN_FOLDER,
      presentation,
    }));
    appendAll(container, [
      createParagraph(doc, 'meta-text', songCountText(queue.length)),
      playButton,
      createElement(doc, 'h2', { class: 'visually-hidden' }, ['Canciones']),
      queue.length === 0
        ? createParagraph(doc, 'empty-text', FOLDER_EMPTY_TEXT, { 'data-testid': 'p3b-empty' })
        : null,
      createElement(doc, 'ol', { class: 'song-rows', 'data-testid': 'p3b-rows' }, rows),
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
