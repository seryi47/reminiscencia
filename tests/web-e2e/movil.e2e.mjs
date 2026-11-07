// Descargas sin conexión y hoja «Subir canciones» en anchos de teléfono (ADR-0033): sin desbordamiento horizontal,
// nada tapado por la barra inferior ni el minirreproductor, progreso que avanza sin saltar ni mover la página, descarga
// que sigue al cambiar de pantalla y tras recargar sin bajar otra vez lo guardado, cancelar, y filas de subida que
// usan todo el ancho. Catálogo ficticio; el audio de prueba tarda AUDIO_DELAY_MS en servirse para ver el progreso.
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { createTestCatalogOverrides } from "./helpers/catalogo-prueba.mjs";
import { clickTestid, TEST_TIMEOUT_MS, textOf, waitVisible } from "./helpers/elementos.mjs";
import { goSection, openApp, openCollection, openUpload } from "./helpers/flujos.mjs";
import { capture, launchBrowser, withPage } from "./helpers/navegador.mjs";
import { startStaticServer } from "./helpers/servidor.mjs";

const AUDIO_DELAY_MS = 600;
const ALBUM_A = "#/album/F0000000000000001";
const ALBUM_B = "#/album/F0000000000000002";
const LONG = "Concierto para piano y orquesta n.º 21 en do mayor K. 467 - II. Andante (grabación histórica de 1958 restaurada)";
const TELEFONOS = [["360", { width: 360, height: 740 }], ["390", { width: 390, height: 844 }]];

let server;
let browser;
// Descargas completas de cada audio (sin cabecera Range: las de reproducir sí la llevan).
const descargas = new Map();

// /api/subir simulada y lenta: así se ven «Subiendo…», «Esperando para subir» y «En cola» a la vez.
async function slowUpload({ headers }) {
  const name = decodeURIComponent(headers["x-nombre-archivo"] ?? "");
  const index = Number(headers["x-parte"]);
  const total = Number(headers["x-partes"]);
  await new Promise((resolve) => setTimeout(resolve, 3000));
  const complete = index === total - 1;
  return { json: { ok: true, parte: index, partes: total, completa: complete, repetido: false, nombre: complete ? `${name.replace(/\.[^.]*$/, "")}.opus` : null, mensaje: "Subida." } };
}

before(async () => {
  const overrides = createTestCatalogOverrides();
  for (const [path, value] of overrides) {
    if (path.startsWith("/audio/")) overrides.set(path, { ...value, delayMs: AUDIO_DELAY_MS });
  }
  server = await startStaticServer({
    overrides,
    functions: new Map([["/api/subir", slowUpload]]),
    onRequest: (path, request) => {
      if (path.startsWith("/audio/") && request.method === "GET" && !request.headers.range) descargas.set(path, (descargas.get(path) ?? 0) + 1);
    },
  });
  browser = await launchBrowser();
});

after(async () => {
  await browser?.close();
  await server?.close();
});

const prueba = (nombre, fn) => it(nombre, { timeout: TEST_TIMEOUT_MS }, fn);
const songPath = (n) => `/audio/S${String(n).padStart(16, "0")}.opus`;

/** Lo que se sale por los lados de la ventana (o del diálogo abierto), salvo los estantes que se desplazan solos. */
function overflowing(page) {
  return page.evaluate(() => {
    const out = [];
    const doc = document.documentElement.scrollWidth - document.documentElement.clientWidth;
    if (doc > 0) out.push(`documento +${doc}px`);
    const dialog = document.querySelector("dialog[open]");
    const right = dialog ? dialog.getBoundingClientRect().right : document.documentElement.clientWidth;
    const left = dialog ? dialog.getBoundingClientRect().left : 0;
    for (const el of document.querySelectorAll(dialog ? "dialog[open] *" : "#view *")) {
      if (el.closest(".shelf-row, .chips, .library-chips, .track-table, .sr-only")) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || getComputedStyle(el).visibility === "hidden") continue;
      if (rect.right > right + 1 || rect.left < left - 1) out.push(`${el.dataset.testid || el.className || el.tagName} ${Math.round(rect.left)}→${Math.round(rect.right)}`);
    }
    return [...new Set(out)];
  });
}

/** Botones de la barra de acciones que se pisan entre sí. */
function overlappingActions(page) {
  return page.evaluate(() => {
    const rects = [...document.querySelectorAll('[data-testid="action-bar"] > button')]
      .filter((el) => window.__e2eIsShown(el))
      .map((el) => ({ id: el.dataset.testid, rect: el.getBoundingClientRect() }));
    const out = [];
    for (let i = 0; i < rects.length; i += 1) {
      for (let j = i + 1; j < rects.length; j += 1) {
        const a = rects[i].rect;
        const b = rects[j].rect;
        if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) out.push(`${rects[i].id}×${rects[j].id}`);
      }
    }
    return out;
  });
}

/** Suena la primera canción de la tabla (por DOM: en 740 px de alto la fila puede quedar bajo la barra inferior). */
async function playFirst(page) {
  await page.$eval('[data-testid="track-title"]', (title) => title.click());
  await page.waitForFunction(() => !document.getElementById("audio").paused, { timeout: 10000 });
  await waitVisible(page, "mini-player", { context: "minirreproductor" });
}

/** Apunta cada texto distinto de «Descargando n de N» que se ve. */
async function recordStatus(page) {
  await page.evaluate(() => {
    window.__descargas = [];
    new MutationObserver(() => {
      const text = document.querySelector('[data-testid="collection-download-status"]')?.textContent ?? "";
      if (text && window.__descargas.at(-1) !== text) window.__descargas.push(text);
    }).observe(document.getElementById("view"), { subtree: true, childList: true, characterData: true, attributes: true });
  });
}

const cachedSongs = (page) => page.evaluate(async () => {
  const cache = await caches.open("reminiscencia-audio-v1");
  return (await cache.keys()).map((request) => new URL(request.url).pathname).sort();
});

const downloadLabel = (page) => page.$eval('[data-testid="collection-download"]', (button) => button.getAttribute("aria-label"));

describe("Teléfono: descargar para escuchar sin conexión (ADR-0033)", () => {
  for (const [ancho, viewport] of TELEFONOS) {
    prueba(`Barra de acciones sin desbordar ni pisarse; progreso «n de 8» que avanza sin mover la página y sigue al cambiar de pantalla (${ancho} px)`, () =>
      withPage(browser, viewport, async (page) => {
        descargas.clear();
        await openApp(page, server.url);
        await openCollection(page, ALBUM_A);
        await playFirst(page);
        await page.$eval('[data-testid="main"]', (main) => { main.scrollTop = 0; });
        assert.deepEqual(await overflowing(page), [], "nada se sale por los lados");
        assert.deepEqual(await overlappingActions(page), [], "los botones no se pisan");
        const meta = await page.$eval('[data-testid="collection-meta"] .meta-nowrap', (node) => node.getClientRects().length);
        assert.equal(meta, 1, "«8 canciones, 19 min 16 s» va en una sola línea");

        await recordStatus(page);
        const filterTop = () => page.$eval('[data-testid="collection-filter"]', (input) => input.getBoundingClientRect().top);
        const before = await filterTop();
        await clickTestid(page, "collection-download", "Descargar");
        await page.waitForFunction(() => /^Descargando [1-7] de 8/.test(document.querySelector('[data-testid="collection-download-status"]')?.textContent ?? ""), { timeout: 10000 });
        assert.match(await downloadLabel(page), /^Cancelar la descarga \(\d de 8\)$/);
        assert.equal(await filterTop(), before, "la línea de progreso no empuja la tabla");
        assert.deepEqual(await overflowing(page), [], "tampoco mientras descarga");
        await capture(page, `movil-${ancho}-descargando`);

        // A otra pantalla y de vuelta: la descarga sigue y se ve.
        await goSection(page, "inicio", viewport);
        await openCollection(page, ALBUM_A);
        const label = await downloadLabel(page);
        assert.ok(/^Cancelar la descarga/.test(label) || label === "Quitar la descarga", `al volver: ${label}`);
        await page.waitForFunction(() => document.querySelector('[data-testid="collection-download"]')?.getAttribute("aria-pressed") === "true", { timeout: 30000 });
        await page.waitForFunction(() => document.querySelector('[data-testid="toast"]')?.textContent === "Descargada. Ya se puede escuchar sin conexión.", { timeout: 10000 });
        assert.equal(await isHidden(page, "collection-download-status"), true, "al terminar, la línea se va");

        const seen = await page.evaluate(() => window.__descargas ?? []);
        const counts = seen.map((text) => Number(/^Descargando (\d+) de 8/.exec(text)?.[1] ?? -1));
        assert.deepEqual(counts, [...counts].sort((a, b) => a - b), `el progreso no retrocede: ${seen.join(" | ")}`);
        assert.equal((await cachedSongs(page)).length, 8);
        for (let n = 1; n <= 8; n += 1) assert.equal(descargas.get(songPath(n)), 1, `${songPath(n)} se baja una sola vez`);

        // Nada queda bajo el minirreproductor ni la barra inferior al llegar al final.
        const covered = await page.evaluate(() => {
          const main = document.getElementById("main");
          main.scrollTop = main.scrollHeight;
          const top = Math.min(...["mini-player", "tabbar"].map((id) => document.querySelector(`[data-testid="${id}"]`).getBoundingClientRect().top));
          const last = [...document.querySelectorAll("#view button, #view a, #view input")].filter((el) => window.__e2eIsShown(el)).at(-1);
          return { bottom: last.getBoundingClientRect().bottom, top };
        });
        assert.ok(covered.bottom <= covered.top + 1, `lo último (${covered.bottom}) queda por encima de las barras (${covered.top})`);
      }),
    );
  }

  prueba("Cancelar deja lo guardado; volver a pulsar no baja otra vez lo guardado; tras recargar sigue donde se quedó (390 px)", () =>
    withPage(browser, TELEFONOS[1][1], async (page) => {
      descargas.clear();
      await openApp(page, server.url);
      await openCollection(page, ALBUM_B);
      await clickTestid(page, "collection-download", "Descargar");
      await page.waitForFunction(() => /^Descargando [4-7] de 8/.test(document.querySelector('[data-testid="collection-download-status"]')?.textContent ?? ""), { timeout: 15000 });
      // Pulsar otra vez cancela (antes, el botón no respondía mientras descargaba).
      await clickTestid(page, "collection-download", "Cancelar");
      await page.waitForFunction(() => document.querySelector('[data-testid="toast"]')?.textContent?.startsWith("Se ha cancelado la descarga."), { timeout: 10000 });
      assert.equal(await downloadLabel(page), "Descargar para escuchar sin conexión");
      const kept = await cachedSongs(page);
      assert.ok(kept.length >= 4 && kept.length < 8, `lo ya guardado se queda: ${kept.length}`);

      // Otra vez: solo lo que falta. Y a mitad, se recarga la página.
      await clickTestid(page, "collection-download", "Descargar");
      await page.waitForFunction(() => /^Cancelar la descarga/.test(document.querySelector('[data-testid="collection-download"]')?.getAttribute("aria-label") ?? ""), { timeout: 5000 });
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForSelector('html[data-ready="true"]', { timeout: 15000 });
      await openCollection(page, ALBUM_B);
      await page.waitForFunction(() => document.querySelector('[data-testid="collection-download"]')?.getAttribute("aria-pressed") === "true", { timeout: 30000 });
      assert.equal((await cachedSongs(page)).length, 8);
      for (const path of kept) assert.equal(descargas.get(path), 1, `${path}, guardada antes de cancelar, no se vuelve a bajar`);
      for (let n = 9; n <= 16; n += 1) assert.ok((descargas.get(songPath(n)) ?? 0) <= 3, `${songPath(n)}: ${descargas.get(songPath(n))} veces`);
    }),
  );
});

async function isHidden(page, testid) {
  return page.$eval(`[data-testid="${testid}"]`, (node) => !window.__e2eIsShown(node)).catch(() => true);
}

function wav(seconds) {
  const rate = 48000;
  const samples = Math.round(rate * seconds);
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + samples * 2, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i += 1) buffer.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 12000), 44 + i * 2);
  return buffer;
}

describe("Teléfono: hoja «Subir canciones» (ADR-0033)", () => {
  prueba("Filas sin desbordar, «Reintentar» bajo el texto, barra con su hueco, «Esperando para subir» y aviso en Tu biblioteca al cerrar (360 px)", () =>
    withPage(browser, TELEFONOS[0][1], async (page) => {
      // Subidas de antes: publicándose, pendiente de aparecer y con error (nombres y error largos).
      await page.evaluateOnNewDocument((long) => {
        const now = Date.now();
        localStorage.setItem("reminiscencia.subidas", JSON.stringify({ version: 1, items: [
          { key: "k1", name: `${long}.wav`, title: long, state: "publicandose", localId: "L0000000000000001", savedAt: now, knownIds: [], createdAt: now },
          { key: "k2", name: "Vals de las olas.mp3", title: "Vals de las olas", state: "tarde", localId: "L0000000000000002", savedAt: now - 11 * 60000, knownIds: [], createdAt: now },
          { key: "k3", name: `${long} (otra toma).flac`, title: `${long} (otra toma)`, state: "error", error: "El archivo no es Ogg Opus. Comprueba que el archivo no está dañado y vuelve a intentarlo.", localId: "L0000000000000003", createdAt: now },
        ] }));
      }, LONG);
      await openApp(page, server.url);
      await openUpload(page, TELEFONOS[0][1]);
      const soporte = await textOf(page, "upload-support").catch(() => "");
      assert.equal(soporte, "", `Este Chrome no convierte a Opus: ${soporte}`);
      const dir = await mkdtemp(join(tmpdir(), "reminiscencia-movil-"));
      const files = [];
      for (const name of [`${LONG} parte 1.wav`, "Corta.wav", "Bolero.wav", "Pasodoble.wav"]) {
        const path = join(dir, name);
        await writeFile(path, wav(2));
        files.push(path);
      }
      await (await page.$('[data-testid="upload-file-input"]')).uploadFile(...files);
      // Dos se envían, la tercera ya convertida espera su turno y la cuarta, en cola.
      await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="upload-item-status"]')].some((node) => node.textContent === "Esperando para subir"), { timeout: 30000 });
      assert.deepEqual(await overflowing(page), [], "nada se sale de la hoja");

      const layout = await page.evaluate(() => {
        const rows = [...document.querySelectorAll('[data-testid="upload-item"]')];
        const row = (state) => rows.find((node) => node.dataset.state === state);
        const error = row("error");
        const retry = error.querySelector('[data-testid="upload-item-retry"]').getBoundingClientRect();
        const status = error.querySelector('[data-testid="upload-item-status"]').getBoundingClientRect();
        const name = error.querySelector('[data-testid="upload-item-name"]').getBoundingClientRect();
        const queued = row("cola");
        const bar = queued?.querySelector('[data-testid="upload-item-progress"]');
        const body = document.querySelector("dialog[open] .dialog-body").getBoundingClientRect();
        const firstNew = rows.find((node) => node.querySelector('[data-testid="upload-item-name"]').textContent.endsWith("parte 1.wav")).getBoundingClientRect();
        return {
          retryBelow: retry.top >= status.bottom - 1,
          nameWidth: name.width,
          rowWidth: error.getBoundingClientRect().width,
          queuedBar: bar ? { height: bar.getBoundingClientRect().height, visibility: getComputedStyle(bar).visibility } : null,
          firstNewVisible: firstNew.top < body.bottom && firstNew.bottom > body.top,
          medidas: [firstNew.top, firstNew.bottom, body.top, body.bottom, document.querySelector("dialog[open] .dialog-body").scrollTop],
        };
      });
      assert.equal(layout.retryBelow, true, "«Reintentar» va debajo del error, no en una columna al lado");
      assert.ok(layout.nameWidth > layout.rowWidth * 0.6, `el nombre usa casi todo el ancho (${layout.nameWidth} de ${layout.rowWidth})`);
      if (layout.queuedBar) assert.deepEqual(layout.queuedBar, { height: 4, visibility: "hidden" }, "en cola la barra no se ve pero guarda su hueco");
      assert.equal(layout.firstNewVisible, true, `tras elegir, la primera subida nueva queda a la vista (fila, hoja y desplazamiento: ${JSON.stringify(layout.medidas)})`);
      await capture(page, "movil-360-subidas");

      // Al cerrar la hoja, Tu biblioteca del teléfono dice cuántas se están publicando y la vuelve a abrir.
      await clickTestid(page, "upload-sheet-close", "Cerrar la hoja");
      await waitVisible(page, "library-page-uploads", { context: "aviso de subidas en Tu biblioteca" });
      assert.match(await textOf(page, "library-page-uploads"), /^Publicándose \d+ canciones?$/);
      assert.deepEqual(await overflowing(page), []);
      await clickTestid(page, "library-page-uploads", "aviso de subidas");
      await waitVisible(page, "upload-sheet", { context: "hoja Subir canciones" });
    }),
  );
});
