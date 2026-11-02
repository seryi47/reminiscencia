// Asistente de primer perfil (DESIGN C3e y C-26): tres pasos con el indicador «Paso N de 3».
// Paso 1: alias obligatorio y código de participante opcional. Paso 2: canciones iniciales (opcional).
// Paso 3: PIN recomendado y activado por defecto; «Ahora no» muestra el aviso y se puede seguir sin PIN.
// Al crear: perfil, asociaciones iniciales en C0, PIN si se eligió y, la primera vez, persistencia del almacenamiento.
// Las validaciones son funciones puras y se prueban en tests/web-unit/cuidador-perfil.test.mjs.

import {
  createErrorNode, createSongChecklist, el, labeledField, messageOf, PARTICIPANT_CODE_MAX, participantCodeProblem,
  aliasProblem, selectedSongsText, setFieldError,
} from './perfiles.js';
import { validatePin } from '../store.js';

// Ruta de este asistente (contrato 2.4).
export const routes = Object.freeze({ asistente: mountWizard });

export const WIZARD_STEPS = 3;

// Aviso que muestra «Ahora no» (DESIGN C-26), palabra por palabra.
export const NO_PIN_WARNING = 'Sin PIN, el paciente puede volver al modo cuidador sin código.';

// Aviso del registro del estudio que muestra el primer uso (DESIGN 8.4), palabra por palabra.
export const STUDY_NOTICE = 'Se guardan eventos de escucha en este navegador para el estudio. No se usan nombres reales.';

// ---------------------------------------------------------------------------
// Funciones puras (sin DOM).
// ---------------------------------------------------------------------------

// Paso siguiente o anterior, sin salirse del rango de 1 a WIZARD_STEPS.
export function stepAfter(step, delta) {
  return Math.min(WIZARD_STEPS, Math.max(1, step + delta));
}

// Texto del indicador de paso («Paso 1 de 3»).
export function stepIndicatorText(step) {
  return `Paso ${step} de ${WIZARD_STEPS}`;
}

// Texto del botón de avance: «Crear perfil» en el último paso.
export function nextLabelFor(step) {
  return step === WIZARD_STEPS ? 'Crear perfil' : 'Siguiente';
}

// Validación del paso 1: alias obligatorio y código opcional. Devuelve el problema de cada campo, o null.
export function validateStepOne({ alias = '', code = '' } = {}) {
  return {
    alias: aliasProblem(String(alias)),
    code: participantCodeProblem(String(code)),
  };
}

// Validación del paso 3. Con PIN ya configurado en el dispositivo, o con «Ahora no», no hace falta PIN.
// En otro caso, el PIN debe tener de 4 a 6 dígitos (validatePin de store.js). Devuelve el problema, o null.
export function validateStepThree({ pin = '', skipped = false, hasPin = false } = {}) {
  if (hasPin || skipped) return null;
  return validatePin(String(pin).trim());
}

// Datos que se envían al almacén para crear el perfil, sin espacios sobrantes.
export function profileInputFrom({ alias = '', code = '' } = {}) {
  return { alias: String(alias).trim(), code: String(code).trim() };
}

// Pide al navegador que no borre los datos del sitio (DESIGN 9 y D27). Devuelve true si lo concede.
// Sin soporte o sin permiso devuelve false y no lanza: la pantalla de Inicio avisa del riesgo.
export async function requestPersistence(storage = globalThis.navigator?.storage) {
  try {
    if (storage && typeof storage.persist === 'function') return await storage.persist();
  } catch {
    // Sin soporte o sin permiso: no hay nada más que hacer aquí.
  }
  return false;
}

// ---------------------------------------------------------------------------
// Pantalla del asistente.
// ---------------------------------------------------------------------------

// Asistente de primer perfil. Los campos se guardan en `state` al cambiar de paso, para no perderlos al volver atrás.
export function mountWizard(root, services) {
  let alive = true;
  let step = 1;
  let busy = false;
  let hasPin = false;
  let fields = {};
  const state = { alias: '', code: '', songIds: [], pin: '', pinSkipped: false };
  const songs = services.catalog?.songs ?? [];
  services.setTitle?.('Nuevo perfil');
  services.setActive?.('perfiles');

  // Si el dispositivo ya tiene PIN, el paso 3 no lo pide ni lo cambia. Se consulta antes de llegar a ese paso.
  const pinReady = services.store.hasPin()
    .then((value) => {
      hasPin = Boolean(value);
    })
    .catch(() => {
      hasPin = false;
    });

  // El H1 de la pantalla es el de la cabecera del marco (C-1); el título del asistente es un H2. Como el marco ya
  // muestra «Nuevo perfil», el H2 queda oculto a la vista (no se repite) pero sigue en el árbol de accesibilidad
  // y nombra la sección (aria-labelledby).
  const title = el('h2', { id: 'cp-titulo-asistente', class: 'cp-titulo-pantalla visually-hidden', tabindex: '-1' }, 'Nuevo perfil');
  const indicator = el('p', { class: 'cp-paso', 'data-testid': 'c-wizard-step', 'aria-live': 'polite' });
  const body = el('div', { class: 'cp-paso-cuerpo' });
  const problem = createErrorNode({ id: 'cp-asistente-error' });
  const cancel = el('button', {
    type: 'button', class: 'cp-boton cp-boton--secundario cp-boton--grande', 'data-testid': 'c-wizard-cancel',
  }, 'Cancelar');
  const back = el('button', {
    type: 'button', class: 'cp-boton cp-boton--secundario cp-boton--grande', 'data-testid': 'c-wizard-back',
  }, 'Atrás');
  const next = el('button', {
    type: 'submit', class: 'cp-boton cp-boton--primario cp-boton--grande', 'data-testid': 'c-wizard-next',
  }, 'Siguiente');
  cancel.addEventListener('click', () => services.navigate('perfiles'));
  back.addEventListener('click', () => {
    readFields();
    step = stepAfter(step, -1);
    renderStep(true);
  });
  const form = el('form', { class: 'cp-asistente-formulario', novalidate: true },
    body,
    problem.node,
    el('div', { class: 'cp-asistente-pie' }, cancel, back, next));
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!busy) advance();
  });
  root.replaceChildren(el('section', {
    class: 'cp-pantalla cp-asistente', 'aria-labelledby': 'cp-titulo-asistente', 'data-testid': 'c-wizard',
  }, title, indicator, form));

  // Copia los valores de los campos visibles a `state` antes de reconstruir el paso.
  function readFields() {
    if (fields.alias) state.alias = fields.alias.value;
    if (fields.code) state.code = fields.code.value;
    if (fields.checklist) state.songIds = fields.checklist.getSelected();
    if (fields.pin) state.pin = fields.pin.value;
  }

  // Paso 1: alias y código del participante.
  function stepOne() {
    const aliasInput = el('input', { type: 'text', autocomplete: 'off', spellcheck: 'false', 'data-testid': 'c-wizard-alias' });
    aliasInput.value = state.alias;
    const aliasField = labeledField({
      id: 'cp-asis-alias',
      label: 'Alias',
      control: aliasInput,
      required: true,
      help: 'Un nombre para reconocer el perfil. No hace falta el nombre real.',
    });
    const codeInput = el('input', { type: 'text', autocomplete: 'off', spellcheck: 'false', 'data-testid': 'c-wizard-code' });
    codeInput.value = state.code;
    const codeField = labeledField({
      id: 'cp-asis-codigo',
      label: 'Código de participante (opcional)',
      control: codeInput,
      help: `Por ejemplo, P-07. Hasta ${PARTICIPANT_CODE_MAX} caracteres.`,
    });
    fields = { alias: aliasInput, code: codeInput, aliasField, codeField };
    return [
      el('h2', { class: 'cp-subtitulo', tabindex: '-1' }, 'Datos del perfil'),
      aliasField.element,
      codeField.element,
    ];
  }

  // Paso 2: canciones iniciales, con selección múltiple del catálogo.
  function stepTwo() {
    const count = el('p', { class: 'cp-texto-ayuda', 'aria-live': 'polite', 'data-testid': 'c-wizard-count' },
      selectedSongsText(state.songIds.length));
    const checklist = createSongChecklist(songs, {
      selectedIds: state.songIds,
      idPrefix: 'cp-asis-cancion',
      testid: 'c-wizard-songs',
      onChange: (ids) => {
        state.songIds = ids;
        count.textContent = selectedSongsText(ids.length);
      },
    });
    fields = { checklist };
    return [
      el('h2', { class: 'cp-subtitulo', tabindex: '-1' }, 'Canciones iniciales'),
      el('p', { class: 'cp-texto-ayuda' },
        'Paso opcional. Cada canción empieza sin familiaridad y en «Solo canción». Puedes asociar más después.'),
      count,
      songs.length > 0
        ? checklist.element
        : el('p', { class: 'cp-texto-ayuda' }, 'El catálogo no tiene canciones todavía. Podrás asociarlas más tarde.'),
    ];
  }

  // Paso 3: PIN del modo cuidador y registro del estudio.
  function stepThree() {
    const heading = el('h2', { class: 'cp-subtitulo', tabindex: '-1' }, 'PIN del modo cuidador');
    const study = el('p', { class: 'cp-nota', 'data-testid': 'c-wizard-study-notice' }, STUDY_NOTICE);
    if (hasPin) {
      fields = {};
      return [
        heading,
        el('p', { class: 'cp-texto-ayuda' }, 'Este dispositivo ya tiene un PIN. Se conserva sin cambios.'),
        study,
      ];
    }
    const pinInput = el('input', {
      type: 'text', inputmode: 'numeric', autocomplete: 'off', spellcheck: 'false', 'data-testid': 'c-wizard-pin',
    });
    pinInput.value = state.pinSkipped ? '' : state.pin;
    const pinField = labeledField({
      id: 'cp-asis-pin',
      label: 'PIN de 4 a 6 dígitos',
      control: pinInput,
      help: 'Solo números. Evita salidas accidentales del modo paciente. No protege los datos si alguien tiene el dispositivo desbloqueado.',
    });
    pinField.element.hidden = state.pinSkipped;
    const notice = el('p', {
      class: 'cp-aviso', role: 'alert', tabindex: '-1', 'data-testid': 'c-wizard-pin-notice',
    }, NO_PIN_WARNING);
    notice.hidden = !state.pinSkipped;
    const skip = el('button', {
      type: 'button', class: 'cp-boton cp-boton--secundario', 'data-testid': 'c-wizard-skip-pin',
    }, 'Ahora no');
    skip.hidden = state.pinSkipped;
    const enable = el('button', {
      type: 'button', class: 'cp-boton cp-boton--secundario', 'data-testid': 'c-wizard-pin-enable',
    }, 'Configurar el PIN');
    enable.hidden = !state.pinSkipped;
    skip.addEventListener('click', () => {
      state.pinSkipped = true;
      state.pin = '';
      pinInput.value = '';
      setFieldError(pinField, null);
      pinField.element.hidden = true;
      skip.hidden = true;
      enable.hidden = false;
      notice.hidden = false;
      notice.focus();
    });
    enable.addEventListener('click', () => {
      state.pinSkipped = false;
      pinField.element.hidden = false;
      skip.hidden = false;
      enable.hidden = true;
      notice.hidden = true;
      pinInput.focus();
    });
    fields = { pin: pinInput, pinField };
    return [
      heading,
      pinField.element,
      el('div', { class: 'cp-acciones-pin' }, skip, enable),
      notice,
      study,
    ];
  }

  // Dibuja el paso actual. Con moved, el foco pasa al título del paso.
  function renderStep(moved = false) {
    body.replaceChildren(...(step === 1 ? stepOne() : step === 2 ? stepTwo() : stepThree()));
    indicator.textContent = stepIndicatorText(step);
    back.hidden = step === 1;
    cancel.hidden = step !== 1;
    next.textContent = nextLabelFor(step);
    problem.hide();
    if (moved) body.querySelector('h2')?.focus();
  }

  // Avanza un paso tras validarlo; en el último paso crea el perfil.
  async function advance() {
    readFields();
    if (step === 1) {
      const problems = validateStepOne(state);
      setFieldError(fields.aliasField, problems.alias);
      setFieldError(fields.codeField, problems.code);
      if (problems.alias || problems.code) {
        (problems.alias ? fields.aliasField.input : fields.codeField.input).focus();
        return;
      }
      step = 2;
      renderStep(true);
      return;
    }
    if (step === 2) {
      await pinReady;
      if (!alive) return;
      step = 3;
      renderStep(true);
      return;
    }
    await createProfile();
  }

  // Crea el perfil con sus asociaciones iniciales, el PIN y la persistencia. Los fallos posteriores a la creación
  // no deshacen el perfil: se anuncian y se entra al perfil, para no crear dos perfiles por un reintento.
  async function createProfile() {
    const stepOneProblems = validateStepOne(state);
    if (stepOneProblems.alias || stepOneProblems.code) {
      step = 1;
      renderStep(true);
      problem.show(stepOneProblems.alias ?? stepOneProblems.code);
      return;
    }
    const pinProblem = validateStepThree({ pin: state.pin, skipped: state.pinSkipped, hasPin });
    if (fields.pinField) setFieldError(fields.pinField, pinProblem);
    if (pinProblem) {
      problem.show(pinProblem);
      fields.pin?.focus();
      return;
    }
    problem.hide();
    busy = true;
    next.disabled = true;
    next.textContent = 'Creando perfil…';
    const warnings = [];
    try {
      const store = services.store;
      const isFirstProfile = (await store.listProfiles()).length === 0;
      const profile = await store.createProfile(profileInputFrom(state));
      let failedLinks = 0;
      for (const songId of state.songIds) {
        try {
          await store.setSongLink(profile.id, songId, {});
        } catch {
          failedLinks += 1;
        }
      }
      if (failedLinks > 0) warnings.push(`No se pudieron asociar ${failedLinks} canciones.`);
      try {
        await store.setActiveProfileId(profile.id);
      } catch (error) {
        warnings.push(`El perfil no quedó en uso. ${messageOf(error)}`);
      }
      const pin = state.pin.trim();
      if (!hasPin && !state.pinSkipped && pin !== '') {
        try {
          await store.setPin(pin);
        } catch (error) {
          warnings.push(`El PIN no se guardó. ${messageOf(error)}`);
        }
      }
      // No se espera: el navegador puede tardar en contestar (o no contestar mientras pide permiso) y la
      // creación no debe quedarse esperando por eso.
      if (isFirstProfile) requestPersistence();
      if (!alive) return;
      services.announce(['Perfil creado.', ...warnings].join(' '));
      services.navigate('perfil', { profileId: profile.id, tab: 'canciones' });
    } catch (error) {
      busy = false;
      next.disabled = false;
      next.textContent = nextLabelFor(step);
      if (alive) problem.show(messageOf(error));
    }
  }

  renderStep(false);
  title.focus();

  return {
    unmount() {
      alive = false;
      root.replaceChildren();
    },
  };
}

// Nombre genérico de la pantalla, para los módulos que siguen la convención mount(root, services, params).
export const mount = mountWizard;
