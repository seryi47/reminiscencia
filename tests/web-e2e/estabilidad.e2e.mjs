// Estabilidad de la reproducción en la web: una red que se queda colgada a media canción (el vigilante de parones de
// js/player.js reintenta una vez y después avisa y pasa a la siguiente), una canción descargada que suena entera aunque
// la red de esa canción esté colgada (no se pide por la red) y una versión nueva del service worker con una canción
// cargada (no recarga la página: avisa con «Recargar»; sin nada cargado, sí recarga). Servidor local y catálogo ficticio.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, describe, it } from "node:test";
import { createTestCatalogOverrides, TEST_AUDIO_FILE } from "./helpers/catalogo-prueba.mjs";
import { TEST_TIMEOUT_MS, textOf } from "./helpers/elementos.mjs";
import { openApp, openCollection, playRow, waitServiceWorker } from "./helpers/flujos.mjs";
import { launchBrowser, VIEWPORTS, withPage } from "./helpers/navegador.mjs";
import { startStaticServer, WEB_ROOT } from "./helpers/servidor.mjs";

const ALBUM_A = "#/album/F0000000000000001";
const SONG_1 = "S0000000000000001";
const SONG_1_PATH = `/audio/${SONG_1}.opus`;
const AUDIO_TYPE = "audio/ogg; codecs=opus";
// Unos 5 de los 10 s del tono de prueba: la canción empieza a sonar y se queda sin datos a la mitad.
const HALF_SONG_BYTES = 8000;
const ERROR_NOTICE = "No se puede reproducir esta canción. Pasamos a la siguiente.";
const UPDATE_NOTICE = "Hay una versión nueva de Reminiscencia.";
const SW_SOURCE = readFileSync(`${WEB_ROOT}/sw.js`, "utf8");
const LONG_TEST_MS = Math.max(TEST_TIMEOUT_MS, 150_000);

// Anota en la página los eventos del elemento de audio que importan aquí (con el fichero de la fuente). En la fase de
// captura, para verlos antes que el reproductor (que con ended ya cambia la fuente a la siguiente canción).
const AUDIO_EVENTS_PROBE = `
  window.__e2eAudioEvents = [];
  document.addEventListener('DOMContentLoaded', () => {
    const audio = document.getElementById('audio');
    for (const type of ['loadstart', 'waiting', 'stalled', 'ended', 'error']) {
      audio.addEventListener(type, () => window.__e2eAudioEvents.push({ type, src: audio.src.split('/').pop(), t: audio.currentTime }), { capture: true });
    }
  });
`;

let server;
let browser;
let overrides;
const requests = new Map();

before(async () => {
  overrides = createTestCatalogOverrides();
  overrides.set("/sw.js", { body: SW_SOURCE, type: "text/javascript; charset=utf-8" });
  // El mismo audio por una ruta que no es de la biblioteca: para guardar la canción 1 en la caché sin pedirla por su ruta.
  overrides.set("/e2e/tono-prueba.opus", { file: TEST_AUDIO_FILE, type: AUDIO_TYPE });
  server = await startStaticServer({
    overrides,
    onRequest: (path) => requests.set(path, (requests.get(path) ?? 0) + 1),
  });
  browser = await launchBrowser();
});

after(async () => {
  await browser?.close();
  await server?.close();
});

const prueba = (nombre, fn) => it(nombre, { timeout: LONG_TEST_MS }, fn);
const audioEvents = (page) => page.evaluate(() => window.__e2eAudioEvents);
const playerTitleIs = (page, title, timeout = 10_000) =>
  page.waitForFunction((t) => document.querySelector('[data-testid="player-title"]')?.textContent === t, { timeout }, title);
const restoreSong1 = () => overrides.set(SONG_1_PATH, { file: TEST_AUDIO_FILE, type: AUDIO_TYPE });
const stallSong1 = () => overrides.set(SONG_1_PATH, { file: TEST_AUDIO_FILE, type: AUDIO_TYPE, stallAfterBytes: HALF_SONG_BYTES });

describe("red colgada a media canción", () => {
  prueba("reintenta una vez desde el mismo punto y después avisa y pasa a la siguiente", async () => {
    stallSong1();
    try {
      await withPage(browser, VIEWPORTS.escritorio, async (page) => {
        await page.evaluateOnNewDocument(AUDIO_EVENTS_PROBE);
        await openApp(page, server.url);
        await openCollection(page, ALBUM_A);
        await playRow(page, 0);
        assert.equal(await textOf(page, "player-title"), "Canción de prueba 01");
        const started = Date.now();
        // Sin el vigilante se quedaba así para siempre: sonando, sin avanzar y sin aviso.
        await page.waitForFunction((text) => document.querySelector('[data-testid="toast"]')?.textContent === text, { timeout: 70_000 }, ERROR_NOTICE);
        const waited = Date.now() - started;
        const events = await audioEvents(page);
        const loads = events.filter((event) => event.type === "loadstart" && event.src === `${SONG_1}.opus`);
        assert.equal(loads.length, 2, `la canción se carga y se vuelve a pedir una vez: ${JSON.stringify(events)}`);
        assert.ok(events.some((event) => event.src === `${SONG_1}.opus` && (event.type === "waiting" || event.type === "stalled")), "el elemento avisa de que espera datos");
        assert.ok(waited >= 25_000, `dos plazos del vigilante antes del aviso (${waited} ms)`);
        // Tras el aviso (ERROR_SKIP_MS), la siguiente suena.
        await playerTitleIs(page, "Canción de prueba 02", 15_000);
        await page.waitForFunction(() => !document.getElementById("audio").paused && document.getElementById("audio").currentTime > 0.2, { timeout: 15_000 });
      });
    } finally {
      restoreSong1();
    }
  });
});

describe("canción descargada con la red colgada", () => {
  prueba("suena entera desde la caché y no se pide por la red", async () => {
    try {
      await withPage(browser, VIEWPORTS.escritorio, async (page) => {
        await page.evaluateOnNewDocument(AUDIO_EVENTS_PROBE);
        await openApp(page, server.url);
        await waitServiceWorker(page);
        // Se guarda como lo hace la descarga real (downloadAudioToCache): la canción entera en la caché de audio.
        await page.evaluate(async (path) => {
          const response = await fetch("/e2e/tono-prueba.opus");
          const blob = await response.blob();
          const cache = await caches.open("reminiscencia-audio-v1");
          await cache.put(path, new Response(blob, { status: 200, headers: { "Content-Type": "audio/ogg", "Content-Length": String(blob.size) } }));
        }, SONG_1_PATH);
        // Desde aquí la red de esa canción se queda colgada a la mitad.
        stallSong1();
        requests.delete(SONG_1_PATH);
        // La app lee lo descargado al abrirse.
        await openApp(page, server.url);
        await waitServiceWorker(page);
        await openCollection(page, ALBUM_A);
        await playRow(page, 0);
        await page.waitForFunction((src) => window.__e2eAudioEvents.some((event) => event.type === "ended" && event.src === src), { timeout: 30_000 }, `${SONG_1}.opus`);
        const events = (await audioEvents(page)).filter((event) => event.src === `${SONG_1}.opus`);
        const ended = events.find((event) => event.type === "ended");
        assert.ok(ended.t > 9, `llega al final (${ended.t} s)`);
        assert.equal(events.filter((event) => event.type === "loadstart").length, 1, "sin recargas del vigilante");
        assert.equal(events.some((event) => event.type === "error"), false);
        assert.equal(requests.get(SONG_1_PATH) ?? 0, 0, "ninguna petición de esa canción a la red");
        assert.notEqual(await page.$eval('[data-testid="toast"]', (node) => node.textContent), ERROR_NOTICE);
        await playerTitleIs(page, "Canción de prueba 02");
      });
    } finally {
      restoreSong1();
    }
  });
});

describe("versión nueva de la web (service worker)", () => {
  // Despliegue: sw.js cambia (como al subir SHELL_VERSION) y la página pide comprobarlo.
  async function deploy(page, mark) {
    overrides.set("/sw.js", { body: `${SW_SOURCE}\n// despliegue ${mark}\n`, type: "text/javascript; charset=utf-8" });
    await page.evaluate(() => navigator.serviceWorker.getRegistration().then((registration) => registration.update())).catch(() => {});
  }

  // Primera visita (instala la versión actual) y segunda (la página ya la tenía al abrirse, como quien vuelve a la web).
  async function openWithInstalledVersion(page) {
    await openApp(page, server.url);
    await waitServiceWorker(page);
    await openApp(page, server.url);
    await waitServiceWorker(page);
  }

  prueba("con una canción cargada no recarga: avisa con «Recargar», también en pausa", async () => {
    await withPage(browser, VIEWPORTS.escritorio, async (page) => {
      await openWithInstalledVersion(page);
      await openCollection(page, ALBUM_A);
      await playRow(page, 0);
      await page.evaluate(() => { window.__e2eSameDocument = true; });
      await deploy(page, "con-cancion");
      await page.waitForFunction((text) => document.querySelector('[data-testid="update-notice"]')?.textContent.includes(text), { timeout: 20_000 }, UPDATE_NOTICE);
      const notice = await page.$eval('[data-testid="update-notice"]', (node) => ({
        role: node.getAttribute("role"),
        live: node.getAttribute("aria-live"),
        button: node.querySelector('[data-testid="update-notice-reload"]')?.textContent,
        shown: window.__e2eIsShown(node),
      }));
      assert.deepEqual(notice, { role: "status", live: "polite", button: "Recargar", shown: true });
      // Antes, al pausar se recargaba sola y se perdían la canción, la cola y la posición.
      await page.click('[data-testid="player-play"]');
      await page.waitForFunction(() => document.getElementById("audio").paused);
      await new Promise((resolve) => setTimeout(resolve, 5000));
      assert.equal(await page.evaluate(() => window.__e2eSameDocument), true, "la página no se ha recargado");
      assert.equal(await textOf(page, "player-title"), "Canción de prueba 01");
      // «Recargar» estrena la versión nueva.
      await Promise.all([
        page.waitForNavigation({ timeout: 20_000 }),
        page.click('[data-testid="update-notice-reload"]'),
      ]);
      await page.waitForSelector('html[data-ready="true"]', { timeout: 15_000 });
      assert.equal(await page.evaluate(() => window.__e2eSameDocument ?? false), false);
    });
  });

  prueba("sin nada cargado, recarga sola para estrenar la versión nueva", async () => {
    await withPage(browser, VIEWPORTS.escritorio, async (page) => {
      await openWithInstalledVersion(page);
      await page.evaluate(() => { window.__e2eSameDocument = true; });
      await Promise.all([page.waitForNavigation({ timeout: 20_000 }), deploy(page, "sin-cancion")]);
      await page.waitForSelector('html[data-ready="true"]', { timeout: 15_000 });
      assert.equal(await page.evaluate(() => window.__e2eSameDocument ?? false), false);
    });
  });
});
