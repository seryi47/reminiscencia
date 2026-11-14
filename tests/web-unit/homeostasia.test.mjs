// Suelo de duración de la transferencia web (ADR-0046): wavDurationSeconds mide la duración real de un WAV por su cabecera
// (byteRate del trozo «fmt » y bytes reales de «data»), espejo de la lógica de la APK, para rechazar descargas truncadas.
// Ejecución: node --test tests/web-unit/homeostasia.test.mjs
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { wavDurationSeconds, MIN_TRANSFER_DURATION_S } from '../../frontend/web/js/views/homeostasia.js';

// Construye una cabecera WAV con un `fmt ` real (byteRate dado) y un `data` declarado; devuelve {head, totalSize} donde
// totalSize simula el tamaño REAL del blob (= 44 + dataBytes), que es lo que mide la función (no el tamaño declarado).
function wav({ byteRate, dataBytes }) {
  const total = 44 + dataBytes;
  const b = new Uint8Array(Math.min(total, 65536));
  const str = (o, s) => { for (let i = 0; i < s.length; i += 1) b[o + i] = s.charCodeAt(i); };
  const le32 = (o, v) => { b[o] = v & 0xff; b[o + 1] = (v >> 8) & 0xff; b[o + 2] = (v >> 16) & 0xff; b[o + 3] = (v >> 24) & 0xff; };
  const le16 = (o, v) => { b[o] = v & 0xff; b[o + 1] = (v >> 8) & 0xff; };
  str(0, 'RIFF'); le32(4, total - 8); str(8, 'WAVE');
  str(12, 'fmt '); le32(16, 16); le16(20, 1); le16(22, 2); le32(24, 48000); le32(28, byteRate); le16(32, 4); le16(34, 16);
  str(36, 'data'); le32(40, dataBytes);
  return { head: b, totalSize: total };
}

describe('wavDurationSeconds (suelo de 90 s en la transferencia web)', () => {
  test('mide la duración por byteRate y bytes reales, no por lo que declara la cabecera', () => {
    const { head, totalSize } = wav({ byteRate: 100, dataBytes: 18000 }); // 180 s
    assert.equal(wavDurationSeconds(head, totalSize), 180);
  });

  test('detecta un WAV truncado (duración por debajo del suelo)', () => {
    const { head, totalSize } = wav({ byteRate: 100, dataBytes: 1000 }); // 10 s
    assert.ok(wavDurationSeconds(head, totalSize) < MIN_TRANSFER_DURATION_S);
  });

  test('no se fía del tamaño declarado: usa el tamaño real del blob', () => {
    // La cabecera declara data=18000 (180 s), pero el blob real solo trae 1000 bytes de data → 10 s.
    const { head } = wav({ byteRate: 100, dataBytes: 18000 });
    assert.equal(wavDurationSeconds(head, 44 + 1000), 10);
  });

  test('devuelve null si no es un WAV legible (no rechaza por no poder medir)', () => {
    assert.equal(wavDurationSeconds(new Uint8Array([1, 2, 3]), 3), null);
    const noFmt = new Uint8Array(12);
    'RIFF'.split('').forEach((c, i) => { noFmt[i] = c.charCodeAt(0); });
    'WAVE'.split('').forEach((c, i) => { noFmt[8 + i] = c.charCodeAt(0); });
    assert.equal(wavDurationSeconds(noFmt, 12), null);
  });
});
