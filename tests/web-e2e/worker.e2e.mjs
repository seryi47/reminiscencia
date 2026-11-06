// Pruebas de extremo a extremo con el Worker de Cloudflare (ADR-0029): la web servida con WORKER_API_BASE apuntando al
// Worker simulado (código real de worker/src/index.js en otro origen, con R2 en memoria; helpers/worker.mjs) sube por
// él, cambia portadas al momento (bucket público + índice) y las confirma en segundos, lee el índice al abrir y, si el
// Worker no responde, vuelve a las funciones de Vercel simuladas. Las imágenes y el índice del bucket público
// (pub-….r2.dev) se sirven desde el bucket simulado interceptando las peticiones del navegador.
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { crc32, deflateSync } from "node:zlib";

import { createTestCatalogOverrides } from "./helpers/catalogo-prueba.mjs";
import { clickTestid, TEST_TIMEOUT_MS, textOf, waitVisible } from "./helpers/elementos.mjs";
import { openApp, openCollection, openUpload, saveEdit } from "./helpers/flujos.mjs";
import { launchBrowser, VIEWPORTS, withPage } from "./helpers/navegador.mjs";
import { startStaticServer } from "./helpers/servidor.mjs";
import { apiConfigOverride, startFakeWorker } from "./helpers/worker.mjs";
import { AUDIO_ORIGIN } from "../../frontend/web/js/offline-core.js";
import { COVER_INDEX_KEY, parseCoverIndex } from "../../frontend/web/js/cover-index.js";

const ALBUM_A = "F0000000000000001";
const FOLDER_A = `#/album/${ALBUM_A}`;
const prueba = (nombre, fn) => it(nombre, { timeout: TEST_TIMEOUT_MS }, fn);

let server;
let worker;
let browser;
// Funciones de Vercel simuladas (el respaldo): solo registran lo que les llega.
const vercel = [];
async function fakeVercel({ method, headers, body }) {
  vercel.push({ method, type: headers["content-type"] ?? "", id: headers["x-portada-id"] ?? null, bytes: body.length });
  if (method === "GET") return { json: { ok: true, incidencia: 1, estado: "abierta" } };
  return { json: { ok: true, mensaje: "Guardado: llegará a todos en un par de minutos.", parte: 0, partes: 1, completa: true, repetido: false, nombre: "x.opus" } };
}
fakeVercel.acceptsGet = true;

before(async () => {
  worker = await startFakeWorker();
  const overrides = createTestCatalogOverrides();
  overrides.set("/js/api-config.js", apiConfigOverride(worker.url));
  server = await startStaticServer({
    overrides,
    functions: new Map([["/api/subir", fakeVercel], ["/api/editar", fakeVercel]]),
    extraConnectSrc: [worker.url],
  });
  browser = await launchBrowser();
});

after(async () => {
  await browser?.close();
  await server?.close();
  await worker?.close();
});

/** El bucket público de R2 (pub-….r2.dev) lo sirve el bucket simulado del Worker, con CORS como el real. */
async function serveBucket(page) {
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    if (!request.url().startsWith(`${AUDIO_ORIGIN}/`)) return request.continue();
    const key = decodeURIComponent(new URL(request.url()).pathname.slice(1));
    const entry = worker.publicBucket.objects.get(key);
    if (!entry) return request.respond({ status: 404, headers: { "Access-Control-Allow-Origin": "*" }, body: "" });
    return request.respond({
      status: 200,
      contentType: entry.httpMetadata.contentType ?? "application/octet-stream",
      headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": entry.httpMetadata.cacheControl ?? "no-store" },
      body: Buffer.from(entry.bytes),
    });
  });
}

// PNG RGB de width × height de un solo color (la foto elegida para la portada).
function pngImage(width, height, [r, g, b]) {
  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.writeUInt8(8, 8);
  header.writeUInt8(2, 9);
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x += 1) row.set([r, g, b], 1 + x * 3);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

function wavTone(seconds = 1) {
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

async function tempFile(name, bytes) {
  const dir = await mkdtemp(join(tmpdir(), "reminiscencia-e2e-"));
  const path = join(dir, name);
  await writeFile(path, bytes);
  return path;
}

const headerCoverSrc = (page) => page.$eval('[data-testid="collection-header"] .collection-cover img', (img) => img.src).catch(() => null);

async function changeAlbumCover(page, color) {
  await openCollection(page, FOLDER_A);
  await clickTestid(page, "collection-edit", "Editar detalles desde la portada");
  await waitVisible(page, "edit-album");
  await clickTestid(page, "edit-album-cover", "Cambiar portada");
  await waitVisible(page, "cover-sheet");
  await (await page.$('[data-testid="cover-file"]')).uploadFile(await tempFile("portada.png", pngImage(700, 500, color)));
  await saveEdit(page, "cover-save");
}

describe("Worker de Cloudflare (ADR-0029)", () => {
  prueba("Al abrir, el índice de portadas de R2 manda sobre la portada del catálogo", () =>
    withPage(browser, VIEWPORTS.escritorio, async (page) => {
      const key = `portadas/${ALBUM_A}-00000000000000aa.jpg`;
      worker.publicBucket.seed(key, new Uint8Array(pngImage(4, 4, [0, 0, 0])), { contentType: "image/png" });
      worker.publicBucket.seed(COVER_INDEX_KEY, JSON.stringify({ [ALBUM_A]: key }));
      try {
        await serveBucket(page);
        await openApp(page, server.url);
        await openCollection(page, FOLDER_A);
        await page.waitForFunction((src) => document.querySelector('[data-testid="collection-header"] .collection-cover img')?.src === src, { timeout: 8000 }, `${AUDIO_ORIGIN}/${key}`);
        assert.ok(worker.state.requests.includes("GET /api/portadas"), "El índice se lee por el Worker.");
      } finally {
        worker.publicBucket.objects.delete(COVER_INDEX_KEY);
      }
    }),
  );

  prueba("«Cambiar portada» va al Worker: bucket público e índice al momento, sin GitHub, y se confirma en segundos", () =>
    withPage(browser, VIEWPORTS.escritorio, async (page) => {
      vercel.length = 0;
      const githubBefore = worker.github.length;
      await serveBucket(page);
      await openApp(page, server.url);
      await changeAlbumCover(page, [200, 30, 30]);
      const index = parseCoverIndex(worker.publicBucket.text(COVER_INDEX_KEY));
      const key = index.get(ALBUM_A);
      assert.match(key, new RegExp(`^portadas/${ALBUM_A}-[0-9a-f]{16}\\.jpg$`));
      const image = worker.publicBucket.objects.get(key);
      assert.equal(image.httpMetadata.contentType, "image/jpeg");
      assert.deepEqual([image.bytes[0], image.bytes[1]], [0xff, 0xd8]);
      assert.equal(worker.github.length, githubBefore, "La portada no pasa por GitHub.");
      assert.equal(vercel.length, 0, "Con el Worker vivo no se usa Vercel.");
      // Pendiente al momento y confirmada en la primera revisión (3 s): el índice ya la refleja.
      await page.waitForFunction(() => document.querySelector('[data-testid="toast"]')?.textContent === "Ya está guardado: «Álbum de prueba A».", { timeout: 15000 });
      await page.waitForFunction(() => !document.querySelector('[data-testid="sidebar-edits"]'), { timeout: 5000 });
      await page.waitForFunction((src) => document.querySelector('[data-testid="collection-header"] .collection-cover img')?.src === src, { timeout: 5000 }, `${AUDIO_ORIGIN}/${key}`);
    }),
  );

  prueba("«Subir canciones» envía los trozos al Worker: bucket privado, manifiesto y aviso al workflow", () =>
    withPage(browser, VIEWPORTS.escritorio, async (page) => {
      vercel.length = 0;
      await openApp(page, server.url);
      await openUpload(page, VIEWPORTS.escritorio);
      const soporte = await textOf(page, "upload-support").catch(() => "");
      assert.equal(soporte, "", `Este Chrome no convierte a Opus: ${soporte}`);
      await (await page.$('[data-testid="upload-file-input"]')).uploadFile(await tempFile("Tono por el Worker.wav", wavTone(1.5)));
      await page.waitForFunction(() => {
        const rows = [...document.querySelectorAll('[data-testid="upload-item"]')];
        return rows.length === 1 && !["cola", "convirtiendo", "subiendo"].includes(rows[0].dataset.state);
      }, { timeout: 60000 });
      const manifests = [...worker.privateBucket.objects.keys()].filter((key) => key.endsWith("/manifiesto.json"));
      assert.equal(manifests.length, 1);
      assert.deepEqual(JSON.parse(worker.privateBucket.text(manifests[0])), { nombre: "Tono por el Worker.opus", partes: 1 });
      const id = manifests[0].split("/")[1];
      assert.ok(worker.privateBucket.objects.has(`entrada/${id}/0.part`));
      assert.ok(worker.github.some((call) => call.path.endsWith("/dispatches") && call.body?.client_payload?.id === id));
      assert.ok(worker.state.requests.includes("GET /api/salud"), "Antes de subir se pregunta al Worker.");
      assert.equal(vercel.length, 0);
    }),
  );

  prueba("Si el Worker no responde, la portada y la subida vuelven a Vercel", () =>
    withPage(browser, VIEWPORTS.escritorio, async (page) => {
      vercel.length = 0;
      worker.state.down = true;
      try {
        await openApp(page, server.url);
        await changeAlbumCover(page, [30, 30, 200]);
        assert.deepEqual(vercel.map(({ method, type, id }) => ({ method, type, id })), [{ method: "POST", type: "image/jpeg", id: ALBUM_A }]);
        await openUpload(page, VIEWPORTS.escritorio);
        await (await page.$('[data-testid="upload-file-input"]')).uploadFile(await tempFile("Tono por Vercel.wav", wavTone(1)));
        await page.waitForFunction(() => {
          const rows = [...document.querySelectorAll('[data-testid="upload-item"]')];
          return rows.length === 1 && !["cola", "convirtiendo", "subiendo"].includes(rows[0].dataset.state);
        }, { timeout: 60000 });
        assert.ok(vercel.some(({ method, type }) => method === "POST" && type === "audio/ogg"), JSON.stringify(vercel));
      } finally {
        worker.state.down = false;
      }
    }),
  );
});
