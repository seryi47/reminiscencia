// Pruebas de POST /api/editar (frontend/web/api/editar.js; ADR-0022) con GitHub simulado: incidencias de organizar
// (validación, operaciones permitidas, etiqueta) y portadas JPEG (tamaño, firma, id, reemplazo), y el token fuera de las
// respuestas. Sin red. Ejecución: node --test tests/web-unit/api-editar.test.mjs
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  ALLOWED_OPS, DONE_MESSAGE, editStateOf, handleEdit, isJpeg, issueNumberFrom, MAX_COVER_BYTES, organizeProblem,
} from '../../frontend/web/api/editar.js';

const TOKEN = 'github_pat_PRUEBA_que_no_debe_salir_nunca';
const ENV = { GITHUB_TOKEN: TOKEN };
const SONG = 'S0000000000000004';
const FOLDER = 'F0000000000000002';
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);

function fakeGitHub({ failWith = null, existingSha = null } = {}) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    const path = new URL(url).pathname.replace('/repos/seryi47/reminiscencia', '');
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ method: options.method, path, body, auth: options.headers.Authorization });
    const reply = (status, data) => new Response(JSON.stringify(data), { status });
    if (failWith) return reply(failWith, { message: 'no' });
    if (options.method === 'POST' && path === '/issues') return reply(201, { number: 77 });
    if (options.method === 'GET' && path.startsWith('/contents/')) return existingSha ? reply(200, { sha: existingSha }) : reply(404, {});
    if (options.method === 'PUT' && path.startsWith('/contents/')) return reply(existingSha ? 200 : 201, {});
    return reply(500, {});
  };
  return { fetchImpl, calls };
}

const jsonRequest = (body, method = 'POST') => new Request('https://x.test/api/editar', {
  method,
  headers: { 'Content-Type': 'application/json' },
  body: method === 'POST' ? JSON.stringify(body) : undefined,
});
const coverRequest = (bytes, id = SONG, type = 'image/jpeg') => new Request('https://x.test/api/editar', {
  method: 'POST',
  headers: { 'Content-Type': type, 'X-Portada-Id': id },
  body: bytes,
});

describe('organizar', () => {
  test('crea la incidencia con la etiqueta «biblioteca» y el formato del backend', async () => {
    const gh = fakeGitHub();
    const payload = { op: 'edit_song', song_id: SONG, title: 'Nuevo título' };
    const response = await handleEdit(jsonRequest({ action: 'organize', payload }), { env: ENV, fetchImpl: gh.fetchImpl });
    assert.equal(response.status, 200);
    const reply = await response.json();
    assert.deepEqual([reply.ok, reply.incidencia, reply.mensaje], [true, 77, DONE_MESSAGE]);
    assert.equal(gh.calls.length, 1);
    const [call] = gh.calls;
    assert.equal(call.path, '/issues');
    assert.deepEqual(call.body.labels, ['biblioteca']);
    assert.match(call.body.body, /^action: organize\npayload: \{"op":"edit_song","song_id":"S0000000000000004","title":"Nuevo título"\}$/);
    assert.ok(!JSON.stringify(reply).includes(TOKEN));
  });

  test('admite crear, editar y renombrar álbumes', async () => {
    for (const payload of [
      { op: 'create_folder', name: 'Valses' },
      { op: 'edit_folder', folder_id: FOLDER, name: 'Otro', artist: 'Alguien' },
      { op: 'rename_folder', folder_id: FOLDER, name: 'Otro' },
      { op: 'edit_song', song_id: SONG, folder_id: FOLDER },
    ]) {
      const gh = fakeGitHub();
      const response = await handleEdit(jsonRequest({ action: 'organize', payload }), { env: ENV, fetchImpl: gh.fetchImpl });
      assert.equal(response.status, 200, JSON.stringify(payload));
    }
  });

  test('rechaza borrar álbumes, publicar, importar y peticiones mal formadas sin llamar a GitHub', async () => {
    const casos = [
      { action: 'organize', payload: { op: 'delete_folder', folder_id: FOLDER } },
      { action: 'organize', payload: { op: 'edit_song', song_id: SONG, public: true } },
      { action: 'import', url: 'https://archive.org/details/x' },
      { action: 'organize', payload: { op: 'edit_song', song_id: 'nope', title: 'x' } },
      { action: 'organize', payload: { op: 'edit_song', song_id: SONG, title: '' } },
      { action: 'organize', payload: { op: 'edit_song', song_id: SONG } },
      { action: 'organize' },
      null,
    ];
    for (const caso of casos) {
      const gh = fakeGitHub();
      const response = await handleEdit(jsonRequest(caso), { env: ENV, fetchImpl: gh.fetchImpl });
      assert.equal(response.status, 400, JSON.stringify(caso));
      assert.equal(gh.calls.length, 0);
    }
  });

  test('admite move_songs (varias canciones a un álbum en una sola incidencia)', async () => {
    assert.deepEqual([...ALLOWED_OPS], ['create_folder', 'edit_folder', 'rename_folder', 'edit_song', 'unpublish_song', 'move_songs', 'order_album', 'clean_titles']);
    const gh = fakeGitHub();
    const payload = { op: 'move_songs', song_ids: [SONG, 'S0000000000000005'], folder_id: FOLDER };
    const response = await handleEdit(jsonRequest({ action: 'organize', payload }), { env: ENV, fetchImpl: gh.fetchImpl });
    assert.equal(response.status, 200);
    assert.equal(gh.calls.length, 1);
    const [call] = gh.calls;
    assert.equal(call.body.title, `Añadir 2 canciones al álbum ${FOLDER}`);
    assert.deepEqual(call.body.labels, ['biblioteca']);
    assert.equal(call.body.body, `action: organize\npayload: ${JSON.stringify(payload)}`);
    // Sacar canciones de su álbum (folder_id null) también vale.
    const out = await handleEdit(jsonRequest({ action: 'organize', payload: { op: 'move_songs', song_ids: [SONG], folder_id: null } }), { env: ENV, fetchImpl: fakeGitHub().fetchImpl });
    assert.equal(out.status, 200);
  });

  test('admite clean_titles (ADR-0032): todas las canciones o una lista, en una sola incidencia', async () => {
    const gh = fakeGitHub();
    const payload = { op: 'clean_titles' };
    const response = await handleEdit(jsonRequest({ action: 'organize', payload }), { env: ENV, fetchImpl: gh.fetchImpl });
    assert.equal(response.status, 200);
    assert.equal(gh.calls.length, 1);
    const [call] = gh.calls;
    assert.equal(call.body.title, 'Limpiar los títulos de todas las canciones');
    assert.deepEqual(call.body.labels, ['biblioteca']);
    assert.equal(call.body.body, 'action: organize\npayload: {"op":"clean_titles"}');

    const some = fakeGitHub();
    const list = { op: 'clean_titles', song_ids: [SONG] };
    const out = await handleEdit(jsonRequest({ action: 'organize', payload: list }), { env: ENV, fetchImpl: some.fetchImpl });
    assert.equal(out.status, 200);
    assert.equal(some.calls[0].body.title, 'Limpiar los títulos de 1 canción');
    assert.equal(some.calls[0].body.body, `action: organize\npayload: ${JSON.stringify(list)}`);

    for (const bad of [{ op: 'clean_titles', song_ids: [] }, { op: 'clean_titles', song_ids: [SONG, SONG] }, { op: 'clean_titles', folder_id: FOLDER }]) {
      const none = fakeGitHub();
      const rejected = await handleEdit(jsonRequest({ action: 'organize', payload: bad }), { env: ENV, fetchImpl: none.fetchImpl });
      assert.equal(rejected.status, 400, JSON.stringify(bad));
      assert.equal(none.calls.length, 0);
    }
  });

  test('rechaza move_songs mal formado sin llamar a GitHub', async () => {
    for (const payload of [
      { op: 'move_songs', song_ids: [], folder_id: FOLDER },
      { op: 'move_songs', song_ids: [SONG, SONG], folder_id: FOLDER },
      { op: 'move_songs', song_ids: Array.from({ length: 101 }, (_, i) => `S${String(i).padStart(16, '0')}`), folder_id: FOLDER },
      { op: 'move_songs', song_ids: ['nope'], folder_id: FOLDER },
      { op: 'move_songs', song_ids: [SONG] },
    ]) {
      const gh = fakeGitHub();
      const response = await handleEdit(jsonRequest({ action: 'organize', payload }), { env: ENV, fetchImpl: gh.fetchImpl });
      assert.equal(response.status, 400, JSON.stringify(payload).slice(0, 80));
      assert.equal(gh.calls.length, 0);
    }
  });

  test('solo admite POST, exige el token y un JSON válido', async () => {
    assert.equal((await handleEdit(jsonRequest(null, 'PUT'), { env: ENV })).status, 405);
    assert.equal((await handleEdit(jsonRequest(null, 'DELETE'), { env: ENV })).status, 405);
    // GET sin número de incidencia: no es una consulta de estado válida.
    assert.equal((await handleEdit(jsonRequest(null, 'GET'), { env: ENV })).status, 400);
    assert.equal((await handleEdit(jsonRequest({}), { env: {} })).status, 500);
    const mal = new Request('https://x.test/api/editar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{no' });
    assert.equal((await handleEdit(mal, { env: ENV, fetchImpl: fakeGitHub().fetchImpl })).status, 400);
  });

  test('si el token no tiene permiso, explica qué falta y no filtra el token', async () => {
    const gh = fakeGitHub({ failWith: 403 });
    const original = console.error;
    console.error = () => {};
    const response = await handleEdit(jsonRequest({ action: 'organize', payload: { op: 'create_folder', name: 'A' } }), { env: ENV, fetchImpl: gh.fetchImpl });
    console.error = original;
    assert.equal(response.status, 500);
    const text = await response.text();
    assert.match(text, /Issues y Contents/);
    assert.ok(!text.includes(TOKEN));
  });

  test('organizeProblem', () => {
    assert.equal(organizeProblem({ action: 'organize', payload: { op: 'create_folder', name: 'A' } }), null);
    assert.match(organizeProblem({ action: 'organize', payload: { op: 'delete_folder', folder_id: FOLDER } }), /GitHub/);
  });
});

describe('portadas', () => {
  test('guarda el JPEG en el buzón de portadas con un commit en main', async () => {
    const gh = fakeGitHub();
    const response = await handleEdit(coverRequest(JPEG, FOLDER), { env: ENV, fetchImpl: gh.fetchImpl });
    assert.equal(response.status, 200);
    const put = gh.calls.find((call) => call.method === 'PUT');
    assert.equal(put.path, `/contents/audio-library/buzon/portadas/${FOLDER}.jpg`);
    assert.equal(put.body.branch, 'main');
    assert.equal(put.body.content, Buffer.from(JPEG).toString('base64'));
    assert.equal(put.body.sha, undefined);
    assert.equal(put.auth, `Bearer ${TOKEN}`);
  });

  test('si ya había una portada pendiente, la sustituye con su sha', async () => {
    const gh = fakeGitHub({ existingSha: 'abc123' });
    await handleEdit(coverRequest(JPEG), { env: ENV, fetchImpl: gh.fetchImpl });
    assert.equal(gh.calls.find((call) => call.method === 'PUT').body.sha, 'abc123');
  });

  test('rechaza ids inválidos, tipos que no son JPEG, firmas falsas y tamaños excesivos', async () => {
    const casos = [
      [coverRequest(JPEG, '../../etc/passwd'), 400],
      [coverRequest(JPEG, 'F12'), 400],
      [coverRequest(JPEG, SONG, 'image/png'), 415],
      [coverRequest(new Uint8Array([1, 2, 3, 4, 5, 6])), 400],
      [coverRequest(new Uint8Array(MAX_COVER_BYTES + 1)), 413],
    ];
    for (const [request, status] of casos) {
      const gh = fakeGitHub();
      const response = await handleEdit(request, { env: ENV, fetchImpl: gh.fetchImpl });
      assert.equal(response.status, status);
      assert.equal(gh.calls.length, 0);
    }
  });

  test('isJpeg', () => {
    assert.equal(isJpeg(JPEG), true);
    assert.equal(isJpeg(new Uint8Array([0x89, 0x50, 0x4e, 0x47])), false);
  });
});

// Estado de una edición (ADR-0027): GET /api/editar?incidencia=N con el token del servidor.
function fakeIssue(issue, status = 200) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ method: options.method, path: new URL(url).pathname, auth: options.headers.Authorization });
    return new Response(JSON.stringify(issue), { status });
  };
  return { fetchImpl, calls };
}
const statusRequest = (query) => new Request(`https://x.test/api/editar${query}`, { method: 'GET' });
const ORGANIZE_BODY = 'action: organize\npayload: {"op":"create_folder","name":"A"}';

describe('estado de una edición', () => {
  test('abierta, cerrada y error, leídos con el token del servidor', async () => {
    const casos = [
      [{ number: 12, state: 'open', labels: [], body: ORGANIZE_BODY }, 'abierta'],
      [{ number: 12, state: 'closed', state_reason: 'completed', labels: [{ name: 'biblioteca' }], body: ORGANIZE_BODY }, 'cerrada'],
      [{ number: 12, state: 'open', labels: [{ name: 'error' }], body: ORGANIZE_BODY }, 'error'],
      [{ number: 12, state: 'closed', labels: [{ name: 'error' }], body: ORGANIZE_BODY }, 'error'],
      [{ number: 12, state: 'closed', state_reason: 'not_planned', labels: [], body: ORGANIZE_BODY }, 'error'],
    ];
    for (const [issue, estado] of casos) {
      const gh = fakeIssue(issue);
      const response = await handleEdit(statusRequest('?incidencia=12'), { env: ENV, fetchImpl: gh.fetchImpl });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      const reply = await response.json();
      assert.deepEqual(reply, { ok: true, incidencia: 12, estado });
      assert.deepEqual(gh.calls.map(({ method, path }) => [method, path]), [['GET', '/repos/seryi47/reminiscencia/issues/12']]);
      assert.equal(gh.calls[0].auth, `Bearer ${TOKEN}`);
      assert.ok(!JSON.stringify(reply).includes(TOKEN));
    }
  });

  test('valida el número estrictamente y no llama a GitHub si no vale', async () => {
    for (const query of ['', '?incidencia=', '?incidencia=0', '?incidencia=-3', '?incidencia=012', '?incidencia=1.5', '?incidencia=1e3',
      '?incidencia=%201', '?incidencia=abc', '?incidencia=1234567890', '?incidencia=1&incidencia=2', '?incidencia=12/comments', '?numero=12']) {
      const gh = fakeIssue({});
      const response = await handleEdit(statusRequest(query), { env: ENV, fetchImpl: gh.fetchImpl });
      assert.equal(response.status, 400, query);
      assert.equal(gh.calls.length, 0, query);
    }
    assert.equal(issueNumberFrom('https://x.test/api/editar?incidencia=987654321'), 987654321);
    assert.throws(() => issueNumberFrom('no es una url'), /dirección/);
  });

  test('solo responde de incidencias de edición: ni pull requests ni otras incidencias', async () => {
    for (const issue of [
      { number: 5, state: 'open', labels: [], body: 'Hola, tengo una duda' },
      { number: 5, state: 'open', labels: [], body: null },
      { number: 5, state: 'open', labels: [], body: ORGANIZE_BODY, pull_request: { url: 'x' } },
    ]) {
      const response = await handleEdit(statusRequest('?incidencia=5'), { env: ENV, fetchImpl: fakeIssue(issue).fetchImpl });
      assert.equal(response.status, 404);
    }
    const missing = await handleEdit(statusRequest('?incidencia=5'), { env: ENV, fetchImpl: fakeIssue({ message: 'Not Found' }, 404).fetchImpl });
    assert.equal(missing.status, 404);
  });

  test('sin token o sin permiso lo explica sin filtrar el token', async () => {
    assert.equal((await handleEdit(statusRequest('?incidencia=5'), { env: {} })).status, 500);
    const original = console.error;
    console.error = () => {};
    const response = await handleEdit(statusRequest('?incidencia=5'), { env: ENV, fetchImpl: fakeIssue({}, 401).fetchImpl });
    const caida = await handleEdit(statusRequest('?incidencia=5'), { env: ENV, fetchImpl: async () => { throw new Error('red'); } });
    console.error = original;
    assert.equal(response.status, 500);
    assert.ok(!(await response.text()).includes(TOKEN));
    assert.equal(caida.status, 502);
  });

  test('editStateOf', () => {
    assert.equal(editStateOf(null), 'abierta');
    assert.equal(editStateOf({ state: 'open', labels: ['error'] }), 'error');
    assert.equal(editStateOf({ state: 'closed', labels: [] }), 'cerrada');
  });
});
