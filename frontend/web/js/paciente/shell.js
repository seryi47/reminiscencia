// Marco del modo paciente de Reminiscencia (DESIGN 3.1, 6.1 P-1 a P-3, P-18 y P-19; contrato 2.1 y 5).
// Dibuja la cabecera (H1 y botón Cuidador), la navegación (barra inferior o raíl), el mini reproductor
// y la banda sin conexión. Además exporta las piezas comunes que usan las pantallas y diálogos del paciente:
// el constructor de elementos, los iconos, el control de toques repetidos y el diálogo modal.
// No consulta el almacén ni crea el reproductor: todo lo pide a los servicios que recibe.

// Evento que dispara salida.js al quitar el PIN; la cabecera vuelve a comprobar si hay PIN (candado).
export const PIN_CHANGED_EVENT = 'reminiscencia:pin-cambiado';

// Un segundo toque sobre el mismo control en este plazo se ignora (DESIGN 7.1).
export const TAP_GUARD_MS = 400;

// Destinos fijos de la navegación del paciente (DESIGN 3.1): Escuchar, Listas, Carpetas y Buscar.
export const NAV_DESTINATIONS = Object.freeze([
  Object.freeze({ key: 'escuchar', label: 'Escuchar', icon: 'auriculares' }),
  Object.freeze({ key: 'listas', label: 'Listas', icon: 'lista' }),
  Object.freeze({ key: 'carpetas', label: 'Carpetas', icon: 'carpeta' }),
  Object.freeze({ key: 'buscar', label: 'Buscar', icon: 'lupa' }),
]);

const SVG_NS = 'http://www.w3.org/2000/svg';
const MINI_REFRESH_MS = 250;
const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

// Contador para generar identificadores únicos (aria-labelledby) sin colisiones entre pantallas.
let uniqueCounter = 0;
export function nextId(prefix) {
  uniqueCounter += 1;
  return `${prefix}-${uniqueCounter}`;
}

// El mini reproductor solo aparece con una pista cargada, fuera de Escuchar y si la pantalla lo permite.
export function miniPlayerVisible({ allowed, hasTrack, activeKey }) {
  return Boolean(allowed) && Boolean(hasTrack) && activeKey !== 'escuchar';
}

// Control de toques repetidos: acepta un toque y rechaza otro sobre el mismo elemento dentro de windowMs.
// El reloj se inyecta para poder probarlo sin esperar.
export function createTapGuard(windowMs = TAP_GUARD_MS, now = () => Date.now()) {
  const lastAccepted = new WeakMap();
  return {
    accept(target) {
      const time = now();
      const previous = lastAccepted.get(target);
      if (previous !== undefined && time - previous < windowMs) return false;
      lastAccepted.set(target, time);
      return true;
    },
  };
}

// Crea un elemento. Atributos: `text` fija el texto (textContent), `on` añade escuchadores, true añade el
// atributo y false, null o undefined lo omiten. Los hijos de texto entran como nodos de texto: nunca innerHTML.
export function element(tag, attributes = {}, children = []) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value === undefined || value === null || value === false) continue;
    if (name === 'text') {
      node.textContent = String(value);
    } else if (name === 'on') {
      for (const [type, handler] of Object.entries(value)) node.addEventListener(type, handler);
    } else {
      node.setAttribute(name, value === true ? '' : String(value));
    }
  }
  for (const child of Array.isArray(children) ? children : [children]) {
    if (child === undefined || child === null || child === false) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

// Figuras de los iconos propios (trazo de 2 px, DESIGN 5.4). Son plantillas fijas, sin datos de usuario.
const ICON_SHAPES = Object.freeze({
  auriculares: [
    ['path', { d: 'M4 14v-2a8 8 0 0 1 16 0v2' }],
    ['rect', { x: 3, y: 14, width: 5, height: 7, rx: 2 }],
    ['rect', { x: 16, y: 14, width: 5, height: 7, rx: 2 }],
  ],
  lista: [
    ['path', { d: 'M9 6h11M9 12h11M9 18h11' }],
    ['circle', { cx: 4.5, cy: 6, r: 1, fill: 'currentColor', stroke: 'none' }],
    ['circle', { cx: 4.5, cy: 12, r: 1, fill: 'currentColor', stroke: 'none' }],
    ['circle', { cx: 4.5, cy: 18, r: 1, fill: 'currentColor', stroke: 'none' }],
  ],
  carpeta: [
    ['path', { d: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z' }],
  ],
  lupa: [
    ['circle', { cx: 11, cy: 11, r: 7 }],
    ['path', { d: 'M20 20l-4.5-4.5' }],
  ],
  anterior: [
    ['path', { d: 'M6 5v14' }],
    ['path', { d: 'M18 6v12l-9-6z', fill: 'currentColor', stroke: 'none' }],
  ],
  siguiente: [
    ['path', { d: 'M18 5v14' }],
    ['path', { d: 'M6 6v12l9-6z', fill: 'currentColor', stroke: 'none' }],
  ],
  reproducir: [
    ['path', { d: 'M8 5.5v13l10.5-6.5z', fill: 'currentColor', stroke: 'none' }],
  ],
  pausar: [
    ['rect', { x: 7, y: 5, width: 3.5, height: 14, fill: 'currentColor', stroke: 'none' }],
    ['rect', { x: 13.5, y: 5, width: 3.5, height: 14, fill: 'currentColor', stroke: 'none' }],
  ],
  menos: [['path', { d: 'M5 12h14' }]],
  mas: [['path', { d: 'M5 12h14M12 5v14' }]],
  candado: [
    ['rect', { x: 5, y: 11, width: 14, height: 10, rx: 2 }],
    ['path', { d: 'M8 11V7.5a4 4 0 0 1 8 0V11' }],
  ],
  'sin-conexion': [
    ['path', { d: 'M3 3l18 18' }],
    ['path', { d: 'M5 12.5a10 10 0 0 1 3.5-2.4M19 12.5a10 10 0 0 0-3.2-2.1' }],
    ['path', { d: 'M9 16.5a5 5 0 0 1 4.5-1.5' }],
    ['circle', { cx: 12, cy: 19.5, r: 0.9, fill: 'currentColor', stroke: 'none' }],
  ],
  foto: [
    ['rect', { x: 3, y: 5, width: 18, height: 14, rx: 2 }],
    ['circle', { cx: 9, cy: 10, r: 2 }],
    ['path', { d: 'M21 16l-5-5-8 8' }],
  ],
  nota: [
    ['path', { d: 'M9 18V5l11-2v13' }],
    ['circle', { cx: 6, cy: 18, r: 3 }],
    ['circle', { cx: 17, cy: 16, r: 3 }],
  ],
});

// Icono decorativo (aria-hidden): el nombre accesible lo da el texto o el aria-label del control.
export function icon(name) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('class', 'p-icono');
  for (const [tag, attributes] of ICON_SHAPES[name] ?? []) {
    const shape = document.createElementNS(SVG_NS, tag);
    for (const [attribute, value] of Object.entries(attributes)) shape.setAttribute(attribute, String(value));
    svg.append(shape);
  }
  return svg;
}

// Un elemento es utilizable si no está deshabilitado ni oculto. Se usa para el orden del foco de los diálogos.
function isUsable(node) {
  if (node.disabled || node.getAttribute('aria-disabled') === 'true') return false;
  if (node.closest('[hidden]')) return false;
  return getComputedStyle(node).visibility !== 'hidden' && node.getClientRects().length > 0;
}

// Un diálogo abierto por otro (p. ej. la confirmación de services.confirm) tiene su propio aria-modal;
// no se le quita el foco.
function isForeignModal(target, overlay) {
  if (!(target instanceof Element)) return false;
  const modal = target.closest('[aria-modal="true"]');
  return modal !== null && !overlay.contains(modal);
}

// Diálogo modal del paciente (DESIGN 7.3 y C-16, aplicados al modo paciente). Recibe el panel ya construido
// (role dialog o alertdialog, aria-labelledby y data-testid). Envuelve el panel en una capa, atrapa el foco,
// cierra con Escape, deja inerte el resto de la página y devuelve el foco al disparador al cerrar.
// Devuelve { promise, close(value) }: la promesa se resuelve con el valor que se pase a close.
export function openModal({ panel, initialFocus = null, onEscape = null }) {
  const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const overlay = element('div', { class: 'p-modal' }, [panel]);
  const inerted = [];
  let closed = false;
  let resolvePromise;
  const promise = new Promise((resolve) => {
    resolvePromise = resolve;
  });
  if (!panel.hasAttribute('tabindex')) panel.setAttribute('tabindex', '-1');

  const focusables = () => [...panel.querySelectorAll(FOCUSABLE)].filter(isUsable);

  function close(value) {
    if (closed) return;
    closed = true;
    overlay.removeEventListener('keydown', onKeydown);
    document.removeEventListener('focusin', onFocusIn, true);
    overlay.remove();
    for (const node of inerted) node.removeAttribute('inert');
    if (trigger && trigger.isConnected) trigger.focus();
    resolvePromise(value);
  }

  // Escape cierra (DESIGN 7.2 y 7.3). Tab y Mayús+Tab recorren solo el diálogo, en ciclo.
  function onKeydown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      if (onEscape) onEscape();
      else close(null);
      return;
    }
    if (event.key !== 'Tab') return;
    const items = focusables();
    if (items.length === 0) {
      event.preventDefault();
      panel.focus();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !panel.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !panel.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  }

  // Si el foco sale del diálogo (por ejemplo, con el puntero), vuelve al primer control del diálogo.
  function onFocusIn(event) {
    if (overlay.contains(event.target) || isForeignModal(event.target, overlay)) return;
    (focusables()[0] ?? panel).focus();
  }

  // El resto de la página queda inerte mientras el diálogo está abierto.
  for (const node of [...document.body.children]) {
    if (node === overlay || node.hasAttribute('inert')) continue;
    node.setAttribute('inert', '');
    inerted.push(node);
  }
  document.body.append(overlay);
  overlay.addEventListener('keydown', onKeydown);
  document.addEventListener('focusin', onFocusIn, true);
  (initialFocus ?? focusables()[0] ?? panel).focus();
  return { promise, close };
}

// Marco del modo paciente. Devuelve la zona de contenido (app-main) y los métodos que usa el integrador.
export function mountShell(appRoot, services) {
  const state = {
    activeKey: null,
    playerAllowed: true,
    hasPin: false,
    unmounted: false,
    miniPlaying: null,
    miniTitle: null,
  };
  const taps = createTapGuard();

  // Cabecera de 64 px (P-1): H1 a la izquierda y botón Cuidador a la derecha, con candado solo si hay PIN.
  const titleNode = element('h1', { class: 'p-title', 'data-testid': 'p-title', tabindex: '-1' });
  const lockNode = icon('candado');
  lockNode.classList.add('p-candado');
  lockNode.hidden = true;
  const caregiverButton = element('button', {
    type: 'button',
    class: 'p-cuidador',
    'data-testid': 'p-caregiver',
    on: { click: () => onCaregiverClick() },
  }, [lockNode, element('span', { text: 'Cuidador' })]);
  const header = element('header', { class: 'p-header', 'data-testid': 'p-header' }, [titleNode, caregiverButton]);

  // Banda sin conexión de 48 px (P-19): solo aparece sin internet.
  const offlineBanner = element('div', {
    class: 'p-offline',
    'data-testid': 'p-offline-banner',
    role: 'status',
    hidden: true,
  }, [icon('sin-conexion'), element('p', { text: 'Sin internet: se escuchan las canciones guardadas' })]);

  // Zona de la pantalla activa (app-main). Recibe el foco del enlace «Saltar al contenido».
  const content = element('main', {
    class: 'p-main',
    id: 'app-main',
    'data-testid': 'app-main',
    tabindex: '-1',
  });

  // Mini reproductor de 72 px (P-18): el título abre Escuchar y el botón reproduce o pausa.
  const miniText = element('span', { class: 'p-mini-texto' });
  const miniTitleButton = element('button', {
    type: 'button',
    class: 'p-mini-titulo',
    'data-testid': 'p-mini-titulo',
    on: { click: () => onNavigate('escuchar', miniTitleButton) },
  }, [miniText]);
  const miniToggle = element('button', {
    type: 'button',
    class: 'p-mini-boton',
    'data-testid': 'p-mini-toggle',
    on: { click: () => onMiniToggle() },
  });
  const mini = element('section', {
    class: 'p-mini',
    'data-testid': 'p-mini',
    'aria-label': 'Reproductor',
    hidden: true,
  }, [miniTitleButton, miniToggle]);

  // Navegación de cuatro destinos (P-2 y P-3). El destino activo lleva aria-current="page".
  const navButtons = NAV_DESTINATIONS.map((destination) => {
    const button = element('button', {
      type: 'button',
      class: 'p-nav-item',
      'data-testid': `p-nav-${destination.key}`,
      'data-key': destination.key,
      on: { click: () => onNavigate(destination.key, button) },
    }, [icon(destination.icon), element('span', { class: 'p-nav-texto', text: destination.label })]);
    return button;
  });
  const nav = element('nav', {
    class: 'p-nav',
    'data-testid': 'p-nav',
    'aria-label': 'Navegación del paciente',
  }, navButtons);

  const shell = element('div', { class: 'p-shell', 'data-modo': 'paciente' }, [
    header,
    offlineBanner,
    content,
    mini,
    nav,
  ]);
  appRoot.replaceChildren(shell);

  // Pedir al reproductor el estado y mostrar el mini reproductor, sin tocar el DOM si no cambia.
  function playerState() {
    const player = services.player;
    return player && typeof player.getState === 'function' ? player.getState() : null;
  }

  function refreshMini() {
    if (state.unmounted) return;
    const current = playerState();
    const track = current?.track ?? null;
    const visible = miniPlayerVisible({
      allowed: state.playerAllowed,
      hasTrack: Boolean(track),
      activeKey: state.activeKey,
    });
    mini.hidden = !visible;
    if (!track) return;
    if (state.miniTitle !== track.title) {
      state.miniTitle = track.title;
      miniText.textContent = track.title ?? '';
    }
    const playing = Boolean(current.playing);
    if (state.miniPlaying !== playing) {
      state.miniPlaying = playing;
      miniToggle.replaceChildren(icon(playing ? 'pausar' : 'reproducir'));
      miniToggle.setAttribute('aria-label', playing ? 'Pausar' : 'Reproducir');
    }
  }

  // Muestra el candado solo si hay PIN (P-1). Un fallo del almacén se trata como «sin PIN».
  async function refreshPin() {
    try {
      state.hasPin = Boolean(await services.store.hasPin());
    } catch (error) {
      console.error('Reminiscencia: no se pudo comprobar el PIN.', error);
      state.hasPin = false;
    }
    lockNode.hidden = !state.hasPin;
  }

  function refreshOffline() {
    offlineBanner.hidden = navigator.onLine !== false;
  }

  // Navegar: un toque repetido en 400 ms se ignora (DESIGN 7.1).
  function onNavigate(key, control) {
    if (!taps.accept(control)) return;
    Promise.resolve(services.navigate(key)).catch((error) => console.error('Reminiscencia: navegación.', error));
  }

  function onMiniToggle() {
    if (!taps.accept(miniToggle)) return;
    services.player?.toggle();
  }

  // El botón Cuidador abre la salida (P5). Solo si el usuario confirma se cambia de modo.
  // salida.js se carga al pulsar para no crear una dependencia circular con este módulo.
  async function onCaregiverClick() {
    if (!taps.accept(caregiverButton)) return;
    try {
      const { openExitDialog } = await import('./salida.js');
      const leave = await openExitDialog(services);
      if (leave && !state.unmounted) await services.leavePatientMode();
    } catch (error) {
      console.error('Reminiscencia: no se pudo volver al modo cuidador.', error);
    }
    refreshPin();
  }

  // Refrescos periódicos y por eventos: mini reproductor, banda sin conexión y candado al quitar el PIN.
  const timer = setInterval(refreshMini, MINI_REFRESH_MS);
  const onPinChanged = () => refreshPin();
  document.addEventListener(PIN_CHANGED_EVENT, onPinChanged);
  window.addEventListener('online', refreshOffline);
  window.addEventListener('offline', refreshOffline);

  refreshMini();
  refreshPin();
  refreshOffline();

  // Fija el H1 y mueve el foco a él: al cambiar de pantalla, el foco pasa al H1 (DESIGN 7.1).
  function setTitle(text) {
    const value = String(text ?? '');
    titleNode.textContent = value;
    document.title = value ? `${value} · Reminiscencia` : 'Reminiscencia';
    titleNode.focus();
  }

  // Marca el destino activo de la navegación y actualiza la visibilidad del mini reproductor.
  function setActive(key) {
    state.activeKey = key ?? null;
    for (const button of navButtons) {
      if (button.dataset.key === state.activeKey) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    }
    refreshMini();
    refreshPin();
  }

  // Permite ocultar el mini reproductor en las pantallas que lo necesiten.
  function showPlayer(show) {
    state.playerAllowed = Boolean(show);
    refreshMini();
  }

  function unmount() {
    if (state.unmounted) return;
    state.unmounted = true;
    clearInterval(timer);
    document.removeEventListener(PIN_CHANGED_EVENT, onPinChanged);
    window.removeEventListener('online', refreshOffline);
    window.removeEventListener('offline', refreshOffline);
    appRoot.replaceChildren();
  }

  return { content, setTitle, setActive, showPlayer, unmount };
}
