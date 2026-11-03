// Página de un álbum, una lista propia, «Me gusta», todas las canciones o las subidas a este navegador, como en
// Spotify: cabecera con degradado del color dominante de la portada, portada de 232 px, tipo («Álbum», «Lista»),
// título enorme (hasta 96 px) y metadatos («Artista • 1928 • 8 canciones, 23 min 10 s»); barra de acciones
// (reproducir de 56 px, aleatorio, «Me gusta», descargar y «···») y tabla con cabecera fija.

import { formatTotalDuration, searchCatalog, songCountText, titleSize, totalDuration } from '../catalog.js';
import { paintCoverColor } from '../cover-color.js';
import { isCoverFolderId } from '../cuidador/incidencias.js';
import { el, iconButton, openMenu } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { collectionCard, contextCover, DOT, playButton, shelf, songCoverNode, trackTable, viaDialog } from './components.js';

const ADD_RESULTS = 8;

/** Botón «Atrás» del teléfono (en escritorio no se ve: la barra superior lleva a Inicio). */
export function backButton(ctx) {
  return iconButton('arrow-left', 'Atrás', { class: 'page-back', 'data-testid': 'page-back', on: { click: () => ctx.goBack() } }, 24);
}

function metaLine(context, songs) {
  const parts = [];
  if (context.owner) parts.push(el('span', { class: 'meta-owner' }, context.owner));
  if (context.year) parts.push(String(context.year));
  const count = songCountText(songs.length);
  parts.push(songs.length > 0 ? `${count}, ${formatTotalDuration(totalDuration(songs))}` : count);
  const out = [];
  parts.forEach((part, index) => {
    if (index > 0) out.push(DOT);
    out.push(part);
  });
  return out;
}

export function renderCollection(main, ctx, contextId) {
  const context = ctx.getContext(contextId);
  if (!context) {
    main.replaceChildren(el('div', { class: 'page page-missing', 'data-testid': 'view-missing' },
      el('h1', { class: 'page-title', tabindex: '-1' }, 'No se encuentra esta página'),
      el('p', { class: 'empty-text' }, 'Puede que la lista se haya borrado o que el álbum ya no exista.'),
      el('a', { class: 'button button-light', href: '#/' }, 'Ir a Inicio')));
    return;
  }
  const { songs } = context;
  const editDetails = context.kind === 'album'
    ? () => ctx.editAlbum(context.folder)
    : context.kind === 'playlist' ? () => ctx.editPlaylist(context.playlist.id) : null;

  // Portada: en un álbum o una lista, un botón «Editar detalles» con un lápiz al pasar el ratón, como en Spotify.
  const coverNode = contextCover(context, 'collection-cover');
  const coverSlot = editDetails
    ? el('button', {
      type: 'button',
      class: 'collection-cover-button',
      'aria-label': `Editar detalles de ${context.title}`,
      'data-testid': 'collection-edit',
      'data-key': 'collection-edit',
      on: { click: editDetails },
    }, coverNode, el('span', { class: 'cover-edit-hint', 'aria-hidden': 'true' }, icon('pencil', { size: 48 }), el('span', {}, 'Editar detalles')))
    : coverNode;

  const header = el('header', { class: 'collection-header', 'data-testid': 'collection-header' },
    backButton(ctx),
    el('div', { class: 'collection-cover-wrap' }, coverSlot),
    el('div', { class: 'collection-info' },
      el('p', { class: 'collection-type' }, context.typeLabel),
      el('h1', { class: 'collection-title', 'data-size': titleSize(context.title), tabindex: '-1', 'data-testid': 'collection-title' }, context.title),
      context.description ? el('p', { class: 'collection-description', 'data-testid': 'collection-description' }, context.description) : null,
      el('p', { class: 'collection-meta', 'data-testid': 'collection-meta' }, metaLine(context, songs))));

  const actions = el('div', { class: 'action-bar', 'data-testid': 'action-bar' });
  if (songs.length > 0) {
    actions.append(playButton(ctx, contextId, context.title, { size: 'big', testid: 'collection-play' }));
    actions.append(shuffleToggle(ctx));
    if (context.kind !== 'liked') actions.append(likeAllButton(ctx, context));
    const downloadable = songs.filter((song) => !song.local);
    if (downloadable.length > 0) actions.append(downloadButton(ctx, contextId, downloadable));
  }
  const menuItems = collectionMenuItems(ctx, context, editDetails);
  if (menuItems.length > 0) {
    const more = iconButton('more', `Más opciones para ${context.title}`, {
      class: 'action-icon action-more',
      'aria-haspopup': 'menu',
      'aria-expanded': 'false',
      'data-testid': 'collection-more',
      'data-key': 'collection-more',
    }, 32);
    more.addEventListener('click', () => openMenu(more, collectionMenuItems(ctx, context, editDetails), { label: `Opciones de ${context.title}` }));
    actions.append(more);
  }

  const body = [];
  if (context.subfolders?.length > 0) {
    body.push(shelf({ title: 'Álbumes', testid: 'subfolders', items: context.subfolders.map((item) => collectionCard(ctx, item)) }));
  }
  if (songs.length > 0) {
    body.push(trackTable(ctx, songs, {
      contextId,
      playlistId: context.kind === 'playlist' ? context.playlist.id : null,
      showAlbum: context.kind !== 'album',
      showCover: context.kind !== 'album',
      caption: `Canciones de ${context.title}`,
    }));
  } else if (!context.subfolders?.length) {
    body.push(el('div', { class: 'collection-empty', 'data-testid': 'collection-empty' },
      el('p', { class: 'empty-title' }, emptyText(context.kind))));
  }
  if (context.kind === 'playlist') body.push(addSongsSection(ctx, context));

  const bodyNode = el('div', { class: 'collection-body' }, actions, body);
  paintCoverColor([header, bodyNode], context.cover ?? context.mosaic?.[0] ?? null, context.color);
  main.replaceChildren(el('div', { class: 'page page-collection', 'data-testid': 'view-collection', 'data-context': contextId }, header, bodyNode));
}

function collectionMenuItems(ctx, context, editDetails) {
  const items = [];
  if (context.songs.length > 0) {
    items.push({ label: 'Añadir a la cola', icon: 'queue', testid: 'menu-queue-all', action: () => ctx.addManyToQueue(context.songs) });
  }
  if (editDetails) items.push({ label: 'Editar detalles', icon: 'pencil', testid: 'menu-edit-details', action: viaDialog(editDetails) });
  // Solo los álbumes de la forma nueva (F + 16 hexadecimales) admiten portada.
  if (context.kind === 'album' && isCoverFolderId(context.folder.id)) {
    items.push({ label: 'Cambiar portada', icon: 'image', testid: 'menu-album-cover', action: viaDialog(() => ctx.changeCover({ kind: 'album', id: context.folder.id, name: context.title })) });
  }
  if (context.kind === 'playlist') {
    items.push({ label: 'Borrar la lista', icon: 'trash', testid: 'menu-delete-playlist', action: viaDialog(() => ctx.deletePlaylist(context.playlist.id)) });
  }
  return items;
}

function emptyText(kind) {
  switch (kind) {
    case 'liked': return 'Las canciones que marques con el corazón aparecen aquí.';
    case 'playlist': return 'Esta lista está vacía. Busca canciones abajo para añadirlas.';
    case 'local': return 'No has subido canciones a este navegador.';
    default: return 'Este álbum está vacío.';
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

/** «Me gusta» de la colección: marca (o quita, si ya están todas) todas sus canciones en «Me gusta». */
function likeAllButton(ctx, context) {
  const all = context.songs.every((song) => ctx.isLiked(song.id));
  return el('button', {
    type: 'button',
    class: `action-icon like-all${all ? ' is-active' : ''}`,
    'aria-label': all ? `Quitar de Me gusta: ${context.title}` : `Guardar en Me gusta: ${context.title}`,
    'aria-pressed': all ? 'true' : 'false',
    'data-testid': 'collection-like',
    'data-key': 'collection-like',
    on: { click: () => ctx.setLikedMany(context.songs.map((song) => song.id), !all) },
  }, icon(all ? 'heart-filled' : 'heart', { size: 32 }));
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

// «Busquemos algo para tu lista»: búsqueda en el catálogo con botón «Añadir» por canción.
function addSongsSection(ctx, context) {
  const listId = context.playlist.id;
  const inputId = `anadir-${listId}`;
  const input = el('input', {
    id: inputId,
    class: 'search-input search-input-small',
    type: 'search',
    placeholder: 'Busca canciones o álbumes',
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
      songCoverNode(ctx, song, 'track-cover'),
      el('span', { class: 'track-text' },
        el('span', { class: 'add-title' }, song.title),
        el('span', { class: 'track-artist' }, ctx.artistOf(song))),
      el('span', { class: 'add-album' }, song.folderId ? ctx.folderName(song.folderId) ?? '' : ''),
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
    el('h2', { class: 'shelf-title', id: `titulo-${inputId}` }, 'Busquemos algo para tu lista'),
    el('div', { class: 'search-form search-form-small' },
      el('label', { for: inputId, class: 'sr-only' }, 'Buscar canciones para añadir'),
      el('span', { class: 'search-icon', 'aria-hidden': 'true' }, icon('search', { size: 20 })),
      input),
    results);
}
