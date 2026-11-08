// Pruebas de la política de contenido y del marcado de la web pública (frontend/web).
// Ejecución: node --test "tests/web-unit/*.test.mjs" (desde la raíz del repositorio).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { AUDIO_ORIGIN, WORKER_AUDIO_ORIGIN } from "../../frontend/web/js/offline-core.js";
import { normalizeApiBase, WORKER_API_BASE } from "../../frontend/web/js/api-config.js";

const WORKERS_DEV = "https://*.workers.dev";
/** La web en Cloudflare (ADR-0034): el mismo origen que el Worker en su dominio propio. */
const SITE = "https://reminiscencia.cometia.es";

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
    // El audio: el Worker (ADR-0031; WORKER_API_BASE de js/api-config.js) y r2.dev de respaldo (ADR-0020).
    assert.deepEqual(directives.get("media-src"), ["'self'", AUDIO_ORIGIN, ...(WORKER_AUDIO_ORIGIN ? [WORKER_AUDIO_ORIGIN] : [])]);
    // Además de la propia web, el bucket de R2 (audio, ADR-0020; índice de portadas, ADR-0029), el Worker del API en
    // workers.dev (ADR-0029) y en su dominio propio (ADR-0034: la web de Vercel lo llama con CORS).
    assert.deepEqual(directives.get("connect-src"), ["'self'", AUDIO_ORIGIN, WORKERS_DEV, SITE]);
    // Las portadas del índice se sirven desde el bucket público.
    assert.deepEqual(directives.get("img-src"), ["'self'", "data:", AUDIO_ORIGIN]);
    assert.deepEqual(directives.get("frame-ancestors"), ["'none'"]);
    // Solo el reproductor incrustado de YouTube sin cookies (buscador, ADR-0021).
    assert.deepEqual(directives.get("frame-src"), ["https://www.youtube-nocookie.com"]);
  });

  it("la dirección del Worker configurada en js/api-config.js está permitida en connect-src y media-src", () => {
    const config = JSON.parse(read("vercel.json"));
    const header = config.headers.find((item) => item.source === "/(.*)").headers.find((item) => item.key === "Content-Security-Policy");
    const directives = directivesOf(header.value);
    const permits = (directive, origin) => directives.get(directive).some((source) => {
      if (source === origin) return true;
      const wildcard = /^https:\/\/\*\.(.+)$/.exec(source);
      return Boolean(wildcard) && origin.startsWith("https://") && origin.endsWith(`.${wildcard[1]}`) && !origin.slice(8, -wildcard[1].length - 1).includes("/");
    });
    const base = normalizeApiBase(WORKER_API_BASE);
    // El origen del audio sale de la misma constante: no hay una segunda copia de la dirección en js/.
    assert.equal(WORKER_AUDIO_ORIGIN, base);
    if (base !== "") {
      assert.ok(permits("connect-src", base), `connect-src no permite ${base}: añádelo a vercel.json`);
      assert.ok(permits("media-src", base), `media-src no permite ${base}: añádelo a vercel.json (audio por el Worker, ADR-0031)`);
    }
    // r2.dev sigue admitido: es el respaldo del audio.
    assert.ok(permits("media-src", AUDIO_ORIGIN));
    assert.ok(permits("connect-src", AUDIO_ORIGIN));
    // La forma de la dirección que da Cloudflare al desplegar sí está permitida; otra cualquiera, no.
    assert.ok(permits("connect-src", "https://reminiscencia-api.mi-cuenta.workers.dev"));
    assert.ok(!permits("connect-src", "https://reminiscencia-api.example.com"));
    assert.ok(!permits("media-src", "https://otro-worker.mi-cuenta.workers.dev"), "media-src admite solo el Worker exacto, sin comodín");
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

describe("_headers: la misma CSP en Cloudflare (ADR-0034)", () => {
  /** Reglas de un fichero _headers de Cloudflare: una ruta sin sangría y debajo sus cabeceras con sangría. */
  function parseHeadersFile(text) {
    const rules = [];
    for (const line of text.split("\n")) {
      if (line.trim() === "" || line.trim().startsWith("#")) continue;
      if (!/^\s/.test(line)) {
        rules.push({ path: line.trim(), headers: {} });
        continue;
      }
      const index = line.indexOf(":");
      assert.ok(rules.length > 0 && index > 0, `línea no válida en _headers: ${line}`);
      rules.at(-1).headers[line.slice(0, index).trim()] = line.slice(index + 1).trim();
    }
    return rules;
  }

  it("aplica a todas las rutas la misma política que vercel.json", () => {
    const rules = parseHeadersFile(read("_headers"));
    assert.deepEqual(rules.map((rule) => rule.path), ["/*"]);
    const config = JSON.parse(read("vercel.json"));
    const vercel = config.headers.find((item) => item.source === "/(.*)").headers.find((item) => item.key === "Content-Security-Policy");
    assert.equal(rules[0].headers["Content-Security-Policy"], vercel.value);
  });

  it("en el dominio propio, el API y el audio son el propio origen", () => {
    assert.equal(normalizeApiBase(WORKER_API_BASE), SITE);
    assert.equal(WORKER_AUDIO_ORIGIN, SITE);
  });
});

describe("Cloudflare: solo se publica la web estática (ADR-0034)", () => {
  const wrangler = readFileSync(new URL("../../worker/wrangler.toml", import.meta.url), "utf8");

  it("wrangler.toml sirve frontend/web con el Worker delante solo de /api/* y /audio/*, en el dominio propio", () => {
    const assets = /^\[assets\]\n((?:[^\[\n].*\n?)*)/m.exec(wrangler)?.[1] ?? "";
    assert.match(assets, /^directory = "\.\.\/frontend\/web"$/m);
    assert.match(assets, /^binding = "ASSETS"$/m);
    assert.match(assets, /^run_worker_first = \["\/api\/\*", "\/audio\/\*"\]$/m);
    assert.match(wrangler, /^routes = \[\{ pattern = "reminiscencia\.cometia\.es", custom_domain = true \}\]$/m);
    // workers.dev sigue activo: las APK ya instaladas usan esa dirección.
    assert.match(wrangler, /^workers_dev = true$/m);
  });

  it(".assetsignore deja fuera las funciones de Vercel, su código de servidor y la configuración de Node", () => {
    const ignored = read(".assetsignore").split("\n").map((line) => line.trim()).filter((line) => line && !line.startsWith("#"));
    for (const entry of ["api", "server", "node_modules", "package.json", "package-lock.json", "vercel.json"]) {
      assert.ok(ignored.includes(entry), `falta ${entry} en .assetsignore`);
    }
    // Nada de lo que la web necesita queda fuera.
    for (const entry of ["index.html", "sw.js", "manifest.webmanifest", "js", "css", "fonts", "icons", "data", "covers", "_headers"]) {
      assert.ok(!ignored.includes(entry), `${entry} no debe estar en .assetsignore`);
    }
  });
});

describe("vercel.json: audio por el Worker (ADR-0031) con R2 de respaldo", () => {
  it("redirige /audio/<id>.opus al Worker (o a r2.dev si no hay Worker), de forma temporal", () => {
    const config = JSON.parse(read("vercel.json"));
    const rule = config.redirects?.find((item) => item.source === "/audio/:file");
    assert.ok(rule, "falta la redirección del audio");
    // El destino coincide con WORKER_API_BASE de js/api-config.js: si cambia la dirección del Worker, hay que
    // cambiarla también aquí (vercel.json no puede importar JavaScript).
    assert.equal(rule.destination, `${WORKER_AUDIO_ORIGIN || AUDIO_ORIGIN}/audio/:file`);
    // Temporal (307): si el Worker o R2 cambian de dirección, los navegadores no se quedan con la vieja.
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
