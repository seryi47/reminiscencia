// Regla común de búsqueda (ADR-0028): todos los buscadores de la web (js/catalog.js) dan los resultados de
// tests/contrato/busqueda.json, que ejecuta también la APK (mobile/test/busqueda_contrato_test.dart).
// Ejecución: node --test tests/web-unit/busqueda-contrato.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

import {
  buildCatalog,
  filterSongs,
  FOLD_FROM,
  FOLD_TO,
  folderSearchFields,
  normalizeText,
  SEARCH_BONUS,
  SEARCH_FIELD_WEIGHTS,
  SEARCH_POINTS,
  SEARCH_TYPO_MIN_LENGTH,
  searchCatalog,
  searchRank,
  searchScore,
  songSearchFields,
  songsToAddToAlbum,
  wordPoints,
} from '../../frontend/web/js/catalog.js';

const CONTRATO = JSON.parse(readFileSync(new URL('../contrato/busqueda.json', import.meta.url), 'utf8'));
const DUPLICADOS = JSON.parse(readFileSync(new URL('../contrato/duplicados.json', import.meta.url), 'utf8'));

// El catálogo de la web, a partir de las canciones y los álbumes del contrato (con los nombres de data/*.json).
const catalog = buildCatalog(
  CONTRATO.canciones.map((song) => ({ ...song, duration_s: 100, audio: `audio/${song.id}.opus`, license: 'CC0' })),
  CONTRATO.albumes,
);
const songs = catalog.songs;
const albumNameOf = (song) => (song.folderId ? catalog.folderById.get(song.folderId)?.name ?? '' : '');
const ids = (items) => items.map((item) => item.id);
// Un álbum que no tiene ninguna canción: «Añadir canciones» ofrece todas.
const OTHER_FOLDER = 'F00000000000000ff';

describe('contrato común de búsqueda: datos de la regla', () => {
  test('puntos, pesos, bonus y errata son los del contrato', () => {
    assert.deepEqual({ ...SEARCH_POINTS }, { exact: CONTRATO.puntos.exacta, prefix: CONTRATO.puntos.prefijo, typo: CONTRATO.puntos.errata });
    assert.deepEqual([...SEARCH_FIELD_WEIGHTS], CONTRATO.pesos_campos);
    assert.deepEqual({ ...SEARCH_BONUS }, { equal: CONTRATO.bonus.igual, startsWith: CONTRATO.bonus.empieza });
    assert.equal(SEARCH_TYPO_MIN_LENGTH, CONTRATO.errata_min_caracteres);
  });

  test('el pliegue es el del contrato y el mismo que el de duplicados', () => {
    assert.equal(FOLD_FROM, CONTRATO.pliegue.de);
    assert.equal(FOLD_TO, CONTRATO.pliegue.a);
    assert.deepEqual(CONTRATO.pliegue, DUPLICADOS.pliegue);
  });

  test('normalización', () => {
    for (const { entrada, salida } of CONTRATO.normalizar) assert.equal(normalizeText(entrada), salida, JSON.stringify(entrada));
  });

  test('puntos de una palabra', () => {
    for (const { consulta, palabra, puntos } of CONTRATO.palabras) assert.equal(wordPoints(consulta, palabra), puntos, `${consulta} / ${palabra}`);
  });

  test('puntuaciones de canciones', () => {
    for (const { consulta, id, puntos } of CONTRATO.puntuaciones) {
      const song = catalog.songById.get(id);
      assert.equal(searchScore(songSearchFields(song, albumNameOf(song)), consulta), puntos, `${consulta} / ${id}`);
    }
  });
});

describe('contrato común de búsqueda: todos los buscadores dan el mismo resultado', () => {
  for (const { consulta, resultado } of CONTRATO.busquedas) {
    test(JSON.stringify(consulta), () => {
      assert.deepEqual(ids(searchRank(songs, consulta, (song) => songSearchFields(song, albumNameOf(song)))), resultado, 'searchRank');
      assert.deepEqual(ids(filterSongs(songs, consulta, albumNameOf)), resultado, 'filterSongs (Buscar en esta colección)');
      assert.deepEqual(ids(songsToAddToAlbum(songs, OTHER_FOLDER, consulta, { albumNameOf })), resultado, 'songsToAddToAlbum');
      // Buscar y «Busquemos algo para tu lista» (collection.js filtra después las que ya están en la lista).
      assert.deepEqual(ids(searchCatalog(catalog, consulta).songs), resultado, 'searchCatalog');
    });
  }

  test('sin texto que buscar, los filtros devuelven todo en su orden y Buscar nada', () => {
    for (const consulta of CONTRATO.sin_texto) {
      assert.deepEqual(ids(filterSongs(songs, consulta, albumNameOf)), ids(songs), JSON.stringify(consulta));
      assert.deepEqual(ids(songsToAddToAlbum(songs, OTHER_FOLDER, consulta, { albumNameOf })), ids(songs), JSON.stringify(consulta));
      assert.deepEqual(searchCatalog(catalog, consulta).songs, [], JSON.stringify(consulta));
    }
  });

  for (const { consulta, resultado } of CONTRATO.busquedas_albumes) {
    test(`álbumes: ${JSON.stringify(consulta)}`, () => {
      assert.deepEqual(ids(searchRank(catalog.folders, consulta, folderSearchFields)), resultado, 'searchRank');
      assert.deepEqual(ids(searchCatalog(catalog, consulta).folders), resultado, 'searchCatalog');
    });
  }
});
