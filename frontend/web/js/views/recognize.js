// Hoja «Reconocer canción» en la web (ADR-0048). Mismo flujo que la app: micrófono → huella local → consulta a D1 →
// si no hay match, Whisper + letras. Sin dependencias externas: usa getUserMedia + AudioContext.

import { fingerprintSamples, SAMPLE_RATE } from '../../server/recognize-fingerprint.js';
import { el, openDialog } from '../ui/dom.js';
import { icon } from '../ui/icons.js';

const RECOGNITION_SECONDS = 8;

export function openRecognizeSheet(ctx) {
  // El estado de captura se gestiona fuera del render para poder abortarlo tanto desde el botón «Cancelar» como desde
  // el cierre del diálogo (dialog#close): cerrar la hoja a mitad de grabación DEBE parar el micrófono sin dejarlo
  // encendido en segundo plano.
  const abort = new AbortController();
  return openDialog({
    title: 'Reconocer canción',
    className: 'dialog-recognize',
    testid: 'recognize-sheet',
    render: (body, close, dialog) => {
      const node = recognizePanel(ctx, close, abort);
      body.replaceChildren(node);
      dialog?.addEventListener('close', () => abort.abort(), { once: true });
    },
  });
}

function recognizePanel(ctx, close, dialogAbort) {
  // Dos niveles de cancelación:
  //   - dialogAbort: se dispara al cerrar la hoja. Aborta siempre lo que esté en marcha.
  //   - runAbort: controller NUEVO por cada pulsación del botón «Reconocer». Permite cancelar la ejecución actual
  //     sin tener que cerrar la hoja (y volver a empezar sin recrear nada).
  let runAbort = null;
  const state = {
    status: 'idle',
    title: '', artist: '', songId: null, source: '',
    disposer: null,       // Función que apaga limpio el micro/AudioContext cuando se llama.
  };

  const statusText = el('p', { class: 'transferir-progress', style: 'text-align:center;margin:12px 0' },
    'Pulsa para reconocer la canción que suena a tu alrededor.');
  const resultBox = el('div', { style: 'text-align:center;margin-top:16px' });

  const button = el('button', {
    type: 'button',
    class: 'homeostasia-submit',
    style: 'width:160px;height:160px;border-radius:50%;font-size:48px;display:flex;align-items:center;justify-content:center',
    on: { click: onToggle },
  }, icon('note', { size: 64 }));

  const node = el('div', { class: 'transferir' },
    el('div', { style: 'display:flex;justify-content:center;padding:24px' }, button),
    statusText,
    resultBox,
  );

  // Si el diálogo se cierra (X, Esc o botón «Volver»), aborta la ejecución actual: para la captura y libera el micrófono.
  dialogAbort.signal.addEventListener('abort', () => { if (runAbort) runAbort.abort(); });

  function onToggle() {
    const busy = state.status === 'listening' || state.status === 'analyzing' || state.status === 'querying';
    if (busy && runAbort) runAbort.abort();
    else start();
  }

  function setStatus(s, msg) {
    state.status = s;
    statusText.textContent = msg;
    const busy = s === 'listening' || s === 'analyzing' || s === 'querying';
    button.disabled = false;
    button.replaceChildren(icon(busy ? 'close' : 'note', { size: 64 }));
  }

  function renderResult() {
    resultBox.replaceChildren();
    if (state.status !== 'matched') return;
    const subtitle = state.artist ? ` · ${state.artist}` : '';
    resultBox.append(
      el('h3', { style: 'margin:8px 0' }, state.title),
      el('p', { class: 'transferir-intro' }, state.source === 'library'
        ? `En tu biblioteca${subtitle}`
        : `Identificada por letra${subtitle}`),
    );
    if (state.source === 'library' && state.songId) {
      resultBox.append(el('button', {
        type: 'button', class: 'homeostasia-submit', style: 'margin-top:12px',
        on: { click: () => { close(); if (ctx.playSongById) ctx.playSongById(state.songId); } },
      }, 'Abrir en Reminiscencia'));
    } else {
      resultBox.append(el('p', { class: 'transferir-intro' },
        'No está en tu biblioteca aún. Puedes importarla desde «Transferir música» o «Homeostasia» con el título y el artista.'));
    }
  }

  async function start() {
    // Nuevo controller por ejecución. Si el diálogo ya estaba abortado, respetamos ese estado.
    runAbort = new AbortController();
    const signal = runAbort.signal;
    if (dialogAbort.signal.aborted) return;
    runAbort.signal.addEventListener('abort', () => stopAll());

    setStatus('listening', 'Pidiendo permiso del micrófono…');
    renderResult();
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, sampleRate: 48000, echoCancellation: false, noiseSuppression: false },
      });
    } catch (error) {
      setStatus('error', `Sin permiso del micrófono: ${error?.message ?? error}`);
      return;
    }
    if (signal.aborted) { stopStream(stream); return; }

    try {
      setStatus('listening', `Escuchando ${RECOGNITION_SECONDS} s…`);
      const captured = await recordAndCollect(stream, RECOGNITION_SECONDS, signal, (fn) => { state.disposer = fn; });
      state.disposer = null;
      if (signal.aborted) return;

      setStatus('analyzing', 'Analizando huella…');
      const samples16 = downsampleTo16kHz(captured.samples, captured.sampleRate);
      const hashes = fingerprintSamples(samples16);
      if (hashes.length === 0) { setStatus('notMatched', 'No se pudo analizar el audio.'); return; }

      // Para enviar a Whisper mandamos un WAV YA en 16 kHz: lo que acepta igual y ocupa 3 veces menos.
      const wavBytes = floatToWav16Mono(samples16, SAMPLE_RATE);

      setStatus('querying', 'Consultando tu biblioteca…');
      const libResult = await queryLibrary(hashes, signal);
      if (signal.aborted) return;
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
      const lyricsResult = await queryLyrics(wavBytes, signal);
      if (signal.aborted) return;
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
      // No mostramos «Fallo: cancelado» si el abort vino de nosotros.
      if (!signal.aborted) setStatus('error', `Fallo: ${error?.message ?? error}`);
    } finally {
      stopStream(stream);
    }
  }

  function stopAll() {
    try { state.disposer?.(); } catch (_) { /* nada */ }
    state.disposer = null;
    if (state.status === 'listening' || state.status === 'analyzing' || state.status === 'querying') {
      setStatus('idle', 'Cancelado.');
    }
  }

  return node;
}

/** Graba [seconds] segundos del stream capturando Float32. Resuelve con { samples, sampleRate } o se interrumpe si
 *  llega `abortSignal`. Pasa por `register` una función disposer para que el llamante pueda apagar en cualquier
 *  momento (cierra el AudioContext, desconecta los nodos, y cancela el temporizador). */
async function recordAndCollect(stream, seconds, abortSignal, register) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  const audioCtx = new AudioContextClass();
  const sampleRate = audioCtx.sampleRate;
  const source = audioCtx.createMediaStreamSource(stream);
  // ScriptProcessor sigue siendo soportado en todos los navegadores modernos aunque esté marked as deprecated. No
  // conectamos a destination (eco por altavoces); usamos un GainNode con ganancia 0 como «sumidero».
  const processor = audioCtx.createScriptProcessor(4096, 1, 1);
  const sink = audioCtx.createGain();
  sink.gain.value = 0;
  const chunks = [];
  processor.onaudioprocess = (ev) => { chunks.push(new Float32Array(ev.inputBuffer.getChannelData(0))); };
  source.connect(processor);
  processor.connect(sink);
  sink.connect(audioCtx.destination);

  let stopped = false;
  const cleanup = async () => {
    if (stopped) return;
    stopped = true;
    try { processor.onaudioprocess = null; } catch (_) { /* nada */ }
    try { processor.disconnect(); } catch (_) { /* nada */ }
    try { source.disconnect(); } catch (_) { /* nada */ }
    try { sink.disconnect(); } catch (_) { /* nada */ }
    try { await audioCtx.close(); } catch (_) { /* nada */ }
  };

  const timerDone = new Promise((resolve) => setTimeout(resolve, seconds * 1000));
  const abortDone = new Promise((resolve) => {
    if (abortSignal.aborted) resolve();
    else abortSignal.addEventListener('abort', () => resolve(), { once: true });
  });
  register(cleanup);
  await Promise.race([timerDone, abortDone]);
  await cleanup();
  if (abortSignal.aborted) throw new Error('cancelado');

  // Concatenar.
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const samples = new Float32Array(total);
  let off = 0;
  for (const c of chunks) { samples.set(c, off); off += c.length; }
  return { samples, sampleRate };
}

function stopStream(stream) {
  if (!stream) return;
  try { for (const track of stream.getTracks()) track.stop(); } catch (_) { /* nada */ }
}

/** Downsample con low-pass box de 3 taps (moving average) → quita algo de aliasing sin FIR completo. Suficiente para
 *  conservar los picos espectrales que usa la huella. */
function downsampleTo16kHz(samples, sourceRate) {
  if (samples.length === 0) return new Float32Array(0);
  const ratio = sourceRate / SAMPLE_RATE;
  const outLength = Math.floor(samples.length / ratio);
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const center = Math.floor(i * ratio);
    const prev = Math.max(0, center - 1);
    const next = Math.min(samples.length - 1, center + 1);
    out[i] = (samples[prev] + samples[center] + samples[next]) / 3;
  }
  return out;
}

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
