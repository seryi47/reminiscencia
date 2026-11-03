// Pruebas de la lógica de la hoja «Subir canciones» (frontend/web/js/views/upload.js) que no necesita navegador:
// la dirección de la subida a GitHub y la doble validación de «Desde Internet Archive» (incidencias.js e intake.js).
// Ejecución: node --test tests/web-unit/upload.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

import { evaluateArchiveForm, GITHUB_UPLOAD_URL } from '../../frontend/web/js/views/upload.js';

describe('«Para todos»', () => {
  test('abre la subida de GitHub al buzón de la biblioteca en main', () => {
    assert.equal(GITHUB_UPLOAD_URL, 'https://github.com/seryi47/reminiscencia/upload/main/audio-library/buzon');
  });

  test('la web no usa tokens ni la API de GitHub', () => {
    for (const file of ['views/upload.js', 'app.js', 'cuidador/incidencias.js']) {
      const source = readFileSync(new URL(`../../frontend/web/js/${file}`, import.meta.url), 'utf8');
      assert.doesNotMatch(source, /api\.github\.com/, file);
      assert.doesNotMatch(source, /Authorization|access_token|ghp_/i, file);
    }
  });
});

describe('«Desde Internet Archive»', () => {
  test('un ítem de Internet Archive vale sin licencia', () => {
    const result = evaluateArchiveForm({ url: 'https://archive.org/details/ejemplo-de-prueba', license: '', title: '' });
    assert.deepEqual(result.errors, {});
    assert.equal(result.request.url, 'https://archive.org/details/ejemplo-de-prueba');
  });

  test('un fichero directo exige licencia', () => {
    const result = evaluateArchiveForm({ url: 'https://ejemplo.org/tema.mp3', license: '', title: '' });
    assert.equal(result.request, null);
    assert.ok(result.errors.license);
    assert.ok(evaluateArchiveForm({ url: 'https://ejemplo.org/tema.mp3', license: 'CC BY 4.0', title: '' }).request);
  });

  test('las plataformas de la lista de bloqueo se rechazan', () => {
    for (const url of ['https://www.youtube.com/watch?v=x', 'https://open.spotify.com/track/x', 'https://soundcloud.com/a/b.mp3']) {
      const result = evaluateArchiveForm({ url, license: 'CC0', title: '' });
      assert.equal(result.request, null, url);
      assert.match(result.errors.url, /no se puede importar/, url);
    }
  });

  test('una dirección privada o sin https no pasa', () => {
    assert.equal(evaluateArchiveForm({ url: 'https://192.168.1.10/a.mp3', license: 'CC0' }).request, null);
    assert.equal(evaluateArchiveForm({ url: 'http://archive.org/details/x' }).request, null);
  });
});
