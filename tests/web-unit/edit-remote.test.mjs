// Pruebas del cliente de /api/editar (frontend/web/js/edit-remote.js; ADR-0022) con fetch simulado.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { dataUrlToBytes, EDIT_ENDPOINT, SAVED_TEXT, saveCover, saveOrganize } from '../../frontend/web/js/edit-remote.js';

const reply = (status, body) => async () => new Response(JSON.stringify(body), { status });

describe('edit-remote', () => {
  test('saveOrganize envía el JSON a /api/editar y devuelve el mensaje', async () => {
    let seen;
    const fetchImpl = async (url, init) => {
      seen = { url, init };
      return new Response(JSON.stringify({ ok: true, mensaje: 'Hecho' }), { status: 200 });
    };
    assert.equal(await saveOrganize({ op: 'create_folder', name: 'A' }, fetchImpl), 'Hecho');
    assert.equal(seen.url, EDIT_ENDPOINT);
    assert.equal(seen.init.method, 'POST');
    assert.deepEqual(JSON.parse(seen.init.body), { action: 'organize', payload: { op: 'create_folder', name: 'A' } });
  });

  test('sin mensaje del servidor usa el texto por defecto', async () => {
    assert.equal(await saveOrganize({ op: 'create_folder', name: 'A' }, reply(200, { ok: true })), SAVED_TEXT);
  });

  test('un rechazo lanza el motivo del servidor; sin motivo, el código', async () => {
    await assert.rejects(saveOrganize({}, reply(400, { ok: false, error: 'Mal.' })), /Mal\./);
    await assert.rejects(saveOrganize({}, async () => new Response('x', { status: 502 })), /código 502/);
  });

  test('un fallo de red da un mensaje en español', async () => {
    await assert.rejects(saveOrganize({}, async () => { throw new TypeError('fetch failed'); }), /No se ha podido conectar/);
  });

  test('saveCover envía el JPEG con el id en la cabecera', async () => {
    let seen;
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    await saveCover('S0000000000000004', bytes, async (url, init) => {
      seen = init;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    assert.equal(seen.headers['Content-Type'], 'image/jpeg');
    assert.equal(seen.headers['X-Portada-Id'], 'S0000000000000004');
    assert.equal(seen.body, bytes);
  });

  test('dataUrlToBytes decodifica un JPEG en data: y rechaza lo demás', () => {
    assert.deepEqual(Array.from(dataUrlToBytes('data:image/jpeg;base64,/9j/2Q==')), [0xff, 0xd8, 0xff, 0xd9]);
    assert.throws(() => dataUrlToBytes('data:image/png;base64,AAAA'));
    assert.throws(() => dataUrlToBytes(null));
  });
});
