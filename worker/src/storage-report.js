// Endpoint GET /api/catalogo/storage-report (ADR-0052). Devuelve el tamaño total en R2 agrupado por prefijo
// (catálogo, historial, snapshots, caché YouTube, portadas, audio) para saber cuánto estamos usando del plan gratuito
// de Cloudflare (10 GB) y dónde conviene aplicar políticas de retención. Autenticado con `X-Auth` para no exponer
// métricas internas.

import { isAuthorized } from './auth.js';

const FREE_TIER_BYTES = 10 * 1024 ** 3; // 10 GB del plan R2 gratuito
const PAGE_LIMIT = 1000;

const PREFIXES = [
  ['catalog_size_bytes', 'catalog/'],
  ['history_total_size_bytes', 'history/'],
  ['snapshots_total_size_bytes', 'snapshots/'],
  ['youtube_cache_total_size_bytes', 'youtube-cache/'],
  ['covers_total_size_bytes', 'covers/'],
  ['audio_total_size_bytes', 'audio/'],
];

async function sumPrefix(bucket, prefix) {
  let total = 0;
  let count = 0;
  let cursor;
  do {
    const page = await bucket.list({ prefix, limit: PAGE_LIMIT, cursor });
    for (const o of page.objects ?? []) {
      total += o.size ?? 0;
      count += 1;
    }
    cursor = page.truncated ? page.cursor : null;
  } while (cursor);
  return { total, count };
}

export async function handleStorageReport(request, env) {
  if (request.method !== 'GET') {
    return new Response(JSON.stringify({ ok: false, error: 'Solo se admite GET.' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }
  if (!isAuthorized(request, env)) {
    return new Response(JSON.stringify({ ok: false, error: 'Falta o no coincide X-Auth.' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }
  const bucket = env?.PUBLIC_BUCKET;
  if (!bucket) {
    return new Response(JSON.stringify({ ok: false, error: 'Falta PUBLIC_BUCKET.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }
  const payload = {};
  const counts = {};
  let total = 0;
  for (const [field, prefix] of PREFIXES) {
    const { total: t, count } = await sumPrefix(bucket, prefix);
    payload[field] = t;
    counts[prefix] = count;
    total += t;
  }
  payload.total_r2_bytes = total;
  payload.object_counts = counts;
  payload.limits = {
    free_tier_bytes: FREE_TIER_BYTES,
    percent_used: FREE_TIER_BYTES > 0 ? Number(((total / FREE_TIER_BYTES) * 100).toFixed(3)) : 0,
  };
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
