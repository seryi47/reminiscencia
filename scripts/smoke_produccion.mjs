/**
 * Comprobador de producción de Reminiscencia: tras cada cambio en main, verifica la web
 * pública (páginas, datos, tipos de contenido, audio y privacidad).
 *
 * Uso: node scripts/smoke_produccion.mjs [url] [--concurrencia=N] [--catalogo=ruta]
 *   url: por defecto, https://reminiscencia.vercel.app
 *   --concurrencia=N: cuántos audios se piden a la vez (por defecto 6; 1 = de uno en uno). Antes iban todos a la vez
 *     y r2.dev, con su límite de velocidad, cortaba algunos (UND_ERR_CONNECT_TIMEOUT).
 *   --catalogo=ruta: catálogo con el que se calcula la privacidad (por defecto audio-library/indexes/catalog.json;
 *     lo usan las pruebas, tests/web-unit/smoke-produccion.test.mjs, contra un servidor local).
 *
 * El audio (/audio/<id>.opus) lo redirige vercel.json al Worker (ADR-0031), que lo lee del bucket público: las
 * canciones públicas dan 200 con audio/ogg; codecs=opus y las privadas 404 (no están en el bucket público). Además se
 * comprueba un rango (206 con Content-Range, para poder buscar dentro del tema) y se informa de cuántos audios ha
 * servido el Worker (cabecera X-Reminiscencia-Api) y cuántos otro sitio (r2.dev si la redirección aún va allí).
 *
 * Sin dependencias: Node 22 con fetch global y node:fs. Imprime una línea OK o FALLO por
 * comprobación y sale con código 1 si alguna falla. La privacidad se calcula con
 * audio-library/indexes/catalog.json del propio checkout: antes de ejecutarlo, poner main al
 * día con origin/main (git fetch origin).
 */

import { readFileSync } from 'node:fs';

const DEFAULT_URL = 'https://reminiscencia.vercel.app';
const TIMEOUT_MS = 20_000;

// Marcas fijas de frontend/web/index.html (interfaz sin usuarios con el aspecto de Spotify, ADR-0015).
const HTML_MARKS = [
  'data-testid="sidebar"',
  'data-testid="nav-buscar"',
  '<script type="module" src="js/app.js"></script>',
  '<title>Reminiscencia</title>',
];
// Scripts de módulo locales que referencia ese mismo index.html.
const MODULE_SCRIPTS = ['js/app.js'];
const JSON_FILES = ['data/songs.json', 'data/folders.json', 'data/catalog.json'];
const MANIFEST = 'manifest.webmanifest';
const CATALOG_PATH = new URL('../audio-library/indexes/catalog.json', import.meta.url);

const DEFAULT_CONCURRENCY = 6;
const WORKER_HEADER = 'x-reminiscencia-api';

/** Lee los argumentos: la URL (posicional) y las opciones --concurrencia=N y --catalogo=ruta. */
function parseArgs(argv) {
  const options = { url: DEFAULT_URL, concurrency: DEFAULT_CONCURRENCY, catalog: CATALOG_PATH, errors: [] };
  for (const arg of argv) {
    const match = /^--(concurrencia|catalogo)=(.*)$/.exec(arg);
    if (match?.[1] === 'concurrencia') {
      const value = Number(match[2]);
      if (Number.isInteger(value) && value >= 1 && value <= 64) options.concurrency = value;
      else options.errors.push(`--concurrencia debe ser un entero entre 1 y 64 (${match[2]})`);
    } else if (match?.[1] === 'catalogo') {
      options.catalog = match[2];
    } else if (arg.startsWith('--')) {
      options.errors.push(`opción desconocida: ${arg}`);
    } else {
      options.url = arg;
    }
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));
const base = options.url.replace(/\/+$/, '');
const urlOf = (path) => new URL(path, `${base}/`).href;

let total = 0;
let failed = 0;

function report(ok, text) {
  total += 1;
  if (!ok) failed += 1;
  console.log(`${ok ? 'OK   ' : 'FALLO'} ${text}`);
}

const mediaType = (contentType) => contentType.split(';')[0].trim().toLowerCase();
const isOpus = (contentType) =>
  mediaType(contentType) === 'audio/ogg' && /codecs="?opus"?/i.test(contentType);
// fetch envuelve el fallo: el motivo real (ECONNREFUSED, bad port...) va en la causa.
const networkError = (error) => {
  const cause = error.cause?.errors?.[0] ?? error.cause;
  const detail = cause?.code ?? (cause?.message || error.message);
  return `error de red (${detail})`;
};

// Descarga completa; para el HTML, los JSON y el JavaScript, que son pequeños.
async function load(path) {
  try {
    const res = await fetch(urlOf(path), { signal: AbortSignal.timeout(TIMEOUT_MS) });
    return {
      status: res.status,
      contentType: res.headers.get('content-type') ?? '',
      text: await res.text(),
    };
  } catch (error) {
    return { error: networkError(error) };
  }
}

// Solo cabeceras: cancela el cuerpo, porque los audios pesan megabytes. Un fallo de red se reintenta una vez.
async function probe(path, headers = {}) {
  let last;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const res = await fetch(urlOf(path), { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
      await res.body?.cancel().catch(() => {});
      return {
        status: res.status,
        contentType: res.headers.get('content-type') ?? '',
        contentRange: res.headers.get('content-range'),
        worker: res.headers.has(WORKER_HEADER),
        host: (() => { try { return new URL(res.url).host; } catch { return ''; } })(),
      };
    } catch (error) {
      last = { error: networkError(error) };
    }
  }
  return last;
}

// Como Promise.all(items.map(task)), pero con como mucho `limit` tareas a la vez.
async function mapLimited(items, limit, task) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await task(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function checkStatus(prefix, res, expected, hint = `esperado ${expected}`) {
  if (res.error) return report(false, `${prefix}: ${res.error}`);
  const ok = res.status === expected;
  report(ok, `${prefix}: HTTP ${res.status}${ok ? '' : ` (${hint})`}`);
}

function checkType(prefix, res, accepts, expected) {
  if (res.error) return report(false, `${prefix}: ${res.error}`);
  const ok = accepts(res.contentType);
  report(ok, `${prefix}: ${res.contentType}${ok ? '' : ` (esperado ${expected})`}`);
}

// Devuelve el JSON descargado o el motivo por el que no se puede leer.
function parseJson(res) {
  if (res.error) return { error: res.error };
  if (res.status !== 200) return { error: `HTTP ${res.status}` };
  try {
    return { value: JSON.parse(res.text) };
  } catch (error) {
    return { error: `JSON no válido (${error.message})` };
  }
}

async function main() {
  if (options.errors.length > 0) {
    for (const error of options.errors) console.log(`FALLO ${error}`);
    process.exitCode = 1;
    return;
  }
  try {
    new URL(base);
  } catch {
    console.log(`FALLO URL no válida: ${base}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Comprobando ${base} (audio de ${options.concurrency} en ${options.concurrency})`);

  // Página, datos, manifiesto y scripts de módulo, en paralelo.
  const paths = ['', ...JSON_FILES, MANIFEST, ...MODULE_SCRIPTS];
  const responses = new Map(
    await Promise.all(paths.map(async (path) => [path, await load(path)])),
  );

  // 1. HTTP 200.
  for (const path of paths) checkStatus(`[1] /${path}`, responses.get(path), 200);

  // 2. Tipos de contenido: JSON como application/json y JavaScript.
  for (const path of JSON_FILES) {
    checkType(
      `[2] /${path}`,
      responses.get(path),
      (type) => mediaType(type) === 'application/json',
      'application/json',
    );
  }
  for (const path of MODULE_SCRIPTS) {
    checkType(
      `[2] /${path}`,
      responses.get(path),
      (type) => mediaType(type).includes('javascript'),
      'javascript',
    );
  }

  // 3. Marcas fijas de la interfaz nueva en el HTML de /.
  const home = responses.get('');
  for (const mark of HTML_MARKS) {
    if (home.error) {
      report(false, `[3] marca ${mark}: ${home.error}`);
    } else {
      const ok = home.text.includes(mark);
      report(ok, `[3] / contiene ${mark}${ok ? '' : ' (no aparece en el HTML)'}`);
    }
  }

  // Canciones públicas (data/songs.json) y no públicas (audio-library, origin/main).
  const songs = parseJson(responses.get('data/songs.json'));
  const publicIds = Array.isArray(songs.value) ? songs.value.map((song) => song?.id) : [];
  let privateIds = [];
  let privacyError = null;
  try {
    const localCatalog = JSON.parse(readFileSync(options.catalog, 'utf8'));
    if (!Array.isArray(localCatalog.songs)) throw new Error('no tiene la lista songs');
    // Sin public true se trata como no pública: ante la duda, no debe haber audio.
    privateIds = localCatalog.songs
      .filter((song) => song?.public !== true)
      .map((song) => song?.id);
  } catch (error) {
    privacyError = error.message;
  }

  // Audio de todas las canciones que se comprueban, con concurrencia limitada (--concurrencia).
  const audioIds = [...new Set([...publicIds, ...privateIds])];
  const audio = new Map(
    await mapLimited(audioIds, options.concurrency, async (id) => [
      id,
      await probe(`audio/${encodeURIComponent(id)}.opus`),
    ]),
  );

  // 2 (audio). Tipo de contenido del audio: audio/ogg con codecs=opus.
  for (const id of publicIds) {
    checkType(`[2] /audio/${id}.opus`, audio.get(id), isOpus, 'audio/ogg; codecs=opus');
  }

  // 4. Cada canción de data/songs.json tiene su audio con HTTP 200.
  if (songs.error) {
    report(false, `[4] no se pudo leer data/songs.json: ${songs.error}`);
  } else if (publicIds.length === 0) {
    report(false, '[4] data/songs.json no tiene canciones');
  }
  for (const id of publicIds) checkStatus(`[4] /audio/${id}.opus`, audio.get(id), 200);

  // 4b. Rangos: la primera canción pública responde 206 a un tramo (el reproductor lo necesita para buscar).
  if (publicIds.length > 0) {
    const id = publicIds[0];
    const ranged = await probe(`audio/${encodeURIComponent(id)}.opus`, { Range: 'bytes=0-1' });
    if (ranged.error) {
      report(false, `[4] /audio/${id}.opus con Range: ${ranged.error}`);
    } else {
      const ok = ranged.status === 206 && /^bytes 0-1\/\d+$/.test(ranged.contentRange ?? '');
      report(ok, `[4] /audio/${id}.opus con Range bytes=0-1: HTTP ${ranged.status}${ranged.contentRange ? `, ${ranged.contentRange}` : ''}${ok ? '' : ' (esperado 206 con Content-Range)'}`);
    }
  }

  // Informativo (no cuenta como comprobación): quién ha servido el audio.
  const served = [...audio.values()].filter((res) => !res.error);
  const byWorker = served.filter((res) => res.worker).length;
  const others = [...new Set(served.filter((res) => !res.worker).map((res) => res.host))];
  console.log(`INFO  audio servido por el Worker: ${byWorker} de ${served.length}${others.length ? `; por otros: ${others.join(', ')}` : ''}`);

  // 5. Privacidad: una canción no pública no puede tener audio publicado.
  if (privacyError) {
    report(false, `[5] no se pudo leer audio-library/indexes/catalog.json: ${privacyError}`);
  } else if (privateIds.length === 0) {
    report(true, '[5] audio-library no tiene canciones no públicas');
  }
  for (const id of privateIds) {
    checkStatus(
      `[5] /audio/${id}.opus (no pública)`,
      audio.get(id),
      404,
      'esperado 404: el audio no debe estar publicado',
    );
  }

  // 6. data/catalog.json solo lista canciones con public true.
  const dataCatalog = parseJson(responses.get('data/catalog.json'));
  if (dataCatalog.error) {
    report(false, `[6] data/catalog.json: ${dataCatalog.error}`);
  } else if (!Array.isArray(dataCatalog.value?.songs)) {
    report(false, '[6] data/catalog.json no tiene la lista songs');
  } else {
    const songsListed = dataCatalog.value.songs;
    const notPublic = songsListed
      .filter((song) => song?.public !== true)
      .map((song) => song?.id ?? '(sin id)');
    const detail =
      notPublic.length === 0 ? 'todas con public true' : `sin public true: ${notPublic.join(', ')}`;
    report(
      notPublic.length === 0,
      `[6] data/catalog.json: ${songsListed.length} canciones, ${detail}`,
    );
  }

  console.log(`Resultado: ${total - failed} OK, ${failed} FALLO (${total} comprobaciones)`);
  process.exitCode = failed > 0 ? 1 : 0;
}

main().catch((error) => {
  console.log(`FALLO inesperado: ${error.message}`);
  process.exitCode = 1;
});
