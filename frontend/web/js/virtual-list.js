// Virtualización de listas largas (ADR-0052 · diciembre 2026). Renderiza solo las filas visibles + un buffer, y las va
// recolocando con `translateY` al hacer scroll. Pensado para listas de miles de ítems (biblioteca, búsqueda, playlists
// grandes). Mientras los ítems se puedan presentar con una `rowHeight` fija, esta primitiva les sirve tal cual.
//
// Uso:
//   const vlist = new VirtualList({
//     container: document.getElementById('contenedor'),
//     items: [...],
//     rowHeight: 64,
//     renderItem: (item, index) => el('div', ..., item.title),
//     keyFn: (item, index) => item.id ?? String(index),
//   });
//   vlist.setItems(nuevosItems);  // actualiza sin perder posición
//   vlist.scrollToIndex(42);      // lleva la fila 42 a la vista
//   vlist.destroy();              // desengancha listeners
//
// Diseño:
//  - El contenedor recibe `overflow-y:auto` y una altura fija que el usuario le aplica (CSS normal).
//  - Dentro se añade un «spacer» con la altura total (items*rowHeight) para que el scroll sea realista.
//  - Un «viewport» absoluto se desplaza con `translateY(topOffset)` y aloja solo las filas visibles.
//  - El buffer por defecto es 10 filas (5 arriba, 5 abajo) para suavizar el repintado durante el scroll.

const DEFAULT_BUFFER = 10;

export class VirtualList {
  constructor({ container, items = [], rowHeight, renderItem, keyFn = (_, index) => String(index), buffer = DEFAULT_BUFFER }) {
    if (!container) throw new Error('VirtualList: falta container.');
    if (!Number.isFinite(rowHeight) || rowHeight <= 0) throw new Error('VirtualList: rowHeight debe ser un número positivo.');
    if (typeof renderItem !== 'function') throw new Error('VirtualList: renderItem debe ser función.');
    this._container = container;
    this._items = Array.isArray(items) ? items.slice() : [];
    this._rowHeight = rowHeight;
    this._renderItem = renderItem;
    this._keyFn = keyFn;
    this._buffer = Math.max(0, buffer | 0);
    this._cache = new Map(); // key -> HTMLElement cacheado (clave estable)
    this._lastRange = { start: -1, end: -1 };

    // Guarda estilos originales por si `destroy()` necesita devolverlos.
    this._origContainerOverflow = container.style.overflowY;
    this._origContainerPosition = container.style.position;
    if (!container.style.overflowY) container.style.overflowY = 'auto';
    if (getComputedStyle(container).position === 'static') container.style.position = 'relative';

    this._spacer = document.createElement('div');
    this._spacer.setAttribute('aria-hidden', 'true');
    this._spacer.style.width = '1px';
    this._spacer.style.pointerEvents = 'none';

    this._viewport = document.createElement('div');
    this._viewport.setAttribute('data-vlist-viewport', '');
    this._viewport.style.position = 'absolute';
    this._viewport.style.inset = '0 0 auto 0';
    this._viewport.style.willChange = 'transform';

    container.replaceChildren(this._spacer, this._viewport);

    this._onScroll = () => this._render();
    this._onResize = () => this._render();
    container.addEventListener('scroll', this._onScroll, { passive: true });
    window.addEventListener('resize', this._onResize);

    this._applyTotalHeight();
    this._render(true);
  }

  /** Reemplaza los ítems. Mantiene el scroll si cabe. */
  setItems(items) {
    this._items = Array.isArray(items) ? items.slice() : [];
    this._applyTotalHeight();
    // Clave estable → mantenemos nodos cacheados que sigan presentes.
    const seen = new Set();
    for (const [index, item] of this._items.entries()) seen.add(this._keyFn(item, index));
    for (const key of [...this._cache.keys()]) if (!seen.has(key)) this._cache.delete(key);
    this._lastRange = { start: -1, end: -1 }; // fuerza re-render
    this._render(true);
  }

  /** Lleva la fila `index` a la vista. */
  scrollToIndex(index) {
    if (!Number.isFinite(index)) return;
    const target = Math.max(0, Math.min(this._items.length - 1, Math.floor(index)));
    this._container.scrollTop = target * this._rowHeight;
    this._render();
  }

  /** Número de ítems. */
  get length() {
    return this._items.length;
  }

  /** Último rango visible (para tests). */
  get visibleRange() {
    return { ...this._lastRange };
  }

  /** Suelta listeners y deja el container como estaba. */
  destroy() {
    this._container.removeEventListener('scroll', this._onScroll);
    window.removeEventListener('resize', this._onResize);
    this._container.replaceChildren();
    this._container.style.overflowY = this._origContainerOverflow;
    this._container.style.position = this._origContainerPosition;
    this._cache.clear();
  }

  _applyTotalHeight() {
    this._spacer.style.height = `${this._items.length * this._rowHeight}px`;
  }

  _render(force = false) {
    const total = this._items.length;
    if (total === 0) {
      this._viewport.replaceChildren();
      this._viewport.style.transform = 'translateY(0)';
      this._lastRange = { start: 0, end: 0 };
      return;
    }
    const scrollTop = this._container.scrollTop || 0;
    const viewportHeight = this._container.clientHeight || 0;
    const visibleCount = Math.max(1, Math.ceil(viewportHeight / this._rowHeight));
    const bufferSide = Math.ceil(this._buffer / 2);
    const start = Math.max(0, Math.floor(scrollTop / this._rowHeight) - bufferSide);
    const end = Math.min(total, start + visibleCount + this._buffer);
    if (!force && start === this._lastRange.start && end === this._lastRange.end) return;
    this._lastRange = { start, end };

    const frag = document.createDocumentFragment();
    for (let i = start; i < end; i++) {
      const item = this._items[i];
      const key = this._keyFn(item, i);
      let node = this._cache.get(key);
      if (!node) {
        node = this._renderItem(item, i);
        if (!(node instanceof HTMLElement)) throw new Error('VirtualList: renderItem debe devolver un HTMLElement.');
        this._cache.set(key, node);
      }
      // Posicionamiento absoluto de cada fila, con top = (i - start) * rowHeight.
      node.style.position = 'absolute';
      node.style.insetInlineStart = '0';
      node.style.insetInlineEnd = '0';
      node.style.top = `${(i - start) * this._rowHeight}px`;
      node.style.height = `${this._rowHeight}px`;
      frag.append(node);
    }
    this._viewport.style.transform = `translateY(${start * this._rowHeight}px)`;
    this._viewport.replaceChildren(frag);
  }
}

export default VirtualList;
