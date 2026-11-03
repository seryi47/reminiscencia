// Inicio, como el de Spotify: chips «Todo» y «Música» arriba, accesos rápidos en cuadrícula (4 columnas en
// escritorio, 2 en el teléfono) y estantes de tarjetas con «Mostrar todo». El degradado superior toma el color del
// acceso rápido que tiene el ratón encima. El H1 («Inicio») es solo para lectores de pantalla, como en Spotify.

import { recentSongs } from '../catalog.js';
import { el } from '../ui/dom.js';
import { chips, collectionCard, quickTile, shelf, songCard } from './components.js';

const QUICK_LIMIT = 8;
const SHELF_LIMIT = 10;
const DEFAULT_HOME_COLOR = '#535353';

export const HOME_FILTERS = Object.freeze([
  Object.freeze({ key: 'todo', label: 'Todo' }),
  Object.freeze({ key: 'musica', label: 'Música' }),
]);

export function renderHome(main, ctx) {
  const { catalog } = ctx.state;
  const musicOnly = ctx.state.homeFilter === 'musica';
  const quick = (musicOnly ? ctx.albumContexts(null) : ctx.quickContexts()).slice(0, QUICK_LIMIT);
  const albums = ctx.albumContexts(null);
  const recent = recentSongs(catalog, SHELF_LIMIT);
  const recentlyPlayed = musicOnly ? [] : ctx.recentContexts().slice(0, SHELF_LIMIT);
  const lists = ctx.playlistContexts();

  const page = el('div', { class: 'page page-home', 'data-testid': 'view-home', style: { '--home-color': DEFAULT_HOME_COLOR } });
  const content = [
    el('h1', { class: 'sr-only', tabindex: '-1', 'data-testid': 'home-title' }, 'Inicio'),
    chips({
      label: 'Filtrar Inicio',
      options: HOME_FILTERS,
      active: ctx.state.homeFilter,
      testidPrefix: 'home-chip',
      className: 'home-chips',
      // Como en Spotify, pulsar el chip elegido vuelve a «Todo».
      onPick: (key) => ctx.setHomeFilter(key === ctx.state.homeFilter ? 'todo' : key),
    }),
  ];
  if (quick.length > 0) {
    const grid = el('div', { class: 'quick-grid', 'data-testid': 'quick-grid' }, quick.map((item) => quickTile(ctx, item)));
    // El degradado de Inicio toma el color del acceso rápido que tiene el ratón (o el foco) encima.
    const tint = (event) => {
      const tile = event.target.closest?.('.tile');
      const item = tile && quick.find((entry) => entry.contextId === tile.dataset.context);
      page.style.setProperty('--home-color', item ? ctx.colorOf(item) : DEFAULT_HOME_COLOR);
    };
    grid.addEventListener('mouseover', tint);
    grid.addEventListener('focusin', tint);
    grid.addEventListener('mouseleave', () => page.style.setProperty('--home-color', DEFAULT_HOME_COLOR));
    content.push(grid);
  }
  if (recentlyPlayed.length > 0) {
    content.push(shelf({
      title: 'Escuchado recientemente',
      testid: 'shelf-recently-played',
      items: recentlyPlayed.map((item) => collectionCard(ctx, item)),
    }));
  }
  if (albums.length > 0) {
    content.push(shelf({
      title: 'Álbumes',
      href: '#/seccion/albumes',
      testid: 'shelf-albums',
      items: albums.slice(0, SHELF_LIMIT).map((item) => collectionCard(ctx, item)),
    }));
  }
  if (recent.length > 0) {
    content.push(shelf({
      title: 'Añadidas recientemente',
      href: '#/seccion/recientes',
      testid: 'shelf-recent',
      items: recent.map((song, index) => songCard(ctx, song, { onPlay: () => ctx.playSongs(recent, index, { contextId: 'recientes' }) })),
    }));
  }
  if (!musicOnly && lists.length > 0) {
    content.push(shelf({
      title: 'Tus listas',
      href: '#/seccion/listas',
      testid: 'shelf-playlists',
      items: lists.slice(0, SHELF_LIMIT).map((item) => collectionCard(ctx, item)),
    }));
  } else if (!musicOnly) {
    content.push(el('section', { class: 'shelf empty-shelf', 'aria-labelledby': 'estante-listas-vacio', 'data-testid': 'shelf-playlists' },
      el('h2', { class: 'shelf-title', id: 'estante-listas-vacio' }, 'Tus listas'),
      el('div', { class: 'empty-card' },
        el('p', { class: 'empty-title' }, 'Crea tu primera lista'),
        el('p', { class: 'empty-text' }, 'Es fácil. Te ayudaremos. Se guarda solo en este navegador, sin cuenta.'),
        el('button', { type: 'button', class: 'button button-light button-small', 'data-testid': 'home-create-playlist', on: { click: () => ctx.createPlaylist() } }, 'Crear lista'))));
  }
  if (catalog.songs.length === 0) {
    content.push(el('p', { class: 'empty-text', role: 'status' }, ctx.state.loadError ?? 'Todavía no hay canciones en la biblioteca.'));
  }
  page.append(...content);
  main.replaceChildren(page);
}
