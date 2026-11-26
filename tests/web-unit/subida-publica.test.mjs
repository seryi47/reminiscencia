// Pruebas del cliente de la subida para todos (frontend/web/js/cuidador/subida-publica.js; ADR-0017), sin navegador:
// trozos de 4 MB, cabeceras del contrato de /api/subir, orden de envío, reintentos, mensajes del servidor y varios
// archivos de uno en uno. La conversión y el servidor van simulados. Ejecución:
// node --test tests/web-unit/subida-publica.test.mjs
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  CHUNK_BYTES,
  chunkHeaders,
  DONE_TEXT,
  FEATURE_PRESIGNED_UPLOAD,
  PUBLIC_AUDIO_ACCEPT,
  RIGHTS_TEXT,
  sendOpus,
  sendOpusSmart,
  splitChunks,
  UPLOAD_ENDPOINT,
  uploadFiles,
} from '../../frontend/web/js/cuidador/subida-publica.js';
import { LocalAudioError } from '../../frontend/web/js/cuidador/subida-local.js';

const ID = '0f8fad5b-d9cb-469f-a165-70867728950e';

function fakeEnv({ supported = true } = {}) {
  let n = 0;
  return {
    AudioEncoder: Object.assign(function AudioEncoder() {}, { isConfigSupported: async () => ({ supported }) }),
    AudioData: function AudioData() {},
    AudioContext: function AudioContext() {},
    OfflineAudioContext: function OfflineAudioContext() {},
    crypto: { randomUUID: () => `${ID.slice(0, -1)}${(n += 1) % 10}` },
  };
}

// Servidor simulado: guarda cada petición y responde según respond(call, número).
function fakeServer(respond = () => ({})) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const call = { url, method: init.method, headers: init.headers, bytes: new Uint8Array(init.body) };
    calls.push(call);
    const answer = respond(call, calls.length);
    if (answer instanceof Error) throw answer;
    const last = Number(call.headers['X-Parte']) === Number(call.headers['X-Partes']) - 1;
    const body = answer.body ?? { ok: true, mensaje: last ? DONE_TEXT : 'Trozo recibido.' };
    return new Response(JSON.stringify(body), { status: answer.status ?? 200 });
  };
  return { calls, fetchImpl };
}

const file = (name, size = 10) => ({ name, size });
const fakeConvert = (bytesFor = () => new Uint8Array([1, 2, 3])) => {
  const seen = [];
  const convert = async (input, options) => {
    seen.push({ name: input.name, options });
    options.onProgress({ stage: 'codificar', fraction: 1 });
    const bytes = bytesFor(input);
    if (bytes instanceof Error) throw bytes;
    return { bytes, durationS: 1, channels: 1, bitrate: 32000 };
  };
  return { seen, convert };
};

describe('trozos y cabeceras', () => {
  test('corta en trozos de hasta 4 MB, sin copiar y en orden', () => {
    assert.equal(CHUNK_BYTES, 4 * 1024 * 1024);
    const bytes = new Uint8Array(10).map((_, index) => index);
    assert.deepEqual(splitChunks(bytes, 4).map((chunk) => [...chunk]), [[0, 1, 2, 3], [4, 5, 6, 7], [8, 9]]);
    assert.equal(splitChunks(bytes, 10).length, 1);
    assert.equal(splitChunks(new Uint8Array(CHUNK_BYTES * 2 + 1)).length, 3);
    assert.equal(splitChunks(bytes, 4)[1].buffer, bytes.buffer, 'son vistas del mismo buffer');
  });

  test('las cabeceras siguen el contrato de /api/subir', () => {
    assert.equal(UPLOAD_ENDPOINT, '/api/subir');
    assert.deepEqual(chunkHeaders({ fileName: 'Mi canción.mp3', uploadId: ID, index: 2, total: 5 }), {
      'Content-Type': 'audio/ogg',
      'X-Nombre-Archivo': 'Mi%20canci%C3%B3n.mp3',
      'X-Subida-Id': ID,
      'X-Parte': '2',
      'X-Partes': '5',
    });
    assert.deepEqual(chunkHeaders({
      fileName: 'Tema.wav', uploadId: ID, index: 0, total: 1,
      album: { id: 'PLVU-jIOit29A', name: 'Nuestro desacato' },
    }), {
      'Content-Type': 'audio/ogg',
      'X-Nombre-Archivo': 'Tema.wav',
      'X-Subida-Id': ID,
      'X-Parte': '0',
      'X-Partes': '1',
      'X-Album-Id': 'PLVU-jIOit29A',
      'X-Album-Name': 'Nuestro%20desacato',
    });
  });

  test('acepta los formatos de la hoja y el texto de derechos es fijo', () => {
    for (const extension of ['.wav', '.mp3', '.m4a', '.flac', '.ogg', '.opus']) assert.ok(PUBLIC_AUDIO_ACCEPT.includes(extension), extension);
    assert.equal(RIGHTS_TEXT, 'Al subir, declaras que tienes derecho a publicar estos archivos.');
  });
});

describe('envío de un archivo', () => {
  test('envía los trozos en orden con el mismo id y el nombre original', async () => {
    const server = fakeServer();
    const bytes = new Uint8Array(10).map((_, index) => index);
    const progress = [];
    const result = await sendOpus(bytes, { fileName: 'Vals.wav', uploadId: ID, fetchImpl: server.fetchImpl, chunkBytes: 4, onChunk: (item) => progress.push(item) });
    assert.equal(result.mensaje, DONE_TEXT);
    assert.deepEqual(server.calls.map((call) => [call.url, call.method, call.headers['X-Parte'], call.headers['X-Partes'], call.headers['X-Subida-Id'], call.headers['X-Nombre-Archivo']]), [
      ['/api/subir', 'POST', '0', '3', ID, 'Vals.wav'],
      ['/api/subir', 'POST', '1', '3', ID, 'Vals.wav'],
      ['/api/subir', 'POST', '2', '3', ID, 'Vals.wav'],
    ]);
    assert.deepEqual(server.calls.map((call) => [...call.bytes]), [[0, 1, 2, 3], [4, 5, 6, 7], [8, 9]]);
    assert.deepEqual(progress, [{ index: 0, total: 3 }, { index: 1, total: 3 }, { index: 2, total: 3 }]);
  });

  test('propaga el álbum en todos los trozos del archivo', async () => {
    const server = fakeServer();
    await sendOpus(new Uint8Array([0, 1, 2, 3, 4]), {
      fileName: 'Tema.wav',
      uploadId: ID,
      chunkBytes: 2,
      album: { id: 'PLVU-jIOit29A', name: 'Nuestro desacato' },
      fetchImpl: server.fetchImpl,
    });
    assert.equal(server.calls.length, 3);
    assert.ok(server.calls.every((call) => call.headers['X-Album-Id'] === 'PLVU-jIOit29A'));
    assert.ok(server.calls.every((call) => call.headers['X-Album-Name'] === 'Nuestro%20desacato'));
  });

  test('reintenta un fallo de red o un 503 y sigue con el mismo trozo', async () => {
    const server = fakeServer((call, number) => (number === 1 ? new TypeError('red') : number === 2 ? { status: 503, body: { ok: false, error: 'ocupado' } } : {}));
    await sendOpus(new Uint8Array([1, 2]), { fileName: 'a.wav', uploadId: ID, fetchImpl: server.fetchImpl });
    assert.equal(server.calls.length, 3);
    assert.ok(server.calls.every((call) => call.headers['X-Parte'] === '0'));
  });

  test('muestra el mensaje del servidor y no reintenta un error de validación', async () => {
    const server = fakeServer(() => ({ status: 415, body: { ok: false, error: 'El archivo no es Ogg Opus.' } }));
    await assert.rejects(sendOpus(new Uint8Array([1]), { fileName: 'a.wav', uploadId: ID, fetchImpl: server.fetchImpl }), /no es Ogg Opus/);
    assert.equal(server.calls.length, 1);
  });
});

describe('varios archivos', () => {
  test('convierte sin límites ni espacio, envía de uno en uno y en orden, y un fallo no para los demás', async () => {
    const server = fakeServer();
    const { seen, convert } = fakeConvert((input) => (input.name === 'roto.mp3' ? new LocalAudioError('No se puede leer este archivo.') : new Uint8Array([7])));
    const stages = [];
    const result = await uploadFiles([file('Uno.mp3'), file('roto.mp3'), file('Tres.flac')], {
      env: fakeEnv(), fetchImpl: server.fetchImpl, convert, onProgress: (item) => stages.push(`${item.index}:${item.stage}`),
    });
    assert.deepEqual(seen.map((item) => item.name), ['Uno.mp3', 'roto.mp3', 'Tres.flac']);
    for (const item of seen) {
      assert.equal(item.options.limits, false);
      assert.equal(item.options.checkStorage, false);
    }
    assert.deepEqual(result.results, [
      { name: 'Uno.mp3', ok: true, message: DONE_TEXT },
      { name: 'roto.mp3', ok: false, message: 'No se puede leer este archivo.' },
      { name: 'Tres.flac', ok: true, message: DONE_TEXT },
    ]);
    assert.deepEqual(result.sent.map((item) => item.title), ['Uno', 'Tres']);
    assert.deepEqual(server.calls.map((call) => decodeURIComponent(call.headers['X-Nombre-Archivo'])), ['Uno.mp3', 'Tres.flac']);
    assert.notEqual(server.calls[0].headers['X-Subida-Id'], server.calls[1].headers['X-Subida-Id'], 'un id por archivo');
    assert.ok(stages.includes('0:convertir') && stages.includes('0:enviar') && stages.includes('2:enviar'));
  });

  test('si el servidor no está configurado (500), los demás archivos no se intentan', async () => {
    const server = fakeServer(() => ({ status: 500, body: { ok: false, error: 'La subida no está configurada en el servidor (falta GITHUB_TOKEN).' } }));
    const { convert } = fakeConvert();
    const result = await uploadFiles([file('a.mp3'), file('b.mp3')], { env: fakeEnv(), fetchImpl: server.fetchImpl, convert });
    assert.equal(server.calls.length, 1);
    assert.deepEqual(result.failed.map((item) => item.name), ['a.mp3', 'b.mp3']);
    assert.ok(result.failed.every((item) => /falta GITHUB_TOKEN/.test(item.message)));
  });

  test('sin conversión a Opus en el navegador no se sube nada', async () => {
    const server = fakeServer();
    await assert.rejects(uploadFiles([file('a.mp3')], { env: fakeEnv({ supported: false }), fetchImpl: server.fetchImpl, convert: fakeConvert().convert }), /no puede convertir audio a Opus/);
    assert.equal(server.calls.length, 0);
  });
});

// ---------------------------------------------------------------------------
// sendOpusSmart: ADR-0052 ampliación. Intenta primero presigned-first y cae a chunked clásico si el Worker no
// está preparado (503), la auth no coincide (401) o el PUT directo a R2 falla. El tracker usa este wrapper.
// ---------------------------------------------------------------------------
describe('sendOpusSmart (presigned-first + fallback chunked)', () => {
  const okJson = (body) => ({ ok: true, status: 200, json: async () => body, headers: { get: () => null } });
  const errJson = (status, body = {}) => ({ ok: false, status, json: async () => body, headers: { get: () => null } });
  const subtleDigest = {
    digest: async (_alg, buf) => {
      // Devuelve algo determinista: primeros 32 bytes (o padding con 0) del propio buffer, como ArrayBuffer.
      const bytes = buf instanceof ArrayBuffer ? new Uint8Array(buf) : new Uint8Array(buf.buffer || buf);
      const out = new Uint8Array(32);
      out.set(bytes.subarray(0, Math.min(32, bytes.length)));
      return out.buffer;
    },
  };
  // globalThis.crypto es solo-getter en Node >=20. Redefinir con Object.defineProperty para tener un sandbox limpio.
  function withFakeCrypto(fn) {
    const prev = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    Object.defineProperty(globalThis, 'crypto', { value: { subtle: subtleDigest }, configurable: true });
    const restore = () => {
      if (prev) Object.defineProperty(globalThis, 'crypto', prev);
      else delete globalThis.crypto;
    };
    return Promise.resolve(fn()).finally(restore);
  }

  test('el flag está activado por defecto (ADR-0052)', () => {
    assert.equal(FEATURE_PRESIGNED_UPLOAD, true);
  });

  test('happy path: presign + PUT + complete + resultado con via=presigned', async () => {
    await withFakeCrypto(async () => {
      const calls = [];
      const authFetch = async (path, init) => {
        calls.push({ path, method: init?.method, body: init?.body ? JSON.parse(init.body) : null });
        if (path === '/api/upload/presign') {
          return okJson({ ok: true, mode: 'simple', uploadUrl: 'https://r2.example/u', r2Key: 'entrada/x/a.opus' });
        }
        if (path === '/api/upload/complete') {
          return okJson({ ok: true, r2Key: 'entrada/x/a.opus' });
        }
        throw new Error(`authFetch inesperado a ${path}`);
      };
      const fetchImpl = async (url, init) => {
        calls.push({ path: url, method: init?.method });
        if (url === 'https://r2.example/u' && init?.method === 'PUT') return okJson({});
        throw new Error(`PUT inesperado a ${url}`);
      };
      const bytes = new Uint8Array(1024);
      const result = await sendOpusSmart(bytes, { fileName: 'a.opus', uploadId: 'u1', authFetch, fetchImpl });
      assert.equal(result.via, 'presigned');
      assert.equal(result.r2Key, 'entrada/x/a.opus');
      assert.equal(result.ok, true);
      assert.equal(calls.filter((c) => c.path === '/api/upload/presign').length, 1);
      assert.equal(calls.filter((c) => c.path === 'https://r2.example/u').length, 1);
      assert.equal(calls.filter((c) => c.path === '/api/upload/complete').length, 1);
    });
  });

  test('503 en presign: fallback automático al flujo chunked', async () => {
    await withFakeCrypto(async () => {
      const authCalls = [];
      const chunkCalls = [];
      const authFetch = async (path) => {
        authCalls.push(path);
        if (path === '/api/upload/presign') return errJson(503, { error: 'Subida directa no configurada.' });
        throw new Error(`authFetch inesperado a ${path}`);
      };
      const fetchImpl = async (url, init) => {
        chunkCalls.push({ url, method: init?.method });
        return okJson({ ok: true, mensaje: 'chunked ok', completa: true });
      };
      const bytes = new Uint8Array(100);
      const result = await sendOpusSmart(bytes, { fileName: 'a.opus', uploadId: 'u1', authFetch, fetchImpl });
      assert.equal(result.via, 'chunked');
      assert.equal(result.ok, true);
      assert.equal(authCalls.length, 1);
      assert.ok(chunkCalls.length >= 1, 'el fallback debe mandar al menos un trozo');
      assert.equal(chunkCalls[0].url, '/api/subir');
    });
  });

  test('PUT 403 (URL caducada): fallback automático al flujo chunked', async () => {
    await withFakeCrypto(async () => {
      const authFetch = async (path) => {
        if (path === '/api/upload/presign') {
          return okJson({ ok: true, mode: 'simple', uploadUrl: 'https://r2.example/u', r2Key: 'entrada/x/a.opus' });
        }
        if (path === '/api/upload/complete') return okJson({ ok: true });
        throw new Error(`inesperado ${path}`);
      };
      let putCalled = 0;
      const chunkCalled = [];
      const fetchImpl = async (url, init) => {
        if (url === 'https://r2.example/u') { putCalled += 1; return errJson(403); }
        chunkCalled.push(url);
        return okJson({ ok: true, mensaje: 'chunked tras put 403', completa: true });
      };
      const bytes = new Uint8Array(50);
      const result = await sendOpusSmart(bytes, { fileName: 'a.opus', uploadId: 'u1', authFetch, fetchImpl });
      assert.equal(putCalled, 1);
      assert.equal(result.via, 'chunked');
      assert.ok(chunkCalled.length >= 1);
    });
  });

  test('sin authFetch: va directo al chunked, nunca intenta presign', async () => {
    const touched = [];
    const fetchImpl = async (url) => { touched.push(url); return okJson({ ok: true, mensaje: 'ok', completa: true }); };
    const bytes = new Uint8Array(10);
    const result = await sendOpusSmart(bytes, { fileName: 'a.opus', uploadId: 'u1', fetchImpl });
    assert.equal(result.via, 'chunked');
    assert.equal(touched.every((u) => u === '/api/subir'), true);
  });
});
