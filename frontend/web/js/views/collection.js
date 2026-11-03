// Página de una colección: carpeta, lista propia, «Me gusta», todas las canciones o las subidas a este navegador.
// Cabecera con degradado del color de la portada a #121212, portada de 232 px, tipo, título grande y metadatos;
// barra de acciones (reproducir, aleatorio, descargar y, en las listas, más opciones) y tabla de canciones.

import { formatTotalDuration, searchCatalog, songCountText, titleSize, totalDuration } from '../catalog.js';
import { el, iconButton, openMenu } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { collectionCard, cover, playButton, shelf, trackTable } from './components.js';

const ADD_RESULTS = 8;

export function renderCollection(main, ctx, contextId) {
  const context = ctx.getContext(contextId);
  if (!context) {
    main.replaceChildren(el('div', { class: 'page page-missing', 'data-testid': 'view-missing' },
      el('h1', { class: 'page-title', tabindex: '-1' }, 'No se encuentra esta página'),
      el('p', { class: 'empty-text' }, 'Puede que la lista se haya borrado o que la carpeta ya no exista.'),
      el('a', { class: 'button button-light', href: '#/' }, 'Ir a Inicio')));
    return;
  }
  const { songs } = context;
  const metaParts = [];
  if (context.kind === 'playlist') metaParts.push('Tu lista');
  if (context.kind === 'local') metaParts.push('Solo en este navegador');
  metaParts.push(songCountText(songs.length));
  if (songs.length > 0) metaParts.push(formatTotalDuration(totalDuration(songs)));

  const header = el('header', { class: 'collection-header', style: { '--cover-color': context.color }, 'data-testid': 'collection-header' },
    cover({ color: context.color, iconName: context.iconName, className: 'collection-cover' }),
    el('div', { class: 'collection-info' },
      el('p', { class: 'collection-type' }, context.typeLabel),
      el('h1', { class: 'collection-title', 'data-size': titleSize(context.title), tabindex: '-1', 'data-testid': 'collection-title' }, context.title),
      el('p', { class: 'collection-meta', 'data-testid': 'collection-meta' }, metaParts.join(' · '))));

  const actions = el('div', { class: 'action-bar', 'data-testid': 'action-bar' });
  if (songs.length > 0) {
    actions.append(playButton(ctx, contextId, context.title, { size: 'big', testid: 'collection-play' }));
    actions.append(shuffleToggle(ctx));
    const downloadable = songs.filter((song) => !song.local);
    if (downloadable.length > 0) actions.append(downloadButton(ctx, contextId, downloadable));
  }
  if (context.kind === 'playlist') {
    const more = iconButton('more', `Más opciones para ${context.title}`, {
      class: 'action-icon',
      'aria-haspopup': 'menu',
      'aria-expanded': 'false',
      'data-testid': 'playlist-more',
      'data-key': 'playlist-more',
    }, 32);
    more.addEventListener('click', () => openMenu(more, [
      { label: 'Cambiar el nombre', icon: 'list', testid: 'menu-rename', action: () => { ctx.renamePlaylist(context.playlist.id); return false; } },
      { label: 'Borrar la lista', icon: 'trash', testid: 'menu-delete-playlist', action: () => { ctx.deletePlaylist(context.playlist.id); return false; } },
    ], { label: `Opciones de ${context.title}` }));
    actions.append(more);
  }

  const body = [];
  if (context.subfolders?.length > 0) {
    body.push(shelf({ title: 'Carpetas', testid: 'subfolders', items: context.subfolders.map((item) => collectionCard(ctx, item)) }));
  }
  if (songs.length > 0) {
    body.push(trackTable(ctx, songs, {
      contextId,
      playlistId: context.kind === 'playlist' ? context.playlist.id : null,
      showFolder: context.kind !== 'folder',
      caption: `Canciones de ${context.title}`,
    }));
  } else if (!context.subfolders?.length) {
    body.push(el('div', { class: 'collection-empty', 'data-testid': 'collection-empty' },
      el('p', { class: 'empty-title' }, emptyText(context.kind))));
  }
  if (context.kind === 'playlist') body.push(addSongsSection(ctx, context));

  main.replaceChildren(el('div', { class: 'page page-collection', 'data-testid': 'view-collection', 'data-context': contextId },
    header,
    el('div', { class: 'collection-body', style: { '--cover-color': context.color } }, actions, body)));
}

function emptyText(kind) {
  switch (kind) {
    case 'liked': return 'Las canciones que marques con el corazón aparecen aquí.';
    case 'playlist': return 'Esta lista está vacía. Busca canciones abajo para añadirlas.';
    case 'local': return 'No has subido canciones a este navegador.';
    default: return 'Esta carpeta está vacía.';
  }
}

/** Botón «Aleatorio» de la barra de acciones: refleja y cambia el aleatorio del reproductor. */
function shuffleToggle(ctx) {
  const on = ctx.player.getState().shuffle;
  return el('button', {
    type: 'button',
    class: `action-icon shuffle-toggle${on ? ' is-active' : ''}`,
    'aria-label': 'Aleatorio',
    'aria-pressed': on ? 'true' : 'false',
    'data-shuffle-toggle': '',
    'data-testid': 'collection-shuffle',
    'data-key': 'collection-shuffle',
    on: { click: () => ctx.toggleShuffle() },
  }, icon('shuffle', { size: 32 }));
}

function downloadButton(ctx, contextId, songs) {
  const done = songs.every((song) => ctx.state.cached.has(song.audio));
  const busy = ctx.state.downloading.has(contextId);
  const label = done ? 'Quitar la descarga' : busy ? 'Descargando…' : 'Descargar para escuchar sin conexión';
  return el('button', {
    type: 'button',
    class: `action-icon download-toggle${done ? ' is-active' : ''}`,
    'aria-label': label,
    'aria-pressed': done ? 'true' : 'false',
    'aria-disabled': busy ? 'true' : null,
    'data-testid': 'collection-download',
    'data-key': 'collection-download',
    on: { click: () => { if (!busy) ctx.toggleDownload(contextId, songs, done); } },
  }, icon(done ? 'downloaded' : 'download', { size: 32 }));
}

// «Añadir canciones» de una lista: búsqueda en el catálogo con botón «Añadir» por canción.
function addSongsSection(ctx, context) {
  const listId = context.playlist.id;
  const inputId = `anadir-${listId}`;
  const input = el('input', {
    id: inputId,
    class: 'search-input search-input-small',
    type: 'search',
    placeholder: 'Busca canciones o carpetas',
    autocomplete: 'off',
    'data-testid': 'playlist-add-search',
    'data-key': 'playlist-add-search',
  });
  input.value = ctx.state.addQuery;
  const results = el('ul', { class: 'add-results', 'data-testid': 'playlist-add-results' });
  const paint = () => {
    ctx.state.addQuery = input.value;
    const inList = new Set(context.playlist.songIds);
    const found = input.value.trim() === ''
      ? ctx.state.catalog.songs.filter((song) => !inList.has(song.id))
      : searchCatalog(ctx.state.catalog, input.value).songs.filter((song) => !inList.has(song.id));
    results.replaceChildren(...found.slice(0, ADD_RESULTS).map((song) => el('li', { class: 'add-row' },
      cover({ color: ctx.songColor(song), iconName: 'note', className: 'track-cover' }),
      el('span', { class: 'track-text' },
        el('span', { class: 'add-title' }, song.title),
        el('span', { class: 'track-artist' }, song.artist || (song.local ? 'Subida a este navegador' : 'Artista desconocido'))),
      el('button', {
        type: 'button',
        class: 'button button-outline',
        'aria-label': `Añadir ${song.title} a ${context.title}`,
        'data-testid': 'playlist-add-button',
        'data-key': `add:${song.id}`,
        on: { click: () => ctx.addToPlaylist(listId, [song.id]) },
      }, 'Añadir'))));
    if (found.length === 0) results.append(el('li', { class: 'empty-text' }, 'No hay más canciones que añadir.'));
  };
  input.addEventListener('input', paint);
  paint();
  return el('section', { class: 'add-songs', 'aria-labelledby': `titulo-${inputId}` },
    el('h2', { class: 'shelf-title', id: `titulo-${inputId}` }, 'Añadir canciones a tu lista'),
    el('div', { class: 'search-form search-form-small' },
      el('label', { for: inputId, class: 'sr-only' }, 'Buscar canciones para añadir'),
      el('span', { class: 'search-icon', 'aria-hidden': 'true' }, icon('search', { size: 20 })),
      input),
    results);
}
