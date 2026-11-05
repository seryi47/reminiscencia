// Orden de las canciones de un álbum y operación order_album (ADR-0026): número de pista en el catálogo de la web,
// validación igual que el backend (validate_payload y catalog.order_album), título y cuerpo de la incidencia, y
// /api/editar. Datos ficticios. Ejecución: node --test tests/web-unit/albumes-orden.test.mjs
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { ALLOWED_OPS, handleEdit } from '../../frontend/web/api/editar.js';
import { buildCatalog, normalizeSong, songsInFolder, sortByTrack } from '../../frontend/web/js/catalog.js';
import {
  buildIssueBody,
  buildIssueTitle,
  REQUEST_LIMITS,
  validateOperation,
  validateRequest,
} from '../../frontend/web/js/cuidador/incidencias.js';

const FOLDER = 'F0123456789abcdef';
const OLD_FOLDER = '0123456789';
const A = 'S000000000000000a';
const B = 'S000000000000000b';
const ids = (count) => Array.from({ length: count }, (_, index) => `S${index.toString(16).padStart(16, '0')}`);

const song = (id, extra = {}) => ({ id, title: `Tema ${id.slice(-2)}`, artist: '', folder_id: FOLDER, duration_s: 100, audio: `audio/${id}.opus`, ...extra });

describe('número de pista en el catálogo de la web', () => {
  test('solo vale un entero desde 1; lo demás es null', () => {
    assert.equal(normalizeSong(song(A, { track: 3 })).track, 3);
    for (const track of [0, -1, 2.5, '2', true, null, undefined, Number.NaN]) {
      assert.equal(normalizeSong(song(A, { track })).track, null, String(track));
    }
    // Una canción subida a este navegador no tiene número de pista.
    assert.equal(normalizeSong(song('L0011223344556677', { track: 1, local: true })).track, null);
  });

  test('un álbum se ordena por número de pista y, sin número, por el orden de antes', () => {
    const catalog = buildCatalog([
      song('S0000000000000001', { title: 'a' }),
      song('S0000000000000002', { title: 'b', track: 2 }),
      song('S0000000000000003', { title: 'c', folder_id: null }),
      song('S0000000000000004', { title: 'd', track: 1 }),
      song('S0000000000000005', { title: 'e' }),
    ], [{ id: FOLDER, name: 'Álbum', parent_id: null }]);
    assert.deepEqual(songsInFolder(catalog, FOLDER).map((item) => item.title), ['d', 'b', 'a', 'e']);
  });

  test('con el mismo número (catálogo a medias), manda el orden de antes', () => {
    const songs = [{ track: 1, order: 2, t: 'x' }, { track: 1, order: 0, t: 'y' }, { track: null, order: 1, t: 'z' }];
    assert.deepEqual(sortByTrack(songs).map((item) => item.t), ['y', 'x', 'z']);
  });

  test('un catálogo sin números (anterior a ADR-0026) conserva el orden de hoy', () => {
    const catalog = buildCatalog([song(B, { title: 'Beta' }), song(A, { title: 'Alfa' })], [{ id: FOLDER, name: 'X', parent_id: null }]);
    assert.deepEqual(songsInFolder(catalog, FOLDER).map((item) => item.id), [B, A]);
  });
});

describe('order_album (validate_payload del backend)', () => {
  test('admite la lista en el orden nuevo, también con un álbum antiguo de 10 hexadecimales', () => {
    assert.equal(validateOperation({ op: 'order_album', folder_id: FOLDER, song_ids: [B, A] }), null);
    assert.equal(validateOperation({ op: 'order_album', folder_id: OLD_FOLDER, song_ids: [A] }), null);
    assert.equal(validateOperation({ op: 'order_album', folder_id: FOLDER, song_ids: ids(190) }), null);
    assert.equal(REQUEST_LIMITS.orderSongs, 190);
  });

  test('rechaza listas e identificadores que el backend rechaza', () => {
    const cases = [
      [{ op: 'order_album', folder_id: FOLDER, song_ids: [] }, /no tiene canciones que ordenar/],
      [{ op: 'order_album', folder_id: FOLDER, song_ids: ids(191) }, /Se pueden ordenar 190 canciones como mucho/],
      [{ op: 'order_album', folder_id: FOLDER, song_ids: [A, B, A] }, /repetidas en el orden/],
      [{ op: 'order_album', folder_id: FOLDER, song_ids: [A, 'L0011223344556677'] }, /identificador de la canción/],
      [{ op: 'order_album', folder_id: FOLDER, song_ids: [7] }, /identificador de la canción/],
      [{ op: 'order_album', folder_id: FOLDER, song_ids: A }, /deben ser una lista/],
      [{ op: 'order_album', folder_id: null, song_ids: [A] }, /identificador del álbum/],
      [{ op: 'order_album', folder_id: 'F12', song_ids: [A] }, /identificador del álbum/],
      [{ op: 'order_album', song_ids: [A] }, /Falta el campo folder_id/],
      [{ op: 'order_album', folder_id: FOLDER }, /Falta el campo song_ids/],
      [{ op: 'order_album', folder_id: FOLDER, song_ids: [A], track: 1 }, /no está permitido/],
    ];
    for (const [payload, message] of cases) assert.match(validateOperation(payload) ?? '', message, JSON.stringify(payload).slice(0, 80));
  });

  test('190 canciones caben en el payload de 4000 caracteres y en la petición', () => {
    const request = { action: 'organize', payload: { op: 'order_album', folder_id: FOLDER, song_ids: ids(190) } };
    assert.equal(validateRequest(request), null);
    assert.equal(JSON.stringify(request.payload).length, 65 + 20 * 190);
  });

  test('título y cuerpo de la incidencia (el cuerpo lo acepta parse_request del backend)', () => {
    const request = { action: 'organize', payload: { op: 'order_album', folder_id: FOLDER, song_ids: [B, A] } };
    assert.equal(buildIssueTitle(request), `Ordenar el álbum ${FOLDER}`);
    // El mismo texto está en backend/tests/test_order_album.py (test_the_bodies_written_by_the_web_and_the_apk_are_accepted).
    assert.equal(
      buildIssueBody(request),
      'action: organize\npayload: {"op":"order_album","folder_id":"F0123456789abcdef","song_ids":["S000000000000000b","S000000000000000a"]}',
    );
  });
});

describe('/api/editar admite order_album', () => {
  const env = { GITHUB_TOKEN: 'token-de-prueba' };
  const request = (payload) => new Request('https://x.test/api/editar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'organize', payload }),
  });
  const github = () => {
    const calls = [];
    const fetchImpl = async (url, options) => {
      calls.push(JSON.parse(options.body));
      return new Response(JSON.stringify({ number: 9 }), { status: 201 });
    };
    return { calls, fetchImpl };
  };

  test('está en ALLOWED_OPS y abre una sola incidencia', async () => {
    assert.ok(ALLOWED_OPS.includes('order_album'));
    const gh = github();
    const payload = { op: 'order_album', folder_id: FOLDER, song_ids: [B, A] };
    const response = await handleEdit(request(payload), { env, fetchImpl: gh.fetchImpl });
    assert.equal(response.status, 200);
    assert.equal(gh.calls.length, 1);
    assert.equal(gh.calls[0].title, `Ordenar el álbum ${FOLDER}`);
    assert.equal(gh.calls[0].body, `action: organize\npayload: ${JSON.stringify(payload)}`);
  });

  test('un order_album mal formado no llega a GitHub', async () => {
    for (const payload of [
      { op: 'order_album', folder_id: FOLDER, song_ids: [] },
      { op: 'order_album', folder_id: FOLDER, song_ids: [A, A] },
      { op: 'order_album', folder_id: null, song_ids: [A] },
      { op: 'order_album', folder_id: FOLDER, song_ids: ids(191) },
    ]) {
      const gh = github();
      const response = await handleEdit(request(payload), { env, fetchImpl: gh.fetchImpl });
      assert.equal(response.status, 400);
      assert.equal(gh.calls.length, 0);
    }
  });
});
