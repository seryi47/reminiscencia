// Pruebas de la portada propia de una lista (frontend/web/js/cover-image.js): recorte cuadrado centrado, tamaño
// de salida de 640 px como mucho y archivos admitidos. Sin navegador.
// Ejecución: node --test tests/web-unit/cover-image.test.mjs
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { COVER_INPUT_ACCEPT, COVER_MAX_PX, coverFileProblem, squareCrop } from '../../frontend/web/js/cover-image.js';

describe('squareCrop', () => {
  test('recorta al centro el lado largo y reduce a 640 px', () => {
    assert.equal(COVER_MAX_PX, 640);
    assert.deepEqual(squareCrop(1920, 1080), { sx: 420, sy: 0, size: 1080, out: 640 });
    assert.deepEqual(squareCrop(600, 900), { sx: 0, sy: 150, size: 600, out: 600 });
    assert.deepEqual(squareCrop(640, 640), { sx: 0, sy: 0, size: 640, out: 640 });
    assert.deepEqual(squareCrop(301, 300), { sx: 0, sy: 0, size: 300, out: 300 });
  });

  test('una imagen sin tamaño no se puede recortar', () => {
    assert.throws(() => squareCrop(0, 100), RangeError);
    assert.throws(() => squareCrop(100, Number.NaN), RangeError);
  });
});

describe('coverFileProblem', () => {
  test('admite JPG, PNG y WebP de hasta 20 MB', () => {
    assert.equal(COVER_INPUT_ACCEPT, 'image/jpeg,image/png,image/webp');
    assert.equal(coverFileProblem({ type: 'image/png', size: 1000 }), null);
    assert.match(coverFileProblem({ type: 'image/gif', size: 1000 }), /JPG, PNG o WebP/);
    assert.match(coverFileProblem({ type: 'image/svg+xml', size: 10 }), /JPG, PNG o WebP/);
    assert.match(coverFileProblem({ type: 'image/jpeg', size: 21 * 1024 * 1024 }), /20 MB/);
    assert.match(coverFileProblem(null), /Elige una imagen/);
  });
});
