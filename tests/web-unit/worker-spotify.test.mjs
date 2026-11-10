// El Worker enruta /api/spotify/* a los endpoints de «Transferir música» (ADR-0044). Sin red: fetch simulado.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { handleRequest } from '../../worker/src/index.js';

// Petición sin cabecera Origin: evita el CORS (origin === null se admite), como una navegación de nivel superior.
const req = (path, init = {}) => new Request(`https://reminiscencia.cometia.es${path}`, init);
const okJson = (data) => ({ ok: true, status: 200, json: async () => data });

describe('Worker /api/spotify/*', () => {
  test('login enruta y devuelve la URL de Spotify', async () => {
    const res = await handleRequest(req('/api/spotify/login', { method: 'POST' }), {}, { fetchImpl: async () => { throw new Error('login no debe hacer fetch'); } });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.match(body.url, /accounts\.spotify\.com\/authorize/);
  });

  test('callback sirve la página HTML', async () => {
    const res = await handleRequest(req('/api/spotify/callback'), {}, { fetchImpl: async () => okJson({}) });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);
  });

  test('token enruta al intercambio (fetch a accounts.spotify.com)', async () => {
    let hit = '';
    const fetchImpl = async (url) => { hit = String(url); return okJson({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600 }); };
    const res = await handleRequest(
      req('/api/spotify/token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'C', verifier: 'V' }) }),
      {}, { fetchImpl },
    );
    assert.equal(res.status, 200);
    assert.equal((await res.json()).accessToken, 'AT');
    assert.match(hit, /accounts\.spotify\.com\/api\/token/);
  });

  test('una ruta de spotify desconocida da 404', async () => {
    const res = await handleRequest(req('/api/spotify/nope', { method: 'POST' }), {}, { fetchImpl: async () => okJson({}) });
    assert.equal(res.status, 404);
  });
});
