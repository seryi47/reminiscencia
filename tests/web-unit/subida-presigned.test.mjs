// Tests para el helper de subida presigned (ADR-0052 ampliación). Cubre el happy path simple, el fallback
// cuando el Worker responde 503, y la detección de errores en cada fase.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, test } from 'node:test';

import { PresignedUploadError, sendOpusPresigned, sha256Hex } from '../../frontend/web/js/cuidador/subida-presigned.js';

const AUDIO_BYTES = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
const AUDIO_SHA = createHash('sha256').update(AUDIO_BYTES).digest('hex');

function makeAuthFetch(handler) {
  return async (path, init) => handler(path, init);
}

describe('subida presigned (ADR-0052)', () => {
  test('sha256Hex coincide con crypto estándar', async () => {
    const got = await sha256Hex(AUDIO_BYTES);
    assert.equal(got, AUDIO_SHA);
  });

  test('happy path simple: presign → PUT → complete', async () => {
    const calls = [];
    const authFetch = makeAuthFetch(async (path, init) => {
      calls.push({ path, body: JSON.parse(init.body) });
      if (path === '/api/upload/presign') {
        return new Response(JSON.stringify({
          ok: true, mode: 'simple', uploadId: 'uuid-123',
          r2Key: 'entrada/uuid-123/cancion.opus',
          uploadUrl: 'https://abc.r2.cloudflarestorage.com/presigned?X-Amz-Signature=xx',
          expiresAt: Math.floor(Date.now() / 1000) + 900,
        }), { status: 200 });
      }
      if (path === '/api/upload/complete') {
        return new Response(JSON.stringify({ ok: true, r2Key: 'entrada/uuid-123/cancion.opus' }), { status: 200 });
      }
      return new Response('no', { status: 404 });
    });
    const putCalls = [];
    const fetchImpl = async (url, init) => {
      putCalls.push({ url, method: init.method, bodyLength: init.body.length });
      return new Response(null, { status: 200 });
    };
    const result = await sendOpusPresigned(AUDIO_BYTES, { fileName: 'cancion.opus', authFetch, fetchImpl });
    assert.equal(result.r2Key, 'entrada/uuid-123/cancion.opus');
    assert.equal(result.sha256, AUDIO_SHA);
    assert.equal(result.sizeBytes, AUDIO_BYTES.length);
    assert.equal(putCalls.length, 1);
    assert.equal(putCalls[0].method, 'PUT');
    assert.equal(calls.length, 2);
  });

  test('presign 503 lanza PresignedUploadError con phase presign-503', async () => {
    const authFetch = makeAuthFetch(async () => new Response(JSON.stringify({ ok: false, error: 'Subida directa no configurada.' }), { status: 503 }));
    await assert.rejects(
      sendOpusPresigned(AUDIO_BYTES, { fileName: 'x.opus', authFetch }),
      (err) => err instanceof PresignedUploadError && err.phase === 'presign-503',
    );
  });

  test('presign 401 lanza phase presign-auth', async () => {
    const authFetch = makeAuthFetch(async () => new Response(JSON.stringify({ ok: false }), { status: 401 }));
    await assert.rejects(
      sendOpusPresigned(AUDIO_BYTES, { fileName: 'x.opus', authFetch }),
      (err) => err instanceof PresignedUploadError && err.phase === 'presign-auth',
    );
  });

  test('error en PUT se propaga como put-simple', async () => {
    const authFetch = makeAuthFetch(async (path) => {
      if (path === '/api/upload/presign') {
        return new Response(JSON.stringify({
          ok: true, mode: 'simple', uploadId: 'u', r2Key: 'entrada/u/x.opus',
          uploadUrl: 'https://abc/x', expiresAt: 0,
        }), { status: 200 });
      }
      return new Response('{}', { status: 200 });
    });
    const fetchImpl = async () => new Response('', { status: 500 });
    await assert.rejects(
      sendOpusPresigned(AUDIO_BYTES, { fileName: 'x.opus', authFetch, fetchImpl }),
      (err) => err instanceof PresignedUploadError && err.phase === 'put-simple',
    );
  });

  test('sin authFetch lanza config', async () => {
    await assert.rejects(
      sendOpusPresigned(AUDIO_BYTES, { fileName: 'x.opus' }),
      (err) => err instanceof PresignedUploadError && err.phase === 'config',
    );
  });
});
