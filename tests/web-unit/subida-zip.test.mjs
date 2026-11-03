// Pruebas de los ZIP en «Subir canciones» (frontend/web/js/cuidador/subida-zip.js y su paso por el gestor de
// subida-estado.js), sin navegador: la selección mezclada (sueltas y varios ZIP, también dañados o sin canciones), los
// textos y el agrupado de la hoja, y el gestor con la conversión y el envío simulados: cada canción del ZIP se
// descomprime solo cuando le toca, de una en una, con su nombre base; una cifrada falla sin parar a las demás.
// Datos ficticios. Ejecución: node --test tests/web-unit/subida-zip.test.mjs
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { createUploadTracker, parseItems, serializeItems, STATES, summaryText } from '../../frontend/web/js/cuidador/subida-estado.js';
import { expandSelection, groupNote, groupTitle, groupUploads, isZipFile, ZIP_ACCEPT } from '../../frontend/web/js/cuidador/subida-zip.js';
import { DAMAGED_TEXT, ENCRYPTED_TEXT } from '../../frontend/web/js/cuidador/zip.js';
import { buildZip, fakeAudio, zipFile } from './zip-fixtures.mjs';

const S = STATES;
const keys = () => { let n = 0; return () => { n += 1; return `g${n}`; }; };
const settle = async (tracker) => {
  const deadline = Date.now() + 5000;
  while (tracker.items().some((item) => ![S.SAVED, S.ERROR].includes(item.state))) {
    if (Date.now() >= deadline) throw new Error('La cola de ZIP no terminó dentro del tiempo esperado.');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

function albumZip() {
  return zipFile(buildZip([
    { path: 'Álbum/', directory: true },
    { path: 'Álbum/01 Vals de la tarde.mp3', data: fakeAudio(1), method: 8 },
    { path: 'Álbum/Cara B/02 Copla.wav', data: fakeAudio(2), method: 0 },
    { path: '__MACOSX/Álbum/._01 Vals de la tarde.mp3', data: fakeAudio(3, 50) },
    { path: 'Álbum/portada.jpg', data: fakeAudio(4, 50) },
  ]), 'Álbum.zip');
}

describe('selección con ZIP', () => {
  test('reconoce un ZIP por la extensión o por el tipo', () => {
    assert.equal(isZipFile({ name: 'Disco.ZIP', type: '' }), true);
    assert.equal(isZipFile({ name: 'descarga', type: 'application/x-zip-compressed' }), true);
    assert.equal(isZipFile({ name: 'Tema.mp3', type: 'audio/mpeg' }), false);
    assert.equal(isZipFile(null), false);
    assert.match(ZIP_ACCEPT, /\.zip/);
  });

  test('sueltas y varios ZIP mezclados, en orden; cada canción con su nombre base y su grupo', async () => {
    const suelta = new File([fakeAudio(9)], 'Suelta.wav', { type: 'audio/wav' });
    const dañado = new File([fakeAudio(10, 300)], 'Roto.zip', { type: 'application/zip' });
    const sinAudio = zipFile(buildZip([{ path: 'notas.txt', data: fakeAudio(11, 10) }, { path: '.DS_Store', data: fakeAudio(12, 10) }]), 'Fotos.zip');
    const otra = new File([fakeAudio(13)], 'Otra.mp3', { type: 'audio/mpeg' });
    const sources = await expandSelection([suelta, albumZip(), dañado, sinAudio, otra], { newGroupKey: keys() });
    assert.deepEqual(sources.map((source) => [source.name, source.title, source.group?.key ?? null, source.error]), [
      ['Suelta.wav', 'Suelta', null, null],
      ['01 Vals de la tarde.mp3', '01 Vals de la tarde', 'g1', null],
      ['02 Copla.wav', '02 Copla', 'g1', null],
      ['Roto.zip', 'Roto', 'g2', DAMAGED_TEXT],
      ['Fotos.zip', 'Fotos', 'g3', 'No hay canciones de audio en este ZIP (WAV, MP3, M4A, FLAC, OGG u OPUS).'],
      ['Otra.mp3', 'Otra', null, null],
    ]);
    assert.deepEqual(sources[1].group, { key: 'g1', name: 'Álbum.zip', songs: 2, ignored: 2 });
    assert.deepEqual(sources[4].group, { key: 'g3', name: 'Fotos.zip', songs: 0, ignored: 2 });
    assert.equal(sources[0].file, suelta);
    // Cada canción del ZIP es perezosa: se descomprime al abrirla.
    assert.equal(sources[1].file instanceof File, false);
    const opened = await sources[2].file.open();
    assert.deepEqual([opened.name, opened.type, new Uint8Array(await opened.arrayBuffer())], ['02 Copla.wav', 'audio/wav', fakeAudio(2)]);
  });

  test('textos del grupo', () => {
    assert.equal(groupTitle({ name: 'Álbum.zip', songs: 12 }), 'Álbum.zip: 12 canciones');
    assert.equal(groupTitle({ name: 'Uno.zip', songs: 1 }), 'Uno.zip: 1 canción');
    assert.equal(groupTitle({ name: 'Fotos.zip', songs: 0 }), 'Fotos.zip: ninguna canción');
    assert.equal(groupNote({ ignored: 0 }), '');
    assert.equal(groupNote({ ignored: 1 }), 'Se ignoró 1 archivo que no es una canción (carpetas del sistema, ocultos u otros tipos).');
    assert.equal(groupNote({ ignored: 3 }), 'Se ignoraron 3 archivos que no son canciones (carpetas del sistema, ocultos u otros tipos).');
  });

  test('agrupado: las sueltas seguidas juntas y cada ZIP en su bloque, en el orden en que aparecen', () => {
    const a = { key: 'a', name: 'A.zip', songs: 2, ignored: 0 };
    const b = { key: 'b', name: 'B.zip', songs: 1, ignored: 1 };
    const items = [
      { key: '1', group: null }, { key: '2', group: null },
      { key: '3', group: a }, { key: '4', group: a },
      { key: '5', group: null },
      { key: '6', group: b },
      { key: '7', group: a },
    ];
    assert.deepEqual(groupUploads(items).map((block) => [block.group?.key ?? null, block.items.map((item) => item.key)]), [
      [null, ['1', '2']],
      ['a', ['3', '4', '7']],
      [null, ['5']],
      ['b', ['6']],
    ]);
    assert.deepEqual(groupUploads(null), []);
  });
});

describe('gestor con canciones de un ZIP', () => {
  function setup() {
    const log = [];
    let localSeq = 0;
    const tracker = createUploadTracker({
      convert: async (file, { onProgress }) => {
        log.push(`convertir ${file.name} (${file.size} bytes, ${file instanceof File ? 'File' : typeof file})`);
        onProgress({ fraction: 1 });
        return { bytes: new Uint8Array([1, 2, 3]), durationS: 1, channels: 1, bitrate: 32000 };
      },
      saveCopy: async ({ title }) => { localSeq += 1; return { id: `L${String(localSeq).padStart(16, '0')}`, title }; },
      send: async (bytes, { fileName, onChunk }) => {
        log.push(`enviar ${fileName}`);
        onChunk({ index: 0, total: 1 });
        return { ok: true, nombre: fileName.replace(/\.[^.]*$/, '.opus') };
      },
      fetchSongs: async () => [],
      setTimer: () => 0,
      clearTimer: () => {},
      newKey: keys(),
    });
    return { tracker, log };
  }

  test('cada canción se descomprime cuando le toca, de una en una, y sube con su nombre base; el ZIP no se envía', async () => {
    const { tracker, log } = setup();
    const sources = await expandSelection([albumZip(), new File([fakeAudio(5)], 'Suelta.wav')], { newGroupKey: () => 'z1' });
    // Se cuenta cuándo se abre cada canción del ZIP.
    for (const source of sources) {
      if (!source.file?.open) continue;
      const open = source.file.open;
      source.file.open = async () => { log.push(`abrir ${source.name}`); return open(); };
    }
    tracker.addSources(sources);
    await settle(tracker);
    assert.deepEqual(log, [
      'abrir 01 Vals de la tarde.mp3',
      'convertir 01 Vals de la tarde.mp3 (4096 bytes, File)',
      'enviar 01 Vals de la tarde.mp3',
      'abrir 02 Copla.wav',
      'convertir 02 Copla.wav (4096 bytes, File)',
      'enviar 02 Copla.wav',
      'convertir Suelta.wav (4096 bytes, File)',
      'enviar Suelta.wav',
    ]);
    const items = tracker.items();
    assert.deepEqual(items.map((item) => [item.name, item.title, item.state, item.group?.name ?? null]), [
      ['01 Vals de la tarde.mp3', '01 Vals de la tarde', S.SAVED, 'Álbum.zip'],
      ['02 Copla.wav', '02 Copla', S.SAVED, 'Álbum.zip'],
      ['Suelta.wav', 'Suelta', S.SAVED, null],
    ]);
    assert.ok(!log.some((line) => /\.zip/.test(line)), 'el ZIP no se convierte ni se envía');
  });

  test('una canción cifrada y un ZIP dañado dan error en su fila, sin Reintentar, y las demás siguen', async () => {
    const { tracker, log } = setup();
    const cifrado = zipFile(buildZip([
      { path: 'Secreta.mp3', data: fakeAudio(6), encrypted: true },
      { path: 'Libre.mp3', data: fakeAudio(7) },
    ]), 'Mixto.zip');
    const roto = new File([fakeAudio(8, 100)], 'Roto.zip');
    tracker.addSources(await expandSelection([roto, cifrado], { newGroupKey: keys() }));
    await settle(tracker);
    const items = tracker.items();
    assert.deepEqual(items.map((item) => [item.name, item.state, item.error, item.retryable]), [
      ['Roto.zip', S.ERROR, DAMAGED_TEXT, false],
      ['Secreta.mp3', S.ERROR, ENCRYPTED_TEXT, false],
      ['Libre.mp3', S.SAVED, null, false],
    ]);
    assert.equal(tracker.retry(items[1].key), false);
    assert.deepEqual(log, ['convertir Libre.mp3 (4096 bytes, File)', 'enviar Libre.mp3']);
    assert.equal(summaryText(items), '0 de 3 publicadas · 2 con error');
  });

  test('el grupo se guarda con lo pendiente y vuelve al recargar', () => {
    const group = { key: 'z9', name: 'Álbum.zip', songs: 12, ignored: 3 };
    const raw = serializeItems([{ key: 'k1', name: '01 Vals.mp3', title: '01 Vals', state: S.PUBLISHING, localId: 'L1', savedAt: 5, knownIds: [], group }]);
    const [item] = parseItems(raw);
    assert.deepEqual(item.group, group);
    const [sinGrupo] = parseItems(serializeItems([{ key: 'k2', name: 'a.wav', title: 'a', state: S.PUBLISHING, savedAt: 5, knownIds: [], group: { key: '', name: 'x' } }]));
    assert.equal(sinGrupo.group, null, 'un grupo mal formado se descarta');
  });
});
