// Pruebas del índice de portadas de R2 (frontend/web/js/cover-index.js; ADR-0029): formato de los ficheros, lectura
// tolerante del índice, superposición al catálogo (el índice manda), regla de «reflejada» y lectura sin caché.
// Ejecución: node --test tests/web-unit/cover-index.test.mjs
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { buildCatalog, normalizeCoverPath } from '../../frontend/web/js/catalog.js';
import {
  applyCoverIndex,
  COVER_INDEX_URL,
  coverKeyFor,
  coverUrl,
  fetchCoverIndex,
  isCoverKey,
  isCoverReflected,
  parseCoverIndex,
  serializeCoverIndex,
} from '../../frontend/web/js/cover-index.js';
import { AUDIO_ORIGIN } from '../../frontend/web/js/offline-core.js';

const S1 = 'S0000000000000001';
const F1 = 'F0000000000000001';
const KS = `portadas/${S1}-0123456789abcdef.jpg`;
const KF = `portadas/${F1}-fedcba9876543210.jpg`;

describe('ficheros de portada', () => {
  test('coverKeyFor e isCoverKey', () => {
    assert.equal(coverKeyFor(S1, '0123456789abcdef'), KS);
    assert.throws(() => coverKeyFor('S1', '0123456789abcdef'));
    assert.throws(() => coverKeyFor(S1, 'XYZ'));
    assert.ok(isCoverKey(KS));
    assert.ok(isCoverKey(KS, S1));
    assert.ok(!isCoverKey(KS, F1));
    for (const bad of ['portadas/../x.jpg', `covers/${S1}.jpg`, `portadas/${S1}.jpg`, `portadas/${S1}-0123456789ABCDEF.jpg`, `/${KS}`, null, 7]) {
      assert.ok(!isCoverKey(bad), String(bad));
    }
    assert.equal(coverUrl(KS), `${AUDIO_ORIGIN}/${KS}`);
    assert.equal(COVER_INDEX_URL, `${AUDIO_ORIGIN}/portadas/indice.json`);
  });
});

describe('índice', () => {
  test('parseCoverIndex descarta lo que no vale y nunca lanza', () => {
    const index = parseCoverIndex(JSON.stringify({
      [S1]: KS,
      [F1]: KF,
      S0000000000000002: KS, // fichero de otro id
      'S1': KS,
      F0000000000000003: 'https://malo.example/x.jpg',
      F0000000000000004: 12,
    }));
    assert.deepEqual(Object.fromEntries(index), { [S1]: KS, [F1]: KF });
    assert.equal(parseCoverIndex('{roto').size, 0);
    assert.equal(parseCoverIndex('[1,2]').size, 0);
    assert.equal(parseCoverIndex(null).size, 0);
    assert.equal(parseCoverIndex({ [S1]: KS }).get(S1), KS);
  });

  test('serializeCoverIndex ordena las claves y se vuelve a leer igual', () => {
    const text = serializeCoverIndex(new Map([[S1, KS], [F1, KF]]));
    assert.ok(text.indexOf(F1) < text.indexOf(S1));
    assert.deepEqual(Object.fromEntries(parseCoverIndex(text)), { [F1]: KF, [S1]: KS });
  });

  test('applyCoverIndex: el índice manda sobre «cover», sin tocar las listas recibidas ni las canciones locales', () => {
    const songs = [{ id: S1, audio: 'audio/x.opus', cover: `covers/${S1}.jpg` }, { id: 'S0000000000000002', audio: 'audio/y.opus' }, { id: S1, local: true, audio: 'x' }];
    const folders = [{ id: F1, name: 'A' }];
    const before = JSON.stringify({ songs, folders });
    const view = applyCoverIndex(songs, folders, new Map([[S1, KS], [F1, KF]]));
    assert.equal(JSON.stringify({ songs, folders }), before);
    assert.equal(view.songs[0].cover, `${AUDIO_ORIGIN}/${KS}`);
    assert.equal(view.songs[1], songs[1]);
    assert.equal(view.songs[2], songs[2]);
    assert.equal(view.folders[0].cover, `${AUDIO_ORIGIN}/${KF}`);
    // Idempotente y sin índice no copia nada.
    assert.deepEqual(applyCoverIndex(view.songs, view.folders, new Map([[S1, KS], [F1, KF]])), view);
    assert.equal(applyCoverIndex(songs, folders, new Map()).songs, songs);
  });

  test('el catálogo de la web acepta la dirección de R2 del índice y nada más de fuera', () => {
    assert.equal(normalizeCoverPath(`${AUDIO_ORIGIN}/${KS}`), `${AUDIO_ORIGIN}/${KS}`);
    assert.equal(normalizeCoverPath(`covers/${S1}.jpg`), `covers/${S1}.jpg`);
    assert.equal(normalizeCoverPath(`https://malo.example/${KS}`), null);
    assert.equal(normalizeCoverPath(`${AUDIO_ORIGIN}/audio/x.jpg`), null);
    const view = applyCoverIndex([{ id: S1, audio: 'audio/x.opus' }], [], new Map([[S1, KS]]));
    assert.equal(buildCatalog(view.songs, view.folders).songById.get(S1).cover, `${AUDIO_ORIGIN}/${KS}`);
  });

  test('isCoverReflected: el fichero solo o con la dirección delante', () => {
    assert.ok(isCoverReflected(`${AUDIO_ORIGIN}/${KS}`, KS));
    assert.ok(isCoverReflected(KS, KS));
    assert.ok(!isCoverReflected(`covers/${S1}.jpg`, KS));
    assert.ok(!isCoverReflected(`${AUDIO_ORIGIN}/x${KS}`, KS));
    assert.ok(!isCoverReflected(null, KS));
    assert.ok(!isCoverReflected(KS, ''));
  });
});

describe('fetchCoverIndex', () => {
  test('pide sin caché, lee el índice y un 404 es un índice vacío', async () => {
    let seen;
    const index = await fetchCoverIndex(async (url, init) => {
      seen = { url, init };
      return new Response(JSON.stringify({ [S1]: KS }), { status: 200 });
    });
    assert.equal(seen.url, COVER_INDEX_URL);
    assert.equal(seen.init.cache, 'no-store');
    assert.equal(index.get(S1), KS);
    assert.equal((await fetchCoverIndex(async () => new Response('no', { status: 404 }))).size, 0);
  });

  test('otro error o sin red lanza (quien llama sigue sin superponer)', async () => {
    await assert.rejects(fetchCoverIndex(async () => new Response('x', { status: 500 })));
    await assert.rejects(fetchCoverIndex(async () => { throw new TypeError('fetch failed'); }));
  });
});
