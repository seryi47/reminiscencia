// Huella acústica estilo Shazam en JS (ADR-0048). EQUIVALENTE BIT A BIT a `mobile/lib/fingerprint.dart`: mismos tamaños
// de ventana, mismos bordes de banda logarítmica y mismo empaquetado del hash. Así los hashes que el móvil manda
// coinciden con los que el generador de la base calcula a partir del catálogo.
//
// La usa:
//   - `scripts/recognize/generate_db.mjs` para huellar la biblioteca y escribir el índice que lee el Worker.
//   - (opcional) el Worker, si en el futuro queremos huellar audio de más sitios.

export const SAMPLE_RATE = 16000;
export const WINDOW_SIZE = 4096;
export const HOP_SIZE = 1024;
export const PEAKS_PER_FRAME = 5;
export const FAN_OUT = 10;
export const MIN_DELTA_FRAMES = 1;
export const MAX_DELTA_FRAMES = 30;

export const NUM_BANDS = 32;
export const BAND_MIN_HZ = 60;
export const BAND_MAX_HZ = 4000;

function hannWindow(n) {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
  return w;
}

function fft(re, im) {
  const n = re.length;
  let j = 0;
  for (let i = 1; i < n; i++) {
    let bit = n >> 1;
    for (; (j & bit) !== 0; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len;
    const wlenR = Math.cos(ang);
    const wlenI = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let wR = 1, wI = 0;
      const half = len >> 1;
      for (let k = 0; k < half; k++) {
        const uR = re[i + k];
        const uI = im[i + k];
        const vR = re[i + k + half] * wR - im[i + k + half] * wI;
        const vI = re[i + k + half] * wI + im[i + k + half] * wR;
        re[i + k] = uR + vR;
        im[i + k] = uI + vI;
        re[i + k + half] = uR - vR;
        im[i + k + half] = uI - vI;
        const nwR = wR * wlenR - wI * wlenI;
        const nwI = wR * wlenI + wI * wlenR;
        wR = nwR; wI = nwI;
      }
    }
  }
}

function frameToPeaks(samples, start, window) {
  const n = WINDOW_SIZE;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < n; i++) re[i] = samples[start + i] * window[i];
  fft(re, im);
  const half = n >> 1;
  const mags = new Float64Array(half);
  for (let i = 0; i < half; i++) mags[i] = Math.sqrt(re[i] * re[i] + im[i] * im[i]);
  const binsPerHz = n / SAMPLE_RATE;
  const logMin = Math.log(BAND_MIN_HZ);
  const logMax = Math.log(BAND_MAX_HZ);
  const bandIndices = new Array(NUM_BANDS + 1);
  for (let b = 0; b <= NUM_BANDS; b++) {
    const hz = Math.exp(logMin + (logMax - logMin) * b / NUM_BANDS);
    bandIndices[b] = Math.min(Math.round(hz * binsPerHz), half);
  }
  const peaks = [];
  for (let b = 0; b < NUM_BANDS; b++) {
    const s = bandIndices[b];
    const e = bandIndices[b + 1];
    if (e <= s) continue;
    let maxI = s, maxV = mags[s];
    for (let i = s + 1; i < e; i++) if (mags[i] > maxV) { maxV = mags[i]; maxI = i; }
    peaks.push({ band: b, magnitude: maxV });
  }
  peaks.sort((a, b) => b.magnitude - a.magnitude);
  if (peaks.length > PEAKS_PER_FRAME) peaks.length = PEAKS_PER_FRAME;
  return peaks;
}

function packHash(anchorBand, targetBand, deltaFrames) {
  return (((anchorBand & 0x3F) << 16) | ((targetBand & 0x3F) << 10) | (deltaFrames & 0x3FF)) >>> 0;
}

/** Devuelve pares `[{hash, offset}]`. `samples` es Float32Array (mono, [SAMPLE_RATE] Hz, [-1, 1]). */
export function fingerprintSamples(samples) {
  if (samples.length < WINDOW_SIZE) return [];
  const window = hannWindow(WINDOW_SIZE);
  const frames = [];
  for (let start = 0; start + WINDOW_SIZE <= samples.length; start += HOP_SIZE) {
    frames.push(frameToPeaks(samples, start, window));
  }
  const hashes = [];
  for (let i = 0; i < frames.length; i++) {
    for (const anchor of frames[i]) {
      let fanned = 0;
      // UN objetivo por fotograma (el pico más fuerte) → los deltas se reparten en 1..FAN_OUT en vez de agotar todo en dt=1.
      for (let dt = MIN_DELTA_FRAMES; dt <= MAX_DELTA_FRAMES && i + dt < frames.length; dt++) {
        const targetFrame = frames[i + dt];
        if (targetFrame.length === 0) continue;
        const target = targetFrame[0];
        hashes.push({ hash: packHash(anchor.band, target.band, dt), offset: i });
        fanned++;
        if (fanned >= FAN_OUT) break;
      }
    }
  }
  return hashes;
}

/** PCM 16-bit LE → Float32 [-1, 1]. */
export function pcm16leToFloat32(buffer) {
  const n = Math.floor(buffer.length / 2);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const lo = buffer[2 * i];
    const hi = buffer[2 * i + 1];
    let v = (hi << 8) | lo;
    if (v & 0x8000) v -= 0x10000;
    out[i] = v / 32768;
  }
  return out;
}
