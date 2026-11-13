// Regla común de presencia en biblioteca (ADR-0046): la web (frontend/web/js/library-match.js) tiene los mismos datos y da
// los mismos resultados que tests/contrato/biblioteca-match.json, que lee también la APK (mobile/test/library_match_test.dart).
// Ejecución: node --test tests/web-unit/library-match.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

import {
  LIBRARY_MATCH_TOLERANCE_S,
  NEUTRAL_VERSION_TAGS,
  libraryTitleKey,
  isSameLibraryTrack,
} from '../../frontend/web/js/library-match.js';

const CONTRATO = JSON.parse(readFileSync(new URL('../contrato/biblioteca-match.json', import.meta.url), 'utf8'));
const side = (item) => ({ title: item.title, artist: item.artist, durationS: item.duration_s });

describe('contrato de presencia en biblioteca', () => {
  test('los datos son exactamente los del contrato', () => {
    assert.equal(LIBRARY_MATCH_TOLERANCE_S, CONTRATO.tolerancia_s);
    assert.deepEqual([...NEUTRAL_VERSION_TAGS], CONTRATO.etiquetas_neutras);
  });

  test('la clave de título es la del contrato', () => {
    assert.ok(CONTRATO.clave_titulo.length > 0);
    for (const caso of CONTRATO.clave_titulo) {
      assert.equal(libraryTitleKey(caso.entrada), caso.salida, `clave de «${caso.entrada}»`);
    }
  });

  test('los casos dan el resultado del contrato, en los dos sentidos', () => {
    assert.ok(CONTRATO.casos.length > 0);
    for (const caso of CONTRATO.casos) {
      const a = side(caso.a);
      const b = side(caso.b);
      assert.equal(isSameLibraryTrack(a, b), caso.esperado, `${caso.nota} (a,b)`);
      assert.equal(isSameLibraryTrack(b, a), caso.esperado, `${caso.nota} (b,a)`);
    }
  });
});

describe('isSameLibraryTrack: casos de regresión del usuario', () => {
  test('un «Remastered» en la biblioteca no hace que la pista aparezca como que falta', () => {
    const spotify = { title: 'Clocks', artist: 'Coldplay', durationS: 307 };
    const library = { title: 'Clocks (Remastered 2011)', artist: 'Coldplay', durationS: 307 };
    assert.equal(isSameLibraryTrack(spotify, library), true);
  });
  test('un «feat.» de más en el artista de la biblioteca no la cuenta como que falta', () => {
    const spotify = { title: 'Dakiti', artist: 'Bad Bunny', durationS: 205 };
    const library = { title: 'Dakiti', artist: 'Bad Bunny, Jhay Cortez', durationS: 230 };
    assert.equal(isSameLibraryTrack(spotify, library), true);
  });
  test('una versión en directo NO cuenta como que ya la tienes', () => {
    const spotify = { title: 'Fix You', artist: 'Coldplay', durationS: 295 };
    const library = { title: 'Fix You (Live)', artist: 'Coldplay', durationS: 300 };
    assert.equal(isSameLibraryTrack(spotify, library), false);
  });
});
