// Pruebas del Worker de Cloudflare «reminiscencia-api» (worker/src/index.js; ADR-0029) con los dos buckets de R2
// simulados (r2-falso.mjs, con la forma del binding) y la API de GitHub simulada: salud, CORS solo para la web y
// localhost, subida completa con trozos de más de 4 MB, idempotencia y carreras, aviso al workflow y su reintento,
// ediciones y su estado, portadas al bucket público con índice condicional y reintentos, y rechazos. Sin red.
// Ejecución: node --test tests/web-unit/worker.test.mjs
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, test } from 'node:test';

import { handleRequest, isAllowedOrigin, ALLOWED_HEADERS, API_HEADER, COVER_DONE_MESSAGE, WEB_ORIGIN } from '../../worker/src/index.js';
import { IMAGE_CACHE_CONTROL, INDEX_CACHE_CONTROL, updateCoverIndex } from '../../worker/src/portadas.js';
import { COVER_INDEX_KEY, COVER_KEY, parseCoverIndex } from '../../frontend/web/js/cover-index.js';
import { WORKER_MAX_CHUNK_BYTES } from '../../frontend/web/server/upload-core.js';
import { buildOggOpus } from '../../frontend/web/js/cuidador/subida-local.js';
import { fakeR2 } from './r2-falso.mjs';

const TOKEN = 'github_pat_PRUEBA_que_no_debe_salir_nunca';
const ID = '0f8fad5b-d9cb-469f-a165-70867728950e';
const OPUS = buildOggOpus({ packets: [{ data: new Uint8Array([0xf8, 0xff, 0xfe]), samples: 960 }], channels: 1 });
const SONG = 'S0000000000000004';
const FOLDER = 'F0000000000000002';
const jpeg = (fill = 1, size = 16) => {
  const bytes = new Uint8Array(size).fill(fill);
  bytes.set([0xff, 0xd8, 0xff, 0xe0], 0);
  bytes.set([0xff, 0xd9], size - 2);
  return bytes;
};
const hash16 = (bytes) => createHash('sha256').update(bytes).digest('hex').slice(0, 16);

function setup({ env = {}, githubStatus = 204 } = {}) {
  const privateBucket = fakeR2();
  const publicBucket = fakeR2();
  const github = [];
  let dispatchStatus = githubStatus;
  const fetchImpl = async (url, init = {}) => {
    const target = new URL(url);
    assert.equal(target.hostname, 'api.github.com', 'el Worker solo habla con GitHub por fetch');
    const body = init.body ? JSON.parse(init.body) : null;
    github.push({ method: init.method ?? 'GET', path: target.pathname, body, auth: init.headers?.Authorization });
    const reply = (status, data) => new Response(data === null ? null : JSON.stringify(data), { status });
    if (target.pathname.endsWith('/dispatches')) return reply(dispatchStatus, null);
    if (target.pathname.endsWith('/issues') && init.method === 'POST') return reply(201, { number: 77, labels: [] });
    if (target.pathname.endsWith('/issues/77')) return reply(200, { number: 77, state: 'closed', state_reason: 'completed', body: 'action: organize\npayload: {}', labels: [] });
    return reply(404, {});
  };
  const fullEnv = { GITHUB_TOKEN: TOKEN, PRIVATE_BUCKET: privateBucket, PUBLIC_BUCKET: publicBucket, ALLOW_LOCALHOST: '1', ...env };
  const call = (path, init = {}) => handleRequest(new Request(`https://reminiscencia-api.prueba.workers.dev${path}`, init), fullEnv, { fetchImpl });
  return { privateBucket, publicBucket, github, call, setDispatch: (status) => { dispatchStatus = status; } };
}

const chunkInit = ({ index, total, body, id = ID, origin = WEB_ORIGIN, name = 'Canción.mp3' }) => ({
  method: 'POST',
  headers: {
    'Content-Type': 'application/octet-stream',
    'X-Nombre-Archivo': encodeURIComponent(name),
    'X-Subida-Id': id,
    'X-Parte': String(index),
    'X-Partes': String(total),
    ...(origin ? { Origin: origin } : {}),
  },
  body,
});

const coverInit = (bytes, id = SONG, { origin = WEB_ORIGIN, type = 'image/jpeg' } = {}) => ({
  method: 'POST',
  headers: { 'Content-Type': type, 'X-Portada-Id': id, ...(origin ? { Origin: origin } : {}) },
  body: bytes,
});

describe('salud y CORS', () => {
  test('GET /api/salud dice el trozo máximo y lleva la cabecera del Worker y CORS de la web', async () => {
    const { call } = setup();
    const response = await call('/api/salud', { headers: { Origin: WEB_ORIGIN } });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, servicio: 'reminiscencia-api', trozoMaximo: WORKER_MAX_CHUNK_BYTES });
    assert.equal(response.headers.get(API_HEADER), '1');
    assert.equal(response.headers.get('access-control-allow-origin'), WEB_ORIGIN);
    assert.match(response.headers.get('access-control-expose-headers'), /X-Reminiscencia-Api/);
    assert.equal(response.headers.get('vary'), 'Origin');
  });

  test('el preflight de la web admite las cabeceras del contrato', async () => {
    const { call } = setup();
    const response = await call('/api/subir', { method: 'OPTIONS', headers: { Origin: WEB_ORIGIN, 'Access-Control-Request-Method': 'POST' } });
    assert.equal(response.status, 204);
    assert.equal(response.headers.get('access-control-allow-origin'), WEB_ORIGIN);
    assert.match(response.headers.get('access-control-allow-methods'), /POST/);
    for (const name of ALLOWED_HEADERS) assert.ok(response.headers.get('access-control-allow-headers').includes(name), name);
  });

  test('otro origen: 403 sin CORS y sin tocar nada', async () => {
    const { call, privateBucket, github } = setup();
    for (const origin of ['https://malo.example', 'https://reminiscencia.vercel.app.malo.example', 'http://localhost.malo.example']) {
      const preflight = await call('/api/subir', { method: 'OPTIONS', headers: { Origin: origin } });
      assert.equal(preflight.status, 403);
      assert.equal(preflight.headers.get('access-control-allow-origin'), null);
      const response = await call('/api/subir', chunkInit({ index: 0, total: 1, body: OPUS, origin }));
      assert.equal(response.status, 403);
    }
    assert.equal(privateBucket.objects.size, 0);
    assert.equal(github.length, 0);
  });

  test('localhost y 127.0.0.1 solo con ALLOW_LOCALHOST="1" (nunca en producción) y ALLOWED_ORIGINS se admiten', () => {
    // Producción (sin la variable): el navegador de unas pruebas en localhost no puede hablar con el Worker real.
    assert.ok(!isAllowedOrigin('http://localhost:5173'));
    assert.ok(!isAllowedOrigin('http://127.0.0.1:41234', { ALLOW_LOCALHOST: '0' }));
    assert.ok(isAllowedOrigin('http://localhost:5173', { ALLOW_LOCALHOST: '1' }));
    assert.ok(isAllowedOrigin('http://127.0.0.1:41234', { ALLOW_LOCALHOST: '1' }));
    assert.ok(!isAllowedOrigin('https://localhost:5173', { ALLOW_LOCALHOST: '1' }));
    assert.ok(isAllowedOrigin('https://otra.example', { ALLOWED_ORIGINS: 'https://otra.example, https://mas.example' }));
    assert.ok(!isAllowedOrigin('https://otra.example', { ALLOWED_ORIGINS: '' }));
  });

  test('ruta desconocida: 404 con la cabecera del Worker', async () => {
    const response = await setup().call('/api/nada');
    assert.equal(response.status, 404);
    assert.equal(response.headers.get(API_HEADER), '1');
  });
});

describe('subida por el Worker', () => {
  test('subida completa en dos trozos de más de 4 MB: orden, manifiesto y aviso al workflow', async () => {
    const { call, privateBucket, github } = setup();
    const first = new Uint8Array(5 * 1024 * 1024);
    first.set(OPUS, 0);
    const second = new Uint8Array(6 * 1024 * 1024).fill(7);
    const one = await call('/api/subir', chunkInit({ index: 0, total: 2, body: first }));
    assert.equal(one.status, 200);
    assert.deepEqual(await one.json(), { ok: true, parte: 0, partes: 2, completa: false, repetido: false, nombre: null, mensaje: 'Trozo 1 de 2 recibido.' });
    assert.equal(github.length, 0);
    const two = await call('/api/subir', chunkInit({ index: 1, total: 2, body: second }));
    const reply = await two.json();
    assert.equal(two.status, 200);
    assert.equal(reply.completa, true);
    assert.equal(reply.nombre, 'Canción.opus');
    assert.deepEqual([...privateBucket.objects.keys()].sort(), [`entrada/${ID}/0.part`, `entrada/${ID}/1.part`, `entrada/${ID}/manifiesto.json`]);
    assert.deepEqual(JSON.parse(privateBucket.text(`entrada/${ID}/manifiesto.json`)), { nombre: 'Canción.opus', partes: 2 });
    assert.equal(github.length, 1);
    assert.deepEqual(github[0].body, { event_type: 'subida-web', client_payload: { id: ID } });
    assert.equal(github[0].auth, `Bearer ${TOKEN}`);
    assert.ok(!JSON.stringify(reply).includes(TOKEN));
    // Los trozos nunca se escriben sin la condición «solo si no existe».
    const puts = privateBucket.calls.filter((item) => item.op === 'put');
    assert.ok(puts.every((item) => item.options.onlyIf instanceof Headers && item.options.onlyIf.get('if-none-match') === '*'));
  });

  test('idempotencia: repetir un trozo igual vale; distinto, 409; el último repetido repite solo el aviso', async () => {
    const { call, privateBucket, github } = setup();
    assert.equal((await call('/api/subir', chunkInit({ index: 0, total: 2, body: OPUS }))).status, 200);
    const again = await (await call('/api/subir', chunkInit({ index: 0, total: 2, body: OPUS }))).json();
    assert.equal(again.repetido, true);
    const other = new Uint8Array(OPUS);
    other[other.length - 1] ^= 1;
    assert.equal((await call('/api/subir', chunkInit({ index: 0, total: 2, body: other }))).status, 409);
    assert.equal((await call('/api/subir', chunkInit({ index: 1, total: 2, body: new Uint8Array([1, 2]) }))).status, 200);
    assert.equal(github.length, 1);
    const repeat = await call('/api/subir', chunkInit({ index: 1, total: 2, body: new Uint8Array([1, 2]) }));
    assert.equal(repeat.status, 200);
    assert.equal((await repeat.json()).repetido, true);
    assert.equal(github.length, 2);
    assert.equal(privateBucket.objects.size, 3);
    // Una subida completa no admite trozos que no sean el último.
    assert.equal((await call('/api/subir', chunkInit({ index: 0, total: 2, body: OPUS }))).status, 409);
  });

  test('carrera: otro escribe el mismo trozo entre la lista y la escritura y se da por bueno', async () => {
    const { call, privateBucket } = setup();
    privateBucket.hooks.beforePut = (key) => {
      if (key.endsWith('/0.part') && !privateBucket.objects.has(key)) privateBucket.seed(key, OPUS);
    };
    const reply = await (await call('/api/subir', chunkInit({ index: 0, total: 2, body: OPUS }))).json();
    assert.deepEqual([reply.ok, reply.repetido], [true, true]);
  });

  test('faltan trozos anteriores: 409; si falla el aviso, 502 y el reintento avisa', async () => {
    const { call, github, setDispatch } = setup();
    assert.equal((await call('/api/subir', chunkInit({ index: 1, total: 2, body: OPUS }))).status, 409);
    setDispatch(500);
    assert.equal((await call('/api/subir', chunkInit({ index: 0, total: 1, body: OPUS }))).status, 502);
    setDispatch(204);
    const retry = await call('/api/subir', chunkInit({ index: 0, total: 1, body: OPUS }));
    assert.equal(retry.status, 200);
    assert.equal(github.filter((item) => item.path.endsWith('/dispatches')).length, 2);
  });

  test('rechazos: trozo de más de 32 MB (413), primero que no es Opus (415), GET (405), sin configurar (500)', async () => {
    const { call } = setup();
    const declared = chunkInit({ index: 0, total: 1, body: OPUS });
    declared.headers['Content-Length'] = String(WORKER_MAX_CHUNK_BYTES + 1);
    const big = await call('/api/subir', declared);
    assert.equal(big.status, 413);
    assert.match((await big.json()).error, /32 MB/);
    assert.equal((await call('/api/subir', chunkInit({ index: 0, total: 1, body: new Uint8Array(100).fill(1) }))).status, 415);
    assert.equal((await call('/api/subir', { headers: { Origin: WEB_ORIGIN } })).status, 405);
    const bare = setup({ env: { GITHUB_TOKEN: '', PRIVATE_BUCKET: undefined } });
    const missing = await bare.call('/api/subir', chunkInit({ index: 0, total: 1, body: OPUS }));
    assert.equal(missing.status, 500);
    assert.match((await missing.json()).error, /no está configurada/);
  });

  test('un fallo del bucket es un 502 sin detalles', async () => {
    const { call, privateBucket } = setup();
    privateBucket.hooks.beforePut = () => { throw new Error('secreto interno'); };
    const response = await call('/api/subir', chunkInit({ index: 0, total: 1, body: OPUS }));
    assert.equal(response.status, 502);
    assert.ok(!(await response.text()).includes('secreto interno'));
  });
});

describe('ediciones por el Worker', () => {
  test('organizar abre la incidencia en GitHub y el estado se consulta igual que en Vercel', async () => {
    const { call, github } = setup();
    const response = await call('/api/editar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: WEB_ORIGIN },
      body: JSON.stringify({ action: 'organize', payload: { op: 'edit_song', song_id: SONG, title: 'Nuevo' } }),
    });
    assert.equal(response.status, 200);
    const reply = await response.json();
    assert.deepEqual([reply.ok, reply.incidencia], [true, 77]);
    assert.equal(github[0].path, '/repos/seryi47/reminiscencia/issues');
    assert.deepEqual(github[0].body.labels, ['biblioteca']);
    const state = await call('/api/editar?incidencia=77', { headers: { Origin: WEB_ORIGIN } });
    assert.deepEqual(await state.json(), { ok: true, incidencia: 77, estado: 'cerrada' });
    assert.equal((await call('/api/editar?incidencia=07')).status, 400);
  });

  test('la validación es la de incidencias.js: publicar se rechaza', async () => {
    const { call, github } = setup();
    const response = await call('/api/editar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'organize', payload: { op: 'edit_song', song_id: SONG, public: true } }),
    });
    assert.equal(response.status, 400);
    assert.equal(github.length, 0);
  });
});

describe('portadas al instante', () => {
  test('POST /api/portada: imagen inmutable en el bucket público e índice actualizado, sin GitHub', async () => {
    const { call, publicBucket, github } = setup();
    const bytes = jpeg(1);
    const response = await call('/api/portada', coverInit(bytes));
    assert.equal(response.status, 200);
    const reply = await response.json();
    const key = `portadas/${SONG}-${hash16(bytes)}.jpg`;
    assert.deepEqual(reply, { ok: true, portada: key, url: `https://pub-8a005187082e401abad47cdee4ec88ab.r2.dev/${key}`, mensaje: COVER_DONE_MESSAGE });
    assert.match(key, COVER_KEY);
    assert.equal(publicBucket.objects.get(key).httpMetadata.cacheControl, IMAGE_CACHE_CONTROL);
    assert.equal(publicBucket.objects.get(key).httpMetadata.contentType, 'image/jpeg');
    assert.deepEqual(Object.fromEntries(parseCoverIndex(publicBucket.text(COVER_INDEX_KEY))), { [SONG]: key });
    assert.equal(publicBucket.objects.get(COVER_INDEX_KEY).httpMetadata.cacheControl, INDEX_CACHE_CONTROL);
    assert.equal(github.length, 0);
    // La primera escritura del índice es «solo si no existe».
    const indexPut = publicBucket.calls.find((item) => item.op === 'put' && item.key === COVER_INDEX_KEY);
    assert.equal(indexPut.options.onlyIf.get('if-none-match'), '*');
  });

  test('otra portada del mismo id la sustituye en el índice (con If-Match del ETag) y no borra la anterior', async () => {
    const { call, publicBucket } = setup();
    const first = await (await call('/api/portada', coverInit(jpeg(1)))).json();
    const etag = publicBucket.objects.get(COVER_INDEX_KEY).etag;
    const second = await (await call('/api/portada', coverInit(jpeg(2)))).json();
    assert.notEqual(first.portada, second.portada);
    assert.equal(parseCoverIndex(publicBucket.text(COVER_INDEX_KEY)).get(SONG), second.portada);
    assert.ok(publicBucket.objects.has(first.portada));
    const lastIndexPut = publicBucket.calls.filter((item) => item.op === 'put' && item.key === COVER_INDEX_KEY).at(-1);
    assert.deepEqual(lastIndexPut.options.onlyIf, { etagMatches: etag });
    // La misma imagen otra vez: mismo fichero y el índice no se reescribe.
    const before = publicBucket.calls.length;
    const again = await (await call('/api/portada', coverInit(jpeg(2)))).json();
    assert.equal(again.portada, second.portada);
    assert.equal(publicBucket.calls.slice(before).filter((item) => item.op === 'put' && item.key === COVER_INDEX_KEY).length, 0);
  });

  test('dos portadas a la vez: el índice se reintenta y conserva las dos', async () => {
    const { call, publicBucket } = setup();
    publicBucket.seed(COVER_INDEX_KEY, '{}');
    let raced = false;
    publicBucket.hooks.beforePut = (key) => {
      // Otra petición escribe la portada del álbum justo antes de la primera escritura del índice.
      if (key === COVER_INDEX_KEY && !raced) {
        raced = true;
        publicBucket.seed(COVER_INDEX_KEY, JSON.stringify({ [FOLDER]: `portadas/${FOLDER}-0123456789abcdef.jpg` }));
      }
    };
    const reply = await (await call('/api/portada', coverInit(jpeg(3)))).json();
    const index = parseCoverIndex(publicBucket.text(COVER_INDEX_KEY));
    assert.equal(index.get(SONG), reply.portada);
    assert.equal(index.get(FOLDER), `portadas/${FOLDER}-0123456789abcdef.jpg`);
    assert.equal(publicBucket.calls.filter((item) => item.op === 'put' && item.key === COVER_INDEX_KEY).length, 2);
  });

  test('si el índice cambia en cada intento, 503 tras los reintentos', async () => {
    const bucket = fakeR2();
    bucket.seed(COVER_INDEX_KEY, '{}');
    bucket.hooks.beforePut = (key) => { if (key === COVER_INDEX_KEY) bucket.seed(COVER_INDEX_KEY, '{}'); };
    const sleeps = [];
    await assert.rejects(
      updateCoverIndex(bucket, SONG, `portadas/${SONG}-0123456789abcdef.jpg`, { attempts: 3, sleep: async (ms) => { sleeps.push(ms); } }),
      (error) => error.status === 503,
    );
    assert.equal(sleeps.length, 3);
  });

  test('la portada por /api/editar (como en Vercel) va también al bucket, sin GitHub ni token', async () => {
    const { call, publicBucket, github } = setup({ env: { GITHUB_TOKEN: '' } });
    const response = await call('/api/editar', coverInit(jpeg(4), FOLDER));
    assert.equal(response.status, 200);
    const reply = await response.json();
    assert.match(reply.portada, new RegExp(`^portadas/${FOLDER}-[0-9a-f]{16}\\.jpg$`));
    assert.equal(parseCoverIndex(publicBucket.text(COVER_INDEX_KEY)).get(FOLDER), reply.portada);
    assert.equal(github.length, 0);
  });

  test('rechazos de portada: no JPEG, id no válido, más de 1 MB, otro tipo, GET', async () => {
    const { call, publicBucket } = setup();
    assert.equal((await call('/api/portada', coverInit(new Uint8Array([1, 2, 3, 4, 5, 6])))).status, 400);
    assert.equal((await call('/api/portada', coverInit(jpeg(1), 'S123'))).status, 400);
    assert.equal((await call('/api/portada', coverInit(jpeg(1), 'F0123456789'))).status, 400);
    assert.equal((await call('/api/portada', coverInit(jpeg(1, 1024 * 1024 + 1)))).status, 413);
    assert.equal((await call('/api/portada', coverInit(jpeg(1), SONG, { type: 'image/png' }))).status, 415);
    assert.equal((await call('/api/portada')).status, 405);
    assert.equal(publicBucket.objects.size, 0);
  });

  test('sin bucket público: 500 claro', async () => {
    const { call } = setup({ env: { PUBLIC_BUCKET: undefined } });
    const response = await call('/api/portada', coverInit(jpeg(1)));
    assert.equal(response.status, 500);
    assert.match((await response.json()).error, /no están configuradas/);
  });

  test('GET /api/portadas devuelve el índice sin caché', async () => {
    const { call } = setup();
    const reply = await (await call('/api/portada', coverInit(jpeg(5)))).json();
    const response = await call('/api/portadas', { headers: { Origin: WEB_ORIGIN } });
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), { [SONG]: reply.portada });
  });
});
