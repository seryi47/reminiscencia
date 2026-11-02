// Pantalla «Perfiles» del modo cuidador (DESIGN C3 y C-15) y piezas compartidas por las pantallas de perfil:
// grupos de opciones excluyentes, interruptores, lista de canciones con casilla, diálogo modal y formato.
// Las funciones puras se exportan aparte y se prueban en tests/web-unit/cuidador-perfil.test.mjs.
// Ningún dato de usuario entra con innerHTML: todo se escribe con textContent o con createElement.

import { LIMITS } from '../schema.js';
import { validateAlias } from '../store.js';

// Ruta de esta pantalla (contrato 2.4). La función mount se exporta también con su nombre genérico.
export const routes = Object.freeze({ perfiles: mountProfiles });

// ---------------------------------------------------------------------------
// Textos y opciones compartidos (DESIGN C-5, C-6, C-7, 8.3 y D9).
// ---------------------------------------------------------------------------

// Anclas de familiaridad 1 a 5 (DESIGN C-5). El valor 0 significa «sin valorar».
export const FAMILIARITY_ANCHORS = Object.freeze([
  'No la reconoce', 'Le suena poco', 'Le suena algo', 'La reconoce', 'La reconoce bien',
]);

// Preferencia en tres niveles (DESIGN D9). El almacén admite de −2 a 2; esta interfaz usa −1, 0 y +1.
export const PREFERENCE_OPTIONS = Object.freeze([
  Object.freeze({ value: -1, text: 'No le gusta' }),
  Object.freeze({ value: 0, text: 'Le da igual' }),
  Object.freeze({ value: 1, text: 'Le gusta' }),
]);

// Presentación por asociación (DESIGN 8.3 y C-7). Cada asociación nueva empieza en C0.
export const PRESENTATION_OPTIONS = Object.freeze([
  Object.freeze({ value: 'C0', text: 'Solo canción', shortText: 'Solo canción' }),
  Object.freeze({ value: 'C1', text: 'Canción y recuerdo', shortText: 'Recuerdo' }),
  Object.freeze({ value: 'C2', text: 'Canción, foto y recuerdo', shortText: 'Foto y recuerdo' }),
]);

// Longitud máxima del código de participante (hasta 40 caracteres, schema.js).
export const PARTICIPANT_CODE_MAX = LIMITS.code;

// ---------------------------------------------------------------------------
// Funciones puras de formato y validación (sin DOM).
// ---------------------------------------------------------------------------

// Texto de la familiaridad: el ancla de 1 a 5, o «Sin valorar» para 0 y valores no válidos.
export function familiarityAnchor(level) {
  return Number.isInteger(level) && level >= 1 && level <= FAMILIARITY_ANCHORS.length
    ? FAMILIARITY_ANCHORS[level - 1]
    : 'Sin valorar';
}

// Texto de una preferencia (−1, 0 o +1); cadena vacía si el valor no está en la lista.
export function preferenceLabel(value) {
  return PREFERENCE_OPTIONS.find((option) => option.value === value)?.text ?? '';
}

// Presentación efectiva de una asociación: la guardada, o C0 si no hay ninguna (valor inicial, C-7).
export function presentationOf(link) {
  const code = link?.presentation;
  return PRESENTATION_OPTIONS.some((option) => option.value === code) ? code : 'C0';
}

// Texto completo de una presentación (C-7).
export function presentationText(code) {
  return PRESENTATION_OPTIONS.find((option) => option.value === code)?.text ?? '';
}

// Texto corto de una presentación (tabla del historial).
export function presentationShortText(code) {
  return PRESENTATION_OPTIONS.find((option) => option.value === code)?.shortText ?? '';
}

// Inicial del alias para el avatar. Cuenta caracteres, no unidades de código, para no partir letras compuestas.
export function profileInitial(alias) {
  const first = Array.from(String(alias ?? '').trim())[0];
  return first ? first.toLocaleUpperCase('es-ES') : '?';
}

// Plural simple: «1 recuerdo», «2 recuerdos».
export function countText(count, singular, plural) {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function songCountText(count) {
  return countText(count, 'canción asociada', 'canciones asociadas');
}

export function memoryCountText(count) {
  return countText(count, 'recuerdo', 'recuerdos');
}

// Última sesión: el inicio de sesión (session-start) más reciente del registro. Null si no hay ninguno.
export function lastSessionAt(events) {
  let latest = null;
  let latestTime = Number.NEGATIVE_INFINITY;
  for (const event of events ?? []) {
    if (event?.type !== 'session-start') continue;
    const time = Date.parse(event.at);
    if (Number.isFinite(time) && time > latestTime) {
      latest = event.at;
      latestTime = time;
    }
  }
  return latest;
}

// Fecha y hora breves en castellano («2 nov 2026, 18:30»). Cadena vacía si la marca no es válida.
export function formatDateTime(at) {
  const time = Date.parse(at);
  if (!Number.isFinite(time)) return '';
  return new Intl.DateTimeFormat('es-ES', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(new Date(time));
}

// Datos de una tarjeta de perfil (DESIGN C-15): canciones, recuerdos y última sesión.
export function profileFacts({ songCount = 0, memoryCount = 0, lastSession = null } = {}) {
  return [
    songCountText(songCount),
    memoryCountText(memoryCount),
    lastSession ? `Última sesión: ${formatDateTime(lastSession)}` : 'Sin sesiones todavía',
  ];
}

// Línea del código de participante en la tarjeta y en la cabecera del perfil.
export function profileCodeText(code) {
  return code ? `Código: ${code}` : 'Sin código de participante';
}

// Primer problema del código de participante (opcional, hasta 40 caracteres), o null si es válido.
export function participantCodeProblem(code) {
  if (typeof code !== 'string') return 'El código del participante debe ser texto.';
  if (Array.from(code.trim()).length > PARTICIPANT_CODE_MAX) {
    return `El código del participante no puede superar ${PARTICIPANT_CODE_MAX} caracteres.`;
  }
  return null;
}

// Primer problema del alias (reglas de schema.js, expuestas por store.js), o null si es válido.
export function aliasProblem(alias) {
  return validateAlias(alias)[0] ?? null;
}

// Texto del contador de canciones elegidas en el asistente y en los diálogos.
export function selectedSongsText(count) {
  return countText(count, 'seleccionada', 'seleccionadas');
}

// Mensaje de un error para el usuario. Los errores del almacén ya vienen en castellano.
export function messageOf(error, fallback = 'No se pudo completar la operación.') {
  return error instanceof Error && error.message ? error.message : fallback;
}

// Canciones del catálogo que todavía no están asociadas al perfil.
export function unassociatedSongs(songs = [], links = []) {
  const linked = new Set(links.map((link) => link.songId));
  return songs.filter((song) => !linked.has(song.id));
}

// Filas de la pestaña Canciones: una por asociación, ordenadas por título. Las asociaciones de canciones
// que ya no están en el catálogo se conservan al final, para no perder sus datos.
export function songRowsFor(links = [], songs = []) {
  const byId = new Map(songs.map((song) => [song.id, song]));
  return links
    .map((link) => {
      const song = byId.get(link.songId);
      return {
        songId: link.songId,
        title: song?.title || 'Canción no disponible en el catálogo',
        artist: song?.artist || '',
        known: Boolean(song),
        link,
      };
    })
    .sort((a, b) => (Number(b.known) - Number(a.known)) || a.title.localeCompare(b.title, 'es')
      || (a.songId < b.songId ? -1 : a.songId > b.songId ? 1 : 0));
}

// ---------------------------------------------------------------------------
// Utilidades de DOM compartidas. Los atributos null, undefined o false se omiten; true deja el atributo vacío.
// Las propiedades onX con función se registran como escuchas («click», «change»...).
// ---------------------------------------------------------------------------

export function el(tag, attributes = {}, ...children) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value === null || value === undefined || value === false) continue;
    if (name.startsWith('on') && typeof value === 'function') {
      node.addEventListener(name.slice(2).toLowerCase(), value);
    } else {
      node.setAttribute(name, value === true ? '' : String(value));
    }
  }
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

// Aviso de error con icono y texto (DESIGN C-11 y 1.4.1). Se oculta hasta que hay un mensaje.
// Con alert, el aviso se anuncia al aparecer (role="alert"); los avisos de campo no lo usan.
export function createErrorNode({ id = null, alert = true } = {}) {
  const text = el('span', { class: 'cp-error-texto' });
  const node = el('p', { class: 'cp-error', id, role: alert ? 'alert' : null },
    el('span', { class: 'cp-icono-error', 'aria-hidden': 'true' }, '!'), text);
  node.hidden = true;
  return {
    node,
    show(message) {
      text.textContent = message;
      node.hidden = false;
    },
    hide() {
      text.textContent = '';
      node.hidden = true;
    },
  };
}

let fieldCount = 0;

// Campo con etiqueta visible encima, ayuda opcional y aviso de error (DESIGN C-11).
// Devuelve el bloque y las piezas que hacen falta para marcar errores con setFieldError.
export function labeledField({ id, label, control, help = '', required = false }) {
  fieldCount += 1;
  const fieldId = id || `cp-campo-${fieldCount}`;
  control.id = fieldId;
  if (required) control.setAttribute('aria-required', 'true');
  const helpId = help ? `${fieldId}-ayuda` : null;
  if (helpId) control.setAttribute('aria-describedby', helpId);
  const error = createErrorNode({ id: `${fieldId}-error`, alert: false });
  const element = el('div', { class: 'cp-campo' },
    el('label', { class: 'cp-campo-etiqueta', for: fieldId },
      label, required ? el('span', { class: 'cp-obligatorio' }, ' (obligatorio)') : null),
    help ? el('p', { id: helpId, class: 'cp-campo-ayuda' }, help) : null,
    control,
    error.node);
  return { element, input: control, error, helpId };
}

// Marca un campo como válido o no válido y enlaza su aviso con aria-describedby (DESIGN C-11, 3.3.1).
export function setFieldError(field, message) {
  const { input, error, helpId } = field;
  if (message) {
    error.show(message);
    input.setAttribute('aria-invalid', 'true');
  } else {
    error.hide();
    input.removeAttribute('aria-invalid');
  }
  const ids = [helpId, message ? error.node.id : null].filter(Boolean);
  if (ids.length > 0) input.setAttribute('aria-describedby', ids.join(' '));
  else input.removeAttribute('aria-describedby');
}

const SVG_NS = 'http://www.w3.org/2000/svg';

// Comprobación de 12 px que marca la opción elegida, además del color (1.4.1). El trazo lo da el CSS.
function checkMark() {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('class', 'cp-marca');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', 'M5 12.5l4.5 4.5L19 7.5');
  svg.append(path);
  return svg;
}

let groupCount = 0;

// Grupo de opciones excluyentes con el patrón radiogroup (DESIGN C-5, C-6, C-7 y 7.3): un único punto de
// tabulación, flechas que eligen, Inicio y Fin. options: [{ value, text, name?, mark? }]. value null = ninguna.
// onChange(valor, anterior) se llama solo si el valor cambia.
export function createRadioGroup({ label, options, value = null, onChange = null, className = '' }) {
  groupCount += 1;
  let current = value;
  const buttons = [];
  const group = el('div', { class: `cp-opciones ${className}`.trim(), role: 'radiogroup', 'aria-label': label });

  const refresh = () => {
    const checkedIndex = options.findIndex((option) => option.value === current);
    buttons.forEach((button, index) => {
      const checked = index === checkedIndex;
      button.setAttribute('aria-checked', String(checked));
      // Sin selección, el primer botón es el punto de tabulación.
      button.tabIndex = checked || (checkedIndex === -1 && index === 0) ? 0 : -1;
    });
  };

  const choose = (index, { focus = false } = {}) => {
    const next = options[index].value;
    if (focus) buttons[index].focus();
    if (next === current) return;
    const previous = current;
    current = next;
    refresh();
    onChange?.(next, previous);
  };

  options.forEach((option, index) => {
    const children = [option.text];
    if (option.mark) children.push(checkMark());
    const button = el('button', {
      type: 'button',
      role: 'radio',
      class: option.mark ? 'cp-opcion cp-opcion--marca' : 'cp-opcion',
      'aria-label': option.name ?? null,
      'data-value': String(option.value),
    }, ...children);
    button.addEventListener('click', () => choose(index, { focus: true }));
    button.addEventListener('keydown', (event) => {
      const last = options.length - 1;
      let target = null;
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') target = index === last ? 0 : index + 1;
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') target = index === 0 ? last : index - 1;
      else if (event.key === 'Home') target = 0;
      else if (event.key === 'End') target = last;
      if (target === null) return;
      event.preventDefault();
      choose(target, { focus: true });
    });
    buttons.push(button);
    group.append(button);
  });
  refresh();

  return {
    element: group,
    getValue: () => current,
    // Cambia la selección sin avisar (sirve para deshacer tras un error al guardar).
    setValue(next) {
      current = next;
      refresh();
    },
    setDisabled(disabled) {
      for (const button of buttons) button.disabled = disabled;
    },
  };
}

// Texto del estado de un interruptor (DESIGN C-13).
export function switchStateText(on) {
  return on ? 'Activado' : 'Desactivado';
}

// Interruptor con etiqueta a la izquierda y estado escrito (DESIGN C-13). Área de 48 px de alto.
export function createSwitch({ label, checked = false, onChange = null, testid = '' }) {
  groupCount += 1;
  const labelId = `cp-interruptor-etiqueta-${groupCount}`;
  let on = Boolean(checked);
  const state = el('span', { class: 'cp-interruptor-estado' }, switchStateText(on));
  const button = el('button', {
    type: 'button',
    role: 'switch',
    class: 'cp-interruptor',
    'aria-labelledby': labelId,
    'aria-checked': String(on),
    'data-testid': testid || null,
  },
  el('span', { class: 'cp-interruptor-pista', 'aria-hidden': 'true' }, el('span', { class: 'cp-interruptor-pulgar' })),
  state);
  const element = el('div', { class: 'cp-fila-interruptor' },
    el('span', { id: labelId, class: 'cp-interruptor-etiqueta' }, label),
    button);
  const apply = (next) => {
    on = next;
    button.setAttribute('aria-checked', String(on));
    state.textContent = switchStateText(on);
  };
  button.addEventListener('click', () => {
    const next = !on;
    apply(next);
    onChange?.(next);
  });
  return {
    element,
    getChecked: () => on,
    setChecked(next) {
      apply(Boolean(next));
    },
  };
}

// Lista de canciones con casilla para la selección múltiple del catálogo. onChange(ids) tras cada cambio.
export function createSongChecklist(songs, { selectedIds = [], idPrefix = 'cp-cancion', onChange = null, testid = '' } = {}) {
  const selected = new Set(selectedIds);
  const list = el('ul', { class: 'cp-lista-seleccion', 'data-testid': testid || null });
  const selectedSongIds = () => inputs.filter((input) => input.checked).map((input) => input.value);
  const inputs = songs.map((song, index) => {
    const input = el('input', { type: 'checkbox', id: `${idPrefix}-${index}`, value: song.id });
    input.checked = selected.has(song.id);
    input.addEventListener('change', () => onChange?.(selectedSongIds()));
    const text = el('span', { class: 'cp-seleccion-texto' },
      el('span', { class: 'cp-seleccion-titulo' }, song.title || 'Canción sin título'),
      song.artist ? el('span', { class: 'cp-seleccion-artista' }, song.artist) : null);
    list.append(el('li', {}, el('label', { class: 'cp-fila-seleccion' }, input, text)));
    return input;
  });
  return {
    element: list,
    getSelected: selectedSongIds,
  };
}

const FOCUSABLE = 'button, input, select, textarea, a[href], [tabindex]';

// Mantiene el Tabulador dentro del diálogo: al salir por un extremo, vuelve por el otro.
function trapFocus(event, container) {
  const items = Array.from(container.querySelectorAll(FOCUSABLE))
    .filter((item) => !item.disabled && item.tabIndex >= 0 && !item.closest('[hidden]'));
  if (items.length === 0) return;
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;
  if (event.shiftKey && (active === first || !container.contains(active))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (active === last || !container.contains(active))) {
    event.preventDefault();
    first.focus();
  }
}

let dialogCount = 0;

// Diálogo modal (hoja inferior en pantallas estrechas, DESIGN C-16). build(cerrar) devuelve los nodos del cuerpo
// y del pie. La promesa se resuelve con el valor de cerrar(valor), o con cancelValue si se pulsa Escape o Cerrar.
// Al cerrar, el foco vuelve al elemento que tenía antes. initialFocus es un selector dentro del diálogo.
export function openDialog({ title, testid = '', build, cancelValue = null, initialFocus = null }) {
  dialogCount += 1;
  const titleId = `cp-dialogo-titulo-${dialogCount}`;
  const opener = document.activeElement;
  return new Promise((resolve) => {
    let settled = false;
    const overlay = el('div', { class: 'cp-capa' });
    const close = (value) => {
      if (settled) return;
      settled = true;
      overlay.remove();
      if (opener && opener.isConnected && typeof opener.focus === 'function') opener.focus();
      resolve(value);
    };
    const closeButton = el('button', { type: 'button', class: 'cp-boton cp-boton--secundario' }, 'Cerrar');
    closeButton.addEventListener('click', () => close(cancelValue));
    const heading = el('h2', { id: titleId, class: 'cp-dialogo-titulo', tabindex: '-1' }, title);
    const dialog = el('div', {
      class: 'cp-dialogo',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': titleId,
      'data-testid': testid || null,
    },
    el('span', { class: 'cp-asa', 'aria-hidden': 'true' }),
    el('div', { class: 'cp-dialogo-cabecera' }, heading, closeButton),
    build(close));
    overlay.append(dialog);
    overlay.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close(cancelValue);
      } else if (event.key === 'Tab') {
        trapFocus(event, dialog);
      }
    });
    document.body.append(overlay);
    const target = initialFocus ? dialog.querySelector(initialFocus) : null;
    (target ?? heading).focus();
  });
}

// ---------------------------------------------------------------------------
// Pantalla Perfiles (C3): tarjetas con alias, código, canciones, recuerdos y última sesión.
// ---------------------------------------------------------------------------

// Cifras de una tarjeta: canciones asociadas, recuerdos y última sesión (inicio de sesión del registro).
async function profileStats(store, profileId) {
  const [links, memories, events] = await Promise.all([
    store.listSongLinks(profileId),
    store.listMemories(profileId),
    store.listStudyEvents({ profileId }),
  ]);
  return { songCount: links.length, memoryCount: memories.length, lastSession: lastSessionAt(events) };
}

// Tarjeta de perfil de 264 × 132 px en escritorio y a ancho completo en teléfono (C-15).
function profileCard(profile, stats, active, handlers) {
  const titleId = `cp-perfil-titulo-${profile.id}`;
  const forProfile = el('span', { class: 'visually-hidden' }, ` de ${profile.alias}`);
  const actions = [
    el('button', {
      type: 'button', class: 'cp-boton cp-boton--primario', 'data-testid': 'c-profile-open',
      onclick: () => handlers.open(profile),
    }, 'Abrir perfil', forProfile),
    el('button', {
      type: 'button', class: 'cp-boton cp-boton--secundario', 'data-testid': 'c-profile-preview',
      onclick: () => handlers.preview(profile),
    }, 'Vista previa', el('span', { class: 'visually-hidden' }, ` de ${profile.alias}`)),
  ];
  if (!active) {
    actions.push(el('button', {
      type: 'button', class: 'cp-boton cp-boton--secundario', 'data-testid': 'c-profile-use',
      onclick: () => handlers.use(profile),
    }, 'Usar este perfil', el('span', { class: 'visually-hidden' }, ` ${profile.alias}`)));
  }
  return el('article', {
    class: active ? 'cp-tarjeta-perfil cp-tarjeta-perfil--activa' : 'cp-tarjeta-perfil',
    'data-testid': 'c-profile-card',
    'data-profile-id': profile.id,
    'aria-labelledby': titleId,
  },
  el('div', { class: 'cp-tarjeta-cabecera' },
    el('span', { class: 'cp-avatar', 'aria-hidden': 'true' }, profileInitial(profile.alias)),
    el('div', { class: 'cp-tarjeta-texto' },
      el('h2', { id: titleId, class: 'cp-tarjeta-alias' }, profile.alias),
      el('p', { class: 'cp-texto-meta' }, profileCodeText(profile.code)),
      active ? el('span', { class: 'cp-etiqueta-uso' }, 'En uso') : null)),
  el('ul', { class: 'cp-tarjeta-datos' }, ...profileFacts(stats).map((fact) => el('li', {}, fact))),
  el('div', { class: 'cp-tarjeta-acciones' }, ...actions));
}

// Pantalla «Perfiles». Cada tarjeta lleva «Abrir perfil», «Vista previa» y, si no está en uso, «Usar este perfil».
export function mountProfiles(root, services) {
  let alive = true;
  let generation = 0;
  services.setTitle?.('Perfiles');
  services.setActive?.('perfiles');

  // El H1 de la pantalla es el de la cabecera del marco (C-1); el título de la pantalla es un H2.
  const title = el('h2', { id: 'cp-titulo-perfiles', class: 'cp-titulo-pantalla', tabindex: '-1' }, 'Perfiles');
  const newButton = el('button', { type: 'button', class: 'cp-boton cp-boton--primario', 'data-testid': 'c-profile-new' },
    'Nuevo perfil');
  newButton.addEventListener('click', () => services.navigate('asistente'));
  const problem = createErrorNode({ id: 'cp-perfiles-error' });
  const empty = el('p', { class: 'cp-vacio', 'data-testid': 'c-perfiles-vacio' },
    'Todavía no hay perfiles. Crea el primero para empezar.');
  empty.hidden = true;
  const list = el('ul', { class: 'cp-cuadricula-perfiles', 'data-testid': 'c-perfiles' });
  root.replaceChildren(el('section', { class: 'cp-pantalla', 'aria-labelledby': 'cp-titulo-perfiles' },
    el('header', { class: 'cp-cabecera-pantalla' },
      el('div', { class: 'cp-cabecera-texto' },
        title,
        el('p', { class: 'cp-texto-ayuda' }, 'Cada perfil reúne las canciones, los recuerdos y el historial de una persona.')),
      newButton),
    problem.node,
    empty,
    list));

  // Ejecuta una acción del usuario y muestra su error en el aviso de la pantalla.
  const attempt = async (action) => {
    try {
      problem.hide();
      await action();
    } catch (error) {
      if (alive) problem.show(messageOf(error));
    }
  };

  // Dibuja una tarjeta por perfil. Descarta las respuestas que llegan tarde.
  async function render(focusProfileId = null) {
    const current = ++generation;
    const store = services.store;
    const [profiles, activeId] = await Promise.all([store.listProfiles(), store.getActiveProfileId()]);
    const stats = await Promise.all(profiles.map((profile) => profileStats(store, profile.id)));
    if (!alive || current !== generation) return;
    list.replaceChildren(...profiles.map((profile, index) => el('li', { class: 'cp-elemento-perfil' },
      profileCard(profile, stats[index], profile.id === activeId, handlers))));
    empty.hidden = profiles.length > 0;
    if (focusProfileId) {
      list.querySelector(`[data-profile-id="${focusProfileId}"] [data-testid="c-profile-open"]`)?.focus();
    }
  }

  const handlers = {
    open: (profile) => services.navigate('perfil', { profileId: profile.id, tab: 'canciones' }),
    preview: (profile) => attempt(() => services.startPreview(profile.id)),
    use: (profile) => attempt(async () => {
      await services.store.setActiveProfileId(profile.id);
      services.announce(`${profile.alias} queda en uso.`);
      await render(profile.id);
    }),
  };

  attempt(() => render());
  title.focus();

  return {
    unmount() {
      alive = false;
      root.replaceChildren();
    },
  };
}

// Nombre genérico de la pantalla, para los módulos que siguen la convención mount(root, services, params).
export const mount = mountProfiles;
