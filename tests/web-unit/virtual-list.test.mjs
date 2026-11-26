// Pruebas del helper de virtualización (frontend/web/js/virtual-list.js, ADR-0052).
// La suite no tiene JSDOM instalado: montamos un dom-doble mínimo que cubre lo
// que la primitiva utiliza (createElement, replaceChildren, scroll event, append,
// querySelectorAll por atributo).

import { test } from 'node:test';
import assert from 'node:assert/strict';

/* -------------------- dom-doble mínimo -------------------- */

class FakeStyle {
  constructor() {
    this._props = {};
  }
  setProperty(k, v) { this._props[k] = v; }
}

class FakeEvent {
  constructor(type) { this.type = type; }
}

class FakeNode {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.parent = null;
    this.textContent = '';
    this.attributes = {};
    this.style = new Proxy({}, {
      set(target, k, v) { target[k] = v; return true; },
      get(target, k) { return target[k] ?? ''; },
    });
    this.classList = { add() {}, remove() {}, contains() { return false; } };
    this.listeners = {};
  }
  setAttribute(k, v) { this.attributes[k] = v; }
  getAttribute(k) { return this.attributes[k] ?? null; }
  appendChild(node) { node.parent = this; this.children.push(node); return node; }
  append(...nodes) {
    for (const n of nodes) {
      if (n && n.nodes) for (const m of n.nodes) this.appendChild(m);
      else this.appendChild(n);
    }
  }
  replaceChildren(...nodes) {
    this.children = [];
    this.append(...nodes);
  }
  addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
  removeEventListener(type, fn) {
    const arr = this.listeners[type] || [];
    this.listeners[type] = arr.filter((x) => x !== fn);
  }
  dispatchEvent(ev) {
    for (const fn of this.listeners[ev.type] || []) fn(ev);
  }
  get firstElementChild() { return this.children[0] ?? null; }
  querySelectorAll(selector) {
    // Solo soportamos selectores del tipo `[attr]` o `[attr="v"]`.
    const re = /^\[([a-z-]+)(?:="?([^"\]]+)"?)?\]$/i;
    const m = re.exec(selector);
    const matches = [];
    const visit = (node) => {
      if (m) {
        const [, attr, value] = m;
        const has = attr in node.attributes;
        if (has && (value === undefined || node.attributes[attr] === value)) matches.push(node);
      }
      for (const c of node.children) visit(c);
    };
    visit(this);
    return matches;
  }
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }
}

class FakeFragment {
  constructor() { this.nodes = []; }
  append(...nodes) { for (const n of nodes) this.nodes.push(n); }
}

const document = {
  createElement: (tag) => new FakeNode(tag),
  createDocumentFragment: () => new FakeFragment(),
};

const window = {
  _listeners: {},
  addEventListener(type, fn) { (this._listeners[type] ??= []).push(fn); },
  removeEventListener(type, fn) {
    this._listeners[type] = (this._listeners[type] || []).filter((x) => x !== fn);
  },
  Event: FakeEvent,
};

global.document = document;
global.window = window;
global.HTMLElement = FakeNode;
global.getComputedStyle = () => ({ position: 'relative' });

/** Monta un contenedor con altura fija y devuelve el VirtualList recién creado. */
async function mount({ rows = 1000, rowHeight = 40, containerHeight = 400 } = {}) {
  const { VirtualList } = await import('../../frontend/web/js/virtual-list.js');
  const container = new FakeNode('div');
  // Simulación de scrollTop + clientHeight. jsdom no hace layout real.
  container.__scrollTop = 0;
  Object.defineProperty(container, 'scrollTop', {
    configurable: true,
    get() { return this.__scrollTop; },
    set(v) { this.__scrollTop = v; this.dispatchEvent(new FakeEvent('scroll')); },
  });
  Object.defineProperty(container, 'clientHeight', { configurable: true, get: () => containerHeight });
  const items = Array.from({ length: rows }, (_, i) => ({ id: `r${i}`, label: `Fila ${i}` }));
  const vlist = new VirtualList({
    container,
    items,
    rowHeight,
    renderItem: (item) => {
      const n = document.createElement('div');
      n.textContent = item.label;
      n.setAttribute('data-id', item.id);
      return n;
    },
    keyFn: (item) => item.id,
    buffer: 10,
  });
  return { vlist, container, items };
}

/* -------------------- tests -------------------- */

test('solo renderiza la ventana visible + buffer y no toda la lista', async () => {
  const { vlist, container } = await mount({ rows: 2000, rowHeight: 40, containerHeight: 400 });
  // 400 / 40 = 10 visibles + 10 buffer = ~20 filas renderizadas.
  const rendered = container.querySelectorAll('[data-id]');
  assert.ok(rendered.length >= 10 && rendered.length <= 30,
    `renderizadas ${rendered.length}, esperado ~20 (nunca las 2000)`);
  const spacer = container.firstElementChild;
  assert.equal(spacer.style.height, '80000px', 'spacer total = 2000*40');
  vlist.destroy();
});

test('scroll repiensa la ventana visible', async () => {
  const { vlist, container } = await mount({ rows: 500, rowHeight: 50, containerHeight: 500 });
  const idsAntes = container.querySelectorAll('[data-id]').map((n) => n.getAttribute('data-id'));
  assert.ok(idsAntes.includes('r0'), 'r0 debe estar presente al principio');
  container.scrollTop = 50 * 100;
  const idsDespues = container.querySelectorAll('[data-id]').map((n) => n.getAttribute('data-id'));
  assert.ok(idsDespues.some((id) => Number(id.slice(1)) >= 95 && Number(id.slice(1)) <= 115),
    `tras scroll, filas cercanas a r100 no encontradas: ${idsDespues.slice(0, 5).join(',')}`);
  assert.ok(!idsDespues.includes('r0'), 'r0 ya no debería estar visible tras scroll grande');
  vlist.destroy();
});

test('setItems actualiza, limpia el cache y repinta', async () => {
  const { vlist, container } = await mount({ rows: 20, rowHeight: 40, containerHeight: 400 });
  vlist.setItems([
    { id: 'x1', label: 'X1' },
    { id: 'x2', label: 'X2' },
    { id: 'x3', label: 'X3' },
  ]);
  const rendered = container.querySelectorAll('[data-id]').map((n) => n.getAttribute('data-id'));
  assert.deepEqual(rendered, ['x1', 'x2', 'x3']);
  const spacer = container.firstElementChild;
  assert.equal(spacer.style.height, '120px'); // 3 * 40
  vlist.destroy();
});

test('scrollToIndex coloca el scrollTop en la fila pedida', async () => {
  const { vlist, container } = await mount({ rows: 300, rowHeight: 50, containerHeight: 500 });
  vlist.scrollToIndex(150);
  assert.equal(container.__scrollTop, 150 * 50);
  const ids = container.querySelectorAll('[data-id]').map((n) => n.getAttribute('data-id'));
  assert.ok(ids.some((id) => ['r148', 'r149', 'r150', 'r151', 'r152'].includes(id)),
    `scrollToIndex(150) no pintó r150±: ${ids.slice(0, 5).join(',')}`);
  vlist.destroy();
});

test('destroy desengancha listeners y vacía el container', async () => {
  const { vlist, container } = await mount({ rows: 100, rowHeight: 40, containerHeight: 400 });
  vlist.destroy();
  assert.equal(container.children.length, 0, 'destroy deja el container vacío');
  // Un scroll tras destroy no revive nodos.
  container.scrollTop = 200;
  assert.equal(container.children.length, 0, 'ningún listener activo tras destroy');
});
