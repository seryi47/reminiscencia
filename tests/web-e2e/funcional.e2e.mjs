// Pruebas funcionales de la interfaz sin usuarios (ADR-0015): abre en Inicio sin pedir nada, reproduce, busca, abre
// carpetas, crea listas locales, «Me gusta», cola, subida local (conversión real a Opus) y borrado, «Para todos»,
// «Desde Internet Archive» y escucha sin conexión. Catálogo de prueba ficticio (helpers/catalogo-prueba.mjs).
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { createTestCatalogOverrides } from "./helpers/catalogo-prueba.mjs";
import { clickTestid, isVisible, TEST_TIMEOUT_MS, textOf, waitHidden, waitVisible } from "./helpers/elementos.mjs";
import {
  countLocalSongs,
  createPlaylist,
  fillField,
  goSection,
  openApp,
  openCollection,
  openRowMenu,
  openUpload,
  playRow,
  search,
  seedLocalSong,
  waitServiceWorker,
} from "./helpers/flujos.mjs";
import { launchBrowser, VIEWPORTS, withPage } from "./helpers/navegador.mjs";
import { startStaticServer } from "./helpers/servidor.mjs";

let server;
let browser;

before(async () => {
  server = await startStaticServer({ overrides: createTestCatalogOverrides() });
  browser = await launchBrowser();
});

after(async () => {
  await browser?.close();
  await server?.close();
});

const prueba = (nombre, fn) => it(nombre, { timeout: TEST_TIMEOUT_MS }, fn);
const FOLDER_A = "#/carpeta/F0000000000000001";
const FOLDER_B = "#/carpeta/F0000000000000002";
const SONG_1 = "S0000000000000001";
const GREEN = "rgb(31, 223, 100)";

const audioState = (page) => page.evaluate(() => {
  const audio = document.getElementById("audio");
  return { paused: audio.paused, src: audio.src, volume: audio.volume, error: audio.error?.code ?? null };
});

// WAV PCM de 16 bits, mono, 48 kHz: un tono de 440 Hz de la duración indicada.
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

describe("Arranque", () => {
  for (const [nombre, viewport] of [["teléfono", VIEWPORTS.telefono], ["escritorio", VIEWPORTS.escritorio]]) {
    prueba(`Abre en Inicio con la música, sin pedir perfil, PIN ni modo (${nombre})`, () =>
      withPage(browser, viewport, async (page) => {
        await openApp(page, server.url);
        await waitVisible(page, "view-home", { context: "Inicio" });
        const saludo = await textOf(page, "home-title");
        assert.match(saludo, /^(Buenos días|Buenas tardes|Buenas noches)$/);
        assert.equal(await page.$("dialog[open]"), null, "Al abrir no debe aparecer ningún diálogo.");
        const texto = await page.evaluate(() => document.body.innerText.toLowerCase());
        for (const palabra of ["perfil", "pin", "cuidador", "paciente", "sesión"]) {
          assert.equal(new RegExp(`\\b${palabra}\\b`).test(texto), false, `La interfaz todavía muestra «${palabra}».`);
        }
        assert.ok(await isVisible(page, "quick-grid"), "Inicio debe mostrar los accesos rápidos.");
        assert.ok(await isVisible(page, "shelf-folders"), "Inicio debe mostrar el estante Carpetas.");
        assert.ok(await isVisible(page, "shelf-recent"), "Inicio debe mostrar el estante Añadidas recientemente.");
        assert.equal(await page.evaluate(() => window.__e2ePlayCalls), 0, "Al abrir no debe sonar nada.");
        assert.equal(await page.evaluate(() => document.title), "Reminiscencia");
      }),
    );
  }
});

describe("Reproducir", () => {
  prueba("El botón verde de una carpeta reproduce desde la primera canción y marca la fila en verde", () =>
    withPage(browser, VIEWPORTS.escritorio, async (page) => {
      await openApp(page, server.url);
      await openCollection(page, FOLDER_A);
      await clickTestid(page, "collection-play", "botón verde de la carpeta");
      await page.waitForFunction(() => !document.getElementById("audio").paused, { timeout: 10000 });
      const estado = await audioState(page);
      assert.match(estado.src, /\/audio\/S0000000000000001\.opus$/);
      assert.equal(await textOf(page, "player-title"), "Canción de prueba 01");
      const color = await page.$eval(`[data-testid="track-row"][data-song-id="${SONG_1}"] .track-title`, (el) => getComputedStyle(el).color);
      assert.equal(color, GREEN, "La fila que suena va en verde.");
      const etiqueta = await page.$eval('[data-testid="collection-play"]', (el) => el.getAttribute("aria-label"));
      assert.equal(etiqueta, "Pausar Carpeta de prueba A");
      await clickTestid(page, "player-play", "pausa");
      await page.waitForFunction(() => document.getElementById("audio").paused, { timeout: 5000 });
      await clickTestid(page, "player-next", "siguiente");
      await page.waitForFunction(() => document.querySelector('[data-testid="player-title"]').textContent === "Canción de prueba 02");
    }),
  );

  prueba("Aleatorio, repetir y volumen cambian el estado del reproductor", () =>
    withPage(browser, VIEWPORTS.escritorio, async (page) => {
      await openApp(page, server.url);
      await openCollection(page, FOLDER_A);
      await playRow(page, 2);
      const pulsado = () => page.$eval('[data-testid="player-shuffle"]', (el) => el.getAttribute("aria-pressed"));
      assert.equal(await pulsado(), "false");
      await clickTestid(page, "player-shuffle", "aleatorio");
      assert.equal(await pulsado(), "true");
      assert.equal(await page.$eval('[data-testid="collection-shuffle"]', (el) => el.getAttribute("aria-pressed")), "true", "El aleatorio de la barra de acciones refleja el del reproductor.");
      const repetir = () => page.$eval('[data-testid="player-repeat"]', (el) => el.getAttribute("aria-label"));
      assert.equal(await repetir(), "Repetir: desactivado");
      await clickTestid(page, "player-repeat", "repetir");
      assert.equal(await repetir(), "Repetir: toda la cola");
      await clickTestid(page, "player-repeat", "repetir");
      assert.equal(await repetir(), "Repetir: esta canción");
      const volumen = await page.$('[data-testid="player-volume"]');
      await volumen.focus();
      for (let i = 0; i < 30; i += 1) await page.keyboard.press("ArrowLeft");
      const estado = await audioState(page);
      assert.ok(estado.volume < 0.8, `El volumen debería bajar con las flechas y vale ${estado.volume}.`);
      await clickTestid(page, "player-mute", "silenciar");
      assert.equal((await audioState(page)).volume, 0);
      // Las preferencias del reproductor se conservan al recargar.
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForSelector('html[data-ready="true"]');
      assert.equal(await pulsado(), "true");
    }),
  );

  prueba("«Añadir a la cola» pone la canción a continuación en la cola", () =>
    withPage(browser, VIEWPORTS.escritorio, async (page) => {
      await openApp(page, server.url);
      await openCollection(page, FOLDER_A);
      await playRow(page, 0);
      await openCollection(page, FOLDER_B);
      const opciones = await openRowMenu(page, "S0000000000000010");
      assert.ok(opciones.includes("Añadir a la cola"), opciones.join(", "));
      await clickTestid(page, "menu-queue", "Añadir a la cola");
      await clickTestid(page, "player-queue", "botón Cola");
      await waitVisible(page, "queue-added", { context: "canciones añadidas a la cola" });
      assert.match(await textOf(page, "queue-added"), /Canción de prueba 10/);
      await clickTestid(page, "player-next", "siguiente");
      await page.waitForFunction(() => document.querySelector('[data-testid="player-title"]').textContent === "Canción de prueba 10");
    }),
  );

  prueba("En el teléfono, el minirreproductor abre la reproducción a pantalla completa", () =>
    withPage(browser, VIEWPORTS.telefono, async (page) => {
      await openApp(page, server.url);
      assert.equal(await isVisible(page, "mini-player", 500), false, "Sin canción no hay minirreproductor.");
      await openCollection(page, FOLDER_A);
      await playRow(page, 0);
      await waitVisible(page, "mini-player");
      await clickTestid(page, "mini-open", "minirreproductor");
      await waitVisible(page, "full-player", { context: "reproducción a pantalla completa" });
      await clickTestid(page, "full-play", "pausa en pantalla completa");
      await page.waitForFunction(() => document.getElementById("audio").paused);
      await page.keyboard.press("Escape");
      assert.ok(await waitHidden(page, "full-player"), "Escape cierra la pantalla completa.");
    }),
  );
});

describe("Buscar", () => {
  prueba("Sin texto muestra «Explorar todo»; con texto, el resultado principal y las canciones", () =>
    withPage(browser, VIEWPORTS.escritorio, async (page) => {
      await openApp(page, server.url);
      await goSection(page, "buscar", VIEWPORTS.escritorio);
      await waitVisible(page, "browse-grid", { context: "Explorar todo" });
      assert.match(await textOf(page, "browse-grid"), /Carpeta de prueba A/);
      await search(page, "prueba 15");
      await waitVisible(page, "top-result", { context: "resultado principal" });
      assert.match(await textOf(page, "top-result"), /Canción de prueba 15/);
      assert.equal(await page.$eval('[data-testid="search-input"]', (el) => el === document.activeElement), true, "El campo conserva el foco al escribir.");
      await search(page, "carpeta de prueba b");
      await page.waitForFunction(() => /Carpeta de prueba B/.test(document.querySelector('[data-testid="top-result"]')?.textContent ?? ""));
      await search(page, "zzzz sin nada");
      await waitVisible(page, "search-empty", { context: "sin resultados" });
      await clickTestid(page, "search-clear", "borrar la búsqueda");
      await waitVisible(page, "browse-grid");
    }),
  );

  prueba("Buscar sin tildes encuentra la canción y la reproduce", () =>
    withPage(browser, VIEWPORTS.telefono, async (page) => {
      await openApp(page, server.url);
      await goSection(page, "buscar", VIEWPORTS.telefono);
      await search(page, "cancion de prueba 03");
      await playRow(page, 0);
      assert.match((await audioState(page)).src, /S0000000000000003\.opus$/);
    }),
  );
});

describe("Carpetas", () => {
  prueba("Desde Inicio se abre una carpeta con su cabecera y sus canciones", () =>
    withPage(browser, VIEWPORTS.escritorio, async (page) => {
      await openApp(page, server.url);
      await page.$eval('[data-testid="shelf-folders"] .card-link', (link) => link.click());
      await waitVisible(page, "collection-title", { context: "carpeta" });
      assert.equal(await textOf(page, "collection-title"), "Carpeta de prueba A");
      assert.match(await textOf(page, "collection-meta"), /8 canciones/);
      assert.equal(await page.$$eval('[data-testid="track-row"]', (rows) => rows.length), 8);
      assert.equal(await page.evaluate(() => document.activeElement?.matches("h1")), true, "Al cambiar de pantalla el foco va al H1.");
      const actual = await page.$eval('[data-testid="sidebar-item"][aria-current="page"]', (el) => el.textContent);
      assert.match(actual, /Carpeta de prueba A/, "La carpeta abierta se marca en la barra lateral.");
    }),
  );

  prueba("Una carpeta vacía lo dice y «Mostrar todo» lista las carpetas", () =>
    withPage(browser, VIEWPORTS.telefono, async (page) => {
      await openApp(page, server.url);
      await openCollection(page, "#/carpeta/F0000000000000003");
      await waitVisible(page, "collection-empty", { context: "carpeta vacía" });
      await openApp(page, server.url);
      await clickTestid(page, "shelf-folders-more", "Mostrar todo de Carpetas");
      await waitVisible(page, "section-grid", { context: "cuadrícula de carpetas" });
      assert.equal(await page.$$eval('[data-testid="section-grid"] .card', (cards) => cards.length), 3);
    }),
  );
});

describe("Listas locales y «Me gusta»", () => {
  prueba("Crear una lista, añadirle canciones, renombrarla, recargar y borrarla", () =>
    withPage(browser, VIEWPORTS.escritorio, async (page) => {
      await openApp(page, server.url);
      const id = await createPlaylist(page, VIEWPORTS.escritorio);
      assert.match(id, /^P[0-9a-f]{16}$/);
      assert.equal(await textOf(page, "collection-title"), "Mi lista n.º 1");
      await waitVisible(page, "collection-empty");
      await clickTestid(page, "playlist-add-button", "Añadir la primera canción sugerida");
      await page.waitForFunction(() => document.querySelectorAll('[data-testid="track-row"]').length === 1);
      // Añadir desde el menú de otra colección.
      await openCollection(page, FOLDER_B);
      await openRowMenu(page, "S0000000000000012");
      await clickTestid(page, "menu-add-playlist", "Añadir a una lista");
      await page.waitForSelector('[data-testid="menu-playlist"]');
      await page.$eval('[data-testid="menu-playlist"]', (item) => item.click());
      await openCollection(page, `#/lista/${id}`);
      await page.waitForFunction(() => document.querySelectorAll('[data-testid="track-row"]').length === 2);
      // Renombrar.
      await clickTestid(page, "playlist-more", "Más opciones de la lista");
      await clickTestid(page, "menu-rename", "Cambiar el nombre");
      await fillField(await waitVisible(page, "prompt-input"), "Para el domingo");
      await clickTestid(page, "prompt-ok", "Guardar");
      await page.waitForFunction(() => document.querySelector('[data-testid="collection-title"]')?.textContent === "Para el domingo");
      // Se conserva al recargar: vive en IndexedDB de este navegador.
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForSelector('html[data-ready="true"]');
      assert.equal(await textOf(page, "collection-title"), "Para el domingo");
      assert.equal(await page.$$eval('[data-testid="track-row"]', (rows) => rows.length), 2);
      // Borrar.
      await clickTestid(page, "playlist-more", "Más opciones de la lista");
      await clickTestid(page, "menu-delete-playlist", "Borrar la lista");
      await clickTestid(page, "confirm-ok", "confirmar el borrado");
      await waitVisible(page, "view-home", { context: "Inicio tras borrar la lista" });
      assert.equal(await page.$(`[data-context="lista:${id}"]`), null, "La lista borrada no debe quedar en la biblioteca.");
    }),
  );

  prueba("«Me gusta» desde la fila y desde el reproductor; la lista «Me gusta» las muestra", () =>
    withPage(browser, VIEWPORTS.escritorio, async (page) => {
      await openApp(page, server.url);
      await openCollection(page, FOLDER_A);
      const corazon = `[data-testid="track-row"][data-song-id="${SONG_1}"] [data-testid="row-like"]`;
      await page.$eval(corazon, (button) => button.click());
      await page.waitForFunction((sel) => document.querySelector(sel)?.getAttribute("aria-pressed") === "true", {}, corazon);
      await openCollection(page, "#/me-gusta");
      assert.equal(await textOf(page, "collection-title"), "Me gusta");
      assert.equal(await page.$$eval('[data-testid="track-row"]', (rows) => rows.map((row) => row.dataset.songId).join()), SONG_1);
      await playRow(page, 0);
      const delReproductor = await page.$eval('[data-testid="player-like"]', (el) => el.getAttribute("aria-pressed"));
      assert.equal(delReproductor, "true");
      await clickTestid(page, "player-like", "quitar Me gusta desde el reproductor");
      await waitVisible(page, "collection-empty", { context: "«Me gusta» vacía" });
    }),
  );
});

describe("Subir canciones", () => {
  prueba("«Solo en este navegador»: convierte un WAV a Opus, suena por el service worker y se borra", () =>
    withPage(browser, VIEWPORTS.escritorio, async (page) => {
      const dir = await mkdtemp(join(tmpdir(), "reminiscencia-e2e-"));
      const archivo = join(dir, "Tono de prueba.wav");
      await writeFile(archivo, wavTone(1.5));
      await openApp(page, server.url);
      await waitServiceWorker(page);
      await openUpload(page, VIEWPORTS.escritorio, "local");
      const soporte = await textOf(page, "upload-support").catch(() => "");
      assert.equal(soporte, "", `Este Chrome no convierte a Opus: ${soporte}`);
      const input = await page.$('[data-testid="upload-file-input"]');
      await input.uploadFile(archivo);
      await page.waitForFunction(() => /Se ha añadido 1 canción/.test(document.querySelector('[data-testid="upload-status"]')?.textContent ?? ""), { timeout: 60000 });
      assert.match(await textOf(page, "upload-local-list"), /Tono de prueba/);
      assert.equal(await countLocalSongs(page), 1);
      await page.keyboard.press("Escape");
      await openCollection(page, "#/locales");
      await playRow(page, 0);
      const estado = await audioState(page);
      assert.match(estado.src, /\/audio\/L[0-9a-f]{16}\.opus$/, "La canción local se sirve desde el propio origen (CSP media-src 'self').");
      await page.waitForFunction(() => document.getElementById("audio").currentTime > 0.2, { timeout: 10000 });
      assert.equal((await audioState(page)).error, null);
      // Borrado desde el menú de la fila, con confirmación.
      const id = await page.$eval('[data-testid="track-row"]', (row) => row.dataset.songId);
      const opciones = await openRowMenu(page, id);
      assert.ok(opciones.includes("Borrar de este navegador"), opciones.join(", "));
      await clickTestid(page, "menu-delete-local", "Borrar de este navegador");
      assert.match(await textOf(page, "confirm"), /¿Borrar esta canción de este navegador\? No se puede deshacer\./);
      await clickTestid(page, "confirm-ok", "Borrar");
      await page.waitForFunction((songId) => !document.querySelector(`[data-song-id="${songId}"]`), {}, id);
      assert.equal(await countLocalSongs(page), 0);
    }),
  );

  prueba("Una canción pública no ofrece «Borrar de este navegador»; una local se borra desde la hoja", () =>
    withPage(browser, VIEWPORTS.telefono, async (page) => {
      await openApp(page, server.url);
      await seedLocalSong(page, { id: "L0011223344556677", title: "Canción local de prueba" });
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForSelector('html[data-ready="true"]');
      await openCollection(page, FOLDER_A);
      const opciones = await openRowMenu(page, SONG_1);
      await page.keyboard.press("Escape");
      assert.equal(opciones.includes("Borrar de este navegador"), false);
      await openUpload(page, VIEWPORTS.telefono, "local");
      assert.match(await textOf(page, "upload-local-list"), /Canción local de prueba/);
      await clickTestid(page, "upload-delete", "Borrar en la hoja");
      await clickTestid(page, "confirm-ok", "Borrar");
      await page.waitForFunction(() => /Todavía no has subido ninguna/.test(document.querySelector('[data-testid="upload-local-list"]')?.textContent ?? ""));
      assert.equal(await countLocalSongs(page), 0);
    }),
  );

  prueba("«Para todos» abre la subida de GitHub en otra pestaña, con las instrucciones", () =>
    withPage(browser, VIEWPORTS.escritorio, async (page) => {
      await openApp(page, server.url);
      await openUpload(page, VIEWPORTS.escritorio, "todos");
      const enlace = await page.$eval('[data-testid="upload-github-link"]', (a) => ({ href: a.href, target: a.target, rel: a.rel }));
      assert.deepEqual(enlace, {
        href: "https://github.com/seryi47/reminiscencia/upload/main/audio-library/buzon",
        target: "_blank",
        rel: "noopener noreferrer",
      });
      const reglas = await textOf(page, "upload-rules");
      assert.match(reglas, /permiso de escritura/);
      assert.match(reglas, /25 MB/);
      assert.match(reglas, /Licencia: …/);
      assert.match(reglas, /quedan privadas/);
      assert.match(reglas, /responde de esa declaración/);
    }),
  );

  prueba("«Desde Internet Archive» rechaza plataformas bloqueadas y prepara la incidencia con un ítem válido", () =>
    withPage(browser, VIEWPORTS.escritorio, async (page) => {
      await openApp(page, server.url);
      await openUpload(page, VIEWPORTS.escritorio, "archive");
      const enlace = () => page.$eval('[data-testid="archive-issue-link"]', (a) => ({ href: a.getAttribute("href"), disabled: a.getAttribute("aria-disabled") }));
      const campo = await page.$('[data-testid="archive-url"]');
      await campo.type("https://www.youtube.com/watch?v=abc");
      await page.waitForFunction(() => /no se puede importar/.test(document.querySelector('[data-testid="upload-panel-archive"] .field-error:not([hidden])')?.textContent ?? ""));
      assert.deepEqual(await enlace(), { href: null, disabled: "true" });
      await fillField(campo, "https://archive.org/details/ejemplo-de-prueba");
      await page.waitForFunction(() => document.querySelector('[data-testid="archive-issue-link"]').getAttribute("aria-disabled") === "false");
      const { href } = await enlace();
      const url = new URL(href);
      assert.equal(url.origin + url.pathname, "https://github.com/seryi47/reminiscencia/issues/new");
      assert.equal(url.searchParams.get("labels"), "biblioteca");
      assert.equal(url.searchParams.get("body"), "action: import\nurl: https://archive.org/details/ejemplo-de-prueba");
    }),
  );
});

describe("Sin conexión", () => {
  prueba("Una carpeta descargada suena sin conexión; lo no descargado se marca como no disponible", () =>
    withPage(browser, VIEWPORTS.escritorio, async (page) => {
      await openApp(page, server.url);
      await waitServiceWorker(page);
      await openCollection(page, FOLDER_A);
      await clickTestid(page, "collection-download", "Descargar");
      await page.waitForFunction(() => document.querySelector('[data-testid="collection-download"]')?.getAttribute("aria-pressed") === "true", { timeout: 30000 });
      // La copia del shell se completa en segundo plano: se espera a que estén los datos y la página.
      await page.waitForFunction(async () => {
        const names = await caches.keys();
        const shell = names.find((name) => name.startsWith("reminiscencia-shell-"));
        if (!shell) return false;
        const cache = await caches.open(shell);
        const keys = (await cache.keys()).map((request) => new URL(request.url).pathname);
        return ["/", "/data/songs.json", "/data/folders.json", "/js/app.js", "/css/app.css"].every((path) => keys.includes(path));
      }, { timeout: 30000, polling: 500 });
      await page.setOfflineMode(true);
      try {
        await page.reload({ waitUntil: "domcontentloaded" });
        await page.waitForSelector('html[data-ready="true"]', { timeout: 15000 });
        await waitVisible(page, "offline-banner", { context: "aviso sin conexión" });
        await waitVisible(page, "collection-title");
        await playRow(page, 0);
        await page.waitForFunction(() => document.getElementById("audio").currentTime > 0.2, { timeout: 10000 });
        await openCollection(page, FOLDER_B);
        const marcadas = await page.$$eval('[data-testid="track-row"].is-unavailable', (rows) => rows.length);
        assert.equal(marcadas, 8, "Las canciones de la carpeta no descargada se marcan como no disponibles.");
      } finally {
        await page.setOfflineMode(false);
      }
    }),
  );
});
