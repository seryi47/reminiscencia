import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  fingerprintSamples, pcm16leToFloat32, SAMPLE_RATE, WINDOW_SIZE, HOP_SIZE,
} from '../../frontend/web/server/recognize-fingerprint.js';

/** Genera un tono senoidal mono de [durationS] segundos a [freq] Hz, a [SAMPLE_RATE]. */
function tone(freq, durationS, amplitude = 0.5) {
  const n = Math.round(SAMPLE_RATE * durationS);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = amplitude * Math.sin(2 * Math.PI * freq * i / SAMPLE_RATE);
  return out;
}

describe('fingerprintSamples (JS)', () => {
  test('audio más corto que una ventana no genera huellas', () => {
    const samples = new Float32Array(WINDOW_SIZE - 1);
    assert.deepEqual(fingerprintSamples(samples), []);
  });

  test('un tono de 8 s a 1 kHz genera cientos de hashes y son MISMOS entre llamadas (determinismo)', () => {
    const t = tone(1000, 8);
    const a = fingerprintSamples(t);
    const b = fingerprintSamples(t);
    assert.ok(a.length > 100, `hashes generados=${a.length}`);
    assert.equal(a.length, b.length);
    for (let i = 0; i < a.length; i++) {
      assert.equal(a[i].hash, b[i].hash);
      assert.equal(a[i].offset, b[i].offset);
    }
  });

  test('ventanas mínimas: un fragmento justo con WINDOW_SIZE da exactamente 1 fotograma (sin pares, 0 hashes)', () => {
    const t = tone(1000, WINDOW_SIZE / SAMPLE_RATE);
    const hashes = fingerprintSamples(t);
    assert.equal(hashes.length, 0);
  });

  test('ventanas suficientes para formar pares: 2 fotogramas → ≥1 hash por pico', () => {
    const t = tone(1000, (WINDOW_SIZE + HOP_SIZE) / SAMPLE_RATE);
    const hashes = fingerprintSamples(t);
    assert.ok(hashes.length > 0, 'deben salir al menos unos cuantos hashes');
  });

  test('tonos distintos (500 Hz vs 1500 Hz) dan conjuntos de hashes muy distintos', () => {
    const a = fingerprintSamples(tone(500, 4));
    const b = fingerprintSamples(tone(1500, 4));
    const setA = new Set(a.map((h) => h.hash));
    const setB = new Set(b.map((h) => h.hash));
    let shared = 0;
    for (const h of setA) if (setB.has(h)) shared++;
    const overlap = shared / Math.min(setA.size, setB.size);
    assert.ok(overlap < 0.6, `demasiado solape entre tonos distintos: ${overlap.toFixed(2)}`);
  });

  test('pcm16leToFloat32 recupera la amplitud: 0x8000 → -1, 0x7FFF → ~+1, 0 → 0', () => {
    const buf = new Uint8Array([0x00, 0x00, 0xFF, 0x7F, 0x00, 0x80]);
    const f = pcm16leToFloat32(buf);
    assert.equal(f[0], 0);
    assert.ok(Math.abs(f[1] - 1.0) < 0.001);
    assert.equal(f[2], -1);
  });
});
