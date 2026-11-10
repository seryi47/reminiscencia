// Pruebas de la copia de la web en Netlify (ADR-0037): netlify.toml y el origen admitido por el Worker.
// Ejecución: node --test "tests/web-unit/*.test.mjs" (desde la raíz del repositorio).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { WORKER_API_BASE, normalizeApiBase } from "../../frontend/web/js/api-config.js";
import { isAllowedOrigin } from "../../worker/src/index.js";

const NETLIFY_ORIGIN = "https://reminiscencia.netlify.app";
const SITE = normalizeApiBase(WORKER_API_BASE);

const netlify = readFileSync(new URL("../../netlify.toml", import.meta.url), "utf8");
const wrangler = readFileSync(new URL("../../worker/wrangler.toml", import.meta.url), "utf8");

/** Valor de una clave de texto (`clave = "valor"`) de un bloque TOML, con las comillas escapadas resueltas. */
function stringValue(block, key) {
  const match = new RegExp(`^\\s*${key} = "((?:[^"\\\\]|\\\\.)*)"\\s*$`, "m").exec(block);
  return match ? JSON.parse(`"${match[1]}"`) : undefined;
}

function buildBlock() {
  return /^\[build\]\n((?:(?!\[).*\n?)*)/m.exec(netlify)?.[1] ?? "";
}

function redirects() {
  return netlify.split(/^\[\[redirects\]\]\n/m).slice(1).map((block) => ({
    from: stringValue(block, "from"),
    to: stringValue(block, "to"),
    status: Number(/^\s*status = (\d+)\s*$/m.exec(block)?.[1]),
    force: /^\s*force = true\s*$/m.test(block),
  }));
}

describe("netlify.toml: la web estática, con el resto en el Worker (ADR-0037)", () => {
  it("publica frontend/web con la misma lista de exclusiones que Cloudflare, sin datos ni portadas", () => {
    const command = stringValue(buildBlock(), "command");
    assert.equal(stringValue(buildBlock(), "publish"), "netlify-dist");
    assert.match(command, /--exclude-from=frontend\/web\/\.assetsignore/);
    assert.match(command, /--exclude=\/data /);
    assert.match(command, /--exclude=\/covers /);
    assert.match(command, / frontend\/web\/ netlify-dist\/$/);
    // Sin funciones de Netlify: las de Vercel quedan fuera (.assetsignore) y el API es el Worker.
    assert.doesNotMatch(netlify, /^\[functions\]/m);
  });

  it("solo despliega si cambia el código de la web (los commits del buzón solo tocan data/ y covers/)", () => {
    const ignore = stringValue(buildBlock(), "ignore");
    assert.match(ignore, /^\[ "\$CACHED_COMMIT_REF" != "\$COMMIT_REF" \] && git diff --quiet /);
    assert.match(ignore, / -- netlify\.toml frontend\/web /);
    for (const folder of ["data", "covers", "api", "server"]) {
      assert.ok(ignore.includes(`':(exclude)frontend/web/${folder}'`), `falta excluir frontend/web/${folder}`);
    }
  });

  it("datos, portadas y YouTube se piden al Worker en el mismo origen; el audio se redirige", () => {
    const rules = redirects();
    const find = (from) => rules.find((rule) => rule.from === from);
    for (const [from, status] of [["/data/*", 200], ["/covers/*", 200], ["/api/youtube/*", 200], ["/audio/*", 307]]) {
      const rule = find(from);
      assert.ok(rule, `falta la regla de ${from}`);
      assert.equal(rule.to, `${SITE}${from.slice(0, -1)}:splat`, `${from} debe ir a WORKER_API_BASE`);
      assert.equal(rule.status, status, `${from}: estado ${status}`);
      assert.ok(rule.force, `${from} debe tener force = true`);
    }
    // El audio nunca pasa por Netlify (gastaría su ancho de banda): solo una redirección temporal, como vercel.json.
    assert.equal(rules.filter((rule) => rule.to.includes("/audio/") && rule.status === 200).length, 0);
    // El resto del API no se reenvía: la web lo llama directamente en el Worker, con CORS.
    assert.equal(find("/api/*"), undefined);
  });
});

describe("Worker: admite la copia de Netlify con CORS (ADR-0037)", () => {
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
});
