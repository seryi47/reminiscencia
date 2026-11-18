// Hoja «Reconocer canción» en la web (ADR-0048). Mismo flujo que la app: micrófono → huella local → consulta a D1 →
// si no hay match, Whisper + letras. Sin dependencias externas: usa getUserMedia + AudioContext + MediaRecorder.

import { fingerprintSamples, pcm16leToFloat32, SAMPLE_RATE } from '../../server/recognize-fingerprint.js';
import { el, openDialog, toast } from '../ui/dom.js';
import { icon } from '../ui/icons.js';

const RECOGNITION_SECONDS = 8;

export function openRecognizeSheet(ctx) {
  return openDialog({
    title: 'Reconocer canción',
    className: 'dialog-recognize',
    testid: 'recognize-sheet',
    render: (body, close) => {
      const node = recognizePanel(ctx, close);
      body.replaceChildren(node);
    },
  });
}

function recognizePanel(ctx, close) {
  const state = {
    status: 'idle', // idle|listening|analyzing|querying|matched|notMatched|error
    message: 'Pulsa para reconocer la canción que suena a tu alrededor.',
    title: '', artist: '', songId: null, source: '',
    mediaStream: null, recorder: null,
  };

  const statusText = el('p', { class: 'transferir-progress', style: 'text-align:center;margin:12px 0' }, state.message);
  const resultBox = el('div', { style: 'text-align:center;margin-top:16px' });

  const button = el('button', {
    type: 'button',
    class: 'homeostasia-submit',
    style: 'width:160px;height:160px;border-radius:50%;font-size:48px;display:flex;align-items:center;justify-content:center',
    on: { click: () => (state.status === 'idle' || state.status === 'matched' || state.status === 'notMatched' || state.status === 'error') ? start() : stop() },
  }, icon('note', { size: 64 }));

  const node = el('div', { class: 'transferir' },
    el('div', { style: 'display:flex;justify-content:center;padding:24px' }, button),
    statusText,
    resultBox,
  );

  function setStatus(s, msg) {
    state.status = s;
    state.message = msg;
    statusText.textContent = msg;
    const idle = s === 'idle' || s === 'matched' || s === 'notMatched' || s === 'error';
    button.disabled = s === 'listening' || s === 'analyzing' || s === 'querying';
    button.replaceChildren(icon(idle ? 'note' : 'close', { size: 64 }));
  }

  function renderResult() {
    resultBox.replaceChildren();
    if (state.status === 'matched') {
      const subtitle = state.artist ? ` · ${state.artist}` : '';
      resultBox.append(
        el('h3', { style: 'margin:8px 0' }, state.title),
        el('p', { class: 'transferir-intro' }, state.source === 'library' ? `En tu biblioteca${subtitle}` : `Identificada por letra${subtitle}`),
      );
      if (state.source === 'library' && state.songId) {
        resultBox.append(el('button', {
          type: 'button', class: 'homeostasia-submit', style: 'margin-top:12px',
          on: { click: () => { close(); if (ctx.playSongById) ctx.playSongById(state.songId); } },
        }, 'Abrir en Reminiscencia'));
      } else {
        resultBox.append(el('p', { class: 'transferir-intro' }, 'No está en tu biblioteca aún. Puedes importarla desde «Transferir música» con el título y el artista.'));
      }
    }
  }

  async function start() {
    setStatus('listening', 'Pidiendo permiso del micrófono…');
    renderResult();
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, sampleRate: 48000, echoCancellation: false, noiseSuppression: false } });
    } catch (error) {
      setStatus('error', `Sin permiso del micrófono: ${error?.message ?? error}`);
      return;
    }
    state.mediaStream = stream;
    try {
      setStatus('listening', `Escuchando ${RECOGNITION_SECONDS} s…`);
      const { samples48, wavBytes } = await recordAndCollect(stream, RECOGNITION_SECONDS);
      setStatus('analyzing', 'Analizando huella…');
      const samples16 = downsampleTo16kHz(samples48, 48000);
      const hashes = fingerprintSamples(samples16);
      if (hashes.length === 0) { setStatus('notMatched', 'No se pudo analizar el audio.'); return; }

      setStatus('querying', 'Consultando tu biblioteca…');
      const libResult = await queryLibrary(hashes);
      if (libResult.matched) {
        state.title = libResult.title ?? '';
        state.artist = libResult.artist ?? '';
        state.songId = libResult.songId ?? null;
        state.source = 'library';
        setStatus('matched', `Identificada: ${state.title}`);
        renderResult();
        return;
      }
      setStatus('querying', 'No está en tu biblioteca. Probando a entender la letra…');
      const lyricsResult = await queryLyrics(wavBytes);
      if (lyricsResult.matched) {
        state.title = lyricsResult.title ?? '';
        state.artist = lyricsResult.artist ?? '';
        state.songId = null;
        state.source = 'lyrics';
        setStatus('matched', `Identificada por letra: ${state.title}`);
        renderResult();
        return;
      }
      setStatus('notMatched', libResult.reason === 'db_not_ready'
        ? 'La base de huellas aún no está cargada en el servidor.'
        : 'No he podido identificar la canción.');
    } catch (error) {
      setStatus('error', `Fallo: ${error?.message ?? error}`);
    } finally {
      stopStream(state.mediaStream);
      state.mediaStream = null;
    }
  }

  function stop() {
    stopStream(state.mediaStream);
    state.mediaStream = null;
    setStatus('idle', 'Cancelado.');
  }

  return node;
}

/** Graba [seconds] segundos del stream capturando PCM float32 por AudioWorklet alternativo (ScriptProcessor por ahora
 *  para compatibilidad amplia). Devuelve las muestras a 48 kHz Y los bytes de un WAV equivalente (para Whisper). */
async function recordAndCollect(stream, seconds) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  const audioCtx = new AudioContextClass({ sampleRate: 48000 });
  const source = audioCtx.createMediaStreamSource(stream);
  // ScriptProcessor es deprecated pero el polyfill AudioWorklet son muchas más líneas. Por volumen que gestionamos
  // (<10 s de audio) está bien.
  const processor = audioCtx.createScriptProcessor(4096, 1, 1);
  const chunks = [];
  processor.onaudioprocess = (ev) => {
    const input = ev.inputBuffer.getChannelData(0);
    chunks.push(new Float32Array(input));
  };
  source.connect(processor);
  processor.connect(audioCtx.destination);
  await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
  processor.disconnect();
  source.disconnect();
  await audioCtx.close();

  // Concatenar.
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const samples48 = new Float32Array(total);
  let off = 0;
  for (const c of chunks) { samples48.set(c, off); off += c.length; }

  const wavBytes = floatToWav16Mono(samples48, 48000);
  return { samples48, wavBytes };
}

function stopStream(stream) {
  if (!stream) return;
  try { for (const track of stream.getTracks()) track.stop(); } catch (_) { /* ignorar */ }
}

/** Downsampling muy simple (por saltos) de 48 kHz a 16 kHz. Suficiente para huella. */
function downsampleTo16kHz(samples, sourceRate) {
  const ratio = sourceRate / SAMPLE_RATE;
  const outLength = Math.floor(samples.length / ratio);
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) out[i] = samples[Math.floor(i * ratio)];
  return out;
}

/** Codifica Float32 [-1, 1] a WAV PCM 16-bit LE mono. */
function floatToWav16Mono(samples, sampleRate) {
  const bytesPerSample = 2;
  const dataLength = samples.length * bytesPerSample;
  const header = 44;
  const buffer = new ArrayBuffer(header + dataLength);
  const view = new DataView(buffer);
  const write = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
  write(0, 'RIFF');
  view.setUint32(4, header + dataLength - 8, true);
  write(8, 'WAVE');
  write(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  write(36, 'data');
  view.setUint32(40, dataLength, true);
  let offset = header;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s * 0x7fff, true);
    offset += 2;
  }
  return new Uint8Array(buffer);
}

async function queryLibrary(hashes) {
  try {
    const response = await fetch('/api/recognize', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ v: 1, hashes: hashes.map((h) => h.hash), offsets: hashes.map((h) => h.offset) }),
    });
    if (!response.ok) return { matched: false };
    return await response.json();
  } catch { return { matched: false }; }
}

async function queryLyrics(wavBytes) {
  try {
    const response = await fetch('/api/recognize-lyrics', {
      method: 'POST', headers: { 'Content-Type': 'application/octet-stream' },
      body: wavBytes,
    });
    if (!response.ok) return { matched: false };
    return await response.json();
  } catch { return { matched: false }; }
}
