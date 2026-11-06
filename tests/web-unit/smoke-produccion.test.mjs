// Pruebas del comprobador de producción (scripts/smoke_produccion.mjs) contra una «producción» local: un servidor que
// hace de Vercel (la página, los datos y la redirección de /audio/:file, como vercel.json) y otro que hace de Worker
// (el código real de worker/src/index.js con el bucket público simulado; ADR-0031). Nunca habla con producción: el
// script siempre recibe la dirección local.
// Ejecución: node --test tests/web-unit/smoke-produccion.test.mjs
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { handleRequest } from '../../worker/src/index.js';
import { fakeR2 } from './r2-falso.mjs';

const run = promisify(execFile);
const SCRIPT = fileURLToPath(new URL('../../scripts/smoke_produccion.mjs', import.meta.url));
const WEB = fileURLToPath(new URL('../../frontend/web/', import.meta.url));
const PUBLIC = ['S00000000000000a1', 'S00000000000000a2', 'S00000000000000a3'];
const PRIVATE = 'S00000000000000b1';
const OPUS = new Uint8Array(64).fill(7);

async function listen(handler) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}

const stop = (server) => new Promise((resolve) => {
  server.closeAllConnections();
  server.close(resolve);
});

let worker;
let vercel;
let dir;
let catalog;
const bucket = fakeR2();
const workerRequests = [];
let inFlight = 0;
let maxInFlight = 0;

before(async () => {
  for (const id of PUBLIC) bucket.seed(`audio/${id}.opus`, OPUS);
  worker = await listen(async (request, response) => {
    workerRequests.push(request.url);
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    try {
      await new Promise((resolve) => setTimeout(resolve, 5));
      const headers = new Headers();
      for (const [name, value] of Object.entries(request.headers)) if (typeof value === 'string') headers.set(name, value);
      const reply = await handleRequest(new Request(`http://127.0.0.1${request.url}`, { method: request.method, headers }), { PUBLIC_BUCKET: bucket });
      const out = {};
      reply.headers.forEach((value, name) => { out[name] = value; });
      response.writeHead(reply.status, out);
      response.end(Buffer.from(await reply.arrayBuffer()));
    } finally {
      inFlight -= 1;
    }
  });
  const songs = PUBLIC.map((id) => ({ id, title: id, audio: `audio/${id}.opus` }));
  const files = new Map([
    ['/', { type: 'text/html; charset=utf-8', body: await readFile(join(WEB, 'index.html')) }],
    ['/js/app.js', { type: 'text/javascript; charset=utf-8', body: 'export {};' }],
    ['/manifest.webmanifest', { type: 'application/manifest+json', body: '{}' }],
    ['/data/songs.json', { type: 'application/json', body: JSON.stringify(songs) }],
    ['/data/folders.json', { type: 'application/json', body: '[]' }],
    ['/data/catalog.json', { type: 'application/json', body: JSON.stringify({ songs: songs.map((song) => ({ ...song, public: true })) }) }],
  ]);
  vercel = await listen((request, response) => {
    const { pathname } = new URL(request.url, 'http://x');
    const audio = /^\/audio\/([^/]+)$/.exec(pathname);
    if (audio) {
      // Como vercel.json: 307 al Worker.
      response.writeHead(307, { Location: `${worker.url}/audio/${audio[1]}` });
      return response.end();
    }
    const file = files.get(pathname);
    if (!file) {
      response.writeHead(404);
      return response.end();
    }
    response.writeHead(200, { 'Content-Type': file.type });
    response.end(file.body);
  });
  dir = await mkdtemp(join(tmpdir(), 'smoke-'));
  catalog = join(dir, 'catalog.json');
  await writeFile(catalog, JSON.stringify({ songs: [...PUBLIC.map((id) => ({ id, public: true })), { id: PRIVATE, public: false }] }));
});

after(async () => {
  await stop(vercel.server);
  await stop(worker.server);
  await rm(dir, { recursive: true, force: true });
});

async function smoke(...args) {
  try {
    const { stdout } = await run(process.execPath, [SCRIPT, vercel.url, `--catalogo=${catalog}`, ...args]);
    return { code: 0, stdout };
  } catch (error) {
    return { code: error.code, stdout: error.stdout ?? '' };
  }
}

describe('smoke_produccion.mjs con el audio por el Worker (ADR-0031)', () => {
  test('todo en orden: públicas con 200 y Opus por el Worker, rango 206, privada 404; respeta --concurrencia', async () => {
    workerRequests.length = 0;
    maxInFlight = 0;
    const { code, stdout } = await smoke('--concurrencia=2');
    assert.equal(code, 0, stdout);
    assert.doesNotMatch(stdout, /^FALLO/m);
    assert.match(stdout, /Resultado: \d+ OK, 0 FALLO/);
    assert.match(stdout, /audio de 2 en 2/);
    for (const id of PUBLIC) assert.match(stdout, new RegExp(`OK +\\[4\\] /audio/${id}\\.opus: HTTP 200`));
    assert.match(stdout, new RegExp(`OK +\\[5\\] /audio/${PRIVATE}\\.opus \\(no pública\\): HTTP 404`));
    assert.match(stdout, /OK +\[4\] \/audio\/S00000000000000a1\.opus con Range bytes=0-1: HTTP 206, bytes 0-1\/64/);
    assert.match(stdout, /INFO +audio servido por el Worker: 4 de 4/);
    assert.ok(workerRequests.includes(`/audio/${PRIVATE}.opus`));
    assert.ok(maxInFlight <= 2, `como mucho 2 a la vez (hubo ${maxInFlight})`);
  });

  test('una canción privada con audio en el bucket público falla y sale con código 1', async () => {
    bucket.seed(`audio/${PRIVATE}.opus`, OPUS);
    try {
      const { code, stdout } = await smoke('--concurrencia=1');
      assert.equal(code, 1);
      assert.match(stdout, new RegExp(`FALLO \\[5\\] /audio/${PRIVATE}\\.opus \\(no pública\\): HTTP 200`));
    } finally {
      bucket.objects.delete(`audio/${PRIVATE}.opus`);
    }
  });

  test('una canción pública sin audio falla', async () => {
    bucket.objects.delete(`audio/${PUBLIC[2]}.opus`);
    try {
      const { code, stdout } = await smoke();
      assert.equal(code, 1);
      assert.match(stdout, new RegExp(`FALLO \\[4\\] /audio/${PUBLIC[2]}\\.opus: HTTP 404`));
    } finally {
      bucket.seed(`audio/${PUBLIC[2]}.opus`, OPUS);
    }
  });

  test('opciones no válidas: sale con código 1 sin pedir nada', async () => {
    for (const option of ['--concurrencia=0', '--concurrencia=abc', '--otra=1']) {
      const { code, stdout } = await smoke(option);
      assert.equal(code, 1, option);
      assert.match(stdout, /^FALLO /m, option);
    }
  });
});
