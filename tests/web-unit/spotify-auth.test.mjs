// Pruebas del OAuth PKCE de Spotify (ADR-0044). Sin red: `fetch` se inyecta. El reto PKCE se valida con el vector
// oficial de la RFC 7636.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  createVerifier, challengeFor, startLogin, exchangeCode, refreshAccess, needsRefresh, SPOTIFY_SCOPES,
} from '../../frontend/web/server/spotify-auth.js';

const okJson = (data) => ({ ok: true, status: 200, json: async () => data });

describe('PKCE', () => {
  test('el reto S256 coincide con el vector de la RFC 7636', async () => {
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    assert.equal(await challengeFor(verifier), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });
  test('el verificador es base64url y aleatorio', () => {
    const a = createVerifier();
    const b = createVerifier();
    assert.match(a, /^[A-Za-z0-9\-_]+$/);
    assert.ok(a.length >= 43);
    assert.notEqual(a, b);
  });
});

describe('startLogin', () => {
  test('construye la URL de autorización con S256 y devuelve verifier y state', async () => {
    const { url, verifier, state } = await startLogin({
      clientId: 'CID', redirectUri: 'https://reminiscencia.cometia.es/api/spotify/callback',
    });
    const parsed = new URL(url);
    assert.equal(parsed.origin + parsed.pathname, 'https://accounts.spotify.com/authorize');
    assert.equal(parsed.searchParams.get('response_type'), 'code');
    assert.equal(parsed.searchParams.get('client_id'), 'CID');
    assert.equal(parsed.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(parsed.searchParams.get('scope'), SPOTIFY_SCOPES);
    assert.equal(parsed.searchParams.get('state'), state);
    assert.equal(parsed.searchParams.get('code_challenge'), await challengeFor(verifier));
  });
  test('exige clientId y redirectUri', async () => {
    await assert.rejects(() => startLogin({ clientId: 'CID' }), /faltan/);
  });
});

describe('exchangeCode / refreshAccess', () => {
  test('cambia el código por un token normalizado con caducidad', async () => {
    const now = 1_000_000;
    const fetchImpl = async () => okJson({ access_token: 'AT', refresh_token: 'RT', scope: SPOTIFY_SCOPES, expires_in: 3600 });
    const session = await exchangeCode({ clientId: 'CID', redirectUri: 'R', code: 'C', verifier: 'V' }, fetchImpl, now);
    assert.deepEqual(session, { accessToken: 'AT', refreshToken: 'RT', scope: SPOTIFY_SCOPES, expiresAt: now + 3600000 });
  });
  test('un error del token se propaga con el detalle', async () => {
    const fetchImpl = async () => ({ ok: false, status: 400, json: async () => ({ error: 'invalid_grant' }) });
    await assert.rejects(() => exchangeCode({ clientId: 'C', redirectUri: 'R', code: 'x', verifier: 'v' }, fetchImpl),
      /invalid_grant/);
  });
  test('al refrescar, si Spotify no devuelve refresh_token nuevo se conserva el anterior', async () => {
    const now = 2_000_000;
    const fetchImpl = async () => okJson({ access_token: 'AT2', scope: SPOTIFY_SCOPES, expires_in: 3600 });
    const session = await refreshAccess({ clientId: 'CID', refreshToken: 'OLD' }, fetchImpl, now);
    assert.equal(session.accessToken, 'AT2');
    assert.equal(session.refreshToken, 'OLD');
    assert.equal(session.expiresAt, now + 3600000);
  });
});

describe('needsRefresh', () => {
  test('caducado o a punto de caducar → true; con margen → false', () => {
    const now = 10_000_000;
    assert.equal(needsRefresh({ expiresAt: now - 1 }, now), true);
    assert.equal(needsRefresh({ expiresAt: now + 30000 }, now), true); // dentro del margen de 60 s
    assert.equal(needsRefresh({ expiresAt: now + 600000 }, now), false);
    assert.equal(needsRefresh(null, now), true);
  });
});
