// Pantalla Ajustes del cuidador (DESIGN C5 y 9; contrato 2.3, 2.4 y 5). routes = { ajustes: mountSettings }.
// mountSettings(root, services) agrupa: apariencia y accesibilidad (prefs, en localStorage), dispositivo (ajustes
// de store en IndexedDB), PIN local, copia cifrada .rmc, almacenamiento y sin conexión, registro del estudio,
// borrado de todos los datos y ayuda.
//
// Decisiones que el contrato deja abiertas:
// - Cambiar o quitar el PIN exige el PIN actual (así el lock de 5 fallos también protege la gestión).
// - El registro del estudio se guarda como ajuste del dispositivo (studyRecording). store.js no admite ese
//   campo todavía: el cambio se revierte y se explica. Mientras tanto, el registro sigue activo (DESIGN 8.4).
// - La presentación por canción no está aquí: va en el panel de canción (panel.js).

import { validatePin } from '../schema.js';
import { clearOfflineLibrary, offlineStatus } from '../pwa.js';
import { formatBytes } from '../offline-core.js';
import { applyDisplayAttributes, openDialog } from './shell.js';
import { SLEEP_CHOICES } from './sesion.js';

// Igual que MIN_PASSPHRASE_LENGTH de crypto.js (DESIGN 9).
export const PASSPHRASE_MIN_LENGTH = 10;
export const REGISTRY_TEXT = 'Se guardan eventos de escucha en este navegador para el estudio. No se usan nombres reales.';
export const TEXT_SCALE_CHOICES = Object.freeze([
  Object.freeze({ value: '1', number: 1, label: 'Normal 1,00' }),
  Object.freeze({ value: '1.25', number: 1.25, label: 'Grande 1,25' }),
  Object.freeze({ value: '1.5', number: 1.5, label: 'Muy grande 1,50' }),
  Object.freeze({ value: '1.75', number: 1.75, label: 'Máximo 1,75' }),
]);
export const CONTRAST_CHOICES = Object.freeze([
  Object.freeze({ value: 'normal', label: 'Normal' }),
  Object.freeze({ value: 'alto', label: 'Alto' }),
]);
export const THEME_CHOICES = Object.freeze([
  Object.freeze({ value: 'auto', label: 'Automática (sigue al sistema)' }),
  Object.freeze({ value: 'claro', label: 'Clara' }),
  Object.freeze({ value: 'oscuro', label: 'Oscura' }),
]);
export const MOTION_CHOICES = Object.freeze([
  Object.freeze({ value: 'sistema', label: 'Según el sistema' }),
  Object.freeze({ value: 'si', label: 'Sí' }),
  Object.freeze({ value: 'no', label: 'No' }),
]);
export const SHORTCUT_CHOICES = Object.freeze([
  Object.freeze({ value: 'activados', label: 'Activados' }),
  Object.freeze({ value: 'desactivados', label: 'Desactivados' }),
]);

/** Mensaje si la contraseña de la copia no sirve (al menos 10 caracteres y repetida igual), o null. */
export function validatePassphrase(passphrase, repeat) {
  const length = typeof passphrase === 'string' ? Array.from(passphrase.normalize('NFC')).length : 0;
  if (length < PASSPHRASE_MIN_LENGTH) return `La contraseña de la copia debe tener al menos ${PASSPHRASE_MIN_LENGTH} caracteres.`;
  if (passphrase !== repeat) return 'Las dos contraseñas no coinciden.';
  return null;
}

/** Mensaje si el PIN nuevo no sirve (de 4 a 6 dígitos y repetido igual), o null. */
export function validateNewPin(pin, repeat) {
  const problem = validatePin(pin)[0];
  if (problem) return problem;
  if (pin !== repeat) return 'Los dos PIN no coinciden.';
  return null;
}

/** Segundos que faltan para que se levante el bloqueo del PIN (0 si no hay bloqueo). */
export function lockoutSecondsLeft(lockedUntil, now) {
  if (typeof lockedUntil !== 'number') return 0;
  return Math.max(0, Math.ceil((lockedUntil - now) / 1000));
}

/** Resumen de la vista previa de una copia: «3 perfiles, 42 recuerdos, 118 fotografías, 1204 eventos». */
export function previewSummary(preview) {
  const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;
  return [
    plural(preview.profiles ?? 0, 'perfil', 'perfiles'),
    plural(preview.memories ?? 0, 'recuerdo', 'recuerdos'),
    plural(preview.photos ?? 0, 'fotografía', 'fotografías'),
    plural(preview.studyEvents ?? 0, 'evento', 'eventos'),
  ].join(', ');
}

/** Nombre del fichero de copia: reminiscencia-copia-AAAA-MM-DD.rmc (día local, sin datos personales). */
export function backupFileName(date) {
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `reminiscencia-copia-${year}-${month}-${day}.rmc`;
}

/** Texto del estado de la biblioteca sin conexión. */
export function offlineText(status) {
  if (!status || status.count === 0) return 'No hay canciones guardadas para escuchar sin internet.';
  const songs = status.count === 1 ? '1 canción guardada' : `${status.count} canciones guardadas`;
  return `${songs} para escuchar sin internet, ${formatBytes(status.audioBytes)} de audio.`;
}

/** Valores de preferencias de pantalla que se aplican a la página (tokens.css), a partir de las prefs guardadas. */
export function scaleValueOf(textScale) {
  const choice = TEXT_SCALE_CHOICES.find((item) => item.number === Number(textScale));
  return choice ? choice.value : '1';
}

// ---------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------

function el(tag, className = '', text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

let controlSeq = 0;
function nextId(prefix) {
  controlSeq += 1;
  return `${prefix}-${controlSeq}`;
}

// Grupo de opciones nativas (radio) con leyenda visible.
function radioSet({ testid, legend, name, choices, value, onChange }) {
  const fieldset = el('fieldset', 'c-fieldset');
  if (testid) fieldset.dataset.testid = testid;
  fieldset.append(el('legend', 'c-label', legend));
  const list = el('div', 'c-choices');
  for (const choice of choices) {
    const row = el('label', 'c-choice');
    const input = el('input');
    input.type = 'radio';
    input.name = name;
    input.value = String(choice.value);
    input.checked = String(choice.value) === String(value);
    input.addEventListener('change', () => {
      if (input.checked) onChange(choice.value);
    });
    row.append(input, el('span', '', choice.label));
    list.append(row);
  }
  fieldset.append(list);
  return fieldset;
}

// Interruptor accesible (role switch) con el estado escrito: «Activado» o «Desactivado».
// onChange(valor) puede devolver una promesa; si falla, el interruptor vuelve a su estado y se llama a onError.
function switchControl({ label, checked, onChange, onError = () => {}, description = '' }) {
  const wrap = el('div', 'c-switch-row');
  const text = el('div', 'c-switch-text');
  const name = el('p', 'c-switch-label', label);
  name.id = nextId('c-switch-label');
  text.append(name);
  if (description) text.append(el('p', 'c-help', description));
  const button = el('button', 'c-switch');
  button.type = 'button';
  button.setAttribute('role', 'switch');
  button.setAttribute('aria-checked', String(checked));
  button.setAttribute('aria-labelledby', name.id);
  const state = el('span', 'c-switch-state', checked ? 'Activado' : 'Desactivado');
  const track = el('span', 'c-switch-track');
  track.setAttribute('aria-hidden', 'true');
  track.append(el('span', 'c-switch-thumb'));
  button.append(state, track);
  let current = checked;
  const setChecked = (value) => {
    current = value;
    button.setAttribute('aria-checked', String(value));
    state.textContent = value ? 'Activado' : 'Desactivado';
  };
  button.addEventListener('click', async () => {
    const next = !current;
    try {
      await onChange(next);
      setChecked(next);
    } catch (error) {
      setChecked(current);
      onError(error);
    }
  });
  wrap.append(text, button);
  return { element: wrap, setChecked };
}

function textField({ label, type = 'text', help = '', autocomplete = 'off', inputmode = '', maxlength = null }) {
  const wrap = el('div', 'c-field');
  const id = nextId('c-settings-field');
  const labelEl = el('label', 'c-label', label);
  labelEl.htmlFor = id;
  const input = el('input', 'c-input');
  input.id = id;
  input.type = type;
  input.autocomplete = autocomplete;
  if (inputmode) input.inputMode = inputmode;
  if (maxlength) input.maxLength = maxlength;
  wrap.append(labelEl, input);
  if (help) {
    const helpEl = el('p', 'c-help', help);
    helpEl.id = `${id}-help`;
    input.setAttribute('aria-describedby', helpEl.id);
    wrap.append(helpEl);
  }
  return { element: wrap, input };
}

function sectionBlock(title, testid = '') {
  const section = el('section', 'c-settings-section');
  if (testid) section.dataset.testid = testid;
  const heading = el('h2', 'c-section-title', title);
  heading.id = nextId('c-settings-heading');
  section.setAttribute('aria-labelledby', heading.id);
  section.append(heading);
  return section;
}

function button(label, variant = 'secondary') {
  const node = el('button', `c-btn c-btn--${variant}`, label);
  node.type = 'button';
  return node;
}

/** Monta Ajustes en root. Devuelve { unmount }. */
export function mountSettings(root, services) {
  let alive = true;
  const timers = [];
  services.setTitle?.('Ajustes');
  services.setActive?.('ajustes');

  const screen = el('section', 'c-screen c-settings');
  screen.dataset.testid = 'c-settings';
  root.replaceChildren(screen);

  const announce = (text) => services.announce?.(text);
  const showMessage = (node, text, { error = false } = {}) => {
    node.textContent = text;
    node.setAttribute('role', error ? 'alert' : 'status');
  };

  // ---- Apariencia y accesibilidad (prefs) ----
  const appearance = sectionBlock('Apariencia y accesibilidad', 'c-settings-appearance');
  const prefsValues = () => services.prefs.all();
  const setPref = (key, value) => {
    let saved;
    try {
      saved = services.prefs.set(key, value);
    } catch (error) {
      announce(error instanceof Error ? error.message : 'No se pudo guardar la preferencia.');
      return;
    }
    applyDisplayAttributes(prefsValues());
    // prefs.set devuelve false si el navegador no guarda nada: el valor vale solo mientras la página esté abierta.
    announce(saved ? 'Preferencia guardada.' : 'Preferencia aplicada. Este navegador no la guarda: valdrá solo mientras la página esté abierta.');
  };
  const current = prefsValues();
  appearance.append(
    radioSet({
      testid: 'c-settings-text-scale',
      legend: 'Tamaño del texto',
      name: 'c-pref-text-scale',
      choices: TEXT_SCALE_CHOICES.map((item) => ({ value: item.value, label: item.label })),
      value: scaleValueOf(current.textScale),
      onChange: (value) => setPref('textScale', Number(value)),
    }),
    radioSet({
      testid: 'c-settings-contrast',
      legend: 'Contraste',
      name: 'c-pref-contrast',
      choices: CONTRAST_CHOICES,
      value: current.contrast,
      onChange: (value) => setPref('contrast', value),
    }),
    radioSet({
      testid: 'c-settings-theme',
      legend: 'Apariencia',
      name: 'c-pref-theme',
      choices: THEME_CHOICES,
      value: current.theme,
      onChange: (value) => setPref('theme', value),
    }),
    radioSet({
      testid: 'c-settings-reduce-motion',
      legend: 'Reducir movimiento',
      name: 'c-pref-motion',
      choices: MOTION_CHOICES,
      value: current.reduceMotion,
      onChange: (value) => setPref('reduceMotion', value),
    }),
    radioSet({
      testid: '',
      legend: 'Atajos de una tecla',
      name: 'c-pref-shortcuts',
      choices: SHORTCUT_CHOICES,
      value: current.shortcuts,
      onChange: (value) => setPref('shortcuts', value),
    }),
  );
  const shortcutsHelp = el('p', 'c-help', 'Espacio, flechas y ↑ ↓ actúan solo con el foco dentro de la barra de reproducción o del panel. Desactívalos si chocan con otros programas.');
  appearance.append(shortcutsHelp);

  // ---- Dispositivo (store.getSettings y saveSettings) ----
  const device = sectionBlock('Dispositivo', 'c-settings-device');
  device.append(el('p', 'c-help', 'Estos ajustes valen solo para este dispositivo.'));
  const deviceHost = el('div', 'c-settings-device-host');
  device.append(deviceHost);

  // ---- PIN local ----
  const pinSection = sectionBlock('PIN local', 'c-settings-pin');
  const pinStatus = el('p', 'c-body');
  const pinLock = el('p', 'c-form-error');
  pinLock.hidden = true;
  const pinForm = el('form', 'c-pin-form');
  pinForm.noValidate = true;
  const currentPin = textField({ label: 'PIN actual', type: 'password', inputmode: 'numeric', autocomplete: 'current-password', maxlength: 6, help: 'De 4 a 6 dígitos.' });
  const newPin = textField({ label: 'Nuevo PIN', type: 'password', inputmode: 'numeric', autocomplete: 'new-password', maxlength: 6, help: 'De 4 a 6 dígitos. Puedes pegarlo.' });
  const repeatPin = textField({ label: 'Repetir el nuevo PIN', type: 'password', inputmode: 'numeric', autocomplete: 'new-password', maxlength: 6 });
  const showPin = el('label', 'c-check');
  const showPinInput = el('input');
  showPinInput.type = 'checkbox';
  showPin.append(showPinInput, el('span', '', 'Mostrar los dígitos'));
  showPinInput.addEventListener('change', () => {
    const type = showPinInput.checked ? 'text' : 'password';
    for (const field of [currentPin, newPin, repeatPin]) field.input.type = type;
  });
  const pinMessage = el('p', 'c-form-error');
  pinMessage.setAttribute('role', 'alert');
  const pinSave = button('Guardar PIN', 'primary');
  pinSave.type = 'submit';
  const pinRemove = button('Quitar PIN', 'danger');
  const pinActions = el('div', 'c-dialog-actions');
  pinActions.append(pinSave, pinRemove);
  pinForm.append(currentPin.element, newPin.element, repeatPin.element, showPin, pinMessage, pinActions);
  pinSection.append(pinStatus, pinLock, pinForm);

  let hasPin = false;
  let lockedUntil = null;
  // La cuenta atrás del bloqueo tiene su propia lista de temporizadores, separada de las demás.
  const lockTimers = [];
  const stopLockTimer = () => {
    for (const timer of lockTimers.splice(0)) clearInterval(timer);
  };

  async function refreshPin() {
    stopLockTimer();
    try {
      hasPin = await services.store.hasPin();
      const lockout = await services.store.getPinLockout();
      lockedUntil = lockout.lockedUntil;
    } catch (error) {
      console.error('Reminiscencia: no se pudo leer el PIN.', error);
      hasPin = false;
      lockedUntil = null;
    }
    pinStatus.textContent = hasPin
      ? 'Hay un PIN. Evita salidas accidentales del modo paciente.'
      : 'No hay PIN. Sin PIN, el paciente puede volver al modo cuidador sin código.';
    pinSave.textContent = hasPin ? 'Cambiar PIN' : 'Crear PIN';
    pinRemove.hidden = !hasPin;
    currentPin.element.hidden = !hasPin;
    pinSave.disabled = false;
    if (lockedUntil !== null && lockedUntil > Date.now()) startLockCountdown();
    else clearLock();
  }

  function clearLock() {
    pinLock.hidden = true;
    pinLock.textContent = '';
    pinSave.disabled = false;
    pinRemove.disabled = false;
  }

  function startLockCountdown() {
    const update = () => {
      const seconds = lockoutSecondsLeft(lockedUntil, Date.now());
      if (seconds <= 0) {
        stopLockTimer();
        refreshPin();
        return;
      }
      // Cuenta atrás escrita: el texto cambia cada segundo, pero no se anuncia (no es una región en vivo).
      pinLock.hidden = false;
      pinLock.textContent = `Demasiados intentos. Vuelve a intentarlo en ${seconds} s.`;
      pinSave.disabled = true;
      pinRemove.disabled = true;
    };
    update();
    lockTimers.push(setInterval(update, 1000));
  }

  async function checkCurrentPin() {
    const value = currentPin.input.value;
    if (validatePin(value).length > 0) return 'Escribe el PIN actual de 4 a 6 dígitos.';
    const ok = await services.store.checkPin(value);
    await services.store.registerPinAttempt(ok);
    if (!ok) {
      const lockout = await services.store.getPinLockout();
      lockedUntil = lockout.lockedUntil;
      if (lockedUntil !== null && lockedUntil > Date.now()) startLockCountdown();
      return 'El PIN actual no es correcto.';
    }
    return null;
  }

  pinForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    showMessage(pinMessage, '');
    try {
      if (hasPin) {
        const problem = await checkCurrentPin();
        if (problem) {
          showMessage(pinMessage, problem, { error: true });
          return;
        }
      }
      const problem = validateNewPin(newPin.input.value, repeatPin.input.value);
      if (problem) {
        showMessage(pinMessage, problem, { error: true });
        return;
      }
      await services.store.setPin(newPin.input.value);
      newPin.input.value = '';
      repeatPin.input.value = '';
      currentPin.input.value = '';
      showMessage(pinMessage, 'PIN guardado.');
      announce('PIN guardado.');
      await refreshPin();
    } catch (error) {
      showMessage(pinMessage, error instanceof Error ? error.message : 'No se pudo guardar el PIN.', { error: true });
    }
  });

  pinRemove.addEventListener('click', async () => {
    showMessage(pinMessage, '');
    const problem = await checkCurrentPin().catch((error) => (error instanceof Error ? error.message : 'No se pudo comprobar el PIN.'));
    if (problem) {
      showMessage(pinMessage, problem, { error: true });
      return;
    }
    const confirmed = await services.confirm({
      title: 'Quitar el PIN',
      body: 'El paciente podrá volver al modo cuidador sin código. Los datos se conservan.',
      confirmLabel: 'Quitar PIN',
      cancelLabel: 'Cancelar',
      danger: true,
    });
    if (!confirmed) return;
    try {
      await services.store.removePin();
      currentPin.input.value = '';
      showMessage(pinMessage, 'PIN quitado. Los datos se conservan.');
      announce('PIN quitado.');
      await refreshPin();
    } catch (error) {
      showMessage(pinMessage, error instanceof Error ? error.message : 'No se pudo quitar el PIN.', { error: true });
    }
  });

  // ---- Copia cifrada (.rmc) ----
  const backup = sectionBlock('Copia cifrada (.rmc)', 'c-settings-backup');
  backup.append(el('p', 'c-help', 'La copia incluye perfiles, asociaciones, listas, recuerdos, fotografías, observaciones, historial y registro del estudio. No incluye el PIN ni el audio. Está cifrada con la contraseña que elijas: sin ella no hay recuperación.'));
  const lastBackup = el('p', 'c-body');
  backup.append(lastBackup);

  backup.append(el('h3', 'c-panel-subtitle', 'Exportar'));
  const exportPass = textField({ label: 'Contraseña de la copia', type: 'password', autocomplete: 'new-password', help: `Al menos ${PASSPHRASE_MIN_LENGTH} caracteres.` });
  const exportRepeat = textField({ label: 'Repetir la contraseña', type: 'password', autocomplete: 'new-password' });
  const exportMessage = el('p', 'c-form-error');
  const exportBtn = button('Exportar copia (.rmc)', 'primary');
  backup.append(exportPass.element, exportRepeat.element, exportMessage, exportBtn);

  backup.append(el('h3', 'c-panel-subtitle', 'Importar'));
  const importFile = el('input', 'c-file');
  importFile.type = 'file';
  importFile.accept = '.rmc,application/json';
  importFile.id = nextId('c-import-file');
  const importLabel = el('label', 'c-label', 'Copia para importar');
  importLabel.htmlFor = importFile.id;
  const importPass = textField({ label: 'Contraseña de esa copia', type: 'password', autocomplete: 'off' });
  const importMessage = el('p', 'c-form-error');
  const reviewBtn = button('Revisar copia');
  const previewBox = el('div', 'c-preview-box');
  previewBox.hidden = true;
  const mode = radioSet({
    testid: '',
    legend: 'Forma de importar',
    name: 'c-import-mode',
    choices: [
      { value: 'merge', label: 'Combinar con los datos actuales' },
      { value: 'replace', label: 'Sustituir los datos actuales' },
    ],
    value: 'merge',
    onChange: () => {},
  });
  const importBtn = button('Importar copia', 'primary');
  importBtn.disabled = true;
  previewBox.append(mode, importBtn);
  backup.append(importLabel, importFile, importPass.element, reviewBtn, importMessage, previewBox);

  let exportedAt = null;
  let reviewedFile = null;
  let reviewedPass = '';

  async function refreshBackupInfo() {
    try {
      const at = await services.store.getLastBackupAt();
      exportedAt = at;
    } catch {
      exportedAt = null;
    }
    lastBackup.textContent = exportedAt
      ? `Última copia: ${new Date(exportedAt).toLocaleDateString('es-ES')}.`
      : 'Todavía no se ha hecho ninguna copia.';
  }

  exportBtn.addEventListener('click', async () => {
    showMessage(exportMessage, '');
    const problem = validatePassphrase(exportPass.input.value, exportRepeat.input.value);
    if (problem) {
      showMessage(exportMessage, problem, { error: true });
      return;
    }
    exportBtn.disabled = true;
    try {
      const file = await services.store.exportBackup(exportPass.input.value);
      const url = URL.createObjectURL(file);
      const link = el('a');
      link.href = url;
      link.download = backupFileName(new Date());
      document.body.append(link);
      link.click();
      link.remove();
      timers.push(setTimeout(() => URL.revokeObjectURL(url), 10000));
      exportPass.input.value = '';
      exportRepeat.input.value = '';
      showMessage(exportMessage, 'Copia lista. Guárdala junto con su contraseña.');
      announce('Copia lista.');
      await refreshBackupInfo();
    } catch (error) {
      showMessage(exportMessage, error instanceof Error ? error.message : 'No se pudo crear la copia.', { error: true });
    } finally {
      exportBtn.disabled = false;
    }
  });

  reviewBtn.addEventListener('click', async () => {
    showMessage(importMessage, '');
    reviewedFile = importFile.files?.[0] ?? null;
    reviewedPass = importPass.input.value;
    previewBox.hidden = true;
    importBtn.disabled = true;
    if (!reviewedFile) {
      showMessage(importMessage, 'Elige un fichero de copia (.rmc).', { error: true });
      return;
    }
    if (!reviewedPass) {
      showMessage(importMessage, 'Escribe la contraseña de la copia.', { error: true });
      return;
    }
    try {
      const preview = await services.store.previewBackup(reviewedFile, reviewedPass);
      let summary = previewBox.querySelector('.c-preview-text');
      if (!summary) {
        summary = el('p', 'c-preview-text');
        previewBox.prepend(summary);
      }
      summary.textContent = `La copia contiene ${previewSummary(preview)}.`;
      previewBox.hidden = false;
      importBtn.disabled = false;
    } catch (error) {
      showMessage(importMessage, error instanceof Error ? error.message : 'No se pudo leer la copia.', { error: true });
    }
  });

  importBtn.addEventListener('click', async () => {
    if (!reviewedFile) return;
    const chosen = mode.querySelector('input[name="c-import-mode"]:checked')?.value ?? 'merge';
    if (chosen === 'replace') {
      const confirmed = await openReplaceDialog();
      if (!confirmed) return;
    }
    importBtn.disabled = true;
    try {
      const result = await services.store.importBackup(reviewedFile, reviewedPass, { mode: chosen });
      showMessage(importMessage, importResultText(result));
      announce('Copia importada.');
      previewBox.hidden = true;
      reviewedFile = null;
      reviewedPass = '';
      importFile.value = '';
      importPass.input.value = '';
    } catch (error) {
      importBtn.disabled = false;
      showMessage(importMessage, error instanceof Error ? error.message : 'No se pudo importar la copia.', { error: true });
    }
  });

  function openReplaceDialog() {
    return openDialog({
      title: 'Sustituir los datos actuales',
      className: 'c-sheet c-dialog--danger',
      cancelValue: false,
      render: (body, close) => {
        body.append(el('p', 'c-body', 'Los perfiles, recuerdos, fotografías, historial y registro que hay ahora se borran y se sustituyen por los de la copia.'));
        const check = el('label', 'c-check');
        const box = el('input');
        box.type = 'checkbox';
        box.id = nextId('c-replace-confirm');
        check.htmlFor = box.id;
        check.append(box, el('span', '', 'Entiendo que se borrarán los datos actuales'));
        const confirm = button('Sustituir', 'danger');
        confirm.disabled = true;
        box.addEventListener('change', () => { confirm.disabled = !box.checked; });
        confirm.addEventListener('click', () => close(true));
        const cancel = button('Cancelar');
        cancel.addEventListener('click', () => close(false));
        const actions = el('div', 'c-dialog-actions');
        actions.append(cancel, confirm);
        body.append(check, actions);
      },
    });
  }

  // ---- Almacenamiento y sin conexión ----
  const storage = sectionBlock('Almacenamiento y sin conexión', 'c-settings-storage');
  const offlineLine = el('p', 'c-body');
  const offlineClear = button('Borrar la biblioteca guardada', 'danger');
  storage.append(offlineLine, offlineClear);
  const persistBlock = el('div', 'c-settings-persist');
  persistBlock.dataset.testid = 'c-settings-persist';
  const persistLine = el('p', 'c-body');
  const persistBtn = button('Pedir almacenamiento persistente');
  const persistMessage = el('p', 'c-help');
  persistBlock.append(persistLine, persistBtn, persistMessage);
  storage.append(persistBlock);

  async function refreshStorage() {
    try {
      const status = await offlineStatus();
      offlineLine.textContent = offlineText(status);
      offlineClear.disabled = status.count === 0;
    } catch {
      offlineLine.textContent = 'No se pudo leer el estado de la biblioteca sin conexión.';
      offlineClear.disabled = true;
    }
    try {
      const persisted = typeof navigator.storage?.persisted === 'function' ? await navigator.storage.persisted() : null;
      persistLine.textContent = persisted === true
        ? 'Almacenamiento persistente: concedido. El navegador no debería borrar tus datos.'
        : persisted === false
          ? 'Almacenamiento persistente: no concedido. El navegador puede borrar los datos si necesita espacio.'
          : 'Este navegador no informa del almacenamiento persistente.';
      persistBtn.hidden = persisted === true || persisted === null;
    } catch {
      persistLine.textContent = 'No se pudo consultar el almacenamiento persistente.';
    }
  }

  offlineClear.addEventListener('click', async () => {
    const confirmed = await services.confirm({
      title: 'Borrar la biblioteca guardada',
      body: 'Las canciones guardadas dejan de estar disponibles sin internet hasta que se vuelvan a guardar. Los perfiles y recuerdos no se borran.',
      confirmLabel: 'Borrar',
      cancelLabel: 'Cancelar',
      danger: true,
    });
    if (!confirmed) return;
    try {
      await clearOfflineLibrary();
      announce('Biblioteca sin conexión borrada.');
      await refreshStorage();
    } catch (error) {
      announce(error instanceof Error ? error.message : 'No se pudo borrar la biblioteca guardada.');
    }
  });

  persistBtn.addEventListener('click', async () => {
    try {
      const granted = await navigator.storage.persist();
      showMessage(persistMessage, granted ? 'Almacenamiento persistente concedido.' : 'El navegador no ha concedido el almacenamiento persistente.');
    } catch {
      showMessage(persistMessage, 'Este navegador no permite pedir el almacenamiento persistente.', { error: true });
    }
    await refreshStorage();
  });

  // ---- Registro del estudio ----
  const study = sectionBlock('Registro del estudio', 'c-settings-study');
  const studyMessage = el('p', 'c-form-error');
  study.append(el('p', 'c-help', REGISTRY_TEXT), studyMessage);
  const studySwitchHost = el('div');
  study.append(studySwitchHost);

  // ---- Borrado ----
  const danger = sectionBlock('Borrar todos los datos', 'c-settings-danger');
  danger.append(el('p', 'c-help', 'Borra todos los perfiles, recuerdos, fotografías, listas, observaciones, historial, registro del estudio y el PIN de este navegador. El catálogo no se toca.'));
  const deleteAll = button('Borrar todos los datos', 'danger');
  danger.append(deleteAll);
  const deleteMessage = el('p', 'c-form-error');
  danger.append(deleteMessage);

  deleteAll.addEventListener('click', async () => {
    const confirmed = await openDeleteDialog();
    if (!confirmed) return;
    try {
      const profiles = await services.store.listProfiles();
      for (const profile of profiles) await services.store.deleteProfile(profile.id);
      await services.store.removePin();
      announce('Datos borrados.');
      showMessage(deleteMessage, 'Todos los datos de este navegador se han borrado.');
      await refreshPin();
      await refreshBackupInfo();
    } catch (error) {
      showMessage(deleteMessage, error instanceof Error ? error.message : 'No se pudieron borrar los datos.', { error: true });
    }
  });

  function openDeleteDialog() {
    return openDialog({
      title: 'Borrar todos los datos',
      className: 'c-sheet c-dialog--danger',
      cancelValue: false,
      render: (body, close) => {
        body.append(el('p', 'c-body', 'Esta acción no se puede deshacer. Haz antes una copia si la necesitas.'));
        const check = el('label', 'c-check');
        const box = el('input');
        box.type = 'checkbox';
        box.id = nextId('c-delete-confirm');
        check.htmlFor = box.id;
        check.append(box, el('span', '', 'Entiendo que se borrarán todos los datos de este navegador'));
        const confirm = button('Borrar todo', 'danger');
        confirm.disabled = true;
        box.addEventListener('change', () => { confirm.disabled = !box.checked; });
        confirm.addEventListener('click', () => close(true));
        const cancel = button('Cancelar');
        cancel.addEventListener('click', () => close(false));
        const actions = el('div', 'c-dialog-actions');
        actions.append(cancel, confirm);
        body.append(check, actions);
      },
    });
  }

  // ---- Ayuda ----
  const help = sectionBlock('Ayuda', 'c-settings-help');
  help.append(
    el('p', 'c-body', 'Escape cierra las hojas y los paneles y devuelve el foco al control que los abrió.'),
    el('p', 'c-body', 'En la biblioteca, Ctrl o Cmd + K abre la búsqueda.'),
    el('p', 'c-body', 'Tus datos solo están en este navegador: no hay cuentas ni sincronización.'),
  );

  // ---- Dispositivo: se rellena al cargar ----
  async function loadDevice() {
    let settings = {};
    try {
      settings = await services.store.getSettings();
    } catch (error) {
      console.error('Reminiscencia: no se pudieron leer los ajustes del dispositivo.', error);
    }
    if (!alive) return;
    deviceHost.replaceChildren();
    const saveDevice = (patch) => services.store.saveSettings(patch);
    const onDeviceError = (error) => announce(error instanceof Error ? error.message : 'No se pudo guardar el ajuste del dispositivo.');
    const alwaysPatient = switchControl({
      label: 'Abrir siempre en modo paciente',
      checked: settings.alwaysPatientMode === true,
      description: 'Úsalo en tabletas compartidas. La app arranca siempre en el modo paciente.',
      onChange: (value) => saveDevice({ alwaysPatientMode: value }),
      onError: onDeviceError,
    });
    const wake = switchControl({
      label: 'Mantener la pantalla encendida',
      checked: settings.wakeLock !== false,
      description: 'Mientras suena en modo paciente, la pantalla no se apaga.',
      onChange: (value) => saveDevice({ wakeLock: value }),
      onError: onDeviceError,
    });
    const sleep = radioSet({
      testid: '',
      legend: 'Apagado automático por defecto',
      name: 'c-device-sleep',
      choices: SLEEP_CHOICES.map((item) => ({ value: item.value, label: item.label })),
      value: SLEEP_CHOICES.find((item) => item.minutes === (settings.sleepTimerMinutes ?? null))?.value ?? 'no',
      onChange: async (value) => {
        const minutes = SLEEP_CHOICES.find((item) => item.value === value)?.minutes ?? null;
        try {
          await services.store.saveSettings({ sleepTimerMinutes: minutes });
          announce('Apagado automático guardado.');
        } catch (error) {
          announce(error instanceof Error ? error.message : 'No se pudo guardar el apagado automático.');
        }
      },
    });
    deviceHost.append(alwaysPatient.element, wake.element, sleep);
  }

  async function loadStudy() {
    let settings = {};
    try {
      settings = await services.store.getSettings();
    } catch {
      settings = {};
    }
    if (!alive) return;
    studySwitchHost.replaceChildren();
    const toggle = switchControl({
      label: 'Registro del estudio',
      checked: settings.studyRecording !== false,
      // Si el almacén no admite el ajuste, el interruptor vuelve a su estado y se explica el motivo.
      onChange: async (value) => {
        await services.store.saveSettings({ studyRecording: value });
        showMessage(studyMessage, '');
      },
      onError: (error) => {
        showMessage(studyMessage, `No se pudo cambiar el registro del estudio. ${error instanceof Error ? error.message : ''}`.trim(), { error: true });
      },
    });
    studySwitchHost.append(toggle.element);
  }

  screen.append(appearance, device, pinSection, backup, storage, study, danger, help);
  loadDevice();
  loadStudy();
  refreshPin();
  refreshBackupInfo();
  refreshStorage();

  return {
    unmount() {
      if (!alive) return;
      alive = false;
      stopLockTimer();
      root.replaceChildren();
    },
  };
}

function importResultText(result) {
  const written = result?.written ?? {};
  const profiles = written.profiles ?? 0;
  const memories = written.memories ?? 0;
  const photos = written.photos ?? 0;
  return `Copia importada: ${profiles} ${profiles === 1 ? 'perfil' : 'perfiles'}, ${memories} ${memories === 1 ? 'recuerdo' : 'recuerdos'} y ${photos} ${photos === 1 ? 'fotografía' : 'fotografías'} escritos.`;
}

export const routes = Object.freeze({ ajustes: mountSettings });
