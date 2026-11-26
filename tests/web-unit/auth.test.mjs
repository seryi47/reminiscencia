// Pruebas del cliente de autorización del Worker (frontend/web/js/auth.js, ADR-0052). No tocan DOM: solo la lógica
// pura (readParamAuth, buildHeaders, createAuthClient con fetch inyectado).
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  ACTOR_KEY,
  AUTH_URL_PARAM,
  DEFAULT_ACTOR,
  STORAGE_KEY,
  buildHeaders,
  createAuthClient,
  decodeAuth,
  encodeAuth,
  isValidAuth,
  readParamAuth,
} from '../../frontend/web/js/auth.js';

function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    _snapshot: () => Object.fromEntries(map.entries()),
  };
}

describe('auth', () => {
  test('isValidAuth: acepta ASCII imprimible sin espacios y ≤200', () => {
    assert.equal(isValidAuth('abc123!'), true);
    assert.equal(isValidAuth(''), false);
    assert.equal(isValidAuth('con espacio'), false);
    assert.equal(isValidAuth('a'.repeat(201)), false);
  });

  test('encodeAuth / decodeAuth hacen round-trip (base64url sin padding)', () => {
    const p = 'Abc123!_$-+';
    const e = encodeAuth(p);
    assert.ok(!/[/+=]/.test(e));
    assert.equal(decodeAuth(e), p);
  });

  test('readParamAuth extrae ?auth=... y devuelve una URL limpia sin ese parámetro', () => {
    const encoded = encodeAuth('passABC123');
    const { auth, cleanUrl } = readParamAuth({ href: `https://x.test/path?${AUTH_URL_PARAM}=${encoded}&foo=1#frag` });
    assert.equal(auth, 'passABC123');
    assert.equal(cleanUrl, 'https://x.test/path?foo=1#frag');
  });

  test('readParamAuth con una URL sin ?auth devuelve auth=\'\' y cleanUrl=null', () => {
    const { auth, cleanUrl } = readParamAuth({ href: 'https://x.test/path' });
    assert.equal(auth, '');
    assert.equal(cleanUrl, null);
  });

  test('buildHeaders añade X-Auth y X-Actor sin pisar los existentes', () => {
    const h1 = buildHeaders({ headers: { 'Content-Type': 'application/json' } }, { password: 'Secret1', actor: 'yo' });
    assert.equal(h1.get('X-Auth'), 'Secret1');
    assert.equal(h1.get('X-Actor'), 'yo');
    assert.equal(h1.get('Content-Type'), 'application/json');

    const h2 = buildHeaders({ headers: { 'X-Auth': 'YaEstaba' } }, { password: 'OtraCosa', actor: 'yo' });
    assert.equal(h2.get('X-Auth'), 'YaEstaba');
  });

  test('createAuthClient toma ?auth=... y lo guarda en storage; limpia la URL', () => {
    const storage = fakeStorage();
    let cleaned = null;
    const encoded = encodeAuth('pwdABC123');
    const client = createAuthClient({
      storage,
      locationLike: { href: `https://x.test/?${AUTH_URL_PARAM}=${encoded}` },
      replaceUrl: (url) => { cleaned = url; },
      promptPassword: async () => null,
    });
    assert.equal(client.get(), 'pwdABC123');
    assert.equal(storage.getItem(STORAGE_KEY), 'pwdABC123');
    assert.equal(cleaned, 'https://x.test/');
  });

  test('ensure() pide al diálogo si no hay contraseña y la guarda', async () => {
    const storage = fakeStorage();
    const client = createAuthClient({
      storage,
      locationLike: { href: 'https://x.test/' },
      replaceUrl: () => {},
      promptPassword: async () => 'prompted123',
    });
    assert.equal(client.get(), '');
    const value = await client.ensure();
    assert.equal(value, 'prompted123');
    assert.equal(storage.getItem(STORAGE_KEY), 'prompted123');
    // Si ya hay, no reabre el diálogo.
    let asked = 0;
    const client2 = createAuthClient({
      storage,
      locationLike: { href: 'https://x.test/' },
      promptPassword: async () => { asked += 1; return 'nuevo'; },
    });
    assert.equal(await client2.ensure(), 'prompted123');
    assert.equal(asked, 0);
  });

  test('ensure() que cancela el diálogo deja la contraseña vacía', async () => {
    const storage = fakeStorage();
    const client = createAuthClient({ storage, locationLike: { href: 'https://x.test/' }, promptPassword: async () => null });
    assert.equal(await client.ensure(), '');
  });

  test('authorizedFetch añade X-Auth; un 401 limpia y reintenta UNA vez tras preguntar', async () => {
    const storage = fakeStorage({ [STORAGE_KEY]: 'viejoABC' });
    let asked = 0;
    const client = createAuthClient({
      storage,
      locationLike: { href: 'https://x.test/' },
      promptPassword: async () => { asked += 1; return 'nuevoXYZ'; },
    });
    const calls = [];
    const fetchImpl = async (path, init) => {
      calls.push({ path, auth: init.headers.get('X-Auth') });
      if (calls.length === 1) return new Response('no', { status: 401 });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };
    const ok = await client.authorizedFetch(fetchImpl)('/api/catalogo/edit', { method: 'POST' });
    assert.equal(ok.status, 200);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].auth, 'viejoABC');
    assert.equal(calls[1].auth, 'nuevoXYZ');
    assert.equal(asked, 1);
    assert.equal(client.get(), 'nuevoXYZ');
  });

  test('actor por defecto es "web" y se puede fijar; se persiste', () => {
    const storage = fakeStorage();
    const client = createAuthClient({ storage, locationLike: { href: 'https://x.test/' } });
    assert.equal(client.actor(), DEFAULT_ACTOR);
    client.setActor('sergio');
    assert.equal(client.actor(), 'sergio');
    assert.equal(storage.getItem(ACTOR_KEY), 'sergio');
  });
});
