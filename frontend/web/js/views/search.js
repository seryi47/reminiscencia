// Buscar: campo grande redondeado. Con texto, «Resultado principal», canciones, carpetas y listas; sin texto,
// tarjetas de carpetas tipo «Explorar todo». Al escribir solo se vuelven a pintar los resultados: el campo
// conserva el foco y la posición del cursor.

import { searchCatalog, songCountText } from '../catalog.js';
import { el, iconButton, srOnly } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { collectionCard, cover, playButton, shelf, trackTable } from './components.js';

const TOP_SONGS = 4;

export function renderSearch(main, ctx) {
  const input = el('input', {
    id: 'campo-buscar',
    class: 'search-input',
    type: 'search',
    placeholder: '¿Qué quieres escuchar?',
    autocomplete: 'off',
    spellcheck: 'false',
    enterkeyhint: 'search',
    'data-testid': 'search-input',
    'data-key': 'search-input',
  });
  input.value = ctx.state.searchQuery;
  const clear = iconButton('close', 'Borrar la búsqueda', { class: 'search-clear', 'data-testid': 'search-clear', hidden: input.value === '' }, 20);
  const status = el('p', { class: 'sr-only', role: 'status', 'data-testid': 'search-status' });
  const results = el('div', { class: 'search-results', 'data-testid': 'search-results' });

  const update = () => {
    ctx.state.searchQuery = input.value;
    clear.hidden = input.value === '';
    renderResults(results, status, ctx);
  };
  input.addEventListener('input', update);
  clear.addEventListener('click', () => {
    input.value = '';
    update();
    input.focus();
  });

  main.replaceChildren(el('div', { class: 'page page-search', 'data-testid': 'view-search' },
    el('h1', { class: 'page-title', tabindex: '-1' }, 'Buscar'),
    el('form', { class: 'search-form', role: 'search', on: { submit: (event) => event.preventDefault() } },
      el('label', { for: 'campo-buscar', class: 'sr-only' }, 'Buscar canciones, carpetas y listas'),
      el('span', { class: 'search-icon', 'aria-hidden': 'true' }, icon('search', { size: 24 })),
      input,
      clear),
    status,
    results));
  renderResults(results, status, ctx);
}

function renderResults(container, status, ctx) {
  const { catalog, playlists, searchQuery } = ctx.state;
  const found = searchCatalog(catalog, searchQuery, playlists);
  if (found.query === '') {
    status.textContent = '';
    container.replaceChildren(browseAll(ctx));
    return;
  }
  const total = found.songs.length + found.folders.length + found.playlists.length;
  status.textContent = total === 0 ? 'Sin resultados.' : `${total} ${total === 1 ? 'resultado' : 'resultados'}.`;
  if (total === 0) {
    container.replaceChildren(el('div', { class: 'search-empty', 'data-testid': 'search-empty' },
      el('h2', { class: 'empty-title' }, `No se ha encontrado nada para «${searchQuery.trim()}»`),
      el('p', { class: 'empty-text' }, 'Revisa la ortografía o prueba con otras palabras.')));
    return;
  }
  const topRow = el('div', { class: 'search-top' });
  const parts = [topRow];
  if (found.top) topRow.append(topResult(ctx, found.top));
  if (found.songs.length > 0) {
    // Junto al resultado principal, las primeras canciones; la cola de reproducción son todas las encontradas.
    topRow.append(el('section', { class: 'search-songs', 'aria-labelledby': 'resultados-canciones' },
      el('h2', { class: 'shelf-title', id: 'resultados-canciones' }, 'Canciones'),
      trackTable(ctx, found.songs.slice(0, TOP_SONGS), { contextId: 'busqueda', showFolder: false, testid: 'search-songs', caption: 'Canciones encontradas', queue: found.songs })));
    if (found.songs.length > TOP_SONGS) {
      parts.push(el('section', { class: 'search-more-songs', 'aria-labelledby': 'mas-canciones' },
        el('h2', { class: 'shelf-title', id: 'mas-canciones' }, 'Más canciones'),
        trackTable(ctx, found.songs.slice(TOP_SONGS), { contextId: 'busqueda', showFolder: true, testid: 'search-more-songs', caption: 'Más canciones encontradas', queue: found.songs, offset: TOP_SONGS })));
    }
  }
  if (found.folders.length > 0) {
    parts.push(shelf({ title: 'Carpetas', testid: 'search-folders', items: found.folders.map((folder) => collectionCard(ctx, ctx.folderContext(folder))) }));
  }
  if (found.playlists.length > 0) {
    parts.push(shelf({ title: 'Tus listas', testid: 'search-playlists', items: found.playlists.map((list) => collectionCard(ctx, ctx.playlistContext(list))) }));
  }
  container.replaceChildren(...parts);
}

// Tarjeta del resultado principal: portada de 92 px, título grande y tipo.
function topResult(ctx, top) {
  let descriptor;
  let action;
  if (top.kind === 'song') {
    const song = top.item;
    descriptor = {
      title: song.title,
      typeLabel: 'Canción',
      detail: song.artist || (song.local ? 'Subida a este navegador' : 'Artista desconocido'),
      color: ctx.songColor(song),
      iconName: 'note',
    };
    action = el('button', {
      type: 'button',
      class: 'play-button play-button-card',
      'aria-label': `Reproducir ${song.title}`,
      'data-testid': 'top-result-play',
      'data-key': 'top-result-play',
      on: { click: () => ctx.playSongs([song], 0, { contextId: 'busqueda' }) },
    }, icon('play', { size: 24 }));
  } else {
    const context = top.kind === 'folder' ? ctx.folderContext(top.item) : ctx.playlistContext(top.item);
    descriptor = {
      title: context.title,
      typeLabel: top.kind === 'folder' ? 'Carpeta' : 'Lista',
      detail: songCountText(ctx.getContext(context.contextId)?.songs.length ?? 0),
      color: context.color,
      iconName: context.iconName,
      href: context.href,
    };
    action = playButton(ctx, context.contextId, context.title, { size: 'card', testid: 'top-result-play' });
  }
  return el('section', { class: 'search-top-result', 'aria-labelledby': 'resultado-principal' },
    el('h2', { class: 'shelf-title', id: 'resultado-principal' }, 'Resultado principal'),
    el('div', { class: 'top-card', 'data-testid': 'top-result' },
      cover({ color: descriptor.color, iconName: descriptor.iconName, className: 'top-cover' }),
      descriptor.href
        ? el('a', { class: 'top-title card-link', href: descriptor.href, 'data-key': 'top-result-link' }, descriptor.title)
        : el('p', { class: 'top-title' }, descriptor.title),
      el('p', { class: 'top-meta' }, el('span', { class: 'chip-label' }, descriptor.typeLabel), srOnly(' · '), descriptor.detail),
      action));
}

// Sin texto: una tarjeta de color por carpeta, como «Explorar todo».
function browseAll(ctx) {
  const folders = ctx.folderContexts(undefined);
  const extra = ctx.libraryContexts({ includeAll: true }).filter((item) => !item.contextId.startsWith('carpeta:'));
  const tiles = [...folders, ...extra];
  return el('section', { class: 'browse', 'aria-labelledby': 'explorar-todo' },
    el('h2', { class: 'shelf-title', id: 'explorar-todo' }, 'Explorar todo'),
    el('ul', { class: 'browse-grid', 'data-testid': 'browse-grid' },
      tiles.map((item) => el('li', {},
        el('a', { class: 'browse-tile', href: item.href, style: { '--cover-color': item.color }, 'data-testid': 'browse-tile', 'data-key': `browse:${item.contextId}` },
          el('span', { class: 'browse-title' }, item.title),
          el('span', { class: 'browse-icon', 'aria-hidden': 'true' }, icon(item.iconName, { size: 48 })))))));
}
