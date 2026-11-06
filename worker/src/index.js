// Worker de Cloudflare «reminiscencia-api» (ADR-0029). Las mismas rutas y contratos que las funciones de Vercel, con la
// lógica compartida (frontend/web/server/upload-core.js y edit-core.js, que a su vez usa js/cuidador/incidencias.js) y
// los buckets de R2 por binding (sin SigV4 ni claves de R2):
//
//   GET  /api/salud                 { ok: true, servicio, trozoMaximo }: la web y la APK lo preguntan antes de subir.
//   POST /api/subir                 trozos al bucket privado (entrada/<UUID>/), hasta 32 MB por trozo; con el último,
//                                   manifiesto y repository_dispatch «subida-web» (como api/subir.js).
//   POST /api/editar                organizar (incidencia, como api/editar.js) o portada JPEG (al bucket público y al
//                                   índice de portadas, sin GitHub; respuesta con «portada» y «url»).
//   GET  /api/editar?incidencia=N   estado de una edición (como api/editar.js).
//   POST /api/portada               solo portadas (lo mismo que la portada de /api/editar).
//   GET  /api/portadas              el índice de portadas leído del bucket, sin caché.
//
// CORS solo para el origen de la web (https://reminiscencia.vercel.app; más los de ALLOWED_ORIGINS) y para localhost y
// 127.0.0.1 en cualquier puerto (pruebas). Una petición con otro Origin se rechaza con 403 sin hacer nada. Sin Origin
// (la APK, curl) se atiende. Todas las respuestas llevan X-Reminiscencia-Api: así los clientes distinguen una respuesta
// del Worker de una página de error de Cloudflare y saben cuándo volver a Vercel.
//
// Bindings y secretos (worker/wrangler.toml): PRIVATE_BUCKET (reminiscencia-audio-privado), PUBLIC_BUCKET
// (reminiscencia-audio) y el secreto GITHUB_TOKEN (wrangler secret put GITHUB_TOKEN; Contents e Issues en escritura).

import { EditError, handleEditRequest, jsonResponse, readCover } from '../../frontend/web/server/edit-core.js';
import { handleUploadRequest, UploadError, WORKER_MAX_CHUNK_BYTES } from '../../frontend/web/server/upload-core.js';
import { readCoverIndex, saveCoverToBucket } from './portadas.js';
import { bindingStorage } from './r2-storage.js';
import { serializeCoverIndex } from '../../frontend/web/js/cover-index.js';

export const SERVICE = 'reminiscencia-api';
export const API_HEADER = 'X-Reminiscencia-Api';
export const WEB_ORIGIN = 'https://reminiscencia.vercel.app';
export const ALLOWED_HEADERS = Object.freeze([
  'Content-Type', 'X-Nombre-Archivo', 'X-Subida-Id', 'X-Parte', 'X-Partes', 'X-Album-Id', 'X-Album-Name',
  'X-Artista-Cancion', 'X-Portada-Id',
]);
const LOCAL_ORIGIN = /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d{1,5})?$/;
export const COVER_DONE_MESSAGE = 'Portada guardada: ya la ven todos.';
const NOT_CONFIGURED_UPLOAD = 'La subida no está configurada en el servidor (falta GITHUB_TOKEN o el bucket privado). Avisa a quien mantiene la web.';
const NOT_CONFIGURED_COVER = 'Las portadas no están configuradas en el servidor (falta el bucket público). Avisa a quien mantiene la web.';

/** Orígenes admitidos: la web, los de env.ALLOWED_ORIGINS (separados por comas) y localhost para las pruebas. */
export function isAllowedOrigin(origin, env = {}) {
  if (origin === WEB_ORIGIN || LOCAL_ORIGIN.test(origin)) return true;
  const extra = typeof env.ALLOWED_ORIGINS === 'string' ? env.ALLOWED_ORIGINS.split(',').map((item) => item.trim()) : [];
  return extra.includes(origin);
}

function corsHeaders(origin) {
  return origin ? {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Expose-Headers': API_HEADER,
    Vary: 'Origin',
  } : { Vary: 'Origin' };
}

/** Copia la respuesta con las cabeceras del Worker (CORS y X-Reminiscencia-Api). */
function finish(response, origin) {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(corsHeaders(origin))) headers.set(name, value);
  headers.set(API_HEADER, '1');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

const token = (env) => (typeof env.GITHUB_TOKEN === 'string' ? env.GITHUB_TOKEN.trim() : '');

function saveCoverWith(env) {
  const save = async ({ id, bytes }) => {
    if (!env.PUBLIC_BUCKET) {
      console.error('portada: falta el binding PUBLIC_BUCKET');
      throw new EditError(500, NOT_CONFIGURED_COVER);
    }
    return { ...(await saveCoverToBucket(env.PUBLIC_BUCKET, { id, bytes })), mensaje: COVER_DONE_MESSAGE };
  };
  save.withoutToken = true;
  return save;
}

async function handleCover(request, env) {
  try {
    if (request.method !== 'POST') throw new EditError(405, 'Solo se admite POST.');
    const cover = await readCover(request);
    const extra = await saveCoverWith(env)(cover);
    return jsonResponse(200, { ok: true, ...extra });
  } catch (error) {
    if (error instanceof EditError) return jsonResponse(error.status, { ok: false, error: error.message });
    console.error('portada: fallo inesperado', error?.name ?? 'Error');
    return jsonResponse(500, { ok: false, error: 'No se ha podido guardar la portada. Inténtalo de nuevo.' });
  }
}

async function handleCoverIndex(request, env) {
  if (request.method !== 'GET') return jsonResponse(405, { ok: false, error: 'Solo se admite GET.' });
  if (!env.PUBLIC_BUCKET) return jsonResponse(500, { ok: false, error: NOT_CONFIGURED_COVER });
  try {
    const { index } = await readCoverIndex(env.PUBLIC_BUCKET);
    return new Response(serializeCoverIndex(index), {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    const status = error instanceof EditError ? error.status : 500;
    return jsonResponse(status, { ok: false, error: 'No se ha podido leer el índice de portadas.' });
  }
}

/** Atiende una petición (también en las pruebas: tests/web-unit/worker.test.mjs, con bindings simulados). */
export async function handleRequest(request, env = {}, { fetchImpl = (...args) => globalThis.fetch(...args) } = {}) {
  const origin = request.headers.get('origin');
  const path = new URL(request.url).pathname;
  if (origin !== null && !isAllowedOrigin(origin, env)) {
    return finish(jsonResponse(403, { ok: false, error: 'Origen no permitido.' }), null);
  }
  if (request.method === 'OPTIONS') {
    return finish(new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': ALLOWED_HEADERS.join(', '),
        'Access-Control-Max-Age': '86400',
      },
    }), origin);
  }
  let response;
  switch (path) {
    case '/api/salud':
      response = jsonResponse(200, { ok: true, servicio: SERVICE, trozoMaximo: WORKER_MAX_CHUNK_BYTES });
      break;
    case '/api/subir':
      response = await handleUploadRequest(request, {
        fetchImpl,
        maxChunkBytes: WORKER_MAX_CHUNK_BYTES,
        config: () => {
          if (!token(env) || !env.PRIVATE_BUCKET) {
            console.error('subir: falta el secreto GITHUB_TOKEN o el binding PRIVATE_BUCKET');
            throw new UploadError(500, NOT_CONFIGURED_UPLOAD);
          }
          return { token: token(env), storage: bindingStorage(env.PRIVATE_BUCKET) };
        },
      });
      break;
    case '/api/editar':
      response = await handleEditRequest(request, { token: token(env), fetchImpl, saveCover: saveCoverWith(env) });
      break;
    case '/api/portada':
      response = await handleCover(request, env);
      break;
    case '/api/portadas':
      response = await handleCoverIndex(request, env);
      break;
    default:
      response = jsonResponse(404, { ok: false, error: 'No existe.' });
  }
  return finish(response, origin);
}

export default {
  fetch(request, env) {
    return handleRequest(request, env);
  },
};
