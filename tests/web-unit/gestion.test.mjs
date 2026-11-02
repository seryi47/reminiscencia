// Pruebas estáticas de la sección «Gestionar» (frontend/web/js/gestion.js) contra su marcado (index.html).
// No se carga el DOM: se comprueba que cada elemento que el script consulta existe en la página.
// Ejecución: node --test "tests/web-unit/*.test.mjs" (desde la raíz del repositorio).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const WEB = new URL("../../frontend/web/", import.meta.url);
const read = (path) => readFileSync(new URL(path, WEB), "utf8");

describe("gestion.js: los elementos que consulta existen en index.html", () => {
  it("cada id que el script busca con $(\"...\") está en la página", () => {
    const script = read("js/gestion.js");
    const html = read("index.html");
    const ids = [...new Set([...script.matchAll(/\$\("([^"]+)"\)/g)].map((match) => match[1]))];
    assert.ok(ids.length >= 20, `solo se encontraron ${ids.length} ids en gestion.js`);
    for (const id of ids) {
      assert.ok(html.includes(`id="${id}"`), `falta id="${id}" en index.html`);
    }
  });

  it("no inserta HTML a partir de cadenas: solo textContent, createElement y replaceChildren", () => {
    const script = read("js/gestion.js");
    assert.equal(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(/.test(script), false);
  });
});

describe("gestion.js: fuentes de datos", () => {
  it("lee las carpetas que la rama publica en data/folders.json", () => {
    assert.ok(existsSync(new URL("data/folders.json", WEB)));
  });

  it("si existe el workflow de la biblioteca, la web tiene su lista de canciones en data/catalog.json", {
    skip: !existsSync(new URL("../../.github/workflows/biblioteca.yml", import.meta.url))
      && "esta rama no trae biblioteca.yml: la lista la genera feat/gestion-backend",
  }, () => {
    assert.ok(existsSync(new URL("data/catalog.json", WEB)), "falta data/catalog.json (lo genera sonidos.publish)");
  });
});
