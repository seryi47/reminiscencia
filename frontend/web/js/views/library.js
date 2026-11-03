// «Tu biblioteca», como en Spotify: cabecera con «Tu biblioteca» y «+ Crear» (menú: Lista, Álbum y Subir canciones),
// chips «Listas» y «Álbumes», buscador pequeño y orden («Recientes», «Orden alfabético» o «Creador»), y la lista de
// elementos de 64 px. Se pinta en el panel izquierdo (escritorio y tableta) y en la página #/biblioteca (teléfono).
// También las páginas «Mostrar todo» de los estantes de Inicio.

import { normalizeText, recentSongs } from '../catalog.js';
import { el, iconButton, openMenu } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { chips, collectionCard, libraryItem, songCard, viaDialog } from './components.js';

const FILTERS = Object.freeze([
  Object.freeze({ key: 'listas', label: 'Listas' }),
  Object.freeze({ key: 'albumes', label: 'Álbumes' }),
]);

export const LIBRARY_SORTS = Object.freeze([
  Object.freeze({ key: 'recientes', label: 'Recientes' }),
  Object.freeze({ key: 'alfabetico', label: 'Orden alfabético' }),
  Object.freeze({ key: 'creador', label: 'Creador' }),
]);

/** Abre el menú «Crear»: Lista, Álbum, Subir canciones y Homeostasia. */
function openCreateMenu(ctx, anchor) {
  openMenu(anchor, [
    { label: 'Lista', description: 'Crea una lista con canciones. Se guarda en este navegador.', icon: 'list', testid: 'menu-create-playlist', action: () => { ctx.createPlaylist(); return false; } },
    { label: 'Álbum', description: 'Pide un álbum nuevo en la biblioteca para todos (en GitHub).', icon: 'album', testid: 'menu-create-album', action: viaDialog(() => ctx.createAlbum()) },
    { label: 'Subir canciones', description: 'Para todos: canciones sueltas o un ZIP. También desde Internet Archive.', icon: 'upload', testid: 'menu-upload', action: viaDialog(() => ctx.openUpload()) },
    { label: 'Homeostasia', description: 'Añade archivos y música desde YouTube.', icon: 'note', testid: 'menu-homeostasia', action: viaDialog(() => ctx.openHomeostasia()) },
  ], { label: 'Crear' });
}

/** Elementos de la biblioteca según el filtro, el texto y el orden. */
function libraryEntries(ctx) {
  const { libraryFilter: filter, libraryQuery: query, librarySort: sort } = ctx.state;
  let items = ctx.libraryContexts();
  if (filter === 'listas') items = items.filter((item) => item.kind === 'playlist' || item.kind === 'liked');
  if (filter === 'albumes') items = items.filter((item) => item.kind === 'album');
  const text = normalizeText(query);
  if (text !== '') items = items.filter((item) => normalizeText(`${item.title} ${item.owner ?? ''}`).includes(text));
  return ctx.sortContexts(items, sort);
}

function header(ctx, prefix, { page }) {
  const create = el('button', {
    type: 'button',
    class: 'create-button',
    'aria-haspopup': 'menu',
    'aria-expanded': 'false',
    'data-testid': `${prefix}-create`,
    'data-key': `${prefix}-create`,
  }, icon('plus', { size: 16 }), el('span', {}, 'Crear'));
  create.addEventListener('click', () => openCreateMenu(ctx, create));
  const heading = page
    ? el('h1', { class: 'library-heading', tabindex: '-1' }, 'Tu biblioteca')
    : el('h2', { class: 'library-heading', id: 'titulo-biblioteca' },
      el('a', { class: 'library-heading-link', href: '#/biblioteca', 'data-testid': 'sidebar-library-link' }, 'Tu biblioteca'));
  return el('div', { class: 'library-header' }, heading, create);
}

function tools(ctx, prefix) {
  const { librarySearchOpen: open, libraryQuery: query, librarySort: sort } = ctx.state;
  const inputId = `${prefix}-filtro`;
  const toggle = iconButton('search', 'Buscar en Tu biblioteca', {
    class: 'library-search-toggle',
    'aria-expanded': open ? 'true' : 'false',
    'aria-controls': inputId,
    'data-testid': `${prefix}-search-toggle`,
    'data-key': `${prefix}-search-toggle`,
    on: { click: () => ctx.setLibrarySearch({ open: !open, query: open ? '' : query, focus: `${prefix}-filter` }) },
  }, 16);
  const input = el('input', {
    id: inputId,
    class: 'library-filter-input',
    type: 'search',
    placeholder: 'Buscar en Tu biblioteca',
    autocomplete: 'off',
    hidden: !open,
    'data-testid': `${prefix}-filter`,
    'data-key': `${prefix}-filter`,
    'aria-label': 'Buscar en Tu biblioteca',
  });
  input.value = query;
  input.addEventListener('input', () => ctx.setLibrarySearch({ open: true, query: input.value }));
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      ctx.setLibrarySearch({ open: false, query: '', focus: `${prefix}-search-toggle` });
    }
  });
  const current = LIBRARY_SORTS.find((item) => item.key === sort) ?? LIBRARY_SORTS[0];
  const sortButton = el('button', {
    type: 'button',
    class: 'sort-button',
    'aria-haspopup': 'menu',
    'aria-expanded': 'false',
    'aria-label': `Ordenar por: ${current.label}`,
    'data-testid': `${prefix}-sort`,
    'data-key': `${prefix}-sort`,
  }, el('span', { class: 'sort-label' }, current.label), icon('sort', { size: 16 }));
  sortButton.addEventListener('click', () => openMenu(sortButton, LIBRARY_SORTS.map((item) => ({
    label: item.label,
    checked: item.key === current.key,
    testid: `menu-sort-${item.key}`,
    action: () => { ctx.setLibrarySort(item.key); return false; },
  })), { label: 'Ordenar por', heading: 'Ordenar por' }));
  return el('div', { class: `library-tools${open ? ' is-searching' : ''}` },
    el('div', { class: 'library-search' }, toggle, input),
    sortButton);
}

/** Pinta la lista de la biblioteca en un <ul>. */
export function renderLibraryList(list, ctx, prefix = 'sidebar') {
  const active = ctx.activeContextId();
  const entries = libraryEntries(ctx);
  list.replaceChildren(...entries.map((item) => libraryItem({ ...item, active: item.contextId === active, testid: `${prefix}-item` })));
  if (entries.length === 0) {
    list.append(el('li', { class: 'library-empty' }, ctx.state.libraryQuery.trim() === '' ? 'No hay nada con este filtro.' : 'No se ha encontrado nada en Tu biblioteca.'));
  }
}

/** Panel de «Tu biblioteca»: cabecera, chips, herramientas y lista. page: true en la página #/biblioteca. */
export function libraryPanel(ctx, prefix, { page = false } = {}) {
  const list = el('ul', { class: 'library-list', 'data-testid': page ? 'library-page-list' : 'sidebar-list' });
  renderLibraryList(list, ctx, prefix);
  return [
    header(ctx, prefix, { page }),
    chips({
      label: 'Filtrar Tu biblioteca',
      options: FILTERS,
      active: ctx.state.libraryFilter,
      testidPrefix: `${prefix}-chip`,
      className: 'library-chips',
      onPick: (key) => ctx.setLibraryFilter(ctx.state.libraryFilter === key ? null : key),
    }),
    tools(ctx, prefix),
    list,
  ];
}

/** Página «Tu biblioteca» (destino de la barra inferior del teléfono). */
export function renderLibraryPage(main, ctx) {
  main.replaceChildren(el('div', { class: 'page page-library', 'data-testid': 'view-library' }, libraryPanel(ctx, 'library-page', { page: true })));
}

const SECTIONS = Object.freeze({
  albumes: 'Álbumes',
  recientes: 'Añadidas recientemente',
  listas: 'Tus listas',
});

/** Página «Mostrar todo» de un estante de Inicio: cuadrícula de tarjetas. */
export function renderSection(main, ctx, name) {
  const key = name === 'carpetas' ? 'albumes' : name;
  const title = SECTIONS[key];
  if (!title) return false;
  let items;
  if (key === 'albumes') items = ctx.albumContexts(null).map((item) => collectionCard(ctx, item));
  else if (key === 'listas') items = ctx.playlistContexts().map((item) => collectionCard(ctx, item));
  else {
    const songs = recentSongs(ctx.state.catalog, Infinity);
    items = songs.map((song, index) => songCard(ctx, song, { onPlay: () => ctx.playSongs(songs, index, { contextId: 'recientes' }) }));
  }
  main.replaceChildren(el('div', { class: 'page page-section', 'data-testid': `view-section-${key}` },
    el('h1', { class: 'page-title', tabindex: '-1' }, title),
    items.length > 0 ? el('div', { class: 'card-grid', 'data-testid': 'section-grid' }, items) : el('p', { class: 'empty-text' }, 'Todavía no hay nada aquí.')));
  return true;
}
