// Regla común de «posible duplicado» (ADR-0026): la web (frontend/web/js/duplicates.js) tiene los mismos datos y da los
// mismos resultados que tests/contrato/duplicados.json, que leen también el backend y la APK.
// Ejecución: node --test tests/web-unit/duplicados.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

import {
  DUPLICATE_TAGS,
  DUPLICATE_TOLERANCE_S,
  duplicateMessage,
  FEATURING_MARKS,
  findUploadDuplicates,
  FOLD_FROM,
  FOLD_TO,
  isPossibleDuplicate,
  normalizeDuplicateArtist,
  normalizeDuplicateTitle,
} from '../../frontend/web/js/duplicates.js';

const CONTRATO = JSON.parse(readFileSync(new URL('../contrato/duplicados.json', import.meta.url), 'utf8'));
// El contrato usa los nombres del backend (duration_s); la web, durationS.
const side = (item) => ({ title: item.title, artist: item.artist, durationS: item.duration_s });

describe('contrato común de duplicados', () => {
  test('los datos de la regla son exactamente los del contrato', () => {
    assert.equal(DUPLICATE_TOLERANCE_S, CONTRATO.tolerancia_s);
    assert.equal(FOLD_FROM, CONTRATO.pliegue.de);
    assert.equal(FOLD_TO, CONTRATO.pliegue.a);
    assert.equal([...FOLD_FROM].length, [...FOLD_TO].length);
    assert.deepEqual([...DUPLICATE_TAGS], CONTRATO.etiquetas);
    assert.deepEqual([...FEATURING_MARKS], CONTRATO.marcas_featuring);
  });

  test('normalización del título', () => {
    for (const { entrada, salida } of CONTRATO.normalizar_titulo) assert.equal(normalizeDuplicateTitle(entrada), salida, entrada);
  });

  test('normalización del artista', () => {
    for (const { entrada, salida } of CONTRATO.normalizar_artista) assert.equal(normalizeDuplicateArtist(entrada), salida, entrada);
  });

  test('cada caso, en los dos sentidos', () => {
    for (const caso of CONTRATO.casos) {
      assert.equal(isPossibleDuplicate(side(caso.a), side(caso.b)), caso.duplicado, caso.nota);
      assert.equal(isPossibleDuplicate(side(caso.b), side(caso.a)), caso.duplicado, caso.nota);
    }
  });

  test('valores raros cuentan como que faltan', () => {
    assert.equal(normalizeDuplicateTitle(null), '');
    assert.equal(normalizeDuplicateArtist(12), '');
    assert.equal(isPossibleDuplicate({ title: 'Tema', artist: 'X', durationS: Infinity }, { title: 'Tema', artist: 'x', durationS: '200' }), true);
    assert.equal(isPossibleDuplicate({ title: 'Tema', artist: 'X', durationS: Infinity }, { title: 'Tema', artist: 'Y', durationS: 200 }), false);
  });
});

describe('aviso al subir', () => {
  const library = [
    { title: 'Corazón de mimbre', artist: 'Marea', durationS: 201.4 },
    { title: 'Sin duración', artist: '', durationS: null },
  ];

  test('cada archivo se compara con la biblioteca y con los anteriores de la tanda', () => {
    const batch = [
      { title: 'Corazon de mimbre (Official Video)', artist: '', durationS: 202 },
      { title: 'Nueva', artist: '', durationS: 90 },
      { title: 'Nueva [HD]', artist: '', durationS: 91 },
      { title: 'Otra', artist: '', durationS: 90 },
      { title: 'sin duracion', artist: '', durationS: null },
    ];
    const found = findUploadDuplicates(batch, library);
    assert.deepEqual(found.map((item) => [item.index, item.inBatch, item.match.title]), [
      [0, false, 'Corazón de mimbre'],
      [2, true, 'Nueva'],
      [4, false, 'Sin duración'],
    ]);
  });

  test('si se parece a la biblioteca y a la tanda, manda la biblioteca', () => {
    const batch = [{ title: 'Corazón de mimbre', durationS: 201 }, { title: 'Corazón de mimbre', durationS: 201 }];
    assert.deepEqual(findUploadDuplicates(batch, library).map((item) => item.inBatch), [false, false]);
  });

  test('el mensaje lleva el título y la duración (sin duración si no se sabe)', () => {
    assert.equal(duplicateMessage({ match: library[0], inBatch: false }),
      'Parece que ya está en la biblioteca: «Corazón de mimbre» (3:21). ¿Subirla igualmente?');
    assert.equal(duplicateMessage({ match: { title: 'Nueva', durationS: 90 }, inBatch: true }),
      'Parece repetida en esta subida: «Nueva» (1:30). ¿Subirla igualmente?');
    assert.equal(duplicateMessage({ match: library[1], inBatch: false }),
      'Parece que ya está en la biblioteca: «Sin duración». ¿Subirla igualmente?');
  });
});
