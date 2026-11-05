// Función de Vercel POST /api/editar (ADR-0022): cambia textos, álbumes y portadas de la biblioteca sin que quien edita
// pase por GitHub. Node, sin dependencias. Lo usan la web y la APK; no cambiar el contrato sin cambiar los dos.
//
//   Contenido JSON  { "action": "organize", "payload": { "op": … } }  →  abre en GitHub una incidencia con la etiqueta
//     «biblioteca» (la misma que habría abierto la persona a mano, ADR-0008). El workflow biblioteca la valida y la aplica.
//     Se valida aquí con las reglas de js/cuidador/incidencias.js. Operaciones admitidas: create_folder, edit_folder,
//     rename_folder y edit_song sin «public». Borrar álbumes y publicar o despublicar canciones siguen siendo solo
//     para quien tiene permiso de escritura.
//   Contenido image/jpeg, cabecera X-Portada-Id (S o F + 16 hexadecimales)  →  guarda el JPEG (hasta 1 MB) en
//     audio-library/buzon/portadas/<ID>.jpg con un commit en main; el workflow buzon lo recorta y lo publica.
//
// El token solo sale de process.env.GITHUB_TOKEN (permisos Contents e Issues en escritura) y nunca va a registros ni
// respuestas.

import {
  buildIssueBody,
  buildIssueTitle,
  isCoverFolderId,
  isSongId,
  validateRequest,
  ISSUE_LABEL,
} from '../js/cuidador/incidencias.js';

export const REPOSITORY = 'seryi47/reminiscencia';
export const BRANCH = 'main';
export const COVERS_DIRECTORY = 'audio-library/buzon/portadas';
export const MAX_COVER_BYTES = 1024 * 1024;
export const ALLOWED_OPS = Object.freeze(['create_folder', 'edit_folder', 'rename_folder', 'edit_song']);
export const DONE_MESSAGE = 'Guardado: llegará a todos en un par de minutos.';
const API = 'https://api.github.com';

export class EditError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'EditError';
    this.status = status;
  }
}

/** Motivo en español si la petición no se puede aceptar desde la web pública, o null. */
export function organizeProblem(request) {
  if (!request || typeof request !== 'object' || request.action !== 'organize') {
    return 'Solo se admiten peticiones de organizar la biblioteca.';
  }
  const payload = request.payload;
  if (!payload || typeof payload !== 'object' || !ALLOWED_OPS.includes(payload.op)) {
    return 'Esa operación hay que pedirla desde GitHub.';
  }
  if (payload.op === 'edit_song' && 'public' in payload) return 'Publicar o despublicar hay que pedirlo desde GitHub.';
  return validateRequest(request);
}

/** Dice si los bytes son un JPEG (FF D8 FF al principio, FF D9 al final). */
export function isJpeg(bytes) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes ?? []);
  return data.length > 4 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff && data[data.length - 2] === 0xff && data[data.length - 1] === 0xd9;
}

export function coverId(headers) {
  const id = (headers.get('x-portada-id') ?? '').trim();
  if (!isSongId(id) && !isCoverFolderId(id)) throw new EditError(400, 'El identificador de la portada no es válido.');
  return id;
}

function githubClient(token, fetchImpl) {
  return async (method, path, body) => {
    let response;
    try {
      response = await fetchImpl(`${API}/repos/${REPOSITORY}${path}`, {
        method,
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'reminiscencia-edicion',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new EditError(502, 'No se ha podido conectar con GitHub. Inténtalo de nuevo en un momento.');
    }
    let data = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }
    return { status: response.status, data };
  };
}

function expect(result, statuses, what) {
  if (statuses.includes(result.status)) return result.data;
  console.error(`editar: GitHub respondió ${result.status} al ${what}`);
  if (result.status === 401 || result.status === 403) {
    throw new EditError(500, 'El servidor no tiene permiso para guardar el cambio (el token necesita Issues y Contents en escritura). Avisa a quien mantiene la web.');
  }
  throw new EditError(502, 'GitHub no ha aceptado el cambio. Inténtalo de nuevo en un momento.');
}

async function createIssue(github, request) {
  const title = buildIssueTitle(request);
  const body = buildIssueBody(request);
  const data = expect(await github('POST', '/issues', { title, body, labels: [ISSUE_LABEL] }), [201], 'crear la incidencia');
  const labeled = Array.isArray(data?.labels) && data.labels.some((label) => (label?.name ?? label) === ISSUE_LABEL);
  return { number: data?.number ?? null, labeled };
}

async function storeCover(github, id, bytes) {
  const path = `${COVERS_DIRECTORY}/${id}.jpg`;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const current = await github('GET', `/contents/${path}?ref=${BRANCH}`);
    const sha = current.status === 200 ? current.data?.sha : undefined;
    const result = await github('PUT', `/contents/${path}`, {
      message: `Portada desde la web: ${id}`,
      content: Buffer.from(bytes).toString('base64'),
      branch: BRANCH,
      ...(sha ? { sha } : {}),
    });
    if (result.status === 200 || result.status === 201) return;
    if (result.status !== 409 && result.status !== 422) expect(result, [200, 201], 'guardar la portada');
  }
  throw new EditError(503, 'Hay muchos cambios a la vez. Inténtalo de nuevo en un momento.');
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

/** Atiende una petición. env y fetchImpl se inyectan en las pruebas (tests/web-unit/api-editar.test.mjs). */
export async function handleEdit(request, { env = {}, fetchImpl = globalThis.fetch } = {}) {
  try {
    if (request.method !== 'POST') throw new EditError(405, 'Solo se admite POST.');
    const token = typeof env.GITHUB_TOKEN === 'string' ? env.GITHUB_TOKEN.trim() : '';
    if (!token) {
      console.error('editar: falta la variable de entorno GITHUB_TOKEN');
      throw new EditError(500, 'La edición no está configurada en el servidor (falta GITHUB_TOKEN). Avisa a quien mantiene la web.');
    }
    const github = githubClient(token, fetchImpl);
    const type = (request.headers.get('content-type') ?? '').toLowerCase();
    if (type.startsWith('image/')) {
      if (!type.startsWith('image/jpeg')) throw new EditError(415, 'La portada debe ser un JPEG.');
      const id = coverId(request.headers);
      const declared = Number(request.headers.get('content-length'));
      if (Number.isFinite(declared) && declared > MAX_COVER_BYTES) throw new EditError(413, 'La portada no puede pasar de 1 MB.');
      const bytes = new Uint8Array(await request.arrayBuffer());
      if (bytes.length > MAX_COVER_BYTES) throw new EditError(413, 'La portada no puede pasar de 1 MB.');
      if (!isJpeg(bytes)) throw new EditError(400, 'El archivo no es un JPEG válido.');
      await storeCover(github, id, bytes);
      return json(200, { ok: true, mensaje: DONE_MESSAGE });
    }
    let body;
    try {
      body = await request.json();
    } catch {
      throw new EditError(400, 'La petición no es un JSON válido.');
    }
    const problem = organizeProblem(body);
    if (problem) throw new EditError(400, problem);
    const issue = await createIssue(github, body);
    return json(200, { ok: true, incidencia: issue.number, etiquetada: issue.labeled, mensaje: DONE_MESSAGE });
  } catch (error) {
    if (error instanceof EditError) return json(error.status, { ok: false, error: error.message });
    console.error('editar: fallo inesperado', error?.name ?? 'Error');
    return json(500, { ok: false, error: 'No se ha podido guardar el cambio. Inténtalo de nuevo.' });
  }
}

/** Punto de entrada de Vercel (firma web: Request → Response). */
export function POST(request) {
  return handleEdit(request, { env: process.env, fetchImpl: globalThis.fetch });
}
