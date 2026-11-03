// Pruebas funcionales de la interfaz sin usuarios (ADR-0015) con la distribución de Spotify: abre en Inicio sin pedir
// nada, reproduce, busca desde la barra superior, abre álbumes (con portadas publicadas), panel «Reproduciendo», crea y
// edita listas locales (nombre, descripción y foto), «Me gusta», cola, hojas de edición de canciones y álbumes
// (incidencias de GitHub), «Subir canciones» para todos (conversión real a Opus y envío por trozos a /api/subir, con la
// función simulada en el servidor de pruebas; ADR-0017; también desde archivos ZIP), canciones locales de antes (suenan y se borran), «Importar
// desde Internet Archive» y escucha sin conexión. Catálogo de prueba ficticio (helpers/catalogo-prueba.mjs).
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { crc32, deflateSync } from "node:zlib";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { createTestCatalogOverrides } from "./helpers/catalogo-prueba.mjs";
import { clickTestid, isVisible, TEST_TIMEOUT_MS, textOf, waitHidden, waitVisible, wcagViolations } from "./helpers/elementos.mjs";
import {
  countLocalSongs,
  createMenu,
  createPlaylist,
  fillField,
  goSection,
  issuePayload,
  openApp,
  openCollection,
  openCollectionMenu,
  openRowMenu,
  openUpload,
  pickMenu,
  playRow,
  search,
  seedLocalSong,
  waitServiceWorker,
} from "./helpers/flujos.mjs";
import { capture, launchBrowser, VIEWPORTS, withPage } from "./helpers/navegador.mjs";
import { startStaticServer } from "./helpers/servidor.mjs";
import { buildZip } from "./helpers/zip.mjs";

let server;
let browser;

// Función /api/subir simulada: guarda cada trozo recibido y responde como la de Vercel (frontend/web/api/subir.js).
// Un nombre de archivo que contiene «falla» recibe el error de un archivo que no es Ogg Opus; uno con «una-vez», solo
// la primera vez (para «Reintentar»), y uno con «lenta» tarda en responder (para cerrar la hoja con la subida a medias).
const subidas = [];
const fallidasUnaVez = new Set();
async function fakeUploadFunction({ headers, body }) {
  const name = decodeURIComponent(headers["x-nombre-archivo"] ?? "");
  const index = Number(headers["x-parte"]);
  const total = Number(headers["x-partes"]);
  subidas.push({ name, id: headers["x-subida-id"], index, total, type: headers["content-type"], body });
  if (name.includes("lenta")) await new Promise((resolve) => setTimeout(resolve, 2500));
  if (name.includes("una-vez") && !fallidasUnaVez.has(name)) {
    fallidasUnaVez.add(name);
    return { status: 415, json: { ok: false, error: "El archivo no es Ogg Opus." } };
  }
  if (name.includes("falla")) return { status: 415, json: { ok: false, error: "El archivo no es Ogg Opus." } };
  const complete = index === total - 1;
  return {
    json: {
      ok: true, parte: index, partes: total, completa: complete, repetido: false,
      nombre: complete ? `${name.replace(/\.[^.]*$/, "")}.opus` : null,
      mensaje: complete ? "Subida: llegará a todos en un par de minutos." : `Trozo ${index + 1} de ${total} recibido.`,
    },
  };
}

// El catálogo de prueba se puede cambiar durante una prueba: así se simula que el workflow publica una subida.
let catalogo;
let cancionesBase;

before(async () => {
  catalogo = createTestCatalogOverrides();
  cancionesBase = catalogo.get("/data/songs.json").body;
  server = await startStaticServer({ overrides: catalogo, functions: new Map([["/api/subir", fakeUploadFunction]]) });
  browser = await launchBrowser();
});

after(async () => {
  await browser?.close();
  await server?.close();
});

const prueba = (nombre, fn) => it(nombre, { timeout: TEST_TIMEOUT_MS }, fn);
const FOLDER_A = "#/album/F0000000000000001";
const FOLDER_B = "#/album/F0000000000000002";
const ALBUM_A_ID = "F0000000000000001";
const SONG_1 = "S0000000000000001";
const GREEN = "rgb(30, 215, 96)";

const audioState = (page) => page.evaluate(() => {
  const audio = document.getElementById("audio");
  return { paused: audio.paused, src: audio.src, volume: audio.volume, error: audio.error?.code ?? null };
});

// PNG RGB de width × height: la mitad izquierda roja y la derecha azul (para la foto de una lista).
function pngImage(width, height) {
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
  const rows = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const start = y * (width * 3 + 1);
    for (let x = 0; x < width; x += 1) {
      const at = start + 1 + x * 3;
      if (x < width / 2) rows[at] = 220;
      else rows[at + 2] = 200;
    }
  }
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

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
        assert.equal(await page.$eval('[data-testid="home-title"]', (el) => el.textContent), "Inicio");
        assert.equal(await page.$("dialog[open]"), null, "Al abrir no debe aparecer ningún diálogo.");
        const texto = await page.evaluate(() => document.body.innerText.toLowerCase());
        for (const palabra of ["perfil", "pin", "cuidador", "paciente", "sesión", "carpeta"]) {
          assert.equal(new RegExp(`\\b${palabra}\\b`).test(texto), false, `La interfaz todavía muestra «${palabra}».`);
        }
        assert.ok(await isVisible(page, "quick-grid"), "Inicio debe mostrar los accesos rápidos.");
        assert.ok(await isVisible(page, "shelf-albums"), "Inicio debe mostrar el estante Álbumes.");
        assert.ok(await isVisible(page, "shelf-recent"), "Inicio debe mostrar el estante Añadidas recientemente.");
        assert.deepEqual(await page.$$eval('[data-testid^="home-chip-"]', (chips) => chips.map((chip) => [chip.textContent, chip.getAttribute("aria-pressed")])), [["Todo", "true"], ["Música", "false"]]);
        assert.equal(await page.evaluate(() => window.__e2ePlayCalls), 0, "Al abrir no debe sonar nada.");
        assert.equal(await page.evaluate(() => document.title), "Reminiscencia");
      }),
    );
  }

  prueba("El chip «Música» deja solo álbumes y canciones; pulsarlo otra vez vuelve a «Todo»", () =>
    withPage(browser, VIEWPORTS.escritorio, async (page) => {
      await openApp(page, server.url);
      await clickTestid(page, "home-chip-musica", "chip Música");
      await page.waitForFunction(() => document.querySelector('[data-testid="home-chip-musica"]')?.getAttribute("aria-pressed") === "true");
      const accesos = await page.$$eval('[data-testid="quick-tile"]', (tiles) => tiles.map((tile) => tile.dataset.context));
      assert.ok(accesos.length > 0 && accesos.every((id) => id.startsWith("album:")), accesos.join(", "));
      assert.equal(await page.$('[data-testid="shelf-playlists"]'), null);
      await clickTestid(page, "home-chip-musica", "chip Música otra vez");
      await page.waitForFunction(() => document.querySelector('[data-testid="home-chip-todo"]')?.getAttribute("aria-pressed") === "true");
    }),
  );
});

describe("Reproducir", () => {
  prueba("El botón verde de un álbum reproduce desde la primera canción y marca la fila en verde", () =>
    withPage(browser, VIEWPORTS.escritorio, async (page) => {
      await openApp(page, server.url);
      await openCollection(page, FOLDER_A);
      await clickTestid(page, "collection-play", "botón verde del álbum");
      await page.waitForFunction(() => !document.getElementById("audio").paused, { timeout: 10000 });
      const estado = await audioState(page);
      assert.match(estado.src, /\/audio\/S0000000000000001\.opus$/);
      assert.equal(await textOf(page, "player-title"), "Canción de prueba 01");
      const color = await page.$eval(`[data-testid="track-row"][data-song-id="${SONG_1}"] .track-title`, (el) => getComputedStyle(el).color);
      assert.equal(color, GREEN, "La fila que suena va en verde.");
      const etiqueta = await page.$eval('[data-testid="collection-play"]', (el) => el.getAttribute("aria-label"));
      assert.equal(etiqueta, "Pausar Álbum de prueba A");
      // La biblioteca marca el álbum que suena.
      assert.equal(await page.$eval(`[data-testid="sidebar-item"][data-context="album:${ALBUM_A_ID}"]`, (el) => el.classList.contains("is-playing")), true);
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
      assert.equal(await page.$eval('[data-testid="player-lyrics"]', (el) => el.disabled), true, "La letra está desactivada.");
      assert.equal(await page.$eval('[data-testid="player-device"]', (el) => el.hidden), true, "El dispositivo está oculto.");
      // Las preferencias del reproductor se conservan al recargar.
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForSelector('html[data-ready="true"]');
      assert.equal(await pulsado(), "true");
    }),
  );

  prueba("«Reproduciendo» abre el panel derecho con la portada, la canción y la siguiente; «Cola» muestra lo añadido", () =>
    withPage(browser, VIEWPORTS.escritorio, async (page) => {
      await openApp(page, server.url);
      assert.equal(await isVisible(page, "now-panel", 300), false, "El panel empieza oculto.");
      await openCollection(page, FOLDER_A);
      await playRow(page, 0);
      await clickTestid(page, "player-now", "Reproduciendo");
      await waitVisible(page, "now-panel", { context: "panel Reproduciendo" });
      assert.equal(await page.$eval('[data-testid="player-now"]', (el) => el.getAttribute("aria-pressed")), "true");
      assert.equal(await textOf(page, "now-panel-title"), "Álbum de prueba A");
      assert.equal(await textOf(page, "now-track"), "Canción de prueba 01");
      assert.match(await textOf(page, "now-next"), /Canción de prueba 02/);
      assert.equal(await page.$eval(".now-cover img", (img) => img.getAttribute("src")), "covers/S0000000000000001.jpg");
      // Añadir a la cola desde otro álbum y verlo en el mismo panel.
      await openCollection(page, FOLDER_B);
      const opciones = await openRowMenu(page, "S0000000000000010");
      assert.ok(opciones.includes("Añadir a la cola"), opciones.join(", "));
      await pickMenu(page, "menu-queue");
      await clickTestid(page, "player-queue", "botón Cola");
      await waitVisible(page, "queue-added", { context: "canciones añadidas a la cola" });
      assert.equal(await textOf(page, "now-panel-title"), "Cola");
      assert.match(await textOf(page, "queue-added"), /Canción de prueba 10/);
      await clickTestid(page, "now-close", "cerrar el panel");
      assert.ok(await waitHidden(page, "now-panel"), "El panel se cierra.");
      await clickTestid(page, "player-next", "siguiente");
      await page.waitForFunction(() => document.querySelector('[data-testid="player-title"]').textContent === "Canción de prueba 10");
    }),
  );

  prueba("En el teléfono, el minirreproductor lleva el color de la portada y abre la reproducción a pantalla completa", () =>
    withPage(browser, VIEWPORTS.telefono, async (page) => {
      await openApp(page, server.url);
      assert.equal(await isVisible(page, "mini-player", 500), false, "Sin canción no hay minirreproductor.");
      await openCollection(page, FOLDER_A);
      await playRow(page, 0);
      await waitVisible(page, "mini-player");
      // El color dominante de la portada naranja de la canción 1 (oscurecido para el texto blanco).
      await page.waitForFunction(() => {
        const rgb = getComputedStyle(document.querySelector('[data-testid="mini-player"]')).backgroundColor.match(/\d+/g).map(Number);
        return rgb[0] > rgb[2] + 40;
      }, { timeout: 5000 });
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
  prueba("En escritorio se busca desde la barra superior: lleva a Buscar sin perder el foco", () =>
    withPage(browser, VIEWPORTS.escritorio, async (page) => {
      await openApp(page, server.url);
      await search(page, "prueba 15");
      await waitVisible(page, "top-result", { context: "resultado principal" });
      assert.match(await textOf(page, "top-result"), /Canción de prueba 15/);
      assert.equal(await page.evaluate(() => location.hash), "#/buscar");
      assert.equal(await page.$eval('[data-testid="top-search-input"]', (el) => el === document.activeElement), true, "El buscador conserva el foco al escribir.");
      assert.equal(await isVisible(page, "search-input", 300), false, "En escritorio la página no repite el campo.");
      await search(page, "álbum de prueba b");
      await page.waitForFunction(() => /Álbum de prueba B/.test(document.querySelector('[data-testid="top-result"]')?.textContent ?? ""));
      // Los chips filtran por tipo.
      await clickTestid(page, "search-chip-albumes", "chip Álbumes");
      await waitVisible(page, "search-albumes-grid");
      await search(page, "zzzz sin nada");
      await waitVisible(page, "search-empty", { context: "sin resultados" });
      await clickTestid(page, "top-search-clear", "borrar la búsqueda");
      await waitVisible(page, "browse-grid");
      assert.match(await textOf(page, "browse-grid"), /Álbum de prueba A/);
    }),
  );

  prueba("«Explorar» abre Explorar todo y la búsqueda encuentra un álbum por su artista", () =>
    withPage(browser, VIEWPORTS.escritorio, async (page) => {
      await openApp(page, server.url);
      await goSection(page, "buscar", VIEWPORTS.escritorio);
      await waitVisible(page, "browse-grid", { context: "Explorar todo" });
      assert.equal(await page.$eval('[data-testid="nav-buscar"]', (el) => el.getAttribute("aria-current")), "page");
      await search(page, "artista de prueba a");
      await waitVisible(page, "search-albums");
      assert.match(await textOf(page, "search-albums"), /Álbum de prueba A/);
    }),
  );

  prueba("En el teléfono, Buscar tiene su campo; sin tildes encuentra la canción y la reproduce", () =>
    withPage(browser, VIEWPORTS.telefono, async (page) => {
      await openApp(page, server.url);
      await goSection(page, "buscar", VIEWPORTS.telefono);
      await search(page, "cancion de prueba 03");
      await playRow(page, 0);
      assert.match((await audioState(page)).src, /S0000000000000003\.opus$/);
    }),
  );
});

describe("Álbumes y portadas", () => {
  prueba("Desde Inicio se abre un álbum con su portada, su artista, su cabecera de color y sus canciones", () =>
    withPage(browser, VIEWPORTS.escritorio, async (page) => {
      await openApp(page, server.url);
      await page.$eval(`[data-testid="shelf-albums"] [data-context="album:${ALBUM_A_ID}"] .card-link`, (link) => link.click());
      await waitVisible(page, "collection-title", { context: "álbum" });
      assert.equal(await textOf(page, "collection-title"), "Álbum de prueba A");
      assert.equal(await page.$eval(".collection-type", (el) => el.textContent), "Álbum");
      assert.match(await textOf(page, "collection-meta"), /^Artista de prueba A • \d{4} • 8 canciones, /);
      assert.equal(await page.$$eval('[data-testid="track-row"]', (rows) => rows.length), 8);
      assert.equal(await page.evaluate(() => document.activeElement?.matches("h1")), true, "Al cambiar de pantalla el foco va al H1.");
      const actual = await page.$eval('[data-testid="sidebar-item"][aria-current="page"]', (el) => el.textContent);
      assert.match(actual, /Álbum de prueba A/, "El álbum abierto se marca en Tu biblioteca.");
      // Portada publicada, cargada de verdad.
      const portada = await page.waitForFunction(() => {
        const img = document.querySelector(".collection-cover img");
        return img && img.complete && img.naturalWidth > 0 ? img.getAttribute("src") : null;
      }, { timeout: 5000 });
      assert.equal(await portada.jsonValue(), "covers/F0000000000000001.jpg");
      // El degradado toma el color dominante (azul) de la portada.
      await page.waitForFunction(() => {
        const rgb = getComputedStyle(document.querySelector('[data-testid="collection-header"]')).getPropertyValue("--cover-color").trim();
        const [r, , b] = rgb.slice(1).match(/../g).map((hex) => parseInt(hex, 16));
        return b > r + 40;
      }, { timeout: 5000 });
    }),
  );

  prueba("Sin portada (o si no carga) se ve la generada; una lista usa la portada de sus canciones", () =>
    withPage(browser, VIEWPORTS.escritorio, async (page) => {
      await openApp(page, server.url);
      await openCollection(page, FOLDER_B);
      assert.equal(await page.$(".collection-cover img"), null, "El álbum B no tiene portada.");
      assert.equal(await page.$eval(".collection-cover", (el) => el.classList.contains("has-image")), false);
      // Una lista sin foto propia usa la portada de su primera canción con portada.
      const id = await createPlaylist(page, VIEWPORTS.escritorio);
      const add = (title) => page.$$eval('[data-testid="playlist-add-button"]', (buttons, text) => buttons.find((b) => b.getAttribute("aria-label").includes(text))?.click(), title);
      await add("Canción de prueba 01");
      await page.waitForFunction(() => document.querySelector(".collection-cover img")?.getAttribute("src") === "covers/S0000000000000001.jpg", { timeout: 5000 });
      // La canción 2 declara una portada que no existe (404): en su fila se queda la generada.
      await add("Canción de prueba 02");
      await page.waitForSelector('[data-testid="track-row"][data-song-id="S0000000000000002"]');
      await page.waitForFunction(() => {
        const cover = document.querySelector('[data-testid="track-row"][data-song-id="S0000000000000002"] .track-cover');
        return cover && !cover.querySelector(".cover-img") && !cover.classList.contains("has-image");
      }, { timeout: 5000 });
      assert.match(id, /^P[0-9a-f]{16}$/);
    }),
  );

  prueba("La ruta anterior #/carpeta/<id> sigue abriendo el álbum; un álbum vacío lo dice; «Mostrar todo» lista los álbumes", () =>
    withPage(browser, VIEWPORTS.telefono, async (page) => {
      await openApp(page, server.url, "#/carpeta/F0000000000000001");
      assert.equal(await textOf(page, "collection-title"), "Álbum de prueba A");
      await openCollection(page, "#/album/F0000000000000003");
      await waitVisible(page, "collection-empty", { context: "álbum vacío" });
      assert.match(await textOf(page, "collection-empty"), /Este álbum está vacío/);
      await openApp(page, server.url);
      await clickTestid(page, "shelf-albums-more", "Mostrar todo de Álbumes");
      await waitVisible(page, "section-grid", { context: "cuadrícula de álbumes" });
      assert.equal(await page.$$eval('[data-testid="section-grid"] .card', (cards) => cards.length), 3);
    }),
  );
});

describe("Tu biblioteca", () => {
  prueba("Chips «Listas» y «Álbumes», buscador pequeño y orden alfabético", () =>
    withPage(browser, VIEWPORTS.escritorio, async (page) => {
      await openApp(page, server.url);
      const contextos = () => page.$$eval('[data-testid="sidebar-item"]', (items) => items.map((item) => item.dataset.context));
      await clickTestid(page, "sidebar-chip-albumes", "chip Álbumes");
      const albumes = await contextos();
      assert.ok(albumes.length === 3 && albumes.every((id) => id.startsWith("album:")), albumes.join(", "));
      assert.deepEqual(await page.$$eval('[data-testid="sidebar-item"] .library-subtitle', (items) => items.map((item) => item.textContent)),
        ["Álbum • Artista de prueba A", "Álbum • Reminiscencia", "Álbum • Reminiscencia"]);
      await clickTestid(page, "sidebar-chip-albumes", "quitar el chip");
      await clickTestid(page, "sidebar-search-toggle", "buscar en Tu biblioteca");
      const campo = await waitVisible(page, "sidebar-filter");
      assert.equal(await page.evaluate(() => document.activeElement?.dataset.testid), "sidebar-filter");
      await campo.type("vacío");
      await page.waitForFunction(() => document.querySelectorAll('[data-testid="sidebar-item"]').length === 1);
      assert.equal(await page.evaluate(() => document.activeElement?.dataset.testid), "sidebar-filter", "El campo conserva el foco.");
      await page.keyboard.press("Escape");
      await page.waitForFunction(() => document.querySelectorAll('[data-testid="sidebar-item"]').length === 4);
      // Orden alfabético: «Me gusta» queda fijada arriba.
      await clickTestid(page, "sidebar-sort", "Ordenar");
      await pickMenu(page, "menu-sort-alfabetico");
      await page.waitForFunction(() => document.querySelector('[data-testid="sidebar-sort"] .sort-label')?.textContent === "Orden alfabético");
      assert.deepEqual(await page.$$eval('[data-testid="sidebar-item"] .library-title', (items) => items.map((item) => item.textContent)),
        ["Me gusta", "Álbum de prueba A", "Álbum de prueba B", "Álbum vacío de prueba"]);
    }),
  );

  prueba("«Recientes» pone primero lo último que ha sonado", () =>
    withPage(browser, VIEWPORTS.escritorio, async (page) => {
      await openApp(page, server.url);
      await openCollection(page, FOLDER_B);
      await clickTestid(page, "collection-play", "reproducir el álbum B");
      await page.waitForFunction((id) => document.querySelectorAll('[data-testid="sidebar-item"]')[1]?.dataset.context === id, { timeout: 5000 }, "album:F0000000000000002");
      await clickTestid(page, "nav-inicio", "Inicio");
      await waitVisible(page, "shelf-recently-played", { context: "Escuchado recientemente" });
      assert.equal(await page.$eval('[data-testid="quick-tile"]', (tile) => tile.dataset.context), "album:F0000000000000002");
    }),
  );
});

describe("Listas locales y «Me gusta»", () => {
  prueba("Crear una lista, añadirle canciones, editar nombre, descripción y foto, recargar y borrarla", () =>
    withPage(browser, VIEWPORTS.escritorio, async (page) => {
      const dir = await mkdtemp(join(tmpdir(), "reminiscencia-e2e-"));
      const foto = join(dir, "foto.png");
      await writeFile(foto, pngImage(900, 600));
      await openApp(page, server.url);
      const id = await createPlaylist(page, VIEWPORTS.escritorio);
      assert.match(id, /^P[0-9a-f]{16}$/);
      assert.equal(await textOf(page, "collection-title"), "Mi lista n.º 1");
      assert.match(await textOf(page, "collection-meta"), /^Reminiscencia • 0 canciones$/);
      await waitVisible(page, "collection-empty");
      await clickTestid(page, "playlist-add-button", "Añadir la primera canción sugerida");
      await page.waitForFunction(() => document.querySelectorAll('[data-testid="track-row"]').length === 1);
      // Añadir desde el menú de otra colección.
      await openCollection(page, FOLDER_B);
      await openRowMenu(page, "S0000000000000012");
      await pickMenu(page, "menu-add-playlist");
      await pickMenu(page, "menu-playlist");
      await openCollection(page, `#/lista/${id}`);
      await page.waitForFunction(() => document.querySelectorAll('[data-testid="track-row"]').length === 2);
      // Editar detalles desde la portada: nombre, descripción y una foto del dispositivo (900 × 600 → 600 × 600).
      await clickTestid(page, "collection-edit", "portada de la lista");
      await waitVisible(page, "playlist-edit");
      await fillField(await waitVisible(page, "playlist-edit-name"), "Para el domingo");
      await fillField(await waitVisible(page, "playlist-edit-description"), "Canciones para escuchar juntos");
      const input = await page.$('[data-testid="playlist-edit-file"]');
      await input.uploadFile(foto);
      await page.waitForFunction(() => /Foto lista/.test(document.querySelector('[data-testid="playlist-edit-status"]')?.textContent ?? ""), { timeout: 10000 });
      await clickTestid(page, "playlist-edit-save", "Guardar");
      assert.ok(await waitHidden(page, "playlist-edit"), "La hoja se cierra al guardar.");
      await page.waitForFunction(() => document.querySelector('[data-testid="collection-title"]')?.textContent === "Para el domingo");
      assert.equal(await textOf(page, "collection-description"), "Canciones para escuchar juntos");
      const tamano = await page.waitForFunction(() => {
        const img = document.querySelector(".collection-cover img");
        return img && img.complete && img.naturalWidth > 0 && img.src.startsWith("data:image/jpeg;base64,") ? [img.naturalWidth, img.naturalHeight] : null;
      }, { timeout: 5000 });
      assert.deepEqual(await tamano.jsonValue(), [600, 600], "La foto se recorta en cuadrado (y nunca pasa de 640 px).");
      // Se conserva al recargar: vive en IndexedDB de este navegador.
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForSelector('html[data-ready="true"]');
      assert.equal(await textOf(page, "collection-title"), "Para el domingo");
      assert.equal(await page.$$eval('[data-testid="track-row"]', (rows) => rows.length), 2);
      assert.match(await page.$eval(`[data-testid="sidebar-item"][data-context="lista:${id}"] .cover-img`, (img) => img.src), /^data:image\/jpeg/);
      // Quitar la foto.
      const opciones = await openCollectionMenu(page);
      assert.deepEqual(opciones, ["Añadir a la cola", "Editar detalles", "Borrar la lista"]);
      await pickMenu(page, "menu-edit-details");
      await clickTestid(page, "playlist-edit-remove-photo", "Quitar foto");
      await clickTestid(page, "playlist-edit-save", "Guardar");
      await page.waitForFunction(() => !document.querySelector(".collection-cover img")?.src?.startsWith("data:"), { timeout: 5000 });
      // Borrar.
      await openCollectionMenu(page);
      await pickMenu(page, "menu-delete-playlist");
      await clickTestid(page, "confirm-ok", "confirmar el borrado");
      await waitVisible(page, "view-home", { context: "Inicio tras borrar la lista" });
      assert.equal(await page.$(`[data-context="lista:${id}"]`), null, "La lista borrada no debe quedar en la biblioteca.");
    }),
  );

  prueba("Una foto que no es imagen se rechaza y un nombre vacío no se guarda", () =>
    withPage(browser, VIEWPORTS.telefono, async (page) => {
      const dir = await mkdtemp(join(tmpdir(), "reminiscencia-e2e-"));
      const texto = join(dir, "nota.txt");
      await writeFile(texto, "no es una imagen");
      await openApp(page, server.url);
      await createPlaylist(page, VIEWPORTS.telefono);
      await clickTestid(page, "collection-edit", "portada de la lista");
      const input = await page.$('[data-testid="playlist-edit-file"]');
      await input.uploadFile(texto);
      await page.waitForFunction(() => /JPG, PNG o WebP/.test(document.querySelector('[data-testid="playlist-edit-status"]')?.textContent ?? ""));
      await fillField(await waitVisible(page, "playlist-edit-name"), "   ");
      await clickTestid(page, "playlist-edit-save", "Guardar");
      await page.waitForFunction(() => /Escribe un nombre/.test(document.querySelector('[data-testid="playlist-edit"] .field-error:not([hidden])')?.textContent ?? ""));
      assert.equal(await isVisible(page, "playlist-edit"), true, "La hoja sigue abierta.");
    }),
  );

  prueba("«Me gusta» desde la fila, desde el reproductor y para un álbum entero; la lista «Me gusta» las muestra", () =>
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
      assert.equal(await page.$eval('[data-testid="player-like"]', (el) => el.getAttribute("aria-pressed")), "true");
      await clickTestid(page, "player-like", "quitar Me gusta desde el reproductor");
      await waitVisible(page, "collection-empty", { context: "«Me gusta» vacía" });
      // El corazón de la barra de acciones guarda el álbum entero.
      await openCollection(page, FOLDER_B);
      await clickTestid(page, "collection-like", "Me gusta del álbum");
      await page.waitForFunction(() => document.querySelector('[data-testid="collection-like"]')?.getAttribute("aria-pressed") === "true");
      await openCollection(page, "#/me-gusta");
      assert.equal(await page.$$eval('[data-testid="track-row"]', (rows) => rows.length), 8);
    }),
  );
});

describe("Editar canciones y álbumes (incidencias de GitHub)", () => {
  prueba("«Editar detalles» de una canción prepara edit_song con el título y el artista", () =>
    withPage(browser, VIEWPORTS.escritorio, async (page) => {
      await openApp(page, server.url);
      await openCollection(page, FOLDER_A);
      const opciones = await openRowMenu(page, "S0000000000000003");
      for (const opcion of ["Editar detalles", "Añadir a un álbum", "Cambiar portada", "Ir al álbum"]) assert.ok(opciones.includes(opcion), opciones.join(", "));
      await pickMenu(page, "menu-edit-song");
      await waitVisible(page, "edit-song");
      assert.match(await textOf(page, "edit-note"), /permiso de escritura en el repositorio.*llega a todos en un par de minutos/);
      assert.equal(await page.$eval('[data-testid="edit-song-link"]', (a) => a.getAttribute("aria-disabled")), "true", "Sin cambios no hay petición.");
      await fillField(await waitVisible(page, "edit-song-title"), "Charleston nuevo");
      await fillField(await waitVisible(page, "edit-song-artist"), "Orquesta ficticia");
      const issue = await issuePayload(page, "edit-song-link");
      assert.equal(issue.origin, "https://github.com/seryi47/reminiscencia/issues/new");
      assert.equal(issue.labels, "biblioteca");
      assert.deepEqual(issue.payload, { op: "edit_song", song_id: "S0000000000000003", title: "Charleston nuevo", artist: "Orquesta ficticia" });
      assert.equal(await page.$eval('[data-testid="edit-song-link"]', (a) => [a.target, a.rel].join()), "_blank,noopener noreferrer");
      // Un título vacío marca el campo y desactiva el enlace.
      await fillField(await waitVisible(page, "edit-song-title"), " ");
      await page.waitForFunction(() => document.querySelector('[data-testid="edit-song-link"]').getAttribute("aria-disabled") === "true");
      assert.match(await page.$eval('[data-testid="edit-song"] .field-error:not([hidden])', (el) => el.textContent), /no puede quedar en blanco/);
      await page.keyboard.press("Escape");
      assert.equal(await page.evaluate(() => document.activeElement?.dataset.testid), "row-more", "El foco vuelve a «Más opciones».");
    }),
  );

  prueba("«Añadir a un álbum» prepara edit_song con folder_id (o null para sacarla del álbum)", () =>
    withPage(browser, VIEWPORTS.escritorio, async (page) => {
      await openApp(page, server.url);
      await openCollection(page, FOLDER_A);
      await openRowMenu(page, "S0000000000000004");
      await pickMenu(page, "menu-move-album");
      await waitVisible(page, "move-album");
      await page.$$eval('[data-testid="move-album-option"]', (labels) => labels.find((label) => /Álbum de prueba B/.test(label.textContent)).click());
      assert.deepEqual((await issuePayload(page, "move-album-link")).payload, { op: "edit_song", song_id: "S0000000000000004", folder_id: "F0000000000000002" });
      await page.$$eval('[data-testid="move-album-option"]', (labels) => labels.find((label) => /Sin álbum/.test(label.textContent)).click());
      assert.deepEqual((await issuePayload(page, "move-album-link")).payload, { op: "edit_song", song_id: "S0000000000000004", folder_id: null });
    }),
  );

  prueba("«Editar detalles» y «Cambiar portada» de un álbum; «Crear» › «Álbum» prepara create_folder", () =>
    withPage(browser, VIEWPORTS.escritorio, async (page) => {
      await openApp(page, server.url);
      await openCollection(page, FOLDER_A);
      const opciones = await openCollectionMenu(page);
      assert.deepEqual(opciones, ["Añadir a la cola", "Editar detalles", "Cambiar portada"]);
      await page.keyboard.press("Escape");
      await clickTestid(page, "collection-edit", "Editar detalles desde la portada");
      await waitVisible(page, "edit-album");
      assert.equal(await page.$eval('[data-testid="edit-album-artist"]', (el) => el.value), "Artista de prueba A");
      await fillField(await waitVisible(page, "edit-album-name"), "Álbum renombrado");
      assert.deepEqual((await issuePayload(page, "edit-album-link")).payload, { op: "edit_folder", folder_id: ALBUM_A_ID, name: "Álbum renombrado", artist: "Artista de prueba A" });
      // Sin nombre no hay petición (el campo admite como mucho 80 caracteres, como el backend).
      assert.equal(await page.$eval('[data-testid="edit-album-artist"]', (el) => el.maxLength), 80);
      await fillField(await waitVisible(page, "edit-album-name"), " ");
      await page.waitForFunction(() => document.querySelector('[data-testid="edit-album-link"]').getAttribute("aria-disabled") === "true");
      // Desde la hoja se pasa a «Cambiar portada».
      await clickTestid(page, "edit-album-cover", "Cambiar portada");
      await waitVisible(page, "cover-sheet");
      assert.equal(await page.$eval('[data-testid="cover-id"]', (el) => el.value), ALBUM_A_ID);
      assert.equal(await page.$eval('[data-testid="cover-github-link"]', (a) => a.href), "https://github.com/seryi47/reminiscencia/upload/main/audio-library/buzon/portadas");
      const reglas = await textOf(page, "cover-rules");
      for (const regla of [/JPG, PNG o WebP, de hasta 10 MB/, /F0000000000000001\.jpg/, /640 × 640/, /permiso de escritura/, /par de minutos/]) assert.match(reglas, regla);
      await clickTestid(page, "cover-copy", "Copiar el ID");
      await page.waitForFunction(() => /ID/.test(document.querySelector('[data-testid="toast"]').textContent), { timeout: 3000 });
      await page.keyboard.press("Escape");
      // Crear un álbum.
      await createMenu(page, VIEWPORTS.escritorio, "album");
      await waitVisible(page, "create-album");
      await fillField(await waitVisible(page, "create-album-name"), "Valses de prueba");
      assert.deepEqual((await issuePayload(page, "create-album-link")).payload, { op: "create_folder", name: "Valses de prueba" });
      await fillField(await waitVisible(page, "create-album-artist"), "Orquesta ficticia");
      const issue = await issuePayload(page, "create-album-link");
      assert.deepEqual(issue.payload, { op: "create_folder", name: "Valses de prueba", artist: "Orquesta ficticia" });
      assert.equal(issue.title, "Crear el álbum «Valses de prueba»");
    }),
  );

  prueba("Una canción subida a este navegador no se edita en GitHub", () =>
    withPage(browser, VIEWPORTS.escritorio, async (page) => {
      await openApp(page, server.url);
      await seedLocalSong(page, { id: "L0011223344556677", title: "Canción local de prueba" });
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForSelector('html[data-ready="true"]');
      await openCollection(page, "#/locales");
      const opciones = await openRowMenu(page, "L0011223344556677");
      for (const opcion of ["Editar detalles", "Añadir a un álbum", "Cambiar portada"]) assert.equal(opciones.includes(opcion), false, opcion);
      assert.ok(opciones.includes("Borrar de este navegador"));
    }),
  );
});

describe("Subir canciones", () => {
  const ESTADOS_EN_MARCHA = ["cola", "convirtiendo", "subiendo"];

  // Publica en data/songs.json del servidor de pruebas una canción nueva (como haría el workflow buzon).
  function publicar(...nuevas) {
    const songs = JSON.parse(cancionesBase);
    for (const { id, title } of nuevas) {
      songs.push({ id, title, artist: "", year: null, tags: [], folder_id: null, duration_s: 1.5, license: "Dato ficticio para pruebas automáticas", audio: `audio/${id}.opus` });
      catalogo.set(`/audio/${id}.opus`, catalogo.get("/audio/S0000000000000001.opus"));
    }
    catalogo.set("/data/songs.json", { body: JSON.stringify(songs), type: "application/json; charset=utf-8" });
  }

  function restaurarCatalogo() {
    catalogo.set("/data/songs.json", { body: cancionesBase, type: "application/json; charset=utf-8" });
  }

  // Comprobación de songs.json cada 0,2 s en lugar de cada 15 s (solo en la prueba) y registro de cada texto de estado.
  async function prepararPagina(page) {
    await page.evaluateOnNewDocument(() => {
      const original = window.setTimeout;
      window.setTimeout = function (fn, ms, ...rest) {
        return original.call(window, fn, ms === 15000 ? 200 : ms, ...rest);
      };
      window.__estados = [];
      new MutationObserver(() => {
        for (const node of document.querySelectorAll('[data-testid="upload-item-status"]')) {
          const text = `${node.closest("li").querySelector('[data-testid="upload-item-name"]').textContent}: ${node.textContent}`;
          if (window.__estados.at(-1) !== text && !window.__estados.includes(text)) window.__estados.push(text);
        }
      }).observe(document, { subtree: true, childList: true, characterData: true });
    });
  }

  async function wavFiles(names) {
    const dir = await mkdtemp(join(tmpdir(), "reminiscencia-e2e-"));
    const paths = [];
    for (const name of names) {
      const path = join(dir, name);
      await writeFile(path, wavTone(1.5));
      paths.push(path);
    }
    return paths;
  }

  // Elige los archivos en la hoja; con wait, espera a que todos hayan salido de la conversión y el envío.
  async function uploadWavs(page, names, { wait = true } = {}) {
    const paths = await wavFiles(names);
    const soporte = await textOf(page, "upload-support").catch(() => "");
    assert.equal(soporte, "", `Este Chrome no convierte a Opus: ${soporte}`);
    const input = await page.$('[data-testid="upload-file-input"]');
    await input.uploadFile(...paths);
    if (wait) await waitRows(page, names.length);
  }

  async function waitRows(page, count) {
    await page.waitForFunction((total, enMarcha) => {
      const rows = [...document.querySelectorAll('[data-testid="upload-item"]')];
      return rows.length === total && rows.every((row) => !enMarcha.includes(row.dataset.state));
    }, { timeout: 60000 }, count, ESTADOS_EN_MARCHA);
  }

  const filas = (page) => page.$$eval('[data-testid="upload-item"]', (rows) => rows.map((row) => [
    row.dataset.state,
    row.querySelector('[data-testid="upload-item-name"]').textContent,
    row.querySelector('[data-testid="upload-item-status"]').textContent,
  ]));

  const waitState = (page, name, state, timeout = 30000) => page.waitForFunction((n, st) => [...document.querySelectorAll('[data-testid="upload-item"]')]
    .some((row) => row.querySelector('[data-testid="upload-item-name"]').textContent === n && row.dataset.state === st), { timeout }, name, state);

  const toastText = (page, text) => page.waitForFunction((t) => document.querySelector('[data-testid="toast"]')?.textContent === t, { timeout: 30000 }, text);

  prueba("Una sola opción: convierte cada archivo a Opus y lo sube a /api/subir, de uno en uno y en orden, con cada paso a la vista", () =>
    withPage(browser, VIEWPORTS.escritorio, async (page) => {
      subidas.length = 0;
      restaurarCatalogo();
      await prepararPagina(page);
      await openApp(page, server.url);
      await openUpload(page, VIEWPORTS.escritorio);
      // Sin elección «Solo en este navegador / Para todos» y sin casilla: solo el texto fijo de derechos.
      assert.equal(await page.$('[data-testid^="upload-option-"]'), null);
      assert.equal(await page.$('[data-testid="upload-sheet"] input[type="checkbox"]'), null);
      assert.equal(await textOf(page, "upload-rights"), "Al subir, declaras que tienes derecho a publicar estos archivos.");
      assert.equal(await isVisible(page, "upload-local"), false, "sin canciones locales no se muestra su lista");

      await uploadWavs(page, ["Tono de prueba.wav", "Mi canción.wav"]);

      assert.deepEqual(subidas.map((item) => [item.name, item.index, item.total, item.type]), [
        ["Tono de prueba.wav", 0, 1, "audio/ogg"],
        ["Mi canción.wav", 0, 1, "audio/ogg"],
      ]);
      assert.notEqual(subidas[0].id, subidas[1].id, "un id de subida por archivo");
      for (const item of subidas) {
        assert.match(item.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
        assert.equal(item.body.subarray(0, 4).toString("latin1"), "OggS", "el cuerpo ya es Ogg Opus");
        assert.equal(item.body.subarray(28, 36).toString("latin1"), "OpusHead");
        assert.ok(item.body.length < 64 * 1024, `1,5 s de Opus pesa poco (${item.body.length} bytes)`);
      }
      await waitState(page, "Mi canción.wav", "publicandose");
      assert.deepEqual(await filas(page), [
        ["publicandose", "Tono de prueba.wav", "Publicándose… (suele tardar 2–3 minutos)"],
        ["publicandose", "Mi canción.wav", "Publicándose… (suele tardar 2–3 minutos)"],
      ]);
      assert.equal(await textOf(page, "upload-summary"), "0 de 2 publicadas");
      const estados = await page.evaluate(() => window.__estados.filter((text) => text.startsWith("Tono de prueba.wav")));
      for (const paso of ["En cola", "Convirtiendo a Opus…", "Guardada en GitHub", "Publicándose… (suele tardar 2–3 minutos)"]) {
        assert.ok(estados.includes(`Tono de prueba.wav: ${paso}`), `pasa por «${paso}»: ${estados.join(" | ")}`);
      }
      assert.ok(estados.some((text) => /^Tono de prueba\.wav: Subiendo… \d+\u00a0%$/.test(text)), `pasa por «Subiendo… N %»: ${estados.join(" | ")}`);
      // El nombre largo se corta con elipsis y entero va en title.
      assert.equal(await page.$eval('[data-testid="upload-item-name"]', (node) => [node.title, getComputedStyle(node).textOverflow].join("|")), "Tono de prueba.wav|ellipsis");
      // Mientras se publican, una copia local en este navegador (se borra al publicarse).
      assert.equal(await countLocalSongs(page), 2);
    }),
  );

  prueba("La canción sale ya en la biblioteca y suena; al publicarse se sustituye por la pública sin recargar ni cortar", () =>
    withPage(browser, VIEWPORTS.escritorio, async (page) => {
      subidas.length = 0;
      restaurarCatalogo();
      await prepararPagina(page);
      await openApp(page, server.url);
      await waitServiceWorker(page);
      await page.evaluate(() => { window.__sinRecargar = true; });
      await openUpload(page, VIEWPORTS.escritorio);
      await uploadWavs(page, ["Tono nuevo.wav"]);
      assert.equal(await textOf(page, "upload-indicator"), "Publicándose 1 canción");
      await page.keyboard.press("Escape");
      await waitHidden(page, "upload-sheet");

      // «Tus subidas» en Tu biblioteca, «Todas las canciones» y «Añadidas recientemente», con «Publicándose…».
      const biblioteca = await page.$$eval('[data-testid="sidebar-list"] .library-item', (items) => items.map((item) => item.textContent));
      assert.ok(biblioteca.some((text) => /Tus subidas/.test(text) && /Publicándose…/.test(text)), biblioteca.join(" | "));
      await openCollection(page, "#/canciones");
      const fila = await page.waitForSelector('[data-testid="track-row"]:has([data-testid="track-pending"])');
      assert.match(await fila.evaluate((row) => row.textContent), /Tono nuevo.*Publicándose…/);
      const localId = await fila.evaluate((row) => row.dataset.songId);
      assert.match(localId, /^L[0-9a-f]{16}$/);
      await openCollection(page, "#/subidas");
      await playRow(page, 0);
      assert.match((await audioState(page)).src, new RegExp(`/audio/${localId}\\.opus$`));
      await page.waitForFunction(() => document.getElementById("audio").currentTime > 0.2, { timeout: 10000 });

      publicar({ id: "S00000000000000aa", title: "Tono nuevo" });
      await toastText(page, "“Tono nuevo” ya está en la biblioteca");
      // Sigue sonando la misma fuente: no se corta.
      const estado = await audioState(page);
      assert.equal(estado.paused, false);
      assert.match(estado.src, new RegExp(`/audio/${localId}\\.opus$`));
      assert.equal(await page.evaluate(() => window.__sinRecargar), true, "sin recargar la página");
      assert.equal(await isVisible(page, "upload-indicator", 500), false);
      await openCollection(page, "#/canciones");
      await page.waitForSelector('[data-testid="track-row"][data-song-id="S00000000000000aa"]');
      assert.equal(await page.$('[data-testid="track-pending"]'), null, "ya no lleva «Publicándose…»");
      assert.equal(await page.$('[data-testid="sidebar-list"] [data-context="subidas"]'), null, "«Tus subidas» se va al quedar vacía");
      // La copia local se borra en cuanto deja de sonar (al poner otra canción).
      await playRow(page, 0);
      await page.waitForFunction(async () => {
        const db = await new Promise((resolve) => { const r = indexedDB.open("reminiscencia-audio-local"); r.onsuccess = () => resolve(r.result); });
        const count = await new Promise((resolve) => { const r = db.transaction("pistas").objectStore("pistas").count(); r.onsuccess = () => resolve(r.result); });
        db.close();
        return count === 0;
      }, { timeout: 10000, polling: 200 });

      await openUpload(page, VIEWPORTS.escritorio);
      assert.deepEqual(await filas(page), [["publicada", "Tono nuevo.wav", "Publicada"]]);
      assert.equal(await textOf(page, "upload-summary"), "1 de 1 publicada");
      await clickTestid(page, "upload-item-play", "Reproducir");
      await page.waitForFunction(() => /\/audio\/S00000000000000aa\.opus$/.test(document.getElementById("audio").src), { timeout: 10000 });
      restaurarCatalogo();
    }),
  );

  prueba("Un error del servidor se muestra en su archivo, no para los demás y «Reintentar» la vuelve a subir", () =>
    withPage(browser, VIEWPORTS.telefono, async (page) => {
      subidas.length = 0;
      fallidasUnaVez.clear();
      restaurarCatalogo();
      await prepararPagina(page);
      await openApp(page, server.url);
      await openUpload(page, VIEWPORTS.telefono);
      await uploadWavs(page, ["Este se cae una-vez.wav", "Este sube.wav"]);
      assert.deepEqual(subidas.map((item) => item.name), ["Este se cae una-vez.wav", "Este sube.wav"]);
      await waitState(page, "Este sube.wav", "publicandose");
      assert.deepEqual(await filas(page), [
        ["error", "Este se cae una-vez.wav", "Error: El archivo no es Ogg Opus."],
        ["publicandose", "Este sube.wav", "Publicándose… (suele tardar 2–3 minutos)"],
      ]);
      assert.equal(await textOf(page, "upload-summary"), "0 de 2 publicadas · 1 con error");
      assert.equal(await page.$eval('[data-testid="upload-live"]', (node) => node.getAttribute("aria-live")), "polite");

      await clickTestid(page, "upload-item-retry", "Reintentar");
      // El botón desaparece y el foco pasa a su fila (no se pierde en el documento).
      assert.equal(await page.evaluate(() => document.activeElement?.dataset.testid), "upload-item");
      await waitState(page, "Este se cae una-vez.wav", "publicandose");
      assert.deepEqual(subidas.map((item) => item.name), ["Este se cae una-vez.wav", "Este sube.wav", "Este se cae una-vez.wav"]);

      publicar({ id: "S00000000000000b1", title: "Este se cae una-vez" }, { id: "S00000000000000b2", title: "Este sube" });
      await waitState(page, "Este se cae una-vez.wav", "publicada");
      await waitState(page, "Este sube.wav", "publicada");
      assert.equal(await textOf(page, "upload-summary"), "2 de 2 publicadas");
      assert.match(await page.$eval('[data-testid="upload-live"]', (node) => node.textContent), /Publicada/);
      restaurarCatalogo();
    }),
  );

  prueba("Al cerrar la hoja con una subida a medias, sigue: indicador en la barra lateral, aviso y biblioteca al día sin recargar", () =>
    withPage(browser, VIEWPORTS.escritorio, async (page) => {
      subidas.length = 0;
      restaurarCatalogo();
      await prepararPagina(page);
      await openApp(page, server.url);
      await page.evaluate(() => { window.__sinRecargar = true; });
      await openUpload(page, VIEWPORTS.escritorio);
      await uploadWavs(page, ["Canción lenta.wav"], { wait: false });
      await page.waitForFunction(() => ["convirtiendo", "subiendo"].includes(document.querySelector('[data-testid="upload-item"]')?.dataset.state), { timeout: 30000 });
      await clickTestid(page, "upload-sheet-close", "Cerrar la hoja");
      await waitHidden(page, "upload-sheet");
      assert.equal(await textOf(page, "upload-indicator"), "Publicándose 1 canción");
      // Lo que queda por comprobar se guarda en localStorage.
      await page.waitForFunction(() => JSON.parse(localStorage.getItem("reminiscencia.subidas") ?? "{}").items?.some((item) => item.state === "guardada" || item.state === "publicandose"), { timeout: 30000 });
      assert.deepEqual(subidas.map((item) => item.name), ["Canción lenta.wav"]);

      publicar({ id: "S00000000000000c1", title: "Canción lenta" });
      await toastText(page, "“Canción lenta” ya está en la biblioteca");
      assert.equal(await isVisible(page, "upload-indicator", 500), false);
      await openCollection(page, "#/canciones");
      await page.waitForSelector('[data-testid="track-row"][data-song-id="S00000000000000c1"]');
      assert.equal(await page.evaluate(() => window.__sinRecargar), true, "sin recargar la página");
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("reminiscencia.subidas") ?? "null")), null, "ya no queda nada pendiente");
      restaurarCatalogo();
    }),
  );

  prueba("Un ZIP con subcarpetas, __MACOSX y otros archivos, mezclado con una suelta y un ZIP dañado: cada canción sube y se publica en su grupo", () =>
    withPage(browser, VIEWPORTS.escritorio, async (page) => {
      subidas.length = 0;
      restaurarCatalogo();
      await prepararPagina(page);
      await openApp(page, server.url);
      await openUpload(page, VIEWPORTS.escritorio);
      assert.match(await page.$eval('[data-testid="upload-file-input"]', (input) => input.accept), /\.zip/);

      const dir = await mkdtemp(join(tmpdir(), "reminiscencia-e2e-zip-"));
      const album = join(dir, "Álbum de prueba.zip");
      await writeFile(album, buildZip([
        { path: "Disco/", data: [] },
        { path: "Disco/01 Vals del zip.wav", data: wavTone(1.5), method: 8 },
        { path: "Disco/Cara B/02 Copla del zip.wav", data: wavTone(1.5), method: 0 },
        { path: "__MACOSX/Disco/._01 Vals del zip.wav", data: Buffer.from("metadatos") },
        { path: "Disco/portada.jpg", data: Buffer.from("no es audio") },
      ]));
      const roto = join(dir, "Roto.zip");
      await writeFile(roto, Buffer.from("esto no es un ZIP de verdad"));
      const [suelta] = await wavFiles(["Suelta del zip.wav"]);
      const soporte = await textOf(page, "upload-support").catch(() => "");
      assert.equal(soporte, "", `Este Chrome no convierte a Opus: ${soporte}`);
      const input = await page.$('[data-testid="upload-file-input"]');
      await input.uploadFile(album, suelta, roto);
      await waitRows(page, 4);

      // Solo se envía el Opus de cada canción, de una en una y con su nombre base: el ZIP nunca.
      assert.deepEqual(subidas.map((item) => [item.name, item.index, item.total]), [
        ["01 Vals del zip.wav", 0, 1],
        ["02 Copla del zip.wav", 0, 1],
        ["Suelta del zip.wav", 0, 1],
      ]);
      for (const item of subidas) assert.equal(item.body.subarray(0, 4).toString("latin1"), "OggS", `${item.name} va en Ogg Opus`);

      const grupos = await page.$$eval('[data-testid="upload-group"]', (groups) => groups.map((group) => [
        group.querySelector('[data-testid="upload-group-title"]').textContent,
        group.querySelector('[data-testid="upload-group-note"]')?.textContent ?? "",
        [...group.querySelectorAll('[data-testid="upload-item-name"]')].map((node) => node.textContent),
      ]));
      assert.deepEqual(grupos, [
        ["Álbum de prueba.zip: 2 canciones", "Se ignoraron 2 archivos que no son canciones (carpetas del sistema, ocultos u otros tipos).", ["01 Vals del zip.wav", "02 Copla del zip.wav"]],
        ["Roto.zip: ninguna canción", "", ["Roto.zip"]],
      ]);
      const suelto = await page.$$eval('[data-testid="upload-items"] > [data-testid="upload-item"]', (rows) => rows.map((row) => row.querySelector('[data-testid="upload-item-name"]').textContent));
      assert.deepEqual(suelto, ["Suelta del zip.wav"], "la suelta va fuera de los grupos");
      await waitState(page, "02 Copla del zip.wav", "publicandose");
      await waitState(page, "Suelta del zip.wav", "publicandose");
      assert.deepEqual((await filas(page)).find((fila) => fila[1] === "Roto.zip"), ["error", "Roto.zip", "Error: El archivo ZIP está dañado o no es un ZIP válido."]);
      assert.equal(await page.$('[data-testid="upload-group"] [data-testid="upload-item-retry"]'), null, "un ZIP dañado no ofrece Reintentar");
      assert.equal(await textOf(page, "upload-summary"), "0 de 4 publicadas · 1 con error");
      assert.match(await page.$eval('[data-testid="upload-live"]', (node) => node.textContent), /Álbum de prueba\.zip: 2 canciones|Publicándose/);

      publicar(
        { id: "S00000000000000e1", title: "01 Vals del zip" },
        { id: "S00000000000000e2", title: "02 Copla del zip" },
        { id: "S00000000000000e3", title: "Suelta del zip" },
      );
      for (const nombre of ["01 Vals del zip.wav", "02 Copla del zip.wav", "Suelta del zip.wav"]) await waitState(page, nombre, "publicada");
      assert.equal(await textOf(page, "upload-summary"), "3 de 4 publicadas · 1 con error");
      await capture(page, "subida-zip");
      const fallos = (await wcagViolations(page)).filter((v) => v.impacto === "serious" || v.impacto === "critical");
      assert.deepEqual(fallos, []);
      restaurarCatalogo();
    }),
  );

  prueba("Captura de la hoja con varios estados", () =>
    withPage(browser, VIEWPORTS.escritorio, async (page) => {
      subidas.length = 0;
      fallidasUnaVez.clear();
      restaurarCatalogo();
      await prepararPagina(page);
      await openApp(page, server.url);
      await openUpload(page, VIEWPORTS.escritorio);
      await uploadWavs(page, ["Vals de la tarde.wav", "Este falla.wav", "Bolero con un nombre de archivo muy largo que no cabe en la fila.wav"]);
      publicar({ id: "S00000000000000d1", title: "Vals de la tarde" });
      await waitState(page, "Vals de la tarde.wav", "publicada");
      await uploadWavs(page, ["Copla lenta.wav"], { wait: false });
      await page.waitForFunction(() => document.querySelectorAll('[data-testid="upload-item"][data-state="subiendo"]').length === 1, { timeout: 30000 });
      const estados = await page.$$eval('[data-testid="upload-item"]', (rows) => rows.map((row) => row.dataset.state));
      assert.deepEqual(estados, ["publicada", "error", "publicandose", "subiendo"]);
      assert.equal(await textOf(page, "upload-summary"), "1 de 4 publicadas · 1 con error");
      await capture(page, "subida-estados");
      // Accesibilidad de la hoja con filas en todos esos estados (mismo criterio que a11y.e2e.mjs).
      const fallos = (await wcagViolations(page)).filter((v) => v.impacto === "serious" || v.impacto === "critical");
      assert.deepEqual(fallos, []);
      await waitRows(page, 4);
      restaurarCatalogo();
    }),
  );

  prueba("Una canción local de antes suena por el service worker y se borra desde la hoja; una pública no se borra", () =>
    withPage(browser, VIEWPORTS.escritorio, async (page) => {
      // El Opus que convierte el navegador sirve de canción local guardada antes de ADR-0017.
      subidas.length = 0;
      await openApp(page, server.url);
      await waitServiceWorker(page);
      await openUpload(page, VIEWPORTS.escritorio);
      await uploadWavs(page, ["Tono local.wav"]);
      await seedLocalSong(page, { id: "L0011223344556677", title: "Canción local de prueba", blob: [...subidas[0].body] });
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForSelector('html[data-ready="true"]');
      await waitServiceWorker(page);

      await openCollection(page, FOLDER_A);
      const publicas = await openRowMenu(page, SONG_1);
      await page.keyboard.press("Escape");
      assert.equal(publicas.includes("Borrar de este navegador"), false);

      await openCollection(page, "#/locales");
      await playRow(page, 0);
      const estado = await audioState(page);
      assert.match(estado.src, /\/audio\/L0011223344556677\.opus$/, "La canción local se sirve desde el propio origen (CSP media-src 'self').");
      await page.waitForFunction(() => document.getElementById("audio").currentTime > 0.2, { timeout: 10000 });
      assert.equal((await audioState(page)).error, null);

      await openUpload(page, VIEWPORTS.escritorio);
      assert.equal(await isVisible(page, "upload-local"), true);
      assert.match(await textOf(page, "upload-local-list"), /Canción local de prueba/);
      await clickTestid(page, "upload-delete", "Borrar en la hoja");
      assert.match(await textOf(page, "confirm"), /¿Borrar esta canción de este navegador\? No se puede deshacer\./);
      await clickTestid(page, "confirm-ok", "Borrar");
      await page.waitForFunction(() => document.querySelector('[data-testid="upload-local"]')?.hidden === true);
      // Queda solo la copia de «Tono local», que se está publicando (no sale entre las de antes ni se borra desde aquí).
      assert.equal(await countLocalSongs(page), 1);
    }),
  );

  prueba("«Importar desde Internet Archive» rechaza plataformas bloqueadas y prepara la incidencia con un ítem válido", () =>
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
      // Vuelve a la subida.
      await clickTestid(page, "upload-back", "Volver a Subir canciones");
      await waitVisible(page, "upload-panel", { context: "panel de subida" });
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
