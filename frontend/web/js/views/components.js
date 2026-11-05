// Piezas de la interfaz que comparten las pantallas: portadas, tarjetas, accesos rápidos, elementos de «Tu
// biblioteca», botón verde de reproducir, tabla de canciones y menú «Más opciones» de una canción. Reciben el
// contexto de la app (ctx, ver js/app.js).

import { formatDuration } from '../catalog.js';
import { closeMenu, el, iconButton, openMenu, srOnly } from '../ui/dom.js';
import { icon } from '../ui/icons.js';

/** Separador de los metadatos, como en Spotify: «Álbum • Artista». */
export const DOT = ' • ';

function coverImage(src, node) {
  const image = el('img', { class: 'cover-img', src, alt: '', decoding: 'async', loading: 'lazy', draggable: 'false' });
  // Si la imagen no llega (todavía no publicada, sin conexión), queda la portada generada.
  image.addEventListener('error', () => {
    image.remove();
    if (!node.querySelector('.cover-img')) node.classList.remove('has-image');
  });
  return image;
}

/**
 * Portada. Con src (covers/<id>.jpg o data:), la imagen; con mosaic (cuatro imágenes), una cuadrícula de 2 × 2; sin
 * imagen, o si no carga, el color de fondo con un icono propio encima. Decorativa: el nombre lo da el control.
 */
export function cover({ color, iconName = 'note', src = null, mosaic = null, className = '' }) {
  const node = el('div', { class: `cover ${className}`.trim(), style: { '--cover-color': color }, 'aria-hidden': 'true' },
    icon(iconName, { size: 24, className: 'cover-icon' }));
  if (Array.isArray(mosaic) && mosaic.length >= 4) {
    node.classList.add('has-image', 'cover-mosaic');
    node.append(...mosaic.slice(0, 4).map((item) => coverImage(item, node)));
  } else if (src) {
    node.classList.add('has-image');
    node.append(coverImage(src, node));
  }
  return node;
}

/** Portada de una colección (descriptor de app.js: color, iconName, cover y mosaic). */
export function contextCover(item, className) {
  return cover({ color: item.color, iconName: item.iconName, src: item.cover, mosaic: item.mosaic, className });
}

/** Portada de una canción o de una pista del reproductor. */
export function songCoverNode(ctx, song, className) {
  return cover({ color: ctx.songColor(song), iconName: 'note', src: ctx.songCoverSrc(song), className });
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
  const size = button.classList.contains('play-button-big') ? 24 : button.classList.contains('play-button-tile') ? 16 : 20;
  button.replaceChildren(icon(playing ? 'pause' : 'play', { size }));
}

/** Tarjeta de un álbum o una lista: sin fondo hasta el hover, enlace a su página y botón verde que sube con hover o foco. */
export function collectionCard(ctx, item, { testid = 'card' } = {}) {
  return el('div', { class: 'card', 'data-testid': testid, 'data-context': item.contextId },
    el('div', { class: 'card-cover-wrap' },
      contextCover(item, 'card-cover'),
      playButton(ctx, item.contextId, item.title, { size: 'card', testid: 'card-play' })),
    el('a', { class: 'card-title card-link', href: item.href, 'data-key': `card:${item.contextId}` }, item.title),
    el('p', { class: 'card-subtitle' }, item.cardSubtitle ?? item.subtitle));
}

/** Tarjeta de una canción: toda la tarjeta reproduce la canción dentro del estante. */
export function songCard(ctx, song, { onPlay, testid = 'song-card' }) {
  const artist = ctx.artistOf(song);
  return el('button', {
    type: 'button',
    class: 'card card-song',
    'data-testid': testid,
    'data-song-id': song.id,
    'data-key': `song-card:${song.id}`,
    'aria-label': `Reproducir ${song.title}, ${artist}`,
    on: { click: onPlay },
  },
  el('span', { class: 'card-cover-wrap' },
    songCoverNode(ctx, song, 'card-cover'),
    el('span', { class: 'play-button play-button-card', 'aria-hidden': 'true' }, icon('play', { size: 20 }))),
  el('span', { class: 'card-title' }, song.title),
  el('span', { class: 'card-subtitle' }, artist));
}

/** Acceso rápido de Inicio: tarjeta horizontal (48 px en escritorio) con la portada a la izquierda. */
export function quickTile(ctx, item) {
  return el('div', { class: 'tile', 'data-testid': 'quick-tile', 'data-context': item.contextId },
    contextCover(item, 'tile-cover'),
    el('a', { class: 'tile-title card-link', href: item.href, 'data-key': `tile:${item.contextId}` }, item.title),
    el('span', { class: 'tile-eq', 'aria-hidden': 'true' }, el('i'), el('i'), el('i')),
    playButton(ctx, item.contextId, item.title, { size: 'tile', testid: 'tile-play' }));
}

/** Elemento de «Tu biblioteca»: 64 px de alto, portada de 48 px, título y «Lista • Reminiscencia» o «Álbum • artista». */
export function libraryItem({ href, title, subtitle, contextId, active = false, testid = 'library-item', ...item }) {
  return el('li', { class: 'library-entry' },
    el('a', {
      class: `library-item${active ? ' is-active' : ''}`,
      href,
      'aria-current': active ? 'page' : null,
      'data-testid': testid,
      'data-context': contextId,
      'data-key': `library:${testid}:${contextId}`,
    },
    contextCover({ ...item, contextId }, 'library-cover'),
    el('span', { class: 'library-text' },
      el('span', { class: 'library-title' }, title),
      el('span', { class: 'library-subtitle' }, subtitle)),
    el('span', { class: 'library-playing', 'aria-hidden': 'true' }, icon('volume', { size: 16 }))));
}

/** Estante con título, enlace «Mostrar todo» y fila de tarjetas con desplazamiento horizontal. */
export function shelf({ title, href, testid, items }) {
  const headingId = `estante-${testid}`;
  return el('section', { class: 'shelf', 'aria-labelledby': headingId, 'data-testid': testid },
    el('div', { class: 'shelf-head' },
      el('h2', { class: 'shelf-title', id: headingId }, href ? el('a', { class: 'shelf-title-link', href }, title) : title),
      href ? el('a', { class: 'shelf-more', href, 'data-testid': `${testid}-more` }, 'Mostrar todo', srOnly(`: ${title}`)) : null),
    el('div', { class: 'shelf-row' }, items));
}

/** Chips de filtro (botones con aria-pressed). options: [{ key, label }]; onPick(key). */
export function chips({ label, options, active, onPick, testidPrefix, className = '' }) {
  return el('div', { class: `chips ${className}`.trim(), role: 'group', 'aria-label': label },
    options.map((option) => {
      const pressed = active === option.key;
      return el('button', {
        type: 'button',
        class: `chip${pressed ? ' is-active' : ''}`,
        'aria-pressed': pressed ? 'true' : 'false',
        'data-testid': `${testidPrefix}-${option.key}`,
        'data-key': `${testidPrefix}-${option.key}`,
        on: { click: () => onPick(option.key) },
      }, option.label);
    }));
}

// ---------------------------------------------------------------------------
// Menú «Más opciones» de una canción
// ---------------------------------------------------------------------------

/** Acción de menú que abre un diálogo: primero se cierra el menú, para que el foco vuelva después a «Más opciones». */
export const viaDialog = (open) => () => {
  closeMenu();
  open();
  return false;
};

/**
 * Opciones de una canción. playlistId: la lista en la que está la fila (para «Quitar de esta lista»); albumId: el álbum
 * que se está viendo (para «Quitar de este álbum», solo si la canción es editable y está en ese álbum).
 */
export function songMenuItems(ctx, song, { playlistId = null, albumId = null } = {}) {
  const liked = ctx.isLiked(song.id);
  const editable = ctx.isEditableSong(song);
  const playlistItems = () => [
    { label: 'Nueva lista', icon: 'plus', testid: 'menu-new-playlist', action: () => ctx.createPlaylist({ songIds: [song.id], navigate: false }) },
    ...ctx.state.playlists.map((list) => ({
      label: list.name,
      icon: 'list',
      testid: 'menu-playlist',
      action: () => ctx.addToPlaylist(list.id, [song.id]),
    })),
    { label: 'Atrás', icon: 'chevron-left', action: () => songMenuItems(ctx, song, { playlistId, albumId }) },
  ];
  return [
    { label: 'Añadir a una lista', icon: 'plus', testid: 'menu-add-playlist', action: () => playlistItems() },
    playlistId ? { label: 'Quitar de esta lista', icon: 'trash', testid: 'menu-remove-playlist', action: () => ctx.removeFromPlaylist(playlistId, song.id) } : null,
    { label: liked ? 'Quitar de Me gusta' : 'Guardar en Me gusta', icon: liked ? 'heart-filled' : 'heart', testid: 'menu-like', action: () => ctx.toggleLike(song.id) },
    { label: 'Añadir a la cola', icon: 'queue', testid: 'menu-queue', action: () => ctx.addToQueue(song) },
    song.folderId ? { label: 'Ir al álbum', icon: 'album', testid: 'menu-album', action: () => { ctx.navigate(`#/album/${encodeURIComponent(song.folderId)}`); return false; } } : null,
    editable ? { label: 'Editar detalles', icon: 'pencil', testid: 'menu-edit-song', action: viaDialog(() => ctx.editSong(song)) } : null,
    editable ? { label: 'Añadir a un álbum', icon: 'album', testid: 'menu-move-album', action: viaDialog(() => ctx.moveSongToAlbum(song)) } : null,
    editable && albumId && song.folderId === albumId
      ? { label: 'Quitar de este álbum', icon: 'close', testid: 'menu-remove-from-album', action: viaDialog(() => ctx.removeSongFromAlbum(song, albumId)) }
      : null,
    editable ? { label: 'Cambiar portada', icon: 'image', testid: 'menu-song-cover', action: viaDialog(() => ctx.changeCover({ kind: 'song', id: song.id, name: song.title })) } : null,
    song.local && !song.pending ? { label: 'Borrar de este navegador', icon: 'trash', testid: 'menu-delete-local', action: viaDialog(() => ctx.deleteLocalSong(song)) } : null,
  ].filter(Boolean);
}

/** Botón «Más opciones» de una canción, que abre su menú. */
export function songMoreButton(ctx, song, { playlistId = null, albumId = null, key, testid = 'row-more', size = 20, className = 'row-more' } = {}) {
  const more = iconButton('more', `Más opciones para ${song.title}`, {
    class: className,
    'aria-haspopup': 'menu',
    'aria-expanded': 'false',
    'data-testid': testid,
    'data-key': key,
  }, size);
  more.addEventListener('click', (event) => {
    event.stopPropagation();
    openMenu(more, songMenuItems(ctx, song, { playlistId, albumId }), { label: `Opciones de ${song.title}` });
  });
  return more;
}

/** Botón de «Me gusta» de una canción (corazón). */
export function likeButton(ctx, song, { testid = 'like-button', size = 16, extraClass = '' } = {}) {
  const liked = ctx.isLiked(song.id);
  return iconButton(liked ? 'heart-filled' : 'heart', `Me gusta: ${song.title}`, {
    class: `like-button${liked ? ' is-active' : ''} ${extraClass}`.trim(),
    'aria-pressed': liked ? 'true' : 'false',
    'data-testid': testid,
    'data-key': `like:${testid}:${song.id}`,
    on: { click: (event) => { event.stopPropagation(); ctx.toggleLike(song.id); } },
  }, size);
}

// ---------------------------------------------------------------------------
// Tabla de canciones
// ---------------------------------------------------------------------------

/**
 * Tabla de canciones de una colección: cabecera fija (#, Título, Álbum y reloj) y filas de 56 px; la que suena va en
 * verde (syncPlaying en app.js). Pulsar la fila (o el título, que es un botón) reproduce la colección desde esa canción.
 * showAlbum: columna «Álbum» (no en la página de un álbum). showCover: portada de 40 px en la fila. albumId: el álbum
 * que se está viendo (el menú de la fila ofrece «Quitar de este álbum»).
 */
export function trackTable(ctx, songs, {
  contextId, playlistId = null, albumId = null, showAlbum = true, showCover = true, testid = 'track-table', caption, queue = songs, offset = 0,
}) {
  const head = el('thead', {},
    el('tr', {},
      el('th', { class: 'col-num', scope: 'col' }, '#'),
      el('th', { class: 'col-title', scope: 'col' }, 'Título'),
      showAlbum ? el('th', { class: 'col-album', scope: 'col' }, 'Álbum') : null,
      el('th', { class: 'col-dur', scope: 'col' }, el('span', { class: 'col-dur-icon' }, icon('clock', { size: 16 })), srOnly('Duración'))));
  const body = el('tbody', {});
  songs.forEach((song, index) => {
    const position = offset + index;
    const playable = ctx.isPlayable(song);
    const albumName = song.folderId ? ctx.folderName(song.folderId) : null;
    const play = () => ctx.playSongs(queue, position, { contextId });
    const row = el('tr', {
      class: `track-row${playable ? '' : ' is-unavailable'}`,
      'data-testid': 'track-row',
      'data-song-id': song.id,
      'data-context': contextId,
      'data-index': position,
      on: { click: (event) => { if (!event.target.closest('button, a')) play(); } },
    },
    el('td', { class: 'col-num' },
      el('span', { class: 'num-text' }, String(position + 1)),
      el('span', { class: 'num-play', 'aria-hidden': 'true' }, icon('play', { size: 16 })),
      el('span', { class: 'num-playing', 'aria-hidden': 'true' }, el('i'), el('i'), el('i'))),
    el('td', { class: 'col-title' },
      el('div', { class: 'track-main' },
        showCover ? songCoverNode(ctx, song, 'track-cover') : null,
        // Título y artista van dentro del botón: en el teléfono es un objetivo de 44 px o más.
        el('button', {
          type: 'button',
          class: 'track-text track-play',
          'aria-label': `Reproducir ${song.title}`,
          'data-testid': 'track-title',
          'data-key': `title:${contextId}:${position}`,
          on: { click: (event) => { event.stopPropagation(); play(); } },
        },
        el('span', { class: 'track-title' }, song.title),
        el('span', { class: 'track-artist' },
          // Una subida que se está publicando lleva su estado («Publicándose…») en lugar del artista.
          song.pending
            ? el('span', { class: 'badge badge-pending', 'data-testid': 'track-pending' }, ctx.uploadLabel(song))
            : (song.local ? el('span', { class: 'badge' }, 'En este navegador') : null),
          song.pending ? '' : (song.artist || (song.local ? '' : 'Artista desconocido')),
          playable ? null : el('span', { class: 'track-offline' }, ' · No disponible sin conexión'))))),
    showAlbum ? el('td', { class: 'col-album' },
      albumName ? el('a', { href: `#/album/${encodeURIComponent(song.folderId)}`, class: 'track-album', 'data-key': `album:${contextId}:${position}` }, albumName) : '') : null,
    el('td', { class: 'col-dur' },
      el('div', { class: 'track-actions' },
        likeButton(ctx, song, { testid: 'row-like' }),
        el('span', { class: 'track-duration' }, formatDuration(song.durationS ?? NaN)),
        songMoreButton(ctx, song, { playlistId, albumId, key: `more:${contextId}:${position}` }))));
    body.append(row);
  });
  return el('table', { class: `track-table${showAlbum ? ' has-album' : ''}`, 'data-testid': testid },
    caption ? el('caption', { class: 'sr-only' }, caption) : null, head, body);
}
