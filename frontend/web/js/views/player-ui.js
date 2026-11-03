// Reproductor en pantalla, como el de Spotify:
// - Barra (≥ 768 px), 72 px sobre #000. Izquierda: portada de 56 px, título, artista y «Me gusta». Centro: aleatorio,
//   anterior, reproducir (círculo blanco de 32 px), siguiente y repetir, con la barra de progreso de 4 px. Derecha:
//   «Reproduciendo», letra (desactivado), cola, dispositivo (oculto), volumen y pantalla completa.
// - Panel «Reproduciendo» a la derecha (≥ 1024 px, 300 px): portada grande, título, artista y la siguiente de la
//   cola; el mismo panel muestra la cola. En anchos menores, «Reproduciendo» abre la pantalla completa y la cola
//   una hoja modal.
// - Teléfono (< 768 px): minirreproductor de 56 px con el color dominante de la portada; al tocarlo, la
//   reproducción a pantalla completa.

import { formatDuration } from '../catalog.js';
import { paintCoverColor } from '../cover-color.js';
import { el, iconButton, openDialog } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { songCoverNode } from './components.js';

const REPEAT_LABELS = Object.freeze({
  off: 'Repetir: desactivado',
  all: 'Repetir: toda la cola',
  one: 'Repetir: esta canción',
});
const WIDE_PANEL = '(min-width: 1024px)';
const PANEL_PREFS_KEY = 'reminiscencia.panel';

function readPanelPrefs() {
  try {
    const value = JSON.parse(localStorage.getItem(PANEL_PREFS_KEY) ?? '{}');
    return { open: value?.open === true, mode: value?.mode === 'queue' ? 'queue' : 'now' };
  } catch {
    return { open: false, mode: 'now' };
  }
}

function savePanelPrefs(prefs) {
  try {
    localStorage.setItem(PANEL_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Almacenamiento bloqueado: vale durante la visita.
  }
}

/** Barra deslizante: pista visible de 4 px y un input range transparente encima. */
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

function controlButton(name, label, testid, onClick, size = 16, attrs = {}) {
  return iconButton(name, label, { class: 'control-button', 'data-testid': testid, on: { click: onClick }, ...attrs }, size);
}

function setIcon(button, name, size) {
  button.replaceChildren(icon(name, { size }));
}

/** Monta la barra, el minirreproductor, el panel «Reproduciendo» y la pantalla completa. */
export function mountPlayerUi(ctx, { bar, mini, nowPanel }) {
  const { player } = ctx;
  const panel = readPanelPrefs();
  const artistOf = (track) => ctx.artistOf(track);

  // ---- Barra de escritorio ----
  const barCover = el('div', { class: 'player-cover-slot', 'data-testid': 'player-cover' });
  const barTitle = el('span', { class: 'player-title', 'data-testid': 'player-title' });
  const barArtist = el('span', { class: 'player-artist', 'data-testid': 'player-artist' });
  const barLikeSlot = el('span', { class: 'player-like-slot' });
  const shuffle = controlButton('shuffle', 'Aleatorio', 'player-shuffle', () => ctx.toggleShuffle());
  const prev = controlButton('previous', 'Anterior', 'player-prev', () => player.previous());
  const play = iconButton('play', 'Reproducir', { class: 'player-play', 'data-testid': 'player-play', on: { click: () => player.toggle() } }, 16);
  const next = controlButton('next', 'Siguiente', 'player-next', () => player.next());
  const repeat = controlButton('repeat', REPEAT_LABELS.off, 'player-repeat', () => ctx.cycleRepeat());
  const time = el('span', { class: 'player-time', 'data-testid': 'player-time' }, '0:00');
  const total = el('span', { class: 'player-time player-time-total', 'data-testid': 'player-duration' }, '0:00');
  const progress = slider({ label: 'Posición en la canción', testid: 'player-progress', className: 'progress', onInput: (value) => player.seekTo(value) });
  const nowButton = controlButton('now-playing', 'Reproduciendo', 'player-now', () => toggleNow(), 16, { 'aria-pressed': 'false' });
  const lyrics = controlButton('lyrics', 'Letra (no disponible)', 'player-lyrics', () => {}, 16, { disabled: true });
  const queueButton = controlButton('queue', 'Cola', 'player-queue', () => toggleQueue(), 16, { 'aria-pressed': 'false' });
  const device = controlButton('speaker', 'Conectar a un dispositivo', 'player-device', () => {}, 16, { hidden: true });
  const mute = controlButton('volume', 'Silenciar', 'player-mute', () => player.toggleMute());
  const volume = slider({ label: 'Volumen', testid: 'player-volume', className: 'volume', step: 0.01, onInput: (value) => ctx.setVolume(value) });
  const volumeGroup = el('div', { class: 'volume-group' }, mute, volume.root);
  const fullscreen = controlButton('fullscreen', 'Pantalla completa', 'player-fullscreen', () => openFullPlayer({ fullscreen: true }));

  bar.replaceChildren(
    el('div', { class: 'player-left' }, barCover, el('div', { class: 'player-text' }, barTitle, barArtist), barLikeSlot),
    el('div', { class: 'player-center' },
      el('div', { class: 'player-controls' }, shuffle, prev, play, next, repeat),
      el('div', { class: 'player-progress' }, time, progress.root, total)),
    el('div', { class: 'player-right' }, nowButton, lyrics, queueButton, device, volumeGroup, fullscreen));

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
      items.push(el('h3', { class: 'queue-heading' }, state.contextName ? `A continuación de: ${state.contextName}` : 'A continuación'));
      items.push(el('ul', { class: 'queue-list', 'data-testid': 'queue-next' }, rest.map((item) => queueRow(item.track, item.key))));
    }
    if (items.length === 0) items.push(el('p', { class: 'empty-text' }, 'La cola está vacía. Elige algo para escuchar.'));
    return items;
  }

  function queueRow(track, key, nowPlaying = false, testid = 'queue-item') {
    const content = [
      songCoverNode(ctx, track, 'track-cover'),
      el('span', { class: 'track-text' },
        el('span', { class: `add-title${nowPlaying ? ' is-playing' : ''}` }, track.title),
        el('span', { class: 'track-artist' }, artistOf(track))),
    ];
    if (nowPlaying) return el('li', { class: 'queue-row' }, ...content);
    return el('li', {},
      el('button', { type: 'button', class: 'queue-row queue-button', 'aria-label': `Reproducir ${track.title}`, 'data-testid': testid, on: { click: () => player.playEntry(key) } }, ...content));
  }

  // ---- Panel derecho: «Reproduciendo» o «Cola» ----
  const nowTitle = el('h2', { class: 'now-title', id: 'titulo-reproduciendo', tabindex: '-1', 'data-testid': 'now-panel-title' }, 'Reproduciendo');
  const nowBody = el('div', { class: 'now-body', 'data-testid': 'now-panel-body' });
  nowPanel.replaceChildren(
    el('div', { class: 'now-head' }, nowTitle,
      iconButton('close', 'Cerrar el panel', { class: 'control-button', 'data-testid': 'now-close', on: { click: () => setPanel(false) } }, 16)),
    nowBody);

  const wide = () => window.matchMedia(WIDE_PANEL).matches;

  function applyPanel() {
    const open = panel.open && wide();
    nowPanel.hidden = !open;
    document.documentElement.classList.toggle('now-open', open);
    nowButton.setAttribute('aria-pressed', String(open && panel.mode === 'now'));
    nowButton.classList.toggle('is-active', open && panel.mode === 'now');
    queueButton.setAttribute('aria-pressed', String(open && panel.mode === 'queue'));
    queueButton.classList.toggle('is-active', open && panel.mode === 'queue');
    delete nowBody.dataset.signature;
  }

  function setPanel(open, mode = panel.mode, { focus = true } = {}) {
    panel.open = open;
    panel.mode = mode;
    savePanelPrefs(panel);
    applyPanel();
    update(player.getState());
    if (open && focus) nowTitle.focus();
    else if (!open && focus) (mode === 'queue' ? queueButton : nowButton).focus();
  }

  function toggleNow() {
    if (!wide()) {
      openFullPlayer();
      return;
    }
    setPanel(!(panel.open && panel.mode === 'now'), 'now');
  }

  let queueDialogBody = null;
  function toggleQueue() {
    if (!wide()) {
      openQueueDialog();
      return;
    }
    setPanel(!(panel.open && panel.mode === 'queue'), 'queue');
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

  function nowContent(state) {
    const track = state.track;
    if (!track) return [el('p', { class: 'empty-text' }, 'Elige algo para escuchar.')];
    const following = state.upcoming[0] ?? null;
    return [
      songCoverNode(ctx, track, 'now-cover'),
      el('div', { class: 'now-meta' },
        el('div', { class: 'now-text' },
          el('p', { class: 'now-track', 'data-testid': 'now-track' }, track.title),
          el('p', { class: 'now-artist' }, artistOf(track))),
        ctx.likeButtonFor(track, 'now-like', 24)),
      el('section', { class: 'now-next', 'aria-labelledby': 'titulo-siguiente' },
        el('div', { class: 'now-next-head' },
          el('h3', { class: 'now-next-title', id: 'titulo-siguiente' }, 'Siguiente en la cola'),
          el('button', { type: 'button', class: 'now-open-queue', 'data-testid': 'now-open-queue', on: { click: () => setPanel(true, 'queue') } }, 'Abrir la cola')),
        following
          ? el('ul', { class: 'queue-list' }, queueRow(following.track, following.key, false, 'now-next'))
          : el('p', { class: 'empty-text' }, 'No hay nada más en la cola.')),
    ];
  }

  // ---- Pantalla completa (teléfono, tableta y el botón «Pantalla completa») ----
  let fullUpdate = null;
  function openFullPlayer({ fullscreen: wantsFullscreen = false } = {}) {
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
            coverSlot.replaceChildren(songCoverNode(ctx, s.track, 'full-cover'));
            likeSlot.replaceChildren(ctx.likeButtonFor(s.track, 'full-like', 24));
            paintCoverColor([dialog], ctx.songCoverSrc(s.track), ctx.songColor(s.track));
            if (focusedLike) likeSlot.querySelector('button')?.focus();
          }
          context.textContent = s.contextName ? `Reproduciendo desde ${s.contextName}` : 'Reproduciendo';
          artist.textContent = artistOf(s.track);
          fullProgress.set(s.position, s.duration, `${formatDuration(s.position)} de ${formatDuration(s.duration)}`);
          fullTime.textContent = formatDuration(s.position);
          fullTotal.textContent = formatDuration(s.duration);
          paintToggles(s, { shuffle: fShuffle, repeat: fRepeat, play: fPlay, playSize: 28, repeatSize: 24 });
        };
        fullUpdate(state);
        // Tras abrirse el diálogo (render va antes de showModal), a pantalla completa de verdad si el navegador deja.
        if (wantsFullscreen) setTimeout(() => Promise.resolve(dialog.requestFullscreen?.()).catch(() => {}), 0);
      },
    }).then(() => {
      fullUpdate = null;
      if (document.fullscreenElement) Promise.resolve(document.exitFullscreen?.()).catch(() => {});
    });
  }

  function paintToggles(state, { shuffle: shuffleButton, repeat: repeatButton, play: playButton, playSize, repeatSize = 16 }) {
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
      barCover.replaceChildren(track ? songCoverNode(ctx, track, 'player-cover') : el('span', { class: 'cover player-cover cover-empty', 'aria-hidden': 'true' }));
      barTitle.replaceChildren(track
        ? (track.folderId ? el('a', { class: 'player-title-link', href: `#/album/${encodeURIComponent(track.folderId)}`, 'data-key': 'player-title-link' }, track.title) : track.title)
        : 'Elige algo para escuchar');
      barArtist.textContent = track ? artistOf(track) : '';
      barLikeSlot.replaceChildren(track ? ctx.likeButtonFor(track, 'player-like', 16) : '');
      miniCover.replaceChildren(track ? songCoverNode(ctx, track, 'mini-cover') : '');
      miniTitle.textContent = track ? track.title : '';
      miniArtist.textContent = track ? artistOf(track) : '';
      miniOpen.setAttribute('aria-label', track ? `Abrir el reproductor: ${track.title}` : 'Abrir el reproductor');
      miniLikeSlot.replaceChildren(track ? ctx.likeButtonFor(track, 'mini-like', 24) : '');
      paintCoverColor([mini], track ? ctx.songCoverSrc(track) : null, track ? ctx.songColor(track) : '#282828');
      mini.hidden = !track;
      document.documentElement.classList.toggle('has-track', Boolean(track));
      focusedLike?.querySelector('button')?.focus();
    }
    paintToggles(state, { shuffle, repeat, play, playSize: 16 });
    for (const button of [prev, next, fullscreen]) button.disabled = !track;
    progress.disable(!track);
    progress.set(state.position, state.duration, `${formatDuration(state.position)} de ${formatDuration(state.duration)}`);
    time.textContent = formatDuration(state.position);
    total.textContent = formatDuration(state.duration);
    const shown = state.muted ? 0 : state.volume;
    volume.set(shown, 1, `${Math.round(shown * 100)} %`);
    mute.setAttribute('aria-label', state.muted ? 'Activar el sonido' : 'Silenciar');
    setIcon(mute, state.muted || state.volume === 0 ? 'volume-muted' : 'volume', 16);
    volumeGroup.hidden = !state.volumeAdjustable;
    miniPlay.setAttribute('aria-label', state.playing ? 'Pausar' : 'Reproducir');
    setIcon(miniPlay, state.playing ? 'pause' : 'play', 24);
    mini.style.setProperty('--ratio', String(state.duration > 0 ? Math.min(1, state.position / state.duration) : 0));
    // El panel y la cola solo se vuelven a pintar cuando cambian (no con cada avance del tiempo), para no perder el foco.
    const signature = `${state.key}|${liked}|${state.contextName}|${state.upcoming.map((item) => item.key).join(',')}`;
    if (!nowPanel.hidden && nowBody.dataset.signature !== `${panel.mode}|${signature}`) {
      const focusedKey = document.activeElement && nowBody.contains(document.activeElement) ? document.activeElement.dataset.testid : null;
      nowBody.dataset.signature = `${panel.mode}|${signature}`;
      nowTitle.textContent = panel.mode === 'queue' ? 'Cola' : (state.contextName || 'Reproduciendo');
      nowBody.replaceChildren(...(panel.mode === 'queue' ? queueContent(state) : nowContent(state)));
      if (focusedKey) nowBody.querySelector(`[data-testid="${focusedKey}"]`)?.focus();
    }
    if (queueDialogBody && queueDialogBody.dataset.signature !== signature) {
      queueDialogBody.dataset.signature = signature;
      queueDialogBody.replaceChildren(...queueContent(state));
    }
    if (fullUpdate) fullUpdate(state);
  }

  applyPanel();
  window.matchMedia(WIDE_PANEL).addEventListener?.('change', () => {
    applyPanel();
    update(player.getState());
  });

  return { update, openFullPlayer };
}
