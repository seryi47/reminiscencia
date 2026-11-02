// Búsqueda del modo paciente (P4): campo con etiqueta visible, cuatro categorías grandes y resultados.
// Los resultados aparecen solo al pulsar «Buscar» o Intro, o al elegir una categoría; nunca mientras se escribe
// (DESIGN 3.1, D22). La lógica de búsqueda y de agrupación son funciones puras, probadas en
// tests/web-unit/paciente-buscar.test.mjs.
import { sortFolders, songsInFolder, folderName } from './carpetas.js';
import {
  announce,
  compareText,
  createContext,
  createElement,
  createIcon,
  createParagraph,
  createPresentationResolver,
  getActiveProfile,
  listName,
  loadAvailability,
  makeRow,
  refreshRows,
  setActiveDestination,
  setScreenTitle,
  songCountText,
  songsOfList,
} from './listas.js';

// Origen de la reproducción para el registro del estudio (DESIGN 8.4).
export const ORIGIN_SEARCH = 'busqueda';

// Textos visibles (DESIGN P4 y P-15).
export const SEARCH_HELP_TEXT = 'Escribe un título o un artista';
export const NO_SONGS_TEXT = 'No hay canciones en la biblioteca todavía.';
export const NO_FOLDER_SONGS_TEXT = 'Todavía no hay canciones en ninguna carpeta.';
export const NO_LIST_SONGS_TEXT = 'Todavía no hay listas con canciones.';

// Categorías grandes (P-14). Los identificadores son internos; las etiquetas son el texto visible.
export const CATEGORIES = Object.freeze([
  Object.freeze({ id: 'artist', label: 'Por artista' }),
  Object.freeze({ id: 'decade', label: 'Por década' }),
  Object.freeze({ id: 'folder', label: 'Por carpeta' }),
  Object.freeze({ id: 'list', label: 'Por lista' }),
]);

/** Rutas del modo paciente que atiende este módulo: buscar (P4). */
export const routes = Object.freeze({
  buscar: mountSearch,
});

// ---------- Funciones puras: búsqueda ----------

/** Texto listo para comparar: sin mayúsculas, sin acentos y con espacios simples. */
export function normalizeSearchText(text) {
  if (typeof text !== 'string') return '';
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es')
    .replace(/\s+/g, ' ')
    .trim();
}

// Una palabra de la búsqueda sin tres letras debe coincidir completa; con tres o más, vale su inicio.
// Así «a» no encuentra todos los «Artista…» y «Artista A» encuentra al artista de ese nombre.
const MIN_PREFIX_LENGTH = 3;

/** Palabras de un texto normalizado. Separan los espacios, los signos y los paréntesis. */
export function wordsOf(text) {
  return normalizeSearchText(text).split(/[^\p{L}\p{N}]+/u).filter((word) => word !== '');
}

/** Palabras de la búsqueda. Cada una debe coincidir con una palabra del título o del artista. */
export function searchTerms(text) {
  return wordsOf(text);
}

// Indica si una palabra de la búsqueda coincide con alguna palabra del texto de la canción.
function termMatches(term, words) {
  return words.some((word) => word === term || (term.length >= MIN_PREFIX_LENGTH && word.startsWith(term)));
}

/** Una canción coincide si cada palabra de la búsqueda coincide con una palabra de su título o de su artista. Sin palabras, coincide. */
export function songMatches(song, text) {
  const terms = searchTerms(text);
  if (terms.length === 0) return true;
  const words = wordsOf(`${song.title ?? ''} ${song.artist ?? ''}`);
  return terms.every((term) => termMatches(term, words));
}

/** Canciones que coinciden con el texto, en el orden del catálogo. Sin texto, todas. */
export function filterSongs(songs, text) {
  return songs.filter((song) => songMatches(song, text));
}

// ---------- Funciones puras: agrupación ----------

/** Década de un año (1925 → 1920). Sin año válido, null. */
export function decadeOf(year) {
  return Number.isInteger(year) && year >= 1000 && year <= 9999 ? Math.floor(year / 10) * 10 : null;
}

/** Título de un grupo por década. */
export function decadeTitle(decade) {
  return decade === null ? 'Sin año indicado' : `Años ${decade}`;
}

/** Grupos por década, de la más antigua a la más reciente. Las canciones sin año van al final. */
export function groupByDecade(songs) {
  const groups = new Map();
  for (const song of songs) {
    const decade = decadeOf(song.year);
    const key = decade === null ? 'no-year' : String(decade);
    if (!groups.has(key)) {
      groups.set(key, { key, title: decadeTitle(decade), order: decade ?? Infinity, songs: [] });
    }
    groups.get(key).songs.push(song);
  }
  return [...groups.values()]
    .sort((first, second) => first.order - second.order)
    .map(({ order, ...group }) => group);
}

/** Grupos por artista, en orden alfabético. Sin artista, al final. Sin distinguir mayúsculas ni acentos. */
export function groupByArtist(songs) {
  const groups = new Map();
  for (const song of songs) {
    const name = typeof song.artist === 'string' ? song.artist.trim() : '';
    const key = name === '' ? 'no-artist' : normalizeSearchText(name);
    if (!groups.has(key)) {
      groups.set(key, { key, title: name === '' ? 'Sin artista indicado' : name, noArtist: name === '', songs: [] });
    }
    groups.get(key).songs.push(song);
  }
  return [...groups.values()]
    .sort((first, second) => Number(first.noArtist) - Number(second.noArtist) || compareText(first.title, second.title))
    .map(({ noArtist, ...group }) => group);
}

/** Grupos por carpeta de la biblioteca, en orden de nombre. Las carpetas sin canciones coincidentes no aparecen. */
export function groupByFolder(songs, folders) {
  return sortFolders(folders)
    .map((folder) => ({ key: folder.id, title: folderName(folder), songs: songsInFolder(folder, songs) }))
    .filter((group) => group.songs.length > 0);
}

/** Grupos por lista del perfil, en su orden. Las listas sin canciones coincidentes no aparecen. */
export function groupByList(songs, lists) {
  return lists
    .map((list) => ({ key: list.id, title: listName(list), songs: songsOfList(list, songs) }))
    .filter((group) => group.songs.length > 0);
}

/** Grupos de una categoría. Una categoría desconocida no tiene grupos. */
export function groupByCategory(category, songs, { folders = [], lists = [] } = {}) {
  switch (category) {
    case 'artist':
      return groupByArtist(songs);
    case 'decade':
      return groupByDecade(songs);
    case 'folder':
      return groupByFolder(songs, folders);
    case 'list':
      return groupByList(songs, lists);
    default:
      return [];
  }
}

/** Texto de «Sin resultados» con el texto buscado entre comillas angulares (P4). */
export function noResultsText(text) {
  return `No hay canciones con «${text}». Prueba con el nombre de un artista.`;
}

/** Texto cuando una categoría no tiene nada que mostrar. */
export function emptyCategoryText(category) {
  if (category === 'folder') return NO_FOLDER_SONGS_TEXT;
  if (category === 'list') return NO_LIST_SONGS_TEXT;
  return NO_SONGS_TEXT;
}

/** Etiqueta visible de una categoría. */
export function categoryLabel(category) {
  return CATEGORIES.find((item) => item.id === category)?.label ?? '';
}

/**
 * Qué se muestra en P4 para una búsqueda y una categoría.
 * - Sin texto y sin categoría: nada (kind «help»), solo la ayuda.
 * - Texto sin categoría: lista plana de coincidencias (kind «list»).
 * - Con categoría: grupos de esa categoría, filtrados por el texto si lo hay (kind «groups»).
 * - Sin coincidencias o sin grupos: kind «empty» con el mensaje que corresponde.
 */
export function resolveResults({ query = '', category = null, songs = [], folders = [], lists = [] } = {}) {
  const text = typeof query === 'string' ? query.trim() : '';
  if (text === '' && category === null) return { kind: 'help' };
  const matches = filterSongs(songs, text);
  if (matches.length === 0) {
    return { kind: 'empty', message: text === '' ? NO_SONGS_TEXT : noResultsText(text) };
  }
  if (category === null) return { kind: 'list', songs: matches };
  const groups = groupByCategory(category, matches, { folders, lists });
  if (groups.length === 0) return { kind: 'empty', message: emptyCategoryText(category) };
  return { kind: 'groups', category, label: categoryLabel(category), groups };
}

// ---------- Pantalla ----------

/**
 * «Buscar» (P4). Los datos del perfil (listas, asociaciones y copias sin conexión) se cargan al montar;
 * una búsqueda espera a que terminen. El foco inicial va al H1 de la cabecera.
 */
export function mountSearch(root, services) {
  const doc = root.ownerDocument;
  const songs = services.catalog?.songs ?? [];
  const folders = services.catalog?.folders ?? [];
  const context = createContext(services);
  const state = { category: null, lists: [], links: [] };
  let alive = true;

  const input = createElement(doc, 'input', {
    id: 'p4-campo',
    type: 'search',
    class: 'search-field',
    'data-testid': 'p4-input',
    'aria-describedby': 'p4-ayuda',
    enterkeyhint: 'search',
    autocomplete: 'off',
    autocapitalize: 'none',
    autocorrect: 'off',
    spellcheck: 'false',
  });
  const submitButton = createElement(doc, 'button', {
    type: 'submit',
    class: 'action action-primary',
    'data-testid': 'p4-search',
  }, ['Buscar']);
  // «Borrar búsqueda» aparece al escribir y se oculta cuando el campo está vacío.
  const clearButton = createElement(doc, 'button', {
    type: 'button',
    class: 'action action-secondary search-clear',
    hidden: true,
  }, ['Borrar búsqueda']);
  const form = createElement(doc, 'form', { class: 'search-form', role: 'search' }, [
    createElement(doc, 'label', { class: 'search-label', for: 'p4-campo' }, ['Buscar']),
    createParagraph(doc, 'search-help', SEARCH_HELP_TEXT, { id: 'p4-ayuda' }),
    createElement(doc, 'div', { class: 'search-row' }, [input, submitButton]),
    clearButton,
  ]);

  const chips = CATEGORIES.map((category) => {
    const chip = createElement(doc, 'button', {
      type: 'button',
      class: 'chip',
      'aria-pressed': 'false',
      'data-category': category.id,
    }, [category.label, createIcon(doc, 'check')]);
    chip.addEventListener('click', () => {
      // Pulsar la categoría activa la desmarca.
      state.category = state.category === category.id ? null : category.id;
      syncChips();
      search();
    });
    return chip;
  });
  const categories = createElement(doc, 'div', {
    class: 'chips',
    role: 'group',
    'aria-label': 'Explorar por',
    'data-testid': 'p4-categories',
  }, chips);

  const results = createElement(doc, 'div', { class: 'results', 'data-testid': 'p4-results' });
  const container = createElement(doc, 'div', { class: 'screen-stack', 'data-testid': 'p4-root' }, [
    form,
    categories,
    results,
  ]);

  input.addEventListener('input', updateClearButton);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    search();
  });
  clearButton.addEventListener('click', () => {
    input.value = '';
    updateClearButton();
    search();
    input.focus();
  });

  root.append(container);
  setScreenTitle(services, 'Buscar');
  setActiveDestination(services, 'buscar');
  const ready = loadData().catch((error) => {
    console.error('Reminiscencia: no se pudieron cargar los datos de búsqueda.', error);
  });

  function syncChips() {
    chips.forEach((chip, index) => {
      chip.setAttribute('aria-pressed', String(CATEGORIES[index].id === state.category));
    });
  }

  function updateClearButton() {
    clearButton.hidden = input.value === '';
  }

  async function loadData() {
    const profile = await getActiveProfile(services);
    state.links = profile ? await services.store.listSongLinks(profile.id) : [];
    state.lists = profile ? await services.store.listPlaylists(profile.id) : [];
    await loadAvailability(context, songs);
  }

  // Solo se llama desde Buscar, Intro, las categorías y «Borrar búsqueda», nunca desde el campo.
  async function search() {
    await ready;
    if (!alive) return;
    render(resolveResults({
      query: input.value,
      category: state.category,
      songs,
      folders,
      lists: state.lists,
    }));
  }

  function render(outcome) {
    results.replaceChildren();
    context.refreshers = [];
    const presentation = createPresentationResolver(state.links);
    if (outcome.kind === 'help') {
      announce(services, SEARCH_HELP_TEXT);
    } else if (outcome.kind === 'empty') {
      results.append(createParagraph(doc, 'empty-text', outcome.message, { 'data-testid': 'p4-empty' }));
      announce(services, outcome.message);
    } else if (outcome.kind === 'list') {
      results.append(
        createElement(doc, 'h2', { class: 'results-title' }, ['Resultados']),
        createElement(doc, 'ol', { class: 'song-rows' }, outcome.songs.map((song, index) => makeRow(doc, context, {
          song,
          index,
          queue: outcome.songs,
          origin: ORIGIN_SEARCH,
          presentation,
        }))),
      );
      announce(services, `Hay ${songCountText(outcome.songs.length)}.`);
    } else {
      // Los grupos se reproducen como una sola cola: el índice de cada fila es su posición en esa cola.
      const queue = outcome.groups.flatMap((group) => group.songs);
      results.append(createElement(doc, 'h2', { class: 'results-title' }, [outcome.label]));
      let offset = 0;
      for (const group of outcome.groups) {
        const start = offset;
        results.append(
          createElement(doc, 'h3', { class: 'group-title' }, [group.title]),
          createElement(doc, 'ol', { class: 'song-rows' }, group.songs.map((song, index) => makeRow(doc, context, {
            song,
            index: start + index,
            queue,
            origin: ORIGIN_SEARCH,
            presentation,
          }))),
        );
        offset += group.songs.length;
      }
      announce(services, `Hay ${songCountText(queue.length)}.`);
    }
    refreshRows(context);
  }

  return {
    unmount() {
      alive = false;
      container.remove();
    },
  };
}
