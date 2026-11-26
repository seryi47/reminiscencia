// Endpoints HTTP del catálogo en R2 (ADR-0052). Lectura pública con ETag; escritura autenticada con AUTH_PASSWORD +
// candado optimista (if_match contra la versión actual + lock de 15 s) + snapshot pre-versión + append al historial.
//
// Rutas:
//   GET  /api/catalogo/latest           → el catálogo actual con ETag W/"v<version>" y Cache-Control: no-store.
//   POST /api/catalogo/edit             → aplica una acción declarativa (rename, move, delete, set_*, create_folder).
//   POST /api/buzon/publish             → añade al catálogo las canciones publicadas por el buzón.
//   POST /api/catalogo/rollback         → vuelve a una versión anterior (lee snapshots/by-version/v<N>.json).
//   GET  /api/catalogo/historial        → últimas N líneas de history/latest.jsonl (por defecto 100).
//   GET  /api/catalogo/snapshot/latest  → descarga del catálogo actual como backup (Content-Disposition).
//   GET  /api/catalogo/snapshot/v<N>    → descarga de una versión arbitraria (inmutable, cacheable 1 año).
//   GET  /api/catalogo/feed.atom        → feed Atom 1.0 con las últimas 50 ediciones (consumible desde Feedly, etc.).

import { isAuthorized } from './auth.js';
import { CATALOG_KEY, emptyCatalog, readCatalog, writeCatalog } from './catalog.js';
import { ActionError, addBuzonSongs, applyAction } from './catalog-actions.js';
import { acquireLock, releaseLock } from './catalog-lock.js';
import { appendEvent, readLatest } from './history.js';
import { ensureDailySnapshot, ensureVersionSnapshot, readVersionSnapshot, VERSION_SNAPSHOT_PREFIX } from './snapshots.js';

const jsonResponse = (status, payload, extraHeaders = {}) => new Response(JSON.stringify(payload), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extraHeaders },
});

function catalogBucketMissing() {
  return jsonResponse(500, { ok: false, error: 'El catálogo no está configurado en el servidor (falta PUBLIC_BUCKET).' });
}

function catalogNotMigrated() {
  return jsonResponse(503, { ok: false, error: 'El catálogo aún no se ha migrado a R2.' });
}

async function parseJsonBody(request) {
  const text = await request.text();
  if (!text) return {};
  try { return JSON.parse(text); } catch { throw new ActionError(400, 'El cuerpo debe ser JSON válido.'); }
}

function actorOf(request) {
  const header = request.headers.get('x-actor');
  if (typeof header === 'string' && header.trim()) return header.trim().slice(0, 64);
  const agent = request.headers.get('user-agent') ?? '';
  return (agent.split(/\s+/)[0] ?? 'anon').slice(0, 64) || 'anon';
}

/** GET /api/catalogo/latest */
export async function handleCatalogLatest(request, env) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return jsonResponse(405, { ok: false, error: 'Solo se admite GET.' });
  }
  if (!env?.PUBLIC_BUCKET) return catalogBucketMissing();
  const catalog = await readCatalog(env.PUBLIC_BUCKET);
  if (!catalog) return catalogNotMigrated();
  const etag = `W/"v${catalog.version}"`;
  if (request.headers.get('if-none-match') === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag, 'Cache-Control': 'no-store' } });
  }
  const body = request.method === 'HEAD' ? null : JSON.stringify(catalog);
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ETag: etag },
  });
}

/** GET /api/catalogo/public.json — lectura pública del catálogo con cache edge de 10 s. A diferencia de /latest,
 *  esta ruta NO expone ETag ni soporta If-None-Match: su contrato es «última versión conocida, pero puede ir hasta
 *  10 segundos por detrás». Pensada para integraciones externas (widgets, feeds secundarios) que quieran ahorrar
 *  invocaciones del Worker apoyándose en el edge cache de Cloudflare. La web y la APK siguen usando /latest. */
export async function handleCatalogPublic(request, env) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return jsonResponse(405, { ok: false, error: 'Solo se admite GET.' });
  }
  if (!env?.PUBLIC_BUCKET) return catalogBucketMissing();
  const catalog = await readCatalog(env.PUBLIC_BUCKET);
  if (!catalog) return catalogNotMigrated();
  const body = request.method === 'HEAD' ? null : JSON.stringify(catalog);
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      // 10 s de cache en el edge + el cliente: ganancias de CPU del Worker a cambio de hasta 10 s de latencia
      // en cambios. No pensado para la UI oficial (que exige ver sus propias ediciones al instante).
      'Cache-Control': 'public, max-age=10, must-revalidate',
    },
  });
}

/** Núcleo común: autoriza, coge lock, lee catálogo, delega al mutator y escribe. */
async function withLockedWrite(request, env, mutate) {
  if (!env?.PUBLIC_BUCKET) return catalogBucketMissing();
  if (!isAuthorized(request, env)) {
    return jsonResponse(401, { ok: false, error: 'Falta o no coincide X-Auth.' });
  }
  let body;
  try { body = await parseJsonBody(request); } catch (error) {
    return jsonResponse(error.status, { ok: false, error: error.message });
  }
  const current = (await readCatalog(env.PUBLIC_BUCKET)) ?? emptyCatalog();
  const expected = body.if_match;
  if (expected !== undefined && expected !== null && expected !== current.version) {
    return jsonResponse(412, { ok: false, error: `if_match no coincide (esperado ${expected}, actual ${current.version}).`, current_version: current.version });
  }
  const lock = await acquireLock(env.PUBLIC_BUCKET, actorOf(request));
  if (!lock.ok) {
    return jsonResponse(423, { ok: false, error: 'El catálogo lo está escribiendo otro ahora mismo; prueba en un momento.' }, {
      'Retry-After': String(Math.max(1, lock.retryAfter ?? 1)),
    });
  }
  try {
    // Releemos tras tomar el lock por si otro acabó justo antes.
    const latest = (await readCatalog(env.PUBLIC_BUCKET)) ?? emptyCatalog();
    if (expected !== undefined && expected !== null && expected !== latest.version) {
      return jsonResponse(412, { ok: false, error: `if_match no coincide (esperado ${expected}, actual ${latest.version}).`, current_version: latest.version });
    }
    let next;
    let event;
    try {
      const applied = mutate(latest, body);
      next = applied.catalog;
      event = applied.event;
    } catch (error) {
      if (error instanceof ActionError) return jsonResponse(error.status, { ok: false, error: error.message });
      throw error;
    }
    const now = Date.now();
    await ensureVersionSnapshot(env.PUBLIC_BUCKET, latest);
    next.version = latest.version + 1;
    next.updated_at = new Date(now).toISOString();
    // Orden pensado para fallos a medias (ADR-0052, cierre de findings 2026-11-26):
    //  (1) appendEvent PRIMERO con el version_after de la escritura que vamos a hacer:
    //      si el isolate muere aquí, el historial deja una entrada "huérfana" (evento sin writeCatalog hecho)
    //      — detectable con verificación de salud al comparar último evento con catalog.version.
    //  (2) writeCatalog: materializa la versión nueva.
    //  (3) ensureVersionSnapshot(next): garantiza que la versión nueva tenga snapshot propia (sin esto, rollback
    //      a next.version solo existiría tras la SIGUIENTE edición — hueco de O(1) de rollback).
    //  (4) ensureDailySnapshot(next) con la foto más reciente del día.
    // Mal menor elegido: historial con transición registrada pero catálogo rezagado (recuperable al reaplicar),
    // frente al orden antiguo (writeCatalog primero + appendEvent después) que podía dejar versiones sin registro.
    const snapshotKeyDaily = await ensureDailySnapshot(env.PUBLIC_BUCKET, next, { now });
    const { event: stored } = await appendEvent(env.PUBLIC_BUCKET, {
      ...event,
      by: actorOf(request),
      version_before: latest.version,
      version_after: next.version,
      ...(snapshotKeyDaily ? { daily_snapshot: snapshotKeyDaily } : {}),
    }, { now });
    await writeCatalog(env.PUBLIC_BUCKET, next);
    await ensureVersionSnapshot(env.PUBLIC_BUCKET, next);
    return jsonResponse(200, { ok: true, version: next.version, event: stored }, { ETag: `W/"v${next.version}"` });
  } finally {
    await releaseLock(env.PUBLIC_BUCKET, lock.token);
  }
}

/** POST /api/catalogo/edit */
export async function handleCatalogEdit(request, env) {
  if (request.method !== 'POST') return jsonResponse(405, { ok: false, error: 'Solo se admite POST.' });
  return withLockedWrite(request, env, (catalog, body) => {
    if (typeof body?.action !== 'string') throw new ActionError(400, 'Falta "action".');
    return applyAction(catalog, body.action, body.params ?? {});
  });
}

/** POST /api/buzon/publish */
export async function handleBuzonPublish(request, env) {
  if (request.method !== 'POST') return jsonResponse(405, { ok: false, error: 'Solo se admite POST.' });
  return withLockedWrite(request, env, (catalog, body) => addBuzonSongs(catalog, body?.songs));
}

/** POST /api/catalogo/rollback */
export async function handleCatalogRollback(request, env) {
  if (request.method !== 'POST') return jsonResponse(405, { ok: false, error: 'Solo se admite POST.' });
  if (!env?.PUBLIC_BUCKET) return catalogBucketMissing();
  if (!isAuthorized(request, env)) return jsonResponse(401, { ok: false, error: 'Falta o no coincide X-Auth.' });
  let body;
  try { body = await parseJsonBody(request); } catch (error) {
    return jsonResponse(error.status, { ok: false, error: error.message });
  }
  const toVersion = body?.to_version;
  if (!Number.isInteger(toVersion) || toVersion < 0) {
    return jsonResponse(400, { ok: false, error: 'rollback: falta to_version entero positivo.' });
  }
  const snapshot = await readVersionSnapshot(env.PUBLIC_BUCKET, toVersion);
  if (!snapshot) return jsonResponse(404, { ok: false, error: `No hay snapshot para la versión ${toVersion}.` });
  const lock = await acquireLock(env.PUBLIC_BUCKET, actorOf(request));
  if (!lock.ok) {
    return jsonResponse(423, { ok: false, error: 'El catálogo lo está escribiendo otro ahora mismo; prueba en un momento.' }, {
      'Retry-After': String(Math.max(1, lock.retryAfter ?? 1)),
    });
  }
  try {
    const latest = (await readCatalog(env.PUBLIC_BUCKET)) ?? emptyCatalog();
    if (toVersion === latest.version) return jsonResponse(200, { ok: true, version: latest.version, already_there: true });
    await ensureVersionSnapshot(env.PUBLIC_BUCKET, latest);
    const now = Date.now();
    const restored = {
      ...snapshot,
      version: latest.version + 1,
      updated_at: new Date(now).toISOString(),
    };
    // Mismo orden que withLockedWrite (ADR-0052): appendEvent → writeCatalog → ensureVersionSnapshot(next).
    const snapshotKey = await ensureDailySnapshot(env.PUBLIC_BUCKET, restored, { now });
    const { event } = await appendEvent(env.PUBLIC_BUCKET, {
      kind: 'rollback',
      to_version: toVersion,
      by: actorOf(request),
      version_before: latest.version,
      version_after: restored.version,
      ...(snapshotKey ? { daily_snapshot: snapshotKey } : {}),
    }, { now });
    await writeCatalog(env.PUBLIC_BUCKET, restored);
    await ensureVersionSnapshot(env.PUBLIC_BUCKET, restored);
    return jsonResponse(200, { ok: true, version: restored.version, event }, { ETag: `W/"v${restored.version}"` });
  } finally {
    await releaseLock(env.PUBLIC_BUCKET, lock.token);
  }
}

/** GET /api/catalogo/historial?limit=100 */
export async function handleCatalogHistorial(request, env) {
  if (request.method !== 'GET') return jsonResponse(405, { ok: false, error: 'Solo se admite GET.' });
  if (!env?.PUBLIC_BUCKET) return catalogBucketMissing();
  const url = new URL(request.url);
  const limitRaw = Number(url.searchParams.get('limit') ?? 100);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(1, Math.floor(limitRaw)), 1000) : 100;
  const events = await readLatest(env.PUBLIC_BUCKET, limit);
  return jsonResponse(200, { ok: true, events, limit });
}

/** GET /api/catalogo/snapshot/latest — descarga el catálogo actual como adjunto (backup). */
export async function handleSnapshotLatest(request, env) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return jsonResponse(405, { ok: false, error: 'Solo se admite GET.' });
  }
  if (!env?.PUBLIC_BUCKET) return catalogBucketMissing();
  const current = await readCatalog(env.PUBLIC_BUCKET);
  if (!current) return jsonResponse(404, { ok: false, error: 'No hay catálogo todavía.' });
  // Preferimos la snapshot by-version si existe (idéntica al catálogo actual pero fijada por versión); si no, servimos
  // el catálogo vivo. En producción la snapshot debería existir siempre tras withLockedWrite.
  const snapshot = await readVersionSnapshot(env.PUBLIC_BUCKET, current.version);
  const body = JSON.stringify(snapshot ?? current);
  const filename = `reminiscencia-catalogo-v${current.version}.json`;
  return new Response(request.method === 'HEAD' ? null : body, {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      // Idempotente por versión; si cambia la versión cambia el nombre, así que 24h con revalidación es seguro.
      'Cache-Control': 'public, max-age=86400, must-revalidate',
      ETag: `W/"v${current.version}"`,
    },
  });
}

/** GET /api/catalogo/snapshot/v<N> — descarga una versión arbitraria del catálogo (inmutable). */
export async function handleSnapshotByVersion(path, request, env) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return jsonResponse(405, { ok: false, error: 'Solo se admite GET.' });
  }
  if (!env?.PUBLIC_BUCKET) return catalogBucketMissing();
  const match = /^\/api\/catalogo\/snapshot\/v(\d+)$/.exec(path);
  if (!match) return jsonResponse(400, { ok: false, error: 'Ruta no válida: usa /api/catalogo/snapshot/v<N>.' });
  const version = Number(match[1]);
  const snapshot = await readVersionSnapshot(env.PUBLIC_BUCKET, version);
  if (!snapshot) return jsonResponse(404, { ok: false, error: `No hay snapshot para la versión ${version}.` });
  const body = JSON.stringify(snapshot);
  const filename = `reminiscencia-catalogo-v${version}.json`;
  return new Response(request.method === 'HEAD' ? null : body, {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      // Una versión concreta nunca cambia (clave distinta por N): cacheable para siempre.
      'Cache-Control': 'public, max-age=31536000, immutable',
      ETag: `"v${version}"`,
    },
  });
}

/** Escapa cuatro caracteres XML sensibles. Suficiente para texto en <title>, <content> y <author>. */
function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Devuelve un título humano corto para un evento del historial. */
function titleForEvent(event) {
  const kind = event?.kind ?? 'cambio';
  switch (kind) {
    case 'rename_song': return `Canción renombrada: ${event.new_title ?? ''}`;
    case 'rename_folder': return `Álbum renombrado: ${event.new_name ?? ''}`;
    case 'move_song': return 'Canción movida de álbum';
    case 'move_folder': return 'Álbum movido';
    case 'set_cover': return 'Portada actualizada';
    case 'set_year': return 'Año actualizado';
    case 'set_artist': return 'Artista actualizado';
    case 'set_tags': return 'Etiquetas actualizadas';
    case 'set_song_fields': return 'Campos de canción actualizados';
    case 'set_track_index': return 'Orden de pista actualizado';
    case 'reorder_folder': return 'Álbum reordenado';
    case 'delete_song': return 'Canción eliminada';
    case 'delete_folder': return 'Álbum eliminado';
    case 'unpublish_song': return 'Canción despublicada';
    case 'create_folder': return `Álbum creado: ${event.name ?? ''}`;
    case 'migration_initial': return `Migración inicial · ${event.songs_count ?? '?'} canciones`;
    case 'resync_clean':
    case 'resync_from_main': return `Resync a ${event.songs_count ?? '?'} canciones`;
    case 'rollback': return `Rollback a la versión ${event.to_version ?? '?'}`;
    case 'buzon_publish': return `Buzón: ${event.count ?? 'canciones'} publicadas`;
    default: return `Cambio: ${kind}`;
  }
}

/** Convierte un evento en HTML para el <content> del feed. */
function contentForEvent(event) {
  const rows = Object.entries(event)
    .filter(([k]) => !['raw'].includes(k))
    .map(([k, v]) => `<tr><th>${escapeXml(k)}</th><td>${escapeXml(typeof v === 'object' ? JSON.stringify(v) : v)}</td></tr>`)
    .join('');
  return `<table>${rows}</table>`;
}

/** GET /api/catalogo/feed.atom — feed Atom 1.0 con las últimas 50 ediciones del catálogo. */
export async function handleFeedAtom(request, env) {
  if (request.method !== 'GET') return jsonResponse(405, { ok: false, error: 'Solo se admite GET.' });
  if (!env?.PUBLIC_BUCKET) return catalogBucketMissing();
  const events = await readLatest(env.PUBLIC_BUCKET, 50);
  const feedUpdated = events[0]?.at ?? new Date().toISOString();
  const selfUrl = 'https://reminiscencia.cometia.es/api/catalogo/feed.atom';
  const siteUrl = 'https://reminiscencia.cometia.es/';
  const entries = events.map((event) => {
    const id = event.id ?? event.at ?? String(Math.random());
    const title = titleForEvent(event);
    const updated = event.at ?? feedUpdated;
    const author = event.by ?? 'anon';
    const content = contentForEvent(event);
    return `  <entry>
    <id>urn:ulid:${escapeXml(id)}</id>
    <title>${escapeXml(title)}</title>
    <updated>${escapeXml(updated)}</updated>
    <author><name>${escapeXml(author)}</name></author>
    <content type="html">${escapeXml(content)}</content>
  </entry>`;
  }).join('\n');
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <id>${selfUrl}</id>
  <title>Reminiscencia · Cambios en el catálogo</title>
  <updated>${escapeXml(feedUpdated)}</updated>
  <link rel="self" href="${selfUrl}"/>
  <link href="${siteUrl}"/>
${entries}
</feed>
`;
  return new Response(xml, {
    status: 200,
    headers: {
      'Content-Type': 'application/atom+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
    },
  });
}

/** Devuelve true si la ruta es una de las nuevas del catálogo (para router). */
export function isCatalogRoute(path) {
  return path === '/api/catalogo/latest'
    || path === '/api/catalogo/public.json'
    || path === '/api/catalogo/edit'
    || path === '/api/catalogo/rollback'
    || path === '/api/catalogo/historial'
    || path === '/api/buzon/publish'
    || path === '/api/catalogo/snapshot/latest'
    || path === '/api/catalogo/feed.atom'
    || /^\/api\/catalogo\/snapshot\/v\d+$/.test(path);
}

/** Despacha una ruta del catálogo al handler correspondiente. */
export async function handleCatalogRoute(path, request, env) {
  switch (path) {
    case '/api/catalogo/latest': return handleCatalogLatest(request, env);
    case '/api/catalogo/public.json': return handleCatalogPublic(request, env);
    case '/api/catalogo/edit': return handleCatalogEdit(request, env);
    case '/api/catalogo/rollback': return handleCatalogRollback(request, env);
    case '/api/catalogo/historial': return handleCatalogHistorial(request, env);
    case '/api/buzon/publish': return handleBuzonPublish(request, env);
    case '/api/catalogo/snapshot/latest': return handleSnapshotLatest(request, env);
    case '/api/catalogo/feed.atom': return handleFeedAtom(request, env);
    default:
      if (/^\/api\/catalogo\/snapshot\/v\d+$/.test(path)) return handleSnapshotByVersion(path, request, env);
      return jsonResponse(404, { ok: false, error: 'No existe.' });
  }
}

export { CATALOG_KEY, VERSION_SNAPSHOT_PREFIX };
