// Salida del modo paciente al modo cuidador (P5; DESIGN 3.1, 6.1 P-16 y P-17, 9 y D11 a D13).
// Sin PIN, pide confirmación: «Seguir escuchando» (primaria, con el foco) o «Volver al modo cuidador».
// Con PIN, muestra el teclado: el PIN se comprueba con services.store.checkPin, cada intento se registra con
// registerPinAttempt y, tras cinco fallos, el teclado se bloquea con cuenta atrás (getPinLockout).
// «Olvidé el PIN» quita solo el PIN, tras confirmación; los datos se conservan.
// Resuelve true solo si el paciente sale al modo cuidador; false en cualquier otro caso (Escape incluido).
import { element, nextId, openModal, PIN_CHANGED_EVENT } from './shell.js';

export const PIN_MIN_DIGITS = 4;
export const PIN_MAX_DIGITS = 6;
// Indicadores del PIN: cuatro mientras el PIN tenga cuatro dígitos o menos; seis a partir del quinto (P-16).
const SHORT_SLOTS = 4;
const LONG_SLOTS = 6;
const LOCK_TICK_MS = 250;
const MESSAGE_WRONG = 'PIN incorrecto. Vuelve a intentarlo.';
const MESSAGE_TOO_SHORT = `Escribe el PIN de ${PIN_MIN_DIGITS} a ${PIN_MAX_DIGITS} dígitos.`;
const MESSAGE_LOCKED = 'Demasiados intentos. Vuelve a intentarlo en ';
const TEXT_WITH_PIN = 'Escribe el PIN del cuidador.';
const TEXT_WITHOUT_PIN = 'La música seguirá sonando.';

// ---------- Funciones puras ----------

// Aplica una tecla al PIN que se escribe: un dígito lo añade (hasta seis); «Borrar» o Retroceso quita el último.
export function typePinDigit(digits, key) {
  const current = String(digits ?? '');
  if (key === 'Backspace' || key === 'Borrar') return current.slice(0, -1);
  if (/^[0-9]$/.test(String(key)) && current.length < PIN_MAX_DIGITS) return current + key;
  return current;
}

// Dígitos de un texto pegado: solo cifras, hasta seis. Vacío si no hay ninguna.
export function pastePinDigits(text) {
  return String(text ?? '').replace(/\D/g, '').slice(0, PIN_MAX_DIGITS);
}

// Número de indicadores para un PIN que se escribe: cuatro, o seis desde el quinto dígito (DESIGN P-16).
export function pinSlotCount(length) {
  return length > SHORT_SLOTS ? LONG_SLOTS : SHORT_SLOTS;
}

// Un PIN solo se comprueba si tiene entre cuatro y seis dígitos (DESIGN D12).
export function pinCanSubmit(digits) {
  const length = String(digits ?? '').length;
  return length >= PIN_MIN_DIGITS && length <= PIN_MAX_DIGITS;
}

// Segundos que faltan para que termine el bloqueo, redondeados hacia arriba. Cero si no hay bloqueo.
export function lockRemainingSeconds(lockedUntil, now) {
  if (!Number.isFinite(lockedUntil)) return 0;
  return Math.max(0, Math.ceil((lockedUntil - now) / 1000));
}

// ---------- Diálogo ----------

// Abre P5. Devuelve una promesa que resuelve true si el paciente sale al modo cuidador.
export function openExitDialog(services) {
  const store = services.store;
  const titleId = nextId('p5');
  let digits = '';
  let showing = false;
  let hasPin = true;
  let busy = false;
  let locked = false;
  let lockedUntil = null;
  let lockTimer = null;
  let countdownNode = null;
  let dialog = null;

  // ---- Cabecera y textos
  const titleNode = element('h2', { class: 'p5-titulo', id: titleId, tabindex: '-1', text: 'Volver al modo cuidador' });
  const bodyNode = element('p', { class: 'p5-texto' });

  // ---- Teclado del PIN (P-16). Las teclas numéricas no se limitan por tiempo: un PIN puede repetir dígitos.
  // role="group" da sentido al aria-label del contenedor (un div sin rol no admite aria-label).
  const indicatorsNode = element('div', { class: 'p5-indicadores', role: 'group' });
  const keyButtons = [];
  const digitKey = (digit) => {
    const button = element('button', {
      type: 'button',
      class: 'p5-tecla',
      text: digit,
      on: { click: () => press(digit) },
    });
    keyButtons.push(button);
    return button;
  };
  const eraseButton = element('button', {
    type: 'button',
    class: 'p5-tecla p5-tecla-borrar',
    text: 'Borrar',
    on: { click: () => press('Borrar') },
  });
  keyButtons.push(eraseButton);
  const keypadGrid = element('div', { class: 'p5-teclas' }, [
    ...['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(digitKey),
    element('span', { class: 'p5-hueco', 'aria-hidden': 'true' }),
    digitKey('0'),
    eraseButton,
  ]);
  const showButton = element('button', {
    type: 'button',
    class: 'p-boton p5-auxiliar',
    'data-testid': 'p5-show-pin',
    'aria-pressed': 'false',
    text: 'Mostrar PIN',
    on: { click: () => toggleShow() },
  });
  const forgetButton = element('button', {
    type: 'button',
    class: 'p-boton p5-auxiliar',
    'data-testid': 'p5-forget-pin',
    text: 'Olvidé el PIN',
    on: { click: () => forgetPin() },
  });
  const keypadNode = element('div', {
    class: 'p5-teclado',
    'data-testid': 'p5-keypad',
    role: 'group',
    'aria-label': 'Teclado del PIN',
    hidden: true,
  }, [indicatorsNode, keypadGrid, element('div', { class: 'p5-auxiliares' }, [showButton, forgetButton])]);

  // ---- Mensajes: errores e intentos bloqueados (role status; la cuenta atrás va oculta para no repetirla).
  const messageNode = element('p', { class: 'p5-mensaje', role: 'status' });

  // ---- Acciones (P-17): «Seguir escuchando» es la primaria y recibe el foco inicial.
  const continueButton = element('button', {
    type: 'button',
    class: 'p-boton p-boton--primario p-boton--grande',
    'data-testid': 'p5-continue',
    text: 'Seguir escuchando',
    on: { click: () => finish(false) },
  });
  const caregiverButton = element('button', {
    type: 'button',
    class: 'p-boton p-boton--secundario p-boton--grande',
    'data-testid': 'p5-caregiver',
    text: 'Volver al modo cuidador',
    on: { click: () => onCaregiver() },
  });

  const panel = element('section', {
    class: 'p-dialogo p5',
    role: 'alertdialog',
    'aria-modal': 'true',
    'aria-labelledby': titleId,
    'data-testid': 'p5-dialog',
  }, [
    titleNode,
    bodyNode,
    keypadNode,
    messageNode,
    element('div', { class: 'p5-acciones' }, [continueButton, caregiverButton]),
  ]);
  // Escribir dígitos y pegar un PIN solo actúa dentro del diálogo y con el teclado visible.
  panel.addEventListener('keydown', onPanelKey);
  panel.addEventListener('paste', onPaste);

  dialog = openModal({ panel, initialFocus: continueButton, onEscape: () => finish(false) });
  init();
  return dialog.promise;

  // ---- Cierre
  function finish(leave) {
    clearLockTimer();
    digits = '';
    dialog.close(leave);
  }

  function clearLockTimer() {
    if (lockTimer !== null) clearInterval(lockTimer);
    lockTimer = null;
  }

  // Muestra solo lo que corresponde al modo: con PIN, el teclado; sin PIN, la confirmación.
  function renderMode() {
    keypadNode.hidden = !hasPin;
    forgetButton.hidden = !hasPin;
    bodyNode.textContent = hasPin ? TEXT_WITH_PIN : TEXT_WITHOUT_PIN;
  }

  function renderDigits() {
    const slots = pinSlotCount(digits.length);
    indicatorsNode.setAttribute('aria-label', `Dígitos escritos: ${digits.length}`);
    const nodes = [];
    for (let index = 0; index < slots; index += 1) {
      const filled = index < digits.length;
      // Con «Mostrar PIN», el dígito sustituye al punto; si no, el punto se rellena.
      const revealed = showing && filled;
      let className = 'p5-indicador';
      if (revealed) className += ' is-mostrando';
      else if (filled) className += ' is-lleno';
      nodes.push(element('span', { class: className, text: revealed ? digits[index] : '' }));
    }
    indicatorsNode.replaceChildren(...nodes);
    showButton.setAttribute('aria-pressed', String(showing));
  }

  function setMessage(text, kind = null) {
    messageNode.textContent = text;
    messageNode.classList.toggle('is-error', kind === 'error');
  }

  function clearMessage() {
    setMessage('');
  }

  function setKeysDisabled(value) {
    for (const key of keyButtons) key.disabled = value;
  }

  // ---- Teclado
  function press(key) {
    if (!hasPin || locked || busy) return;
    digits = typePinDigit(digits, key);
    clearMessage();
    renderDigits();
  }

  function onPanelKey(event) {
    if (!hasPin || locked || busy) return;
    if (event.key === 'Backspace' || /^[0-9]$/.test(event.key)) {
      event.preventDefault();
      press(event.key);
    }
  }

  function onPaste(event) {
    if (!hasPin || locked || busy) return;
    const pasted = pastePinDigits(event.clipboardData?.getData('text') ?? '');
    if (pasted === '') return;
    event.preventDefault();
    digits = pasted;
    clearMessage();
    renderDigits();
  }

  function toggleShow() {
    showing = !showing;
    renderDigits();
  }

  // ---- Comprobación del PIN
  async function onCaregiver() {
    if (locked) return;
    if (!hasPin) {
      finish(true);
      return;
    }
    await submitPin();
  }

  async function submitPin() {
    if (busy || locked) return;
    if (!pinCanSubmit(digits)) {
      setMessage(MESSAGE_TOO_SHORT, 'error');
      return;
    }
    busy = true;
    let ok = false;
    try {
      ok = (await store.checkPin(digits)) === true;
    } catch (error) {
      console.error('Reminiscencia: no se pudo comprobar el PIN.', error);
    }
    let outcome = null;
    try {
      outcome = await store.registerPinAttempt(ok);
    } catch (error) {
      console.error('Reminiscencia: no se pudo registrar el intento.', error);
    }
    busy = false;
    digits = '';
    renderDigits();
    if (ok) {
      finish(true);
      return;
    }
    if (outcome?.lockedUntil) startLock(outcome.lockedUntil);
    else setMessage(MESSAGE_WRONG, 'error');
  }

  // Tras cinco fallos (DESIGN D12): teclas deshabilitadas y cuenta atrás hasta que termine el bloqueo.
  function startLock(until) {
    locked = true;
    lockedUntil = until;
    setKeysDisabled(true);
    caregiverButton.setAttribute('aria-disabled', 'true');
    if (keyButtons.includes(document.activeElement)) continueButton.focus();
    showLockMessage();
    clearLockTimer();
    lockTimer = setInterval(updateLock, LOCK_TICK_MS);
  }

  function showLockMessage() {
    countdownNode = element('span', { 'aria-hidden': 'true', text: String(lockRemainingSeconds(lockedUntil, Date.now())) });
    messageNode.classList.add('is-error');
    messageNode.replaceChildren(document.createTextNode(MESSAGE_LOCKED), countdownNode, document.createTextNode(' s.'));
  }

  function updateLock() {
    const remaining = lockRemainingSeconds(lockedUntil, Date.now());
    if (remaining <= 0) {
      endLock();
      return;
    }
    if (countdownNode) countdownNode.textContent = String(remaining);
  }

  function endLock() {
    clearLockTimer();
    locked = false;
    lockedUntil = null;
    countdownNode = null;
    setKeysDisabled(false);
    caregiverButton.setAttribute('aria-disabled', 'false');
    clearMessage();
  }

  // ---- «Olvidé el PIN»: se pide confirmación, se quita el PIN y los datos se conservan (DESIGN 9).
  async function forgetPin() {
    if (!hasPin || busy) return;
    let confirmed = false;
    try {
      confirmed = Boolean(await services.confirm({
        title: 'Quitar el PIN',
        body: 'Los datos se conservan. El modo cuidador no pedirá PIN.',
        confirmLabel: 'Quitar el PIN',
        cancelLabel: 'Cancelar',
        danger: true,
      }));
    } catch (error) {
      console.error('Reminiscencia: no se pudo pedir la confirmación.', error);
    }
    if (!confirmed) return;
    try {
      await store.removePin();
    } catch (error) {
      console.error('Reminiscencia: no se pudo quitar el PIN.', error);
      setMessage('No se pudo quitar el PIN. Inténtalo de nuevo.', 'error');
      return;
    }
    hasPin = false;
    digits = '';
    showing = false;
    if (locked) endLock();
    document.dispatchEvent(new CustomEvent(PIN_CHANGED_EVENT));
    renderMode();
    renderDigits();
    clearMessage();
    titleNode.focus();
    services.announce?.('PIN quitado. Los datos se conservan.');
  }

  // Al abrir, se consulta si hay PIN y si el teclado sigue bloqueado por intentos anteriores.
  // Si no se puede consultar, se trata como si hubiera PIN (así no se sale sin comprobarlo).
  async function init() {
    try {
      hasPin = Boolean(await store.hasPin());
    } catch (error) {
      console.error('Reminiscencia: no se pudo consultar el PIN.', error);
      hasPin = true;
    }
    renderMode();
    renderDigits();
    if (!hasPin) return;
    try {
      const lockout = await store.getPinLockout();
      if (lockout?.lockedUntil && lockout.lockedUntil > Date.now()) startLock(lockout.lockedUntil);
    } catch (error) {
      console.error('Reminiscencia: no se pudo consultar el bloqueo del PIN.', error);
    }
  }
}
