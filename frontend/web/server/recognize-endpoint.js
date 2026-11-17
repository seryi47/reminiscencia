// Endpoint HTTP del reconocedor (ADR-0048). Recibe un cuerpo JSON `{v:1, hashes:[int], offsets:[int]}` del móvil y
// devuelve `{matched, songId?, title?, artist?, confidence}`. Si la base de huellas aún no está cargada, responde
// 200 con `matched:false` y un `reason` explicativo: la UI de la app no se cae por eso.

import { matchFingerprint, parseFingerprintIndex, enrichMatch } from './recognize-core.js';

const MAX_HASHES_PER_QUERY = 50000; // tope defensivo (una captura de 8s rinde ~3000-6000; margen holgado)

let cachedIndex = null;
let cachedMeta = null;

/** Para pruebas: inyecta índice y metadatos sin bajarlos de la red. */
export function setRecognizeIndex({ index, meta }) {
  cachedIndex = index ?? null;
  cachedMeta = meta ?? null;
}

async function loadIndex(env) {
  if (cachedIndex) return { index: cachedIndex, meta: cachedMeta };
  if (!env) return { index: null, meta: null };
  // Preferencia 1: binding ASSETS con `recognize/fingerprints.json` + `recognize/meta.json`.
  if (env.ASSETS && typeof env.ASSETS.fetch === 'function') {
    try {
      const [fpRes, metaRes] = await Promise.all([
        env.ASSETS.fetch(new Request('https://assets.local/recognize/fingerprints.json')),
        env.ASSETS.fetch(new Request('https://assets.local/recognize/meta.json')),
      ]);
      if (fpRes.ok) {
        const fp = await fpRes.json();
        cachedIndex = parseFingerprintIndex(fp);
      }
      if (metaRes.ok) cachedMeta = await metaRes.json();
    } catch (_) { /* falla silenciosa: se trata abajo */ }
  }
  return { index: cachedIndex, meta: cachedMeta };
}

export async function handleRecognizeRequest(request, { env } = {}) {
  if (request.method !== 'POST') {
    return jsonResponse(405, { ok: false, matched: false, error: 'Solo se admite POST.' });
  }
  let body;
  try { body = await request.json(); } catch (_) {
    return jsonResponse(400, { ok: false, matched: false, error: 'Cuerpo JSON no válido.' });
  }
  if (!body || body.v !== 1 || !Array.isArray(body.hashes) || !Array.isArray(body.offsets)) {
    return jsonResponse(400, { ok: false, matched: false, error: 'Formato no reconocido.' });
  }
  if (body.hashes.length > MAX_HASHES_PER_QUERY || body.offsets.length > MAX_HASHES_PER_QUERY) {
    return jsonResponse(413, { ok: false, matched: false, error: 'Demasiados hashes.' });
  }
  const { index, meta } = await loadIndex(env);
  if (!index || index.size === 0) {
    // Sin base aún: respondemos OK con matched:false. El usuario verá «no está en tu biblioteca».
    return jsonResponse(200, { ok: true, matched: false, reason: 'db_not_ready', totalQueryHashes: body.hashes.length });
  }
  const raw = matchFingerprint({ hashes: body.hashes, offsets: body.offsets }, index);
  const enriched = enrichMatch(raw, meta ?? {});
  return jsonResponse(200, { ok: true, ...enriched });
}

function jsonResponse(status, data) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}
