// Función de Vercel POST y GET /api/editar (ADR-0022 y ADR-0027): cambia textos, álbumes y portadas de la biblioteca
// sin que quien edita pase por GitHub. Node, sin dependencias. Lo usan la web y la APK (también las APK antiguas); no
// cambiar el contrato sin cambiar los dos. El contrato y la validación están en ../server/edit-core.js, compartido con
// el Worker de Cloudflare (ADR-0029). Lo propio de Vercel: la portada se guarda en
// audio-library/buzon/portadas/<ID>.jpg con un commit en main y el workflow buzon la recorta y la publica.
//
// El token solo sale de process.env.GITHUB_TOKEN (permisos Contents e Issues en escritura) y nunca va a registros ni
// respuestas.

import { BRANCH, COVERS_DIRECTORY, EditError, expect, handleEditRequest } from '../server/edit-core.js';

export {
  ALLOWED_OPS,
  BRANCH,
  COVERS_DIRECTORY,
  coverId,
  DONE_MESSAGE,
  EDIT_STATES,
  EditError,
  editStateOf,
  ERROR_LABEL,
  isJpeg,
  issueNumberFrom,
  MAX_COVER_BYTES,
  organizeProblem,
  REPOSITORY,
} from '../server/edit-core.js';

async function storeCover({ github, id, bytes }) {
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

/** Atiende una petición. env y fetchImpl se inyectan en las pruebas (tests/web-unit/api-editar.test.mjs). */
export function handleEdit(request, { env = {}, fetchImpl = globalThis.fetch } = {}) {
  const token = typeof env.GITHUB_TOKEN === 'string' ? env.GITHUB_TOKEN.trim() : '';
  return handleEditRequest(request, { token, fetchImpl, saveCover: storeCover });
}

/** Puntos de entrada de Vercel (firma web: Request → Response). */
export function POST(request) {
  return handleEdit(request, { env: process.env, fetchImpl: globalThis.fetch });
}

export function GET(request) {
  return handleEdit(request, { env: process.env, fetchImpl: globalThis.fetch });
}
