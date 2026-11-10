// Lógica común de POST y GET /api/editar (ADR-0022, ADR-0027 y ADR-0029). La usan la función de Vercel (api/editar.js)
// y el Worker de Cloudflare (worker/src/index.js). Solo JavaScript estándar: corre igual en Node y en un Worker.
//
//   Contenido JSON  { "action": "organize", "payload": { "op": … } }  →  abre en GitHub una incidencia «biblioteca»
//     (ADR-0008), validada aquí con las reglas de js/cuidador/incidencias.js. Operaciones admitidas: create_folder,
//     edit_folder, rename_folder, edit_song sin «public», move_songs, order_album y clean_titles (ADR-0032). Respuesta
//     { ok: true, incidencia, etiquetada, mensaje }.
//   Contenido image/jpeg, cabecera X-Portada-Id (S o F + 16 hexadecimales), hasta 1 MB  →  la portada. Dónde se guarda
//     lo decide cada plataforma (saveCover): Vercel, en el buzón de GitHub (lo procesa buzon.yml); el Worker, en el
//     bucket público de R2 con el índice de portadas (ADR-0029), y entonces la respuesta lleva también «portada».
//   GET ?incidencia=N  →  { ok: true, incidencia: N, estado: 'abierta' | 'cerrada' | 'error' } (ADR-0027).
//
// El token de GitHub nunca va a registros ni respuestas.

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
export const ALLOWED_OPS = Object.freeze(['create_folder', 'edit_folder', 'rename_folder', 'edit_song', 'unpublish_song', 'move_songs', 'order_album', 'clean_titles']);
export const DONE_MESSAGE = 'Guardado: llegará a todos en un par de minutos.';
export const ERROR_LABEL = 'error';
export const EDIT_STATES = Object.freeze({ OPEN: 'abierta', CLOSED: 'cerrada', ERROR: 'error' });
// Número de incidencia: entero positivo sin ceros a la izquierda, como mucho 9 cifras.
const ISSUE_NUMBER = /^[1-9][0-9]{0,8}$/;
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

export function githubClient(token, fetchImpl) {
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

export function expect(result, statuses, what) {
  if (statuses.includes(result.status)) return result.data;
  console.error(`editar: GitHub respondió ${result.status} al ${what}`);
  if (result.status === 401 || result.status === 403) {
    throw new EditError(500, 'El servidor no tiene permiso para guardar el cambio (el token necesita Issues y Contents en escritura). Avisa a quien mantiene la web.');
  }
  throw new EditError(502, 'GitHub no ha aceptado el cambio. Inténtalo de nuevo en un momento.');
}

export async function createIssue(github, request) {
  const title = buildIssueTitle(request);
  const body = buildIssueBody(request);
  const data = expect(await github('POST', '/issues', { title, body, labels: [ISSUE_LABEL] }), [201], 'crear la incidencia');
  const labeled = Array.isArray(data?.labels) && data.labels.some((label) => (label?.name ?? label) === ISSUE_LABEL);
  return { number: data?.number ?? null, labeled };
}

/** Número de incidencia de «?incidencia=N», o lanza EditError(400). Solo cifras: nada de signos, espacios ni decimales. */
export function issueNumberFrom(url) {
  let params;
  try {
    params = new URL(url).searchParams;
  } catch {
    throw new EditError(400, 'La dirección no es válida.');
  }
  const values = params.getAll('incidencia');
  if (values.length !== 1 || !ISSUE_NUMBER.test(values[0])) throw new EditError(400, 'El número de incidencia no es válido.');
  return Number(values[0]);
}

/** Estado de una edición a partir de la incidencia de GitHub. */
export function editStateOf(issue) {
  const labels = Array.isArray(issue?.labels) ? issue.labels.map((label) => label?.name ?? label) : [];
  if (labels.includes(ERROR_LABEL)) return EDIT_STATES.ERROR;
  if (issue?.state === 'closed') return issue.state_reason === 'not_planned' ? EDIT_STATES.ERROR : EDIT_STATES.CLOSED;
  return EDIT_STATES.OPEN;
}

export async function issueState(github, number) {
  const result = await github('GET', `/issues/${number}`);
  if (result.status === 404 || result.status === 410) throw new EditError(404, 'No existe esa edición.');
  const issue = expect(result, [200], 'leer la incidencia');
  // Solo las incidencias de edición (las que crea esta función): ni pull requests ni otras incidencias del repositorio.
  if (!issue || issue.pull_request || typeof issue.body !== 'string' || !issue.body.startsWith('action: organize')) {
    throw new EditError(404, 'No existe esa edición.');
  }
  return editStateOf(issue);
}


/** Lee y valida una portada (JPEG de hasta 1 MB con su id). Devuelve { id, bytes } o lanza EditError. */
export async function readCover(request) {
  const type = (request.headers.get('content-type') ?? '').toLowerCase();
  if (!type.startsWith('image/jpeg')) throw new EditError(415, 'La portada debe ser un JPEG.');
  const id = coverId(request.headers);
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_COVER_BYTES) throw new EditError(413, 'La portada no puede pasar de 1 MB.');
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.length > MAX_COVER_BYTES) throw new EditError(413, 'La portada no puede pasar de 1 MB.');
  if (!isJpeg(bytes)) throw new EditError(400, 'El archivo no es un JPEG válido.');
  return { id, bytes };
}

export function jsonResponse(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}

/**
 * Atiende una petición de /api/editar. token: el de GitHub (vacío si falta: responde 500). saveCover({ id, bytes,
 * github }) guarda la portada y devuelve los campos extra de la respuesta (o nada).
 */
export async function handleEditRequest(request, { token, fetchImpl, saveCover }) {
  try {
    if (request.method !== 'POST' && request.method !== 'GET') throw new EditError(405, 'Solo se admiten POST y GET.');
    const number = request.method === 'GET' ? issueNumberFrom(request.url) : null;
    const type = (request.headers.get('content-type') ?? '').toLowerCase();
    const isCover = request.method === 'POST' && type.startsWith('image/');
    // Una portada guardada sin GitHub (Worker) no necesita el token.
    const needsToken = !(isCover && saveCover.withoutToken === true);
    if (needsToken && !token) {
      console.error('editar: falta la variable de entorno GITHUB_TOKEN');
      throw new EditError(500, 'La edición no está configurada en el servidor (falta GITHUB_TOKEN). Avisa a quien mantiene la web.');
    }
    const github = githubClient(token, fetchImpl);
    if (request.method === 'GET') {
      return jsonResponse(200, { ok: true, incidencia: number, estado: await issueState(github, number) });
    }
    if (isCover) {
      const { id, bytes } = await readCover(request);
      const extra = (await saveCover({ id, bytes, github })) ?? {};
      return jsonResponse(200, { ok: true, mensaje: DONE_MESSAGE, ...extra });
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
    return jsonResponse(200, { ok: true, incidencia: issue.number, etiquetada: issue.labeled, mensaje: DONE_MESSAGE });
  } catch (error) {
    if (error instanceof EditError) return jsonResponse(error.status, { ok: false, error: error.message });
    console.error('editar: fallo inesperado', error?.name ?? 'Error');
    return jsonResponse(500, { ok: false, error: 'No se ha podido guardar el cambio. Inténtalo de nuevo.' });
  }
}
