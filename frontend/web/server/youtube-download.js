import {
  CONVERTER_API,
  CONVERTER_ORIGIN,
  YoutubeApiError,
  fetchWithTimeout,
  publicError,
  upstreamHeaders,
  validJobId,
} from './youtube-common.js';

const MAX_WAV_BYTES = 256 * 1024 * 1024;

async function readPrefix(body, length) {
  if (!body) return new Uint8Array();
  const reader = body.getReader();
  const prefix = [];
  let size = 0;
  try {
    while (size < length) {
      const next = await reader.read();
      if (next.done) break;
      const bytes = next.value instanceof Uint8Array ? next.value : new Uint8Array(next.value);
      prefix.push(bytes);
      size += bytes.length;
    }
  } finally {
    // No esperamos a cancel(): la otra rama de tee() es la respuesta que se transmite al cliente.
    reader.cancel().catch(() => {});
  }
  const out = new Uint8Array(Math.min(size, length));
  let offset = 0;
  for (const bytes of prefix) {
    const count = Math.min(bytes.length, out.length - offset);
    if (count <= 0) break;
    out.set(bytes.subarray(0, count), offset);
    offset += count;
  }
  return out;
}

function validWavPrefix(prefix) {
  return prefix.length >= 12
    && String.fromCharCode(...prefix.subarray(0, 4)) === 'RIFF'
    && String.fromCharCode(...prefix.subarray(8, 12)) === 'WAVE';
}

function limitWavStream(stream) {
  let bytes = 0;
  return stream.pipeThrough(new TransformStream({
    transform(chunk, controller) {
      bytes += chunk.byteLength;
      if (bytes > MAX_WAV_BYTES) {
        throw new RangeError('El WAV supera el tamaño máximo permitido.');
      }
      controller.enqueue(chunk);
    },
  }));
}

export async function handleDownload(request, { fetchImpl = globalThis.fetch } = {}) {
  try {
    if (request.method !== 'GET') throw new YoutubeApiError(405, 'Solo se admite GET.');
    const jobId = validJobId(new URL(request.url).searchParams.get('jobId'));
    if (!jobId) throw new YoutubeApiError(400, 'El identificador de trabajo no es válido.');

    const statusResponse = await fetchWithTimeout(fetchImpl, `${CONVERTER_API}/api/status?jobId=${encodeURIComponent(jobId)}`, { headers: upstreamHeaders() });
    if (!statusResponse.ok) throw new YoutubeApiError(502, 'No se pudo consultar el archivo convertido.');
    let status;
    try { status = await statusResponse.json(); } catch { throw new YoutubeApiError(502, 'El conversor devolvió un estado inválido.'); }
    const state = typeof status?.status === 'string' ? status.status.toLowerCase() : '';
    if (state !== 'completed' && state !== 'done' && !status?.downloadUrl && !status?.downloadPath && !status?.url) {
      throw new YoutubeApiError(409, 'La conversión todavía no está terminada.');
    }

    const candidate = status.downloadUrl || status.downloadPath || status.url || `/api/download/?jobId=${encodeURIComponent(jobId)}`;
    const downloadUrl = new URL(candidate, CONVERTER_API);
    if (downloadUrl.origin !== CONVERTER_ORIGIN) throw new YoutubeApiError(502, 'El conversor devolvió una dirección de descarga no válida.');
    const upstream = await fetchWithTimeout(fetchImpl, downloadUrl.href, { headers: upstreamHeaders() }, 180_000);
    if (!upstream.ok || !upstream.body) throw new YoutubeApiError(502, 'No se pudo descargar el WAV convertido.');
    const declared = Number(upstream.headers.get('content-length'));
    if (Number.isFinite(declared) && (declared <= 44 || declared > MAX_WAV_BYTES)) throw new YoutubeApiError(502, 'El WAV descargado no tiene un tamaño válido.');
    const [probe, stream] = upstream.body.tee();
    const prefix = await readPrefix(probe, 12);
    if (!validWavPrefix(prefix)) throw new YoutubeApiError(502, 'El conversor no devolvió un WAV válido.');
    return new Response(limitWavStream(stream), {
      status: 200,
      headers: {
        'Content-Type': 'audio/wav',
        ...(Number.isFinite(declared) ? { 'Content-Length': String(declared) } : {}),
        'Cache-Control': 'no-store',
        'Content-Disposition': `attachment; filename="${jobId}.wav"`,
      },
    });
  } catch (error) {
    return publicError(error);
  }
}

export function GET(request) {
  return handleDownload(request, { fetchImpl: globalThis.fetch });
}
