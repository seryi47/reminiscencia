// Pruebas del lector de ZIP de «Subir canciones» (frontend/web/js/cuidador/zip.js), sin navegador y con ZIP generados
// en la prueba (zip-fixtures.mjs): entradas «stored» y «deflate», subcarpetas, __MACOSX/, ocultos, lo que no es audio,
// ZIP64, nombres antiguos (página de códigos 437), cifrado y dañado. Datos ficticios.
// Ejecución: node --test tests/web-unit/zip.test.mjs
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  audioEntries,
  crc32,
  DAMAGED_TEXT,
  decodeName,
  ENCRYPTED_TEXT,
  ENTRY_DAMAGED_TEXT,
  ignoreReason,
  readZipDirectory,
  readZipEntry,
  SPLIT_TEXT,
  ZipError,
  zipBaseName,
} from '../../frontend/web/js/cuidador/zip.js';
import { buildZip, fakeAudio, zipFile } from './zip-fixtures.mjs';

const bytesOf = async (file) => new Uint8Array(await file.arrayBuffer());
const rejectsWith = (promise, message) => assert.rejects(promise, (error) => error instanceof ZipError && error.message === message && error.permanent === true);

describe('directorio central y entradas', () => {
  test('lee una entrada «stored» y otra «deflate» tal cual, con su nombre base y su tipo', async () => {
    const uno = fakeAudio(1, 10_000);
    const dos = fakeAudio(2, 70_000);
    const zip = zipFile(buildZip([
      { path: 'Uno.wav', data: uno, method: 0 },
      { path: 'Dos.mp3', data: dos, method: 8 },
    ]));
    const entries = await readZipDirectory(zip);
    assert.deepEqual(entries.map((entry) => [entry.path, entry.method, entry.size, entry.encrypted, entry.isDirectory]), [
      ['Uno.wav', 0, 10_000, false, false],
      ['Dos.mp3', 8, 70_000, false, false],
    ]);
    assert.ok(entries[1].compressedSize < entries[1].size, 'la de deflate va comprimida');
    const [first, second] = await Promise.all(entries.map((entry) => readZipEntry(zip, entry)));
    assert.ok(first instanceof File);
    assert.deepEqual([first.name, first.type, first.size], ['Uno.wav', 'audio/wav', 10_000]);
    assert.deepEqual([second.name, second.type, second.size], ['Dos.mp3', 'audio/mpeg', 70_000]);
    assert.deepEqual(await bytesOf(first), uno);
    assert.deepEqual(await bytesOf(second), dos);
  });

  test('las canciones de subcarpetas salen con su nombre base; la ruta no se usa para nada más', async () => {
    const zip = zipFile(buildZip([
      { path: 'Disco 1/', directory: true },
      { path: 'Disco 1/01 Vals.flac', data: fakeAudio(3) },
      { path: 'Disco 2\\Cara B\\02 Copla.ogg', data: fakeAudio(4) },
    ]));
    const entries = await readZipDirectory(zip);
    const { songs, ignored } = audioEntries(entries);
    assert.deepEqual(songs.map((song) => [song.path, song.name]), [
      ['Disco 1/01 Vals.flac', '01 Vals.flac'],
      ['Disco 2\\Cara B\\02 Copla.ogg', '02 Copla.ogg'],
    ]);
    assert.equal(ignored, 0, 'las carpetas no cuentan como ignoradas');
    const file = await readZipEntry(zip, songs[1]);
    assert.deepEqual([file.name, file.type], ['02 Copla.ogg', 'audio/ogg']);
    assert.deepEqual(await bytesOf(file), fakeAudio(4));
  });

  test('ignora carpetas, __MACOSX/, ocultos y lo que no es audio, y cuenta cuántos archivos se ignoraron', async () => {
    const zip = zipFile(buildZip([
      { path: 'Álbum/', directory: true },
      { path: 'Álbum/01 Bolero.MP3', data: fakeAudio(5) },
      { path: 'Álbum/02 Pasodoble.m4a', data: fakeAudio(6) },
      { path: 'Álbum/03 Jota.opus', data: fakeAudio(7) },
      { path: '__MACOSX/', directory: true },
      { path: '__MACOSX/Álbum/._01 Bolero.MP3', data: fakeAudio(8, 100) },
      { path: 'Álbum/.DS_Store', data: fakeAudio(9, 100) },
      { path: '.oculta/04 Tango.wav', data: fakeAudio(10, 100) },
      { path: 'Álbum/portada.jpg', data: fakeAudio(11, 100) },
      { path: 'Álbum/letras.txt', data: fakeAudio(12, 100) },
      { path: 'Álbum/sin-extension', data: fakeAudio(13, 100) },
      { path: '../../fuera/05 Fuera.mp3', data: fakeAudio(14, 100) },
    ]));
    const { songs, ignored } = audioEntries(await readZipDirectory(zip));
    assert.deepEqual(songs.map((song) => song.name), ['01 Bolero.MP3', '02 Pasodoble.m4a', '03 Jota.opus']);
    assert.equal(ignored, 7);
  });

  test('motivos de descarte y nombre base', () => {
    assert.equal(ignoreReason({ path: 'a/', isDirectory: true }), 'carpeta');
    assert.equal(ignoreReason({ path: '__MACOSX/._a.mp3', isDirectory: false }), 'sistema');
    assert.equal(ignoreReason({ path: 'x/.a.mp3', isDirectory: false }), 'sistema');
    assert.equal(ignoreReason({ path: '../a.mp3', isDirectory: false }), 'sistema');
    assert.equal(ignoreReason({ path: 'a.aiff', isDirectory: false }), 'no-audio');
    assert.equal(ignoreReason({ path: './Disco/a.WAV', isDirectory: false }), null);
    assert.equal(zipBaseName('/raíz/Disco\\Cara A/  Tema\u0000 1.mp3 '), 'Tema 1.mp3');
    assert.equal(zipBaseName(''), '');
  });

  test('ZIP64: tamaños y posiciones en los registros de 64 bits', async () => {
    const audio = fakeAudio(15, 50_000);
    const zip = zipFile(buildZip([
      { path: 'Grande/Tema largo.wav', data: audio, method: 8 },
      { path: 'Otro.mp3', data: fakeAudio(16), method: 0 },
    ], { zip64: true }));
    const entries = await readZipDirectory(zip);
    assert.deepEqual(entries.map((entry) => [entry.path, entry.size]), [['Grande/Tema largo.wav', 50_000], ['Otro.mp3', 4096]]);
    assert.ok(entries[1].localOffset > 0);
    assert.deepEqual(await bytesOf(await readZipEntry(zip, entries[0])), audio);
    assert.deepEqual(await bytesOf(await readZipEntry(zip, entries[1])), fakeAudio(16));
  });

  test('encuentra el final aunque el ZIP lleve comentario', async () => {
    const zip = zipFile(buildZip([{ path: 'a.mp3', data: fakeAudio(17) }], { comment: 'Comentario PK\u0005\u0006 de prueba' }));
    const entries = await readZipDirectory(zip);
    assert.equal(entries[0].path, 'a.mp3');
  });

  test('nombres antiguos sin la marca de UTF-8: página de códigos 437', async () => {
    const nameBytes = [...Buffer.from('Canci', 'latin1'), 0xa2, ...Buffer.from('n.mp3', 'latin1')];
    const zip = zipFile(buildZip([{ path: '', nameBytes, data: fakeAudio(18) }]));
    const [entry] = await readZipDirectory(zip);
    assert.equal(entry.path, 'Canción.mp3');
    // Sin la marca, pero UTF-8 válido: se lee como UTF-8.
    assert.equal(decodeName(Buffer.from('Canción.mp3', 'utf8')), 'Canción.mp3');
    // La tabla cubre los 128 bytes altos, uno a uno.
    const all = decodeName(Uint8Array.from({ length: 128 }, (_, i) => 0x80 + i));
    assert.equal([...all].length, 128);
    assert.doesNotMatch(all, /undefined/);
    assert.equal(all.at(-1), ' ');
  });

  test('CRC-32 de referencia', () => {
    assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  });
});

describe('ZIP cifrado o dañado', () => {
  test('una entrada cifrada da su error al abrirla; las demás se leen', async () => {
    const zip = zipFile(buildZip([
      { path: 'Secreta.mp3', data: fakeAudio(19), encrypted: true },
      { path: 'Libre.mp3', data: fakeAudio(20) },
    ]));
    const entries = await readZipDirectory(zip);
    assert.equal(entries[0].encrypted, true);
    await rejectsWith(readZipEntry(zip, entries[0]), ENCRYPTED_TEXT);
    assert.deepEqual(await bytesOf(await readZipEntry(zip, entries[1])), fakeAudio(20));
  });

  test('lo que no es un ZIP, un ZIP cortado o «en varias partes» da error claro', async () => {
    await rejectsWith(readZipDirectory(new File([fakeAudio(21, 1000)], 'falso.zip')), DAMAGED_TEXT);
    await rejectsWith(readZipDirectory(new File([new Uint8Array(5)], 'corto.zip')), DAMAGED_TEXT);
    const whole = buildZip([{ path: 'a.mp3', data: fakeAudio(22) }]);
    await rejectsWith(readZipDirectory(zipFile(whole.subarray(0, whole.length - 30))), DAMAGED_TEXT);
    await rejectsWith(readZipDirectory(zipFile(buildZip([{ path: 'a.mp3', data: fakeAudio(23) }], { disk: 1 }))), SPLIT_TEXT);
  });

  test('datos comprimidos rotos, CRC mal o cabecera local perdida: error en esa entrada', async () => {
    const zip = zipFile(buildZip([
      { path: 'Rota.mp3', data: fakeAudio(24), method: 8, raw: Uint8Array.from([0xff, 0xff, 0xff, 0xff, 0x00, 0x13]) },
      { path: 'CRC mal.mp3', data: fakeAudio(25), method: 0, crc: 0x12345678 },
      { path: 'Buena.mp3', data: fakeAudio(26) },
    ]));
    const entries = await readZipDirectory(zip);
    await rejectsWith(readZipEntry(zip, entries[0]), ENTRY_DAMAGED_TEXT);
    await rejectsWith(readZipEntry(zip, entries[1]), ENTRY_DAMAGED_TEXT);
    await rejectsWith(readZipEntry(zip, { ...entries[2], localOffset: entries[2].localOffset + 1 }), ENTRY_DAMAGED_TEXT);
    await rejectsWith(readZipEntry(zip, { ...entries[2], size: entries[2].size - 1 }), ENTRY_DAMAGED_TEXT);
    assert.deepEqual(await bytesOf(await readZipEntry(zip, entries[2])), fakeAudio(26));
  });

  test('un método de compresión que no es stored ni deflate se explica', async () => {
    const zip = zipFile(buildZip([{ path: 'Bzip.mp3', data: fakeAudio(27), method: 12, raw: fakeAudio(27) }]));
    const [entry] = await readZipDirectory(zip);
    await assert.rejects(readZipEntry(zip, entry), (error) => error instanceof ZipError && /método 12/.test(error.message));
  });
});
