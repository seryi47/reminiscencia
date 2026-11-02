// Pantalla «Perfil» del modo cuidador (DESIGN C3a, C-14, C-24): alias y código editables, «Opciones del paciente»,
// vista previa y cinco pestañas. Canciones (familiaridad, preferencia y presentación) e Historial (escuchas por día,
// filtros y CSV) se implementan aquí. Recuerdos, Listas y Observaciones los monta otro módulo, que se carga al abrir
// su pestaña. Las funciones puras se exportan aparte y se prueban en tests/web-unit/cuidador-perfil.test.mjs.

import {
  aliasProblem, countText, createErrorNode, createRadioGroup, createSongChecklist, el, FAMILIARITY_ANCHORS,
  familiarityAnchor, formatDateTime, labeledField, messageOf, openDialog, PARTICIPANT_CODE_MAX,
  participantCodeProblem, PREFERENCE_OPTIONS, preferenceLabel, presentationOf, PRESENTATION_OPTIONS,
  presentationShortText, presentationText, selectedSongsText, setFieldError, songRowsFor, unassociatedSongs,
} from './perfiles.js';
import { openPatientOptions } from './opciones-paciente.js';
import { isCalendarDay } from '../schema.js';

// Ruta de esta pantalla (contrato 2.4): perfil/:profileId/:tab.
export const routes = Object.freeze({ perfil: mountProfile });

// Pestañas del perfil (DESIGN C-14), en el orden en que aparecen.
export const PROFILE_TABS = Object.freeze([
  Object.freeze({ id: 'canciones', text: 'Canciones' }),
  Object.freeze({ id: 'recuerdos', text: 'Recuerdos' }),
  Object.freeze({ id: 'listas', text: 'Listas' }),
  Object.freeze({ id: 'observaciones', text: 'Observaciones' }),
  Object.freeze({ id: 'historial', text: 'Historial' }),
]);

// Columnas de la tabla del historial (DESIGN C-24), en orden.
export const HISTORY_HEADERS = Object.freeze([
  'Hora', 'Canción', 'Escuchado', 'Final', 'Foto', 'Recuerdo', 'Presentación', 'Origen', 'Sesión',
]);

// Columnas del CSV del historial. Los nombres van sin tildes para que cualquier programa los lea igual.
export const HISTORY_CSV_HEADER = Object.freeze([
  'fecha', 'hora', 'evento', 'perfil', 'codigo_participante', 'cancion_id', 'cancion', 'segundos', 'porcentaje',
  'final', 'foto_mostrada', 'recuerdo_mostrado', 'presentacion', 'origen', 'condicion', 'sesion',
]);

const ORIGIN_TEXTS = Object.freeze({ lista: 'Lista', carpeta: 'Carpeta', busqueda: 'Búsqueda', continua: 'Continua' });

// ---------------------------------------------------------------------------
// Funciones puras (sin DOM).
// ---------------------------------------------------------------------------

// Pestaña válida de la ruta; si falta o no existe, la de Canciones.
export function resolveTab(tab) {
  return PROFILE_TABS.some((item) => item.id === tab) ? tab : 'canciones';
}

// Identificador corto de una sesión (ocho caracteres) para tablas y filtros.
export function shortId(id) {
  return String(id ?? '').slice(0, 8);
}

// Final de una escucha: completa, saltada o guion si no consta.
export function finalText(completed) {
  if (completed === true) return 'Completa';
  if (completed === false) return 'Saltada';
  return '—';
}

// Sí o no para fotografía y recuerdo mostrados.
export function yesNoText(flag) {
  return flag === true ? 'Sí' : 'No';
}

// Origen de la reproducción (lista, carpeta, búsqueda o continua).
export function originText(origin) {
  return Object.hasOwn(ORIGIN_TEXTS, origin) ? ORIGIN_TEXTS[origin] : '';
}

// Día AAAA-MM-DD con nombre en castellano («lunes, 2 de noviembre de 2026»). Se construye con fecha local
// para que la zona horaria no cambie el día. Si el texto no es una fecha, se devuelve tal cual.
export function historyDayHeading(day) {
  if (!isCalendarDay(day)) return String(day ?? '');
  const [year, month, date] = day.split('-').map(Number);
  return new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    .format(new Date(year, month - 1, date));
}

// Resumen de un día (DESIGN C-24): «14 escuchas · 42 minutos · 3 saltadas».
export function formatDaySummary({ listens = 0, minutes = 0, skipped = 0 } = {}) {
  return [
    countText(listens, 'escucha', 'escuchas'),
    countText(minutes, 'minuto', 'minutos'),
    countText(skipped, 'saltada', 'saltadas'),
  ].join(' · ');
}

// Días del historial listos para pintar: sin días vacíos, el más reciente primero, con encabezado y resumen.
export function prepareHistoryDays(groups = []) {
  return groups
    .filter((group) => group && Array.isArray(group.rows) && group.rows.length > 0)
    .sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0))
    .map((group) => ({
      day: group.day,
      heading: historyDayHeading(group.day),
      summary: formatDaySummary(group.summary),
      rows: group.rows,
    }));
}

// Celdas de una fila del historial, en el orden de HISTORY_HEADERS. titleOf(songId) da el título del catálogo.
export function historyRowCells(row, titleOf = () => '') {
  return [
    row.time ?? '',
    titleOf(row.songId) || 'Canción no disponible',
    typeof row.percent === 'number' ? `${row.percent} %` : '—',
    finalText(row.completed),
    yesNoText(row.photoShown),
    yesNoText(row.memoryShown),
    presentationShortText(row.presentation),
    originText(row.origin),
    shortId(row.sessionId),
  ];
}

// Opciones del filtro de sesión: una por sesión, con su inicio y un identificador corto; la más reciente primero.
export function historySessionOptions(events = []) {
  const sessions = new Map();
  for (const event of events) {
    if (typeof event?.sessionId !== 'string') continue;
    const time = Date.parse(event.at);
    if (!Number.isFinite(time)) continue;
    const known = sessions.get(event.sessionId);
    if (!known || time < known.time) sessions.set(event.sessionId, { time, at: event.at });
  }
  return [...sessions.entries()]
    .sort((a, b) => b[1].time - a[1].time)
    .map(([sessionId, info]) => ({ value: sessionId, text: `${formatDateTime(info.at)} · ${shortId(sessionId)}` }));
}

// Filtros del almacén a partir de los campos de la pantalla. Las fechas vacías no filtran.
// Devuelve { filters, error }; error describe el primer problema y filters es null entonces.
export function historyFilters({ profileId, from = '', to = '', sessionId = '', presentation = '' } = {}) {
  const filters = { profileId };
  if (from) {
    if (!isCalendarDay(from)) return { filters: null, error: 'La fecha inicial no es válida.' };
    filters.from = from;
  }
  if (to) {
    if (!isCalendarDay(to)) return { filters: null, error: 'La fecha final no es válida.' };
    filters.to = to;
  }
  if (filters.from && filters.to && filters.from > filters.to) {
    return { filters: null, error: 'La fecha inicial no puede ser posterior a la final.' };
  }
  if (sessionId) filters.sessionId = sessionId;
  if (presentation) filters.presentation = presentation;
  return { filters, error: null };
}

// Celda CSV con separador «;» (Excel en castellano). El texto que empieza por = + - @ o tabulador se neutraliza
// con una comilla simple, para que una hoja de cálculo no lo ejecute como fórmula. Las celdas con «;», comillas
// o saltos de línea van entre comillas.
export function csvCell(value) {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  if (/[";\r\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

const completedCsv = (completed) => (completed === true ? 'completa' : completed === false ? 'saltada' : '');
const flagCsv = (flag) => (flag === true ? 'sí' : flag === false ? 'no' : '');

// CSV del historial: una fila por escucha, con BOM UTF-8 para que Excel lo abra bien.
// options: { profileId, titleOf(songId), codeOf(idEvento) }. El alias del perfil no entra en la exportación.
export function buildHistoryCsv(groups = [], { profileId = '', titleOf = () => '', codeOf = () => '' } = {}) {
  const lines = [HISTORY_CSV_HEADER.join(';')];
  for (const group of groups) {
    for (const row of group.rows) {
      lines.push([
        group.day, row.time, row.id, profileId, codeOf(row.id), row.songId, titleOf(row.songId),
        row.seconds, row.percent, completedCsv(row.completed), flagCsv(row.photoShown), flagCsv(row.memoryShown),
        row.presentation, row.origin, row.condition, row.sessionId,
      ].map(csvCell).join(';'));
    }
  }
  return `﻿${lines.join('\r\n')}\r\n`;
}

// Nombre del archivo CSV: identificador de perfil y fecha. Nunca lleva el alias.
export function historyCsvFilename(profileId, date) {
  const safeId = String(profileId ?? '').replace(/[^A-Za-z0-9_-]/g, '_');
  return `reminiscencia-historial-${safeId}-${date}.csv`;
}

// Fecha local de hoy en formato AAAA-MM-DD (para el nombre del archivo).
export function isoDay(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// ---------------------------------------------------------------------------
// Utilidades de DOM de esta pantalla.
// ---------------------------------------------------------------------------

async function findProfile(store, profileId) {
  return (await store.listProfiles()).find((item) => item.id === profileId) ?? null;
}

// Campo sencillo con etiqueta visible encima (para los filtros del historial).
function labeled(text, control) {
  return el('div', { class: 'cp-campo' }, el('label', { class: 'cp-campo-etiqueta', for: control.id }, text), control);
}

// Descarga un texto como archivo CSV. El enlace temporal se quita al momento y la URL se libera después.
function downloadText(text, filename) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const link = el('a', { href: url, download: filename, hidden: true });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Diálogo para elegir canciones del catálogo que todavía no están en el perfil. Resuelve con sus identificadores.
function openSongPicker(songs) {
  return openDialog({
    title: 'Asociar canciones',
    testid: 'c-song-picker',
    initialFocus: 'input[type="checkbox"]',
    build: (close) => {
      const count = el('p', { class: 'cp-texto-ayuda', 'aria-live': 'polite' }, selectedSongsText(0));
      const checklist = createSongChecklist(songs, {
        idPrefix: 'cp-elegir',
        testid: 'c-song-picker-list',
        onChange: (ids) => {
          count.textContent = selectedSongsText(ids.length);
        },
      });
      const cancel = el('button', {
        type: 'button', class: 'cp-boton cp-boton--secundario', 'data-testid': 'c-song-picker-cancel',
      }, 'Cancelar');
      const confirm = el('button', {
        type: 'button', class: 'cp-boton cp-boton--primario', 'data-testid': 'c-song-picker-confirm',
      }, 'Asociar canciones');
      cancel.addEventListener('click', () => close(null));
      confirm.addEventListener('click', () => close(checklist.getSelected()));
      return [
        el('p', { class: 'cp-texto-ayuda' },
          'Elige las canciones del catálogo que quieres asociar. Empiezan sin familiaridad y en «Solo canción».'),
        count,
        checklist.element,
        el('div', { class: 'cp-dialogo-pie' }, cancel, confirm),
      ];
    },
  });
}

// ---------------------------------------------------------------------------
// Pestaña Canciones: familiaridad (C-5), preferencia (C-6) y presentación (C-7) de cada canción asociada.
// ---------------------------------------------------------------------------

function mountSongsPanel(host, services, profileId) {
  let alive = true;
  let generation = 0;
  const catalog = services.catalog?.songs ?? [];
  const heading = el('h2', { id: 'cp-canciones-titulo', class: 'cp-subtitulo', tabindex: '-1' }, 'Canciones asociadas');
  const associate = el('button', {
    type: 'button', class: 'cp-boton cp-boton--primario', 'data-testid': 'c-profile-associate',
  }, 'Asociar canciones');
  const problem = createErrorNode({ id: 'cp-canciones-error' });
  const empty = el('p', { class: 'cp-vacio' }, 'Este perfil todavía no tiene canciones. Asocia canciones para empezar.');
  empty.hidden = true;
  const list = el('ul', { class: 'cp-canciones', 'data-testid': 'c-profile-songs' });
  host.replaceChildren(el('section', { class: 'cp-seccion', 'aria-labelledby': 'cp-canciones-titulo' },
    el('header', { class: 'cp-cabecera-seccion' }, heading, associate),
    el('p', { class: 'cp-texto-ayuda' },
      'Familiaridad de 1 a 5, preferencia y presentación de cada canción. Los cambios se guardan al momento.'),
    problem.node,
    empty,
    list));

  // Ejecuta una acción del usuario y muestra su error en el aviso de la pestaña.
  const attempt = async (action) => {
    try {
      problem.hide();
      await action();
    } catch (error) {
      if (alive) problem.show(messageOf(error));
    }
  };

  // Guarda un cambio de una canción. Si falla, deshace el cambio en pantalla y explica el motivo.
  async function save(write, announcement, undo) {
    try {
      problem.hide();
      await write();
      services.announce(announcement);
    } catch (error) {
      undo();
      problem.show(`No se pudo guardar el cambio. ${messageOf(error)}`);
    }
  }

  // Fila de una canción con sus tres controles. Cada control guarda su propio valor al cambiar.
  function songItem(row) {
    const { songId: id, title, link } = row;
    const familiarityValue = link && link.familiarity > 0 ? link.familiarity : null;
    const note = el('span', { class: 'cp-nota-campo' },
      familiarityValue ? `${familiarityValue} · ${familiarityAnchor(familiarityValue)}` : 'Sin valorar');
    const familiarity = createRadioGroup({
      label: `Familiaridad de ${title}`,
      className: 'cp-opciones-escala',
      options: [1, 2, 3, 4, 5].map((level) => ({
        value: level, text: String(level), name: `${level}: ${FAMILIARITY_ANCHORS[level - 1]}`,
      })),
      value: familiarityValue,
      onChange: (next, previous) => {
        note.textContent = `${next} · ${familiarityAnchor(next)}`;
        save(
          () => services.store.setSongLink(profileId, id, { familiarity: next }),
          `Familiaridad de ${title}: ${next}.`,
          () => {
            familiarity.setValue(previous);
            note.textContent = previous ? `${previous} · ${familiarityAnchor(previous)}` : 'Sin valorar';
          },
        );
      },
    });
    const preferenceValue = link && PREFERENCE_OPTIONS.some((option) => option.value === link.preference)
      ? link.preference
      : 0;
    const preference = createRadioGroup({
      label: `Preferencia de ${title}`,
      options: PREFERENCE_OPTIONS.map((option) => ({ value: option.value, text: option.text, mark: true })),
      value: preferenceValue,
      onChange: (next, previous) => save(
        () => services.store.setSongLink(profileId, id, { preference: next }),
        `Preferencia de ${title}: ${preferenceLabel(next).toLowerCase()}.`,
        () => preference.setValue(previous),
      ),
    });
    const presentation = createRadioGroup({
      label: `Presentación de ${title}`,
      options: PRESENTATION_OPTIONS.map((option) => ({ value: option.value, text: option.text, mark: true })),
      value: presentationOf(link),
      onChange: (next, previous) => save(
        () => services.store.setSongLink(profileId, id, { presentation: next }),
        `Presentación de ${title}: ${presentationText(next).toLowerCase()}.`,
        () => presentation.setValue(previous),
      ),
    });
    return el('li', { class: 'cp-cancion', 'data-song-id': id },
      el('div', { class: 'cp-cancion-cabecera' },
        el('h3', { class: 'cp-cancion-titulo' }, title),
        row.artist ? el('p', { class: 'cp-texto-meta' }, row.artist) : null),
      el('div', { class: 'cp-cancion-controles' },
        el('div', { class: 'cp-campo-fila' },
          el('span', { class: 'cp-campo-etiqueta' }, 'Familiaridad'), note, familiarity.element),
        el('div', { class: 'cp-campo-fila' },
          el('span', { class: 'cp-campo-etiqueta' }, 'Preferencia'), preference.element),
        el('div', { class: 'cp-campo-fila' },
          el('span', { class: 'cp-campo-etiqueta' }, 'Presentación'), presentation.element)));
  }

  // Dibuja las asociaciones, ordenadas por título. Descarta las respuestas que llegan tarde.
  async function render() {
    const current = ++generation;
    const links = await services.store.listSongLinks(profileId);
    if (!alive || current !== generation) return;
    const rows = songRowsFor(links, catalog);
    heading.textContent = `Canciones asociadas (${rows.length})`;
    empty.hidden = rows.length > 0;
    list.replaceChildren(...rows.map(songItem));
  }

  associate.addEventListener('click', () => attempt(async () => {
    const links = await services.store.listSongLinks(profileId);
    const available = unassociatedSongs(catalog, links);
    if (available.length === 0) {
      services.announce('Todas las canciones del catálogo ya están asociadas.');
      return;
    }
    const chosen = await openSongPicker(available);
    if (!alive || !chosen || chosen.length === 0) return;
    // Las asociaciones nuevas empiezan con los valores por defecto del almacén (C0, sin familiaridad).
    for (const songId of chosen) await services.store.setSongLink(profileId, songId, {});
    services.announce(`${countText(chosen.length, 'canción asociada', 'canciones asociadas')}.`);
    await render();
    heading.focus();
  }));

  attempt(render);

  return {
    unmount() {
      alive = false;
      host.replaceChildren();
    },
  };
}

// ---------------------------------------------------------------------------
// Pestaña Historial (C-24): escuchas agrupadas por día, filtros y exportación CSV.
// ---------------------------------------------------------------------------

function mountHistoryPanel(host, services, profileId) {
  let alive = true;
  let generation = 0;
  const catalog = services.catalog?.songs ?? [];
  const titleById = new Map(catalog.map((song) => [song.id, song.title]));
  const titleOf = (songId) => titleById.get(songId) ?? '';
  const from = el('input', { type: 'date', id: 'cp-historial-desde', 'data-testid': 'c-historial-desde' });
  const to = el('input', { type: 'date', id: 'cp-historial-hasta', 'data-testid': 'c-historial-hasta' });
  const session = el('select', { id: 'cp-historial-sesion', 'data-testid': 'c-historial-sesion' },
    el('option', { value: '' }, 'Todas las sesiones'));
  const presentation = el('select', { id: 'cp-historial-presentacion', 'data-testid': 'c-historial-presentacion' },
    el('option', { value: '' }, 'Todas las presentaciones'),
    ...PRESENTATION_OPTIONS.map((option) => el('option', { value: option.value }, option.text)));
  const exportButton = el('button', {
    type: 'button', class: 'cp-boton cp-boton--secundario', 'data-testid': 'c-historial-csv',
  }, 'Exportar CSV');
  const problem = createErrorNode({ id: 'cp-historial-error' });
  const days = el('div', { class: 'cp-historial', 'data-testid': 'c-historial-dias' });
  const empty = el('p', { class: 'cp-vacio' }, 'No hay escuchas registradas con estos filtros.');
  empty.hidden = true;
  host.replaceChildren(el('section', { class: 'cp-seccion', 'aria-labelledby': 'cp-historial-titulo' },
    el('header', { class: 'cp-cabecera-seccion' },
      el('h2', { id: 'cp-historial-titulo', class: 'cp-subtitulo', tabindex: '-1' }, 'Historial de escuchas')),
    el('p', { class: 'cp-texto-ayuda' }, 'Cada fila es una escucha completa o saltada. Los datos se quedan en este navegador.'),
    el('div', { class: 'cp-filtros' },
      labeled('Desde', from),
      labeled('Hasta', to),
      labeled('Sesión', session),
      labeled('Presentación', presentation),
      exportButton),
    problem.node,
    empty,
    days));

  const attempt = async (action) => {
    try {
      problem.hide();
      await action();
    } catch (error) {
      if (alive) problem.show(messageOf(error));
    }
  };

  // Sesiones del perfil para el filtro. Se leen una vez al abrir la pestaña.
  async function loadSessions() {
    const events = await services.store.listStudyEvents({ profileId });
    if (!alive) return;
    const options = historySessionOptions(events);
    session.replaceChildren(el('option', { value: '' }, 'Todas las sesiones'),
      ...options.map((option) => el('option', { value: option.value }, option.text)));
  }

  // Dibuja las escuchas con los filtros actuales. Descarta las respuestas que llegan tarde.
  async function render() {
    const current = ++generation;
    const { filters: query, error } = historyFilters({
      profileId, from: from.value, to: to.value, sessionId: session.value, presentation: presentation.value,
    });
    if (error) {
      problem.show(error);
      return;
    }
    const groups = prepareHistoryDays(await services.store.listListeningHistory(query));
    if (!alive || current !== generation) return;
    days.replaceChildren(...groups.map(renderDay));
    empty.hidden = groups.length > 0;
  }

  // Un día: encabezado, resumen y tabla de escuchas (en teléfono, cada fila se lee como una tarjeta).
  function renderDay(group) {
    const headers = HISTORY_HEADERS.map((label) => el('th', { scope: 'col' }, label));
    const rows = group.rows.map((row) => el('tr', {},
      ...historyRowCells(row, titleOf).map((cell, index) => el('td', { 'data-etiqueta': HISTORY_HEADERS[index] }, cell))));
    return el('section', { class: 'cp-dia' },
      el('h3', { class: 'cp-dia-titulo' }, group.heading),
      el('p', { class: 'cp-dia-resumen' }, group.summary),
      el('div', { class: 'cp-tabla-envoltorio' },
        el('table', { class: 'cp-tabla' },
          el('caption', { class: 'visually-hidden' }, `Escuchas del ${group.heading}`),
          el('thead', {}, el('tr', {}, ...headers)),
          el('tbody', {}, ...rows))));
  }

  // Exporta las mismas escuchas que muestran los filtros. El código de participante se toma del registro del estudio,
  // tal como se guardó en cada evento.
  async function exportCsv() {
    const { filters: query, error } = historyFilters({
      profileId, from: from.value, to: to.value, sessionId: session.value, presentation: presentation.value,
    });
    if (error) {
      problem.show(error);
      return;
    }
    await attempt(async () => {
      const [groups, events] = await Promise.all([
        services.store.listListeningHistory(query),
        services.store.listStudyEvents(query),
      ]);
      const codes = new Map(events.map((event) => [event.id, event.participantCode ?? '']));
      const text = buildHistoryCsv(prepareHistoryDays(groups), {
        profileId,
        titleOf,
        codeOf: (eventId) => codes.get(eventId) ?? '',
      });
      downloadText(text, historyCsvFilename(profileId, isoDay()));
      services.announce('CSV del historial descargado.');
    });
  }

  [from, to, session, presentation].forEach((control) => {
    control.addEventListener('change', () => attempt(render));
  });
  exportButton.addEventListener('click', () => exportCsv());

  attempt(async () => {
    await loadSessions();
    await render();
  });

  return {
    unmount() {
      alive = false;
      host.replaceChildren();
    },
  };
}

// Monta el contenido de una pestaña. Recuerdos, listas y observaciones los escriben otros módulos. Se importan
// al abrir la pestaña, con los nombres exactos de cada módulo, y así esta pantalla carga aunque falten.
async function mountSection(id, host, services, profileId) {
  switch (id) {
    case 'canciones':
      return mountSongsPanel(host, services, profileId);
    case 'historial':
      return mountHistoryPanel(host, services, profileId);
    case 'recuerdos': {
      const { mountMemories } = await import('./recuerdos.js');
      return mountMemories(host, services, { profileId });
    }
    case 'listas': {
      const { mountProfileLists } = await import('./listas-perfil.js');
      return mountProfileLists(host, services, { profileId });
    }
    case 'observaciones': {
      const { mountObservations } = await import('./observaciones.js');
      return mountObservations(host, services, { profileId });
    }
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Pantalla Perfil: cabecera, pestañas y zona de eliminación.
// ---------------------------------------------------------------------------

// Pantalla de un perfil. params: { profileId, tab }. Las pestañas cambian en la misma pantalla, sin volver a montarla,
// para que el foco no salte al título en cada cambio.
export function mountProfile(root, services, params = {}) {
  let alive = true;
  let profile = null;
  let activeTab = resolveTab(params.tab);
  let panelMount = null;
  let panelGeneration = 0;
  const profileId = typeof params.profileId === 'string' ? params.profileId : '';

  const title = el('h1', { id: 'cp-titulo-perfil', tabindex: '-1' }, 'Perfil');
  const aliasInput = el('input', { type: 'text', autocomplete: 'off', spellcheck: 'false', 'data-testid': 'c-profile-alias' });
  const aliasField = labeledField({
    id: 'cp-perfil-alias',
    label: 'Alias',
    control: aliasInput,
    required: true,
    help: 'Un nombre para reconocer el perfil. No hace falta el nombre real.',
  });
  const codeInput = el('input', { type: 'text', autocomplete: 'off', spellcheck: 'false', 'data-testid': 'c-profile-code' });
  const codeField = labeledField({
    id: 'cp-perfil-codigo',
    label: 'Código de participante (opcional)',
    control: codeInput,
    help: `Hasta ${PARTICIPANT_CODE_MAX} caracteres.`,
  });
  const optionsButton = el('button', {
    type: 'button', class: 'cp-boton cp-boton--secundario', 'data-testid': 'c-profile-options',
  }, 'Opciones del paciente');
  const previewButton = el('button', {
    type: 'button', class: 'cp-boton cp-boton--secundario', 'data-testid': 'c-profile-preview',
  }, 'Vista previa');
  const deleteButton = el('button', {
    type: 'button', class: 'cp-boton cp-boton--peligro', 'data-testid': 'c-profile-delete',
  }, 'Eliminar perfil');
  const problem = createErrorNode({ id: 'cp-perfil-error' });

  const tabButtons = PROFILE_TABS.map((tab) => el('button', {
    type: 'button',
    role: 'tab',
    id: `cp-tab-${tab.id}`,
    class: 'cp-pestana',
    'aria-controls': 'cp-panel-perfil',
    'aria-selected': 'false',
    tabindex: '-1',
    'data-testid': `c-tab-${tab.id}`,
  }, tab.text));
  const tabList = el('div', {
    class: 'cp-pestanas', role: 'tablist', 'aria-label': 'Secciones del perfil', 'data-testid': 'c-profile-tabs',
  }, ...tabButtons);
  const panel = el('div', { id: 'cp-panel-perfil', class: 'cp-panel', role: 'tabpanel', tabindex: '0' });

  const header = el('header', { class: 'cp-cabecera-perfil' },
    el('div', { class: 'cp-cabecera-texto' }, title),
    el('div', { class: 'cp-acciones-cabecera' }, optionsButton, previewButton));
  const fieldsRow = el('div', { class: 'cp-campos-perfil' }, aliasField.element, codeField.element);
  const dangerZone = el('section', { class: 'cp-zona-peligro', 'aria-labelledby': 'cp-peligro-titulo' },
    el('h2', { id: 'cp-peligro-titulo', class: 'cp-subtitulo' }, 'Eliminar este perfil'),
    el('p', { class: 'cp-texto-ayuda' },
      'Borra el perfil con todo lo que guarda. El catálogo no cambia. Si quieres conservar el registro, exporta antes el CSV del historial.'),
    deleteButton);

  root.replaceChildren(el('section', { class: 'cp-pantalla cp-perfil', 'aria-labelledby': 'cp-titulo-perfil' },
    header,
    fieldsRow,
    problem.node,
    tabList,
    panel,
    dangerZone));

  const attempt = async (action) => {
    try {
      problem.hide();
      await action();
    } catch (error) {
      if (alive) problem.show(messageOf(error));
    }
  };

  // Texto del perfil en la cabecera, en la pestaña de título y en el título de la página.
  function fill() {
    const heading = `Perfil de ${profile.alias}`;
    title.textContent = heading;
    services.setTitle?.(heading);
    aliasInput.value = profile.alias;
    codeInput.value = profile.code ?? '';
  }

  // Guarda el alias al confirmar el campo (cambio, Intro). Un alias no válido muestra su motivo y no se guarda.
  async function saveAlias() {
    if (!profile) return;
    const alias = aliasInput.value.trim();
    const problemText = aliasProblem(alias);
    setFieldError(aliasField, problemText);
    if (problemText || alias === profile.alias) return;
    try {
      profile = await services.store.renameProfile(profile.id, alias);
      fill();
      services.announce(`Alias guardado: ${profile.alias}.`);
    } catch (error) {
      setFieldError(aliasField, messageOf(error));
    }
  }

  // Guarda el código del participante al confirmar el campo.
  async function saveCode() {
    if (!profile) return;
    const code = codeInput.value.trim();
    const problemText = participantCodeProblem(code);
    setFieldError(codeField, problemText);
    if (problemText || code === (profile.code ?? '')) return;
    try {
      profile = await services.store.updateProfile(profile.id, { code });
      services.announce('Código del participante guardado.');
    } catch (error) {
      setFieldError(codeField, messageOf(error));
    }
  }

  aliasInput.addEventListener('change', () => saveAlias());
  aliasInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      saveAlias();
    }
  });
  codeInput.addEventListener('change', () => saveCode());
  codeInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      saveCode();
    }
  });

  optionsButton.addEventListener('click', () => attempt(async () => {
    const saved = await openPatientOptions(services, profile.id);
    if (saved && alive) profile = saved;
  }));
  previewButton.addEventListener('click', () => attempt(() => services.startPreview(profile.id)));
  deleteButton.addEventListener('click', () => attempt(async () => {
    const confirmed = await services.confirm({
      title: '¿Eliminar este perfil?',
      body: 'Se borran el perfil, sus canciones asociadas, recuerdos, fotografías, listas, observaciones, historial y registro del estudio. El catálogo no cambia. No se puede deshacer.',
      confirmLabel: 'Eliminar perfil',
      cancelLabel: 'Cancelar',
      danger: true,
    });
    if (!confirmed || !alive) return;
    await services.store.deleteProfile(profile.id);
    services.announce('Perfil eliminado.');
    services.navigate('perfiles');
  }));

  // Marca la pestaña elegida y monta su contenido. Sin foco por defecto; el que pide el teclado lo pasa.
  function selectTab(id, { focus = false } = {}) {
    activeTab = id;
    tabButtons.forEach((button, index) => {
      const selected = PROFILE_TABS[index].id === id;
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
    });
    panel.setAttribute('aria-labelledby', `cp-tab-${id}`);
    if (focus) tabButtons[PROFILE_TABS.findIndex((tab) => tab.id === id)].focus();
    mountPanel(id);
  }

  tabButtons.forEach((button, index) => {
    button.addEventListener('click', () => selectTab(PROFILE_TABS[index].id, { focus: true }));
    button.addEventListener('keydown', (event) => {
      const last = PROFILE_TABS.length - 1;
      let target = null;
      if (event.key === 'ArrowRight') target = index === last ? 0 : index + 1;
      else if (event.key === 'ArrowLeft') target = index === 0 ? last : index - 1;
      else if (event.key === 'Home') target = 0;
      else if (event.key === 'End') target = last;
      if (target === null) return;
      event.preventDefault();
      selectTab(PROFILE_TABS[target].id, { focus: true });
    });
  });

  // Desmonta la pestaña anterior y monta la nueva en un contenedor propio. Si el usuario cambia de pestaña antes
  // de que termine, la carga que llega tarde se desmonta sola.
  async function mountPanel(id) {
    const current = ++panelGeneration;
    panelMount?.unmount?.();
    panelMount = null;
    const host = el('div', { class: 'cp-panel-contenido' }, el('p', { class: 'cp-texto-ayuda' }, 'Cargando…'));
    panel.replaceChildren(host);
    if (!profile) return;
    try {
      const handle = await mountSection(id, host, services, profile.id);
      if (!alive || current !== panelGeneration) {
        handle?.unmount?.();
        return;
      }
      panelMount = handle ?? null;
    } catch (error) {
      if (alive && current === panelGeneration) {
        const failure = createErrorNode({ alert: true });
        failure.show(messageOf(error, 'No se pudo abrir esta sección.'));
        host.replaceChildren(failure.node);
      }
    }
  }

  // Perfil que ya no existe (por ejemplo, borrado en otra pestaña): se muestra la salida a la lista.
  function showMissing() {
    title.textContent = 'Perfil no encontrado';
    services.setTitle?.('Perfil no encontrado');
    for (const element of [fieldsRow, tabList, dangerZone, optionsButton, previewButton]) element.hidden = true;
    problem.show('Este perfil ya no existe.');
    const back = el('button', { type: 'button', class: 'cp-boton cp-boton--primario', 'data-testid': 'c-profile-back' },
      'Volver a perfiles');
    back.addEventListener('click', () => services.navigate('perfiles'));
    panel.replaceChildren(back);
  }

  async function load() {
    try {
      profile = await findProfile(services.store, profileId);
      if (!alive) return;
      if (!profile) {
        showMissing();
        return;
      }
      fill();
      selectTab(activeTab);
    } catch (error) {
      if (alive) problem.show(messageOf(error));
    }
  }

  services.setActive?.('perfiles');
  services.setTitle?.('Perfil');
  panel.setAttribute('aria-labelledby', `cp-tab-${activeTab}`);
  load();
  title.focus();

  return {
    unmount() {
      alive = false;
      panelMount?.unmount?.();
      root.replaceChildren();
    },
  };
}

// Nombre genérico de la pantalla, para los módulos que siguen la convención mount(root, services, params).
export const mount = mountProfile;
