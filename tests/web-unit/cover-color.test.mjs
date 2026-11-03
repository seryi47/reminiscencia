// Pruebas del color dominante de las portadas (frontend/web/js/cover-color.js): conversión de colores, contraste
// WCAG, oscurecido hasta 6:1 con texto blanco y elección del color de unos píxeles. Sin navegador.
// Ejecución: node --test tests/web-unit/cover-color.test.mjs
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  contrastRatio,
  ensureWhiteContrast,
  hexToRgb,
  MIN_WHITE_CONTRAST,
  pickDominantColor,
  rgbToHex,
} from '../../frontend/web/js/cover-color.js';

/** Píxeles RGBA: una lista de [r, g, b, a, veces]. */
function pixels(...groups) {
  const out = [];
  for (const [r, g, b, a, times] of groups) for (let i = 0; i < times; i += 1) out.push(r, g, b, a);
  return Uint8ClampedArray.from(out);
}

describe('colores', () => {
  test('rgbToHex y hexToRgb van y vuelven, y acotan los valores', () => {
    assert.equal(rgbToHex(30, 215, 96), '#1ed760');
    assert.deepEqual(hexToRgb('#1ed760'), [30, 215, 96]);
    assert.deepEqual(hexToRgb('#fff'), [255, 255, 255]);
    assert.equal(rgbToHex(-4, 300, 127.6), '#00ff80');
    assert.equal(hexToRgb('rojo'), null);
  });

  test('contraste WCAG: blanco y negro 21:1; #b3b3b3 sobre #121212 más de 4,5:1', () => {
    assert.equal(Math.round(contrastRatio('#ffffff', '#000000')), 21);
    assert.ok(contrastRatio('#b3b3b3', '#121212') > 4.5);
    assert.ok(contrastRatio('#000000', '#1ed760') > 4.5, 'texto negro sobre el verde de acento');
  });
});

describe('ensureWhiteContrast', () => {
  test('oscurece un color claro hasta que el blanco contrasta al menos 6:1, conservando el tono', () => {
    const color = ensureWhiteContrast('#ffd86b');
    assert.ok(contrastRatio(color, '#ffffff') >= MIN_WHITE_CONTRAST, color);
    const [r, g, b] = hexToRgb(color);
    assert.ok(r > g && g > b, `el tono amarillo se conserva: ${color}`);
  });

  test('un color que ya contrasta no cambia; uno no válido da null', () => {
    assert.equal(ensureWhiteContrast('#27467a'), '#27467a');
    assert.equal(ensureWhiteContrast('nada'), null);
    assert.equal(ensureWhiteContrast(null), null);
  });
});

describe('pickDominantColor', () => {
  test('gana el color saturado aunque haya más píxeles grises', () => {
    const data = pixels([200, 30, 40, 255, 40], [128, 128, 128, 255, 60]);
    assert.equal(pickDominantColor(data), '#c81e28');
  });

  test('sin color saturado, gana el más abundante', () => {
    const data = pixels([20, 20, 20, 255, 30], [230, 230, 230, 255, 10]);
    assert.equal(pickDominantColor(data), '#141414');
  });

  test('ignora los píxeles transparentes; si no queda ninguno, null', () => {
    assert.equal(pickDominantColor(pixels([0, 200, 0, 0, 50], [10, 20, 200, 255, 1])), '#0a14c8');
    assert.equal(pickDominantColor(pixels([255, 0, 0, 10, 20])), null);
    assert.equal(pickDominantColor([]), null);
  });
});
