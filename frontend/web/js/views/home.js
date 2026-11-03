// Inicio: saludo según la hora, accesos rápidos (de 2 a 4 columnas) y estantes «Carpetas», «Añadidas
// recientemente» y «Tus listas», cada uno con «Mostrar todo».

import { greetingFor, recentSongs } from '../catalog.js';
import { el } from '../ui/dom.js';
import { collectionCard, quickTile, shelf, songCard } from './components.js';

const QUICK_LIMIT = 8;
const SHELF_LIMIT = 10;

export function renderHome(main, ctx) {
  const { catalog } = ctx.state;
  const quick = ctx.libraryContexts({ includeAll: true }).slice(0, QUICK_LIMIT);
  const folders = ctx.folderContexts(null);
  const recent = recentSongs(catalog, SHELF_LIMIT);
  const lists = ctx.playlistContexts();

  const content = [
    el('h1', { class: 'page-title home-title', tabindex: '-1', 'data-testid': 'home-title' }, greetingFor(new Date())),
    el('div', { class: 'quick-grid', 'data-testid': 'quick-grid' }, quick.map((item) => quickTile(ctx, item))),
  ];
  if (folders.length > 0) {
    content.push(shelf({
      title: 'Carpetas',
      href: '#/seccion/carpetas',
      testid: 'shelf-folders',
      items: folders.slice(0, SHELF_LIMIT).map((item) => collectionCard(ctx, item)),
    }));
  }
  if (recent.length > 0) {
    content.push(shelf({
      title: 'Añadidas recientemente',
      href: '#/seccion/recientes',
      testid: 'shelf-recent',
      items: recent.map((song, index) => songCard(ctx, song, {
        color: ctx.songColor(song),
        onPlay: () => ctx.playSongs(recent, index, { contextId: 'recientes' }),
      })),
    }));
  }
  if (lists.length > 0) {
    content.push(shelf({
      title: 'Tus listas',
      href: '#/seccion/listas',
      testid: 'shelf-playlists',
      items: lists.slice(0, SHELF_LIMIT).map((item) => collectionCard(ctx, item)),
    }));
  } else {
    content.push(el('section', { class: 'shelf empty-shelf', 'aria-labelledby': 'estante-listas-vacio', 'data-testid': 'shelf-playlists' },
      el('h2', { class: 'shelf-title', id: 'estante-listas-vacio' }, 'Tus listas'),
      el('div', { class: 'empty-card' },
        el('p', { class: 'empty-title' }, 'Crea tu primera lista'),
        el('p', { class: 'empty-text' }, 'Se guarda solo en este navegador. No hace falta cuenta.'),
        el('button', { type: 'button', class: 'button button-light', 'data-testid': 'home-create-playlist', on: { click: () => ctx.createPlaylist() } }, 'Crear lista'))));
  }
  if (catalog.songs.length === 0) {
    content.push(el('p', { class: 'empty-text', role: 'status' }, ctx.state.loadError ?? 'Todavía no hay canciones en la biblioteca.'));
  }
  main.replaceChildren(el('div', { class: 'page page-home', 'data-testid': 'view-home' }, content));
}
