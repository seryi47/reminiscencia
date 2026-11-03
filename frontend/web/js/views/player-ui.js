// Reproductor en pantalla:
// - Escritorio y tableta (≥ 768 px): barra de 72 px abajo. A la izquierda portada de 56 px, título, artista y
//   «Me gusta»; en el centro aleatorio, anterior, reproducir (círculo blanco de 32 px), siguiente y repetir, con la
//   barra de progreso de 4 px y los tiempos; a la derecha la cola y el volumen.
// - Teléfono (< 768 px): minirreproductor de 56 px sobre la barra inferior, con progreso fino. Al tocarlo se abre
//   la reproducción a pantalla completa.
// - Cola: panel a la derecha en escritorio (≥ 1024 px); hoja modal en anchos menores.

import { formatDuration } from '../catalog.js';
import { el, iconButton, openDialog } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { cover } from './components.js';

const REPEAT_LABELS = Object.freeze({
  off: 'Repetir: desactivado',
  all: 'Repetir: toda la cola',
  one: 'Repetir: esta canción',
});
const WIDE_QUEUE = '(min-width: 1024px)';

/** Barra deslizante: pista visible de 4 px (o la altura del CSS) y un input range transparente encima. */
function slider({ label, testid, className = '', step = 1, onInput }) {
  const fill = el('span', { class: 'slider-fill' });
  const thumb = el('span', { class: 'slider-thumb' });
  const input = el('input', { type: 'range', min: '0', max: '0', step: String(step), value: '0', class: 'slider-input', 'aria-label': label, 'data-testid': testid });
  const root = el('div', { class: `slider ${className}`.trim() },
    el('span', { class: 'slider-track', 'data-testid': `${testid}-track` }, fill), thumb, input);
  let dragging = false;
  input.addEventListener('pointerdown', () => { dragging = true; });
  const stop = () => { dragging = false; };
  input.addEventListener('pointerup', stop);
  input.addEventListener('pointercancel', stop);
  input.addEventListener('blur', stop);
  input.addEventListener('input', () => {
    paint(Number(input.value), Number(input.max));
    onInput(Number(input.value));
  });
  function paint(value, max) {
    const ratio = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
    root.style.setProperty('--ratio', String(ratio));
  }
  return {
    root,
    input,
    set(value, max, text) {
      input.max = String(max);
      if (!dragging) input.value = String(value);
      if (text) input.setAttribute('aria-valuetext', text);
      paint(dragging ? Number(input.value) : value, max);
    },
    disable(disabled) {
      input.disabled = disabled;
    },
  };
}

function controlButton(name, label, testid, onClick, size = 20) {
  return iconButton(name, label, { class: 'control-button', 'data-testid': testid, on: { click: onClick } }, size);
}

function setIcon(button, name, size) {
  button.replaceChildren(icon(name, { size }));
}

/** Monta los tres reproductores y la cola. Devuelve update(state) y openFullPlayer(). */
export function mountPlayerUi(ctx, { bar, mini, queuePanel }) {
  const { player } = ctx;

  // ---- Barra de escritorio ----
  const barCover = el('div', { class: 'player-cover-slot', 'data-testid': 'player-cover' });
  const barTitle = el('span', { class: 'player-title', 'data-testid': 'player-title' });
  const barArtist = el('span', { class: 'player-artist', 'data-testid': 'player-artist' });
  const barLikeSlot = el('span', { class: 'player-like-slot' });
  const shuffle = controlButton('shuffle', 'Aleatorio', 'player-shuffle', () => ctx.toggleShuffle());
  const prev = controlButton('previous', 'Anterior', 'player-prev', () => player.previous(), 16);
  const play = iconButton('play', 'Reproducir', { class: 'player-play', 'data-testid': 'player-play', on: { click: () => player.toggle() } }, 16);
  const next = controlButton('next', 'Siguiente', 'player-next', () => player.next(), 16);
  const repeat = controlButton('repeat', REPEAT_LABELS.off, 'player-repeat', () => ctx.cycleRepeat());
  const time = el('span', { class: 'player-time', 'data-testid': 'player-time' }, '0:00');
  const total = el('span', { class: 'player-time player-time-total', 'data-testid': 'player-duration' }, '0:00');
  const progress = slider({ label: 'Posición en la canción', testid: 'player-progress', className: 'progress', onInput: (value) => player.seekTo(value) });
  const queueButton = iconButton('queue', 'Cola', { class: 'control-button', 'aria-pressed': 'false', 'data-testid': 'player-queue', on: { click: () => toggleQueue() } }, 20);
  const mute = iconButton('volume', 'Silenciar', { class: 'control-button', 'data-testid': 'player-mute', on: { click: () => player.toggleMute() } }, 20);
  const volume = slider({ label: 'Volumen', testid: 'player-volume', className: 'volume', step: 0.01, onInput: (value) => ctx.setVolume(value) });
  const volumeGroup = el('div', { class: 'volume-group' }, mute, volume.root);

  bar.replaceChildren(
    el('div', { class: 'player-left' }, barCover, el('div', { class: 'player-text' }, barTitle, barArtist), barLikeSlot),
    el('div', { class: 'player-center' },
      el('div', { class: 'player-controls' }, shuffle, prev, play, next, repeat),
      el('div', { class: 'player-progress' }, time, progress.root, total)),
    el('div', { class: 'player-right' }, queueButton, volumeGroup));

  // ---- Minirreproductor del teléfono ----
  const miniCover = el('span', { class: 'mini-cover-slot' });
  const miniTitle = el('span', { class: 'mini-title', 'data-testid': 'mini-title' });
  const miniArtist = el('span', { class: 'mini-artist' });
  const miniOpen = el('button', { type: 'button', class: 'mini-open', 'data-testid': 'mini-open', on: { click: () => openFullPlayer() } },
    miniCover, el('span', { class: 'mini-text' }, miniTitle, miniArtist));
  const miniLikeSlot = el('span', { class: 'mini-like-slot' });
  const miniPlay = iconButton('play', 'Reproducir', { class: 'mini-play', 'data-testid': 'mini-play', on: { click: () => player.toggle() } }, 24);
  const miniProgress = el('span', { class: 'mini-progress', 'aria-hidden': 'true' }, el('span', { class: 'mini-progress-fill' }));
  mini.replaceChildren(miniOpen, miniLikeSlot, miniPlay, miniProgress);

  // ---- Cola ----
  function queueContent(state) {
    const items = [];
    if (state.track) {
      items.push(el('h3', { class: 'queue-heading' }, 'Sonando'));
      items.push(el('ul', { class: 'queue-list' }, queueRow(state.track, null, true)));
    }
    const queued = state.upcoming.filter((item) => item.fromQueue);
    const rest = state.upcoming.filter((item) => !item.fromQueue);
    if (queued.length > 0) {
      items.push(el('h3', { class: 'queue-heading' }, 'A continuación en la cola'));
      items.push(el('ul', { class: 'queue-list', 'data-testid': 'queue-added' }, queued.map((item) => queueRow(item.track, item.key))));
    }
    if (rest.length > 0) {
      items.push(el('h3', { class: 'queue-heading' }, state.contextName ? `A continuación: ${state.contextName}` : 'A continuación'));
      items.push(el('ul', { class: 'queue-list', 'data-testid': 'queue-next' }, rest.map((item) => queueRow(item.track, item.key))));
    }
    if (items.length === 0) items.push(el('p', { class: 'empty-text' }, 'La cola está vacía. Elige algo para escuchar.'));
    return items;
  }

  function queueRow(track, key, nowPlaying = false) {
    const content = [
      cover({ color: ctx.songColor(track), iconName: 'note', className: 'track-cover' }),
      el('span', { class: 'track-text' },
        el('span', { class: `add-title${nowPlaying ? ' is-playing' : ''}` }, track.title),
        el('span', { class: 'track-artist' }, track.artist || (track.local ? 'Subida a este navegador' : 'Artista desconocido'))),
    ];
    if (nowPlaying) return el('li', { class: 'queue-row' }, ...content);
    return el('li', {},
      el('button', { type: 'button', class: 'queue-row queue-button', 'aria-label': `Reproducir ${track.title}`, 'data-testid': 'queue-item', on: { click: () => player.playEntry(key) } }, ...content));
  }

  let queueDialogBody = null;
  function toggleQueue() {
    if (window.matchMedia(WIDE_QUEUE).matches) {
      const open = queuePanel.hidden;
      queuePanel.hidden = !open;
      document.documentElement.classList.toggle('queue-open', open);
      queueButton.setAttribute('aria-pressed', String(open));
      update(player.getState());
      if (open) queuePanel.querySelector('h2')?.focus();
      return;
    }
    openQueueDialog();
  }

  function openQueueDialog() {
    openDialog({
      title: 'Cola',
      testid: 'queue-dialog',
      className: 'dialog-queue',
      render: (body) => {
        queueDialogBody = body;
        body.replaceChildren(...queueContent(player.getState()));
      },
    }).then(() => { queueDialogBody = null; });
  }

  queuePanel.replaceChildren(
    el('div', { class: 'queue-head' },
      el('h2', { class: 'queue-title', tabindex: '-1' }, 'Cola'),
      iconButton('close', 'Cerrar la cola', { class: 'control-button', 'data-testid': 'queue-close', on: { click: () => toggleQueue() } }, 20)),
    el('div', { class: 'queue-body', 'data-testid': 'queue-panel-body' }));

  // ---- Pantalla completa (teléfono) ----
  let fullUpdate = null;
  function openFullPlayer() {
    const state = player.getState();
    if (!state.track) return;
    openDialog({
      title: state.track.title,
      className: 'dialog-full',
      testid: 'full-player',
      closeLabel: 'Cerrar el reproductor',
      closeIcon: 'chevron-down',
      render: (body, close, dialog) => {
        const context = el('p', { class: 'full-context' });
        const coverSlot = el('div', { class: 'full-cover-slot' });
        const artist = el('p', { class: 'full-artist', 'data-testid': 'full-artist' });
        const likeSlot = el('span', { class: 'full-like-slot' });
        const fullProgress = slider({ label: 'Posición en la canción', testid: 'full-progress', className: 'progress', onInput: (value) => player.seekTo(value) });
        const fullTime = el('span', { class: 'player-time' });
        const fullTotal = el('span', { class: 'player-time player-time-total' });
        const fShuffle = controlButton('shuffle', 'Aleatorio', 'full-shuffle', () => ctx.toggleShuffle(), 24);
        const fPrev = controlButton('previous', 'Anterior', 'full-prev', () => player.previous(), 28);
        const fPlay = iconButton('play', 'Reproducir', { class: 'full-play', 'data-testid': 'full-play', on: { click: () => player.toggle() } }, 28);
        const fNext = controlButton('next', 'Siguiente', 'full-next', () => player.next(), 28);
        const fRepeat = controlButton('repeat', REPEAT_LABELS.off, 'full-repeat', () => ctx.cycleRepeat(), 24);
        const fQueue = el('button', { type: 'button', class: 'button button-text full-queue', 'data-testid': 'full-queue', on: { click: () => openQueueDialog() } }, icon('queue', { size: 20 }), 'Cola');
        const titleEl = dialog.querySelector('.dialog-title');
        body.append(
          context, coverSlot,
          el('div', { class: 'full-meta' }, el('div', { class: 'full-text' }, artist), likeSlot),
          el('div', { class: 'full-progress' }, fullProgress.root, el('div', { class: 'full-times' }, fullTime, fullTotal)),
          el('div', { class: 'full-controls' }, fShuffle, fPrev, fPlay, fNext, fRepeat),
          fQueue);
        let lastSignature = null;
        fullUpdate = (s) => {
          if (!s.track) {
            close();
            return;
          }
          const liked = ctx.isLiked(s.track.id);
          const signature = `${s.key}|${liked}`;
          if (signature !== lastSignature) {
            const focusedLike = likeSlot.contains(document.activeElement);
            lastSignature = signature;
            titleEl.textContent = s.track.title;
            coverSlot.replaceChildren(cover({ color: ctx.songColor(s.track), iconName: 'note', className: 'full-cover' }));
            likeSlot.replaceChildren(ctx.likeButtonFor(s.track, 'full-like', 24));
            if (focusedLike) likeSlot.querySelector('button')?.focus();
          }
          context.textContent = s.contextName ? `Reproduciendo desde ${s.contextName}` : 'Reproduciendo';
          artist.textContent = s.track.artist || (s.track.local ? 'Subida a este navegador' : 'Artista desconocido');
          fullProgress.set(s.position, s.duration, `${formatDuration(s.position)} de ${formatDuration(s.duration)}`);
          fullTime.textContent = formatDuration(s.position);
          fullTotal.textContent = formatDuration(s.duration);
          paintToggles(s, { shuffle: fShuffle, repeat: fRepeat, play: fPlay, playSize: 28, repeatSize: 24 });
        };
        fullUpdate(state);
      },
    }).then(() => { fullUpdate = null; });
  }

  function paintToggles(state, { shuffle: shuffleButton, repeat: repeatButton, play: playButton, playSize, repeatSize = 20 }) {
    shuffleButton.classList.toggle('is-active', state.shuffle);
    shuffleButton.setAttribute('aria-pressed', String(state.shuffle));
    repeatButton.classList.toggle('is-active', state.repeat !== 'off');
    repeatButton.setAttribute('aria-label', REPEAT_LABELS[state.repeat]);
    repeatButton.dataset.mode = state.repeat;
    setIcon(repeatButton, state.repeat === 'one' ? 'repeat-one' : 'repeat', repeatSize);
    playButton.setAttribute('aria-label', state.playing ? 'Pausar' : 'Reproducir');
    setIcon(playButton, state.playing ? 'pause' : 'play', playSize);
    playButton.disabled = !state.track;
  }

  // ---- Actualización ----
  // undefined fuerza la primera pintura (sin canción, key y liked valen null).
  let lastTrackKey;
  let lastLiked;
  function update(state) {
    const track = state.track;
    const liked = track ? ctx.isLiked(track.id) : null;
    if (state.key !== lastTrackKey || liked !== lastLiked) {
      const focusedLike = [barLikeSlot, miniLikeSlot].find((slot) => slot.contains(document.activeElement));
      lastTrackKey = state.key;
      lastLiked = liked;
      barCover.replaceChildren(track ? cover({ color: ctx.songColor(track), iconName: 'note', className: 'player-cover' }) : el('span', { class: 'cover player-cover cover-empty', 'aria-hidden': 'true' }));
      barTitle.textContent = track ? track.title : 'Elige algo para escuchar';
      barArtist.textContent = track ? (track.artist || (track.local ? 'Subida a este navegador' : 'Artista desconocido')) : '';
      barLikeSlot.replaceChildren(track ? ctx.likeButtonFor(track, 'player-like', 16) : '');
      miniCover.replaceChildren(track ? cover({ color: ctx.songColor(track), iconName: 'note', className: 'mini-cover' }) : '');
      miniTitle.textContent = track ? track.title : '';
      miniArtist.textContent = track ? (track.artist || (track.local ? 'Subida a este navegador' : 'Artista desconocido')) : '';
      miniOpen.setAttribute('aria-label', track ? `Abrir el reproductor: ${track.title}` : 'Abrir el reproductor');
      miniLikeSlot.replaceChildren(track ? ctx.likeButtonFor(track, 'mini-like', 20) : '');
      mini.style.setProperty('--cover-color', track ? ctx.songColor(track) : '#282828');
      mini.hidden = !track;
      document.documentElement.classList.toggle('has-track', Boolean(track));
      focusedLike?.querySelector('button')?.focus();
    }
    paintToggles(state, { shuffle, repeat, play, playSize: 16 });
    for (const button of [prev, next]) button.disabled = !track;
    progress.disable(!track);
    progress.set(state.position, state.duration, `${formatDuration(state.position)} de ${formatDuration(state.duration)}`);
    time.textContent = formatDuration(state.position);
    total.textContent = formatDuration(state.duration);
    const shown = state.muted ? 0 : state.volume;
    volume.set(shown, 1, `${Math.round(shown * 100)} %`);
    mute.setAttribute('aria-label', state.muted ? 'Activar el sonido' : 'Silenciar');
    setIcon(mute, state.muted || state.volume === 0 ? 'volume-muted' : 'volume', 20);
    volumeGroup.hidden = !state.volumeAdjustable;
    miniPlay.setAttribute('aria-label', state.playing ? 'Pausar' : 'Reproducir');
    setIcon(miniPlay, state.playing ? 'pause' : 'play', 24);
    mini.style.setProperty('--ratio', String(state.duration > 0 ? Math.min(1, state.position / state.duration) : 0));
    // La cola solo se vuelve a pintar cuando cambia (no con cada avance del tiempo), para no perder el foco.
    const signature = `${state.key}|${state.contextName}|${state.upcoming.map((item) => item.key).join(',')}`;
    if (!queuePanel.hidden && queuePanel.dataset.signature !== signature) {
      queuePanel.dataset.signature = signature;
      queuePanel.querySelector('.queue-body').replaceChildren(...queueContent(state));
    }
    if (queueDialogBody && queueDialogBody.dataset.signature !== signature) {
      queueDialogBody.dataset.signature = signature;
      queueDialogBody.replaceChildren(...queueContent(state));
    }
    if (fullUpdate) fullUpdate(state);
  }

  return { update, openFullPlayer };
}
