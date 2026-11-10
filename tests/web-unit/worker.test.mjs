// Pruebas del Worker de Cloudflare «reminiscencia-api» (worker/src/index.js; ADR-0029) con los dos buckets de R2
// simulados (r2-falso.mjs, con la forma del binding) y la API de GitHub simulada: salud, CORS solo para la web y
// localhost, subida completa con trozos de más de 4 MB, idempotencia y carreras, aviso al workflow y su reintento,
// ediciones y su estado, portadas al bucket público con índice condicional y reintentos, y rechazos. Sin red.
// Ejecución: node --test tests/web-unit/worker.test.mjs
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { beforeEach, describe, test } from 'node:test';

import { handleRequest, isAllowedOrigin, ALLOWED_HEADERS, API_HEADER, COVER_DONE_MESSAGE, SITE_ORIGIN, WEB_ORIGIN, NETLIFY_ORIGIN, YOUTUBE_UPSTREAM, DEFAULT_YOUTUBE_UPSTREAMS, youtubeUpstreams, resetYoutubeUpstreamHealth } from '../../worker/src/index.js';
import { YOUTUBE_MARK_HEADER } from '../../frontend/web/server/youtube-mark.js';
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

describe('audio público por el Worker (ADR-0031)', () => {
  const AUDIO_ID = 'S0123456789abcdef';
  const AUDIO_PATH = `/audio/${AUDIO_ID}.opus`;
  const BYTES = Uint8Array.from({ length: 1000 }, (_, i) => i % 251);
  const withAudio = (env) => {
    const world = setup(env ? { env } : {});
    world.publicBucket.seed(`audio/${AUDIO_ID}.opus`, BYTES, { contentType: 'audio/ogg' });
    world.publicBucket.calls.length = 0;
    return world;
  };
  const bytesOf = async (response) => new Uint8Array(await response.arrayBuffer());

  test('GET sin Range: 200 con el audio entero, tipo Opus, caché de un año, ETag y la cabecera del Worker', async () => {
    const { call, publicBucket } = withAudio();
    const response = await call(AUDIO_PATH);
    assert.equal(response.status, 200);
    assert.deepEqual(await bytesOf(response), BYTES);
    assert.equal(response.headers.get('content-type'), 'audio/ogg; codecs=opus');
    assert.equal(response.headers.get('accept-ranges'), 'bytes');
    assert.equal(response.headers.get('cache-control'), 'public, max-age=31536000, immutable');
    assert.equal(response.headers.get('content-length'), '1000');
    assert.match(response.headers.get('etag'), /^"v\d+"$/);
    assert.equal(response.headers.get(API_HEADER), '1');
    // Sin Origin (la APK, el elemento <audio>): se atiende, sin CORS.
    assert.equal(response.headers.get('access-control-allow-origin'), null);
    // Una sola lectura del bucket, sin head().
    assert.deepEqual(publicBucket.calls.map((item) => item.op), ['get']);
  });

  test('CORS para la web: expone Content-Range, Content-Length, Accept-Ranges y ETag; preflight con Range y HEAD', async () => {
    const { call } = withAudio();
    const response = await call(AUDIO_PATH, { headers: { Origin: WEB_ORIGIN, Range: 'bytes=0-9' } });
    assert.equal(response.status, 206);
    assert.equal(response.headers.get('access-control-allow-origin'), WEB_ORIGIN);
    const exposed = response.headers.get('access-control-expose-headers').split(',').map((item) => item.trim());
    for (const name of [API_HEADER, 'Content-Range', 'Content-Length', 'Accept-Ranges', 'ETag']) assert.ok(exposed.includes(name), name);
    const preflight = await call(AUDIO_PATH, { method: 'OPTIONS', headers: { Origin: WEB_ORIGIN, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'range' } });
    assert.equal(preflight.status, 204);
    assert.match(preflight.headers.get('access-control-allow-headers'), /\bRange\b/);
    assert.match(preflight.headers.get('access-control-allow-methods'), /HEAD/);
  });

  test('otro origen: 403 sin leer el bucket', async () => {
    const { call, publicBucket } = withAudio();
    const response = await call(AUDIO_PATH, { headers: { Origin: 'https://malo.example' } });
    assert.equal(response.status, 403);
    assert.equal(publicBucket.calls.length, 0);
  });

  test('rangos de un tramo: 206 con Content-Range, leídos por R2 (range) del mismo objeto, también abiertos y sufijos', async () => {
    const { call, publicBucket } = withAudio();
    const cases = [
      ['bytes=0-99', 0, 99],
      ['bytes=990-', 990, 999],
      ['bytes=-10', 990, 999],
      ['bytes=500-5000', 500, 999],
      ['bytes=0-0', 0, 0],
      ['bytes=-5000', 0, 999],
    ];
    for (const [header, start, end] of cases) {
      publicBucket.calls.length = 0;
      const response = await call(AUDIO_PATH, { headers: { Range: header } });
      assert.equal(response.status, 206, header);
      assert.equal(response.headers.get('content-range'), `bytes ${start}-${end}/1000`, header);
      assert.equal(response.headers.get('content-length'), String(end - start + 1), header);
      assert.equal(response.headers.get('content-type'), 'audio/ogg; codecs=opus');
      assert.equal(response.headers.get('cache-control'), 'public, max-age=31536000, immutable');
      assert.deepEqual(await bytesOf(response), BYTES.slice(start, end + 1), header);
      const get = publicBucket.calls.find((item) => item.op === 'get');
      assert.deepEqual(get.options.range, { offset: start, length: end - start + 1 }, header);
      assert.deepEqual(get.options.onlyIf, { etagMatches: 'v1' }, header);
    }
  });

  test('rango fuera del audio: 416 con Content-Range bytes */tamaño; rango inválido o de varios tramos: 200 entero', async () => {
    const { call } = withAudio();
    for (const header of ['bytes=1000-', 'bytes=5000-6000', 'bytes=-0']) {
      const response = await call(AUDIO_PATH, { headers: { Range: header } });
      assert.equal(response.status, 416, header);
      assert.equal(response.headers.get('content-range'), 'bytes */1000', header);
    }
    for (const header of ['bytes=0-1,5-6', 'items=0-5', 'bytes=9-3', 'bytes=abc']) {
      const response = await call(AUDIO_PATH, { headers: { Range: header } });
      assert.equal(response.status, 200, header);
      assert.equal(response.headers.get('content-range'), null, header);
      assert.equal((await bytesOf(response)).length, 1000, header);
    }
  });

  test('If-Range con otra etiqueta: se ignora el Range y se sirve entero; con la suya, el tramo', async () => {
    const { call } = withAudio();
    const etag = (await call(AUDIO_PATH, { method: 'HEAD' })).headers.get('etag');
    assert.equal((await call(AUDIO_PATH, { headers: { Range: 'bytes=0-9', 'If-Range': '"otra"' } })).status, 200);
    assert.equal((await call(AUDIO_PATH, { headers: { Range: 'bytes=0-9', 'If-Range': etag } })).status, 206);
  });

  test('HEAD: cabeceras sin cuerpo (entero o tramo) y sin leer el audio', async () => {
    const { call, publicBucket } = withAudio();
    const whole = await call(AUDIO_PATH, { method: 'HEAD' });
    assert.equal(whole.status, 200);
    assert.equal(whole.headers.get('content-length'), '1000');
    assert.equal(whole.headers.get('content-type'), 'audio/ogg; codecs=opus');
    assert.equal(whole.headers.get('accept-ranges'), 'bytes');
    assert.equal((await bytesOf(whole)).length, 0);
    const part = await call(AUDIO_PATH, { method: 'HEAD', headers: { Range: 'bytes=10-19' } });
    assert.equal(part.status, 206);
    assert.equal(part.headers.get('content-range'), 'bytes 10-19/1000');
    assert.equal(part.headers.get('content-length'), '10');
    assert.ok(publicBucket.calls.every((item) => item.op === 'head'));
    assert.equal((await call('/audio/S00000000000000ff.opus', { method: 'HEAD' })).status, 404);
  });

  test('If-None-Match con su ETag: 304 sin cuerpo (GET, HEAD y con Range); con otra: 200', async () => {
    const { call } = withAudio();
    const etag = (await call(AUDIO_PATH)).headers.get('etag');
    for (const [init, label] of [
      [{ headers: { 'If-None-Match': etag } }, 'GET'],
      [{ headers: { 'If-None-Match': `W/${etag}` } }, 'GET débil'],
      [{ headers: { 'If-None-Match': `"otra", ${etag}` } }, 'GET lista'],
      [{ headers: { 'If-None-Match': '*' } }, 'GET *'],
      [{ method: 'HEAD', headers: { 'If-None-Match': etag } }, 'HEAD'],
      [{ headers: { 'If-None-Match': etag, Range: 'bytes=0-9' } }, 'Range'],
    ]) {
      const response = await call(AUDIO_PATH, init);
      assert.equal(response.status, 304, label);
      assert.equal(response.headers.get('etag'), etag, label);
      assert.equal(response.headers.get('cache-control'), 'public, max-age=31536000, immutable', label);
      assert.equal((await bytesOf(response)).length, 0, label);
    }
    const changed = await call(AUDIO_PATH, { headers: { 'If-None-Match': '"otra"' } });
    assert.equal(changed.status, 200);
    assert.equal((await bytesOf(changed)).length, 1000);
  });

  test('audio que no está en el bucket público (privado o inexistente): 404 sin caché', async () => {
    const { call } = withAudio();
    const response = await call('/audio/S00000000000000ff.opus');
    assert.equal(response.status, 404);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get(API_HEADER), '1');
    assert.equal((await call('/audio/S00000000000000ff.opus', { headers: { Range: 'bytes=0-9' } })).status, 404);
  });

  test('ids no válidos y rutas fuera de audio/: 404 sin tocar el bucket', async () => {
    const { call, publicBucket } = withAudio();
    publicBucket.seed('portadas/indice.json', '{}');
    publicBucket.seed('audio/L0123456789abcdef.opus', BYTES);
    publicBucket.calls.length = 0;
    for (const path of [
      '/audio/L0123456789abcdef.opus', // subida local de un navegador
      '/audio/S0123456789ABCDEF.opus', // mayúsculas
      '/audio/S0123456789abcde.opus', // 15 hex
      '/audio/S0123456789abcdef0.opus', // 17 hex
      '/audio/S0123456789abcdef.mp3',
      '/audio/S0123456789abcdef.opus/x',
      '/audio/..%2Fportadas%2Findice.json',
      '/audio/%2e%2e/portadas/indice.json',
      '/audio/',
      '/audio/portadas/indice.json',
      '/audio/../portadas/indice.json',
    ]) {
      const response = await call(path);
      assert.equal(response.status, 404, path);
    }
    assert.equal(publicBucket.calls.length, 0);
  });

  test('POST u otro método: 405; sin bucket público: 503; R2 que falla: 502', async () => {
    const { call } = withAudio();
    const post = await call(AUDIO_PATH, { method: 'POST', body: 'x' });
    assert.equal(post.status, 405);
    assert.equal(post.headers.get('allow'), 'GET, HEAD');
    const noBucket = await setup({ env: { PUBLIC_BUCKET: undefined } }).call(AUDIO_PATH);
    assert.equal(noBucket.status, 503);
    assert.equal(noBucket.headers.get(API_HEADER), '1');
    const failing = fakeR2({ failOn: (operation) => operation === 'get' || operation === 'head' });
    for (const init of [{}, { headers: { Range: 'bytes=0-9' } }]) {
      const broken = await handleRequest(new Request(`https://w.example${AUDIO_PATH}`, init), { PUBLIC_BUCKET: failing });
      assert.equal(broken.status, 502);
      assert.equal(broken.headers.get(API_HEADER), '1');
    }
  });

  test('si el audio cambia entre head() y get(), 503 para reintentar (nunca un tramo de otro fichero)', async () => {
    const { call, publicBucket } = withAudio();
    const originalHead = publicBucket.head;
    publicBucket.head = async (key) => {
      const meta = await originalHead(key);
      publicBucket.seed(key, BYTES.slice(0, 500));
      return meta;
    };
    const response = await call(AUDIO_PATH, { headers: { Range: 'bytes=0-9' } });
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('retry-after'), '1');
  });
});

describe('web en Cloudflare (ADR-0034) y YouTube por Vercel/Netlify con failover (ADR-0038)', () => {
  const SITE = 'https://reminiscencia.cometia.es';
  // La memoria de salud de los upstreams es de módulo (por isolate): cada caso empieza limpio.
  beforeEach(() => resetYoutubeUpstreamHealth());
  /** Binding ASSETS simulado: anota lo que se le pide. */
  const fakeAssets = () => {
    const seen = [];
    return {
      seen,
      fetch: async (request) => {
        seen.push(new URL(request.url).pathname);
        return new Response('<!doctype html>', { status: 200, headers: { 'Content-Type': 'text/html' } });
      },
    };
  };
  /** Respuesta con la cabecera-marca (ADR-0038): simula que NUESTRA función de YouTube se ejecutó en el upstream. */
  const marked = (body = '{"items":[]}', init = {}) => new Response(body, {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json', [YOUTUBE_MARK_HEADER]: '1', ...(init.headers ?? {}) },
  });
  /** 48 bytes con cabecera RIFF/WAVE, lo mínimo que acepta la descarga nativa. */
  const fakeWav = () => {
    const wav = new Uint8Array(48);
    wav.set(new TextEncoder().encode('RIFF'), 0);
    wav.set(new TextEncoder().encode('WAVE'), 8);
    return wav;
  };

  test('el dominio propio es un origen admitido; la web de Vercel también sigue', async () => {
    assert.equal(SITE_ORIGIN, SITE);
    assert.ok(isAllowedOrigin(SITE));
    assert.ok(isAllowedOrigin(WEB_ORIGIN));
    assert.ok(!isAllowedOrigin('https://otra.cometia.es'));
    assert.ok(!isAllowedOrigin('https://reminiscencia.cometia.es.malo.example'));
    const { call } = setup();
    const response = await call('/api/salud', { headers: { Origin: SITE } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('access-control-allow-origin'), SITE);
  });

  test('lo que no es /api/* ni /audio/* lo sirve ASSETS, sin pasar por CORS ni por las rutas del API', async () => {
    const assets = fakeAssets();
    const env = { ASSETS: assets, PUBLIC_BUCKET: fakeR2() };
    const paths = ['/', '/index.html', '/data/songs.json', '/js/app.js', '/api', '/apis/x'];
    for (const path of paths) {
      const response = await handleRequest(new Request(`${SITE}${path}`, { headers: { Origin: 'https://malo.example' } }), env);
      assert.equal(response.status, 200, path);
      assert.equal(response.headers.get(API_HEADER), null, path);
    }
    assert.deepEqual(assets.seen, paths);
    // El API y el audio siguen siendo del Worker.
    const health = await handleRequest(new Request(`${SITE}/api/salud`), env);
    assert.equal(health.headers.get(API_HEADER), '1');
    const audio = await handleRequest(new Request(`${SITE}/audio/S0000000000000001.opus`), env);
    assert.equal(audio.status, 404);
    assert.equal(audio.headers.get(API_HEADER), '1');
    assert.equal(assets.seen.length, paths.length);
  });

  test('youtubeUpstreams: por defecto Vercel y luego Netlify; env.YOUTUBE_UPSTREAMS lo cambia', () => {
    assert.equal(YOUTUBE_UPSTREAM, WEB_ORIGIN);
    assert.deepEqual([...DEFAULT_YOUTUBE_UPSTREAMS], [WEB_ORIGIN, NETLIFY_ORIGIN]);
    assert.deepEqual(youtubeUpstreams(), [WEB_ORIGIN, NETLIFY_ORIGIN]);
    assert.deepEqual(youtubeUpstreams({}), [WEB_ORIGIN, NETLIFY_ORIGIN]);
    assert.deepEqual(youtubeUpstreams({ YOUTUBE_UPSTREAMS: '' }), [WEB_ORIGIN, NETLIFY_ORIGIN]);
    assert.deepEqual(youtubeUpstreams({ YOUTUBE_UPSTREAMS: 'https://a.test, https://b.test ' }), ['https://a.test', 'https://b.test']);
  });

  test('convert/status/download los ejecuta el propio Worker (nativo), sin reenviar a ninguna plataforma', async () => {
    // convert: valida la URL y llama al conversor (api.yttowav.org), no a Vercel/Netlify.
    const convertCalls = [];
    const convert = await handleRequest(new Request(`${SITE}/api/youtube/convert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: SITE },
      body: JSON.stringify({ url: 'https://www.youtube.com/watch?v=abcdefghijk', title: 'Tema' }),
    }), {}, {
      fetchImpl: async (url, init) => {
        convertCalls.push({ url: String(url), body: init?.body });
        return new Response(JSON.stringify({ jobId: 'job_1' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      },
    });
    assert.equal(convert.status, 200);
    assert.deepEqual(await convert.json(), { jobId: 'job_1' });
    assert.equal(convert.headers.get(API_HEADER), '1');
    assert.equal(convert.headers.get(YOUTUBE_MARK_HEADER), '1', 'la respuesta nativa también lleva la cabecera-marca');
    assert.equal(convert.headers.get('access-control-allow-origin'), SITE);
    assert.equal(convertCalls.length, 1);
    assert.ok(convertCalls[0].url.startsWith('https://api.yttowav.org/api/convert'), 'va al conversor, no a una plataforma');

    // status: filtra y normaliza (no acepta una URL de descarga externa).
    const status = await handleRequest(new Request(`${SITE}/api/youtube/status?jobId=job_1`), {}, {
      fetchImpl: async () => new Response(JSON.stringify({ status: 'completed', downloadUrl: 'https://attacker.test/x' }), { status: 200 }),
    });
    assert.deepEqual(await status.json(), { status: 'completed' });
    assert.equal(status.headers.get(YOUTUBE_MARK_HEADER), '1');

    // download: transmite el WAV del conversor en flujo.
    const downloadUrls = [];
    const download = await handleRequest(new Request(`${SITE}/api/youtube/download?jobId=job_1`), {}, {
      fetchImpl: async (url) => {
        downloadUrls.push(String(url));
        if (String(url).includes('/api/status')) return new Response(JSON.stringify({ status: 'completed' }), { status: 200 });
        return new Response(fakeWav(), { status: 200, headers: { 'content-type': 'audio/wav', 'content-length': '48' } });
      },
    });
    assert.equal(download.status, 200);
    assert.equal(download.headers.get('content-type'), 'audio/wav');
    assert.equal(download.headers.get(YOUTUBE_MARK_HEADER), '1');
    assert.equal((await download.arrayBuffer()).byteLength, 48);
    assert.ok(downloadUrls.some((url) => url.startsWith('https://api.yttowav.org/api/download/')));
  });

  test('search/playlist se reenvían al primer upstream con la cabecera-marca (Vercel primero): método, ruta, cuerpo y cabeceras útiles', async () => {
    const calls = [];
    const fetchImpl = async (url, init = {}) => {
      const target = new URL(url);
      calls.push({ origin: target.origin, url: target.href, method: init.method, headers: new Headers(init.headers), body: init.body, redirect: init.redirect });
      return marked('{"items":[]}', { headers: { 'X-Vercel-Id': 'v1' } });
    };
    const search = await handleRequest(new Request(`${SITE}/api/youtube/search?q=bolero`, {
      headers: { Origin: SITE, 'X-Homeostasia-Trace': 't1', Cookie: 'no', Authorization: 'no' },
    }), {}, { fetchImpl });
    assert.equal(search.status, 200);
    assert.equal(search.headers.get('access-control-allow-origin'), SITE);
    assert.equal(search.headers.get('x-vercel-id'), 'v1');
    assert.equal(search.headers.get(API_HEADER), '1');
    assert.equal(calls.length, 1);
    const [sent] = calls;
    assert.equal(sent.origin, YOUTUBE_UPSTREAM, 'Vercel primero');
    assert.equal(sent.url, `${YOUTUBE_UPSTREAM}/api/youtube/search?q=bolero`);
    assert.equal(sent.method, 'GET');
    assert.equal(sent.body, undefined);
    assert.equal(sent.headers.get('x-homeostasia-trace'), 't1');
    assert.equal(sent.headers.get('cookie'), null);
    assert.equal(sent.headers.get('authorization'), null);
    assert.equal(sent.headers.get('origin'), null);
    assert.equal(sent.redirect, 'manual');

    const playlist = await handleRequest(new Request(`${SITE}/api/youtube/playlist?url=https%3A%2F%2Fwww.youtube.com%2Fplaylist%3Flist%3DPL1`), {}, { fetchImpl });
    assert.equal(playlist.status, 200);
    assert.equal(calls[1].url, `${YOUTUBE_UPSTREAM}/api/youtube/playlist?url=https%3A%2F%2Fwww.youtube.com%2Fplaylist%3Flist%3DPL1`);
  });

  test('failover: si Vercel responde sin la cabecera-marca (402 pausado), se usa Netlify', async () => {
    const tried = [];
    const fetchImpl = async (url) => {
      const origin = new URL(url).origin;
      tried.push(origin);
      if (origin === WEB_ORIGIN) return new Response('Payment Required', { status: 402, headers: { 'x-vercel-error': 'DEPLOYMENT_DISABLED' } });
      return marked('{"items":[{"id":"abcdefghijk"}]}');
    };
    const response = await handleRequest(new Request(`${SITE}/api/youtube/search?q=x`), {}, { fetchImpl });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get(API_HEADER), '1');
    assert.deepEqual(await response.json(), { items: [{ id: 'abcdefghijk' }] });
    assert.deepEqual(tried, [WEB_ORIGIN, NETLIFY_ORIGIN], 'prueba Vercel y luego Netlify');
  });

  test('vuelta automática a Vercel el 7-dic: un 200 SIN cabecera-marca (código anterior) se usa, sin pasar a Netlify', async () => {
    const tried = [];
    const fetchImpl = async (url) => {
      tried.push(new URL(url).origin);
      // Vercel desbloqueado sirviendo el código anterior a esta cabecera: 200 con resultados, sin X-Reminiscencia-Youtube.
      return new Response('{"items":[{"id":"abcdefghijk"}]}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    const response = await handleRequest(new Request(`${SITE}/api/youtube/search?q=x`), {}, { fetchImpl });
    assert.equal(response.status, 200);
    assert.deepEqual(tried, [WEB_ORIGIN], 'usa Vercel directamente en cuanto responde 200, sin failover a Netlify');
    assert.deepEqual(await response.json(), { items: [{ id: 'abcdefghijk' }] });
  });

  test('un error legítimo de la función (502 CON cabecera-marca) se devuelve tal cual, sin failover', async () => {
    const tried = [];
    const fetchImpl = async (url) => {
      tried.push(new URL(url).origin);
      return marked('{"ok":false,"error":"YouTube devolvió demasiados datos."}', { status: 502 });
    };
    const response = await handleRequest(new Request(`${SITE}/api/youtube/search?q=x`), {}, { fetchImpl });
    assert.equal(response.status, 502);
    assert.deepEqual(tried, [WEB_ORIGIN], 'un error de la función no es una caída de plataforma');
    assert.equal((await response.json()).ok, false);
  });

  test('recuerda el upstream caído: la siguiente petición va directa a Netlify sin reprobar Vercel', async () => {
    const order = [];
    let vercelHits = 0;
    const fetchImpl = async (url) => {
      const origin = new URL(url).origin;
      order.push(origin);
      if (origin === WEB_ORIGIN) { vercelHits += 1; return new Response('', { status: 402 }); }
      return marked();
    };
    await handleRequest(new Request(`${SITE}/api/youtube/search?q=a`), {}, { fetchImpl });
    await handleRequest(new Request(`${SITE}/api/youtube/search?q=b`), {}, { fetchImpl });
    assert.equal(vercelHits, 1, 'Vercel solo se prueba una vez mientras se le recuerda caído');
    assert.deepEqual(order, [WEB_ORIGIN, NETLIFY_ORIGIN, NETLIFY_ORIGIN]);
  });

  test('si ningún upstream responde, 502 con la cabecera del Worker; otro origen, 403 sin reenviar', async () => {
    const failing = async () => { throw new TypeError('fetch failed'); };
    const down = await handleRequest(new Request(`${SITE}/api/youtube/search?q=x`), {}, { fetchImpl: failing });
    assert.equal(down.status, 502);
    assert.equal(down.headers.get(API_HEADER), '1');
    assert.equal((await down.json()).ok, false);

    const calls = [];
    const fetchImpl = async (url) => { calls.push(String(url)); return marked(); };
    const foreign = await handleRequest(new Request(`${SITE}/api/youtube/search?q=x`, { headers: { Origin: 'https://malo.example' } }), {}, { fetchImpl });
    assert.equal(foreign.status, 403);
    assert.equal(calls.length, 0);
  });

  test('/api/subir sigue siendo del Worker en el dominio propio (no se reenvía a Vercel)', async () => {
    const { call, privateBucket } = setup();
    const response = await call('/api/subir', chunkInit({ index: 0, total: 1, body: OPUS, origin: SITE }));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('access-control-allow-origin'), SITE);
    assert.ok(privateBucket.objects.size > 0);
  });
});
