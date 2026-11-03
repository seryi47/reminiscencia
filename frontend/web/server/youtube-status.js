import {
  CONVERTER_API,
  YoutubeApiError,
  fetchWithTimeout,
  json,
  publicError,
  safeUpstreamMessage,
  upstreamHeaders,
  validJobId,
} from './youtube-common.js';

export async function handleStatus(request, { fetchImpl = globalThis.fetch } = {}) {
  try {
    if (request.method !== 'GET') throw new YoutubeApiError(405, 'Solo se admite GET.');
    const jobId = validJobId(new URL(request.url).searchParams.get('jobId'));
    if (!jobId) throw new YoutubeApiError(400, 'El identificador de trabajo no es válido.');
    const upstream = await fetchWithTimeout(fetchImpl, `${CONVERTER_API}/api/status?jobId=${encodeURIComponent(jobId)}`, { headers: upstreamHeaders() });
    if (!upstream.ok) throw new YoutubeApiError(502, 'No se pudo consultar el estado de la conversión.');
    let data;
    try { data = await upstream.json(); } catch { throw new YoutubeApiError(502, 'El conversor devolvió un estado inválido.'); }
    const status = typeof data?.status === 'string' ? data.status.toLowerCase().slice(0, 40) : '';
    if (status === 'error' || status === 'failed') return json(200, { status: 'error', error: safeUpstreamMessage(data) });
    // Algunas respuestas del conversor anuncian el trabajo terminado solo
    // mediante la URL de descarga, como hace el script Python de escritorio.
    const hasDownload = Boolean(data?.downloadUrl || data?.downloadPath || data?.url);
    return json(200, {
      status: status === 'completed' || status === 'done' || hasDownload ? 'completed' : status || 'processing'
    });
  } catch (error) {
    return publicError(error);
  }
}

export function GET(request) {
  return handleStatus(request, { fetchImpl: globalThis.fetch });
}
