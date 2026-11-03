import {
  CONVERTER_API,
  YoutubeApiError,
  canonicalVideoUrl,
  fetchWithTimeout,
  jobIdFrom,
  json,
  publicError,
  readJson,
  safeUpstreamMessage,
  upstreamHeaders,
  videoId,
  youtubeUrl,
} from './youtube-common.js';

export async function handleConvert(request, { fetchImpl = globalThis.fetch } = {}) {
  try {
    if (request.method !== 'POST') throw new YoutubeApiError(405, 'Solo se admite POST.');
    const body = await readJson(request);
    const sourceUrl = youtubeUrl(body?.url);
    if (!sourceUrl) throw new YoutubeApiError(400, 'La URL del vídeo de YouTube no es válida.');
    const canonicalUrl = canonicalVideoUrl(videoId(sourceUrl.href));
    const upstream = await fetchWithTimeout(fetchImpl, `${CONVERTER_API}/api/convert`, {
      method: 'POST',
      headers: { ...upstreamHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: canonicalUrl, title: typeof body.title === 'string' ? body.title.slice(0, 200) : '', format: 'wav', quality: 'original' }),
    });
    if (!upstream.ok) throw new YoutubeApiError(502, 'El servicio de conversión rechazó la canción.');
    let data;
    try { data = await upstream.json(); } catch { throw new YoutubeApiError(502, 'El servicio de conversión devolvió una respuesta inválida.'); }
    const jobId = jobIdFrom(data);
    if (!jobId) throw new YoutubeApiError(502, 'El conversor no devolvió un identificador de trabajo.');
    return json(200, { jobId });
  } catch (error) {
    return publicError(error);
  }
}

export function POST(request) {
  return handleConvert(request, { fetchImpl: globalThis.fetch });
}
