// Pruebas de las listas propias y «Me gusta» guardadas en este navegador (frontend/web/js/local-library.js), sobre
// un IndexedDB en memoria mínimo y sin él (modo en memoria). Datos ficticios.
// Ejecución: node --test tests/web-unit/local-library.test.mjs
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  addSongIds,
  defaultPlaylistName,
  LIBRARY_DB_NAME,
  LIBRARY_DB_VERSION,
  newPlaylistId,
  openLocalLibrary,
  PLAYLIST_NAME_MAX,
  removeSongId,
  validatePlaylistName,
} from '../../frontend/web/js/local-library.js';

// IndexedDB en memoria: open con onupgradeneeded, almacenes con keyPath, getAll, put y delete.
function fakeIndexedDb() {
  const databases = new Map();
  const opened = [];
  return {
    opened,
    databases,
    open(name, version) {
      opened.push({ name, version });
      const request = { result: null, onupgradeneeded: null, onsuccess: null, onerror: null, onblocked: null };
      setTimeout(() => {
        let data = databases.get(name);
        const isNew = !data;
        if (isNew) {
          data = { stores: new Map() };
          databases.set(name, data);
        }
        const db = {
          objectStoreNames: { contains: (store) => data.stores.has(store) },
          createObjectStore(store, { keyPath }) {
            data.stores.set(store, { keyPath, records: new Map() });
          },
          transaction(store) {
            const target = data.stores.get(store);
            const tx = { oncomplete: null, onerror: null, onabort: null };
            const finish = () => setTimeout(() => tx.oncomplete?.(), 0);
            tx.objectStore = () => ({
              getAll() {
                const req = { onsuccess: null, result: undefined };
                setTimeout(() => {
                  req.result = [...target.records.values()].map((record) => structuredClone(record));
                  req.onsuccess?.();
                }, 0);
                return req;
              },
              put(record) {
                target.records.set(record[target.keyPath], structuredClone(record));
                finish();
              },
              delete(key) {
                target.records.delete(key);
                finish();
              },
            });
            return tx;
          },
          close() {},
        };
        request.result = db;
        if (isNew) request.onupgradeneeded?.();
        request.onsuccess?.();
      }, 0);
      return request;
    },
  };
}

function counter() {
  let value = 0;
  return () => {
    value += 1;
    return Uint8Array.from({ length: 8 }, (_, index) => (index === 7 ? value : 0));
  };
}

async function open(indexedDB = fakeIndexedDb()) {
  let now = 1_000;
  const library = await openLocalLibrary({ indexedDB, now: () => (now += 10), random: counter() });
  return { library, indexedDB };
}

describe('funciones puras', () => {
  test('el nombre de una lista: obligatorio, sin control y hasta 100 caracteres', () => {
    assert.equal(validatePlaylistName('Para el domingo'), null);
    assert.match(validatePlaylistName('   '), /Escribe un nombre/);
    assert.match(validatePlaylistName('a\nb'), /control/);
    assert.match(validatePlaylistName('x'.repeat(PLAYLIST_NAME_MAX + 1)), /más de 100/);
    assert.match(validatePlaylistName(5), /texto/);
  });

  test('el nombre por defecto es «Mi lista n.º N» con el primer número libre', () => {
    assert.equal(defaultPlaylistName([]), 'Mi lista n.º 1');
    assert.equal(defaultPlaylistName(['Otra']), 'Mi lista n.º 2');
    assert.equal(defaultPlaylistName(['Mi lista n.º 2']), 'Mi lista n.º 3');
  });

  test('añadir no repite canciones y quitar las elimina', () => {
    assert.deepEqual(addSongIds(['a'], ['b', 'a', 'c', 'b']), { songIds: ['a', 'b', 'c'], added: 2 });
    assert.deepEqual(removeSongId(['a', 'b', 'c'], 'b'), ['a', 'c']);
  });

  test('el identificador de lista es P más 16 hexadecimales', () => {
    assert.equal(newPlaylistId(Uint8Array.from([0, 1, 2, 3, 0xaa, 0xbb, 0xcc, 0xff])), 'P00010203aabbccff');
    assert.throws(() => newPlaylistId(new Uint8Array(4)), RangeError);
  });
});

describe('biblioteca local en IndexedDB', () => {
  test('abre la base «reminiscencia-biblioteca» versión 1, aparte de la del audio local', async () => {
    const { library, indexedDB } = await open();
    assert.equal(library.persistent, true);
    assert.deepEqual(indexedDB.opened, [{ name: LIBRARY_DB_NAME, version: LIBRARY_DB_VERSION }]);
    assert.equal(LIBRARY_DB_NAME, 'reminiscencia-biblioteca');
    assert.deepEqual([...indexedDB.databases.get(LIBRARY_DB_NAME).stores.keys()].sort(), ['likes', 'playlists']);
  });

  test('crea, renombra, llena y borra listas, y las devuelve por orden de creación', async () => {
    const { library } = await open();
    const first = await library.createPlaylist();
    const second = await library.createPlaylist('Para bailar', ['S1']);
    assert.equal(first.name, 'Mi lista n.º 1');
    assert.deepEqual((await library.listPlaylists()).map((list) => list.name), ['Mi lista n.º 1', 'Para bailar']);
    assert.equal(await library.addToPlaylist(first.id, ['S2', 'S3']), 2);
    assert.equal(await library.addToPlaylist(first.id, ['S2']), 0);
    await library.removeFromPlaylist(first.id, 'S2');
    assert.deepEqual((await library.getPlaylist(first.id)).songIds, ['S3']);
    await library.renamePlaylist(second.id, '  Para el domingo ');
    assert.equal((await library.getPlaylist(second.id)).name, 'Para el domingo');
    await library.deletePlaylist(first.id);
    assert.deepEqual((await library.listPlaylists()).map((list) => list.id), [second.id]);
  });

  test('un nombre no válido no se guarda', async () => {
    const { library } = await open();
    await assert.rejects(library.createPlaylist('   '), /Escribe un nombre/);
    const list = await library.createPlaylist();
    await assert.rejects(library.renamePlaylist(list.id, ''), /Escribe un nombre/);
    await assert.rejects(library.addToPlaylist('P-no-existe', ['S1']), /ya no existe/);
  });

  test('«Me gusta» guarda la fecha y se puede quitar', async () => {
    const { library } = await open();
    await library.setLiked('S1', true);
    await library.setLiked('S2', true);
    const likes = await library.listLikes();
    assert.deepEqual([...likes.keys()].sort(), ['S1', 'S2']);
    assert.ok(likes.get('S2') > likes.get('S1'));
    await library.setLiked('S1', false);
    assert.deepEqual([...(await library.listLikes()).keys()], ['S2']);
  });

  test('forgetSong quita una canción de «Me gusta» y de todas las listas', async () => {
    const { library } = await open();
    const list = await library.createPlaylist('Lista', ['L1', 'S1']);
    await library.setLiked('L1', true);
    await library.forgetSong('L1');
    assert.deepEqual((await library.getPlaylist(list.id)).songIds, ['S1']);
    assert.equal((await library.listLikes()).has('L1'), false);
  });

  test('los datos siguen al volver a abrir la base', async () => {
    const indexedDB = fakeIndexedDb();
    const { library } = await open(indexedDB);
    await library.createPlaylist('Guardada');
    await library.setLiked('S9', true);
    const again = await openLocalLibrary({ indexedDB });
    assert.deepEqual((await again.listPlaylists()).map((list) => list.name), ['Guardada']);
    assert.equal((await again.listLikes()).has('S9'), true);
  });
});

describe('sin IndexedDB', () => {
  test('funciona en memoria y avisa de que no es persistente', async () => {
    const warn = console.warn;
    console.warn = () => {};
    try {
      const library = await openLocalLibrary({ indexedDB: null, random: counter() });
      assert.equal(library.persistent, false);
      const list = await library.createPlaylist();
      await library.addToPlaylist(list.id, ['S1']);
      await library.setLiked('S1', true);
      assert.deepEqual((await library.getPlaylist(list.id)).songIds, ['S1']);
      assert.equal((await library.listLikes()).has('S1'), true);
    } finally {
      console.warn = warn;
    }
  });
});
