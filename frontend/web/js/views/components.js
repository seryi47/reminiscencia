// Piezas de la interfaz que comparten las pantallas: portadas, tarjetas, accesos rápidos, elementos de la biblioteca,
// botón verde de reproducir y tabla de canciones. Reciben el contexto de la app (ctx, ver js/app.js).

import { formatDuration } from '../catalog.js';
import { el, iconButton, openMenu, srOnly } from '../ui/dom.js';
import { icon } from '../ui/icons.js';

/** Portada generada: color de fondo con un icono propio encima. */
export function cover({ color, iconName = 'note', className = '' }) {
  return el('div', { class: `cover ${className}`.trim(), style: { '--cover-color': color }, 'aria-hidden': 'true' },
    icon(iconName, { size: 24, className: 'cover-icon' }));
}

/**
 * Botón verde de reproducir de un contexto. Muestra «Pausar» si ese contexto está sonando (lo sincroniza
 * syncPlaying en app.js por data-play-context).
 */
export function playButton(ctx, contextId, name, { size = 'card', testid = 'play-button' } = {}) {
  const button = el('button', {
    type: 'button',
    class: `play-button play-button-${size}`,
    'data-play-context': contextId,
    'data-name': name,
    'data-testid': testid,
    'data-key': `play:${size}:${contextId}`,
    on: {
      click: (event) => {
        event.preventDefault();
        event.stopPropagation();
        ctx.toggleContext(contextId);
      },
    },
  });
  setPlayButtonState(button, ctx.isContextPlaying(contextId));
  return button;
}

/** Cambia el icono y el nombre del botón según suene o no su contexto. */
export function setPlayButtonState(button, playing) {
  const name = button.dataset.name;
  button.classList.toggle('is-playing', playing);
  button.setAttribute('aria-label', playing ? `Pausar ${name}` : `Reproducir ${name}`);
  const size = button.classList.contains('play-button-big') ? 28 : button.classList.contains('play-button-tile') ? 16 : 24;
  button.replaceChildren(icon(playing ? 'pause' : 'play', { size }));
}

/** Tarjeta de 180 px de una carpeta o una lista: enlace a su página y botón verde que aparece con hover o foco. */
export function collectionCard(ctx, { contextId, title, subtitle, href, color, iconName, testid = 'card' }) {
  return el('div', { class: 'card', 'data-testid': testid, 'data-context': contextId },
    el('div', { class: 'card-cover-wrap' },
      cover({ color, iconName, className: 'card-cover' }),
      playButton(ctx, contextId, title, { size: 'card', testid: 'card-play' })),
    el('a', { class: 'card-title card-link', href, 'data-key': `card:${contextId}` }, title),
    el('p', { class: 'card-subtitle' }, subtitle));
}

/** Tarjeta de una canción: toda la tarjeta reproduce la canción dentro del estante. */
export function songCard(ctx, song, { color, onPlay, testid = 'song-card' }) {
  const artist = song.artist || (song.local ? 'Subida a este navegador' : 'Artista desconocido');
  const button = el('button', {
    type: 'button',
    class: 'card card-song',
    'data-testid': testid,
    'data-song-id': song.id,
    'data-key': `song-card:${song.id}`,
    'aria-label': `Reproducir ${song.title}, ${artist}`,
    on: { click: onPlay },
  },
  el('span', { class: 'card-cover-wrap' },
    cover({ color, iconName: 'note', className: 'card-cover' }),
    el('span', { class: 'play-button play-button-card', 'aria-hidden': 'true' }, icon('play', { size: 24 }))),
  el('span', { class: 'card-title' }, song.title),
  el('span', { class: 'card-subtitle' }, artist));
  return button;
}

/** Acceso rápido de Inicio: tarjeta horizontal de 64 px con la portada a la izquierda. */
export function quickTile(ctx, { contextId, title, href, color, iconName }) {
  return el('div', { class: 'tile', 'data-testid': 'quick-tile', 'data-context': contextId },
    cover({ color, iconName, className: 'tile-cover' }),
    el('a', { class: 'tile-title card-link', href, 'data-key': `tile:${contextId}` }, title),
    playButton(ctx, contextId, title, { size: 'tile', testid: 'tile-play' }));
}

/** Elemento de «Tu biblioteca»: portada de 48 px, título y subtítulo. */
export function libraryItem({ href, title, subtitle, color, iconName, active = false, testid = 'library-item', contextId }) {
  return el('li', { class: 'library-entry' },
    el('a', {
      class: `library-item${active ? ' is-active' : ''}`,
      href,
      'aria-current': active ? 'page' : null,
      'data-testid': testid,
      'data-context': contextId,
      'data-key': `library:${contextId}`,
    },
    cover({ color, iconName, className: 'library-cover' }),
    el('span', { class: 'library-text' },
      el('span', { class: 'library-title' }, title),
      el('span', { class: 'library-subtitle' }, subtitle))));
}

/** Estante con título, enlace «Mostrar todo» y fila de tarjetas con desplazamiento horizontal. */
export function shelf({ title, href, testid, items }) {
  const headingId = `estante-${testid}`;
  return el('section', { class: 'shelf', 'aria-labelledby': headingId, 'data-testid': testid },
    el('div', { class: 'shelf-head' },
      el('h2', { class: 'shelf-title', id: headingId }, title),
      href ? el('a', { class: 'shelf-more', href, 'data-testid': `${testid}-more` }, 'Mostrar todo', srOnly(`: ${title}`)) : null),
    el('div', { class: 'shelf-row' }, items));
}

// ---------------------------------------------------------------------------
// Tabla de canciones
// ---------------------------------------------------------------------------

/** Menú «Más opciones» de una canción. playlistId: la lista en la que está la fila (para «Quitar de esta lista»). */
function songMenuItems(ctx, song, { playlistId = null } = {}) {
  const liked = ctx.isLiked(song.id);
  const playlistItems = () => [
    { label: 'Nueva lista', icon: 'plus', testid: 'menu-new-playlist', action: () => ctx.createPlaylist({ songIds: [song.id], navigate: false }) },
    ...ctx.state.playlists.map((list) => ({
      label: list.name,
      icon: 'list',
      testid: 'menu-playlist',
      action: () => ctx.addToPlaylist(list.id, [song.id]),
    })),
    { label: 'Atrás', icon: 'chevron-left', action: () => songMenuItems(ctx, song, { playlistId }) },
  ];
  return [
    { label: 'Añadir a la cola', icon: 'queue', testid: 'menu-queue', action: () => ctx.addToQueue(song) },
    { label: 'Añadir a una lista', icon: 'plus', testid: 'menu-add-playlist', action: () => playlistItems() },
    playlistId ? { label: 'Quitar de esta lista', icon: 'close', testid: 'menu-remove-playlist', action: () => ctx.removeFromPlaylist(playlistId, song.id) } : null,
    { label: liked ? 'Quitar de Me gusta' : 'Guardar en Me gusta', icon: liked ? 'heart-filled' : 'heart', testid: 'menu-like', action: () => ctx.toggleLike(song.id) },
    song.folderId ? { label: 'Ir a la carpeta', icon: 'folder', testid: 'menu-folder', action: () => { ctx.navigate(`#/carpeta/${song.folderId}`); return false; } } : null,
    song.local ? { label: 'Borrar de este navegador', icon: 'trash', testid: 'menu-delete-local', action: () => { ctx.deleteLocalSong(song); return false; } } : null,
  ].filter(Boolean);
}

/** Botón de «Me gusta» de una canción (corazón). */
export function likeButton(ctx, song, { testid = 'like-button', size = 16, extraClass = '' } = {}) {
  const liked = ctx.isLiked(song.id);
  const button = iconButton(liked ? 'heart-filled' : 'heart', `Me gusta: ${song.title}`, {
    class: `like-button${liked ? ' is-active' : ''} ${extraClass}`.trim(),
    'aria-pressed': liked ? 'true' : 'false',
    'data-testid': testid,
    'data-key': `like:${testid}:${song.id}`,
    on: { click: (event) => { event.stopPropagation(); ctx.toggleLike(song.id); } },
  }, size);
  return button;
}

/**
 * Tabla de canciones de una colección. Cada fila mide 56 px; la que suena va en verde (syncPlaying en app.js).
 * Pulsar la fila (o el título, que es un botón) reproduce la colección desde esa canción.
 */
export function trackTable(ctx, songs, { contextId, playlistId = null, showFolder = true, testid = 'track-table', caption, queue = songs, offset = 0 }) {
  const head = el('thead', {},
    el('tr', {},
      el('th', { class: 'col-num', scope: 'col' }, '#'),
      el('th', { class: 'col-title', scope: 'col' }, 'Título'),
      showFolder ? el('th', { class: 'col-folder', scope: 'col' }, 'Carpeta') : null,
      el('th', { class: 'col-dur', scope: 'col' }, icon('clock', { size: 16 }), srOnly('Duración y acciones'))));
  const body = el('tbody', {});
  songs.forEach((song, index) => {
    const playable = ctx.isPlayable(song);
    const folderName = song.folderId ? ctx.folderName(song.folderId) : null;
    const play = () => ctx.playSongs(queue, offset + index, { contextId });
    const more = iconButton('more', `Más opciones para ${song.title}`, {
      class: 'row-more',
      'aria-haspopup': 'menu',
      'aria-expanded': 'false',
      'data-testid': 'row-more',
      'data-key': `more:${contextId}:${offset + index}`,
    }, 20);
    more.addEventListener('click', (event) => {
      event.stopPropagation();
      openMenu(more, songMenuItems(ctx, song, { playlistId }), { label: `Opciones de ${song.title}` });
    });
    const row = el('tr', {
      class: `track-row${playable ? '' : ' is-unavailable'}`,
      'data-testid': 'track-row',
      'data-song-id': song.id,
      'data-context': contextId,
      'data-index': offset + index,
      on: { click: (event) => { if (!event.target.closest('button, a')) play(); } },
    },
    el('td', { class: 'col-num' },
      el('span', { class: 'num-text' }, String(offset + index + 1)),
      el('span', { class: 'num-playing', 'aria-hidden': 'true' }, el('i'), el('i'), el('i'))),
    el('td', { class: 'col-title' },
      el('div', { class: 'track-main' },
        cover({ color: ctx.songColor(song), iconName: 'note', className: 'track-cover' }),
        // Título y artista van dentro del botón: en el teléfono es un objetivo de 44 px o más.
        el('button', {
          type: 'button',
          class: 'track-text track-play',
          'aria-label': `Reproducir ${song.title}`,
          'data-testid': 'track-title',
          'data-key': `title:${contextId}:${offset + index}`,
          on: { click: (event) => { event.stopPropagation(); play(); } },
        },
        el('span', { class: 'track-title' }, song.title),
        el('span', { class: 'track-artist' },
          song.local ? el('span', { class: 'badge' }, 'En este navegador') : null,
          song.artist || (song.local ? '' : 'Artista desconocido'),
          playable ? null : el('span', { class: 'track-offline' }, ' · No disponible sin conexión'))))),
    showFolder ? el('td', { class: 'col-folder' },
      folderName ? el('a', { href: `#/carpeta/${song.folderId}`, class: 'track-folder', 'data-key': `folder:${contextId}:${offset + index}` }, folderName) : '—') : null,
    el('td', { class: 'col-dur' },
      el('div', { class: 'track-actions' },
        likeButton(ctx, song, { testid: 'row-like' }),
        el('span', { class: 'track-duration' }, formatDuration(song.durationS ?? NaN)),
        more)));
    body.append(row);
  });
  return el('table', { class: 'track-table', 'data-testid': testid },
    caption ? el('caption', { class: 'sr-only' }, caption) : null, head, body);
}
