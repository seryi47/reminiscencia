// Worker de Cloudflare simulado para las pruebas de extremo a extremo (ADR-0029): el código real del Worker
// (worker/src/index.js, handleRequest) detrás de un servidor node:http en otro puerto de 127.0.0.1 (otro origen, como
// workers.dev: CORS de verdad), con los dos buckets de R2 en memoria (tests/web-unit/r2-falso.mjs) y GitHub simulado.
// La web lo usa sirviendo un js/api-config.js con WORKER_API_BASE apuntando aquí (apiConfigOverride).
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";

import { handleRequest } from "../../../worker/src/index.js";
import { fakeR2 } from "../../web-unit/r2-falso.mjs";
import { WEB_ROOT } from "./servidor.mjs";

async function readBody(request) {
  const parts = [];
  for await (const part of request) parts.push(part);
  return Buffer.concat(parts);
}

/**
 * Arranca el Worker simulado. Devuelve { url, port, privateBucket, publicBucket, github, close() }. github: las
 * llamadas que el Worker hizo a GitHub ({ method, path, body }). Con down = true responde como Cloudflare cuando el
 * Worker falla (500 en HTML, sin CORS ni cabecera del Worker).
 */
export async function startFakeWorker() {
  const privateBucket = fakeR2();
  const publicBucket = fakeR2();
  const github = [];
  let issue = 900;
  const fetchImpl = async (url, init = {}) => {
    const target = new URL(url);
    const body = typeof init.body === "string" ? JSON.parse(init.body) : null;
    github.push({ method: init.method ?? "GET", path: target.pathname, body });
    if (target.pathname.endsWith("/dispatches")) return new Response(null, { status: 204 });
    if (target.pathname.endsWith("/issues") && init.method === "POST") {
      issue += 1;
      return new Response(JSON.stringify({ number: issue, labels: [] }), { status: 201 });
    }
    const match = /\/issues\/(\d+)$/.exec(target.pathname);
    if (match) return new Response(JSON.stringify({ number: Number(match[1]), state: "open", body: "action: organize\npayload: {}", labels: [] }), { status: 200 });
    return new Response("{}", { status: 404 });
  };
  const env = { GITHUB_TOKEN: "token-de-prueba", PRIVATE_BUCKET: privateBucket, PUBLIC_BUCKET: publicBucket };
  const state = { down: false, requests: [] };
  const server = createServer(async (request, response) => {
    try {
      state.requests.push(`${request.method} ${request.url}`);
      if (state.down) {
        response.writeHead(500, { "Content-Type": "text/html" });
        return response.end("<html>Error 1101: Worker threw exception</html>");
      }
      const body = request.method === "GET" || request.method === "HEAD" || request.method === "OPTIONS" ? undefined : await readBody(request);
      const headers = new Headers();
      for (const [name, value] of Object.entries(request.headers)) if (typeof value === "string") headers.set(name, value);
      const reply = await handleRequest(new Request(`http://127.0.0.1${request.url}`, { method: request.method, headers, body }), env, { fetchImpl });
      const out = {};
      reply.headers.forEach((value, name) => { out[name] = value; });
      response.writeHead(reply.status, out);
      response.end(Buffer.from(await reply.arrayBuffer()));
    } catch (error) {
      response.writeHead(500, { "Content-Type": "text/plain" });
      response.end(`Error del Worker simulado: ${error.message}`);
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    port,
    privateBucket,
    publicBucket,
    github,
    state,
    close: () => new Promise((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    }),
  };
}

/** js/api-config.js de la web con WORKER_API_BASE = [base] (para startStaticServer({ overrides })). */
export function apiConfigOverride(base) {
  const source = readFileSync(join(WEB_ROOT, "js", "api-config.js"), "utf8");
  const replaced = source.replace(/^export const WORKER_API_BASE = '';$/m, `export const WORKER_API_BASE = '${base}';`);
  if (replaced === source) throw new Error("No se ha encontrado WORKER_API_BASE en js/api-config.js.");
  return { body: replaced, type: "text/javascript; charset=utf-8" };
}
