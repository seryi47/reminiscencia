// Servidor estático para las pruebas de extremo a extremo.
// Sirve frontend/web (la raíz de Vercel) con node:http, sin dependencias externas.
// Admite sustituciones por ruta (por ejemplo, un catálogo de prueba ficticio en data/songs.json).
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

function sendText(response, status, text, method) {
  response.writeHead(status, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
  response.end(method === "HEAD" ? undefined : text);
}

function sendBody(response, body, type, method) {
  response.writeHead(200, {
    "Content-Type": type,
    "Content-Length": body.length,
    "Cache-Control": "no-store",
  });
  response.end(method === "HEAD" ? undefined : body);
}

/**
 * Arranca el servidor en un puerto libre de 127.0.0.1.
 * overrides: Map de ruta (por ejemplo "/data/songs.json") a { body, type } o a { file, type }.
 * Devuelve { url, port, close() }.
 */
export async function startStaticServer({ root = WEB_ROOT, overrides = new Map() } = {}) {
  const absoluteRoot = resolve(root);
  const rootInfo = await stat(absoluteRoot).catch(() => null);
  if (!rootInfo?.isDirectory()) {
    throw new Error(`No existe la raíz que se debe servir: ${absoluteRoot}`);
  }

  const server = createServer(async (request, response) => {
    try {
      const { pathname } = new URL(request.url ?? "/", "http://127.0.0.1");
      const decoded = decodeURIComponent(pathname);

      const override = overrides.get(decoded);
      if (override) {
        if (override.file && !(await isFile(override.file))) {
          return sendText(response, 404, "No encontrado", request.method);
        }
        const body = override.file ? await readFile(override.file) : Buffer.from(override.body ?? "", "utf8");
        return sendBody(response, body, override.type ?? mimeTypeOf(decoded), request.method);
      }

      const file = await resolveInside(absoluteRoot, decoded);
      if (!file) {
        return sendText(response, 404, "No encontrado", request.method);
      }
      return sendBody(response, await readFile(file), mimeTypeOf(file), request.method);
    } catch (error) {
      return sendText(response, 500, `Error del servidor de pruebas: ${error.message}`, request.method);
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
