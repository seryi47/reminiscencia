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

describe('/api/editar retirado (fixes críticos ADR-0052)', () => {
  test('POST organize responde 410 con mensaje claro y no toca GitHub', async () => {
    const { call, github } = setup();
    const response = await call('/api/editar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: WEB_ORIGIN },
      body: JSON.stringify({ action: 'organize', payload: { op: 'edit_song', song_id: SONG, title: 'Nuevo' } }),
    });
    assert.equal(response.status, 410);
    const reply = await response.json();
    assert.equal(reply.ok, false);
    assert.match(reply.error, /ADR-0052/);
    assert.match(reply.error, /\/api\/catalogo\/edit/);
    assert.equal(github.length, 0);
  });

  test('GET ?incidencia=N también responde 410, no abre GitHub', async () => {
    const { call, github } = setup();
    const response = await call('/api/editar?incidencia=77', { headers: { Origin: WEB_ORIGIN } });
    assert.equal(response.status, 410);
    assert.equal(github.length, 0);
  });

  test('portada por /api/editar también responde 410 (usar /api/portada)', async () => {
    const { call, publicBucket, github } = setup({ env: { GITHUB_TOKEN: '' } });
    const response = await call('/api/editar', coverInit(jpeg(4), FOLDER));
    assert.equal(response.status, 410);
    assert.equal(github.length, 0);
    assert.equal(publicBucket.calls.filter((item) => item.op === 'put').length, 0);
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

  test('fallback a YT Music cuando AMBOS upstreams caídos (ADR-0038 ampliado 2026-11-24): /search sirve desde el Worker', async () => {
    const { resetMusicCredsCache } = await import('../../frontend/web/server/youtube-music.js');
    resetMusicCredsCache();
    // Replica el caso real del 2026-11-24: Vercel pausado (402) + Netlify con cupo mensual agotado (usage_exceeded,
    // un 429 sin la cabecera-marca). El Worker tiene que caer a searchYoutubeMusic directamente y servir el /search.
    const fetchImpl = async (url) => {
      const u = new URL(url);
      if (u.origin === WEB_ORIGIN) return new Response('', { status: 402 });
      if (u.origin === NETLIFY_ORIGIN) return new Response('{"error":"usage_exceeded"}', { status: 429 });
      // YouTube Music home (devuelve el HTML con las creds de InnerTube)
      if (u.hostname === 'music.youtube.com' && u.pathname === '/') {
        return new Response(
          '<html>var ytcfg = {"INNERTUBE_API_KEY":"TEST_KEY","INNERTUBE_CLIENT_VERSION":"1.20260101.01.00"};</html>',
          { status: 200, headers: { 'Content-Type': 'text/html' } },
        );
      }
      // YouTube Music search API
      if (u.hostname === 'music.youtube.com' && u.pathname.includes('/youtubei/v1/search')) {
        const body = JSON.stringify({
          contents: { tabbedSearchResultsRenderer: { tabs: [{ tabRenderer: { content: { sectionListRenderer: { contents: [
            { musicShelfRenderer: { contents: [
              { musicResponsiveListItemRenderer: {
                flexColumns: [
                  { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: 'Orgullo Banderillero' }] } } },
                  // cols[1] lleva artista + bullets + duración, que es como YT Music lo serializa en el renderer
                  { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [
                    { text: 'SFDK' }, { text: ' • ' }, { text: '4:28' },
                  ] } } },
                ],
                navigationEndpoint: { watchEndpoint: { videoId: 'abcdefghijk' } },
              } },
            ] } },
          ] } } } }] } },
        });
        return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      throw new TypeError('fetch failed');
    };
    const response = await handleRequest(new Request(`${SITE}/api/youtube/search?q=SFDK+Orgullo+Banderillero`), {}, { fetchImpl });
    assert.equal(response.status, 200);
    // La respuesta trae la cabecera-marca para que el navegador vea que es del Worker, no de la plataforma.
    assert.equal(response.headers.get('X-Reminiscencia-Youtube'), 'worker-fallback');
    const data = await response.json();
    assert.ok(Array.isArray(data.items));
    assert.ok(data.items.length > 0, 'YT Music devolvió candidatos cuando los upstreams estaban caídos');
  });

  test('fallback de /playlist: con upstreams caídos, scrapeamos youtube.com/playlist (ADR-0038 ampliado 2026-11-25)', async () => {
    // YouTube migró en 2026-11 a `lockupViewModel` — nuestro parser acepta tanto ese como el antiguo
    // `playlistVideoRenderer`. Antes, con ambos upstreams caídos, importar una playlist daba 502.
    const ytInitialData = {
      header: { pageHeaderRenderer: { pageTitle: 'Mi Lista' } },
      contents: {
        twoColumnBrowseResultsRenderer: {
          tabs: [{ tabRenderer: { content: { sectionListRenderer: { contents: [{ itemSectionRenderer: { contents: [{ playlistVideoListRenderer: { contents: [
            // Formato clásico (sigue funcionando).
            { playlistVideoRenderer: { videoId: 'aaaaaaaaaaa', title: { runs: [{ text: 'Primera' }] } } },
            // Formato nuevo (lockupViewModel).
            { lockupViewModel: {
              contentId: 'bbbbbbbbbbb',
              contentType: 'LOCKUP_CONTENT_TYPE_VIDEO',
              metadata: { lockupMetadataViewModel: { title: { content: 'Segunda' } } },
            } },
          ] } }] } }] } } } }],
        },
      },
    };
    const page = `<!doctype html><html><head></head><body>
      <script>var ytInitialData = ${JSON.stringify(ytInitialData)};</script>
    </body></html>`;
    const fetchImpl = async (url) => {
      const u = new URL(String(url));
      // Vercel/Netlify caídos.
      if (u.hostname === 'reminiscencia.vercel.app' || u.hostname === 'reminiscencia.netlify.app') {
        return new Response('', { status: 402 });
      }
      if (u.hostname === 'www.youtube.com' && u.pathname === '/playlist') {
        return new Response(page, { status: 200, headers: { 'Content-Type': 'text/html' } });
      }
      throw new TypeError('fetch failed');
    };
    const response = await handleRequest(
      new Request(`${SITE}/api/youtube/playlist?list=PLabc123`),
      {},
      { fetchImpl },
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('X-Reminiscencia-Youtube'), 'worker-fallback');
    const data = await response.json();
    assert.equal(data.title, 'Mi Lista');
    assert.equal(data.items.length, 2);
    assert.match(data.items[0].url, /aaaaaaaaaaa/);
    // Contrato de `/playlist` que espera homeostasia.js (ADR-0038 ampliado 2026-11-25): `playlist.{id,title}`.
    assert.equal(data.playlist?.id, 'PLabc123');
    assert.equal(data.playlist?.title, 'Mi Lista');
  });

  test('fallback de /playlist con URL de VÍDEO suelto: resuelve el título vía oEmbed (ADR-0038 ampliado 2026-11-25)', async () => {
    // Un enlace de vídeo (no playlist) por `/api/youtube/playlist` antes caía a 502 cuando Vercel+Netlify estaban caídos:
    // el scrape de youtube.com/playlist no aplicaba (no hay `list=`) y no había alternativa. Ahora el Worker resuelve el
    // título con oEmbed de YouTube (público, sin API key).
    const fetchImpl = async (url) => {
      const u = new URL(String(url));
      if (u.hostname === 'reminiscencia.vercel.app' || u.hostname === 'reminiscencia.netlify.app') {
        return new Response('', { status: 402 });
      }
      if (u.hostname === 'www.youtube.com' && u.pathname === '/oembed') {
        return new Response(JSON.stringify({ title: 'SIX the Musical - Haus of Holbein' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      throw new TypeError('fetch failed');
    };
    const response = await handleRequest(
      new Request(`${SITE}/api/youtube/playlist?url=${encodeURIComponent('https://youtu.be/KbyNfnlPCn4?si=JWMuxvGNz6QKuiOh')}`),
      {},
      { fetchImpl },
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('X-Reminiscencia-Youtube'), 'worker-fallback');
    const data = await response.json();
    assert.equal(data.items.length, 1);
    assert.equal(data.items[0].title, 'SIX the Musical - Haus of Holbein');
    assert.equal(data.items[0].url, 'https://www.youtube.com/watch?v=KbyNfnlPCn4');
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

describe('rate limit de la API (ADR-0046)', () => {
  // Limitador simulado con la forma del binding de Cloudflare: { limit: async ({key}) => ({success}) }.
  const fakeLimiter = (success) => {
    const keys = [];
    return { keys, limit: async ({ key }) => { keys.push(key); return { success }; } };
  };

  test('sin binding (fail-open) una petición de API no se bloquea', async () => {
    const { call } = setup(); // fullEnv no trae API_RATE_LIMITER
    const response = await call('/api/salud', { headers: { Origin: WEB_ORIGIN } });
    assert.equal(response.status, 200);
  });

  test('cuando el limitador dice que no, /api/* responde 429 antes de enrutar', async () => {
    const limiter = fakeLimiter(false);
    const { call } = setup({ env: { API_RATE_LIMITER: limiter } });
    const response = await call('/api/portadas', { headers: { Origin: WEB_ORIGIN } });
    assert.equal(response.status, 429);
    assert.equal(limiter.keys.length, 1, 'se consultó el limitador una vez');
  });

  test('la comprobación de salud NO está limitada (ni aunque el limitador niegue)', async () => {
    const limiter = fakeLimiter(false);
    const { call } = setup({ env: { API_RATE_LIMITER: limiter } });
    const response = await call('/api/salud', { headers: { Origin: WEB_ORIGIN } });
    assert.equal(response.status, 200);
    assert.equal(limiter.keys.length, 0, '/api/salud no consulta el limitador');
  });

  test('el audio NO está limitado (reproducción con rangos)', async () => {
    const limiter = fakeLimiter(false);
    const { call } = setup({ env: { API_RATE_LIMITER: limiter } });
    const response = await call('/audio/S0000000000000004.opus');
    assert.notEqual(response.status, 429);
    assert.equal(limiter.keys.length, 0, '/audio/ no consulta el limitador');
  });

  test('cuando el limitador permite, la API sigue su curso', async () => {
    const limiter = fakeLimiter(true);
    const { call } = setup({ env: { API_RATE_LIMITER: limiter } });
    const response = await call('/api/salud', { headers: { Origin: WEB_ORIGIN } });
    assert.equal(response.status, 200);
  });
});

// ─── ADR-0052: catálogo e historial en R2 ─────────────────────────────────────
describe('catálogo en R2 (ADR-0052)', () => {
  const AUTH = 'pass_de_prueba_para_X_Auth_que_no_sale_a_logs';
  const seededCatalog = () => ({
    version: 7,
    folders: [{ id: 'F0000000000000001', name: 'Álbum 1', parent_id: null }],
    songs: [
      { id: 'S0000000000000010', title: 'Antigua', artist: 'A1', year: 2000, tags: [], folder_id: 'F0000000000000001', sha256: 'sha_antigua' },
      { id: 'S0000000000000011', title: 'Otra',    artist: 'A2', year: 2001, tags: [], folder_id: null,                sha256: 'sha_otra' },
    ],
    updated_at: '2026-11-25T10:00:00.000Z',
  });
  const callCat = (env = {}) => {
    const publicBucket = fakeR2();
    const privateBucket = fakeR2();
    const fullEnv = { AUTH_PASSWORD: AUTH, GITHUB_TOKEN: TOKEN, PRIVATE_BUCKET: privateBucket, PUBLIC_BUCKET: publicBucket, ALLOW_LOCALHOST: '1', ...env };
    const call = (path, init = {}) => handleRequest(new Request(`https://reminiscencia-api.prueba.workers.dev${path}`, init), fullEnv);
    return { call, publicBucket, privateBucket };
  };
  const seed = (bucket, catalog) => bucket.seed('catalog/catalog.json', JSON.stringify(catalog), { contentType: 'application/json; charset=utf-8' });

  test('GET /api/catalogo/latest sin catálogo subido devuelve 503', async () => {
    const { call } = callCat();
    const response = await call('/api/catalogo/latest');
    assert.equal(response.status, 503);
    const data = await response.json();
    assert.equal(data.ok, false);
    assert.match(data.error, /migrado/);
  });

  test('GET /api/catalogo/latest con catálogo devuelve 200 + ETag y el contenido', async () => {
    const { call, publicBucket } = callCat();
    seed(publicBucket, seededCatalog());
    const response = await call('/api/catalogo/latest');
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('etag'), 'W/"v7"');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const data = await response.json();
    assert.equal(data.version, 7);
    assert.equal(data.songs.length, 2);
  });

  test('POST /api/catalogo/edit sin X-Auth devuelve 401', async () => {
    const { call, publicBucket } = callCat();
    seed(publicBucket, seededCatalog());
    const response = await call('/api/catalogo/edit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'rename_song', params: { song_id: 'S0000000000000010', new_title: 'Nueva' }, if_match: 7 }) });
    assert.equal(response.status, 401);
    assert.equal(publicBucket.text('catalog/catalog.json').includes('"version":7'), true);
  });

  test('POST /api/catalogo/edit con X-Auth mala devuelve 401 (timing-safe: no early return por longitud)', async () => {
    const { call, publicBucket } = callCat();
    seed(publicBucket, seededCatalog());
    const malBreve = await call('/api/catalogo/edit', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Auth': 'x' }, body: '{}' });
    assert.equal(malBreve.status, 401);
    const malLarga = await call('/api/catalogo/edit', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Auth': `${AUTH}____extra` }, body: '{}' });
    assert.equal(malLarga.status, 401);
    const malPrimerByte = await call('/api/catalogo/edit', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Auth': AUTH.replace(/^./, '!') }, body: '{}' });
    assert.equal(malPrimerByte.status, 401);
  });

  test('POST /api/catalogo/edit con if_match desactualizado devuelve 412', async () => {
    const { call, publicBucket } = callCat();
    seed(publicBucket, seededCatalog());
    const response = await call('/api/catalogo/edit', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Auth': AUTH }, body: JSON.stringify({ action: 'rename_song', params: { song_id: 'S0000000000000010', new_title: 'X' }, if_match: 3 }) });
    assert.equal(response.status, 412);
    const data = await response.json();
    assert.equal(data.current_version, 7);
  });

  test('POST /api/catalogo/edit con rename_song válido incrementa versión, registra evento y escribe snapshot diaria', async () => {
    const { call, publicBucket } = callCat();
    seed(publicBucket, seededCatalog());
    const response = await call('/api/catalogo/edit', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Auth': AUTH }, body: JSON.stringify({ action: 'rename_song', params: { song_id: 'S0000000000000010', new_title: 'Antigua (mejor título)' }, if_match: 7 }) });
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.ok, true);
    assert.equal(data.version, 8);
    assert.equal(data.event.kind, 'rename_song');
    assert.equal(data.event.version_before, 7);
    assert.equal(data.event.version_after, 8);
    // catálogo nuevo escrito
    const catalog = JSON.parse(publicBucket.text('catalog/catalog.json'));
    assert.equal(catalog.version, 8);
    assert.equal(catalog.songs.find((s) => s.id === 'S0000000000000010').title, 'Antigua (mejor título)');
    // historial: el fichero latest.jsonl trae el evento, y hay un fichero history/YYYY/MM/<ulid>.json
    const jsonl = publicBucket.text('history/latest.jsonl');
    assert.ok(jsonl && jsonl.includes('"kind":"rename_song"'), 'latest.jsonl tiene el evento');
    const hasEventFile = [...publicBucket.objects.keys()].some((k) => /^history\/\d{4}\/\d{2}\/[A-Z0-9]{26}\.json$/.test(k));
    assert.ok(hasEventFile, 'hay un fichero history/YYYY/MM/<ulid>.json');
    // snapshot diaria (primer cambio del día)
    const hasDaily = [...publicBucket.objects.keys()].some((k) => /^snapshots\/\d{4}-\d{2}-\d{2}\.json$/.test(k));
    assert.ok(hasDaily, 'se creó snapshot del día');
    // snapshot por versión anterior (para rollback)
    assert.ok(publicBucket.text('snapshots/by-version/v7.json'), 'se guardó snapshot by-version/v7.json');
  });

  test('dos POST en paralelo con el mismo if_match: uno 200 y el otro 423 o 412', async () => {
    const { call, publicBucket } = callCat();
    seed(publicBucket, seededCatalog());
    // Metemos un retardo artificial en el put del catálogo para asegurar que los dos coinciden dentro del lock.
    let primeroEnLock = null;
    publicBucket.hooks.beforePut = async (key) => {
      if (key === 'catalog/catalog.json' && primeroEnLock === null) {
        primeroEnLock = Promise.resolve();
        await primeroEnLock;
      }
    };
    const edit = () => call('/api/catalogo/edit', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Auth': AUTH }, body: JSON.stringify({ action: 'rename_song', params: { song_id: 'S0000000000000010', new_title: 'A' }, if_match: 7 }) });
    const [r1, r2] = await Promise.all([edit(), edit()]);
    const statuses = [r1.status, r2.status].sort();
    // Al menos una debe pasar (200) y la otra debe perder (423 lock o 412 if_match una vez liberado).
    assert.ok(statuses.includes(200), `una debería ser 200, llegaron ${statuses}`);
    assert.ok(statuses.includes(412) || statuses.includes(423), `la otra debe ser 412 o 423, llegaron ${statuses}`);
    // La versión acaba en 8 (solo un escritor ganó).
    assert.equal(JSON.parse(publicBucket.text('catalog/catalog.json')).version, 8);
  });

  test('POST /api/buzon/publish añade canciones con ids nuevos y added_at ISO', async () => {
    const { call, publicBucket } = callCat();
    seed(publicBucket, seededCatalog());
    const response = await call('/api/buzon/publish', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Auth': AUTH }, body: JSON.stringify({
      songs: [{ title: 'Nueva 1', artist: 'Buzón', duration_s: 120, size_bytes: 1024, sha256: 'sha_nueva_1', codec: 'opus' }],
      if_match: 7,
    }) });
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.version, 8);
    const catalog = JSON.parse(publicBucket.text('catalog/catalog.json'));
    assert.equal(catalog.songs.length, 3);
    const added = catalog.songs.find((s) => s.title === 'Nueva 1');
    assert.ok(/^S[0-9a-f]{16}$/.test(added.id), `id generado: ${added.id}`);
    assert.ok(!Number.isNaN(Date.parse(added.added_at)));
  });

  test('POST /api/catalogo/rollback restaura el catálogo y registra evento', async () => {
    const { call, publicBucket } = callCat();
    seed(publicBucket, seededCatalog());
    // Hacemos una edición para que haya snapshot v7 y pasemos a v8.
    const edit = await call('/api/catalogo/edit', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Auth': AUTH }, body: JSON.stringify({ action: 'rename_song', params: { song_id: 'S0000000000000010', new_title: 'X' }, if_match: 7 }) });
    assert.equal(edit.status, 200);
    // Rollback a v7
    const response = await call('/api/catalogo/rollback', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Auth': AUTH }, body: JSON.stringify({ to_version: 7 }) });
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.version, 9); // rollback cuenta como nueva versión
    const catalog = JSON.parse(publicBucket.text('catalog/catalog.json'));
    assert.equal(catalog.version, 9);
    // la canción recupera su título original
    assert.equal(catalog.songs.find((s) => s.id === 'S0000000000000010').title, 'Antigua');
    assert.equal(data.event.kind, 'rollback');
    assert.equal(data.event.to_version, 7);
  });

  test('GET /api/catalogo/historial?limit=50 devuelve los últimos eventos', async () => {
    const { call, publicBucket } = callCat();
    seed(publicBucket, seededCatalog());
    await call('/api/catalogo/edit', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Auth': AUTH }, body: JSON.stringify({ action: 'rename_song', params: { song_id: 'S0000000000000010', new_title: 'A' }, if_match: 7 }) });
    await call('/api/catalogo/edit', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Auth': AUTH }, body: JSON.stringify({ action: 'rename_song', params: { song_id: 'S0000000000000011', new_title: 'B' }, if_match: 8 }) });
    const response = await call('/api/catalogo/historial?limit=50');
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.events.length, 2);
    // más nuevo primero
    assert.equal(data.events[0].version_after, 9);
    assert.equal(data.events[1].version_after, 8);
  });

  // ── Acciones de orden y bulk (ADR-0052 ampliación 2026-11-26) ──────────────
  const seededConTresEnAlbum = () => ({
    version: 7,
    folders: [{ id: 'F0000000000000001', name: 'Álbum 1', parent_id: null }],
    songs: [
      { id: 'S0000000000000010', title: 'Primera', artist: 'A1', year: 2000, tags: [], folder_id: 'F0000000000000001', sha256: 'sha_a' },
      { id: 'S0000000000000020', title: 'Segunda', artist: 'A1', year: 2001, tags: [], folder_id: 'F0000000000000001', sha256: 'sha_b' },
      { id: 'S0000000000000030', title: 'Tercera', artist: 'A1', year: 2002, tags: [], folder_id: 'F0000000000000001', sha256: 'sha_c' },
    ],
    updated_at: '2026-11-25T10:00:00.000Z',
  });

  test('set_track_index válido mueve la canción y reasigna índices', async () => {
    const { call, publicBucket } = callCat();
    seed(publicBucket, seededConTresEnAlbum());
    const response = await call('/api/catalogo/edit', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Auth': AUTH }, body: JSON.stringify({ action: 'set_track_index', params: { song_id: 'S0000000000000030', index: 0 }, if_match: 7 }) });
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.event.kind, 'set_track_index');
    assert.equal(data.event.to, 0);
    const catalog = JSON.parse(publicBucket.text('catalog/catalog.json'));
    const byId = Object.fromEntries(catalog.songs.map((s) => [s.id, s.track_index]));
    assert.equal(byId['S0000000000000030'], 0);
    assert.equal(byId['S0000000000000010'], 1);
    assert.equal(byId['S0000000000000020'], 2);
  });

  test('set_track_index con song_id fuera de folders devuelve 400 con mensaje claro', async () => {
    const { call, publicBucket } = callCat();
    seed(publicBucket, seededCatalog());
    const response = await call('/api/catalogo/edit', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Auth': AUTH }, body: JSON.stringify({ action: 'set_track_index', params: { song_id: 'S0000000000000011', index: 0 }, if_match: 7 }) });
    assert.equal(response.status, 400);
    const data = await response.json();
    assert.match(data.error, /no pertenece a un álbum/);
  });

  test('reorder_folder con todos los ids correctos aplica orden y sube versión', async () => {
    const { call, publicBucket } = callCat();
    seed(publicBucket, seededConTresEnAlbum());
    const response = await call('/api/catalogo/edit', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Auth': AUTH }, body: JSON.stringify({
      action: 'reorder_folder',
      params: { folder_id: 'F0000000000000001', order: ['S0000000000000030', 'S0000000000000010', 'S0000000000000020'] },
      if_match: 7,
    }) });
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.version, 8);
    assert.equal(data.event.kind, 'reorder_folder');
    const catalog = JSON.parse(publicBucket.text('catalog/catalog.json'));
    const byId = Object.fromEntries(catalog.songs.map((s) => [s.id, s.track_index]));
    assert.equal(byId['S0000000000000030'], 0);
    assert.equal(byId['S0000000000000010'], 1);
    assert.equal(byId['S0000000000000020'], 2);
  });

  test('reorder_folder con un id sobrante devuelve 400', async () => {
    const { call, publicBucket } = callCat();
    seed(publicBucket, seededConTresEnAlbum());
    const response = await call('/api/catalogo/edit', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Auth': AUTH }, body: JSON.stringify({
      action: 'reorder_folder',
      params: { folder_id: 'F0000000000000001', order: ['S0000000000000030', 'S0000000000000010', 'S0000000000000020', 'S0000000000000099'] },
      if_match: 7,
    }) });
    assert.equal(response.status, 400);
    const data = await response.json();
    assert.match(data.error, /order no coincide/);
  });

  test('set_song_fields con {title, year} actualiza solo esos campos', async () => {
    const { call, publicBucket } = callCat();
    seed(publicBucket, seededCatalog());
    const response = await call('/api/catalogo/edit', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Auth': AUTH }, body: JSON.stringify({
      action: 'set_song_fields',
      params: { song_id: 'S0000000000000010', fields: { title: 'Nuevo título', year: 1999 } },
      if_match: 7,
    }) });
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.event.kind, 'set_song_fields');
    assert.deepEqual(data.event.changes, { title: 'Nuevo título', year: 1999 });
    const catalog = JSON.parse(publicBucket.text('catalog/catalog.json'));
    const song = catalog.songs.find((s) => s.id === 'S0000000000000010');
    assert.equal(song.title, 'Nuevo título');
    assert.equal(song.year, 1999);
    assert.equal(song.artist, 'A1', 'el artista no debe haber cambiado');
    assert.deepEqual(song.tags, []);
  });

  // ── unpublish_song y folder.artist (ADR-0052 ampliación 2026-11-26 bis) ────
  test('unpublish_song marca la canción como public:false y crea el evento', async () => {
    const { call, publicBucket } = callCat();
    seed(publicBucket, { ...seededCatalog(), songs: seededCatalog().songs.map((s) => ({ ...s, public: true })) });
    const response = await call('/api/catalogo/edit', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Auth': AUTH }, body: JSON.stringify({ action: 'unpublish_song', params: { song_id: 'S0000000000000010' }, if_match: 7 }) });
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.event.kind, 'unpublish_song');
    assert.equal(data.event.song_id, 'S0000000000000010');
    const catalog = JSON.parse(publicBucket.text('catalog/catalog.json'));
    const song = catalog.songs.find((s) => s.id === 'S0000000000000010');
    assert.equal(song.public, false);
    const otra = catalog.songs.find((s) => s.id === 'S0000000000000011');
    assert.equal(otra.public, true, 'solo cambia la canción pedida');
  });

  test('unpublish_song con song_id inexistente devuelve 404', async () => {
    const { call, publicBucket } = callCat();
    seed(publicBucket, seededCatalog());
    const response = await call('/api/catalogo/edit', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Auth': AUTH }, body: JSON.stringify({ action: 'unpublish_song', params: { song_id: 'S0000000000099999' }, if_match: 7 }) });
    assert.equal(response.status, 404);
    const data = await response.json();
    assert.match(data.error, /No existe la canción/);
  });

  test('rename_folder con {artist} graba el artista del álbum', async () => {
    const { call, publicBucket } = callCat();
    seed(publicBucket, seededCatalog());
    const response = await call('/api/catalogo/edit', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Auth': AUTH }, body: JSON.stringify({
      action: 'rename_folder',
      params: { folder_id: 'F0000000000000001', new_name: 'Álbum renombrado', artist: 'Los Nuevos' },
      if_match: 7,
    }) });
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.event.kind, 'rename_folder');
    assert.equal(data.event.artist, 'Los Nuevos');
    const catalog = JSON.parse(publicBucket.text('catalog/catalog.json'));
    const folder = catalog.folders.find((f) => f.id === 'F0000000000000001');
    assert.equal(folder.name, 'Álbum renombrado');
    assert.equal(folder.artist, 'Los Nuevos');
    // Un string vacío borra el artista del folder
    const response2 = await call('/api/catalogo/edit', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Auth': AUTH }, body: JSON.stringify({
      action: 'rename_folder',
      params: { folder_id: 'F0000000000000001', new_name: 'Álbum renombrado', artist: '' },
      if_match: 8,
    }) });
    assert.equal(response2.status, 200);
    const catalog2 = JSON.parse(publicBucket.text('catalog/catalog.json'));
    const folder2 = catalog2.folders.find((f) => f.id === 'F0000000000000001');
    assert.equal(folder2.artist, undefined, 'artist vacío borra el campo');
  });

  test('create_folder con {artist} graba el artista en el folder nuevo', async () => {
    const { call, publicBucket } = callCat();
    seed(publicBucket, seededCatalog());
    const response = await call('/api/catalogo/edit', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Auth': AUTH }, body: JSON.stringify({
      action: 'create_folder',
      params: { name: 'Álbum nuevo', artist: 'Los Nuevos' },
      if_match: 7,
    }) });
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.event.kind, 'create_folder');
    assert.equal(data.event.artist, 'Los Nuevos');
    const catalog = JSON.parse(publicBucket.text('catalog/catalog.json'));
    const folder = catalog.folders.find((f) => f.id === data.event.folder_id);
    assert.equal(folder.name, 'Álbum nuevo');
    assert.equal(folder.artist, 'Los Nuevos');
  });
});

describe('/api/subir con AUTH_PASSWORD no dispara repository_dispatch (ADR-0052)', () => {
  test('con AUTH_PASSWORD presente responde song_ready y no habla con GitHub; sin AUTH_PASSWORD sí dispara', async () => {
    const AUTH = 'pass_de_prueba_para_X_Auth_que_no_sale_a_logs';
    // Modo nuevo: AUTH_PASSWORD presente → no dispatch
    const nuevo = setup({ env: { AUTH_PASSWORD: AUTH } });
    const rNuevo = await nuevo.call('/api/subir', chunkInit({ index: 0, total: 1, body: OPUS }));
    assert.equal(rNuevo.status, 200);
    const dataNuevo = await rNuevo.json();
    assert.equal(dataNuevo.ok, true);
    assert.equal(dataNuevo.song_ready, true);
    assert.equal(dataNuevo.upload_id, ID);
    assert.match(dataNuevo.next_step, /api\/buzon\/publish/);
    assert.deepEqual(nuevo.github.filter((call) => call.path.endsWith('/dispatches')), []);
    // Modo legacy: sin AUTH_PASSWORD → sí dispara dispatch
    const viejo = setup();
    const rViejo = await viejo.call('/api/subir', chunkInit({ index: 0, total: 1, body: OPUS }));
    assert.equal(rViejo.status, 200);
    const dataViejo = await rViejo.json();
    assert.equal(dataViejo.completa, true);
    assert.equal(viejo.github.filter((call) => call.path.endsWith('/dispatches')).length, 1);
  });
});
