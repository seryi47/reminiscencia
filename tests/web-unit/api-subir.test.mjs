// Pruebas de la función de Vercel POST /api/subir (frontend/web/api/subir.js; ADR-0017) con la API de git de GitHub
// simulada en memoria: validación (Ogg Opus, tamaño del trozo, cabeceras, nombre y ruta), trozos en orden, manifiesto y
// licencia en el último, nunca sobrescribir (trozo repetido, sufijo del nombre), reintento si main cambia, y el token
// fuera de las respuestas y de los registros. Sin red. Ejecución: node --test tests/web-unit/api-subir.test.mjs
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';

import {
  BUZON_DIRECTORY,
  cleanStem,
  commitMessage,
  DONE_MESSAGE,
  gitBlobSha,
  handleUpload,
  isOggOpus,
  LICENSE_TEXT,
  MAX_CHUNK_BYTES,
  PARTS_DIRECTORY,
  parseUploadHeaders,
  uniqueName,
} from '../../frontend/web/api/subir.js';
import { buildOggOpus } from '../../frontend/web/js/cuidador/subida-local.js';

const TOKEN = 'github_pat_PRUEBA_que_no_debe_salir_nunca';
const ENV = { GITHUB_TOKEN: TOKEN };
const ID = '0f8fad5b-d9cb-469f-a165-70867728950e';
const OPUS = buildOggOpus({ packets: [{ data: new Uint8Array([0xf8, 0xff, 0xfe]), samples: 960 }], channels: 1 });

// ---------------------------------------------------------------------------------------------
// GitHub simulado: commits, árboles (ruta → sha de blob) y la referencia de main
// ---------------------------------------------------------------------------------------------

function fakeGitHub({ files = {}, failWith = null, raceOnce = false, alwaysRace = false } = {}) {
  const blobs = new Map();
  const trees = new Map();
  const commits = new Map();
  let counter = 0;
  const newSha = () => (counter += 1).toString(16).padStart(40, '0');
  const rootTree = newSha();
  trees.set(rootTree, new Map(Object.entries(files).map(([path, content]) => {
    const bytes = new TextEncoder().encode(content);
    const sha = gitBlobSha(bytes);
    blobs.set(sha, bytes);
    return [path, sha];
  })));
  const root = newSha();
  commits.set(root, { tree: rootTree, parents: [], message: 'inicial' });
  const state = { head: root, calls: [], blobs, trees, commits, racesLeft: raceOnce ? 1 : 0 };

  const commitOnTop = (message, extra) => {
    const tree = new Map(trees.get(commits.get(state.head).tree));
    for (const [path, sha] of Object.entries(extra)) tree.set(path, sha);
    const treeSha = newSha();
    trees.set(treeSha, tree);
    const sha = newSha();
    commits.set(sha, { tree: treeSha, parents: [state.head], message });
    state.head = sha;
  };
  state.otherCommit = () => commitOnTop('otro commit', { 'README.md': gitBlobSha(new Uint8Array([1])) });

  const reply = (status, body) => new Response(body === undefined ? null : JSON.stringify(body), { status });
  state.fetch = async (url, init = {}) => {
    const { pathname, searchParams } = new URL(url);
    const method = init.method ?? 'GET';
    state.calls.push({ url, method, headers: init.headers, body: init.body });
    if (failWith) return reply(failWith, { message: 'fallo simulado' });
    const prefix = '/repos/seryi47/reminiscencia';
    assert.ok(pathname.startsWith(prefix), pathname);
    const path = pathname.slice(prefix.length);
    const body = init.body ? JSON.parse(init.body) : null;
    if (method === 'GET' && path === '/git/ref/heads/main') return reply(200, { object: { sha: state.head } });
    if (method === 'GET' && path.startsWith('/git/commits/')) {
      const sha = path.split('/').pop();
      const commit = commits.get(sha);
      return commit ? reply(200, { sha, tree: { sha: commit.tree } }) : reply(404, {});
    }
    if (method === 'GET' && path.startsWith('/contents/')) {
      const dir = decodeURIComponent(path.slice('/contents/'.length));
      const tree = trees.get(commits.get(searchParams.get('ref')).tree);
      const names = new Map();
      for (const [file, sha] of tree) {
        if (!file.startsWith(`${dir}/`)) continue;
        const rest = file.slice(dir.length + 1);
        const [name, ...more] = rest.split('/');
        names.set(name, more.length ? { name, type: 'dir', sha: 'd'.repeat(40) } : { name, type: 'file', sha });
      }
      return names.size ? reply(200, [...names.values()]) : reply(404, { message: 'Not Found' });
    }
    if (method === 'POST' && path === '/git/blobs') {
      assert.equal(body.encoding, 'base64');
      const bytes = new Uint8Array(Buffer.from(body.content, 'base64'));
      const sha = gitBlobSha(bytes);
      blobs.set(sha, bytes);
      return reply(201, { sha });
    }
    if (method === 'POST' && path === '/git/trees') {
      const tree = new Map(trees.get(body.base_tree));
      for (const entry of body.tree) {
        let sha = entry.sha;
        if (entry.content !== undefined) {
          const bytes = new TextEncoder().encode(entry.content);
          sha = gitBlobSha(bytes);
          blobs.set(sha, bytes);
        }
        assert.ok(blobs.has(sha), `blob ${sha}`);
        tree.set(entry.path, sha);
      }
      const sha = newSha();
      trees.set(sha, tree);
      return reply(201, { sha });
    }
    if (method === 'POST' && path === '/git/commits') {
      const sha = newSha();
      commits.set(sha, { tree: body.tree, parents: body.parents, message: body.message });
      return reply(201, { sha });
    }
    if (method === 'PATCH' && path === '/git/refs/heads/main') {
      assert.equal(body.force, false);
      if (alwaysRace || state.racesLeft > 0) {
        state.racesLeft -= 1;
        state.otherCommit();
      }
      if (commits.get(body.sha).parents[0] !== state.head) return reply(422, { message: 'Update is not a fast forward' });
      state.head = body.sha;
      return reply(200, { object: { sha: body.sha } });
    }
    throw new Error(`llamada no simulada: ${method} ${path}`);
  };
  state.headTree = () => trees.get(commits.get(state.head).tree);
  state.headCommit = () => commits.get(state.head);
  state.fileText = (path) => new TextDecoder().decode(blobs.get(state.headTree().get(path)));
  return state;
}

function request({ name = 'Mi canción.mp3', id = ID, index = 0, total = 1, body = OPUS, headers = {}, method = 'POST' } = {}) {
  return new Request('https://reminiscencia.test/api/subir', {
    method,
    headers: {
      'Content-Type': 'audio/ogg',
      'X-Nombre-Archivo': encodeURIComponent(name),
      'X-Subida-Id': id,
      'X-Parte': String(index),
      'X-Partes': String(total),
      ...headers,
    },
    body: method === 'POST' ? body : undefined,
  });
}

async function send(github, options, env = ENV) {
  const response = await handleUpload(request(options), { env, fetchImpl: github.fetch });
  return { status: response.status, body: await response.json(), headers: response.headers };
}

let logged;
let originalError;
beforeEach(() => {
  logged = [];
  originalError = console.error;
  console.error = (...args) => logged.push(args.map(String).join(' '));
});
afterEach(() => {
  console.error = originalError;
});

// ---------------------------------------------------------------------------------------------
// Validación pura
// ---------------------------------------------------------------------------------------------

describe('cabecera Ogg Opus', () => {
  test('acepta el Ogg Opus que genera la web y rechaza lo demás', () => {
    assert.equal(isOggOpus(OPUS), true);
    assert.equal(isOggOpus(new TextEncoder().encode('RIFF....WAVEfmt ')), false);
    assert.equal(isOggOpus(new Uint8Array(0)), false);
    const vorbis = OPUS.slice();
    vorbis.set(new TextEncoder().encode('OpusHeaX'), 28);
    assert.equal(isOggOpus(vorbis), false, 'sin OpusHead no vale');
    const noBos = OPUS.slice();
    noBos[5] = 0;
    assert.equal(isOggOpus(noBos), false, 'la primera página debe abrir el flujo');
    assert.equal(isOggOpus(OPUS.subarray(0, 40)), false, 'cortado antes de la cabecera');
  });
});

describe('nombre limpio', () => {
  test('el nombre original pierde su extensión: «Mi canción.mp3» se guarda como «Mi canción.opus»', () => {
    assert.equal(cleanStem('Mi canción.mp3'), 'Mi canción');
    assert.equal(uniqueName(cleanStem('Mi canción.mp3')), 'Mi canción.opus');
    assert.equal(cleanStem('Copla (versión 2).FLAC'), 'Copla (versión 2)');
    assert.equal(cleanStem('a.b.c.wav'), 'a.b.c');
    assert.equal(cleanStem('sin extension'), 'sin extension');
  });

  test('sin rutas, sin controles ni caracteres que el buzón no admite, en NFC y sin bordes raros', () => {
    assert.equal(cleanStem('../../etc/passwd'), 'passwd');
    assert.equal(cleanStem('C:\\musica\\Vals.wav'), 'Vals');
    assert.equal(cleanStem('Uno\u0000dos\nTres\u202e.mp3'), 'Uno dos Tres');
    assert.equal(cleanStem('Tango: "1935" / <b>.ogg'), 'b');
    assert.equal(cleanStem('Tango: "1935" <b>.ogg'), 'Tango 1935 b');
    assert.equal(cleanStem('...-  Bolero . .mp3'), 'Bolero');
    assert.equal(cleanStem('Cancio\u0301n.mp3'), 'Canción');
    for (const raw of ['', '.mp3', '???.wav', null, undefined]) assert.equal(cleanStem(raw), 'Sin título', String(raw));
  });

  test('la longitud queda acotada en caracteres y en bytes', () => {
    assert.equal(cleanStem(`${'a'.repeat(400)}.mp3`).length, 150);
    const wide = cleanStem(`${'ñ'.repeat(400)}.mp3`);
    assert.ok(Buffer.byteLength(wide) <= 180);
    assert.ok(Buffer.byteLength(`${wide} (99).opus`) <= 255);
  });

  test('nunca repite un nombre del buzón: añade un sufijo', () => {
    assert.equal(uniqueName('Vals', ['README.md']), 'Vals.opus');
    assert.equal(uniqueName('Vals', ['vals.OPUS']), 'Vals (2).opus');
    assert.equal(uniqueName('Vals', ['Vals.opus', 'Vals (2).opus']), 'Vals (3).opus');
  });
});

describe('cabeceras del contrato', () => {
  const headers = (extra) => new Headers({
    'X-Nombre-Archivo': 'Vals.wav', 'X-Subida-Id': ID, 'X-Parte': '0', 'X-Partes': '1', ...extra,
  });

  test('lee nombre, id, parte y total', () => {
    assert.deepEqual(parseUploadHeaders(headers({ 'X-Nombre-Archivo': encodeURIComponent('Mi canción.mp3'), 'X-Subida-Id': ID.toUpperCase(), 'X-Parte': '2', 'X-Partes': '3' })), {
      fileName: 'Mi canción.mp3', uploadId: ID, index: 2, total: 3,
    });
  });

  test('lee y decodifica el álbum opcional de YouTube', () => {
    assert.deepEqual(parseUploadHeaders(headers({
      'X-Album-Id': 'PLVU-jIOit29A',
      'X-Album-Name': encodeURIComponent('Nuestro desacato'),
    })), {
      fileName: 'Vals.wav', uploadId: ID, index: 0, total: 1,
      album: { id: 'PLVU-jIOit29A', name: 'Nuestro desacato' },
    });
  });

  test('rechaza lo que no cumple el contrato', () => {
    for (const extra of [
      { 'X-Nombre-Archivo': '' },
      { 'X-Nombre-Archivo': '%E0%A4%A' },
      { 'X-Subida-Id': 'no-es-un-uuid' },
      { 'X-Subida-Id': '' },
      { 'X-Parte': '-1' },
      { 'X-Parte': '01' },
      { 'X-Parte': '1.5' },
      { 'X-Partes': '0' },
      { 'X-Partes': '1001' },
      { 'X-Parte': '1', 'X-Partes': '1' },
      { 'X-Album-Id': 'PL.demo', 'X-Album-Name': 'Album' },
      { 'X-Album-Id': 'PL123' },
      { 'X-Album-Id': 'PL123', 'X-Album-Name': '%E0%A4%A' },
      { 'X-Album-Id': 'PL123', 'X-Album-Name': encodeURIComponent('a'.repeat(201)) },
      { 'Content-Type': 'multipart/form-data; boundary=x' },
    ]) {
      assert.throws(() => parseUploadHeaders(headers(extra)), (error) => error.status === 400 && /[a-záéíóú]/.test(error.message), JSON.stringify(extra));
    }
  });
});

test('el mensaje del último commit lleva la línea de licencia que lee el workflow buzon', () => {
  assert.equal(commitMessage({ name: 'Vals.opus', index: 0, total: 1 }), `Subida desde la web: Vals.opus\n\nLicencia: ${LICENSE_TEXT}\n`);
  assert.equal(commitMessage({ name: 'Vals.opus', index: 0, total: 3 }), 'Subida desde la web: Vals.opus (trozo 1 de 3)\n');
  assert.doesNotMatch(commitMessage({ name: 'Vals.opus', index: 1, total: 3 }), /Licencia/);
});

// ---------------------------------------------------------------------------------------------
// Petición completa con GitHub simulado
// ---------------------------------------------------------------------------------------------

describe('subida a GitHub', () => {
  test('un archivo de un trozo: parte, manifiesto y licencia en un solo commit en main', async () => {
    const github = fakeGitHub();
    const { status, body } = await send(github, { name: 'Mi canción.mp3' });
    assert.equal(status, 200);
    assert.deepEqual(body, { ok: true, parte: 0, partes: 1, completa: true, repetido: false, nombre: 'Mi canción.opus', mensaje: DONE_MESSAGE });
    const tree = github.headTree();
    assert.equal(tree.get(`${PARTS_DIRECTORY}/${ID}/0.part`), gitBlobSha(OPUS));
    assert.deepEqual(JSON.parse(github.fileText(`${PARTS_DIRECTORY}/${ID}/manifiesto.json`)), { nombre: 'Mi canción.opus', partes: 1 });
    assert.match(github.headCommit().message, /^Subida desde la web: Mi canción\.opus\n\nLicencia: Subida desde la web pública; quien la sube declara tener derecho a publicarla\n$/);
  });

  test('incluye el álbum de YouTube en el manifiesto sin alterar los mensajes de licencia', async () => {
    const github = fakeGitHub();
    const { status } = await send(github, {
      album: { id: 'PLVU-jIOit29A', name: 'Nuestro desacato' },
      headers: {
        'X-Album-Id': 'PLVU-jIOit29A',
        'X-Album-Name': encodeURIComponent('Nuestro desacato'),
      },
    });
    assert.equal(status, 200);
    assert.deepEqual(JSON.parse(github.fileText(`${PARTS_DIRECTORY}/${ID}/manifiesto.json`)), {
      nombre: 'Mi canción.opus',
      partes: 1,
      album: { id: 'PLVU-jIOit29A', name: 'Nuestro desacato' },
    });
  });

  test('varios trozos en orden: el manifiesto y la licencia solo con el último; nada fuera de .partes', async () => {
    const github = fakeGitHub({ files: { [`${BUZON_DIRECTORY}/README.md`]: 'buzón' } });
    const parts = [OPUS.subarray(0, 50), OPUS.subarray(50, 100), OPUS.subarray(100)];
    const messages = [];
    for (let index = 0; index < parts.length; index += 1) {
      const { status, body } = await send(github, { name: 'Vals largo.wav', index, total: 3, body: parts[index] });
      assert.equal(status, 200, JSON.stringify(body));
      assert.equal(body.completa, index === 2);
      messages.push(github.headCommit().message);
      assert.equal(github.headTree().has(`${PARTS_DIRECTORY}/${ID}/manifiesto.json`), index === 2);
    }
    assert.match(messages[0], /trozo 1 de 3/);
    assert.doesNotMatch(messages[1], /Licencia/);
    assert.match(messages[2], /Licencia: /);
    const joined = Buffer.concat([0, 1, 2].map((index) => Buffer.from(github.blobs.get(github.headTree().get(`${PARTS_DIRECTORY}/${ID}/${index}.part`)))));
    assert.deepEqual(new Uint8Array(joined), OPUS);
    for (const path of github.headTree().keys()) {
      assert.ok(path === `${BUZON_DIRECTORY}/README.md` || path.startsWith(`${PARTS_DIRECTORY}/${ID}/`), path);
    }
  });

  test('un trozo sin los anteriores se rechaza', async () => {
    const github = fakeGitHub();
    const { status, body } = await send(github, { index: 1, total: 3, body: new Uint8Array([1, 2, 3]) });
    assert.equal(status, 409);
    assert.match(body.error, /Faltan trozos anteriores/);
  });

  test('nunca sobrescribe: un trozo repetido igual se da por bueno sin commit; distinto, se rechaza', async () => {
    const github = fakeGitHub();
    await send(github, { index: 0, total: 2 });
    const head = github.head;
    const again = await send(github, { index: 0, total: 2 });
    assert.equal(again.status, 200);
    assert.equal(again.body.repetido, true);
    assert.equal(github.head, head, 'sin commit nuevo');
    const other = OPUS.slice();
    other[other.length - 1] ^= 0xff;
    const changed = await send(github, { index: 0, total: 2, body: other });
    assert.equal(changed.status, 409);
  });

  test('una subida ya completa no admite más trozos', async () => {
    const github = fakeGitHub();
    await send(github, {});
    const { status, body } = await send(github, {});
    assert.equal(status, 409);
    assert.match(body.error, /ya está completa/);
  });

  test('si el nombre ya está en el buzón, el manifiesto lleva un sufijo', async () => {
    const github = fakeGitHub({ files: { [`${BUZON_DIRECTORY}/Mi canción.opus`]: 'otro' } });
    const { body } = await send(github, { name: 'Mi canción.mp3' });
    assert.equal(body.nombre, 'Mi canción (2).opus');
    assert.deepEqual(JSON.parse(github.fileText(`${PARTS_DIRECTORY}/${ID}/manifiesto.json`)), { nombre: 'Mi canción (2).opus', partes: 1 });
    assert.equal(github.fileText(`${BUZON_DIRECTORY}/Mi canción.opus`), 'otro');
  });

  test('si main cambia entre medias, rehace el commit encima sin perder el otro', async () => {
    const github = fakeGitHub({ raceOnce: true });
    const { status } = await send(github, {});
    assert.equal(status, 200);
    assert.ok(github.headTree().has('README.md'), 'el commit concurrente sigue en main');
    assert.ok(github.headTree().has(`${PARTS_DIRECTORY}/${ID}/0.part`));
    assert.equal(github.calls.filter((call) => call.method === 'POST' && call.url.endsWith('/git/blobs')).length, 1, 'el blob se crea una vez');
  });

  test('si main no deja de cambiar, responde 503 tras varios intentos', async () => {
    const github = fakeGitHub({ alwaysRace: true });
    const { status, body } = await send(github, {});
    assert.equal(status, 503);
    assert.match(body.error, /Inténtalo de nuevo/);
  });

  test('el primer trozo debe ser Ogg Opus; los siguientes no se miran', async () => {
    const github = fakeGitHub();
    const wav = new TextEncoder().encode('RIFF\u0000\u0000\u0000\u0000WAVEfmt de prueba que no es Opus en absoluto');
    const first = await send(github, { body: wav });
    assert.equal(first.status, 415);
    assert.match(first.body.error, /no es Ogg Opus/);
    assert.equal(github.calls.length, 0, 'no se llama a GitHub');
    await send(github, { index: 0, total: 2 });
    assert.equal((await send(github, { index: 1, total: 2, body: wav })).status, 200);
  });

  test('un trozo de más de 4 MB o vacío se rechaza con un mensaje claro', async () => {
    const github = fakeGitHub();
    const big = new Uint8Array(MAX_CHUNK_BYTES + 1);
    big.set(OPUS);
    const tooBig = await send(github, { body: big });
    assert.equal(tooBig.status, 413);
    assert.match(tooBig.body.error, /4 MB/);
    const empty = await send(github, { body: new Uint8Array(0) });
    assert.equal(empty.status, 400);
    assert.match(empty.body.error, /vacío/);
    const exact = new Uint8Array(MAX_CHUNK_BYTES);
    exact.set(OPUS);
    assert.equal((await send(github, { body: exact })).status, 200, 'justo 4 MB vale');
  });

  test('cabeceras mal formadas: 400 en JSON y en español, sin llamar a GitHub', async () => {
    const github = fakeGitHub();
    const { status, body, headers } = await send(github, { id: 'abc' });
    assert.equal(status, 400);
    assert.equal(headers.get('content-type'), 'application/json; charset=utf-8');
    assert.equal(body.ok, false);
    assert.match(body.error, /UUID/);
    assert.equal(github.calls.length, 0);
  });

  test('solo admite POST', async () => {
    const response = await handleUpload(request({ method: 'GET' }), { env: ENV, fetchImpl: fakeGitHub().fetch });
    assert.equal(response.status, 405);
  });
});

describe('token', () => {
  test('sin GITHUB_TOKEN responde 500 con un mensaje claro y no llama a GitHub', async () => {
    for (const env of [{}, { GITHUB_TOKEN: '' }, { GITHUB_TOKEN: '   ' }]) {
      const github = fakeGitHub();
      const { status, body } = await send(github, {}, env);
      assert.equal(status, 500);
      assert.match(body.error, /falta GITHUB_TOKEN/);
      assert.equal(github.calls.length, 0);
    }
  });

  test('el token solo va a api.github.com en la cabecera Authorization', async () => {
    const github = fakeGitHub();
    await send(github, {});
    assert.ok(github.calls.length > 0);
    for (const call of github.calls) {
      assert.ok(call.url.startsWith('https://api.github.com/repos/seryi47/reminiscencia/'), call.url);
      assert.equal(call.headers.Authorization, `Bearer ${TOKEN}`);
      assert.equal(String(call.body ?? '').includes(TOKEN), false);
    }
  });

  test('el token no sale en las respuestas ni en los registros, tampoco cuando GitHub falla', async () => {
    for (const failWith of [401, 403, 500, 404]) {
      const github = fakeGitHub({ failWith });
      const response = await handleUpload(request({}), { env: ENV, fetchImpl: github.fetch });
      const text = await response.text();
      assert.ok(response.status >= 500, String(response.status));
      assert.equal(text.includes(TOKEN), false);
      assert.match(JSON.parse(text).error, /[a-záéíóú]/);
    }
    const thrower = async () => { throw new Error(`fallo de red con ${TOKEN}`); };
    const network = await handleUpload(request({}), { env: ENV, fetchImpl: thrower });
    assert.equal(network.status, 502);
    assert.equal((await network.text()).includes(TOKEN), false);
    assert.ok(logged.length > 0);
    for (const line of logged) assert.equal(line.includes(TOKEN), false, line);
  });
});
