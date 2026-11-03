import {
  CONVERTER_API,
  YoutubeApiError,
  diagnosticContext,
  fetchWithTimeout,
  json,
  publicError,
  safeUpstreamMessage,
  upstreamHeaders,
  validJobId,
} from './youtube-common.js';

export async function handleStatus(request, { fetchImpl = globalThis.fetch } = {}) {
  const startedAt = Date.now();
  const diagnostic = diagnosticContext(request);
  let upstreamStatus = null;
  try {
    if (request.method !== 'GET') throw new YoutubeApiError(405, 'Solo se admite GET.');
    const jobId = validJobId(new URL(request.url).searchParams.get('jobId'));
    if (!jobId) throw new YoutubeApiError(400, 'El identificador de trabajo no es válido.');
    const upstream = await fetchWithTimeout(fetchImpl, `${CONVERTER_API}/api/status?jobId=${encodeURIComponent(jobId)}`, { headers: upstreamHeaders() });
    upstreamStatus = upstream.status;
    if (!upstream.ok) throw new YoutubeApiError(502, 'No se pudo consultar el estado de la conversión.');
    let data;
    try { data = await upstream.json(); } catch { throw new YoutubeApiError(502, 'El conversor devolvió un estado inválido.'); }
    const status = typeof data?.status === 'string' ? data.status.toLowerCase().slice(0, 40) : '';
    if (status === 'error' || status === 'failed') {
      logStatus(diagnostic, {
        upstreamStatus,
        status: 'error',
        durationMs: Date.now() - startedAt,
      });
      return json(200, { status: 'error', error: safeUpstreamMessage(data) });
    }
    // Algunas respuestas del conversor anuncian el trabajo terminado solo
    // mediante la URL de descarga, como hace el script Python de escritorio.
    const hasDownload = Boolean(data?.downloadUrl || data?.downloadPath || data?.url);
    if (!status && !hasDownload) throw new YoutubeApiError(502, 'El conversor devolvió un estado inválido.');
    const queuePosition = safeMetric(data?.queuePosition);
    const queueLength = safeMetric(data?.queueLength);
    const progress = safeProgress(data?.progress);
    const normalizedStatus = status === 'completed' || status === 'done' || hasDownload ? 'completed' : status || 'processing';
    logStatus(diagnostic, {
      upstreamStatus,
      status: normalizedStatus,
      queuePosition,
      queueLength,
      progress,
      durationMs: Date.now() - startedAt,
    });
    return json(200, {
      status: normalizedStatus,
      ...(queuePosition === null ? {} : { queuePosition }),
      ...(queueLength === null ? {} : { queueLength }),
      ...(progress === null ? {} : { progress }),
    });
  } catch (error) {
    if (diagnostic.traceId) {
      console.warn('youtube: fallo al consultar estado', {
        ...diagnostic,
        upstreamStatus,
        errorStatus: error?.status ?? null,
        errorName: error?.name ?? 'Error',
        durationMs: Date.now() - startedAt,
      });
    }
    return publicError(error);
  }
}

function safeMetric(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000 ? value : null;
}

function safeProgress(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100
    ? value
    : null;
}

function logStatus(diagnostic, details) {
  if (!diagnostic.traceId) return;
  if (diagnostic.poll !== 1 && diagnostic.poll % 10 !== 0 && details.status !== 'completed' && details.status !== 'error') return;
  console.info('youtube: estado de conversión', {
    ...diagnostic,
    ...details,
  });
}

export function GET(request) {
  return handleStatus(request, { fetchImpl: globalThis.fetch });
}
