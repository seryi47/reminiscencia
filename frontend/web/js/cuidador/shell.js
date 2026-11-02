// Marco del modo cuidador (DESIGN 3.2, 6.2, 7.3 y 10; contrato 2.1, 5 y 6): cabecera, navegación,
// barra de reproducción y panel «Ahora suena». mountShell crea el marco dentro de appRoot y devuelve el
// hueco de contenido (main), donde las pantallas del cuidador se montan.
//
// Decisiones que el contrato deja abiertas:
// - El reproductor no tiene suscripción (contrato 2.2): el marco consulta services.player.getState() cada
//   250 ms y solo toca el DOM cuando cambia algo. El foco en la barra de progreso no se actualiza con el
//   tiempo, para que los lectores de pantalla no anuncien cada segundo.
// - Las hojas y diálogos comparten openDialog (aquí): foco atrapado, Escape y devolución del foco. Lo que
//   queda detrás se marca como inerte mientras el diálogo está abierto.
// - services gana setTitle, setActive, openPanel, closePanel y openSession. Los servicios startPreview y
//   endPreview cambian de modo, así que los implementa app.js; el marco solo los llama.
// - sesion.js se carga con import() dinámico para que el marco y la hoja de sesión no se importen en
//   círculo (la hoja usa openDialog de este fichero).
// - Las funciones puras se exportan para las pruebas: no tocan el DOM ni el reproductor.

import { SEEK_STEP_SECONDS, VOLUME_STEP_MAX } from '../player.js';
import { mountPanel } from './panel.js';

const NS_SVG = 'http://www.w3.org/2000/svg';
const WIDE_QUERY = '(min-width: 1440px)';
const POLL_MS = 250;
const ALIAS_MAX = 24;
const APP_NAME = 'Reminiscencia';

// Destinos fijos del cuidador (DESIGN 3.2). La clave coincide con la ruta de nivel superior.
export const NAV_DESTINATIONS = Object.freeze([
  Object.freeze({ key: 'inicio', route: 'inicio', label: 'Inicio', testid: 'c-nav-inicio', icon: 'home' }),
  Object.freeze({ key: 'biblioteca', route: 'biblioteca', label: 'Biblioteca', testid: 'c-nav-biblioteca', icon: 'library' }),
  Object.freeze({ key: 'perfiles', route: 'perfiles', label: 'Perfiles', testid: 'c-nav-perfiles', icon: 'profiles' }),
  Object.freeze({ key: 'ajustes', route: 'ajustes', label: 'Ajustes', testid: 'c-nav-ajustes', icon: 'settings' }),
]);

// Sección de navegación a la que pertenece cada ruta del cuidador (contrato 2.4).
const SECTION_BY_ROUTE = Object.freeze({
  inicio: 'inicio',
  biblioteca: 'biblioteca',
  perfiles: 'perfiles',
  perfil: 'perfiles',
  asistente: 'perfiles',
  lista: 'perfiles',
  recuerdo: 'perfiles',
  observaciones: 'perfiles',
  ajustes: 'ajustes',
});

// Iconos propios de trazo de 2 px en una cuadrícula de 24 (DESIGN 5.4). No son de ningún conjunto con licencia.
const ICON_PATHS = Object.freeze({
  home: Object.freeze(['M3 11 12 4l9 7', 'M5 10v10h14V10']),
  library: Object.freeze(['M9 18V6l10-2v12', 'M6 15a3 3 0 1 0 0 6 3 3 0 0 0 0-6', 'M16 13a3 3 0 1 0 0 6 3 3 0 0 0 0-6']),
  profiles: Object.freeze(['M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7', 'M3 20v-1a5 5 0 0 1 5-5h2a5 5 0 0 1 5 5v1', 'M16 4.5a3.5 3.5 0 0 1 0 6.8', 'M18 14.5a5 5 0 0 1 3 4.5v1']),
  settings: Object.freeze(['M4 7h9', 'M17 7h3', 'M4 17h3', 'M11 17h9', 'M15 5a2 2 0 1 0 0 4 2 2 0 0 0 0-4', 'M7 15a2 2 0 1 0 0 4 2 2 0 0 0 0-4']),
  play: Object.freeze(['M8 5l11 7-11 7z']),
  pause: Object.freeze(['M8 5v14', 'M16 5v14']),
  previous: Object.freeze(['M6 5v14', 'M18 5l-9 7 9 7z']),
  next: Object.freeze(['M18 5v14', 'M6 5l9 7-9 7z']),
  volume: Object.freeze(['M4 9h4l5-4v14l-5-4H4z', 'M16 9a4 4 0 0 1 0 6']),
  note: Object.freeze(['M9 18V6l10-2v12', 'M6 15a3 3 0 1 0 0 6 3 3 0 0 0 0-6', 'M16 13a3 3 0 1 0 0 6 3 3 0 0 0 0-6']),
  eye: Object.freeze(['M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z', 'M12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5']),
  close: Object.freeze(['M6 6l12 12', 'M18 6 6 18']),
  chevronDown: Object.freeze(['M6 9l6 6 6-6']),
  more: Object.freeze(['M5 12h.01', 'M12 12h.01', 'M19 12h.01']),
  folder: Object.freeze(['M3 6h6l2 2h10v10H3z']),
  check: Object.freeze(['M5 12l4 4 9-9']),
});

// Teclas de una tecla que el marco atiende con el foco dentro de la barra o del panel (DESIGN 7.4).
export const SHORTCUT_ACTIONS = Object.freeze({
  toggle: 'toggle',
  seekBack: 'seek-back',
  seekForward: 'seek-forward',
  volumeUp: 'volume-up',
  volumeDown: 'volume-down',
});

// Tipos de <input> que no son de texto: en ellos sí valen los atajos.
const NON_TEXT_INPUT_TYPES = Object.freeze(['range', 'checkbox', 'radio', 'button', 'submit', 'reset', 'color', 'file', 'image', 'hidden']);
const WIDGET_ROLES = Object.freeze(['button', 'radio', 'checkbox', 'switch', 'menuitem', 'menuitemradio', 'tab']);
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// ---------------------------------------------------------------------------
// Funciones puras
// ---------------------------------------------------------------------------

/** Alias truncado a `max` caracteres (contando caracteres, no unidades de código). Si se corta, termina en «…». */
export function truncateAlias(alias, max = ALIAS_MAX) {
  const chars = Array.from(String(alias ?? '').trim());
  if (chars.length <= max) return chars.join('');
  return `${chars.slice(0, max - 1).join('')}…`;
}

/** Inicial en mayúscula para avatares y portadas sin imagen. «?» si no hay texto. */
export function initialOf(text) {
  const first = Array.from(String(text ?? '').trim())[0];
  return first ? first.toLocaleUpperCase('es') : '?';
}

/** Tiempo en formato m:ss, o h:mm:ss a partir de una hora. Siempre enteros hacia abajo. */
export function formatClock(seconds) {
  const total = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = String(total % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${secs}` : `${minutes}:${secs}`;
}

function plural(count, one, many) {
  return `${count} ${count === 1 ? one : many}`;
}

/** Duración leída en español: «1 minuto 12 segundos». Sin partes cero salvo que todo sea cero. */
export function spokenTime(seconds) {
  const total = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const parts = [];
  if (hours) parts.push(plural(hours, 'hora', 'horas'));
  if (minutes) parts.push(plural(minutes, 'minuto', 'minutos'));
  if (secs || parts.length === 0) parts.push(plural(secs, 'segundo', 'segundos'));
  return parts.join(' ');
}

/** Texto de aria-valuetext de la barra de progreso (contrato 6, DESIGN 6.1 P-6). */
export function progressValueText(position, duration) {
  if (!(duration > 0)) return 'Sin canción';
  return `${spokenTime(position)} de ${spokenTime(duration)}`;
}

/** Fracción de 0 a 1 de la posición dentro de la pista. */
export function progressFraction(position, duration) {
  if (!(duration > 0)) return 0;
  const value = Number(position) / duration;
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** Segundos correspondientes a una posición relativa (0 a 1) dentro de la barra de progreso. */
export function ratioToSeconds(ratio, duration) {
  if (!(duration > 0)) return 0;
  const value = Number(ratio);
  const clamped = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
  return clamped * duration;
}

/** Texto del control de volumen: «Volumen 6 de 10» (DESIGN 6.1 P-8, en pasos del reproductor). */
export function volumeValueText(step, max = VOLUME_STEP_MAX) {
  const value = Number.isFinite(Number(step)) ? Math.round(Number(step)) : 0;
  return `Volumen ${value} de ${max}`;
}

/** Título y artista para la barra. Sin pista, el mensaje es «No suena nada» (DESIGN 2, principio 5). */
export function nowTitleModel(track) {
  if (!track) return { title: 'No suena nada', artist: '', initial: '?', hasTrack: false };
  const title = String(track.title ?? '').trim() || 'Sin título';
  return { title, artist: String(track.artist ?? '').trim(), initial: initialOf(title), hasTrack: true };
}

/** Ruta de nivel superior a la que pertenece una ruta del cuidador, o null si no es de la navegación. */
export function sectionOfRoute(route) {
  return Object.prototype.hasOwnProperty.call(SECTION_BY_ROUTE, route) ? SECTION_BY_ROUTE[route] : null;
}

/** Filas de carpetas de la barra lateral con el número de canciones de cada una (catálogo de solo lectura). */
export function folderRows(folders = [], songs = []) {
  const counts = new Map();
  for (const song of songs) {
    if (song && song.folder_id) counts.set(song.folder_id, (counts.get(song.folder_id) ?? 0) + 1);
  }
  return folders.map((folder) => ({
    id: folder.id,
    name: String(folder.name || folder.id),
    count: counts.get(folder.id) ?? 0,
  }));
}

/** Atributos de <html> que leen los tokens (tokens.css) a partir de las preferencias de pantalla. */
export function displayAttributes(values) {
  let movement = null;
  if (values.reduceMotion === 'si') movement = 'reducido';
  else if (values.reduceMotion === 'no') movement = 'normal';
  return {
    escala: String(values.textScale),
    contraste: values.contrast,
    tema: values.theme,
    movimiento: movement,
  };
}

/** Aplica las preferencias de pantalla al elemento raíz. Sin movimiento explícito, se quita el atributo. */
export function applyDisplayAttributes(values, element = document.documentElement) {
  const attrs = displayAttributes(values);
  element.dataset.escala = attrs.escala;
  element.dataset.contraste = attrs.contraste;
  element.dataset.tema = attrs.tema;
  if (attrs.movimiento) element.dataset.movimiento = attrs.movimiento;
  else delete element.dataset.movimiento;
}

/** Clase de control según su papel, para decidir qué teclas son atajos. */
function controlKind(info) {
  const tag = String(info.tagName ?? '').toUpperCase();
  const role = String(info.role ?? '');
  if (role === 'slider') return 'slider';
  if (tag === 'INPUT' && String(info.type ?? '').toLowerCase() === 'range') return 'range';
  if (tag === 'BUTTON' || (tag === 'A' && info.href) || WIDGET_ROLES.includes(role)) return 'button';
  return 'other';
}

/** true si el foco está en un campo de texto: nunca se aplican atajos ahí. */
export function isTypingTarget(info) {
  if (info.isContentEditable) return true;
  const tag = String(info.tagName ?? '').toUpperCase();
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') return !NON_TEXT_INPUT_TYPES.includes(String(info.type || 'text').toLowerCase());
  return false;
}

/**
 * Acción de un atajo de una tecla (DESIGN 7.4), o null. Solo actúa si `enabled` (prefs «shortcuts» = «activados»),
 * sin modificadores, fuera de campos de texto y fuera de controles nativos (botones, casillas, opciones).
 * La barra de progreso gestiona ← y → por sí misma; ↑ y ↓ suben y bajan el volumen. El control de volumen
 * usa sus flechas nativas.
 */
export function shortcutAction(event, info = {}, enabled = true) {
  if (!enabled || event.altKey || event.ctrlKey || event.metaKey) return null;
  if (isTypingTarget(info)) return null;
  const kind = controlKind(info);
  if (kind === 'button') return null;
  switch (event.key) {
    case ' ':
    case 'Spacebar':
      return SHORTCUT_ACTIONS.toggle;
    case 'ArrowLeft':
      return kind === 'other' ? SHORTCUT_ACTIONS.seekBack : null;
    case 'ArrowRight':
      return kind === 'other' ? SHORTCUT_ACTIONS.seekForward : null;
    case 'ArrowUp':
      return kind === 'range' ? null : SHORTCUT_ACTIONS.volumeUp;
    case 'ArrowDown':
      return kind === 'range' ? null : SHORTCUT_ACTIONS.volumeDown;
    default:
      return null;
  }
}

/** Datos de un elemento que shortcutAction necesita, sin pasar el nodo. */
function targetInfo(node) {
  if (!node || !node.tagName) return {};
  return {
    tagName: node.tagName,
    type: node.type ?? '',
    role: node.getAttribute('role') ?? '',
    isContentEditable: Boolean(node.isContentEditable),
    href: node.getAttribute('href') ?? null,
  };
}

// ---------------------------------------------------------------------------
// Utilidades de DOM (solo en navegador)
// ---------------------------------------------------------------------------

function el(tag, className = '', text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Icono SVG propio (trazo de 2 px, color actual). Los datos son plantillas fijas, nunca datos de usuario. */
export function createIcon(name, className = 'c-icon') {
  const svg = document.createElementNS(NS_SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('class', className);
  for (const d of ICON_PATHS[name] ?? []) {
    const path = document.createElementNS(NS_SVG, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

/** Elementos enfocables visibles dentro de un contenedor, en orden de tabulación. */
export function focusableIn(container) {
  return Array.from(container.querySelectorAll(FOCUSABLE))
    .filter((node) => node.getClientRects().length > 0 && node.getAttribute('aria-disabled') !== 'true');
}

// Mantiene Tab y Mayús+Tab dentro del diálogo (DESIGN 7.3).
function trapTab(event, container) {
  const items = focusableIn(container);
  if (items.length === 0) {
    event.preventDefault();
    return;
  }
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;
  const outside = !container.contains(active);
  if (event.shiftKey && (active === first || outside)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (active === last || outside)) {
    event.preventDefault();
    first.focus();
  }
}

let dialogSeq = 0;

/**
 * Hoja o diálogo accesible (DESIGN C-16). render(body, close, dialog) rellena el cuerpo; close(valor) lo cierra
 * y resuelve la promesa con ese valor. Escape cierra con cancelValue y devuelve el foco al disparador.
 * initialFocus(dialog) elige el primer elemento a enfocar; por defecto, el primer control enfocable.
 */
export function openDialog({ title, className = '', render, cancelValue = null, initialFocus = null }) {
  const opener = document.activeElement;
  const layer = el('div', 'c-dialog-layer');
  const dialog = el('div', `c-dialog${className ? ` ${className}` : ''}`);
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  const heading = el('h2', 'c-dialog-title', title);
  dialogSeq += 1;
  heading.id = `c-dialog-title-${dialogSeq}`;
  heading.tabIndex = -1;
  dialog.setAttribute('aria-labelledby', heading.id);
  const body = el('div', 'c-dialog-body');
  dialog.append(heading, body);
  layer.append(dialog);

  // Lo que hay detrás queda inerte mientras el diálogo está abierto (solo lo que este diálogo marca).
  const inerted = [];
  for (const child of Array.from(document.body.children)) {
    if (child !== layer && !child.inert) {
      child.inert = true;
      inerted.push(child);
    }
  }
  document.body.append(layer);

  return new Promise((resolve) => {
    let settled = false;
    const onKeydown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close(cancelValue);
      } else if (event.key === 'Tab') {
        trapTab(event, dialog);
      }
    };
    const close = (value) => {
      if (settled) return;
      settled = true;
      dialog.removeEventListener('keydown', onKeydown);
      layer.remove();
      for (const child of inerted) child.inert = false;
      if (opener && opener.isConnected && typeof opener.focus === 'function') opener.focus();
      resolve(value);
    };
    dialog.addEventListener('keydown', onKeydown);
    try {
      render(body, close, dialog);
    } catch (error) {
      console.error('Reminiscencia: no se pudo abrir el diálogo.', error);
      close(cancelValue);
      return;
    }
    const target = (initialFocus && initialFocus(dialog)) || focusableIn(dialog)[0] || heading;
    target.focus();
  });
}

// ---------------------------------------------------------------------------
// Marco
// ---------------------------------------------------------------------------

/**
 * Crea el marco del cuidador dentro de appRoot. Devuelve la superficie que usa app.js y las pantallas:
 * { content, headerSlot, setTitle, setActive, showPreviewButton, showPlayer, showPanel, unmount }.
 */
export function mountShell(appRoot, services) {
  const wide = window.matchMedia(WIDE_QUERY);
  let unmounted = false;
  let timer = null;
  let activeKey = null;
  let activeProfileId = null;
  let profiles = [];
  let lastTrackKey;
  let shownPlaying = null;

  // ---- Estructura ----
  const frame = el('div', 'c-shell');

  const header = el('header', 'c-header');
  header.dataset.testid = 'c-header';
  const titleEl = el('h1', 'c-title');
  titleEl.id = 'c-title';
  titleEl.tabIndex = -1;
  const headerSlot = el('div', 'c-header-slot');
  const tools = el('div', 'c-header-tools');

  // Selector del perfil activo (chip de 36 px, DESIGN C-1).
  const profileWrap = el('div', 'c-profile-wrap');
  const profileBtn = el('button', 'c-profile');
  profileBtn.type = 'button';
  profileBtn.dataset.testid = 'c-profile';
  profileBtn.setAttribute('aria-haspopup', 'menu');
  profileBtn.setAttribute('aria-expanded', 'false');
  profileBtn.setAttribute('aria-controls', 'c-profile-menu');
  const avatar = el('span', 'c-avatar', '?');
  const profileAlias = el('span', 'c-profile-alias', 'Sin perfil');
  profileBtn.append(avatar, profileAlias, createIcon('chevronDown', 'c-icon c-chevron'));
  const profileMenu = el('div', 'c-profile-menu');
  profileMenu.id = 'c-profile-menu';
  profileMenu.setAttribute('role', 'menu');
  profileMenu.setAttribute('aria-label', 'Perfiles');
  profileMenu.hidden = true;
  profileWrap.append(profileBtn, profileMenu);

  // «Vista previa». En teléfono va dentro de un desplegable de la cabecera (DESIGN 3.2).
  const moreToggle = el('button', 'c-icon-btn c-more-toggle');
  moreToggle.type = 'button';
  moreToggle.setAttribute('aria-label', 'Más opciones');
  moreToggle.setAttribute('aria-expanded', 'false');
  moreToggle.setAttribute('aria-controls', 'c-tools-more');
  moreToggle.append(createIcon('more'));
  const toolsMore = el('div', 'c-tools-more');
  toolsMore.id = 'c-tools-more';
  const previewBtn = el('button', 'c-btn c-btn--secondary c-preview');
  previewBtn.type = 'button';
  previewBtn.dataset.testid = 'c-preview';
  previewBtn.append(createIcon('eye'), el('span', '', 'Vista previa'));
  toolsMore.append(previewBtn);
  tools.append(profileWrap, moreToggle, toolsMore);
  header.append(titleEl, headerSlot, tools);

  // Navegación: barra lateral (escritorio), raíl (tableta) o barra inferior (teléfono). Mismo marcado.
  const nav = el('nav', 'c-sidebar');
  nav.dataset.testid = 'c-sidebar';
  nav.setAttribute('aria-label', 'Principal');
  nav.append(el('p', 'c-brand', APP_NAME));
  const navList = el('ul', 'c-nav-list');
  const navItems = [];
  for (const dest of NAV_DESTINATIONS) {
    const item = el('li', 'c-nav-li');
    const button = el('button', 'c-nav-item');
    button.type = 'button';
    button.dataset.testid = dest.testid;
    button.dataset.key = dest.key;
    button.append(createIcon(dest.icon), el('span', 'c-nav-label', dest.label));
    item.append(button);
    navList.append(item);
    navItems.push({ key: dest.key, route: dest.route, button });
  }
  nav.append(navList);

  // Carpetas (solo en la barra lateral de escritorio). Filas de 28 px con recuento.
  const folders = el('div', 'c-folders');
  const foldersToggle = el('button', 'c-folders-toggle');
  foldersToggle.type = 'button';
  foldersToggle.setAttribute('aria-expanded', 'true');
  foldersToggle.setAttribute('aria-controls', 'c-folder-list');
  foldersToggle.append(el('span', '', 'Carpetas'), createIcon('chevronDown', 'c-icon c-chevron'));
  const folderList = el('ul', 'c-folder-list');
  folderList.id = 'c-folder-list';
  folders.append(foldersToggle, folderList);
  nav.append(folders);

  const openPatient = el('button', 'c-btn c-btn--primary c-open-patient');
  openPatient.type = 'button';
  openPatient.dataset.testid = 'c-open-patient';
  openPatient.textContent = 'Abrir modo paciente';
  nav.append(openPatient);

  // Contenido: las pantallas se montan aquí.
  const content = el('main', 'c-main');
  content.id = 'app-main';
  content.dataset.testid = 'app-main';
  content.tabIndex = -1;

  // Panel «Ahora suena» (C-20): persistente desde 1440 px; superpuesto entre 600 y 1439 px.
  const panelSlot = el('aside', 'c-panel-slot');
  panelSlot.setAttribute('aria-label', 'Ahora suena');
  const panelClose = el('button', 'c-icon-btn c-panel-close');
  panelClose.type = 'button';
  panelClose.setAttribute('aria-label', 'Cerrar panel');
  panelClose.append(createIcon('close'));
  const panelHost = el('div', 'c-panel-host');
  panelSlot.append(panelClose, panelHost);

  // Barra de reproducción (C-3): 72 px desde 600 px; mini de 64 px encima de la barra inferior en teléfono.
  const now = el('section', 'c-now');
  now.dataset.testid = 'c-now';
  now.setAttribute('aria-label', 'Reproductor');
  const nowTrack = el('div', 'c-now-track');
  const cover = el('span', 'c-now-cover', '?');
  cover.setAttribute('aria-hidden', 'true');
  const nowInfo = el('div', 'c-now-info');
  const nowTitle = el('p', 'c-now-title', 'No suena nada');
  const nowArtist = el('p', 'c-now-artist');
  const nowNotice = el('p', 'c-now-notice');
  nowNotice.setAttribute('role', 'status');
  nowNotice.hidden = true;
  const nowSleep = el('span', 'c-now-sleep');
  nowSleep.hidden = true;
  nowInfo.append(nowTitle, nowArtist, nowNotice, nowSleep);
  nowTrack.append(cover, nowInfo);

  const transport = el('div', 'c-now-transport');
  const prevBtn = el('button', 'c-icon-btn c-now-prev');
  prevBtn.type = 'button';
  prevBtn.dataset.testid = 'c-now-prev';
  prevBtn.setAttribute('aria-label', 'Anterior');
  prevBtn.append(createIcon('previous'));
  const toggleBtn = el('button', 'c-icon-btn c-now-toggle c-now-toggle--main');
  toggleBtn.type = 'button';
  toggleBtn.dataset.testid = 'c-now-toggle';
  toggleBtn.setAttribute('aria-label', 'Reproducir');
  const nextBtn = el('button', 'c-icon-btn c-now-next');
  nextBtn.type = 'button';
  nextBtn.dataset.testid = 'c-now-next';
  nextBtn.setAttribute('aria-label', 'Siguiente');
  nextBtn.append(createIcon('next'));
  transport.append(prevBtn, toggleBtn, nextBtn);

  const progressWrap = el('div', 'c-now-progress-wrap');
  const timeNow = el('span', 'c-now-time', '0:00');
  const timeTotal = el('span', 'c-now-time c-now-time--total', '0:00');
  const progress = el('div', 'c-now-progress');
  progress.dataset.testid = 'c-now-progress';
  progress.setAttribute('role', 'slider');
  progress.setAttribute('aria-label', 'Progreso de la canción');
  progress.setAttribute('aria-valuemin', '0');
  progress.setAttribute('aria-valuenow', '0');
  progress.setAttribute('aria-valuetext', 'Sin canción');
  progress.setAttribute('aria-disabled', 'true');
  progress.tabIndex = -1;
  const trackLine = el('div', 'c-now-track-line');
  const fill = el('div', 'c-now-fill');
  const thumb = el('div', 'c-now-thumb');
  trackLine.append(fill, thumb);
  progress.append(trackLine);
  progressWrap.append(timeNow, progress, timeTotal);

  const volumeWrap = el('div', 'c-now-volume-wrap');
  const volumeLabel = el('label', 'c-now-volume-label', 'Volumen');
  const volume = el('input', 'c-now-volume');
  volume.type = 'range';
  volume.dataset.testid = 'c-now-volume';
  volume.min = '0';
  volume.max = String(VOLUME_STEP_MAX);
  volume.step = '1';
  volume.value = '0';
  volume.id = 'c-now-volume';
  volumeLabel.htmlFor = 'c-now-volume';
  volumeWrap.append(volumeLabel, volume);

  const nowOpen = el('button', 'c-btn c-btn--secondary c-now-open');
  nowOpen.type = 'button';
  nowOpen.setAttribute('aria-label', 'Ahora suena');
  nowOpen.append(createIcon('note'), el('span', 'c-now-open-label', 'Ahora suena'));

  now.append(nowTrack, transport, progressWrap, volumeWrap, nowOpen);

  frame.append(header, nav, content, panelSlot, now);
  appRoot.append(frame);

  // ---- Cabecera: título, perfil y vista previa ----
  function setTitle(text) {
    if (unmounted) return;
    const value = String(text ?? '');
    titleEl.textContent = value;
    document.title = value ? `${value} · ${APP_NAME}` : APP_NAME;
  }

  function setActive(key) {
    if (unmounted) return;
    activeKey = key ?? null;
    for (const item of navItems) {
      if (item.key === activeKey) item.button.setAttribute('aria-current', 'page');
      else item.button.removeAttribute('aria-current');
    }
  }

  function showPreviewButton(show) {
    if (unmounted) return;
    previewBtn.closest('.c-tools-more').hidden = !show;
    moreToggle.hidden = !show;
  }

  function announce(text) {
    if (typeof services.announce === 'function') services.announce(text);
  }

  async function refreshProfiles() {
    try {
      profiles = await services.store.listProfiles();
      activeProfileId = await services.store.getActiveProfileId();
    } catch (error) {
      console.error('Reminiscencia: no se pudieron leer los perfiles.', error);
      profiles = [];
      activeProfileId = null;
    }
    if (activeProfileId && !profiles.some((profile) => profile.id === activeProfileId)) activeProfileId = null;
    const active = profiles.find((profile) => profile.id === activeProfileId) ?? null;
    profileAlias.textContent = active ? truncateAlias(active.alias) : 'Sin perfil';
    avatar.textContent = active ? initialOf(active.alias) : '?';
    profileBtn.setAttribute('aria-label', active ? `Perfil activo: ${active.alias}` : 'Sin perfil activo');
    previewBtn.disabled = !active;
    return active;
  }

  function closeProfileMenu({ restoreFocus = false } = {}) {
    if (profileMenu.hidden) return;
    profileMenu.hidden = true;
    profileBtn.setAttribute('aria-expanded', 'false');
    if (restoreFocus) profileBtn.focus();
  }

  function itemButton(label, role, checked) {
    const button = el('button', 'c-menu-item', label);
    button.type = 'button';
    button.setAttribute('role', role);
    if (checked !== undefined) button.setAttribute('aria-checked', String(checked));
    return button;
  }

  function renderProfileMenu() {
    profileMenu.replaceChildren();
    if (profiles.length === 0) {
      const empty = el('p', 'c-menu-empty', 'Todavía no hay perfiles.');
      profileMenu.append(empty);
    }
    for (const profile of profiles) {
      const button = itemButton(profile.alias, 'menuitemradio', profile.id === activeProfileId);
      button.dataset.profileId = profile.id;
      button.addEventListener('click', () => selectProfile(profile.id));
      profileMenu.append(button);
    }
    profileMenu.append(el('div', 'c-menu-sep'));
    const manage = itemButton(profiles.length ? 'Gestionar perfiles' : 'Crear un perfil', 'menuitem');
    manage.addEventListener('click', () => {
      closeProfileMenu();
      services.navigate('perfiles');
    });
    profileMenu.append(manage);
  }

  async function openProfileMenu() {
    await refreshProfiles();
    renderProfileMenu();
    profileMenu.hidden = false;
    profileBtn.setAttribute('aria-expanded', 'true');
    const current = profileMenu.querySelector('[aria-checked="true"]') ?? profileMenu.querySelector('[role="menuitemradio"], [role="menuitem"]');
    current?.focus();
  }

  async function selectProfile(profileId) {
    try {
      await services.store.setActiveProfileId(profileId);
    } catch (error) {
      announce(error instanceof Error ? error.message : 'No se pudo cambiar de perfil.');
      return;
    }
    closeProfileMenu({ restoreFocus: true });
    const active = await refreshProfiles();
    if (active) announce(`Perfil activo: ${active.alias}`);
    // Las pantallas de nivel superior dependen del perfil activo: se vuelven a montar.
    if (activeKey) services.navigate(activeKey);
  }

  // Teclado del menú de perfiles: flechas, Inicio y Fin; Escape cierra y devuelve el foco.
  profileMenu.addEventListener('keydown', (event) => {
    const items = Array.from(profileMenu.querySelectorAll('[role="menuitemradio"], [role="menuitem"]'));
    const index = items.indexOf(document.activeElement);
    let target = null;
    if (event.key === 'ArrowDown') target = items[(index + 1) % items.length];
    else if (event.key === 'ArrowUp') target = items[(index - 1 + items.length) % items.length];
    else if (event.key === 'Home') target = items[0];
    else if (event.key === 'End') target = items[items.length - 1];
    else if (event.key === 'Escape') {
      event.preventDefault();
      closeProfileMenu({ restoreFocus: true });
      return;
    } else if (event.key === 'Tab') {
      closeProfileMenu();
      return;
    }
    if (target) {
      event.preventDefault();
      target.focus();
    }
  });

  profileBtn.addEventListener('click', () => {
    if (profileMenu.hidden) openProfileMenu();
    else closeProfileMenu({ restoreFocus: true });
  });

  moreToggle.addEventListener('click', () => {
    const open = !toolsMore.classList.contains('is-open');
    toolsMore.classList.toggle('is-open', open);
    moreToggle.setAttribute('aria-expanded', String(open));
    if (open) previewBtn.focus();
  });

  previewBtn.addEventListener('click', async () => {
    const active = await refreshProfiles();
    if (!active) {
      announce('Crea o elige un perfil para ver la vista previa.');
      return;
    }
    toolsMore.classList.remove('is-open');
    moreToggle.setAttribute('aria-expanded', 'false');
    services.startPreview?.(active.id);
  });

  // Cierra los desplegables de la cabecera al pulsar fuera de ellos.
  const onPointerDown = (event) => {
    if (!profileWrap.contains(event.target)) closeProfileMenu();
    if (!tools.contains(event.target) || (!toolsMore.contains(event.target) && event.target !== moreToggle)) {
      toolsMore.classList.remove('is-open');
      moreToggle.setAttribute('aria-expanded', 'false');
    }
  };
  document.addEventListener('pointerdown', onPointerDown);

  // ---- Navegación ----
  for (const item of navItems) {
    item.button.addEventListener('click', () => services.navigate(item.route));
  }
  for (const row of folderRows(services.catalog?.folders ?? [], services.catalog?.songs ?? [])) {
    const li = el('li', 'c-folder-li');
    const button = el('button', 'c-folder-item');
    button.type = 'button';
    button.append(createIcon('folder'), el('span', 'c-folder-name', row.name), el('span', 'c-folder-count', String(row.count)));
    button.addEventListener('click', () => services.navigate('biblioteca', { folderId: row.id }));
    li.append(button);
    folderList.append(li);
  }
  if (folderList.children.length === 0) folderList.append(el('li', 'c-folder-empty', 'Sin carpetas'));
  foldersToggle.addEventListener('click', () => {
    const open = foldersToggle.getAttribute('aria-expanded') !== 'true';
    foldersToggle.setAttribute('aria-expanded', String(open));
    folderList.hidden = !open;
  });
  openPatient.addEventListener('click', () => openSession({}));

  // Cada navegación actualiza la sección activa y, al terminar, lleva el foco al título de la nueva pantalla.
  const originalNavigate = services.navigate;
  const navigateWithFocus = (route, params) => {
    const section = sectionOfRoute(route);
    if (section) setActive(section);
    const result = originalNavigate(route, params);
    // El perfil activo pudo cambiar en la pantalla anterior (por ejemplo, al crear uno): el chip se actualiza.
    refreshProfiles();
    queueMicrotask(() => {
      if (!unmounted) titleEl.focus();
    });
    return result;
  };
  services.navigate = navigateWithFocus;

  // ---- Panel «Ahora suena» ----
  let panelApi = null;
  let panelOpen = false;
  let panelFollow = false;
  let panelSongId = null;
  let panelOpener = null;

  function currentTrackId() {
    const track = services.player.getState().track;
    return track ? track.id : null;
  }

  function openPanelFor(songId, { focus = false } = {}) {
    if (unmounted) return;
    const follow = songId === undefined || songId === null;
    const wasOpen = panelOpen;
    if (!wasOpen) panelOpener = document.activeElement;
    panelOpen = true;
    panelFollow = follow;
    const target = follow ? currentTrackId() : songId;
    if (!panelApi) {
      panelApi = mountPanel(panelHost, services, target);
    } else if (panelSongId !== target) {
      panelApi.setSong(target);
    }
    panelSongId = target;
    frame.classList.add('is-panel-open');
    if (focus || (!wasOpen && !wide.matches)) panelApi.focusHeading();
  }

  function closePanel({ restoreFocus = true } = {}) {
    if (unmounted || !panelOpen) return;
    const hadFocus = panelSlot.contains(document.activeElement);
    panelApi?.unmount();
    panelApi = null;
    panelOpen = false;
    panelFollow = false;
    panelSongId = null;
    frame.classList.remove('is-panel-open');
    if (hadFocus && restoreFocus) {
      const target = panelOpener?.isConnected ? panelOpener : nowOpen;
      target.focus();
    }
    panelOpener = null;
  }

  panelClose.addEventListener('click', () => closePanel());
  // Escape cierra el panel superpuesto (entre 600 y 1439 px); el panel persistente no se cierra con Escape.
  panelSlot.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !wide.matches && panelOpen) {
      event.preventDefault();
      closePanel();
    }
  });
  const onWideChange = (event) => {
    if (event.matches && !panelOpen) openPanelFor(null);
  };
  wide.addEventListener('change', onWideChange);

  // ---- Reproductor ----
  function syncPlayer({ force = false } = {}) {
    if (unmounted) return;
    const state = services.player.getState();
    const track = state.track;
    const model = nowTitleModel(track);
    const key = track ? String(track.id) : null;

    if (key !== lastTrackKey) {
      const first = lastTrackKey === undefined;
      lastTrackKey = key;
      if (!first && key) announce(`Suena ${model.title}${model.artist ? `, ${model.artist}` : ''}`);
      // Si el panel muestra esta misma canción por selección, se vuelve a pintar para que diga «Ahora suena».
      if (!first && panelOpen && !panelFollow && key !== null && String(panelSongId) === key) panelApi.refresh();
    }

    nowTitle.textContent = model.title;
    nowArtist.textContent = model.artist;
    nowArtist.hidden = !model.artist;
    cover.textContent = model.initial;
    now.classList.toggle('is-idle', !track);

    prevBtn.disabled = !track;
    nextBtn.disabled = !track;
    toggleBtn.disabled = !track;
    volume.disabled = !track;
    if (shownPlaying !== state.playing || force) {
      shownPlaying = state.playing;
      toggleBtn.replaceChildren(createIcon(state.playing ? 'pause' : 'play'));
      toggleBtn.setAttribute('aria-label', state.playing ? 'Pausar' : 'Reproducir');
    }

    const duration = track ? state.duration : 0;
    const position = track ? state.position : 0;
    const fraction = progressFraction(position, duration);
    fill.style.width = `${fraction * 100}%`;
    thumb.style.left = `${fraction * 100}%`;
    timeNow.textContent = formatClock(position);
    timeTotal.textContent = formatClock(duration);
    progress.tabIndex = track ? 0 : -1;
    progress.setAttribute('aria-disabled', track ? 'false' : 'true');
    // Con el foco en la barra, los valores ARIA no cambian cada segundo: se actualizan al salir o al actuar.
    if (force || document.activeElement !== progress) {
      progress.setAttribute('aria-valuemax', String(Math.round(duration)));
      progress.setAttribute('aria-valuenow', String(Math.round(position)));
      progress.setAttribute('aria-valuetext', progressValueText(position, duration));
    }

    volume.max = String(state.volumeLimitStep);
    if (force || document.activeElement !== volume) volume.value = String(state.volumeStep);
    volume.setAttribute('aria-valuetext', volumeValueText(state.volumeStep));

    nowNotice.textContent = state.notice ?? '';
    nowNotice.hidden = !state.notice;
    const sleepLeft = state.sleepMinutesLeft;
    nowSleep.textContent = sleepLeft > 0 ? `Se para en ${sleepLeft} min` : '';
    nowSleep.hidden = !(sleepLeft > 0);

    if (panelOpen && panelFollow) {
      const id = track ? track.id : null;
      if (id !== panelSongId) {
        panelApi.setSong(id);
        panelSongId = id;
      }
    }
  }

  function shortcutsEnabled() {
    try {
      return services.prefs?.get('shortcuts') === 'activados';
    } catch {
      return false;
    }
  }

  // Atajos de una tecla (DESIGN 7.4): solo con el foco dentro de la barra o del panel, y si están activados.
  function onShortcut(event) {
    if (event.defaultPrevented) return;
    const action = shortcutAction(event, targetInfo(event.target), shortcutsEnabled());
    if (!action) return;
    const state = services.player.getState();
    event.preventDefault();
    if (action === SHORTCUT_ACTIONS.toggle) services.player.toggle();
    else if (action === SHORTCUT_ACTIONS.seekBack) services.player.seekBy(-SEEK_STEP_SECONDS);
    else if (action === SHORTCUT_ACTIONS.seekForward) services.player.seekBy(SEEK_STEP_SECONDS);
    else if (action === SHORTCUT_ACTIONS.volumeUp) services.player.setVolumeStep(state.volumeStep + 1);
    else if (action === SHORTCUT_ACTIONS.volumeDown) services.player.setVolumeStep(state.volumeStep - 1);
    syncPlayer({ force: true });
  }
  now.addEventListener('keydown', onShortcut);
  panelSlot.addEventListener('keydown', onShortcut);

  prevBtn.addEventListener('click', () => {
    services.player.previous();
    syncPlayer({ force: true });
  });
  nextBtn.addEventListener('click', () => {
    services.player.next();
    syncPlayer({ force: true });
  });
  toggleBtn.addEventListener('click', () => {
    services.player.toggle();
    syncPlayer({ force: true });
  });
  volume.addEventListener('input', () => {
    services.player.setVolumeStep(Number(volume.value));
    syncPlayer({ force: true });
  });
  nowOpen.addEventListener('click', () => openPanelFor(null, { focus: true }));

  // Progreso: puntero (toque o arrastre) y teclado (← y → saltan 5 s; Inicio y Fin).
  const seekToPointer = (clientX) => {
    const state = services.player.getState();
    if (!state.track || !(state.duration > 0)) return;
    const rect = progress.getBoundingClientRect();
    const ratio = rect.width > 0 ? (clientX - rect.left) / rect.width : 0;
    services.player.seekTo(ratioToSeconds(ratio, state.duration));
    syncPlayer({ force: true });
  };
  let dragging = false;
  progress.addEventListener('pointerdown', (event) => {
    if (progress.getAttribute('aria-disabled') === 'true') return;
    dragging = true;
    progress.setPointerCapture?.(event.pointerId);
    progress.focus();
    seekToPointer(event.clientX);
    event.preventDefault();
  });
  progress.addEventListener('pointermove', (event) => {
    if (dragging) seekToPointer(event.clientX);
  });
  const endDrag = (event) => {
    if (!dragging) return;
    dragging = false;
    progress.releasePointerCapture?.(event.pointerId);
    syncPlayer({ force: true });
  };
  progress.addEventListener('pointerup', endDrag);
  progress.addEventListener('pointercancel', endDrag);
  progress.addEventListener('keydown', (event) => {
    const state = services.player.getState();
    if (!state.track) return;
    let handled = true;
    if (event.key === 'ArrowLeft') services.player.seekBy(-SEEK_STEP_SECONDS);
    else if (event.key === 'ArrowRight') services.player.seekBy(SEEK_STEP_SECONDS);
    else if (event.key === 'Home') services.player.seekTo(0);
    else if (event.key === 'End') services.player.seekTo(state.duration);
    else handled = false;
    if (handled) {
      event.preventDefault();
      syncPlayer({ force: true });
    }
  });
  progress.addEventListener('blur', () => syncPlayer({ force: true }));
  volume.addEventListener('blur', () => syncPlayer({ force: true }));

  // ---- Servicios que añade el marco ----
  const guard = (fn) => (...args) => (unmounted ? undefined : fn(...args));
  services.setTitle = guard(setTitle);
  services.setActive = guard(setActive);
  services.openPanel = guard((songId) => openPanelFor(songId));
  services.closePanel = guard(() => closePanel());
  services.openSession = guard((options) => openSession(options));

  function openSession(options = {}) {
    // Carga perezosa: sesion.js usa openDialog de este fichero.
    return import('./sesion.js').then((module) => module.openSessionSheet(services, options));
  }

  // ---- Arranque ----
  showPreviewButton(true);
  refreshProfiles();
  setActive(null);
  syncPlayer({ force: true });
  if (wide.matches) openPanelFor(null);
  timer = setInterval(() => syncPlayer(), POLL_MS);

  return {
    content,
    headerSlot,
    setTitle,
    setActive,
    showPreviewButton(show) {
      showPreviewButton(show);
    },
    showPlayer(show) {
      if (unmounted) return;
      now.hidden = !show;
    },
    showPanel(show) {
      if (unmounted) return;
      if (show) {
        if (!panelOpen) openPanelFor(null);
      } else {
        closePanel();
      }
    },
    unmount() {
      if (unmounted) return;
      unmounted = true;
      clearInterval(timer);
      wide.removeEventListener('change', onWideChange);
      document.removeEventListener('pointerdown', onPointerDown);
      panelApi?.unmount();
      panelApi = null;
      services.navigate = originalNavigate;
      frame.remove();
    },
  };
}
