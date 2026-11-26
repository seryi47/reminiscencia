// Pruebas del flujo de edición contra el Worker (ADR-0052): sendCatalogEdit con if_match, reintento en 412 y
// espera Retry-After en 423. Trabaja con fetchImpl inyectado — no toca red ni DOM.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  payloadToActions,
  sendCatalogEdit,
} from '../../frontend/web/js/catalog-remote.js';

function sequencedFetch(sequence) {
  let i = 0;
  const log = [];
  return {
    log,
    fetchImpl: async (path, init) => {
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
      log.push({ path, body, headers: init?.headers ?? null });
      const spec = sequence[i++];
      if (!spec) throw new Error(`Llamada ${i} no esperada a ${path}`);
      if (spec.headers) {
        return new Response(JSON.stringify(spec.body ?? {}), { status: spec.status, headers: spec.headers });
      }
      return new Response(JSON.stringify(spec.body ?? {}), { status: spec.status });
    },
  };
}

describe('payloadToActions', () => {
  test('edit_song con title+artist+year se agrupa en un único set_song_fields atómico', () => {
    const list = payloadToActions({
      op: 'edit_song', song_id: 'S0000000000000001', title: 'Nuevo', artist: 'Yo', year: 1999,
    });
    assert.deepEqual(list, [
      { action: 'set_song_fields', params: { song_id: 'S0000000000000001', fields: { title: 'Nuevo', artist: 'Yo', year: 1999 } } },
    ]);
  });

  test('edit_song con sólo folder_id emite un move_song sin set_song_fields', () => {
    const list = payloadToActions({ op: 'edit_song', song_id: 'S1', folder_id: 'F1' });
    assert.deepEqual(list, [{ action: 'move_song', params: { song_id: 'S1', folder_id: 'F1' } }]);
  });

  test('edit_song con title+folder_id emite set_song_fields + move_song', () => {
    const list = payloadToActions({ op: 'edit_song', song_id: 'S1', title: 'X', folder_id: null });
    assert.deepEqual(list, [
      { action: 'set_song_fields', params: { song_id: 'S1', fields: { title: 'X' } } },
      { action: 'move_song', params: { song_id: 'S1', folder_id: null } },
    ]);
  });

  test('unpublish_song usa la acción nativa del Worker (NO delete_song, que borraría la canción)', () => {
    assert.deepEqual(
      payloadToActions({ op: 'unpublish_song', song_id: 'S0000000000000002' }),
      [{ action: 'unpublish_song', params: { song_id: 'S0000000000000002' } }],
    );
  });

  test('order_album se cablea a reorder_folder y nunca cae a legacy', () => {
    assert.deepEqual(
      payloadToActions({ op: 'order_album', folder_id: 'F1', song_ids: ['A', 'B', 'C'] }),
      [{ action: 'reorder_folder', params: { folder_id: 'F1', order: ['A', 'B', 'C'] } }],
    );
  });

  test('rename_song emite el campo new_title (contrato del Worker), no title', () => {
    const list = payloadToActions({ op: 'edit_song', song_id: 'S1', title: 'X' });
    assert.equal(list.length, 1);
    assert.equal(list[0].action, 'set_song_fields');
    assert.equal(list[0].params.fields.title, 'X');
  });

  test('rename_folder emite el campo new_name (contrato del Worker), no name', () => {
    assert.deepEqual(
      payloadToActions({ op: 'rename_folder', folder_id: 'F1', name: 'Rock' }),
      [{ action: 'rename_folder', params: { folder_id: 'F1', new_name: 'Rock' } }],
    );
  });

  test('edit_folder con name+artist emite un único rename_folder atómico', () => {
    assert.deepEqual(
      payloadToActions({ op: 'edit_folder', folder_id: 'F1', name: 'Rock', artist: 'VV.AA.' }),
      [{ action: 'rename_folder', params: { folder_id: 'F1', new_name: 'Rock', artist: 'VV.AA.' } }],
    );
  });

  test('create_folder con artist y parent_id manda los tres campos', () => {
    assert.deepEqual(
      payloadToActions({ op: 'create_folder', name: 'Metal', artist: 'VV.AA.', parent_id: 'F0' }),
      [{ action: 'create_folder', params: { name: 'Metal', artist: 'VV.AA.', parent_id: 'F0' } }],
    );
  });

  test('move_songs → una move_song por canción', () => {
    const list = payloadToActions({ op: 'move_songs', song_ids: ['A', 'B'], folder_id: 'F' });
    assert.deepEqual(list, [
      { action: 'move_song', params: { song_id: 'A', folder_id: 'F' } },
      { action: 'move_song', params: { song_id: 'B', folder_id: 'F' } },
    ]);
  });
});

describe('sendCatalogEdit (contra el Worker)', () => {
  const headers = { 'X-Auth': 'secret' };
  const authorizedFetchWith = (fetchImpl) => (path, init) => fetchImpl(path, { ...init, headers: { ...(init?.headers ?? {}), ...headers } });

  test('happy path: 200 ok devuelve version+event', async () => {
    const { fetchImpl, log } = sequencedFetch([
      { status: 200, body: { ok: true, version: 5, event: { id: 'evt1' } } },
    ]);
    const result = await sendCatalogEdit(
      { action: 'rename_song', params: { song_id: 'S1', new_title: 'Y' }, ifMatch: 4 },
      { authorizedFetch: authorizedFetchWith(fetchImpl), reloadLatest: async () => ({ version: 999 }) },
    );
    assert.equal(result.version, 5);
    assert.equal(result.event.id, 'evt1');
    assert.equal(log.length, 1);
    assert.equal(log[0].body.if_match, 4);
    assert.equal(log[0].body.action, 'rename_song');
  });

  test('412 → refetch + 1 reintento OK', async () => {
    const { fetchImpl, log } = sequencedFetch([
      { status: 412, body: { ok: false, error: 'if_match', current_version: 7 } },
      { status: 200, body: { ok: true, version: 8 } },
    ]);
    const result = await sendCatalogEdit(
      { action: 'rename_song', params: { song_id: 'S1', new_title: 'Y' }, ifMatch: 6 },
      { authorizedFetch: authorizedFetchWith(fetchImpl), reloadLatest: async () => ({ version: 7 }) },
    );
    assert.equal(result.version, 8);
    assert.equal(log.length, 2);
    assert.equal(log[0].body.if_match, 6);
    assert.equal(log[1].body.if_match, 7);
  });

  test('412 persistente: tras el único reintento, lanza ConflictError', async () => {
    const { fetchImpl } = sequencedFetch([
      { status: 412, body: { ok: false, error: 'ko', current_version: 2 } },
      { status: 412, body: { ok: false, error: 'ko', current_version: 3 } },
    ]);
    await assert.rejects(
      sendCatalogEdit(
        { action: 'rename_song', params: { song_id: 'S1', new_title: 'Y' }, ifMatch: 1 },
        {
          authorizedFetch: authorizedFetchWith(fetchImpl),
          reloadLatest: async () => ({ version: 2 }),
        },
      ),
      /otra persona justo ahora/,
    );
  });

  test('423 Locked → espera Retry-After y reintenta', async () => {
    const sleepCalls = [];
    const sleep = async (ms) => { sleepCalls.push(ms); };
    const { fetchImpl, log } = sequencedFetch([
      { status: 423, body: { ok: false, error: 'lock' }, headers: { 'Retry-After': '1' } },
      { status: 200, body: { ok: true, version: 9 } },
    ]);
    const result = await sendCatalogEdit(
      { action: 'rename_song', params: { song_id: 'S1', new_title: 'Y' }, ifMatch: 8 },
      { authorizedFetch: authorizedFetchWith(fetchImpl), reloadLatest: async () => ({ version: 8 }), sleep },
    );
    assert.equal(result.version, 9);
    assert.equal(log.length, 2);
    assert.equal(sleepCalls.length, 1);
    assert.equal(sleepCalls[0], 1000);
  });

  test('401 lanza AuthError', async () => {
    const { fetchImpl } = sequencedFetch([{ status: 401, body: { ok: false, error: 'auth' } }]);
    await assert.rejects(
      sendCatalogEdit(
        { action: 'rename_song', params: { song_id: 'S1', new_title: 'Y' }, ifMatch: 1 },
        { authorizedFetch: authorizedFetchWith(fetchImpl), reloadLatest: async () => ({ version: 1 }) },
      ),
      (err) => err.name === 'AuthError' && err.status === 401,
    );
  });
});
