// «Tu biblioteca»: la lista de la barra lateral (escritorio) y la página propia (teléfono), con los botones
// «Crear lista» y «Subir canciones» y los filtros «Listas» y «Carpetas». También las páginas «Mostrar todo».

import { recentSongs } from '../catalog.js';
import { el } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { collectionCard, libraryItem, songCard } from './components.js';

const FILTERS = Object.freeze([
  Object.freeze({ key: 'listas', label: 'Listas' }),
  Object.freeze({ key: 'carpetas', label: 'Carpetas' }),
]);

/** Botones «Crear lista» y «Subir canciones». */
export function libraryActions(ctx, prefix) {
  return el('div', { class: 'library-actions' },
    el('button', { type: 'button', class: 'pill-button', 'data-testid': `${prefix}-create-playlist`, on: { click: () => ctx.createPlaylist() } },
      icon('plus', { size: 16 }), 'Crear lista'),
    el('button', { type: 'button', class: 'pill-button', 'data-testid': `${prefix}-upload`, on: { click: () => ctx.openUpload() } },
      icon('upload', { size: 16 }), 'Subir canciones'));
}

/** Filtros «Listas» y «Carpetas» (botones con aria-pressed; pulsar el activo lo quita). */
export function libraryChips(ctx, prefix) {
  return el('div', { class: 'chips', role: 'group', 'aria-label': 'Filtrar tu biblioteca' },
    FILTERS.map((filter) => {
      const active = ctx.state.libraryFilter === filter.key;
      return el('button', {
        type: 'button',
        class: `chip${active ? ' is-active' : ''}`,
        'aria-pressed': active ? 'true' : 'false',
        'data-testid': `${prefix}-chip-${filter.key}`,
        'data-key': `${prefix}-chip-${filter.key}`,
        on: { click: () => ctx.setLibraryFilter(active ? null : filter.key) },
      }, filter.label);
    }));
}

/** Elementos de la biblioteca según el filtro activo. */
function libraryEntries(ctx) {
  const filter = ctx.state.libraryFilter;
  const all = ctx.libraryContexts({ includeAll: false, allFolders: true });
  if (filter === 'listas') return all.filter((item) => item.kind === 'playlist' || item.kind === 'liked');
  if (filter === 'carpetas') return all.filter((item) => item.kind === 'folder');
  return all;
}

/** Pinta la lista de la biblioteca en un <ul>. */
export function renderLibraryList(list, ctx, prefix = 'sidebar') {
  const active = ctx.activeContextId();
  const entries = libraryEntries(ctx);
  list.replaceChildren(...entries.map((item) => libraryItem({ ...item, active: item.contextId === active, testid: `${prefix}-item` })));
  if (entries.length === 0) list.append(el('li', { class: 'library-empty' }, 'No hay nada con este filtro.'));
}

/** Página «Tu biblioteca» (destino de la barra inferior del teléfono). */
export function renderLibraryPage(main, ctx) {
  const list = el('ul', { class: 'library-list library-list-page', 'data-testid': 'library-page-list' });
  renderLibraryList(list, ctx, 'library-page');
  main.replaceChildren(el('div', { class: 'page page-library', 'data-testid': 'view-library' },
    el('h1', { class: 'page-title', tabindex: '-1' }, 'Tu biblioteca'),
    libraryActions(ctx, 'library-page'),
    libraryChips(ctx, 'library-page'),
    list));
}

const SECTIONS = Object.freeze({
  carpetas: 'Carpetas',
  recientes: 'Añadidas recientemente',
  listas: 'Tus listas',
});

/** Página «Mostrar todo» de un estante de Inicio: cuadrícula de tarjetas. */
export function renderSection(main, ctx, name) {
  const title = SECTIONS[name];
  if (!title) return false;
  let items;
  if (name === 'carpetas') items = ctx.folderContexts(null).map((item) => collectionCard(ctx, item));
  else if (name === 'listas') items = ctx.playlistContexts().map((item) => collectionCard(ctx, item));
  else {
    const songs = recentSongs(ctx.state.catalog, Infinity);
    items = songs.map((song, index) => songCard(ctx, song, {
      color: ctx.songColor(song),
      onPlay: () => ctx.playSongs(songs, index, { contextId: 'recientes' }),
    }));
  }
  main.replaceChildren(el('div', { class: 'page page-section', 'data-testid': `view-section-${name}` },
    el('h1', { class: 'page-title', tabindex: '-1' }, title),
    items.length > 0 ? el('div', { class: 'card-grid', 'data-testid': 'section-grid' }, items) : el('p', { class: 'empty-text' }, 'Todavía no hay nada aquí.')));
  return true;
}
