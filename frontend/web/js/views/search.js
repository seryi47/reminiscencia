// Buscar, como en Spotify. En escritorio y tableta se escribe en el buscador de la barra superior (index.html); en el
// teléfono, en el campo de esta página. Con texto: chips de tipo, «Resultado principal», canciones, álbumes y listas;
// sin texto, «Explorar todo». Al escribir solo se vuelven a pintar los resultados: el campo conserva el foco.

import { searchCatalog, songCountText } from '../catalog.js';
import { el, iconButton } from '../ui/dom.js';
import { youtubeSection } from './youtube-search.js';
import { icon } from '../ui/icons.js';
import { chips, collectionCard, contextCover, DOT, playButton, shelf, songCoverNode, trackTable } from './components.js';

const TOP_SONGS = 4;

const SEARCH_FILTERS = Object.freeze([
  Object.freeze({ key: 'todo', label: 'Todo' }),
  Object.freeze({ key: 'canciones', label: 'Canciones' }),
  Object.freeze({ key: 'albumes', label: 'Álbumes' }),
  Object.freeze({ key: 'listas', label: 'Listas' }),
]);

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
  input.addEventListener('input', () => {
    clear.hidden = input.value === '';
    ctx.setSearchQuery(input.value);
  });
  clear.addEventListener('click', () => {
    input.value = '';
    clear.hidden = true;
    ctx.setSearchQuery('');
    input.focus();
  });

  main.replaceChildren(el('div', { class: 'page page-search', 'data-testid': 'view-search' },
    el('h1', { class: 'page-title search-title', tabindex: '-1' }, 'Buscar'),
    el('form', { class: 'search-form search-form-page', role: 'search', on: { submit: (event) => event.preventDefault() } },
      el('label', { for: 'campo-buscar', class: 'sr-only' }, 'Buscar canciones, álbumes y listas'),
      el('span', { class: 'search-icon', 'aria-hidden': 'true' }, icon('search', { size: 24 })),
      input,
      clear),
    el('p', { class: 'sr-only', role: 'status', 'data-testid': 'search-status' }),
    el('div', { class: 'search-results', 'data-testid': 'search-results' })));
  refreshSearchResults(main, ctx);
}

/** Vuelve a pintar solo los resultados (y el campo de la página, si no es el que se está usando). */
export function refreshSearchResults(main, ctx) {
  const container = main.querySelector('[data-testid="search-results"]');
  const status = main.querySelector('[data-testid="search-status"]');
  if (!container || !status) return;
  const pageInput = main.querySelector('[data-testid="search-input"]');
  if (pageInput && pageInput !== document.activeElement && pageInput.value !== ctx.state.searchQuery) {
    pageInput.value = ctx.state.searchQuery;
    main.querySelector('[data-testid="search-clear"]').hidden = pageInput.value === '';
  }
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
      el('p', { class: 'empty-text' }, 'Revisa la ortografía o prueba con menos palabras o con otras.')),
    youtubeSection(ctx, searchQuery, 0));
    return;
  }
  const filter = ctx.state.searchFilter;
  const parts = [chips({
    label: 'Tipo de resultado',
    options: SEARCH_FILTERS,
    active: filter,
    testidPrefix: 'search-chip',
    className: 'search-chips',
    onPick: (key) => ctx.setSearchFilter(key === filter ? 'todo' : key),
  })];
  const albums = found.folders.map((folder) => ctx.albumContext(folder));
  const lists = found.playlists.map((list) => ctx.playlistContext(list));
  if (filter === 'canciones') {
    parts.push(found.songs.length > 0
      ? trackTable(ctx, found.songs, { contextId: 'busqueda', testid: 'search-songs', caption: 'Canciones encontradas' })
      : el('p', { class: 'empty-text' }, 'No hay canciones con esta búsqueda.'));
  } else if (filter === 'albumes' || filter === 'listas') {
    const items = filter === 'albumes' ? albums : lists;
    parts.push(items.length > 0
      ? el('div', { class: 'card-grid', 'data-testid': `search-${filter}-grid` }, items.map((item) => collectionCard(ctx, item)))
      : el('p', { class: 'empty-text' }, filter === 'albumes' ? 'No hay álbumes con esta búsqueda.' : 'No hay listas con esta búsqueda.'));
  } else {
    const topRow = el('div', { class: 'search-top' });
    parts.push(topRow);
    if (found.top) topRow.append(topResult(ctx, found.top));
    if (found.songs.length > 0) {
      // Junto al resultado principal, las primeras canciones; la cola de reproducción son todas las encontradas.
      topRow.append(el('section', { class: 'search-songs', 'aria-labelledby': 'resultados-canciones' },
        el('h2', { class: 'shelf-title', id: 'resultados-canciones' }, 'Canciones'),
        trackTable(ctx, found.songs.slice(0, TOP_SONGS), { contextId: 'busqueda', showAlbum: false, testid: 'search-songs', caption: 'Canciones encontradas', queue: found.songs })));
      if (found.songs.length > TOP_SONGS) {
        parts.push(el('section', { class: 'search-more-songs', 'aria-labelledby': 'mas-canciones' },
          el('h2', { class: 'shelf-title', id: 'mas-canciones' }, 'Más canciones'),
          trackTable(ctx, found.songs.slice(TOP_SONGS), { contextId: 'busqueda', testid: 'search-more-songs', caption: 'Más canciones encontradas', queue: found.songs, offset: TOP_SONGS })));
      }
    }
    if (albums.length > 0) parts.push(shelf({ title: 'Álbumes', testid: 'search-albums', items: albums.map((item) => collectionCard(ctx, item)) }));
    if (lists.length > 0) parts.push(shelf({ title: 'Tus listas', testid: 'search-playlists', items: lists.map((item) => collectionCard(ctx, item)) }));
  }
  if (filter === 'todo' || filter === 'canciones') parts.push(youtubeSection(ctx, searchQuery, found.songs.length));
  container.replaceChildren(...parts);
}

// Tarjeta del resultado principal: portada de 92 px, título grande, tipo y botón verde.
function topResult(ctx, top) {
  let descriptor;
  let action;
  if (top.kind === 'song') {
    const song = top.item;
    descriptor = { title: song.title, typeLabel: 'Canción', detail: ctx.artistOf(song), coverNode: songCoverNode(ctx, song, 'top-cover') };
    action = el('button', {
      type: 'button',
      class: 'play-button play-button-card',
      'aria-label': `Reproducir ${song.title}`,
      'data-testid': 'top-result-play',
      'data-key': 'top-result-play',
      on: { click: () => ctx.playSongs([song], 0, { contextId: 'busqueda' }) },
    }, icon('play', { size: 20 }));
  } else {
    const context = top.kind === 'folder' ? ctx.albumContext(top.item) : ctx.playlistContext(top.item);
    descriptor = {
      title: context.title,
      typeLabel: top.kind === 'folder' ? 'Álbum' : 'Lista',
      detail: context.owner ?? songCountText(ctx.getContext(context.contextId)?.songs.length ?? 0),
      coverNode: contextCover(context, 'top-cover'),
      href: context.href,
    };
    action = playButton(ctx, context.contextId, context.title, { size: 'card', testid: 'top-result-play' });
  }
  return el('section', { class: 'search-top-result', 'aria-labelledby': 'resultado-principal' },
    el('h2', { class: 'shelf-title', id: 'resultado-principal' }, 'Resultado principal'),
    el('div', { class: 'top-card', 'data-testid': 'top-result' },
      descriptor.coverNode,
      descriptor.href
        ? el('a', { class: 'top-title card-link', href: descriptor.href, 'data-key': 'top-result-link' }, descriptor.title)
        : el('p', { class: 'top-title' }, descriptor.title),
      el('p', { class: 'top-meta' }, el('span', { class: 'top-type' }, descriptor.typeLabel), DOT, descriptor.detail),
      action));
}

// Sin texto: «Explorar todo», una tarjeta de color por álbum (y «Me gusta», todas las canciones y las listas), con la
// portada girada en la esquina, como en Spotify.
function browseAll(ctx) {
  const tiles = [...ctx.albumContexts(undefined), ...ctx.libraryContexts({ includeAll: true }).filter((item) => item.kind !== 'album')];
  return el('section', { class: 'browse', 'aria-labelledby': 'explorar-todo' },
    el('h2', { class: 'shelf-title', id: 'explorar-todo' }, 'Explorar todo'),
    el('ul', { class: 'browse-grid', 'data-testid': 'browse-grid' },
      tiles.map((item) => el('li', {},
        el('a', { class: 'browse-tile', href: item.href, style: { '--cover-color': ctx.colorOf(item) }, 'data-testid': 'browse-tile', 'data-key': `browse:${item.contextId}` },
          el('span', { class: 'browse-title' }, item.title),
          contextCover(item, 'browse-cover'))))));
}
