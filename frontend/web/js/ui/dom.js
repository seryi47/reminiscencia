// Utilidades de DOM sin framework: creación de elementos, diálogos modales (<dialog>), menús emergentes y avisos.
// Los textos entran siempre como nodos de texto, nunca como HTML.

import { icon } from './icons.js';

/** Crea un elemento. attrs admite class, dataset (objeto), on (objeto de eventos) y atributos normales. */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (name === 'on') {
      for (const [type, handler] of Object.entries(value)) node.addEventListener(type, handler);
    } else if (name === 'dataset') {
      for (const [key, data] of Object.entries(value)) if (data !== undefined && data !== null) node.dataset[key] = String(data);
    } else if (name === 'style' && typeof value === 'object') {
      for (const [key, style] of Object.entries(value)) node.style.setProperty(key, String(style));
    } else {
      node.setAttribute(name, value === true ? '' : String(value));
    }
  }
  append(node, children);
  return node;
}

function append(node, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(typeof child === 'object' ? child : document.createTextNode(String(child)));
  }
}

/** Texto solo para lectores de pantalla. */
export function srOnly(text) {
  return el('span', { class: 'sr-only' }, text);
}

/** Botón de icono con nombre accesible. */
export function iconButton(name, label, attrs = {}, size = 24) {
  const { class: extra = '', ...rest } = attrs;
  return el('button', { type: 'button', class: `icon-button ${extra}`.trim(), 'aria-label': label, ...rest }, icon(name, { size }));
}

let idSeq = 0;
/** Identificador único para enlazar etiquetas y descripciones. */
export function uid(prefix = 'id') {
  idSeq += 1;
  return `${prefix}-${idSeq}`;
}

// ---------------------------------------------------------------------------
// Diálogos modales
// ---------------------------------------------------------------------------

/**
 * Abre un diálogo modal nativo. render(body, close) rellena el cuerpo. El foco vuelve al elemento que lo abrió.
 * Devuelve una promesa con el valor de close(value) (undefined si se cierra con Escape o con el botón Cerrar).
 */
export function openDialog({ title, render, className = '', testid = 'dialog', closeLabel = 'Cerrar', closeIcon = 'close', initialFocus = null }) {
  const opener = document.activeElement;
  const titleId = uid('dialogo-titulo');
  const dialog = el('dialog', { class: `dialog ${className}`.trim(), 'aria-labelledby': titleId, 'data-testid': testid });
  const body = el('div', { class: 'dialog-body' });
  let result;
  let resolvePromise;
  const promise = new Promise((resolve) => { resolvePromise = resolve; });
  const close = (value) => {
    result = value;
    if (dialog.open) dialog.close();
  };
  const head = el('div', { class: 'dialog-head' },
    el('h2', { id: titleId, class: 'dialog-title' }, title),
    iconButton(closeIcon, closeLabel, { class: 'dialog-close', 'data-testid': `${testid}-close`, on: { click: () => close(undefined) } }));
  dialog.append(head, body);
  dialog.addEventListener('close', () => {
    dialog.remove();
    if (opener && typeof opener.focus === 'function' && opener.isConnected) opener.focus();
    resolvePromise(result);
  });
  // Un clic en el fondo (fuera de la caja) cierra el diálogo.
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) close(undefined);
  });
  render(body, close, dialog);
  document.body.append(dialog);
  dialog.showModal();
  const focusTarget = typeof initialFocus === 'function' ? initialFocus(dialog) : null;
  if (focusTarget) focusTarget.focus();
  return promise;
}

/** Confirmación con dos botones. Resuelve true si se acepta. */
export function confirmDialog({ title, message, confirmLabel, cancelLabel = 'Cancelar', danger = false }) {
  return openDialog({
    title,
    testid: 'confirm',
    render: (body, close) => {
      body.append(
        el('p', { class: 'dialog-text' }, message),
        el('div', { class: 'dialog-actions' },
          el('button', { type: 'button', class: 'button button-secondary', 'data-testid': 'confirm-cancel', on: { click: () => close(false) } }, cancelLabel),
          el('button', {
            type: 'button',
            class: `button ${danger ? 'button-danger' : 'button-primary'}`,
            'data-testid': 'confirm-ok',
            on: { click: () => close(true) },
          }, confirmLabel)),
      );
    },
    initialFocus: (dialog) => dialog.querySelector('[data-testid="confirm-cancel"]'),
  }).then((value) => value === true);
}

/** Pide un texto (por ejemplo, el nombre de una lista). validate(text) devuelve el motivo o null. */
export function promptDialog({ title, label, value = '', confirmLabel = 'Guardar', validate = () => null, maxLength = 100 }) {
  return openDialog({
    title,
    testid: 'prompt',
    render: (body, close) => {
      const inputId = uid('campo');
      const errorId = uid('error');
      const input = el('input', { id: inputId, class: 'text-field', type: 'text', maxlength: maxLength, autocomplete: 'off', 'data-testid': 'prompt-input' });
      input.value = value;
      const error = el('p', { id: errorId, class: 'field-error', hidden: true });
      const form = el('form', { class: 'dialog-form', novalidate: true },
        el('label', { class: 'field-label', for: inputId }, label), input, error,
        el('div', { class: 'dialog-actions' },
          el('button', { type: 'button', class: 'button button-secondary', on: { click: () => close(null) } }, 'Cancelar'),
          el('button', { type: 'submit', class: 'button button-primary', 'data-testid': 'prompt-ok' }, confirmLabel)));
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        const problem = validate(input.value);
        if (problem) {
          error.textContent = problem;
          error.hidden = false;
          input.setAttribute('aria-invalid', 'true');
          input.setAttribute('aria-describedby', errorId);
          input.focus();
          return;
        }
        close(input.value.trim());
      });
      body.append(form);
    },
    initialFocus: (dialog) => {
      const input = dialog.querySelector('input');
      input?.select();
      return input;
    },
  }).then((result) => (typeof result === 'string' ? result : null));
}

// ---------------------------------------------------------------------------
// Menú emergente (role="menu")
// ---------------------------------------------------------------------------

let openMenuState = null;
const ITEM_SELECTOR = '[role="menuitem"], [role="menuitemradio"]';

/** Cierra el menú abierto, si lo hay. Con restoreFocus, el foco vuelve al botón que lo abrió. */
export function closeMenu({ restoreFocus = true } = {}) {
  if (!openMenuState) return;
  const { menu, anchor, cleanup } = openMenuState;
  openMenuState = null;
  cleanup();
  menu.remove();
  anchor.setAttribute('aria-expanded', 'false');
  if (restoreFocus && anchor.isConnected) anchor.focus();
}

/**
 * Abre un menú junto a anchor. items: [{ label, icon?, description?, checked?, action, testid? }]. Una acción puede
 * devolver una lista nueva (submenú) y el menú se sustituye. heading: rótulo encima de las opciones («Ordenar por»).
 * Flechas, Inicio, Fin y Escape.
 */
export function openMenu(anchor, items, { label = 'Opciones', heading = null } = {}) {
  closeMenu({ restoreFocus: false });
  const menu = el('div', { class: 'menu', role: 'menu', 'aria-label': label, 'data-testid': 'menu' });
  const fill = (list) => {
    menu.replaceChildren();
    if (heading) menu.append(el('p', { class: 'menu-heading', 'aria-hidden': 'true' }, heading));
    for (const item of list) {
      // Con «checked», el elemento es una opción de un grupo (menuitemradio) y lleva una marca si está elegida.
      const radio = typeof item.checked === 'boolean';
      const button = el('button', {
        type: 'button',
        class: `menu-item${item.checked ? ' is-checked' : ''}${item.description ? ' has-description' : ''}`,
        role: radio ? 'menuitemradio' : 'menuitem',
        'aria-checked': radio ? String(item.checked) : null,
        tabindex: '-1',
        'data-testid': item.testid,
      },
      item.icon ? icon(item.icon, { size: 18 }) : null,
      el('span', { class: 'menu-text' },
        el('span', { class: 'menu-label' }, item.label),
        item.description ? el('span', { class: 'menu-description' }, item.description) : null),
      item.checked ? icon('check', { size: 16, className: 'menu-check' }) : null);
      button.addEventListener('click', async (event) => {
        event.stopPropagation();
        const next = await item.action();
        if (Array.isArray(next)) {
          fill(next);
          menu.querySelector(ITEM_SELECTOR)?.focus();
        } else {
          closeMenu({ restoreFocus: next !== false });
        }
      });
      menu.append(button);
    }
  };
  fill(items);
  const onKey = (event) => {
    const entries = [...menu.querySelectorAll(ITEM_SELECTOR)];
    const at = entries.indexOf(document.activeElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      closeMenu();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      entries[(at + 1) % entries.length]?.focus();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      entries[(at - 1 + entries.length) % entries.length]?.focus();
    } else if (event.key === 'Home') {
      event.preventDefault();
      entries[0]?.focus();
    } else if (event.key === 'End') {
      event.preventDefault();
      entries[entries.length - 1]?.focus();
    } else if (event.key === 'Tab') {
      closeMenu({ restoreFocus: false });
    }
  };
  const onOutside = (event) => {
    if (!menu.contains(event.target) && event.target !== anchor && !anchor.contains(event.target)) closeMenu({ restoreFocus: false });
  };
  const onResize = () => closeMenu({ restoreFocus: false });
  menu.addEventListener('keydown', onKey);
  document.addEventListener('pointerdown', onOutside, true);
  window.addEventListener('resize', onResize);
  // Dentro de un diálogo modal, el menú tiene que estar en el propio diálogo para recibir el foco.
  (anchor.closest('dialog') ?? document.body).append(menu);
  positionMenu(menu, anchor);
  anchor.setAttribute('aria-expanded', 'true');
  openMenuState = {
    menu,
    anchor,
    cleanup: () => {
      document.removeEventListener('pointerdown', onOutside, true);
      window.removeEventListener('resize', onResize);
    },
  };
  menu.querySelector(ITEM_SELECTOR)?.focus();
}

function positionMenu(menu, anchor) {
  const rect = anchor.getBoundingClientRect();
  const width = menu.offsetWidth;
  const height = menu.offsetHeight;
  const margin = 8;
  let left = rect.right - width;
  if (left < margin) left = margin;
  if (left + width > window.innerWidth - margin) left = window.innerWidth - margin - width;
  let top = rect.bottom + 4;
  if (top + height > window.innerHeight - margin) top = Math.max(margin, rect.top - height - 4);
  menu.style.left = `${Math.round(left)}px`;
  menu.style.top = `${Math.round(top)}px`;
}

// ---------------------------------------------------------------------------
// Avisos breves
// ---------------------------------------------------------------------------

let toastTimer = null;

/** Muestra un aviso breve en la región de estado (role="status"). */
export function toast(message, { ms = 4000 } = {}) {
  const region = document.querySelector('[data-testid="toast"]');
  if (!region) return;
  region.textContent = '';
  // Un cambio de texto en el siguiente fotograma asegura que el lector de pantalla lo anuncie.
  requestAnimationFrame(() => {
    region.textContent = message;
    region.classList.add('is-visible');
  });
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    region.classList.remove('is-visible');
    region.textContent = '';
  }, ms);
}
