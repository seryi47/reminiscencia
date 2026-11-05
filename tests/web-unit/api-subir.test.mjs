// Pruebas de la función de Vercel POST /api/subir (frontend/web/api/subir.js; ADR-0017 y ADR-0024) con el bucket
// privado de R2 (API S3) y la API de GitHub simulados en memoria: validación (Ogg Opus, tamaño del trozo, cabeceras,
// nombre), trozos en orden en entrada/<id>/ sin sobrescribir nunca, manifiesto con el último, aviso al workflow buzon
// (repository_dispatch) y reintento seguro si el aviso falla, firma SigV4 (los mismos vectores que la de Python) y
// las claves fuera de las respuestas y de los registros. Sin red. Ejecución: node --test tests/web-unit/api-subir.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, test } from 'node:test';

import {
  canonicalQuery,
  cleanStem,
  DISPATCH_EVENT,
  DONE_MESSAGE,
  handleUpload,
  isOggOpus,
  manifestText,
  MAX_CHUNK_BYTES,
  parseUploadHeaders,
  readConfig,
  rfc3986,
  signV4,
} from '../../frontend/web/api/subir.js';
import { buildOggOpus } from '../../frontend/web/js/cuidador/subida-local.js';

const TOKEN = 'github_pat_PRUEBA_que_no_debe_salir_nunca';
const SECRET = 'r2_secreto_PRUEBA_que_no_debe_salir_nunca';
const ACCOUNT = '0123456789abcdef0123456789abcdef';
const BUCKET = 'reminiscencia-audio-privado';
const ENV = {
  GITHUB_TOKEN: TOKEN,
  R2_ACCOUNT_ID: ACCOUNT,
  R2_ACCESS_KEY_ID: 'AKPRUEBA',
  R2_SECRET_ACCESS_KEY: SECRET,
  R2_PRIVATE_BUCKET: BUCKET,
};
const ID = '0f8fad5b-d9cb-469f-a165-70867728950e';
const OPUS = buildOggOpus({ packets: [{ data: new Uint8Array([0xf8, 0xff, 0xfe]), samples: 960 }], channels: 1 });
const NOW = () => new Date('2026-11-05T21:38:16Z');
const VECTORS = JSON.parse(readFileSync(new URL('../fixtures/sigv4-vectores.json', import.meta.url), 'utf8')).casos;

// ---------------------------------------------------------------------------------------------
// R2 y GitHub simulados: objetos del bucket privado (clave → bytes) y los repository_dispatch recibidos
// ---------------------------------------------------------------------------------------------

function fakeServices({ objects = {}, r2FailWith = null, dispatchStatus = 204, raceOnPut = null } = {}) {
  const state = { objects: new Map(Object.entries(objects)), calls: [], dispatches: [], dispatchStatus };
  const reply = (status, body = null, type = 'application/xml') => new Response(body, { status, headers: { 'Content-Type': type } });
  const escape = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;');

  state.fetch = async (url, init = {}) => {
    const { host, pathname, search, searchParams } = new URL(url);
    const method = init.method ?? 'GET';
    const body = init.body === undefined ? undefined
      : typeof init.body === 'string' ? new TextEncoder().encode(init.body) : new Uint8Array(init.body);
    state.calls.push({ url, method, headers: init.headers ?? {}, body });

    if (host === 'api.github.com') {
      assert.equal(method, 'POST');
      assert.equal(pathname, '/repos/seryi47/reminiscencia/dispatches');
      state.dispatches.push(JSON.parse(new TextDecoder().decode(body)));
      return new Response(null, { status: state.dispatchStatus });
    }

    assert.equal(host, `${ACCOUNT}.r2.cloudflarestorage.com`);
    // La firma debe corresponder a lo que se envía: método, ruta, query, cuerpo y If-None-Match.
    const headers = init.headers;
    const extra = headers['If-None-Match'] ? { 'if-none-match': headers['If-None-Match'] } : {};
    const expected = signV4({
      method, host, path: pathname, query: search.slice(1), payload: body ?? new Uint8Array(0),
      accessKeyId: 'AKPRUEBA', secretAccessKey: SECRET, region: 'auto', service: 's3', when: NOW(), extraHeaders: extra,
    });
    assert.equal(headers.Authorization, expected.Authorization, `firma de ${method} ${pathname}`);
    if (r2FailWith) return reply(r2FailWith, `<Error>${SECRET}</Error>`);
    assert.ok(pathname.startsWith(`/${BUCKET}`), pathname);
    const key = decodeURIComponent(pathname.slice(BUCKET.length + 2));
    if (method === 'GET' && key === '') {
      assert.equal(searchParams.get('list-type'), '2');
      const prefix = searchParams.get('prefix') ?? '';
      const contents = [...state.objects.entries()].filter(([name]) => name.startsWith(prefix))
        .map(([name, data]) => `<Contents><Key>${escape(name)}</Key><Size>${data.length}</Size></Contents>`).join('');
      return reply(200, `<?xml version="1.0"?><ListBucketResult><IsTruncated>false</IsTruncated>${contents}</ListBucketResult>`);
    }
    if (method === 'GET') return state.objects.has(key) ? reply(200, state.objects.get(key), 'application/octet-stream') : reply(404);
    if (method === 'PUT') {
      assert.equal(headers['If-None-Match'], '*', 'nunca sobrescribe');
      if (raceOnPut && raceOnPut.key === key && !state.objects.has(key)) state.objects.set(key, raceOnPut.data);
      if (state.objects.has(key)) return reply(412);
      state.objects.set(key, body);
      return reply(200);
    }
    throw new Error(`llamada no simulada: ${method} ${pathname}`);
  };
  state.text = (key) => new TextDecoder().decode(state.objects.get(key));
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

async function send(services, options, env = ENV) {
  const response = await handleUpload(request(options), { env, fetchImpl: services.fetch, now: NOW });
  return { status: response.status, body: await response.json(), headers: response.headers };
}

const part = (index, id = ID) => `entrada/${id}/${index}.part`;
const manifest = (id = ID) => `entrada/${id}/manifiesto.json`;

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

  test('lee y decodifica el artista opcional de una canción', () => {
    assert.deepEqual(parseUploadHeaders(headers({
      'X-Artista-Cancion': encodeURIComponent('Desakato'),
    })), {
      fileName: 'Vals.wav', uploadId: ID, index: 0, total: 1, artist: 'Desakato',
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
      { 'X-Artista-Cancion': '%E0%A4%A' },
      { 'X-Artista-Cancion': encodeURIComponent('a'.repeat(201)) },
      { 'Content-Type': 'multipart/form-data; boundary=x' },
    ]) {
      assert.throws(() => parseUploadHeaders(headers(extra)), (error) => error.status === 400 && /[a-záéíóú]/.test(error.message), JSON.stringify(extra));
    }
  });
});

test('el manifiesto tiene solo las claves que lee el buzón', () => {
  assert.deepEqual(JSON.parse(manifestText({ name: 'Vals.opus', total: 3 })), { nombre: 'Vals.opus', partes: 3 });
  assert.deepEqual(JSON.parse(manifestText({ name: 'Vals.opus', total: 1, album: { id: 'PL1', name: 'Disco' }, artist: 'Ana' })), {
    nombre: 'Vals.opus', partes: 1, album: { id: 'PL1', name: 'Disco' }, artist: 'Ana',
  });
});

describe('configuración', () => {
  test('exige el token, las claves de R2 y el bucket privado, con formatos que no cambian el host', () => {
    assert.ok(readConfig(ENV));
    for (const name of Object.keys(ENV)) {
      assert.equal(readConfig({ ...ENV, [name]: '  ' }), null, name);
    }
    assert.equal(readConfig({ ...ENV, R2_ACCOUNT_ID: 'evil.example.com/x' }), null);
    assert.equal(readConfig({ ...ENV, R2_PRIVATE_BUCKET: '../otro' }), null);
  });
});

// ---------------------------------------------------------------------------------------------
// Firma SigV4: la misma que backend/sonidos/r2.py (sign_v4)
// ---------------------------------------------------------------------------------------------

describe('firma SigV4', () => {
  for (const vector of VECTORS) {
    test(`coincide con Python: ${vector.nombre}`, () => {
      const headers = signV4({
        method: vector.method, host: vector.host, path: vector.path, query: vector.query,
        payload: Buffer.from(vector.payload_b64, 'base64'), accessKeyId: vector.access_key_id,
        secretAccessKey: vector.secret_access_key, region: vector.region, service: vector.service,
        when: new Date(vector.when), extraHeaders: vector.extra_headers,
      });
      assert.deepEqual(headers, {
        'x-amz-date': vector.esperado['x-amz-date'],
        'x-amz-content-sha256': vector.esperado['x-amz-content-sha256'],
        Authorization: vector.esperado.Authorization,
      });
    });
  }

  test('el primer vector es el ejemplo oficial de AWS (GET Object)', () => {
    assert.match(VECTORS[0].esperado.Authorization, /Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41$/);
  });

  test('codifica rutas y queries como urllib.parse.quote de Python', () => {
    assert.equal(`/${BUCKET}/${rfc3986('entrada/canción (2).opus', { keepSlash: true })}`, VECTORS[3].path);
    assert.equal(canonicalQuery({ prefix: 'audio/', 'list-type': '2', 'continuation-token': 'a b+c/=' }),
      'continuation-token=a%20b%2Bc%2F%3D&list-type=2&prefix=audio%2F');
    assert.equal(canonicalQuery({ 'list-type': '2', prefix: `entrada/${ID}/` }), VECTORS[1].query);
  });
});

// ---------------------------------------------------------------------------------------------
// Petición completa con R2 y GitHub simulados
// ---------------------------------------------------------------------------------------------

describe('subida al bucket privado', () => {
  test('un archivo de un trozo: parte y manifiesto en entrada/<id>/ y aviso al workflow buzon', async () => {
    const services = fakeServices();
    const { status, body } = await send(services, { name: 'Mi canción.mp3' });
    assert.equal(status, 200);
    assert.deepEqual(body, { ok: true, parte: 0, partes: 1, completa: true, repetido: false, nombre: 'Mi canción.opus', mensaje: DONE_MESSAGE });
    assert.deepEqual([...services.objects.keys()].sort(), [part(0), manifest()].sort());
    assert.deepEqual(services.objects.get(part(0)), OPUS);
    assert.deepEqual(JSON.parse(services.text(manifest())), { nombre: 'Mi canción.opus', partes: 1 });
    assert.deepEqual(services.dispatches, [{ event_type: DISPATCH_EVENT, client_payload: { id: ID } }]);
    assert.equal(DISPATCH_EVENT, 'subida-web');
  });

  test('incluye el álbum de YouTube y el artista en el manifiesto', async () => {
    const services = fakeServices();
    const { status } = await send(services, {
      headers: {
        'X-Album-Id': 'PLVU-jIOit29A',
        'X-Album-Name': encodeURIComponent('Nuestro desacato'),
        'X-Artista-Cancion': encodeURIComponent('Desakato'),
      },
    });
    assert.equal(status, 200);
    assert.deepEqual(JSON.parse(services.text(manifest())), {
      nombre: 'Mi canción.opus',
      partes: 1,
      album: { id: 'PLVU-jIOit29A', name: 'Nuestro desacato' },
      artist: 'Desakato',
    });
  });

  test('varios trozos en orden: el manifiesto y el aviso solo con el último; nada fuera de entrada/<id>/', async () => {
    const services = fakeServices({ objects: { 'audio/S0123456789abcdef.opus': new Uint8Array([9]) } });
    const parts = [OPUS.subarray(0, 50), OPUS.subarray(50, 100), OPUS.subarray(100)];
    for (let index = 0; index < parts.length; index += 1) {
      const { status, body } = await send(services, { name: 'Vals largo.wav', index, total: 3, body: parts[index] });
      assert.equal(status, 200, JSON.stringify(body));
      assert.equal(body.completa, index === 2);
      assert.equal(services.objects.has(manifest()), index === 2);
      assert.equal(services.dispatches.length, index === 2 ? 1 : 0);
    }
    const joined = Buffer.concat([0, 1, 2].map((index) => Buffer.from(services.objects.get(part(index)))));
    assert.deepEqual(new Uint8Array(joined), OPUS);
    for (const key of services.objects.keys()) {
      assert.ok(key === 'audio/S0123456789abcdef.opus' || key.startsWith(`entrada/${ID}/`), key);
    }
    for (const call of services.calls.filter((item) => item.method === 'PUT')) {
      assert.ok(new URL(call.url).pathname.startsWith(`/${BUCKET}/entrada/${ID}/`), call.url);
    }
  });

  test('un trozo sin los anteriores se rechaza', async () => {
    const services = fakeServices();
    const { status, body } = await send(services, { index: 1, total: 3, body: new Uint8Array([1, 2, 3]) });
    assert.equal(status, 409);
    assert.match(body.error, /Faltan trozos anteriores/);
    assert.equal(services.objects.size, 0);
  });

  test('nunca sobrescribe: un trozo repetido igual se da por bueno; distinto, se rechaza', async () => {
    const services = fakeServices();
    await send(services, { index: 0, total: 2 });
    const puts = services.calls.filter((call) => call.method === 'PUT').length;
    const again = await send(services, { index: 0, total: 2 });
    assert.equal(again.status, 200);
    assert.equal(again.body.repetido, true);
    assert.equal(services.calls.filter((call) => call.method === 'PUT').length, puts, 'sin escribir de nuevo');
    const other = OPUS.slice();
    other[other.length - 1] ^= 0xff;
    const changed = await send(services, { index: 0, total: 2, body: other });
    assert.equal(changed.status, 409);
    assert.deepEqual(services.objects.get(part(0)), OPUS);
  });

  test('si otra petición escribe el trozo entre la lista y la escritura, vale solo si es igual', async () => {
    const same = fakeServices({ raceOnPut: { key: part(0), data: OPUS } });
    assert.equal((await send(same, { index: 0, total: 2 })).body.repetido, true);
    const other = fakeServices({ raceOnPut: { key: part(0), data: new Uint8Array([1]) } });
    assert.equal((await send(other, { index: 0, total: 2 })).status, 409);
  });

  test('una subida ya completa no admite más trozos', async () => {
    const services = fakeServices();
    await send(services, { index: 0, total: 2 });
    await send(services, { index: 1, total: 2, body: new Uint8Array([7, 7]) });
    const first = await send(services, { index: 0, total: 2 });
    assert.equal(first.status, 409);
    assert.match(first.body.error, /ya está completa/);
    const different = await send(services, { index: 1, total: 2, body: new Uint8Array([8]) });
    assert.equal(different.status, 409);
  });

  test('si el aviso a GitHub falla, el cliente reintenta el último trozo y solo se repite el aviso', async () => {
    const services = fakeServices({ dispatchStatus: 502 });
    const failed = await send(services, {});
    assert.equal(failed.status, 502);
    assert.match(failed.body.error, /GitHub/);
    assert.ok(services.objects.has(manifest()), 'la subida ya está guardada');
    services.dispatchStatus = 204;
    const retried = await send(services, {});
    assert.equal(retried.status, 200);
    assert.equal(retried.body.repetido, true);
    assert.equal(retried.body.nombre, 'Mi canción.opus');
    assert.equal(services.dispatches.length, 2);
  });

  test('sin permiso para avisar a GitHub, 500 con un mensaje claro', async () => {
    for (const status of [401, 403, 404]) {
      const services = fakeServices({ dispatchStatus: status });
      const { status: code, body } = await send(services, {});
      assert.equal(code, 500);
      assert.match(body.error, /permiso para avisar a GitHub/);
    }
  });

  test('el primer trozo debe ser Ogg Opus; los siguientes no se miran', async () => {
    const services = fakeServices();
    const wav = new TextEncoder().encode('RIFF\u0000\u0000\u0000\u0000WAVEfmt de prueba que no es Opus en absoluto');
    const first = await send(services, { body: wav });
    assert.equal(first.status, 415);
    assert.match(first.body.error, /no es Ogg Opus/);
    assert.equal(services.calls.length, 0, 'no se llama a R2 ni a GitHub');
    await send(services, { index: 0, total: 2 });
    assert.equal((await send(services, { index: 1, total: 2, body: wav })).status, 200);
  });

  test('un trozo de más de 4 MB o vacío se rechaza con un mensaje claro', async () => {
    const services = fakeServices();
    const big = new Uint8Array(MAX_CHUNK_BYTES + 1);
    big.set(OPUS);
    const tooBig = await send(services, { body: big });
    assert.equal(tooBig.status, 413);
    assert.match(tooBig.body.error, /4 MB/);
    const empty = await send(services, { body: new Uint8Array(0) });
    assert.equal(empty.status, 400);
    assert.match(empty.body.error, /vacío/);
    const exact = new Uint8Array(MAX_CHUNK_BYTES);
    exact.set(OPUS);
    assert.equal((await send(services, { body: exact })).status, 200, 'justo 4 MB vale');
  });

  test('cabeceras mal formadas: 400 en JSON y en español, sin llamar a nadie', async () => {
    const services = fakeServices();
    const { status, body, headers } = await send(services, { id: 'abc' });
    assert.equal(status, 400);
    assert.equal(headers.get('content-type'), 'application/json; charset=utf-8');
    assert.equal(body.ok, false);
    assert.match(body.error, /UUID/);
    assert.equal(services.calls.length, 0);
  });

  test('solo admite POST', async () => {
    const response = await handleUpload(request({ method: 'GET' }), { env: ENV, fetchImpl: fakeServices().fetch, now: NOW });
    assert.equal(response.status, 405);
  });
});

describe('claves y token', () => {
  test('sin configuración responde 500 con un mensaje claro y no llama a nadie', async () => {
    for (const env of [{}, { ...ENV, GITHUB_TOKEN: '' }, { ...ENV, R2_SECRET_ACCESS_KEY: '   ' }, { ...ENV, R2_PRIVATE_BUCKET: '' }]) {
      const services = fakeServices();
      const { status, body } = await send(services, {}, env);
      assert.equal(status, 500);
      assert.match(body.error, /no está configurada/);
      assert.equal(services.calls.length, 0);
    }
  });

  test('el token solo va a api.github.com y la clave secreta de R2 nunca sale en ninguna petición', async () => {
    const services = fakeServices();
    await send(services, {});
    assert.ok(services.calls.length > 0);
    for (const call of services.calls) {
      const sent = JSON.stringify(call.headers) + call.url + Buffer.from(call.body ?? []).toString('latin1');
      assert.equal(sent.includes(SECRET), false, call.url);
      if (call.url.startsWith('https://api.github.com/')) {
        assert.equal(call.headers.Authorization, `Bearer ${TOKEN}`);
      } else {
        assert.equal(sent.includes(TOKEN), false, call.url);
        assert.ok(call.url.startsWith(`https://${ACCOUNT}.r2.cloudflarestorage.com/${BUCKET}`), call.url);
      }
    }
  });

  test('las claves no salen en las respuestas ni en los registros, tampoco cuando R2 o GitHub fallan', async () => {
    for (const r2FailWith of [401, 403, 500, 404]) {
      const services = fakeServices({ r2FailWith });
      const response = await handleUpload(request({}), { env: ENV, fetchImpl: services.fetch, now: NOW });
      const text = await response.text();
      assert.ok(response.status >= 500, String(response.status));
      assert.equal(text.includes(TOKEN) || text.includes(SECRET), false);
      assert.match(JSON.parse(text).error, /[a-záéíóú]/);
    }
    const thrower = async () => { throw new Error(`fallo de red con ${TOKEN} y ${SECRET}`); };
    const network = await handleUpload(request({}), { env: ENV, fetchImpl: thrower, now: NOW });
    assert.equal(network.status, 502);
    const text = await network.text();
    assert.equal(text.includes(TOKEN) || text.includes(SECRET), false);
    assert.ok(logged.length > 0);
    for (const line of logged) assert.equal(line.includes(TOKEN) || line.includes(SECRET), false, line);
  });
});
