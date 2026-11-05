// Pruebas de la política de contenido y del marcado de la web pública (frontend/web).
// Ejecución: node --test "tests/web-unit/*.test.mjs" (desde la raíz del repositorio).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AUDIO_ORIGIN } from "../../frontend/web/js/offline-core.js";

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
    // Además de la propia web, solo el bucket de audio de R2 (lo pide el service worker y lo reproduce el elemento audio; ADR-0020).
    assert.deepEqual(directives.get("connect-src"), ["'self'", AUDIO_ORIGIN]);
    assert.deepEqual(directives.get("frame-ancestors"), ["'none'"]);
    // Solo el reproductor incrustado de YouTube sin cookies (buscador, ADR-0021).
    assert.deepEqual(directives.get("frame-src"), ["https://www.youtube-nocookie.com"]);
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

describe("vercel.json: tipo de los ficheros de audio", () => {
  it("sirve los .opus como audio/ogg con codecs=opus, el tipo que reproduce el navegador", () => {
    const config = JSON.parse(read("vercel.json"));
    const rule = config.headers.find((item) => item.source === "/audio/(.*)\\.opus");
    const header = rule?.headers.find((item) => item.key === "Content-Type");
    assert.equal(header?.value, "audio/ogg; codecs=opus");
  });
});

describe("index.html: sin scripts en línea ni atributos de evento", () => {
  it("todo el JavaScript de la página viene de ficheros propios", () => {
    const html = read("index.html");
    assert.deepEqual(html.match(/<script(?![^>]*\ssrc=)[^>]*>/gi) ?? [], []);
    assert.deepEqual(html.match(/\son[a-z]+\s*=/gi) ?? [], []);
  });
});
