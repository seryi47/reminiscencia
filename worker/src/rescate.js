// Rescate de subidas atascadas (ADR-0052, rescate 2026-11-27).
// Procesa objetos del bucket privado `reminiscencia-audio-privado` bajo el prefijo `entrada/<uuid>/` que no llegaron
// a publicarse al catálogo tras `/api/subir`. Une los chunks, calcula sha256 y duración del Opus y devuelve los
// metadatos para que el cliente llame a `/api/buzon/publish`; luego copia el Opus unido al bucket público como
// `audio/<song_id>.opus` y limpia el prefijo privado.
//
// Rutas expuestas (todas con X-Auth):
//   GET  /api/admin/entradas-pendientes           → {entries: [{uploadId, manifiesto|null, parts, totalBytes}]}
//   POST /api/admin/rescate/preparar?uploadId=…   → {sha256, durationS, sizeBytes, title}
//   POST /api/admin/rescate/finalizar?uploadId=…
//        body { songId }                          → mueve el Opus al público y limpia entrada/

import { isAuthorized } from './auth.js';

function jsonResponse(status, body, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...extraHeaders,
    },
  });
}

export function isRescateRoute(path) {
  return path === '/api/admin/entradas-pendientes'
    || path === '/api/admin/rescate/preparar'
    || path === '/api/admin/rescate/finalizar';
}

export async function handleRescateRoute(path, request, env) {
  if (!isAuthorized(request, env)) return jsonResponse(401, { ok: false, error: 'Falta o no coincide X-Auth.' });
  if (!env?.PRIVATE_BUCKET || !env?.PUBLIC_BUCKET) {
    return jsonResponse(500, { ok: false, error: 'Faltan bindings R2 (PRIVATE_BUCKET/PUBLIC_BUCKET).' });
  }
  if (path === '/api/admin/entradas-pendientes') return handleListEntradas(env);
  if (path === '/api/admin/rescate/preparar') return handlePreparar(request, env);
  if (path === '/api/admin/rescate/finalizar') return handleFinalizar(request, env);
  return jsonResponse(404, { ok: false, error: 'Ruta desconocida.' });
}

async function handleListEntradas(env) {
  const entries = new Map(); // uploadId -> { parts: [key, size][], manifest: key|null, totalBytes }
  let cursor;
  do {
    const batch = await env.PRIVATE_BUCKET.list({ prefix: 'entrada/', cursor, limit: 1000 });
    for (const obj of batch.objects) {
      // entrada/<uuid>/<n>.part o entrada/<uuid>/manifiesto.json
      const parts = obj.key.split('/');
      if (parts.length < 3) continue;
      const uploadId = parts[1];
      const tail = parts[2];
      const entry = entries.get(uploadId) ?? { uploadId, parts: [], manifest: null, totalBytes: 0 };
      if (tail === 'manifiesto.json') {
        entry.manifest = obj.key;
      } else if (/^\d+\.part$/.test(tail)) {
        entry.parts.push({ key: obj.key, size: obj.size, index: parseInt(tail, 10) });
        entry.totalBytes += obj.size;
      }
      entries.set(uploadId, entry);
    }
    cursor = batch.truncated ? batch.cursor : null;
  } while (cursor);
  const list = [...entries.values()].map((e) => ({
    uploadId: e.uploadId,
    hasManifest: Boolean(e.manifest),
    partsCount: e.parts.length,
    totalBytes: e.totalBytes,
  }));
  return jsonResponse(200, { ok: true, entries: list, total: list.length });
}

async function readManifest(env, uploadId) {
  const obj = await env.PRIVATE_BUCKET.get(`entrada/${uploadId}/manifiesto.json`);
  if (!obj) return null;
  try { return JSON.parse(await obj.text()); } catch { return null; }
}

/** Devuelve el Opus combinado como Uint8Array. Para subidas de hasta ~50 MB cabe sin problema en el Worker. */
async function fusionarChunks(env, uploadId, partesCount) {
  const buffers = [];
  let totalBytes = 0;
  for (let i = 0; i < partesCount; i++) {
    const obj = await env.PRIVATE_BUCKET.get(`entrada/${uploadId}/${i}.part`);
    if (!obj) throw new Error(`falta parte ${i} de ${uploadId}`);
    const buf = new Uint8Array(await obj.arrayBuffer());
    buffers.push(buf);
    totalBytes += buf.length;
  }
  const out = new Uint8Array(totalBytes);
  let off = 0;
  for (const b of buffers) { out.set(b, off); off += b.length; }
  return out;
}

/**
 * Duración de un Ogg Opus: busca el último page Ogg ("OggS") y lee el granule position (8 bytes LE en offset 6).
 * Opus usa 48 kHz como timebase, así que `granule / 48000 = segundos`.
 */
function durationOggOpus(buf) {
  // Busca desde el final el último OggS marker.
  const marker = [0x4f, 0x67, 0x67, 0x53]; // "OggS"
  for (let i = buf.length - 4; i >= Math.max(0, buf.length - 65536); i--) {
    if (buf[i] === marker[0] && buf[i+1] === marker[1] && buf[i+2] === marker[2] && buf[i+3] === marker[3]) {
      if (i + 14 >= buf.length) continue;
      // Granule position: 8 bytes little-endian a partir de offset 6 tras "OggS"
      // Posición en el page: byte 0..3 = "OggS", byte 4 = version, byte 5 = header_type, byte 6..13 = granule.
      let granule = 0n;
      for (let j = 7; j >= 0; j--) granule = (granule << 8n) | BigInt(buf[i + 6 + j]);
      const seconds = Number(granule) / 48000;
      if (seconds > 0) return seconds;
    }
  }
  return null;
}

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function handlePreparar(request, env) {
  if (request.method !== 'POST') return jsonResponse(405, { ok: false, error: 'POST.' });
  const url = new URL(request.url);
  const uploadId = url.searchParams.get('uploadId');
  if (!uploadId) return jsonResponse(400, { ok: false, error: 'Falta uploadId.' });
  const manifest = await readManifest(env, uploadId);
  if (!manifest) return jsonResponse(404, { ok: false, error: `Sin manifiesto para ${uploadId}.` });
  const partesCount = manifest.partes ?? manifest.parts;
  if (!Number.isInteger(partesCount) || partesCount < 1) {
    return jsonResponse(400, { ok: false, error: `Manifiesto inválido: ${JSON.stringify(manifest)}` });
  }
  const opus = await fusionarChunks(env, uploadId, partesCount);
  const sha256 = await sha256Hex(opus);
  const durationS = durationOggOpus(opus);
  const sizeBytes = opus.length;
  const title = (manifest.nombre ?? '').replace(/\.opus$/i, '') || uploadId;
  // Guardamos el opus unido en un buffer temporal dentro del propio bucket privado, para poder moverlo rápido al
  // público en `finalizar` sin volver a leer todos los chunks.
  await env.PRIVATE_BUCKET.put(`entrada/${uploadId}/combined.opus`, opus, {
    httpMetadata: { contentType: 'audio/ogg' },
  });
  return jsonResponse(200, {
    ok: true,
    uploadId,
    sha256,
    duration_s: durationS,
    size_bytes: sizeBytes,
    title,
  });
}

async function handleFinalizar(request, env) {
  if (request.method !== 'POST') return jsonResponse(405, { ok: false, error: 'POST.' });
  const url = new URL(request.url);
  const uploadId = url.searchParams.get('uploadId');
  if (!uploadId) return jsonResponse(400, { ok: false, error: 'Falta uploadId.' });
  let body;
  try { body = await request.json(); } catch { return jsonResponse(400, { ok: false, error: 'JSON inválido.' }); }
  const songId = String(body?.songId || '');
  if (!/^S[0-9a-f]{16}$/.test(songId)) return jsonResponse(400, { ok: false, error: 'songId inválido.' });

  const combined = await env.PRIVATE_BUCKET.get(`entrada/${uploadId}/combined.opus`);
  if (!combined) return jsonResponse(404, { ok: false, error: 'Falta combined.opus (reintentar preparar).' });
  const bytes = await combined.arrayBuffer();
  await env.PUBLIC_BUCKET.put(`audio/${songId}.opus`, bytes, {
    httpMetadata: { contentType: 'audio/ogg' },
  });
  // Limpia el prefijo privado entero
  const listing = await env.PRIVATE_BUCKET.list({ prefix: `entrada/${uploadId}/`, limit: 1000 });
  await Promise.all(listing.objects.map((o) => env.PRIVATE_BUCKET.delete(o.key)));
  return jsonResponse(200, { ok: true, uploadId, songId, movedBytes: bytes.byteLength });
}
