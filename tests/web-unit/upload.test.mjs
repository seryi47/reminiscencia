// Pruebas de la lógica de la hoja «Subir canciones» (frontend/web/js/views/upload.js) que no necesita navegador:
// el resumen tras subir (ADR-0017), que la web no conoce tokens ni la API de GitHub, y la doble validación de
// «Importar desde Internet Archive» (incidencias.js e intake.js).
// Ejecución: node --test tests/web-unit/upload.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

import { evaluateArchiveForm, summaryText } from '../../frontend/web/js/views/upload.js';

describe('Subir canciones (para todos)', () => {
  test('el resumen dice cuántas se han subido y cuántas no', () => {
    assert.equal(summaryText({ sent: 0, failed: 0 }), '');
    assert.equal(summaryText({ sent: 1, failed: 0 }), 'Subida: llegará a todos en un par de minutos.');
    assert.equal(summaryText({ sent: 3, failed: 0 }), '3 canciones subidas: llegarán a todos en un par de minutos.');
    assert.equal(summaryText({ sent: 2, failed: 1 }), '2 canciones subidas: llegarán a todos en un par de minutos. Un archivo no se ha podido subir.');
    assert.equal(summaryText({ sent: 0, failed: 1 }), 'No se ha podido subir el archivo.');
    assert.equal(summaryText({ sent: 0, failed: 4 }), 'No se ha podido subir ninguno de los 4 archivos.');
  });

  test('la hoja ya no ofrece «Solo en este navegador» ni «Para todos», y lleva el texto de derechos sin casilla', () => {
    const source = readFileSync(new URL('../../frontend/web/js/views/upload.js', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /Solo en este navegador|Para todos|addLocalFiles|type: 'checkbox'/);
    assert.match(source, /RIGHTS_TEXT/);
  });

  test('el código del navegador no usa tokens ni la API de GitHub: solo habla con /api/subir', () => {
    for (const file of ['views/upload.js', 'app.js', 'cuidador/incidencias.js', 'cuidador/subida-publica.js', 'cuidador/subida-local.js']) {
      const source = readFileSync(new URL(`../../frontend/web/js/${file}`, import.meta.url), 'utf8');
      assert.doesNotMatch(source, /api\.github\.com/, file);
      assert.doesNotMatch(source, /Authorization|access_token|ghp_|github_pat_|GITHUB_TOKEN/i, file);
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
