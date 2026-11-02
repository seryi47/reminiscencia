// Biblioteca del cuidador (DESIGN 3.2, C2, C-4, C-5, C-6, C-7, C-8, C-17 y C-18; contrato 2.1, 2.4 y 5).
// Tabla de canciones del catálogo público, de solo lectura, con búsqueda, filtros, orden y selección múltiple.
// Las valoraciones (familiaridad, preferencia y presentación) se guardan por perfil en el almacén local
// (store.setSongLink). El marco pone el título, la navegación y el foco del H1; esta pantalla no pinta otro H1.
//
// Las funciones puras van exportadas para las pruebas (tests/web-unit/cuidador-biblioteca.test.mjs). El DOM
// solo se monta en mountLibrary. Los textos de canciones y de personas entran siempre con textContent.

import { audioCacheName, planOfflineDownload } from '../offline-core.js';
import { openIncidentSheet } from './incidencias.js';

const NS_SVG = 'http://www.w3.org/2000/svg';
const TITLE = 'Biblioteca';
// Tiempo que un aviso de deshacer permanece visible (DESIGN D25).
export const UNDO_MS = 10000;
// Consulta del estado del reproductor. El reproductor no tiene suscripción (contrato 2.2).
const POLL_MS = 500;
// Límite de canciones por lista (LIMITS.playlistSongs en schema.js).
const PLAYLIST_LIMIT = 500;

// Filtros de C-8. «Sin conexión» son las canciones sin copia guardada para escuchar sin internet.
export const FILTERS = Object.freeze([
  Object.freeze({ key: 'todas', label: 'Todas' }),
  Object.freeze({ key: 'sin-familiaridad', label: 'Sin familiaridad' }),
  Object.freeze({ key: 'con-recuerdo', label: 'Con recuerdo' }),
  Object.freeze({ key: 'sin-conexion', label: 'Sin conexión' }),
]);

// Presentaciones del estudio (DESIGN 8.3). En la tabla se usa la etiqueta corta; en el menú, la larga.
export const PRESENTATIONS = Object.freeze([
  Object.freeze({ code: 'C0', short: 'Solo canción', long: 'Solo canción' }),
  Object.freeze({ code: 'C1', short: 'Recuerdo', long: 'Canción y recuerdo' }),
  Object.freeze({ code: 'C2', short: 'Foto y recuerdo', long: 'Canción, foto y recuerdo' }),
]);

// Preferencias de tres niveles (DESIGN D9).
export const PREFERENCES = Object.freeze([
  Object.freeze({ value: -1, label: 'No le gusta' }),
  Object.freeze({ value: 0, label: 'Le da igual' }),
  Object.freeze({ value: 1, label: 'Le gusta' }),
]);

// Anclas de la familiaridad de 1 a 5 (DESIGN C-5).
export const FAMILIARITY_LEGEND = Object.freeze([
  'No la reconoce', 'Le suena poco', 'Le suena algo', 'La reconoce', 'La reconoce bien',
]);

export const SORT_KEYS = Object.freeze(['title', 'duration', 'familiarity', 'preference', 'presentation']);

const SORT_LABELS = Object.freeze({
  title: 'Título y artista',
  duration: 'Duración',
  familiarity: 'Familiaridad',
  preference: 'Preferencia',
  presentation: 'Presentación',
});

const ICONS = Object.freeze({
  speaker: Object.freeze(['M4 9v6h4l5 4V5L8 9H4z', 'M16.5 8.5a5 5 0 0 1 0 7']),
  dots: Object.freeze(['M5 12h.01', 'M12 12h.01', 'M19 12h.01']),
  check: Object.freeze(['M5 12l4 4 9-9']),
  caret: Object.freeze(['M6 9l6 6 6-6']),
  // Nota musical: portada de marcador de cada canción (el catálogo no tiene imágenes).
  note: Object.freeze(['M9 17.5V5l10-2v12.5', 'M4 17.5a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0', 'M14 15.5a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0']),
});

// ---------------------------------------------------------------------------
// Funciones puras
// ---------------------------------------------------------------------------

/** Duración «m:ss» (o «h:mm:ss»). Un valor que falta se muestra como guion largo. */
export function formatDuration(seconds) {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return '—';
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const pad = (value) => String(value).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${minutes}:${pad(secs)}`;
}

/** Entero de 0 a 5 para la familiaridad. Lo que no sea un entero válido cuenta como sin valorar (0). */
export function familiarityValue(value) {
  return Number.isInteger(value) && value >= 0 && value <= 5 ? value : 0;
}

/** Texto de la familiaridad: «3 de 5», o «Sin valorar» si es 0. */
export function familiarityText(value) {
  const level = familiarityValue(value);
  return level === 0 ? 'Sin valorar' : `${level} de 5`;
}

/** Preferencia para mostrar: entero de −1 a 1. Los valores fuera de ese rango se acercan al límite. */
export function clampPreference(value) {
  if (!Number.isInteger(value)) return 0;
  return Math.max(-1, Math.min(1, value));
}

export function preferenceLabel(value) {
  const level = clampPreference(value);
  return PREFERENCES.find((item) => item.value === level)?.label ?? 'Le da igual';
}

/** Código de presentación válido (C0, C1 o C2). Lo que no sea válido se muestra como C0. */
export function presentationCode(value) {
  return PRESENTATIONS.some((item) => item.code === value) ? value : 'C0';
}

export function presentationLabel(code, { long = false } = {}) {
  const item = PRESENTATIONS.find((entry) => entry.code === presentationCode(code));
  return long ? item.long : item.short;
}

/** Identificadores de canción que aparecen en algún recuerdo del perfil. */
export function memorySongIds(memories) {
  const ids = new Set();
  for (const memory of Array.isArray(memories) ? memories : []) {
    for (const id of Array.isArray(memory?.songIds) ? memory.songIds : []) ids.add(id);
  }
  return ids;
}

/** Canciones con copia guardada para escuchar sin conexión, a partir de las URL de la caché de audio. */
export function cachedSongIds(songs, cachedUrls = []) {
  const { alreadyCached } = planOfflineDownload(songs, cachedUrls);
  const prefix = 'audio/';
  const suffix = '.opus';
  return new Set(alreadyCached.map((path) => path.slice(prefix.length, path.length - suffix.length)));
}

/** Filas de la tabla a partir del catálogo y de las valoraciones del perfil. Las filas no tienen DOM. */
export function buildRows(songs, { links = [], memorySongIds: memories = new Set(), cachedIds = new Set(), playingId = null } = {}) {
  const linkBySong = new Map(links.map((link) => [link.songId, link]));
  const rows = [];
  for (const song of Array.isArray(songs) ? songs : []) {
    if (!song || typeof song.id !== 'string') continue;
    const link = linkBySong.get(song.id) ?? null;
    rows.push({
      id: song.id,
      title: typeof song.title === 'string' ? song.title : '',
      artist: typeof song.artist === 'string' ? song.artist : '',
      durationS: typeof song.duration_s === 'number' && Number.isFinite(song.duration_s) ? song.duration_s : null,
      familiarity: familiarityValue(link?.familiarity),
      preference: clampPreference(link?.preference),
      presentation: presentationCode(link?.presentation),
      hasLink: link !== null,
      hasMemory: memories.has(song.id),
      cached: cachedIds.has(song.id),
      playing: playingId !== null && playingId === song.id,
    });
  }
  return rows;
}

/** Filas que cumplen un filtro de C-8. El recuento de cada filtro sale de countByFilter. */
export function filterRows(rows, filterKey) {
  switch (filterKey) {
    case 'sin-familiaridad': return rows.filter((row) => row.familiarity === 0);
    case 'con-recuerdo': return rows.filter((row) => row.hasMemory);
    case 'sin-conexion': return rows.filter((row) => !row.cached);
    default: return rows;
  }
}

export function countByFilter(rows) {
  return Object.fromEntries(FILTERS.map((filter) => [filter.key, filterRows(rows, filter.key).length]));
}

/** Texto normalizado para comparar: sin tildes ni mayúsculas. */
export function searchKey(text) {
  return String(text ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/** Cada palabra de la búsqueda debe aparecer en el título o en el artista. Búsqueda vacía: todas. */
export function matchesQuery(row, query) {
  const tokens = searchKey(query).trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  const haystack = searchKey(`${row.title} ${row.artist}`);
  return tokens.every((token) => haystack.includes(token));
}

const collator = new Intl.Collator('es', { sensitivity: 'base', numeric: true });

/** Orden de la tabla. Las duraciones que faltan van siempre al final. El desempate es el título y luego el id. */
export function sortRows(rows, key = 'title', direction = 'asc') {
  const sign = direction === 'desc' ? -1 : 1;
  const primary = (a, b) => {
    switch (key) {
      case 'duration':
        if (a.durationS === null || b.durationS === null) {
          if (a.durationS === b.durationS) return 0;
          return a.durationS === null ? 1 : -1;
        }
        return sign * (a.durationS - b.durationS);
      case 'familiarity': return sign * (a.familiarity - b.familiarity);
      case 'preference': return sign * (a.preference - b.preference);
      case 'presentation':
        return sign * (PRESENTATIONS.findIndex((item) => item.code === a.presentation)
          - PRESENTATIONS.findIndex((item) => item.code === b.presentation));
      default: return sign * collator.compare(a.title, b.title);
    }
  };
  return [...rows].sort((a, b) => primary(a, b)
    || collator.compare(a.title, b.title)
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Fila siguiente para las flechas, Inicio y Fin. Devuelve el índice o null si la tecla no mueve la fila. */
export function nextRowIndex(current, key, total) {
  if (!Number.isInteger(total) || total <= 0) return null;
  const from = Number.isInteger(current) && current >= 0 ? current : -1;
  switch (key) {
    case 'ArrowDown': return Math.min(from + 1, total - 1);
    case 'ArrowUp': return from <= 0 ? 0 : from - 1;
    case 'Home': return 0;
    case 'End': return total - 1;
    default: return null;
  }
}

export function toggleId(selected, id) {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

export function selectVisible(selected, visibleIds) {
  const next = new Set(selected);
  for (const id of visibleIds) next.add(id);
  return next;
}

export function deselectVisible(selected, visibleIds) {
  const visible = new Set(visibleIds);
  return new Set([...selected].filter((id) => !visible.has(id)));
}

/** La selección solo cuenta las filas visibles: al filtrar o buscar, se quitan las que salen de la vista. */
export function retainVisible(selected, visibleIds) {
  const visible = new Set(visibleIds);
  return new Set([...selected].filter((id) => visible.has(id)));
}

/** Estado de la casilla de cabecera: todas, algunas o ninguna de las visibles están seleccionadas. */
export function headerSelectionState(selected, visibleIds) {
  if (visibleIds.length === 0) return 'ninguna';
  const count = visibleIds.filter((id) => selected.has(id)).length;
  if (count === 0) return 'ninguna';
  return count === visibleIds.length ? 'todas' : 'algunas';
}

export function selectionSummary(count) {
  return count === 1 ? '1 seleccionada' : `${count} seleccionadas`;
}

/** Copia de los campos indicados de una fila, para poder deshacer un cambio. */
export function pickFields(source, keys) {
  return Object.fromEntries(keys.map((key) => [key, source[key]]));
}

function plural(count, one, many) {
  return count === 1 ? one : many;
}

// ---------------------------------------------------------------------------
// Pantalla
// ---------------------------------------------------------------------------

// Crea un elemento. Los textos entran como nodos de texto, nunca como HTML.
function el(tag, attrs, ...children) {
  const doc = globalThis.document;
  const node = doc.createElement(tag);
  for (const [name, value] of Object.entries(attrs ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    node.setAttribute(name, value === true ? '' : String(value));
  }
  // Los hijos pueden llegar en listas (p. ej. map()): se aplanan antes de añadirlos.
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(typeof child === 'object' ? child : doc.createTextNode(String(child)));
  }
  return node;
}

// Lee el estado del reproductor sin lanzar: el marco y la pantalla lo consultan, no lo modifican.
function readPlayerState(player) {
  try {
    const current = player?.getState?.();
    return { id: current?.track?.id ?? null, playing: Boolean(current?.playing) };
  } catch {
    return { id: null, playing: false };
  }
}

// Lista de URL de la caché de audio. Sin Cache Storage (o con error), no hay copias guardadas.
async function readCachedUrls() {
  const cacheApi = globalThis.caches;
  if (!cacheApi) return [];
  const name = audioCacheName();
  try {
    if (!(await cacheApi.has(name))) return [];
    const cache = await cacheApi.open(name);
    return (await cache.keys()).map((request) => request.url);
  } catch {
    return [];
  }
}

/** Monta la biblioteca en root. Devuelve { unmount() }. Es la función de la ruta «biblioteca». */
export function mountLibrary(root, services, params = {}) {
  const doc = root.ownerDocument ?? globalThis.document;
  const store = services.store;
  const rowsById = new Map();
  const partsById = new Map();
  const state = {
    rows: [],
    visible: [],
    filter: 'todas',
    query: '',
    sort: { key: 'title', direction: 'asc' },
    selected: new Set(),
    activeId: null,
    profileId: null,
    loaded: false,
    folderId: null,
  };
  // Parámetros de la ruta (app.js los toma de la consulta del hash): un filtro de C-8 y una carpeta del catálogo.
  // Lo que no coincide con nada se ignora y se muestra la biblioteca completa.
  if (FILTERS.some((item) => item.key === params?.filter)) state.filter = params.filter;
  let disposed = false;
  let popup = null;
  let notice = null;
  let sheetOpen = false;
  let pollTimer = null;

  // Iconos fijos (plantillas propias, sin datos de usuario).
  function icon(name, className = 'c-biblioteca-icono') {
    const svg = doc.createElementNS(NS_SVG, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.setAttribute('class', className);
    for (const d of ICONS[name] ?? []) {
      const path = doc.createElementNS(NS_SVG, 'path');
      path.setAttribute('d', d);
      svg.append(path);
    }
    return svg;
  }

  // ---- Estructura ----
  const section = el('section', { class: 'c-biblioteca', 'data-testid': 'c-biblioteca', 'aria-label': TITLE });

  // Búsqueda y vista previa: van en el hueco de cabecera del marco (services.headerSlot) o, si no hay hueco, arriba.
  const search = el('input', {
    id: 'c-biblioteca-busqueda',
    type: 'search',
    class: 'c-biblioteca-busqueda-campo',
    'data-testid': 'c-biblioteca-search',
    autocomplete: 'off',
    autocapitalize: 'off',
    autocorrect: 'off',
    spellcheck: 'false',
    enterkeyhint: 'search',
  });
  const searchLabel = el('label', { class: 'c-biblioteca-busqueda', for: 'c-biblioteca-busqueda-campo' },
    el('span', { class: 'c-biblioteca-busqueda-etiqueta' }, 'Buscar'),
    search);
  const previewButton = el('button', {
    type: 'button',
    class: 'c-biblioteca-boton c-biblioteca-boton--secundario',
    'data-testid': 'c-biblioteca-preview',
  }, 'Vista previa');
  const headerBox = el('div', { class: 'c-biblioteca-cabecera-acciones' }, searchLabel, previewButton);

  const manageButton = el('button', { type: 'button', class: 'c-biblioteca-boton c-biblioteca-boton--secundario c-biblioteca-gestionar' },
    'Gestionar la biblioteca');
  const hintEl = el('p', { class: 'c-biblioteca-ayuda', hidden: true },
    'Elige un perfil en la cabecera para valorar las canciones.');

  // Filtros de C-8: botones con aria-pressed; el recuento va entre paréntesis.
  const chips = new Map();
  const filterGroup = el('div', { class: 'c-biblioteca-filtros', role: 'group', 'aria-label': 'Filtrar canciones', 'data-testid': 'c-biblioteca-filters' },
    FILTERS.map((filter) => {
      const text = el('span', { class: 'c-chip-texto' }, filter.label);
      const button = el('button', { type: 'button', class: 'c-chip', 'aria-pressed': 'false', 'data-filtro': filter.key }, icon('check', 'c-chip-marca'), text);
      chips.set(filter.key, { button, text, label: filter.label });
      return button;
    }));
  const toolbar = el('div', { class: 'c-biblioteca-barra-superior' }, filterGroup, manageButton);

  // Barra de selección múltiple (C-18): aparece con al menos una fila marcada.
  const bulkCount = el('span', { class: 'c-biblioteca-barra-recuento' });
  const famBulkButtons = [1, 2, 3, 4, 5].map((value) => el('button', {
    type: 'button',
    class: 'c-biblioteca-boton c-biblioteca-boton--compacto',
    'data-lote-familiaridad': String(value),
    'aria-label': `Familiaridad ${value} de 5: ${FAMILIARITY_LEGEND[value - 1]}`,
  }, String(value)));
  const prefBulkButtons = PREFERENCES.map((item) => el('button', {
    type: 'button',
    class: 'c-biblioteca-boton c-biblioteca-boton--compacto',
    'data-lote-preferencia': String(item.value),
  }, item.label));
  const presBulkButtons = PRESENTATIONS.map((item) => el('button', {
    type: 'button',
    class: 'c-biblioteca-boton c-biblioteca-boton--compacto',
    'data-lote-presentacion': item.code,
  }, presentationLabel(item.code)));
  const listSelect = el('select', { class: 'c-biblioteca-selector', id: 'c-biblioteca-lista-lote', 'aria-label': 'Lista a la que añadir las canciones' });
  const listAddButton = el('button', { type: 'button', class: 'c-biblioteca-boton c-biblioteca-boton--compacto' }, 'Añadir a la lista');
  const removeBulkButton = el('button', { type: 'button', class: 'c-biblioteca-boton c-biblioteca-boton--peligro c-biblioteca-boton--compacto' }, 'Quitar del perfil');
  const clearBulkButton = el('button', { type: 'button', class: 'c-biblioteca-boton c-biblioteca-boton--secundario c-biblioteca-boton--compacto' }, 'Quitar la selección');
  const bulk = el('div', {
    class: 'c-biblioteca-seleccion',
    role: 'region',
    'aria-label': 'Acciones para las canciones seleccionadas',
    'data-testid': 'c-biblioteca-bulk',
    hidden: true,
  },
  bulkCount,
  el('div', { class: 'c-biblioteca-lote-grupo', role: 'group', 'aria-label': 'Familiaridad en lote' },
    el('span', { class: 'c-biblioteca-lote-etiqueta' }, 'Familiaridad'), ...famBulkButtons),
  el('div', { class: 'c-biblioteca-lote-grupo', role: 'group', 'aria-label': 'Preferencia en lote' },
    el('span', { class: 'c-biblioteca-lote-etiqueta' }, 'Preferencia'), ...prefBulkButtons),
  el('div', { class: 'c-biblioteca-lote-grupo', role: 'group', 'aria-label': 'Presentación en lote' },
    el('span', { class: 'c-biblioteca-lote-etiqueta' }, 'Presentación'), ...presBulkButtons),
  el('div', { class: 'c-biblioteca-lote-grupo', role: 'group', 'aria-label': 'Añadir a una lista' }, listSelect, listAddButton),
  removeBulkButton,
  clearBulkButton);

  // Tabla (C-4). El encabezado tiene casilla de todas las visibles y botones de orden.
  const headerCheckbox = el('input', { type: 'checkbox', class: 'c-biblioteca-casilla', 'aria-label': 'Seleccionar todas las canciones visibles' });
  const sortHeaders = new Map();
  const sortButtons = new Map();
  function sortHeader(key, className) {
    const button = el('button', { type: 'button', class: 'c-biblioteca-orden', 'data-orden': key }, SORT_LABELS[key]);
    const th = el('th', { scope: 'col', class: className, 'aria-sort': 'none' }, button);
    sortHeaders.set(key, th);
    sortButtons.set(key, button);
    return th;
  }
  const thead = el('thead', null, el('tr', null,
    el('th', { scope: 'col', class: 'col-seleccion' }, headerCheckbox),
    el('th', { scope: 'col', class: 'col-portada' }, el('span', { class: 'visually-hidden' }, 'Portada')),
    sortHeader('title', 'col-titulo'),
    el('th', { scope: 'col', class: 'col-carpeta' }, 'Carpeta'),
    sortHeader('duration', 'col-duracion'),
    sortHeader('familiarity', 'col-familiaridad'),
    sortHeader('preference', 'col-preferencia'),
    sortHeader('presentation', 'col-presentacion'),
    el('th', { scope: 'col', class: 'col-menu' }, el('span', { class: 'visually-hidden' }, 'Opciones')),
    el('th', { scope: 'col', class: 'col-ficha' }, el('span', { class: 'visually-hidden' }, 'Ficha'))));
  const tbody = el('tbody');
  const table = el('table', { class: 'c-biblioteca-tabla', 'data-testid': 'c-biblioteca-table' },
    el('caption', { class: 'visually-hidden' }, 'Canciones del catálogo. Las flechas mueven entre filas, Intro abre la ficha y Espacio marca la fila.'),
    thead,
    tbody);
  const tableBox = el('div', { class: 'c-biblioteca-tabla-caja' }, table);
  const emptyEl = el('p', { class: 'c-biblioteca-vacio', role: 'status', hidden: true });
  const loadingEl = el('p', { class: 'c-biblioteca-cargando', role: 'status' }, 'Cargando la biblioteca…');

  section.append(toolbar, hintEl, bulk, loadingEl, emptyEl, tableBox);
  // En teléfono, la búsqueda y «Vista previa» no caben en la cabecera de 56 px: van al principio de la pantalla.
  const phoneMedia = globalThis.matchMedia ? globalThis.matchMedia('(max-width: 599.98px)') : null;
  function placeHeaderBox() {
    if (services.headerSlot && typeof services.headerSlot.append === 'function' && !phoneMedia?.matches) services.headerSlot.append(headerBox);
    else section.insertBefore(headerBox, toolbar);
  }
  placeHeaderBox();
  phoneMedia?.addEventListener?.('change', placeHeaderBox);
  root.append(section);
  services.setTitle?.(TITLE);

  // ---- Filas ----

  // Carpeta de cada canción (columna «Carpeta», desde 1024 px). Sin carpeta, guion largo.
  const folderNames = new Map();
  for (const folder of Array.isArray(services.catalog?.folders) ? services.catalog.folders : []) {
    if (typeof folder?.id === 'string') folderNames.set(folder.id, typeof folder.name === 'string' ? folder.name : '');
  }
  const folderIdBySong = new Map();
  for (const song of Array.isArray(services.catalog?.songs) ? services.catalog.songs : []) {
    if (typeof song?.id === 'string') folderIdBySong.set(song.id, song.folder_id);
  }
  // Carpeta de la ruta (la barra lateral navega con folderId): solo sus canciones. Una carpeta desconocida no acota.
  if (typeof params?.folderId === 'string' && folderNames.has(params.folderId)) state.folderId = params.folderId;
  // Filas dentro del ámbito de carpeta (o todas si no hay carpeta). Lo usan la vista y los recuentos de los filtros.
  function scopeRows(rows) {
    return state.folderId === null ? rows : rows.filter((row) => folderIdBySong.get(row.id) === state.folderId);
  }
  function folderLabel(songId) {
    return folderNames.get(folderIdBySong.get(songId)) || '—';
  }

  // Crea la fila con sus controles. Los controles de la fila no están en el orden de tabulación: la fila es el
  // único punto de tabulación (roving tabindex), y los controles se usan con el puntero o con las teclas de la fila.
  function buildRow(row) {
    const tr = el('tr', { class: 'c-biblioteca-fila', 'data-testid': 'c-biblioteca-row', 'data-song-id': row.id, tabindex: '-1' });
    const check = el('input', { type: 'checkbox', class: 'c-biblioteca-casilla', tabindex: '-1' });
    // Número de la posición en la vista (lo pone applyView). Lo ven los ojos; el lector de pantalla usa la casilla.
    const numberText = el('span', { class: 'c-biblioteca-numero cifras', 'aria-hidden': 'true' });
    const coverMark = el('span', { class: 'c-biblioteca-portada', 'aria-hidden': 'true' }, icon('note', 'c-biblioteca-icono'));
    const folderText = el('span', { class: 'c-biblioteca-carpeta' }, folderLabel(row.id));
    const selectedHint = el('span', { class: 'visually-hidden' }, 'Seleccionada');
    const playingTag = el('span', { class: 'c-biblioteca-estado c-biblioteca-estado--suena' }, icon('speaker', 'c-biblioteca-icono c-biblioteca-icono--pequeno'), 'Suena');
    const offlineTag = el('span', { class: 'c-biblioteca-estado c-biblioteca-estado--sin-conexion' }, 'No descargada');
    const titleText = el('span', { class: 'c-biblioteca-titulo-texto' }, row.title);
    const artistText = el('span', { class: 'c-biblioteca-artista' }, row.artist);
    const titleCell = el('td', { class: 'col-titulo c-biblioteca-celda-titulo' }, titleText, playingTag, offlineTag, artistText, selectedHint);
    const durationText = el('span', { class: 'cifras' }, formatDuration(row.durationS));
    const famButtons = [1, 2, 3, 4, 5].map((value) => el('button', {
      type: 'button',
      role: 'radio',
      class: 'c-biblioteca-fam',
      tabindex: '-1',
      'data-valor': String(value),
      'aria-checked': 'false',
      'aria-label': `${value} de 5: ${FAMILIARITY_LEGEND[value - 1]}`,
    }, String(value)));
    const famGroup = el('div', { class: 'c-biblioteca-fam-grupo', role: 'radiogroup', 'aria-label': `Familiaridad de «${row.title}»` }, ...famButtons);
    const famText = el('span', { class: 'c-biblioteca-fam-texto' });
    const prefText = el('span', { class: 'c-biblioteca-desplegable-texto' });
    const prefButton = el('button', {
      type: 'button',
      class: 'c-biblioteca-desplegable',
      tabindex: '-1',
      'aria-haspopup': 'menu',
      'aria-expanded': 'false',
      'data-control': 'preferencia',
    }, prefText, icon('caret', 'c-biblioteca-icono c-biblioteca-icono--pequeno'));
    const presText = el('span', { class: 'c-biblioteca-desplegable-texto' });
    const presButton = el('button', {
      type: 'button',
      class: 'c-biblioteca-desplegable',
      tabindex: '-1',
      'aria-haspopup': 'menu',
      'aria-expanded': 'false',
      'data-control': 'presentacion',
    }, presText, icon('caret', 'c-biblioteca-icono c-biblioteca-icono--pequeno'));
    const menuButton = el('button', {
      type: 'button',
      class: 'c-biblioteca-icono-boton',
      tabindex: '-1',
      'aria-haspopup': 'menu',
      'aria-expanded': 'false',
      'data-control': 'menu',
      'aria-label': `Más opciones de «${row.title}»`,
    }, icon('dots'));
    const fichaButton = el('button', {
      type: 'button',
      class: 'c-biblioteca-ficha',
      tabindex: '-1',
      'data-control': 'ficha',
      'aria-label': `Abrir la ficha de «${row.title}»`,
    }, 'Ficha');
    tr.append(
      el('td', { class: 'col-seleccion' }, numberText, check),
      el('td', { class: 'col-portada' }, coverMark),
      titleCell,
      el('td', { class: 'col-carpeta' }, folderText),
      el('td', { class: 'col-duracion' }, durationText),
      el('td', { class: 'col-familiaridad' }, famGroup, famText),
      el('td', { class: 'col-preferencia' }, prefButton),
      el('td', { class: 'col-presentacion' }, presButton),
      el('td', { class: 'col-menu' }, menuButton),
      el('td', { class: 'col-ficha' }, fichaButton));
    partsById.set(row.id, { tr, check, numberText, selectedHint, playingTag, offlineTag, famButtons, famText, prefText, prefButton, presText, presButton, menuButton, fichaButton });
    return tr;
  }

  // Refleja en el DOM el estado de una fila: selección, valoraciones, estado de reproducción y de descarga.
  function paintRow(row) {
    const parts = partsById.get(row.id);
    if (!parts) return;
    const selected = state.selected.has(row.id);
    const hasProfile = state.profileId !== null;
    parts.tr.classList.toggle('c-biblioteca-fila--seleccionada', selected);
    parts.tr.classList.toggle('c-biblioteca-fila--sonando', row.playing);
    parts.tr.setAttribute('aria-selected', String(selected));
    parts.tr.tabIndex = row.id === state.activeId ? 0 : -1;
    parts.check.checked = selected;
    parts.check.setAttribute('aria-label', `Seleccionar «${row.title}»`);
    parts.selectedHint.hidden = !selected;
    parts.playingTag.hidden = !row.playing;
    parts.offlineTag.hidden = row.cached;
    for (const [index, button] of parts.famButtons.entries()) {
      const checked = row.familiarity === index + 1;
      button.setAttribute('aria-checked', String(checked));
      button.classList.toggle('is-activo', checked);
      button.disabled = !hasProfile;
    }
    parts.famText.textContent = familiarityText(row.familiarity);
    parts.prefText.textContent = preferenceLabel(row.preference);
    parts.prefButton.disabled = !hasProfile;
    parts.prefButton.setAttribute('aria-label', `Preferencia de «${row.title}»: ${preferenceLabel(row.preference)}`);
    parts.presText.textContent = presentationLabel(row.presentation);
    parts.presButton.disabled = !hasProfile;
    parts.presButton.setAttribute('aria-label', `Presentación de «${row.title}»: ${presentationLabel(row.presentation, { long: true })}`);
  }

  function setRovingFocusRow(songId) {
    state.activeId = songId;
    for (const row of state.visible) {
      const parts = partsById.get(row.id);
      if (parts) parts.tr.tabIndex = row.id === songId ? 0 : -1;
    }
  }

  function focusRow(songId) {
    const parts = partsById.get(songId);
    if (!parts) return;
    setRovingFocusRow(songId);
    parts.tr.focus();
  }

  // ---- Vista: filtro, búsqueda, orden y selección ----

  function applyView() {
    if (disposed) return;
    const visible = sortRows(
      filterRows(scopeRows(state.rows), state.filter).filter((row) => matchesQuery(row, state.query)),
      state.sort.key,
      state.sort.direction,
    );
    state.visible = visible;
    const ids = visible.map((row) => row.id);
    state.selected = retainVisible(state.selected, ids);
    if (!ids.includes(state.activeId)) state.activeId = ids[0] ?? null;
    tbody.replaceChildren(...visible.map((row) => partsById.get(row.id).tr));
    visible.forEach((row, index) => { partsById.get(row.id).numberText.textContent = String(index + 1); });
    for (const row of visible) paintRow(row);
    updateChrome();
  }

  // Lo que depende de la vista completa: chips, orden, casilla de cabecera, barra de selección y mensajes.
  function updateChrome() {
    const counts = countByFilter(scopeRows(state.rows));
    for (const filter of FILTERS) {
      const entry = chips.get(filter.key);
      entry.text.textContent = `${entry.label} (${counts[filter.key]})`;
      const pressed = state.filter === filter.key;
      entry.button.setAttribute('aria-pressed', String(pressed));
      entry.button.classList.toggle('is-activo', pressed);
    }
    for (const key of SORT_KEYS) {
      const direction = state.sort.key === key ? (state.sort.direction === 'asc' ? 'ascending' : 'descending') : 'none';
      sortHeaders.get(key).setAttribute('aria-sort', direction);
    }
    const ids = state.visible.map((row) => row.id);
    const headerState = headerSelectionState(state.selected, ids);
    headerCheckbox.checked = headerState === 'todas';
    headerCheckbox.indeterminate = headerState === 'algunas';
    headerCheckbox.disabled = ids.length === 0;
    updateBulk();
    updateEmpty();
  }

  function updateBulk() {
    const count = state.selected.size;
    bulk.hidden = count === 0;
    bulkCount.textContent = selectionSummary(count);
    const hasProfile = state.profileId !== null;
    for (const button of [...famBulkButtons, ...prefBulkButtons, ...presBulkButtons]) button.disabled = !hasProfile;
    listSelect.disabled = !hasProfile;
    listAddButton.disabled = !hasProfile || listSelect.value === '';
    removeBulkButton.disabled = !canRemove();
  }

  function updateEmpty() {
    let message = '';
    if (state.loaded && state.rows.length === 0) {
      message = 'La biblioteca no tiene canciones todavía.';
    } else if (state.loaded && state.visible.length === 0) {
      const query = state.query.trim();
      if (query !== '') message = `No hay canciones con «${query}». Prueba con otro título o artista.`;
      else if (state.folderId !== null && scopeRows(state.rows).length === 0) message = 'No hay canciones en esta carpeta todavía.';
      else message = 'Ninguna canción cumple este filtro.';
    }
    emptyEl.textContent = message;
    emptyEl.hidden = message === '';
    tableBox.hidden = state.visible.length === 0;
  }

  function updateHint() {
    hintEl.hidden = state.profileId !== null;
  }

  function setSelection(next) {
    state.selected = next;
    for (const row of state.visible) paintRow(row);
    updateChrome();
  }

  function toggleSelection(songId) {
    setSelection(toggleId(state.selected, songId));
  }

  function selectedInOrder() {
    return state.visible.filter((row) => state.selected.has(row.id)).map((row) => row.id);
  }

  function visibleIds() {
    return state.visible.map((row) => row.id);
  }

  // ---- Valoraciones: guardar, avisar y deshacer ----

  function canRemove() {
    return state.profileId !== null && typeof store?.deleteSongLink === 'function';
  }

  function shortcutsEnabled() {
    try {
      return services.prefs?.get?.('shortcuts') === 'activados';
    } catch {
      return false;
    }
  }

  // Guarda un cambio en una o varias canciones del perfil activo. Si una falla, se detiene y avisa; lo guardado
  // se puede deshacer con «Deshacer» durante 10 segundos.
  async function changeLinks(songIds, patch) {
    const profileId = state.profileId;
    if (!profileId || disposed) return;
    const keys = Object.keys(patch);
    const targets = songIds.map((id) => rowsById.get(id)).filter(Boolean);
    if (targets.length === 0) return;
    const previous = targets.map((row) => ({ id: row.id, values: pickFields(row, keys) }));
    const saved = [];
    let failure = null;
    for (const row of targets) {
      try {
        const result = await store.setSongLink(profileId, row.id, patch);
        // La presentación es parte de la condición del estudio: si el almacén no la guarda, no se da por hecha.
        if (keys.includes('presentation') && result?.presentation !== patch.presentation) {
          throw new Error('La presentación no se ha guardado.');
        }
        if (disposed) return;
        for (const key of keys) {
          const value = result && result[key] !== undefined ? result[key] : patch[key];
          row[key] = key === 'preference' ? clampPreference(value) : value;
        }
        row.hasLink = true;
        saved.push(row.id);
        paintRow(row);
      } catch (error) {
        failure = { row, error };
        break;
      }
    }
    if (disposed) return;
    updateChrome();
    // Un solo aviso a la vez: si hubo error a mitad del lote, el error va con «Deshacer» para lo ya guardado.
    const undoable = previous.filter((item) => saved.includes(item.id));
    const undo = undoable.length > 0 ? () => revertLinks(undoable) : null;
    if (failure) {
      const text = saved.length > 0 ? `${failureText(failure.row, patch)} Los cambios anteriores sí se guardaron.` : failureText(failure.row, patch);
      showNotice(text, { tone: 'alert', undo });
    } else if (saved.length > 0) {
      showNotice(successText(patch, targets, saved.length), { undo });
    }
  }

  // Vuelve a los valores anteriores de los campos cambiados. Si la canción no tenía asociación, la restaura con
  // los valores por defecto (el almacén no permite quitar una asociación).
  async function revertLinks(items) {
    const profileId = state.profileId;
    if (!profileId || disposed) return;
    let failed = false;
    for (const item of items) {
      try {
        await store.setSongLink(profileId, item.id, item.values);
        const row = rowsById.get(item.id);
        if (row) {
          Object.assign(row, item.values);
          paintRow(row);
        }
      } catch {
        failed = true;
      }
    }
    if (disposed) return;
    updateChrome();
    showNotice(failed ? 'No se pudo deshacer todo el cambio.' : 'Cambio deshecho.', { tone: failed ? 'alert' : 'status' });
  }

  function successText(patch, targets, count) {
    const where = count === 1 ? `en «${targets[0].title}»` : `en ${count} ${plural(count, 'canción', 'canciones')}`;
    if ('familiarity' in patch) return `Familiaridad ${patch.familiarity} de 5 ${where}.`;
    if ('preference' in patch) return `Preferencia «${preferenceLabel(patch.preference)}» ${where}.`;
    return `Presentación «${presentationLabel(patch.presentation, { long: true })}» ${where}.`;
  }

  function failureText(row, patch) {
    if ('presentation' in patch) return `No se pudo guardar la presentación de «${row.title}» en este navegador.`;
    return `No se pudo guardar el cambio en «${row.title}».`;
  }

  // ---- Avisos (C-17): con «Deshacer» se cierran solos a los 10 segundos; los errores se quedan hasta cerrarlos.

  function showNotice(text, { tone = 'status', undo = null } = {}) {
    dismissNotice();
    const element = el('div', {
      class: `c-biblioteca-aviso c-biblioteca-aviso--${tone}`,
      role: tone === 'alert' ? 'alert' : 'status',
    }, el('p', { class: 'c-biblioteca-aviso-texto' }, text));
    if (undo) {
      const undoButton = el('button', { type: 'button', class: 'c-biblioteca-boton c-biblioteca-boton--secundario c-biblioteca-aviso-deshacer' }, 'Deshacer');
      undoButton.addEventListener('click', () => {
        const activeId = state.activeId;
        dismissNotice();
        undo();
        if (activeId !== null && partsById.has(activeId)) focusRow(activeId);
      });
      element.append(undoButton);
    }
    if (tone === 'alert') {
      const closeButton = el('button', { type: 'button', class: 'c-biblioteca-boton c-biblioteca-boton--secundario' }, 'Cerrar aviso');
      closeButton.addEventListener('click', dismissNotice);
      element.append(closeButton);
    }
    section.append(element);
    notice = { element, tone, undo, timer: null, remaining: UNDO_MS, startedAt: 0 };
    element.addEventListener('pointerenter', pauseNotice);
    element.addEventListener('pointerleave', resumeNotice);
    element.addEventListener('focusin', pauseNotice);
    element.addEventListener('focusout', resumeNotice);
    if (tone === 'status') scheduleNotice();
  }

  function scheduleNotice() {
    if (!notice || notice.timer !== null) return;
    notice.startedAt = Date.now();
    notice.timer = globalThis.setTimeout(dismissNotice, notice.remaining);
  }

  function pauseNotice() {
    if (!notice || notice.timer === null) return;
    globalThis.clearTimeout(notice.timer);
    notice.timer = null;
    notice.remaining = Math.max(0, notice.remaining - (Date.now() - notice.startedAt));
  }

  function resumeNotice() {
    if (!notice || notice.tone !== 'status') return;
    queueMicrotask(() => {
      if (!notice || notice.timer !== null) return;
      if (notice.element.matches(':hover') || notice.element.contains(doc.activeElement)) return;
      scheduleNotice();
    });
  }

  function dismissNotice() {
    if (!notice) return;
    globalThis.clearTimeout(notice.timer);
    notice.element.remove();
    notice = null;
  }

  // ---- Menús desplegables (preferencia, presentación y opciones de la fila) ----

  function openPopup(anchor, { label, role, items, onPick }) {
    closePopup(false);
    const list = el('div', { class: 'c-biblioteca-menu', role: 'menu', 'aria-label': label });
    const options = items.map((item) => {
      const isRadio = role === 'radio';
      const option = el('button', {
        type: 'button',
        class: 'c-biblioteca-menu-opcion',
        role: isRadio ? 'menuitemradio' : 'menuitem',
        'aria-checked': isRadio ? String(Boolean(item.checked)) : null,
        disabled: item.disabled ? true : null,
      },
      el('span', { class: 'c-biblioteca-menu-marca', 'aria-hidden': 'true' }, isRadio && item.checked ? icon('check', 'c-biblioteca-icono c-biblioteca-icono--pequeno') : null),
      item.label);
      option.addEventListener('click', () => {
        closePopup(true);
        onPick(item.value);
      });
      return option;
    });
    list.append(...options);
    section.append(list);
    const rect = anchor.getBoundingClientRect();
    const viewportWidth = globalThis.innerWidth ?? 1024;
    list.style.top = `${Math.round(rect.bottom + 4)}px`;
    list.style.left = `${Math.max(8, Math.min(Math.round(rect.left), viewportWidth - 264))}px`;
    anchor.setAttribute('aria-expanded', 'true');
    popup = { list, anchor };
    list.addEventListener('keydown', onPopupKey);
    doc.addEventListener('pointerdown', onPopupOutside, true);
    doc.addEventListener('scroll', onPopupMove, true);
    globalThis.addEventListener('resize', onPopupMove);
    const initial = options.find((option) => option.getAttribute('aria-checked') === 'true') ?? options.find((option) => !option.disabled);
    initial?.focus();
  }

  function closePopup(restoreFocus = true) {
    if (!popup) return;
    const { list, anchor } = popup;
    popup = null;
    list.remove();
    anchor.setAttribute('aria-expanded', 'false');
    doc.removeEventListener('pointerdown', onPopupOutside, true);
    doc.removeEventListener('scroll', onPopupMove, true);
    globalThis.removeEventListener('resize', onPopupMove);
    if (restoreFocus && anchor.isConnected) anchor.focus();
  }

  function onPopupKey(event) {
    if (!popup) return;
    if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault();
      closePopup(true);
      return;
    }
    const items = Array.from(popup.list.querySelectorAll('[role="menuitem"], [role="menuitemradio"]')).filter((item) => !item.disabled);
    const next = nextRowIndex(items.indexOf(doc.activeElement), event.key, items.length);
    if (next !== null) {
      event.preventDefault();
      items[next].focus();
    }
  }

  function onPopupOutside(event) {
    if (popup && !popup.list.contains(event.target) && event.target !== popup.anchor) closePopup(false);
  }

  function onPopupMove() {
    closePopup(false);
  }

  function openValueMenu(button, songId, kind) {
    const row = rowsById.get(songId);
    if (!row) return;
    if (kind === 'preferencia') {
      openPopup(button, {
        label: `Preferencia de «${row.title}»`,
        role: 'radio',
        items: PREFERENCES.map((item) => ({ value: item.value, label: item.label, checked: clampPreference(row.preference) === item.value })),
        onPick: (value) => changeLinks([songId], { preference: value }),
      });
      return;
    }
    openPopup(button, {
      label: `Presentación de «${row.title}»`,
      role: 'radio',
      items: PRESENTATIONS.map((item) => ({ value: item.code, label: item.long, checked: row.presentation === item.code })),
      onPick: (value) => changeLinks([songId], { presentation: value }),
    });
  }

  function openRowMenu(button, songId) {
    const row = rowsById.get(songId);
    if (!row) return;
    openPopup(button, {
      label: `Opciones de «${row.title}»`,
      role: 'menu',
      items: [
        { value: 'ficha', label: 'Abrir la ficha' },
        { value: 'quitar', label: 'Quitar del perfil', disabled: !canRemove() },
      ],
      onPick: (value) => {
        if (value === 'ficha') openPanelFor(songId);
        else if (value === 'quitar') removeFromProfile([songId]);
      },
    });
  }

  function openPanelFor(songId) {
    services.openPanel?.(songId);
  }

  // Quitar del perfil borra la asociación, no la canción. Pide confirmación porque no se puede deshacer.
  async function removeFromProfile(songIds) {
    const profileId = state.profileId;
    if (!canRemove() || !profileId) return;
    const targets = songIds.map((id) => rowsById.get(id)).filter(Boolean);
    if (targets.length === 0) return;
    const count = targets.length;
    const confirmed = await services.confirm({
      title: 'Quitar del perfil',
      body: count === 1
        ? `Se borran la familiaridad, la preferencia y la presentación de «${targets[0].title}» para este perfil. La canción sigue en la biblioteca.`
        : `Se borran la familiaridad, la preferencia y la presentación de ${count} canciones para este perfil. Las canciones siguen en la biblioteca.`,
      confirmLabel: 'Quitar del perfil',
      cancelLabel: 'Cancelar',
      danger: true,
    });
    if (!confirmed || disposed) return;
    let removed = 0;
    for (const row of targets) {
      try {
        await store.deleteSongLink(profileId, row.id);
        Object.assign(row, { familiarity: 0, preference: 0, presentation: 'C0', hasLink: false });
        paintRow(row);
        removed += 1;
      } catch {
        break;
      }
    }
    if (disposed) return;
    state.selected = deselectVisible(state.selected, targets.map((row) => row.id));
    setSelection(state.selected);
    showNotice(removed === count
      ? `${plural(count, 'Canción quitada', 'Canciones quitadas')} del perfil.`
      : 'No se pudo quitar del perfil la canción.', { tone: removed === count ? 'status' : 'alert' });
  }

  // ---- Listas y lote ----

  function addOption(select, value, text) {
    select.append(el('option', { value }, text));
  }

  async function refreshListOptions() {
    listSelect.replaceChildren();
    if (state.profileId === null) {
      addOption(listSelect, '', 'Elige un perfil');
      updateBulk();
      return;
    }
    try {
      const lists = await store.listPlaylists(state.profileId);
      if (disposed) return;
      if (lists.length === 0) {
        addOption(listSelect, '', 'No hay listas en este perfil');
      } else {
        for (const list of lists) addOption(listSelect, list.id, list.name);
      }
    } catch {
      addOption(listSelect, '', 'No se pudieron leer las listas');
    }
    updateBulk();
  }

  // Añade las canciones seleccionadas a la lista elegida, sin repetir las que ya están.
  async function addSelectionToList() {
    const profileId = state.profileId;
    const listId = listSelect.value;
    const ids = selectedInOrder();
    if (!profileId || !listId || ids.length === 0) return;
    try {
      const lists = await store.listPlaylists(profileId);
      const list = lists.find((item) => item.id === listId);
      if (!list) {
        showNotice('La lista ya no existe. Elige otra.', { tone: 'alert' });
        await refreshListOptions();
        return;
      }
      const songIds = [...list.songIds];
      for (const id of ids) {
        if (!songIds.includes(id)) songIds.push(id);
      }
      const added = songIds.length - list.songIds.length;
      if (songIds.length > PLAYLIST_LIMIT) {
        showNotice(`Una lista admite como máximo ${PLAYLIST_LIMIT} canciones.`, { tone: 'alert' });
        return;
      }
      if (added === 0) {
        showNotice(`Las canciones seleccionadas ya están en «${list.name}».`);
        return;
      }
      await store.savePlaylist({ id: list.id, profileId, songIds });
      if (disposed) return;
      showNotice(`${plural(added, 'Añadida 1 canción', `Añadidas ${added} canciones`)} a «${list.name}».`);
    } catch {
      showNotice('No se pudo añadir a la lista. Inténtalo de nuevo.', { tone: 'alert' });
    }
  }

  function applyToSelection(patch) {
    changeLinks(selectedInOrder(), patch);
  }

  // ---- Vista previa y gestión por incidencias ----

  function startPreview() {
    if (state.profileId === null) {
      showNotice('Crea un perfil antes de abrir la vista previa.', { tone: 'alert' });
      return;
    }
    services.startPreview?.(state.profileId);
  }

  async function openManagement() {
    if (sheetOpen) return;
    sheetOpen = true;
    const songId = state.selected.size === 1 ? [...state.selected][0] : state.activeId;
    try {
      await openIncidentSheet(services, songId ? { songId } : {});
    } catch (error) {
      console.error('Reminiscencia: no se pudo abrir la gestión de la biblioteca.', error);
    } finally {
      sheetOpen = false;
    }
  }

  // ---- Carga y estado del reproductor ----

  async function load() {
    try {
      const profileId = await store.getActiveProfileId();
      if (disposed) return;
      state.profileId = profileId ?? null;
      const songs = Array.isArray(services.catalog?.songs) ? services.catalog.songs : [];
      const [links, memories, cachedUrls] = await Promise.all([
        state.profileId !== null ? store.listSongLinks(state.profileId) : [],
        state.profileId !== null ? store.listMemories(state.profileId) : [],
        readCachedUrls(),
      ]);
      if (disposed) return;
      const player = readPlayerState(services.player);
      state.rows = buildRows(songs, {
        links,
        memorySongIds: memorySongIds(memories),
        cachedIds: cachedSongIds(songs, cachedUrls),
        playingId: player.playing ? player.id : null,
      });
      for (const row of state.rows) {
        rowsById.set(row.id, row);
        buildRow(row);
      }
      state.loaded = true;
      loadingEl.hidden = true;
      updateHint();
      applyView();
      await refreshListOptions();
    } catch (error) {
      if (disposed) return;
      loadingEl.hidden = true;
      console.error('Reminiscencia: no se pudo cargar la biblioteca.', error);
      showNotice('No se pudo abrir la biblioteca. Vuelve a intentarlo.', { tone: 'alert' });
    }
  }

  // Sin suscripción del reproductor, se consulta cada 500 ms y solo se repinta la fila que cambia.
  function syncPlaying() {
    if (disposed || !state.loaded) return;
    const player = readPlayerState(services.player);
    for (const row of state.rows) {
      const now = player.playing && row.id === player.id;
      if (row.playing !== now) {
        row.playing = now;
        paintRow(row);
      }
    }
  }

  // ---- Eventos ----

  search.addEventListener('input', () => {
    state.query = search.value;
    applyView();
  });

  // Ctrl o Cmd+K enfoca la búsqueda (combinación, no tecla suelta; DESIGN 7.3).
  function onGlobalKey(event) {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
    if (String(event.key).toLowerCase() !== 'k' || sheetOpen) return;
    event.preventDefault();
    search.focus();
    search.select();
  }

  filterGroup.addEventListener('click', (event) => {
    const button = event.target.closest?.('button[data-filtro]');
    if (!button) return;
    state.filter = button.getAttribute('data-filtro');
    applyView();
  });

  thead.addEventListener('click', (event) => {
    const button = event.target.closest?.('button[data-orden]');
    if (!button) return;
    const key = button.getAttribute('data-orden');
    const direction = state.sort.key === key && state.sort.direction === 'asc' ? 'desc' : 'asc';
    state.sort = { key, direction };
    applyView();
  });

  headerCheckbox.addEventListener('change', () => {
    const ids = visibleIds();
    setSelection(headerCheckbox.checked ? selectVisible(state.selected, ids) : deselectVisible(state.selected, ids));
  });

  tbody.addEventListener('change', (event) => {
    const check = event.target.closest?.('input.c-biblioteca-casilla');
    const tr = event.target.closest?.('tr.c-biblioteca-fila');
    if (!check || !tr) return;
    const songId = tr.getAttribute('data-song-id');
    if (check.checked !== state.selected.has(songId)) toggleSelection(songId);
  });

  tbody.addEventListener('click', (event) => {
    const target = event.target;
    const tr = target.closest?.('tr.c-biblioteca-fila');
    if (!tr) return;
    const songId = tr.getAttribute('data-song-id');
    const radio = target.closest?.('button.c-biblioteca-fam');
    if (radio) {
      if (!radio.disabled) changeLinks([songId], { familiarity: Number(radio.getAttribute('data-valor')) });
      return;
    }
    const control = target.closest?.('[data-control]');
    if (control) {
      if (control.disabled) return;
      switch (control.getAttribute('data-control')) {
        case 'preferencia': openValueMenu(control, songId, 'preferencia'); return;
        case 'presentacion': openValueMenu(control, songId, 'presentacion'); return;
        case 'menu': openRowMenu(control, songId); return;
        case 'ficha': openPanelFor(songId); return;
        default: return;
      }
    }
    if (target.closest?.('input, button, label, a, select')) return;
    // Un clic en el texto de la fila la enfoca y abre su ficha.
    focusRow(songId);
    openPanelFor(songId);
  });

  table.addEventListener('focusin', (event) => {
    const tr = event.target.closest?.('tr.c-biblioteca-fila');
    if (tr) setRovingFocusRow(tr.getAttribute('data-song-id'));
  });

  table.addEventListener('keydown', (event) => {
    const key = event.key;
    const modified = event.ctrlKey || event.metaKey;
    // Ctrl o Cmd+A: selecciona las filas visibles.
    if (modified && !event.altKey && String(key).toLowerCase() === 'a') {
      event.preventDefault();
      setSelection(selectVisible(state.selected, visibleIds()));
      return;
    }
    const tr = event.target.closest?.('tr.c-biblioteca-fila');
    if (!tr) return;
    const songId = tr.getAttribute('data-song-id');
    // Dentro del grupo de familiaridad, las flechas izquierda y derecha pasan de un valor al siguiente.
    if (event.target.getAttribute?.('role') === 'radio' && (key === 'ArrowLeft' || key === 'ArrowRight')) {
      event.preventDefault();
      const radios = Array.from(event.target.parentElement.querySelectorAll('[role="radio"]'));
      const index = radios.indexOf(event.target);
      const step = key === 'ArrowRight' ? 1 : radios.length - 1;
      const next = radios[(index + step) % radios.length];
      next.focus();
      next.click();
      return;
    }
    // Las teclas de fila solo actúan cuando la fila tiene el foco, no sus controles.
    if (event.target !== tr || modified || event.altKey) return;
    const next = nextRowIndex(state.visible.findIndex((row) => row.id === songId), key, state.visible.length);
    if (next !== null) {
      event.preventDefault();
      focusRow(state.visible[next].id);
      return;
    }
    if (key === 'Enter') {
      event.preventDefault();
      openPanelFor(songId);
      return;
    }
    if (key === ' ' || key === 'Spacebar') {
      event.preventDefault();
      toggleSelection(songId);
      return;
    }
    // 1 a 5 fijan la familiaridad de la fila enfocada, solo con los atajos activados (DESIGN 7.4).
    if (/^[1-5]$/.test(key) && shortcutsEnabled()) {
      event.preventDefault();
      changeLinks([songId], { familiarity: Number(key) });
    }
  });

  famBulkButtons.forEach((button, index) => button.addEventListener('click', () => applyToSelection({ familiarity: index + 1 })));
  prefBulkButtons.forEach((button, index) => button.addEventListener('click', () => applyToSelection({ preference: PREFERENCES[index].value })));
  presBulkButtons.forEach((button, index) => button.addEventListener('click', () => applyToSelection({ presentation: PRESENTATIONS[index].code })));
  listSelect.addEventListener('change', updateBulk);
  listAddButton.addEventListener('click', addSelectionToList);
  removeBulkButton.addEventListener('click', () => removeFromProfile(selectedInOrder()));
  clearBulkButton.addEventListener('click', () => setSelection(new Set()));

  previewButton.addEventListener('click', startPreview);
  manageButton.addEventListener('click', openManagement);

  doc.addEventListener('keydown', onGlobalKey);
  pollTimer = globalThis.setInterval(syncPlaying, POLL_MS);

  load();

  return {
    unmount() {
      if (disposed) return;
      disposed = true;
      globalThis.clearInterval(pollTimer);
      doc.removeEventListener('keydown', onGlobalKey);
      phoneMedia?.removeEventListener?.('change', placeHeaderBox);
      closePopup(false);
      dismissNotice();
      headerBox.remove();
      section.remove();
    },
  };
}

/** Entrada de la ruta «biblioteca» (contrato 2.4). Cada módulo exporta su objeto routes. */
export const routes = Object.freeze({ biblioteca: mountLibrary });

/** Alias de mountLibrary con el nombre del contrato (mount(root, services, params)). */
export const mount = mountLibrary;
