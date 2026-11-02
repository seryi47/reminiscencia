// Hoja «Empezar sesión» (DESIGN C4 y C-25; contrato 2.1 y 2.4). openSessionSheet(services, options) devuelve una
// Promise que se resuelve con true si la sesión empieza y con false si se cancela.
//
// Al empezar llama a services.enterPatientMode(perfilId, { session: { condition, startPoint, sleepMinutes } }) y
// después a services.player.setSleepTimer(minutos o null). No inicia el audio: el paciente pulsa Reproducir
// (DESIGN 8.1). La sesión de escucha la abre y la cierra app.js; aquí solo se pasan sus datos.
//
// Decisiones que el contrato deja abiertas:
// - Las condiciones usan los códigos de schema.js (STUDY_CONDITIONS): «segun-cancion» y «solo-audio».
// - El apagado por defecto sale de los ajustes del dispositivo (store.getSettings().sleepTimerMinutes).
// - El punto de inicio se codifica como «lista:<id>» o «carpeta:<id>»; vacío significa sin punto de inicio.

import { SLEEP_TIMER_MINUTES, STUDY_CONDITIONS } from '../schema.js';
import { openDialog } from './shell.js';

export const CONDITION_CHOICES = Object.freeze([
  Object.freeze({ value: 'segun-cancion', label: 'Según cada canción' }),
  Object.freeze({ value: 'solo-audio', label: 'Solo audio' }),
]);
export const SLEEP_CHOICES = Object.freeze([
  Object.freeze({ value: 'no', label: 'No', minutes: null }),
  Object.freeze({ value: '15', label: '15 minutos', minutes: 15 }),
  Object.freeze({ value: '30', label: '30 minutos', minutes: 30 }),
  Object.freeze({ value: '60', label: '60 minutos', minutes: 60 }),
]);

/** Minutos del apagado a partir de la opción elegida (null = sin apagado automático). */
export function sleepMinutesOf(choiceValue) {
  const choice = SLEEP_CHOICES.find((item) => item.value === String(choiceValue));
  return choice ? choice.minutes : null;
}

/** Opción de apagado que corresponde a un valor de ajustes (null o un número permitido). «No» si no encaja. */
export function sleepChoiceFor(minutes) {
  const match = SLEEP_CHOICES.find((item) => item.minutes === minutes);
  return match ? match.value : 'no';
}

/** Punto de inicio a partir del valor del campo: «lista:<id>», «carpeta:<id>» o vacío (null). */
export function parseStartPoint(value) {
  const text = String(value ?? '');
  if (text === '') return null;
  const separator = text.indexOf(':');
  if (separator < 1) return null;
  const type = text.slice(0, separator);
  const id = text.slice(separator + 1);
  if (!['lista', 'carpeta'].includes(type) || id === '') return null;
  return { type, id };
}

/** Valor del campo a partir de un punto de inicio (el inverso de parseStartPoint). */
export function startPointValue(startPoint) {
  if (!startPoint) return '';
  return `${startPoint.type}:${startPoint.id}`;
}

/** Opciones del campo «Punto de inicio»: listas del perfil y carpetas de la biblioteca, en dos grupos. */
export function startPointOptions(playlists = [], folders = []) {
  return {
    lists: playlists.map((list) => ({ value: startPointValue({ type: 'lista', id: list.id }), label: String(list.name || list.id) })),
    folders: folders.map((folder) => ({ value: startPointValue({ type: 'carpeta', id: folder.id }), label: String(folder.name || folder.id) })),
  };
}

/**
 * Petición de sesión que recibe enterPatientMode. Lanza un error en español si algún dato no es válido.
 * Devuelve { profileId, session: { condition, startPoint, sleepMinutes } }.
 */
export function buildSessionRequest({ profileId, condition, startPoint = null, sleepMinutes = null } = {}) {
  if (typeof profileId !== 'string' || profileId.trim() === '') throw new Error('Elige un perfil para empezar la sesión.');
  if (!STUDY_CONDITIONS.includes(condition)) throw new Error('La condición de la sesión no es válida.');
  if (startPoint !== null) {
    const valid = startPoint && ['lista', 'carpeta'].includes(startPoint.type) && typeof startPoint.id === 'string' && startPoint.id !== '';
    if (!valid) throw new Error('El punto de inicio no es válido.');
  }
  if (sleepMinutes !== null && !SLEEP_TIMER_MINUTES.includes(sleepMinutes)) {
    throw new Error('El apagado automático debe ser No, 15, 30 o 60 minutos.');
  }
  return {
    profileId,
    session: {
      condition,
      startPoint: startPoint ? { type: startPoint.type, id: startPoint.id } : null,
      sleepMinutes,
    },
  };
}

// Campo con etiqueta visible (C-11) y ayuda opcional (13/18).
function field(labelText, control, helpText) {
  const wrap = document.createElement('div');
  wrap.className = 'c-field';
  const label = document.createElement('label');
  label.className = 'c-label';
  label.htmlFor = control.id;
  label.textContent = labelText;
  wrap.append(label, control);
  if (helpText) {
    const help = document.createElement('p');
    help.className = 'c-help';
    help.id = `${control.id}-help`;
    help.textContent = helpText;
    control.setAttribute('aria-describedby', help.id);
    wrap.append(help);
  }
  return wrap;
}

// Grupo de opciones nativas (radio) con leyenda visible.
function radioGroup(name, legendText, choices, selectedValue) {
  const fieldset = document.createElement('fieldset');
  fieldset.className = 'c-fieldset';
  const legend = document.createElement('legend');
  legend.className = 'c-label';
  legend.textContent = legendText;
  fieldset.append(legend);
  const list = document.createElement('div');
  list.className = 'c-choices';
  for (const choice of choices) {
    const row = document.createElement('label');
    row.className = 'c-choice';
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = name;
    input.value = choice.value;
    input.checked = choice.value === selectedValue;
    const text = document.createElement('span');
    text.textContent = choice.label;
    row.append(input, text);
    list.append(row);
  }
  fieldset.append(list);
  return fieldset;
}

function checkedValue(root, name) {
  const input = root.querySelector(`input[name="${name}"]:checked`);
  return input ? input.value : null;
}

/**
 * Abre la hoja «Empezar sesión». options: { profileId } para fijar el perfil (si no, el activo).
 * Resuelve true si la sesión empieza, false si se cancela.
 */
export function openSessionSheet(services, options = {}) {
  return openDialog({
    title: 'Empezar sesión',
    className: 'c-sheet c-session-sheet',
    cancelValue: false,
    render: (body, close, dialog) => {
      dialog.dataset.testid = 'c-session-sheet';
      renderSheet(body, close, services, options);
    },
  });
}

async function renderSheet(body, close, services, options) {
  let profiles = [];
  let activeId = null;
  let settings = {};
  try {
    profiles = await services.store.listProfiles();
    activeId = await services.store.getActiveProfileId();
    settings = await services.store.getSettings();
  } catch (error) {
    console.error('Reminiscencia: no se pudieron leer los datos de la sesión.', error);
  }

  if (profiles.length === 0) {
    const text = document.createElement('p');
    text.className = 'c-help';
    text.textContent = 'Crea un perfil antes de abrir el modo paciente.';
    const actions = document.createElement('div');
    actions.className = 'c-dialog-actions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'c-btn c-btn--secondary';
    cancel.textContent = 'Cancelar';
    cancel.addEventListener('click', () => close(false));
    const create = document.createElement('button');
    create.type = 'button';
    create.className = 'c-btn c-btn--primary';
    create.textContent = 'Crear perfil';
    create.addEventListener('click', () => {
      close(false);
      services.navigate('perfiles');
    });
    actions.append(cancel, create);
    body.append(text, actions);
    // openDialog enfocó antes de que llegaran los datos: el foco se pone ahora en la acción principal.
    create.focus();
    return;
  }

  // Perfil (por defecto, el indicado o el activo).
  const profileSelect = document.createElement('select');
  profileSelect.id = 'c-session-profile';
  profileSelect.className = 'c-input';
  for (const profile of profiles) {
    const option = document.createElement('option');
    option.value = profile.id;
    option.textContent = profile.alias;
    profileSelect.append(option);
  }
  const initialProfile = profiles.some((profile) => profile.id === options.profileId)
    ? options.profileId
    : (profiles.some((profile) => profile.id === activeId) ? activeId : profiles[0].id);
  profileSelect.value = initialProfile;

  // Punto de inicio (opcional): listas del perfil y carpetas de la biblioteca.
  const startSelect = document.createElement('select');
  startSelect.id = 'c-session-start-point';
  startSelect.className = 'c-input';

  async function fillStartPoints(profileId) {
    let playlists = [];
    try {
      playlists = await services.store.listPlaylists(profileId);
    } catch (error) {
      console.error('Reminiscencia: no se pudieron leer las listas.', error);
    }
    const groups = startPointOptions(playlists, services.catalog?.folders ?? []);
    startSelect.replaceChildren();
    const none = document.createElement('option');
    none.value = '';
    none.textContent = 'Sin punto de inicio';
    startSelect.append(none);
    for (const [label, items] of [['Listas', groups.lists], ['Carpetas', groups.folders]]) {
      if (items.length === 0) continue;
      const group = document.createElement('optgroup');
      group.label = label;
      for (const item of items) {
        const option = document.createElement('option');
        option.value = item.value;
        option.textContent = item.label;
        group.append(option);
      }
      startSelect.append(group);
    }
  }
  await fillStartPoints(initialProfile);
  profileSelect.addEventListener('change', () => fillStartPoints(profileSelect.value));

  const conditionGroup = radioGroup('c-session-condition', 'Condición', CONDITION_CHOICES, 'segun-cancion');
  const sleepGroup = radioGroup('c-session-sleep', 'Apagado automático', SLEEP_CHOICES, sleepChoiceFor(settings.sleepTimerMinutes ?? null));

  const error = document.createElement('p');
  error.className = 'c-form-error';
  error.setAttribute('role', 'alert');

  const start = document.createElement('button');
  start.type = 'button';
  start.className = 'c-btn c-btn--primary';
  start.dataset.testid = 'c-session-start';
  start.textContent = 'Empezar';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'c-btn c-btn--secondary';
  cancel.textContent = 'Cancelar';
  cancel.addEventListener('click', () => close(false));

  start.addEventListener('click', async () => {
    let request;
    try {
      request = buildSessionRequest({
        profileId: profileSelect.value,
        condition: checkedValue(body, 'c-session-condition'),
        startPoint: parseStartPoint(startSelect.value),
        sleepMinutes: sleepMinutesOf(checkedValue(body, 'c-session-sleep')),
      });
    } catch (problem) {
      error.textContent = problem.message;
      return;
    }
    start.disabled = true;
    error.textContent = '';
    try {
      // Primero el modo y la sesión; después el temporizador. No se inicia el audio (DESIGN 8.1).
      await services.enterPatientMode(request.profileId, { session: request.session });
      services.player.setSleepTimer(request.session.sleepMinutes);
      close(true);
    } catch (problem) {
      start.disabled = false;
      error.textContent = problem instanceof Error ? problem.message : 'No se pudo empezar la sesión.';
    }
  });

  const profileField = field('Perfil', profileSelect);
  const startField = field('Punto de inicio (opcional)', startSelect, 'Si no eliges nada, la sesión empieza sin lista ni carpeta.');
  const actions = document.createElement('div');
  actions.className = 'c-dialog-actions';
  actions.append(cancel, start);
  body.append(profileField, startField, conditionGroup, sleepGroup, error, actions);
  // Mismo motivo que arriba: el primer campo recibe el foco cuando ya existe.
  profileSelect.focus();
}
