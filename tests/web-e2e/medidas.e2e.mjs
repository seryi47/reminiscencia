// Medidas y colores de DESIGN §3 a §8 (estructura del reproductor web de Spotify), medidos en Chrome con una
// tolerancia de ±2 px. Escritorio a 1440 y 1024 px, tableta a 820 px y teléfono a 390 px.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createTestCatalogOverrides } from "./helpers/catalogo-prueba.mjs";
import { clickTestid, expectInRange, expectSize, measure, TEST_TIMEOUT_MS, waitVisible } from "./helpers/elementos.mjs";
import { createPlaylist, goSection, openApp, openCollection, openUpload, playRow } from "./helpers/flujos.mjs";
import { capture, launchBrowser, VIEWPORTS, withPage } from "./helpers/navegador.mjs";
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
const C = Object.freeze({
  black: "rgb(0, 0, 0)",
  surface: "rgb(18, 18, 18)",
  card: "rgb(24, 24, 24)",
  hover: "rgb(40, 40, 40)",
  elevated: "rgb(36, 36, 36)",
  white: "rgb(255, 255, 255)",
  secondary: "rgb(179, 179, 179)",
  accent: "rgb(31, 223, 100)",
  rowHover: "rgba(255, 255, 255, 0.1)",
});

/** Estilos calculados de un elemento por selector CSS (el primero visible). */
async function styleOf(page, selector, props) {
  const handle = await page.waitForFunction(
    (sel) => [...document.querySelectorAll(sel)].find((el) => window.__e2eIsShown(el)) ?? null,
    { timeout: 8000, polling: 100 },
    selector,
  );
  return handle.asElement().evaluate((el, list) => {
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    const out = { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom };
    for (const prop of list) out[prop] = style.getPropertyValue(prop);
    return out;
  }, props);
}

describe("Escritorio (1440 × 900)", () => {
  prueba("Marco: fondo #000, barra lateral de 280 px y paneles de radio 8 separados 8 px; reproductor de 72 px", () =>
    withPage(browser, VIEWPORTS.escritorio, async (page) => {
      await openApp(page, server.url);
      assert.equal((await styleOf(page, "body", ["background-color"]))["background-color"], C.black);
      const sidebar = await measure(page, "sidebar");
      expectSize("Ancho de la barra lateral", sidebar.width, 280);
      expectSize("Margen izquierdo", sidebar.x, 8);
      const nav = await styleOf(page, '[data-testid="sidebar-nav"]', ["border-radius", "background-color"]);
      const library = await styleOf(page, '[data-testid="sidebar-library"]', ["border-radius", "background-color"]);
      const main = await styleOf(page, '[data-testid="main"]', ["border-radius", "background-color"]);
      for (const [nombre, panel] of [["navegación", nav], ["biblioteca", library], ["contenido", main]]) {
        assert.equal(panel["border-radius"], "8px", `Radio del panel ${nombre}`);
        assert.equal(panel["background-color"], C.surface, `Fondo del panel ${nombre}`);
      }
      expectSize("Separación entre los dos bloques de la barra lateral", library.y - nav.bottom, 8);
      expectSize("Separación entre barra lateral y contenido", main.x - sidebar.right, 8);
      const player = await styleOf(page, '[data-testid="player-bar"]', ["background-color"]);
      expectSize("Alto del reproductor", player.height, 72);
      assert.equal(player["background-color"], C.black);
      expectSize("Separación entre contenido y reproductor", player.y - main.bottom, 8);
      expectSize("El reproductor llega al borde inferior", player.bottom, 900);
      await capture(page, "escritorio-1440-inicio");
    }),
  );

  prueba("Barra lateral: Inicio y Buscar a 16 px y peso 700, inactivo #b3b3b3 y activo #fff; biblioteca con portadas de 48 px", () =>
    withPage(browser, VIEWPORTS.escritorio, async (page) => {
      await openApp(page, server.url);
      // El color cambia con una transición de 0,2 s: se espera a que termine.
      await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-testid="nav-inicio"]')).color === "rgb(255, 255, 255)", { timeout: 3000 }).catch(() => {});
      const inicio = await styleOf(page, '[data-testid="nav-inicio"]', ["font-size", "font-weight", "color", "font-family"]);
      const buscar = await styleOf(page, '[data-testid="nav-buscar"]', ["font-size", "font-weight", "color"]);
      assert.equal(inicio["font-size"], "16px");
      assert.equal(inicio["font-weight"], "700");
      assert.equal(inicio.color, C.white, "Inicio activo en blanco");
      assert.equal(buscar.color, C.secondary, "Buscar inactivo en #b3b3b3");
      assert.match(inicio["font-family"], /^Figtree/);
      assert.ok(await page.evaluate(() => document.fonts.check('700 16px "Figtree"')), "Figtree 700 cargada");
      for (const testid of ["sidebar-create-playlist", "sidebar-upload", "sidebar-chip-listas", "sidebar-chip-carpetas"]) await waitVisible(page, testid);
      const cover = await styleOf(page, '[data-testid="sidebar-item"] .library-cover', ["border-radius"]);
      expectSize("Portada de la biblioteca (ancho)", cover.width, 48);
      expectSize("Portada de la biblioteca (alto)", cover.height, 48);
      assert.equal(cover["border-radius"], "4px");
      const subtitle = await styleOf(page, '[data-testid="sidebar-item"] .library-subtitle', ["color", "font-size"]);
      assert.equal(subtitle.color, C.secondary);
      // El filtro «Carpetas» deja solo carpetas.
      await clickTestid(page, "sidebar-chip-carpetas", "chip Carpetas");
      const nombres = await page.$$eval('[data-testid="sidebar-item"]', (items) => items.map((item) => item.dataset.context));
      assert.ok(nombres.length > 0 && nombres.every((id) => id.startsWith("carpeta:")), nombres.join(", "));
      assert.equal(await page.$eval('[data-testid="sidebar-chip-carpetas"]', (el) => el.getAttribute("aria-pressed")), "true");
    }),
  );

  prueba("Inicio: accesos rápidos de 64 px en 4 columnas y tarjetas de 180 px con botón verde de 48 px al pasar el ratón", () =>
    withPage(browser, VIEWPORTS.escritorio, async (page) => {
      await openApp(page, server.url);
      const tile = await styleOf(page, '[data-testid="quick-tile"]', []);
      expectSize("Alto del acceso rápido", tile.height, 64);
      const tileCover = await styleOf(page, '[data-testid="quick-tile"] .tile-cover', []);
      expectSize("Portada del acceso rápido", tileCover.width, 64);
      expectSize("La portada va a la izquierda", tileCover.x, tile.x);
      const columnas = await page.$eval('[data-testid="quick-grid"]', (el) => getComputedStyle(el).gridTemplateColumns.split(" ").length);
      assert.equal(columnas, 4);
      const card = await styleOf(page, '[data-testid="shelf-folders"] .card', ["background-color"]);
      expectSize("Ancho de la tarjeta", card.width, 180);
      assert.equal(card["background-color"], C.card);
      const title = await styleOf(page, '[data-testid="shelf-folders"] .card-title', ["font-size", "font-weight", "color"]);
      assert.deepEqual([title["font-size"], title["font-weight"]], ["16px", "700"]);
      const subtitle = await styleOf(page, '[data-testid="shelf-folders"] .card-subtitle', ["font-size", "color"]);
      assert.deepEqual([subtitle["font-size"], subtitle.color], ["14px", C.secondary]);
      const cover = await styleOf(page, '[data-testid="shelf-folders"] .card-cover', ["box-shadow"]);
      assert.notEqual(cover["box-shadow"], "none", "La portada lleva sombra.");
      const play = '[data-testid="shelf-folders"] .card [data-testid="card-play"]';
      assert.equal((await styleOf(page, play, ["opacity"])).opacity, "0", "El botón verde no se ve sin hover ni foco.");
      await page.hover('[data-testid="shelf-folders"] .card');
      await new Promise((resolve) => setTimeout(resolve, 400));
      const visible = await styleOf(page, play, ["opacity", "background-color", "border-radius"]);
      assert.equal(visible.opacity, "1");
      assert.equal(visible["background-color"], C.accent);
      expectSize("Botón verde de la tarjeta", visible.width, 48);
      expectSize("Botón verde de la tarjeta (alto)", visible.height, 48);
      assert.equal((await styleOf(page, '[data-testid="shelf-folders"] .card', ["background-color"]))["background-color"], C.hover);
      for (const testid of ["shelf-folders-more", "shelf-recent-more"]) await waitVisible(page, testid);
    }),
  );

  prueba("Carpeta: degradado, portada de 232 px, título hasta 96 px y peso 800, botón de 56 px y filas de 56 px", () =>
    withPage(browser, VIEWPORTS.escritorio, async (page) => {
      await openApp(page, server.url);
      await openCollection(page, "#/me-gusta");
      const corto = await styleOf(page, '[data-testid="collection-title"]', ["font-size", "font-weight"]);
      assert.deepEqual([corto["font-size"], corto["font-weight"]], ["96px", "800"]);
      await openCollection(page, FOLDER_A);
      const header = await styleOf(page, '[data-testid="collection-header"]', ["background-image"]);
      assert.match(header["background-image"], /linear-gradient/);
      const body = await styleOf(page, ".collection-body", ["background-image"]);
      assert.match(body["background-image"], /rgb\(18, 18, 18\)/, "El degradado termina en #121212.");
      const cover = await measure(page, "collection-header").then(() => styleOf(page, ".collection-cover", []));
      expectSize("Portada de la colección", cover.width, 232);
      expectSize("Portada de la colección (alto)", cover.height, 232);
      const title = await styleOf(page, '[data-testid="collection-title"]', ["font-size", "font-weight"]);
      assert.ok(parseFloat(title["font-size"]) <= 96);
      assert.equal(title["font-weight"], "800");
      const play = await styleOf(page, '[data-testid="collection-play"]', ["background-color"]);
      expectSize("Botón verde de la colección", play.width, 56);
      assert.equal(play["background-color"], C.accent);
      await waitVisible(page, "collection-shuffle");
      const row = await styleOf(page, '[data-testid="track-row"]', []);
      expectSize("Alto de la fila", row.height, 56);
      const rowCover = await styleOf(page, '[data-testid="track-row"] .track-cover', []);
      expectSize("Portada de la fila", rowCover.width, 40);
      const headers = await page.$$eval(".track-table thead th", (cells) => cells.map((cell) => cell.textContent.trim()));
      assert.deepEqual(headers, ["#", "Título", "Duración y acciones"]);
      await page.hover('[data-testid="track-row"]:nth-child(2)');
      await new Promise((resolve) => setTimeout(resolve, 300));
      const hover = await styleOf(page, '[data-testid="track-row"]:nth-child(2) td', ["background-color"]);
      assert.equal(hover["background-color"], C.rowHover);
      await playRow(page, 0);
      const sonando = await styleOf(page, '[data-testid="track-row"]:nth-child(1) .track-title', ["color"]);
      assert.equal(sonando.color, C.accent, "La fila que suena va en verde.");
      await capture(page, "escritorio-1440-carpeta");
    }),
  );

  prueba("Una lista muestra la columna Carpeta", () =>
    withPage(browser, VIEWPORTS.escritorio, async (page) => {
      await openApp(page, server.url);
      await createPlaylist(page, VIEWPORTS.escritorio);
      await clickTestid(page, "playlist-add-button", "Añadir");
      await page.waitForSelector('[data-testid="track-row"]');
      const headers = await page.$$eval(".track-table thead th", (cells) => cells.map((cell) => cell.textContent.trim()));
      assert.deepEqual(headers, ["#", "Título", "Carpeta", "Duración y acciones"]);
    }),
  );

  prueba("Buscar: campo de 48 px redondeado sobre #242424", () =>
    withPage(browser, VIEWPORTS.escritorio, async (page) => {
      await openApp(page, server.url);
      await goSection(page, "buscar", VIEWPORTS.escritorio);
      const input = await styleOf(page, '[data-testid="search-input"]', ["background-color", "border-top-left-radius"]);
      expectSize("Alto del campo de búsqueda", input.height, 48);
      assert.equal(input["background-color"], C.elevated);
      assert.ok(parseFloat(input["border-top-left-radius"]) >= 24, "El campo es redondeado.");
      await waitVisible(page, "browse-grid");
    }),
  );

  prueba("Reproductor: portada de 56 px, reproducir en círculo blanco de 32 px y progreso de 4 px (verde con hover)", () =>
    withPage(browser, VIEWPORTS.escritorio, async (page) => {
      await openApp(page, server.url);
      await openCollection(page, FOLDER_A);
      await playRow(page, 0);
      const cover = await styleOf(page, '[data-testid="player-cover"] .player-cover', []);
      expectSize("Portada del reproductor", cover.width, 56);
      const play = await styleOf(page, '[data-testid="player-play"]', ["background-color", "border-radius"]);
      expectSize("Botón reproducir", play.width, 32);
      expectSize("Botón reproducir (alto)", play.height, 32);
      assert.equal(play["background-color"], C.white);
      assert.equal(play["border-radius"], "50%");
      const track = await styleOf(page, '[data-testid="player-progress-track"]', []);
      expectSize("Alto de la barra de progreso", track.height, 4);
      const fill = '.player-progress .slider-fill';
      assert.equal((await styleOf(page, fill, ["background-color"]))["background-color"], C.white);
      await page.hover('[data-testid="player-progress"]');
      await new Promise((resolve) => setTimeout(resolve, 300));
      assert.equal((await styleOf(page, fill, ["background-color"]))["background-color"], C.accent);
      for (const testid of ["player-shuffle", "player-prev", "player-next", "player-repeat", "player-queue", "player-volume", "player-like", "player-time", "player-duration"]) {
        await waitVisible(page, testid, { context: "control del reproductor" });
      }
      // Orden de izquierda a derecha del centro: aleatorio, anterior, reproducir, siguiente y repetir.
      const xs = [];
      for (const testid of ["player-shuffle", "player-prev", "player-play", "player-next", "player-repeat"]) xs.push((await measure(page, testid)).x);
      assert.deepEqual([...xs].sort((a, b) => a - b), xs);
    }),
  );
});

describe("Escritorio estrecho y tableta", () => {
  prueba("A 1024 px: barra lateral de 280 px y accesos rápidos en 3 columnas", () =>
    withPage(browser, VIEWPORTS.tabletaHorizontal, async (page) => {
      await openApp(page, server.url);
      expectSize("Ancho de la barra lateral", (await measure(page, "sidebar")).width, 280);
      const columnas = await page.$eval('[data-testid="quick-grid"]', (el) => getComputedStyle(el).gridTemplateColumns.split(" ").length);
      assert.equal(columnas, 3);
    }),
  );

  prueba("A 820 px: barra lateral, reproductor de 72 px y accesos rápidos en 2 columnas, sin desplazamiento horizontal", () =>
    withPage(browser, VIEWPORTS.tabletaVertical, async (page) => {
      await openApp(page, server.url);
      await waitVisible(page, "sidebar");
      expectSize("Alto del reproductor", (await measure(page, "player-bar")).height, 72);
      const columnas = await page.$eval('[data-testid="quick-grid"]', (el) => getComputedStyle(el).gridTemplateColumns.split(" ").length);
      assert.equal(columnas, 2);
      const scroll = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.equal(scroll, 0);
    }),
  );
});

describe("Teléfono (390 × 844)", () => {
  prueba("Sin barra lateral; barra inferior de 64 px con degradado desde negro y tres destinos", () =>
    withPage(browser, VIEWPORTS.telefono, async (page) => {
      await openApp(page, server.url);
      assert.equal(await page.$eval('[data-testid="sidebar"]', (el) => el.getClientRects().length), 0, "La barra lateral no se ve.");
      assert.equal(await page.$eval('[data-testid="player-bar"]', (el) => el.getClientRects().length), 0, "La barra del reproductor de escritorio no se ve.");
      const tabbar = await styleOf(page, '[data-testid="tabbar"]', ["background-image"]);
      expectSize("Alto de la barra inferior", tabbar.height, 64);
      expectSize("La barra inferior llega al borde", tabbar.bottom, 844);
      assert.match(tabbar["background-image"], /linear-gradient\(0deg, rgb\(0, 0, 0\)/);
      const labels = await page.$$eval('[data-testid="tabbar"] a', (links) => links.map((link) => link.textContent.trim()));
      assert.deepEqual(labels, ["Inicio", "Buscar", "Tu biblioteca"]);
      const columnas = await page.$eval('[data-testid="quick-grid"]', (el) => getComputedStyle(el).gridTemplateColumns.split(" ").length);
      assert.equal(columnas, 2);
      const scroll = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.equal(scroll, 0, "Sin desplazamiento horizontal.");
    }),
  );

  prueba("Minirreproductor de 56 px redondeado sobre la barra inferior, con progreso fino", () =>
    withPage(browser, VIEWPORTS.telefono, async (page) => {
      await openApp(page, server.url);
      await openCollection(page, FOLDER_A);
      await playRow(page, 0);
      const mini = await styleOf(page, '[data-testid="mini-player"]', ["border-top-left-radius"]);
      const tabbar = await measure(page, "tabbar");
      expectSize("Alto del minirreproductor", mini.height, 56);
      assert.ok(parseFloat(mini["border-top-left-radius"]) > 0, "El minirreproductor es redondeado.");
      expectSize("El minirreproductor va justo encima de la barra inferior", mini.bottom, tabbar.y);
      const progress = await styleOf(page, ".mini-progress", []);
      expectInRange("Alto del progreso del minirreproductor", progress.height, 1, 3);
      await capture(page, "telefono-390-carpeta");
    }),
  );

  prueba("Objetivos táctiles de 44 px o más en Inicio, una carpeta, Buscar, Tu biblioteca, la hoja de subida y la pantalla completa", () =>
    withPage(browser, VIEWPORTS.telefono, async (page) => {
      const pequenos = async (donde) => page.evaluate((zona) => {
        const root = document.querySelector("dialog[open]") ?? document;
        return [...root.querySelectorAll("a[href], button, input, [role='button'], [role='menuitem']")]
          .filter((el) => window.__e2eIsShown(el) && getComputedStyle(el).opacity !== "0" && el.type !== "file")
          .filter((el) => !el.closest("[hidden]") && !el.classList.contains("skip-link"))
          // Un enlace estirado (.card-link, con ::after sobre toda la tarjeta) se mide por su tarjeta.
          .map((el) => ({ el, rect: (el.classList.contains("card-link") ? el.closest(".tile, .card, .top-card") ?? el : el).getBoundingClientRect() }))
          .filter(({ rect }) => rect.bottom > 0 && rect.top < window.innerHeight)
          .filter(({ rect }) => rect.width < 43.5 || rect.height < 43.5)
          .map(({ el, rect }) => `${zona}: ${el.dataset.testid || el.className || el.tagName} ${Math.round(rect.width)}×${Math.round(rect.height)}`);
      }, donde);
      await openApp(page, server.url);
      const fallos = [...(await pequenos("Inicio"))];
      await openCollection(page, FOLDER_A);
      await playRow(page, 0);
      fallos.push(...(await pequenos("Carpeta")));
      await goSection(page, "buscar", VIEWPORTS.telefono);
      fallos.push(...(await pequenos("Buscar")));
      await goSection(page, "biblioteca", VIEWPORTS.telefono);
      fallos.push(...(await pequenos("Tu biblioteca")));
      await openUpload(page, VIEWPORTS.telefono, "archive");
      fallos.push(...(await pequenos("Hoja de subida")));
      await page.keyboard.press("Escape");
      await clickTestid(page, "mini-open", "minirreproductor");
      await waitVisible(page, "full-player");
      fallos.push(...(await pequenos("Pantalla completa")));
      assert.deepEqual(fallos, []);
    }),
  );

  prueba("Captura de Inicio a 390 px", () =>
    withPage(browser, VIEWPORTS.telefono, async (page) => {
      await openApp(page, server.url);
      await capture(page, "telefono-390-inicio");
    }),
  );
});
