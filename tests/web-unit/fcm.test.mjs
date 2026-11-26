// Tests del canal push FCM (ADR-0052). Genera una clave RSA ad-hoc con WebCrypto y la
// expone como service account falso; mockea fetch a oauth2 y fcm googleapis. No se habla con red real.

import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';

// Node 20+: WebCrypto global disponible como globalThis.crypto; nos aseguramos por si acaso.
if (typeof globalThis.crypto === 'undefined') globalThis.crypto = webcrypto;

import {
  getFcmAccessToken,
  notifyCatalogChange,
  sendTestPush,
  _resetCache,
  _hasCachedToken,
  CATALOG_TOPIC,
} from '../../worker/src/fcm.js';
import { handlePushHealth, handlePushTest, isPushRoute, handlePushRoute } from '../../worker/src/push-api.js';
import { isCatalogWriteRoute } from '../../worker/src/index.js';

async function generateRsaPemPair() {
  const { publicKey, privateKey } = await globalThis.crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  );
  const pkcs8 = await globalThis.crypto.subtle.exportKey('pkcs8', privateKey);
  const b64 = Buffer.from(pkcs8).toString('base64');
  const pem = `-----BEGIN PRIVATE KEY-----\n${b64.match(/.{1,64}/g).join('\n')}\n-----END PRIVATE KEY-----\n`;
  return { pem, publicKey };
}

function fakeServiceAccount(pem) {
  return JSON.stringify({
    type: 'service_account',
    project_id: 'reminiscencia-music',
    private_key_id: 'test-key',
    private_key: pem,
    client_email: 'firebase-adminsdk@reminiscencia-music.iam.gserviceaccount.com',
    client_id: '0',
    auth_uri: 'https://accounts.google.com/o/oauth2/auth',
    token_uri: 'https://oauth2.googleapis.com/token',
    auth_provider_x509_cert_url: 'https://www.googleapis.com/oauth2/v1/certs',
    client_x509_cert_url: 'https://www.googleapis.com/robot/v1/metadata/x509/x',
  });
}

function makeMockFetch(calls) {
  return async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).includes('oauth2.googleapis.com')) {
      return new Response(JSON.stringify({ access_token: 'fake-access-token-xyz', expires_in: 3600 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (String(url).includes('fcm.googleapis.com')) {
      return new Response(JSON.stringify({ name: 'projects/reminiscencia-music/messages/0:0' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response('not mocked', { status: 500 });
  };
}

test('fcm: getFcmAccessToken firma JWT RS256 correcto y lo canjea por access_token', async () => {
  _resetCache();
  const { pem } = await generateRsaPemPair();
  const env = { FCM_SERVICE_ACCOUNT: fakeServiceAccount(pem), FCM_PROJECT_ID: 'reminiscencia-music' };
  const calls = [];
  const token = await getFcmAccessToken(env, { fetchImpl: makeMockFetch(calls) });
  assert.equal(token, 'fake-access-token-xyz');
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /oauth2\.googleapis\.com/);
  // Comprobar que el body lleva un JWT (3 segmentos base64url)
  const params = new URLSearchParams(calls[0].init.body);
  assert.equal(params.get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer');
  const jwt = params.get('assertion');
  assert.match(jwt, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
});

test('fcm: getFcmAccessToken cachea el token hasta 55 min', async () => {
  _resetCache();
  const { pem } = await generateRsaPemPair();
  const env = { FCM_SERVICE_ACCOUNT: fakeServiceAccount(pem), FCM_PROJECT_ID: 'reminiscencia-music' };
  const calls = [];
  const fetchImpl = makeMockFetch(calls);
  await getFcmAccessToken(env, { fetchImpl });
  await getFcmAccessToken(env, { fetchImpl });
  await getFcmAccessToken(env, { fetchImpl });
  assert.equal(calls.length, 1, 'solo una petición OAuth gracias al cache');
  assert.equal(_hasCachedToken(), true);
});

test('fcm: notifyCatalogChange manda al topic catalog-changes con version+kind correctos', async () => {
  _resetCache();
  const { pem } = await generateRsaPemPair();
  const env = { FCM_SERVICE_ACCOUNT: fakeServiceAccount(pem), FCM_PROJECT_ID: 'reminiscencia-music' };
  const calls = [];
  const result = await notifyCatalogChange(env, 42, { kind: 'rename_song' }, { fetchImpl: makeMockFetch(calls) });
  assert.equal(result.ok, true);
  const fcmCall = calls.find((c) => c.url.includes('fcm.googleapis.com'));
  assert.ok(fcmCall);
  assert.equal(fcmCall.init.headers.Authorization, 'Bearer fake-access-token-xyz');
  const body = JSON.parse(fcmCall.init.body);
  assert.equal(body.message.topic, CATALOG_TOPIC);
  assert.equal(body.message.data.type, 'catalog-updated');
  assert.equal(body.message.data.version, '42');
  assert.equal(body.message.data.kind, 'rename_song');
  assert.equal(body.message.android.priority, 'high');
});

test('fcm: notifyCatalogChange sin FCM_* configurado devuelve 503 sin lanzar', async () => {
  _resetCache();
  const result = await notifyCatalogChange({}, 1, { kind: 'edit' });
  assert.equal(result.ok, false);
  assert.equal(result.status, 503);
});

test('push: GET /api/push/health sin secretos → 503 con mensaje claro', async () => {
  _resetCache();
  const request = new Request('https://x/api/push/health');
  const response = await handlePushHealth(request, {});
  assert.equal(response.status, 503);
  const data = await response.json();
  assert.equal(data.ok, false);
  assert.match(data.error, /FCM no configurado/);
});

test('push: GET /api/push/health con secretos → 200 con projectId', async () => {
  _resetCache();
  const { pem } = await generateRsaPemPair();
  const env = { FCM_SERVICE_ACCOUNT: fakeServiceAccount(pem), FCM_PROJECT_ID: 'reminiscencia-music' };
  // Monkey-patch fetch temporal porque handlePushHealth usa fetch global.
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = makeMockFetch(calls);
  try {
    const request = new Request('https://x/api/push/health');
    const response = await handlePushHealth(request, env);
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.ok, true);
    assert.equal(data.projectId, 'reminiscencia-music');
    assert.equal(data.tokenCached, false);
    // La segunda vez el token está en caché.
    const response2 = await handlePushHealth(request, env);
    const data2 = await response2.json();
    assert.equal(data2.tokenCached, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('push: POST /api/push/test sin X-Auth → 401', async () => {
  _resetCache();
  const { pem } = await generateRsaPemPair();
  const env = {
    FCM_SERVICE_ACCOUNT: fakeServiceAccount(pem),
    FCM_PROJECT_ID: 'reminiscencia-music',
    AUTH_PASSWORD: 'secreto-prueba',
  };
  const response = await handlePushTest(new Request('https://x/api/push/test', { method: 'POST' }), env);
  assert.equal(response.status, 401);
});

test('push: POST /api/push/test con X-Auth → 200 y dispara el push', async () => {
  _resetCache();
  const { pem } = await generateRsaPemPair();
  const env = {
    FCM_SERVICE_ACCOUNT: fakeServiceAccount(pem),
    FCM_PROJECT_ID: 'reminiscencia-music',
    AUTH_PASSWORD: 'secreto-prueba',
  };
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = makeMockFetch(calls);
  try {
    const response = await handlePushTest(
      new Request('https://x/api/push/test', { method: 'POST', headers: { 'X-Auth': 'secreto-prueba' } }),
      env,
    );
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.ok, true);
    assert.equal(data.topic, 'catalog-changes');
    // Comprobar que llamó a fcm
    const fcmCall = calls.find((c) => c.url.includes('fcm.googleapis.com'));
    assert.ok(fcmCall, 'debería haber llamado a fcm.googleapis.com');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('push: isPushRoute reconoce /api/push/health y /api/push/test', () => {
  assert.equal(isPushRoute('/api/push/health'), true);
  assert.equal(isPushRoute('/api/push/test'), true);
  assert.equal(isPushRoute('/api/push/otro'), false);
  assert.equal(isPushRoute('/api/catalogo/latest'), false);
});

test('push: handlePushRoute enruta correctamente', async () => {
  const response = await handlePushRoute('/api/push/health', new Request('https://x/api/push/health'), {});
  assert.equal(response.status, 503); // sin secretos
});

test('index: isCatalogWriteRoute identifica solo escrituras POST del catálogo', () => {
  assert.equal(isCatalogWriteRoute('/api/catalogo/edit', 'POST'), true);
  assert.equal(isCatalogWriteRoute('/api/catalogo/rollback', 'POST'), true);
  assert.equal(isCatalogWriteRoute('/api/buzon/publish', 'POST'), true);
  assert.equal(isCatalogWriteRoute('/api/catalogo/edit', 'GET'), false);
  assert.equal(isCatalogWriteRoute('/api/catalogo/latest', 'POST'), false);
  assert.equal(isCatalogWriteRoute('/api/catalogo/historial', 'POST'), false);
});
