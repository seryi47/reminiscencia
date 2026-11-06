// Servidor estático para las pruebas de extremo a extremo.
// Sirve frontend/web (la raíz de Vercel) con node:http, sin dependencias externas, y con la misma política de
// contenido (CSP) que vercel.json, para que las pruebas fallen si la web carga algo que producción bloquearía.
// Admite sustituciones por ruta (por ejemplo, un catálogo de prueba ficticio en data/songs.json) y funciones simuladas
// (por ejemplo, POST /api/subir, la función de Vercel de ADR-0017, que aquí no llama a GitHub). El Worker de Cloudflare
// (ADR-0029) se simula aparte, en otro puerto, con su código real: helpers/worker.mjs.
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

/** Raíz de la web pública: frontend/web, tres niveles por encima de este fichero. */
export const WEB_ROOT = fileURLToPath(new URL("../../../frontend/web/", import.meta.url));

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".woff2": "font/woff2",
  ".png": "image/png",
  // Igual que vercel.json: Ogg con Opus.
  ".opus": "audio/ogg; codecs=opus",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
};

// Cabecera Content-Security-Policy de vercel.json (regla «/(.*)»).
function readCsp(root) {
  try {
    const config = JSON.parse(readFileSync(join(root, "vercel.json"), "utf8"));
    const rule = config.headers?.find((item) => item.source === "/(.*)");
    return rule?.headers?.find((item) => item.key === "Content-Security-Policy")?.value ?? null;
  } catch {
    return null;
  }
}

function mimeTypeOf(path) {
  return MIME_TYPES[extname(path).toLowerCase()] ?? "application/octet-stream";
}

async function isFile(path) {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

// Convierte una ruta URL en un fichero dentro de la raíz. Devuelve null si no existe
// o si la ruta intenta salir de la raíz.
async function resolveInside(root, pathname) {
  const relative = pathname.endsWith("/") ? `${pathname}index.html` : pathname;
  const candidate = resolve(root, `.${relative}`);
  if (candidate !== root && !candidate.startsWith(root + sep)) return null;
  try {
    const info = await stat(candidate);
    if (info.isDirectory()) {
      const index = join(candidate, "index.html");
      return (await isFile(index)) ? index : null;
    }
    return info.isFile() ? candidate : null;
  } catch {
    return null;
  }
}

function sendText(response, status, text, method, csp) {
  response.writeHead(status, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", ...(csp ? { "Content-Security-Policy": csp } : {}) });
  response.end(method === "HEAD" ? undefined : text);
}

// Con cabecera Range de un solo tramo responde 206, como Vercel: Chrome lo necesita para buscar dentro del audio.
function sendBody(request, response, body, type, csp) {
  const headers = { "Content-Type": type, "Cache-Control": "no-store", "Accept-Ranges": "bytes", ...(csp ? { "Content-Security-Policy": csp } : {}) };
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range ?? "");
  if (range && (range[1] !== "" || range[2] !== "")) {
    const size = body.length;
    const start = range[1] === "" ? Math.max(0, size - Number(range[2])) : Number(range[1]);
    const end = range[1] === "" || range[2] === "" ? size - 1 : Math.min(Number(range[2]), size - 1);
    if (start >= size || start > end) {
      response.writeHead(416, { ...headers, "Content-Range": `bytes */${size}` });
      response.end();
      return;
    }
    const part = body.subarray(start, end + 1);
    response.writeHead(206, { ...headers, "Content-Length": part.length, "Content-Range": `bytes ${start}-${end}/${size}` });
    response.end(request.method === "HEAD" ? undefined : part);
    return;
  }
  response.writeHead(200, { ...headers, "Content-Length": body.length });
  response.end(request.method === "HEAD" ? undefined : body);
}

async function readBody(request) {
  const parts = [];
  for await (const part of request) parts.push(part);
  return Buffer.concat(parts);
}

/**
 * Arranca el servidor en un puerto libre de 127.0.0.1.
 * overrides: Map de ruta (por ejemplo "/data/songs.json") a { body, type } o a { file, type }.
 * functions: Map de ruta (por ejemplo "/api/subir") a una función async ({ method, headers, body, query }) que devuelve
 * { status, json }: simula una función de Vercel para cualquier método que no sea GET ni HEAD. Si la función tiene
 * acceptsGet = true, también atiende GET (por ejemplo, GET /api/editar?incidencia=N; query es un URLSearchParams).
 * extraConnectSrc: orígenes que se añaden a connect-src de la CSP (por ejemplo, el Worker simulado de
 * helpers/worker.mjs, que escucha en otro puerto: otro origen, como el Worker real en workers.dev).
 * Devuelve { url, port, close() }.
 */
export async function startStaticServer({ root = WEB_ROOT, overrides = new Map(), functions = new Map(), extraConnectSrc = [] } = {}) {
  const absoluteRoot = resolve(root);
  const rootInfo = await stat(absoluteRoot).catch(() => null);
  if (!rootInfo?.isDirectory()) {
    throw new Error(`No existe la raíz que se debe servir: ${absoluteRoot}`);
  }

  const baseCsp = readCsp(absoluteRoot);
  const csp = baseCsp && extraConnectSrc.length > 0
    ? baseCsp.replace(/connect-src ([^;]*)/, (_, sources) => `connect-src ${sources} ${extraConnectSrc.join(" ")}`)
    : baseCsp;
  const server = createServer(async (request, response) => {
    try {
      const { pathname, searchParams } = new URL(request.url ?? "/", "http://127.0.0.1");
      const decoded = decodeURIComponent(pathname);

      const handler = functions.get(decoded);
      if (handler && ((request.method !== "GET" && request.method !== "HEAD") || (request.method === "GET" && handler.acceptsGet === true))) {
        const body = await readBody(request);
        const { status = 200, json = {} } = await handler({ method: request.method, headers: request.headers, body, query: searchParams });
        response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...(csp ? { "Content-Security-Policy": csp } : {}) });
        return response.end(JSON.stringify(json));
      }

      const override = overrides.get(decoded);
      if (override) {
        if (override.file && !(await isFile(override.file))) {
          return sendText(response, 404, "No encontrado", request.method, csp);
        }
        const body = override.file ? await readFile(override.file) : Buffer.from(override.body ?? "", "utf8");
        return sendBody(request, response, body, override.type ?? mimeTypeOf(decoded), csp);
      }

      const file = await resolveInside(absoluteRoot, decoded);
      if (!file) {
        return sendText(response, 404, "No encontrado", request.method, csp);
      }
      return sendBody(request, response, await readFile(file), mimeTypeOf(file), csp);
    } catch (error) {
      return sendText(response, 500, `Error del servidor de pruebas: ${error.message}`, request.method, csp);
    }
  });

  await new Promise((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise);
    server.listen(0, "127.0.0.1", () => resolvePromise());
  });

  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}/`,
    port,
    close: () =>
      new Promise((resolveClose) => {
        server.closeAllConnections();
        server.close(() => resolveClose());
      }),
  };
}
