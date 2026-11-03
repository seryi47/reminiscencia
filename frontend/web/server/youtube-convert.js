import {
  CONVERTER_API,
  YoutubeApiError,
  fetchWithTimeout,
  jobIdFrom,
  json,
  publicError,
  readJson,
  safeUpstreamMessage,
  upstreamHeaders,
  youtubeUrl,
} from './youtube-common.js';

export async function handleConvert(request, { fetchImpl = globalThis.fetch } = {}) {
  try {
    if (request.method !== 'POST') throw new YoutubeApiError(405, 'Solo se admite POST.');
    const body = await readJson(request);
    if (!youtubeUrl(body?.url)) throw new YoutubeApiError(400, 'La URL del vídeo de YouTube no es válida.');
    const upstream = await fetchWithTimeout(fetchImpl, `${CONVERTER_API}/api/convert`, {
      method: 'POST',
      headers: { ...upstreamHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: body.url, title: typeof body.title === 'string' ? body.title.slice(0, 200) : '', format: 'wav', quality: 'original' }),
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
