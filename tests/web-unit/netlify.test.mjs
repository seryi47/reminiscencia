// Pruebas de la copia de la web en Netlify (ADR-0037) y del reparto de YouTube con failover (ADR-0038): netlify.toml,
// las funciones de Netlify (search/playlist) y la lista de upstreams del Worker.
// Ejecución: node --test "tests/web-unit/*.test.mjs" (desde la raíz del repositorio).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { WORKER_API_BASE, normalizeApiBase } from "../../frontend/web/js/api-config.js";
import { isAllowedOrigin, DEFAULT_YOUTUBE_UPSTREAMS, WEB_ORIGIN, NETLIFY_ORIGIN } from "../../worker/src/index.js";
import { YOUTUBE_MARK_HEADER } from "../../frontend/web/server/youtube-mark.js";

const SITE = normalizeApiBase(WORKER_API_BASE);

const netlify = readFileSync(new URL("../../netlify.toml", import.meta.url), "utf8");
const wrangler = readFileSync(new URL("../../worker/wrangler.toml", import.meta.url), "utf8");
const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

/** Valor de una clave de texto (`clave = "valor"`) de un bloque TOML, con las comillas escapadas resueltas. */
function stringValue(block, key) {
  const match = new RegExp(`^\\s*${key} = "((?:[^"\\\\]|\\\\.)*)"\\s*$`, "m").exec(block);
  return match ? JSON.parse(`"${match[1]}"`) : undefined;
}

function buildBlock() {
  return /^\[build\]\n((?:(?!\[).*\n?)*)/m.exec(netlify)?.[1] ?? "";
}

function functionsBlock() {
  return /^\[functions\]\n((?:(?!\[).*\n?)*)/m.exec(netlify)?.[1] ?? "";
}

function redirects() {
  return netlify.split(/^\[\[redirects\]\]\n/m).slice(1).map((block) => ({
    from: stringValue(block, "from"),
    to: stringValue(block, "to"),
    status: Number(/^\s*status = (\d+)\s*$/m.exec(block)?.[1]),
    force: /^\s*force = true\s*$/m.test(block),
  }));
}

describe("netlify.toml: shell y reparto de YouTube (ADR-0037, ADR-0038)", () => {
  it("publica frontend/web con la misma lista de exclusiones que Cloudflare, sin datos ni portadas", () => {
    const command = stringValue(buildBlock(), "command");
    assert.equal(stringValue(buildBlock(), "publish"), "netlify-dist");
    assert.match(command, /--exclude-from=frontend\/web\/\.assetsignore/);
    assert.match(command, /--exclude=\/data /);
    assert.match(command, /--exclude=\/covers /);
    assert.match(command, / frontend\/web\/ netlify-dist\/$/);
  });

  it("despliega si cambia el shell, las funciones o su núcleo (server); no por data/covers/api", () => {
    const ignore = stringValue(buildBlock(), "ignore");
    assert.match(ignore, /^\[ "\$CACHED_COMMIT_REF" != "\$COMMIT_REF" \] && git diff --quiet /);
    // El shell, las funciones y, al no excluirlo, su núcleo frontend/web/server entran en la comparación.
    assert.match(ignore, / -- netlify\.toml netlify\/functions frontend\/web /);
    for (const folder of ["data", "covers", "api"]) {
      assert.ok(ignore.includes(`':(exclude)frontend/web/${folder}'`), `falta excluir frontend/web/${folder}`);
    }
    // server YA NO se excluye: las funciones de Netlify importan frontend/web/server/youtube-*.js.
    assert.ok(!ignore.includes("':(exclude)frontend/web/server'"), "server no debe excluirse: lo usan las funciones");
  });

  it("ejecuta search y playlist como funciones de Netlify con esbuild y youtube-dl-exec externo", () => {
    const block = functionsBlock();
    assert.ok(block, "falta el bloque [functions]");
    assert.equal(stringValue(block, "directory"), "netlify/functions");
    assert.equal(stringValue(block, "node_bundler"), "esbuild");
    assert.match(block, /external_node_modules = \[\s*"youtube-dl-exec"\s*\]/);
  });

  it("convert, status y download se redirigen al Worker (los ejecuta él); search/playlist NO se redirigen", () => {
    const rules = redirects();
    const find = (from) => rules.find((rule) => rule.from === from);
    // Datos, portadas y audio, como antes.
    for (const [from, status] of [["/data/*", 200], ["/covers/*", 200], ["/audio/*", 307]]) {
      const rule = find(from);
      assert.ok(rule, `falta la regla de ${from}`);
      assert.equal(rule.to, `${SITE}${from.slice(0, -1)}:splat`);
      assert.equal(rule.status, status);
      assert.ok(rule.force);
    }
    // Los tres proxies puros van al Worker, a su ruta exacta (sin comodín).
    for (const name of ["convert", "status", "download"]) {
      const rule = find(`/api/youtube/${name}`);
      assert.ok(rule, `falta la redirección de /api/youtube/${name}`);
      assert.equal(rule.to, `${SITE}/api/youtube/${name}`);
      assert.equal(rule.status, 200);
      assert.ok(rule.force);
    }
    // search y playlist NO se redirigen (los sirve la función de Netlify); y no queda el comodín que haría bucle.
    assert.equal(find("/api/youtube/search"), undefined);
    assert.equal(find("/api/youtube/playlist"), undefined);
    assert.equal(find("/api/youtube/*"), undefined);
    // El audio nunca se sirve con 200 por Netlify, y el resto del API va directo al Worker con CORS.
    assert.equal(rules.filter((rule) => rule.to.includes("/audio/") && rule.status === 200).length, 0);
    assert.equal(find("/api/*"), undefined);
  });
});

describe("Funciones de Netlify de YouTube (ADR-0038)", () => {
  for (const name of ["search", "playlist"]) {
    it(`youtube-${name}.mjs: ruta /api/youtube/${name}, núcleo compartido y cabecera-marca`, () => {
      const source = read(`../../netlify/functions/youtube-${name}.mjs`);
      assert.match(source, new RegExp(`config = \\{ path: '/api/youtube/${name}' \\}`));
      assert.match(source, new RegExp(`handle${name === "search" ? "Search" : "Playlist"}`));
      assert.match(source, /import \{ markYoutube \} from '\.\.\/\.\.\/frontend\/web\/server\/youtube-mark\.js'/);
      assert.match(source, /export default async function/);
    });
  }

  it("el nombre de la cabecera-marca es el que lee el Worker", () => {
    assert.equal(YOUTUBE_MARK_HEADER, "X-Reminiscencia-Youtube");
  });
});

describe("Worker: upstreams de YouTube y CORS de Netlify (ADR-0037, ADR-0038)", () => {
  it("wrangler.toml añade el origen de Netlify en ALLOWED_ORIGINS", () => {
    const value = /^ALLOWED_ORIGINS = "([^"]*)"$/m.exec(wrangler)?.[1];
    assert.ok(value !== undefined, "falta ALLOWED_ORIGINS en wrangler.toml");
    const env = { ALLOWED_ORIGINS: value };
    assert.ok(isAllowedOrigin(NETLIFY_ORIGIN, env));
    // Solo ese origen: ni otras webs de Netlify ni las vistas previas de ramas.
    assert.ok(!isAllowedOrigin("https://otra.netlify.app", env));
    assert.ok(!isAllowedOrigin("https://feature-x--reminiscencia.netlify.app", env));
    // Y nunca localhost en producción.
    assert.ok(!isAllowedOrigin("http://localhost:8080", env));
  });

  it("wrangler.toml fija YOUTUBE_UPSTREAMS con Vercel primero y Netlify de respaldo", () => {
    const value = /^YOUTUBE_UPSTREAMS = "([^"]*)"$/m.exec(wrangler)?.[1];
    assert.ok(value !== undefined, "falta YOUTUBE_UPSTREAMS en wrangler.toml");
    const list = value.split(",").map((item) => item.trim());
    assert.deepEqual(list, [WEB_ORIGIN, NETLIFY_ORIGIN]);
    // El valor del fichero coincide con el valor por defecto del código.
    assert.deepEqual(list, [...DEFAULT_YOUTUBE_UPSTREAMS]);
  });
});
