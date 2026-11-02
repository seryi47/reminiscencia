// Pruebas de la subida local de audio del cuidador (node:test, sin navegador).
// Cubren el nombre a título, los límites y el tamaño estimado, la comprobación de espacio, el CRC y el
// empaquetado Ogg Opus, y el filtrado de canciones locales en la descarga sin conexión (ADR-0012).
// Todos los datos son ficticios. Ejecución: node --test tests/web-unit/subida-local.test.mjs

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  buildOggOpus,
  checkFileLimits,
  checkSpace,
  deleteLocalSong,
  estimateOpusBytes,
  formatMegabytes,
  isDeletableSong,
  isLocalAudioUrl,
  LOCAL_AUDIO_ACCEPT,
  LocalAudioError,
  MAX_DURATION_S,
  MAX_FILE_BYTES,
  newLocalSongId,
  oggCrc,
  OPUS_RATE,
  outputFormat,
  packetSamples,
  preSkipFromHead,
  songFromRecord,
  SPACE_RESERVE_BYTES,
  titleFromFileName,
} from '../../frontend/web/js/cuidador/subida-local.js';
import { listAudioUrls } from '../../frontend/web/js/offline-core.js';

const MB = 1024 * 1024;

describe('titulo de la cancion desde el nombre del archivo', () => {
  test('quita solo la última extensión', () => {
    assert.equal(titleFromFileName('Charleston (Fox Trot).mp3'), 'Charleston (Fox Trot)');
    assert.equal(titleFromFileName('mi.cancion.flac'), 'mi.cancion');
    assert.equal(titleFromFileName('Sin extension'), 'Sin extension');
  });

  test('acepta rutas de Windows y de Unix y quita los espacios de los extremos', () => {
    assert.equal(titleFromFileName('C:\\musica\\Vals.wav'), 'Vals');
    assert.equal(titleFromFileName('/home/a/Bolero.ogg'), 'Bolero');
    assert.equal(titleFromFileName('   Tango  .m4a'), 'Tango');
  });

  test('sin nombre útil usa «Sin título» y el título se limita a 200 caracteres', () => {
    assert.equal(titleFromFileName('.mp3'), 'Sin título');
    assert.equal(titleFromFileName(''), 'Sin título');
    assert.equal(titleFromFileName(undefined), 'Sin título');
    assert.equal(titleFromFileName(`${'a'.repeat(300)}.mp3`).length, 200);
  });
});

describe('formatos de salida y tamaño estimado', () => {
  test('mono a 32 kbps y estéreo a 48 kbps; más de dos canales se mezclan a estéreo', () => {
    assert.deepEqual(outputFormat(1), { channels: 1, bitrate: 32000 });
    assert.deepEqual(outputFormat(2), { channels: 2, bitrate: 48000 });
    assert.deepEqual(outputFormat(6), { channels: 2, bitrate: 48000 });
    assert.deepEqual(outputFormat(0), { channels: 1, bitrate: 32000 });
  });

  test('un minuto estéreo ocupa unos 360 KB de flujo y la estimación incluye margen', () => {
    const bytes = estimateOpusBytes(60, 2);
    assert.ok(bytes >= 360000, `estimación ${bytes} por debajo del flujo`);
    assert.ok(bytes <= 420000, `estimación ${bytes} demasiado alta`);
  });

  test('mono ocupa menos que estéreo y una duración vacía estima solo la cabecera', () => {
    assert.ok(estimateOpusBytes(180, 1) < estimateOpusBytes(180, 2));
    assert.equal(estimateOpusBytes(0, 2), estimateOpusBytes(-5, 2));
    assert.equal(estimateOpusBytes(NaN, 1), estimateOpusBytes(0, 1));
  });

  test('formatea megabytes con coma decimal', () => {
    assert.equal(formatMegabytes(1.5 * MB), '1,5 MB');
    assert.equal(formatMegabytes(0), '0,0 MB');
  });
});

describe('límites por archivo', () => {
  test('acepta un archivo normal y rechaza vacío, demasiado pesado o demasiado largo', () => {
    assert.equal(checkFileLimits({ bytes: 5 * MB, durationS: 200 }), null);
    assert.match(checkFileLimits({ bytes: 0 }), /vacío/);
    assert.match(checkFileLimits({ bytes: MAX_FILE_BYTES + 1 }), /límite/);
    assert.match(checkFileLimits({ bytes: MB, durationS: MAX_DURATION_S + 1 }), /minutos/);
    assert.equal(checkFileLimits({ bytes: MB, durationS: MAX_DURATION_S }), null);
  });
});

describe('comprobación de espacio', () => {
  test('resta el uso actual y la reserva del espacio total', () => {
    const quota = 1000 * MB;
    const usage = 400 * MB;
    const result = checkSpace({ neededBytes: 20 * MB, quota, usage });
    assert.equal(result.ok, true);
    assert.equal(result.known, true);
    assert.equal(result.availableBytes, quota - usage - SPACE_RESERVE_BYTES);
  });

  test('avisa con un mensaje si la canción no cabe', () => {
    const result = checkSpace({ neededBytes: 300 * MB, quota: 400 * MB, usage: 300 * MB });
    assert.equal(result.ok, false);
    assert.match(result.message, /No hay espacio suficiente/);
    assert.match(result.message, /300,0 MB/);
  });

  test('el espacio disponible nunca es negativo', () => {
    const result = checkSpace({ neededBytes: 1, quota: 10 * MB, usage: 500 * MB });
    assert.equal(result.availableBytes, 0);
    assert.equal(result.ok, false);
  });

  test('sin cifras de almacenamiento no se puede comprobar y no bloquea', () => {
    for (const quota of [undefined, null, 0, NaN]) {
      const result = checkSpace({ neededBytes: 10 * MB, quota });
      assert.equal(result.ok, true);
      assert.equal(result.known, false);
      assert.equal(result.message, null);
    }
  });
});

describe('identificadores y utilidades de Opus', () => {
  test('el identificador local es L más 16 hexadecimales y no choca con el catálogo', () => {
    const id = newLocalSongId(Uint8Array.from([0, 1, 2, 3, 254, 255, 16, 171]));
    assert.equal(id, 'L00010203feff10ab');
    assert.match(id, /^L[0-9a-f]{16}$/);
    assert.throws(() => newLocalSongId(new Uint8Array(4)), RangeError);
  });

  test('muestras por paquete a 48 kHz, con 960 por defecto', () => {
    assert.equal(packetSamples(20000), 960);
    assert.equal(packetSamples(null), 960);
    assert.equal(packetSamples(undefined), 960);
    assert.equal(OPUS_RATE, 48000);
  });

  test('lee el pre-skip de una cabecera OpusHead y rechaza otra cosa', () => {
    const head = new Uint8Array(19);
    head.set(new TextEncoder().encode('OpusHead'), 0);
    head[9] = 2;
    head[10] = 0x38;
    head[11] = 0x01; // 312
    assert.equal(preSkipFromHead(head.buffer), 312);
    assert.equal(preSkipFromHead(head), 312);
    assert.equal(preSkipFromHead(new Uint8Array(19)), null);
    assert.equal(preSkipFromHead(null), null);
    assert.equal(preSkipFromHead(new Uint8Array(4)), null);
  });

  test('solo las URL blob son de canciones locales', () => {
    assert.equal(isLocalAudioUrl('blob:https://x.example/abc'), true);
    assert.equal(isLocalAudioUrl('audio/S1.opus'), false);
    assert.equal(isLocalAudioUrl(null), false);
  });

  test('el selector de archivos acepta audio y las extensiones habituales', () => {
    for (const token of ['audio/*', '.wav', '.mp3', '.m4a', '.ogg', '.flac']) {
      assert.ok(LOCAL_AUDIO_ACCEPT.includes(token), token);
    }
  });
});

// Lector mínimo de Ogg para comprobar la estructura de lo que escribe buildOggOpus.
function readPages(bytes) {
  const pages = [];
  let pos = 0;
  while (pos < bytes.length) {
    assert.equal(String.fromCharCode(...bytes.subarray(pos, pos + 4)), 'OggS', `página sin cabecera en ${pos}`);
    const view = new DataView(bytes.buffer, bytes.byteOffset + pos, bytes.byteLength - pos);
    const count = bytes[pos + 26];
    const table = bytes.subarray(pos + 27, pos + 27 + count);
    const payloadLength = table.reduce((sum, value) => sum + value, 0);
    const pageLength = 27 + count + payloadLength;
    const packets = [];
    let offset = pos + 27 + count;
    let current = [];
    for (const size of table) {
      current.push(bytes.subarray(offset, offset + size));
      offset += size;
      if (size < 255) {
        packets.push(Uint8Array.from(current.flatMap((part) => [...part])));
        current = [];
      }
    }
    const page = bytes.subarray(pos, pos + pageLength);
    const copy = Uint8Array.from(page);
    copy.fill(0, 22, 26);
    pages.push({
      type: bytes[pos + 5],
      granule: view.getBigUint64(6, true),
      seq: view.getUint32(18, true),
      crc: view.getUint32(22, true),
      crcOk: oggCrc(copy) === view.getUint32(22, true),
      packets,
    });
    pos += pageLength;
  }
  return pages;
}

describe('empaquetado Ogg Opus', () => {
  const packetsOf = (sizes) => sizes.map((size, index) => ({
    data: Uint8Array.from({ length: size }, (_, i) => (index + i) % 251),
    samples: 960,
  }));

  test('el CRC de una página es consistente y cambia con el contenido', () => {
    const a = oggCrc(new Uint8Array([1, 2, 3, 4]));
    assert.equal(a, oggCrc(new Uint8Array([1, 2, 3, 4])));
    assert.notEqual(a, oggCrc(new Uint8Array([1, 2, 3, 5])));
  });

  test('cabeceras OpusHead y OpusTags en sus propias páginas, con el título', () => {
    const bytes = buildOggOpus({ packets: packetsOf([80, 90]), channels: 2, preSkip: 312, totalSamples: 1920, title: 'Vals' });
    const pages = readPages(bytes);
    assert.equal(pages[0].type, 0x02, 'primera página con BOS');
    const head = pages[0].packets[0];
    assert.equal(String.fromCharCode(...head.subarray(0, 8)), 'OpusHead');
    assert.equal(head[9], 2);
    assert.equal(head[10] | (head[11] << 8), 312);
    assert.equal(pages[1].packets.length, 1);
    const tags = new TextDecoder().decode(pages[1].packets[0]);
    assert.match(tags, /^OpusTags/);
    assert.ok(tags.includes('TITLE=Vals'));
    assert.ok(pages.every((page) => page.crcOk), 'CRC de todas las páginas');
  });

  test('la última página lleva EOS y la granule recorta a pre-skip más total', () => {
    const bytes = buildOggOpus({ packets: packetsOf([80, 90, 70]), channels: 1, preSkip: 312, totalSamples: 2000 });
    const pages = readPages(bytes);
    const last = pages.at(-1);
    assert.equal(last.type & 0x04, 0x04, 'EOS en la última página');
    assert.equal(last.granule, 312n + 2000n);
    const granules = pages.map((page) => page.granule);
    assert.deepEqual(granules, [...granules].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0)), 'granules no decrecientes');
  });

  test('conserva los paquetes, también los que ocupan varios segmentos de lacing', () => {
    const input = packetsOf([10, 255, 256, 600, 2000]);
    const pages = readPages(buildOggOpus({ packets: input, channels: 2, preSkip: 312 }));
    const audio = pages.slice(2).flatMap((page) => page.packets);
    assert.equal(audio.length, input.length);
    input.forEach((packet, index) => assert.deepEqual([...audio[index]], [...packet.data]));
  });

  test('sin audio o con canales no válidos, falla con un error claro', () => {
    assert.throws(() => buildOggOpus({ packets: [], channels: 2 }), RangeError);
    assert.throws(() => buildOggOpus({ packets: packetsOf([10]), channels: 6 }), RangeError);
  });
});

describe('canciones locales en la descarga sin conexión', () => {
  test('una canción local no genera ruta de descarga desde el servidor', () => {
    const songs = [
      { id: 'S1', title: 'Catálogo' },
      { id: 'L00112233aabbccdd', title: 'Local', local: true, audio: 'blob:https://x.example/1' },
    ];
    assert.deepEqual(listAudioUrls(songs), ['audio/S1.opus']);
  });
});

// Un IndexedDB falso y mínimo: basta para abrir la base, borrar un registro y terminar la transacción.
function fakeIndexedDb({ records = [], failDelete = false } = {}) {
  const store = new Map(records.map((record) => [record.id, record]));
  const stores = new Set(['pistas']);
  const db = {
    objectStoreNames: { contains: (name) => stores.has(name) },
    createObjectStore(name) {
      stores.add(name);
    },
    transaction() {
      const tx = { oncomplete: null, onerror: null, onabort: null, error: null };
      const objectStore = {
        delete(key) {
          const req = { onsuccess: null };
          setTimeout(() => {
            if (failDelete) {
              tx.error = new Error('fallo simulado');
              tx.onerror?.();
              return;
            }
            store.delete(key);
            req.onsuccess?.();
            tx.oncomplete?.();
          }, 0);
          return req;
        },
      };
      tx.objectStore = () => objectStore;
      return tx;
    },
    close() {},
  };
  const indexedDB = {
    open() {
      const request = { result: null, onupgradeneeded: null, onsuccess: null, onerror: null, onblocked: null };
      setTimeout(() => {
        request.result = db;
        request.onupgradeneeded?.();
        request.onsuccess?.();
      }, 0);
      return request;
    },
  };
  return { env: { indexedDB }, store };
}

// Registra las URL de objeto revocadas durante la prueba, sin cambiar lo que hace el navegador.
async function withRevokeSpy(work) {
  const revoked = [];
  const original = URL.revokeObjectURL;
  URL.revokeObjectURL = (url) => {
    revoked.push(url);
    original.call(URL, url);
  };
  try {
    return await work(revoked);
  } finally {
    URL.revokeObjectURL = original;
  }
}

describe('canciones que se pueden borrar desde este navegador', () => {
  test('solo las subidas aquí (marca local e id L) son borrables', () => {
    assert.equal(isDeletableSong({ id: 'L00112233aabbccdd', title: 'Local', local: true }), true);
    assert.equal(isDeletableSong({ id: 'Sabcdef0123456789', title: 'Catálogo' }), false);
    assert.equal(isDeletableSong({ id: 'Sabcdef0123456789', title: 'Catálogo', local: true }), false);
    assert.equal(isDeletableSong({ id: 'L00112233aabbccdd', title: 'Sin marca' }), false);
    assert.equal(isDeletableSong({ title: 'Sin id', local: true }), false);
    assert.equal(isDeletableSong(null), false);
  });
});

describe('borrado de una canción local', () => {
  test('rechaza una canción pública sin tocar la base de datos', async () => {
    const { env, store } = fakeIndexedDb({ records: [{ id: 'L00112233aabbccdd' }] });
    await assert.rejects(deleteLocalSong('Sabcdef0123456789', env), LocalAudioError);
    assert.equal(store.has('L00112233aabbccdd'), true);
  });

  test('quita el registro de IndexedDB y revoca la URL de objeto que lo reproducía', async () => {
    const record = { id: 'L0011223344556677', title: 'Local', durationS: 60, blob: new Blob([new Uint8Array(8)]) };
    const { env, store } = fakeIndexedDb({ records: [record] });
    const song = songFromRecord(record);
    await withRevokeSpy(async (revoked) => {
      await deleteLocalSong(song.id, env);
      assert.equal(store.has(record.id), false);
      assert.deepEqual(revoked, [song.audio]);
    });
  });

  test('si el borrado falla, el registro y la URL se conservan y el error es claro', async () => {
    const record = { id: 'L8899aabbccddeeff', title: 'Local', durationS: 30, blob: new Blob([new Uint8Array(4)]) };
    const { env, store } = fakeIndexedDb({ records: [record], failDelete: true });
    const song = songFromRecord(record);
    await withRevokeSpy(async (revoked) => {
      await assert.rejects(deleteLocalSong(song.id, env), (error) => {
        assert.ok(error instanceof LocalAudioError);
        assert.equal(error.message, 'No se pudo borrar la canción de este navegador.');
        return true;
      });
      assert.equal(store.has(record.id), true);
      assert.deepEqual(revoked, []);
    });
  });

  test('sin almacenamiento de audio en el navegador avisa en lugar de fallar en silencio', async () => {
    await assert.rejects(deleteLocalSong('L0011223344556677', {}), LocalAudioError);
  });
});
