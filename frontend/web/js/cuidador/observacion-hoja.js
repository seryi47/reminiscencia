// Hoja «Nueva observación» (DESIGN C3d y 8.5, c-observation-sheet) y primitivas compartidas por las pantallas de
// contenido del perfil: creación de elementos sin innerHTML (h), campos con error (createField), hojas y diálogos
// modales (openSheet), contadores, búsqueda y operaciones sobre listas ordenadas.
// Las funciones que no tocan el DOM son puras: se prueban con node:test en tests/web-unit/cuidador-contenido.test.mjs.

// Etiquetas cerradas de la observación (DESIGN 8.5). El código es un identificador en inglés; el texto es lo que se lee.
export const OBSERVATION_TAGS = Object.freeze([
  Object.freeze({ code: 'recognizes', label: 'Reconoce la canción' }),
  Object.freeze({ code: 'sings', label: 'Canta o tararea' }),
  Object.freeze({ code: 'rhythm', label: 'Marca el ritmo' }),
  Object.freeze({ code: 'repeat', label: 'Pide que se repita' }),
  Object.freeze({ code: 'restless', label: 'Inquietud' }),
  Object.freeze({ code: 'calm', label: 'Tranquilidad' }),
  Object.freeze({ code: 'change', label: 'Pide cambiar de canción' }),
  Object.freeze({ code: 'other', label: 'Otra' }),
]);
export const OTHER_TAG_CODE = 'other';
export const OBSERVATION_LIMITS = Object.freeze({ note: 500, otherTag: 60 });

// Tolerancia de la fecha de una observación: un minuto por encima de la hora del equipo.
const FUTURE_TOLERANCE_MS = 60 * 1000;
// Caracteres de control no admitidos. En varias líneas se admiten tabulador, salto de línea y retorno.
const CONTROL_SINGLE_LINE = /[\u0000-\u001F\u007F]/;
const CONTROL_MULTI_LINE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
// Elementos que pueden recibir el foco dentro de una hoja.
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), '
  + 'select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

let sequence = 0;

// Identificador único para enlazar etiquetas, ayudas y errores (aria-describedby).
export function nextId(prefix) {
  sequence += 1;
  return `${prefix}-${sequence}`;
}

// Mensaje para la persona: el del error si lo tiene (los del almacén ya están en español), o el de respaldo.
export function messageOf(error, fallback) {
  return error instanceof Error && error.message ? error.message : fallback;
}

// Cuenta caracteres como el almacén: un emoji cuenta como uno.
export function charCount(text) {
  return Array.from(String(text ?? '')).length;
}

// Problema de un texto: null si es válido, o el mensaje en español. Se valida el texto sin espacios sobrantes.
export function textLengthError(value, {
  max, required = false, emptyMessage = 'Este campo no puede estar vacío.', tooLongMessage = null, multiline = false,
}) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text === '') return required ? emptyMessage : null;
  if (charCount(text) > max) return tooLongMessage ?? `No puede superar ${max} caracteres.`;
  const forbidden = multiline ? CONTROL_MULTI_LINE : CONTROL_SINGLE_LINE;
  return forbidden.test(text) ? 'El texto contiene caracteres no permitidos.' : null;
}

// «1 canción», «3 canciones»: un recuento con sus dos formas.
export function pluralize(count, one, many) {
  return `${count} ${count === 1 ? one : many}`;
}

// Orden de dos identificadores de texto (desempate estable en las listas).
export function compareIds(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

// Contador de un campo con límite (DESIGN C-12): nivel del límite y, desde el 90 %, lo que queda.
// text es «812 de 1000»; nearText es «Quedan 100 caracteres» o null; over indica que se ha superado el límite.
export function describeCounter(length, max) {
  const remaining = max - length;
  let nearText = null;
  if (remaining < 0) {
    nearText = remaining === -1 ? 'Sobra 1 carácter' : `Sobran ${-remaining} caracteres`;
  } else if (length >= max * 0.9) {
    if (remaining === 0) nearText = `Has llegado al máximo de ${max} caracteres`;
    else if (remaining === 1) nearText = 'Queda 1 carácter';
    else nearText = `Quedan ${remaining} caracteres`;
  }
  return { text: `${length} de ${max}`, nearText, over: remaining < 0 };
}

// Línea completa del contador para mostrar en un solo nodo: «900 de 1000 · Quedan 100 caracteres».
export function counterLine(length, max) {
  const info = describeCounter(length, max);
  return info.nearText ? `${info.text} · ${info.nearText}` : info.text;
}

// Texto para comparar sin distinguir mayúsculas ni tildes.
export function normalizeSearch(text) {
  return String(text ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

// ¿Contiene el texto todas las palabras de la búsqueda? Una búsqueda vacía coincide con cualquier texto.
export function matchesQuery(text, query) {
  const haystack = normalizeSearch(text);
  return normalizeSearch(query).split(/\s+/).filter(Boolean).every((word) => haystack.includes(word));
}

// Duración como «3:12». Cadena vacía si el valor no es un número válido.
export function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '';
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

// Mueve un elemento una posición (delta -1 o 1). Devuelve una copia; si el movimiento no cabe, la misma lista.
export function moveItem(list, index, delta) {
  const next = list.slice();
  const target = index + delta;
  if (index < 0 || index >= list.length || target < 0 || target >= list.length) return next;
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

// Quita el elemento de esa posición. Devuelve la lista nueva y lo quitado, para poder deshacerlo.
export function removeItemAt(list, index) {
  if (index < 0 || index >= list.length) return { list: list.slice(), removed: null };
  return { list: list.filter((_, position) => position !== index), removed: { item: list[index], index } };
}

// Inserta un elemento en esa posición (acotada a la lista). Devuelve una copia.
export function insertItemAt(list, index, item) {
  const next = list.slice();
  next.splice(Math.min(Math.max(index, 0), next.length), 0, item);
  return next;
}

// Crea un elemento. El texto entra con textContent y los atributos con setAttribute: nunca innerHTML.
// Claves especiales: text (texto), class (clase) y onXxx (escucha del evento xxx). value, checked, disabled,
// hidden y similares se asignan como propiedad, que es lo que el navegador refleja.
export function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'text') node.textContent = String(value);
    else if (key === 'class') node.className = String(value);
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'value') node.value = String(value);
    else if (value === true && key in node) node[key] = true;
    else if (value === true) node.setAttribute(key, '');
    else node.setAttribute(key, String(value));
  }
  for (const child of children.flat()) {
    if (child === undefined || child === null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

// Campo con etiqueta visible, ayuda, contador y error (DESIGN C-11 y C-12). El error se enlaza con aria-describedby
// y aria-invalid. control es el input o el textarea ya creado; counter es un nodo opcional con el contador.
export function createField({ label, control, help = null, counter = null, className = '' }) {
  const id = nextId('cc-campo');
  const helpId = help ? `${id}-ayuda` : null;
  const counterId = counter ? `${id}-contador` : null;
  const errorId = `${id}-error`;
  control.id = id;
  if (counter) counter.id = counterId;
  const helpNode = help ? h('p', { id: helpId, class: 'cc-campo-ayuda', text: help }) : null;
  const errorNode = h('p', { id: errorId, class: 'cc-campo-error', hidden: true });
  // La descripción del control enumera la ayuda, el contador y el error (si hay). Así lo lee un lector de pantalla.
  const syncDescribedBy = () => {
    const ids = [helpId, counterId, errorNode.hidden ? null : errorId].filter(Boolean);
    if (ids.length > 0) control.setAttribute('aria-describedby', ids.join(' '));
    else control.removeAttribute('aria-describedby');
  };
  const root = h('div', { class: `cc-campo ${className}`.trim() },
    h('label', { class: 'cc-campo-etiqueta', for: id, text: label }),
    control, helpNode, counter, errorNode);
  syncDescribedBy();
  return {
    root,
    control,
    setError(message) {
      errorNode.textContent = message ?? '';
      errorNode.hidden = !message;
      if (message) control.setAttribute('aria-invalid', 'true');
      else control.removeAttribute('aria-invalid');
      control.classList.toggle('cc-control-error', Boolean(message));
      syncDescribedBy();
    },
  };
}

// Elementos enfocables visibles dentro de un contenedor (los que cuelgan de un elemento [hidden] se descartan).
function focusableIn(container) {
  return [...container.querySelectorAll(FOCUSABLE)].filter((item) => !item.closest('[hidden]'));
}

// Hoja o diálogo modal (DESIGN C-16). build(close) devuelve { body, footer, initialFocus }; close(valor) cierra la hoja
// y resuelve la promesa con ese valor. Escape y el botón «Cerrar» resuelven cancelValue. La hoja atrapa el foco y,
// al cerrarse, lo devuelve al elemento que la abrió. Se monta al final de la página, fuera de la pantalla.
export function openSheet({ title, testid = null, className = '', cancelValue = null, build }) {
  return new Promise((resolve) => {
    const returnFocus = document.activeElement;
    const titleId = nextId('cc-hoja-titulo');
    let settled = false;
    let overlay = null;
    let dialog = null;

    function close(value) {
      if (settled) return;
      settled = true;
      document.removeEventListener('keydown', onKeydown, true);
      overlay?.remove();
      if (returnFocus instanceof HTMLElement && returnFocus.isConnected) returnFocus.focus();
      resolve(value);
    }

    // Escape cierra; Tab y Mayús+Tab dan la vuelta dentro de la hoja.
    function onKeydown(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        close(cancelValue);
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusableIn(dialog);
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      const inside = dialog.contains(active);
      if (event.shiftKey && (!inside || active === first)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (!inside || active === last)) {
        event.preventDefault();
        first.focus();
      }
    }

    const content = build(close);
    dialog = h('div', {
      class: `cc-hoja ${className}`.trim(),
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': titleId,
      'data-testid': testid,
    },
    h('div', { class: 'cc-hoja-cabecera' },
      h('h2', { id: titleId, class: 'cc-hoja-titulo', text: title }),
      h('button', { type: 'button', class: 'cc-boton cc-boton--secundario', text: 'Cerrar', onClick: () => close(cancelValue) })),
    h('div', { class: 'cc-hoja-cuerpo' }, content.body),
    content.footer ? h('div', { class: 'cc-hoja-pie' }, content.footer) : null);
    overlay = h('div', { class: 'cc-hoja-fondo' }, dialog);
    document.body.append(overlay);
    document.addEventListener('keydown', onKeydown, true);
    const initial = content.initialFocus ?? focusableIn(dialog)[0];
    initial?.focus();
  });
}

// Texto de una etiqueta de observación. «Otra» muestra el texto que escribió la persona, si lo hay.
export function observationTagLabel(code, otherText = '') {
  const tag = OBSERVATION_TAGS.find((item) => item.code === code);
  if (!tag) return null;
  const detail = String(otherText ?? '').trim();
  return code === OTHER_TAG_CODE && detail !== '' ? `Otra: ${detail}` : tag.label;
}

// Comprueba el formulario de la observación (DESIGN 8.5). Devuelve el problema de cada campo y el general.
// atMs: fecha y hora en milisegundos (o null si no es una fecha); tagCodes: etiquetas marcadas; otherText: texto de
// «Otra»; note: nota libre. Sin etiquetas ni nota no hay nada que guardar.
export function validateObservationDraft({ atMs, nowMs, tagCodes = [], otherText = '', note = '' }) {
  const fields = { at: null, tags: null, otherTag: null, note: null };
  if (!Number.isFinite(atMs)) fields.at = 'Escribe la fecha y la hora de la observación.';
  else if (atMs > nowMs + FUTURE_TOLERANCE_MS) fields.at = 'La fecha no puede ser posterior a este momento.';
  if (tagCodes.some((code) => !OBSERVATION_TAGS.some((tag) => tag.code === code))) {
    fields.tags = 'Hay una etiqueta que no existe.';
  }
  if (tagCodes.includes(OTHER_TAG_CODE)) {
    fields.otherTag = textLengthError(otherText, {
      max: OBSERVATION_LIMITS.otherTag,
      required: true,
      emptyMessage: 'Escribe el texto de la etiqueta «Otra».',
      tooLongMessage: `El texto de «Otra» no puede superar ${OBSERVATION_LIMITS.otherTag} caracteres.`,
    });
  }
  fields.note = textLengthError(note, {
    max: OBSERVATION_LIMITS.note,
    multiline: true,
    tooLongMessage: `La nota no puede superar ${OBSERVATION_LIMITS.note} caracteres.`,
  });
  const hasContent = tagCodes.length > 0 || String(note ?? '').trim() !== '';
  const form = hasContent ? null : 'Marca al menos una etiqueta o escribe una nota.';
  const valid = Object.values(fields).every((message) => message === null) && form === null;
  return { fields, form, valid };
}

// Valor de un campo datetime-local («AAAA-MM-DDTHH:MM», hora local) para una marca de tiempo.
export function toDateTimeLocalValue(ms) {
  const date = new Date(ms);
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    + `T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// Marca de tiempo (milisegundos) de un valor datetime-local, o null si no es una fecha y hora reales.
export function fromDateTimeLocalValue(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(String(value ?? ''));
  if (!match) return null;
  const [year, month, day, hours, minutes] = match.slice(1).map(Number);
  const date = new Date(year, month - 1, day, hours, minutes);
  const exact = date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
    && date.getHours() === hours && date.getMinutes() === minutes;
  return exact ? date.getTime() : null;
}

// Título de una canción del catálogo por su identificador («» si no existe).
function songTitleOf(services, songId) {
  return (services.catalog?.songs ?? []).find((song) => song.id === songId)?.title ?? '';
}

// Lee la canción que suena (services.player) o null si no hay ninguna pista cargada.
function playingTrack(services) {
  return services.player?.getState?.().track ?? null;
}

// Hoja «Nueva observación» (C3d, c-observation-sheet). Resuelve con la observación guardada o con null si se cierra.
// songId: canción a la que vincular. Si no se indica, se vincula la que suena, si hay alguna.
export function openObservationSheet(services, { profileId, songId = null } = {}) {
  const track = playingTrack(services);
  const linkedSongId = songId ?? track?.id ?? null;
  const linkedTitle = songId ? songTitleOf(services, songId) : (track?.title ?? '');
  const linkText = songId
    ? `Vincular a la canción «${linkedTitle || 'seleccionada'}»`
    : 'Vincular a la canción que suena';
  return openSheet({
    title: 'Nueva observación',
    testid: 'c-observation-sheet',
    className: 'cc-hoja-observacion',
    cancelValue: null,
    build: (close) => buildObservationForm(services, { profileId, linkedSongId, linkText, close }),
  });
}

// Contenido de la hoja: fecha y hora, canción, etiquetas, texto de «Otra», nota y acciones.
function buildObservationForm(services, { profileId, linkedSongId, linkText, close }) {
  const alertNode = h('div', { class: 'cc-alerta', role: 'alert', hidden: true });

  // Fecha y hora: por defecto, ahora (DESIGN 8.5).
  const dateInput = h('input', {
    type: 'datetime-local',
    class: 'cc-control',
    step: '60',
    required: true,
    value: toDateTimeLocalValue(Date.now()),
  });
  const dateField = createField({ label: 'Fecha y hora', control: dateInput, help: 'Por defecto, la hora actual.' });

  // Canción: casilla marcada si hay una canción a la que vincular; si no, una frase que lo explica.
  let linkBox = null;
  let linkNode;
  if (linkedSongId) {
    linkBox = h('input', { type: 'checkbox', checked: true });
    linkNode = h('label', { class: 'cc-casilla' }, linkBox, h('span', { text: linkText }));
  } else {
    linkNode = h('p', { class: 'cc-campo-ayuda', text: 'No suena ninguna canción: la observación se guarda sin canción.' });
  }

  // Ocho etiquetas cerradas como casillas grandes.
  const tagBoxes = OBSERVATION_TAGS.map((tag) => {
    const input = h('input', { type: 'checkbox', value: tag.code });
    return {
      code: tag.code,
      input,
      node: h('label', { class: 'cc-casilla cc-casilla-etiqueta' }, input, h('span', { text: tag.label })),
    };
  });
  const otherBox = tagBoxes.find((item) => item.code === OTHER_TAG_CODE).input;

  // El texto de «Otra» solo aparece si la etiqueta está marcada.
  const otherInput = h('input', { type: 'text', class: 'cc-control', autocomplete: 'off', enterkeyhint: 'done' });
  const otherField = createField({
    label: 'Texto de la etiqueta «Otra»',
    control: otherInput,
    help: `Hasta ${OBSERVATION_LIMITS.otherTag} caracteres.`,
  });
  otherField.root.hidden = true;
  otherBox.addEventListener('change', () => {
    otherField.root.hidden = !otherBox.checked;
    if (!otherBox.checked) otherField.setError(null);
  });

  // Nota libre con contador (hasta 500 caracteres).
  const counterNode = h('p', { class: 'cc-contador', text: counterLine(0, OBSERVATION_LIMITS.note) });
  const noteInput = h('textarea', { class: 'cc-control', rows: 4 });
  const noteField = createField({
    label: 'Nota (opcional)',
    control: noteInput,
    counter: counterNode,
    help: `Hasta ${OBSERVATION_LIMITS.note} caracteres.`,
  });
  noteInput.addEventListener('input', () => {
    counterNode.textContent = counterLine(charCount(noteInput.value), OBSERVATION_LIMITS.note);
    noteField.setError(null);
  });

  const cancelButton = h('button', {
    type: 'button',
    class: 'cc-boton cc-boton--secundario',
    text: 'Cancelar',
    onClick: () => close(null),
  });
  const saveButton = h('button', {
    type: 'button',
    class: 'cc-boton cc-boton--primario',
    'data-testid': 'c-observation-save',
    text: 'Guardar observación',
    onClick: () => save(),
  });

  // Muestra los problemas y lleva el foco al primer campo con error.
  function showProblems(check) {
    dateField.setError(check.fields.at);
    otherField.setError(check.fields.otherTag);
    noteField.setError(check.fields.note);
    alertNode.textContent = check.form ?? 'Revisa los campos marcados.';
    alertNode.hidden = false;
    if (check.fields.at) dateInput.focus();
    else if (check.fields.otherTag) otherInput.focus();
    else if (check.fields.note) noteInput.focus();
    else tagBoxes[0].input.focus();
  }

  async function save() {
    if (saveButton.disabled) return;
    alertNode.hidden = true;
    alertNode.textContent = '';
    dateField.setError(null);
    otherField.setError(null);
    noteField.setError(null);
    const tagCodes = tagBoxes.filter((item) => item.input.checked).map((item) => item.code);
    const otherText = otherInput.value.trim();
    const note = noteInput.value.trim();
    const check = validateObservationDraft({
      atMs: fromDateTimeLocalValue(dateInput.value),
      nowMs: Date.now(),
      tagCodes,
      otherText,
      note,
    });
    if (!check.valid) {
      showProblems(check);
      return;
    }
    saveButton.disabled = true;
    try {
      const record = await services.store.addObservation(profileId, {
        text: note,
        songId: linkBox?.checked ? linkedSongId : null,
        at: fromDateTimeLocalValue(dateInput.value),
        tags: tagCodes,
        otherTag: tagCodes.includes(OTHER_TAG_CODE) ? otherText : null,
      });
      services.announce?.('Observación guardada.');
      close(record);
    } catch (error) {
      alertNode.textContent = messageOf(error, 'No se pudo guardar la observación. Inténtalo de nuevo.');
      alertNode.hidden = false;
      saveButton.disabled = false;
    }
  }

  const body = [
    alertNode,
    dateField.root,
    linkNode,
    h('fieldset', { class: 'cc-grupo' },
      h('legend', { class: 'cc-campo-etiqueta', text: 'Etiquetas' }),
      h('div', { class: 'cc-etiquetas' }, tagBoxes.map((item) => item.node))),
    otherField.root,
    noteField.root,
  ];
  return { body, footer: [cancelButton, saveButton], initialFocus: dateInput };
}
