// Pruebas de la política de contenido y del marcado de la web pública (frontend/web).
// Ejecución: node --test "tests/web-unit/*.test.mjs" (desde la raíz del repositorio).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { AUDIO_ORIGIN } from "../../frontend/web/js/offline-core.js";
import { normalizeApiBase, WORKER_API_BASE } from "../../frontend/web/js/api-config.js";

const WORKERS_DEV = "https://*.workers.dev";

const WEB = new URL("../../frontend/web/", import.meta.url);
const read = (path) => readFileSync(new URL(path, WEB), "utf8");

function directivesOf(policy) {
  const directives = new Map();
  for (const part of policy.split(";")) {
    const [name, ...values] = part.trim().split(/\s+/);
    if (name) directives.set(name, values);
  }
  return directives;
}

describe("vercel.json: Content-Security-Policy", () => {
  it("se aplica a todas las rutas y limita los recursos a la propia web", () => {
    const config = JSON.parse(read("vercel.json"));
    const rule = config.headers.find((item) => item.source === "/(.*)");
    const header = rule?.headers.find((item) => item.key === "Content-Security-Policy");
    assert.ok(header, "falta la cabecera Content-Security-Policy");
    const directives = directivesOf(header.value);
    assert.deepEqual(directives.get("default-src"), ["'self'"]);
    assert.deepEqual(directives.get("script-src"), ["'self'"]);
    assert.deepEqual(directives.get("object-src"), ["'none'"]);
    assert.deepEqual(directives.get("media-src"), ["'self'", AUDIO_ORIGIN]);
    // Además de la propia web, el bucket de R2 (audio, ADR-0020; índice de portadas, ADR-0029) y el Worker del API en
    // workers.dev (ADR-0029; su subdominio exacto se conoce al desplegarlo).
    assert.deepEqual(directives.get("connect-src"), ["'self'", AUDIO_ORIGIN, WORKERS_DEV]);
    // Las portadas del índice se sirven desde el bucket público.
    assert.deepEqual(directives.get("img-src"), ["'self'", "data:", AUDIO_ORIGIN]);
    assert.deepEqual(directives.get("frame-ancestors"), ["'none'"]);
    // Solo el reproductor incrustado de YouTube sin cookies (buscador, ADR-0021).
    assert.deepEqual(directives.get("frame-src"), ["https://www.youtube-nocookie.com"]);
  });

  it("la dirección del Worker configurada en js/api-config.js está permitida en connect-src", () => {
    const config = JSON.parse(read("vercel.json"));
    const header = config.headers.find((item) => item.source === "/(.*)").headers.find((item) => item.key === "Content-Security-Policy");
    const allowed = directivesOf(header.value).get("connect-src");
    const permits = (origin) => allowed.some((source) => {
      if (source === origin) return true;
      const wildcard = /^https:\/\/\*\.(.+)$/.exec(source);
      return Boolean(wildcard) && origin.startsWith("https://") && origin.endsWith(`.${wildcard[1]}`) && !origin.slice(8, -wildcard[1].length - 1).includes("/");
    });
    const base = normalizeApiBase(WORKER_API_BASE);
    if (base !== "") assert.ok(permits(base), `connect-src no permite ${base}: añádelo a vercel.json`);
    // La forma de la dirección que da Cloudflare al desplegar sí está permitida; otra cualquiera, no.
    assert.ok(permits("https://reminiscencia-api.mi-cuenta.workers.dev"));
    assert.ok(!permits("https://reminiscencia-api.example.com"));
  });

  it("permite el favicon en data: y no admite eval ni scripts en línea", () => {
    const config = JSON.parse(read("vercel.json"));
    const header = config.headers.find((item) => item.source === "/(.*)").headers.find((item) => item.key === "Content-Security-Policy");
    const directives = directivesOf(header.value);
    assert.ok(directives.get("img-src").includes("data:"));
    assert.equal(header.value.includes("unsafe-eval"), false);
    assert.equal(directives.get("script-src").includes("'unsafe-inline'"), false);
  });
});

describe("vercel.json: audio en R2", () => {
  it("redirige /audio/<id>.opus al bucket de R2, de forma temporal (ADR-0020, fase 3)", () => {
    const config = JSON.parse(read("vercel.json"));
    const rule = config.redirects?.find((item) => item.source === "/audio/:file");
    assert.ok(rule, "falta la redirección del audio");
    assert.equal(rule.destination, `${AUDIO_ORIGIN}/audio/:file`);
    // Temporal (307): si R2 cambia de dominio, los navegadores no se quedan con la dirección vieja.
    assert.equal(rule.permanent, false);
  });

  it("la web ya no publica ficheros de audio: solo los sirve R2", () => {
    const folder = new URL("audio/", WEB);
    const opus = existsSync(folder) ? readdirSync(folder).filter((name) => name.endsWith(".opus")) : [];
    assert.deepEqual(opus, []);
  });
});

describe("index.html: sin scripts en línea ni atributos de evento", () => {
  it("todo el JavaScript de la página viene de ficheros propios", () => {
    const html = read("index.html");
    assert.deepEqual(html.match(/<script(?![^>]*\ssrc=)[^>]*>/gi) ?? [], []);
    assert.deepEqual(html.match(/\son[a-z]+\s*=/gi) ?? [], []);
  });
});
