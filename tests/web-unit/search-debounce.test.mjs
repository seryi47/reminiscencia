import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { SEARCH_INPUT_DEBOUNCE_MS } from '../../frontend/web/js/views/search.js';

describe('search debounce (ADR-0052)', () => {
  test('SEARCH_INPUT_DEBOUNCE_MS es 150 ms (respuesta percibida sin re-renders por tecla)', () => {
    assert.equal(SEARCH_INPUT_DEBOUNCE_MS, 150);
  });

  test('debounce colapsa varias pulsaciones en 1 ejecución', async () => {
    // Simula el patrón de `clearTimeout + setTimeout` que usa la vista de búsqueda.
    let calls = 0;
    let timer = null;
    const type = (c) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { calls += 1; }, SEARCH_INPUT_DEBOUNCE_MS);
    };
    for (const c of 'rayden') type(c);
    await new Promise((r) => setTimeout(r, SEARCH_INPUT_DEBOUNCE_MS + 20));
    assert.equal(calls, 1);
  });
});
