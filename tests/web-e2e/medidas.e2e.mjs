// Medidas y colores de DESIGN §2 a §11 (distribución del reproductor web de Spotify de 2025), medidos en Chrome con
// una tolerancia de ±2 px. Escritorio a 1440 y 1024 px, tableta a 820 px y teléfono a 390 px.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createTestCatalogOverrides } from "./helpers/catalogo-prueba.mjs";
import { clickTestid, expectInRange, expectSize, measure, TEST_TIMEOUT_MS, waitVisible } from "./helpers/elementos.mjs";
import { createMenu, createPlaylist, goSection, openApp, openCollection, playRow, search } from "./helpers/flujos.mjs";
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
const ALBUM_A = "#/album/F0000000000000001";
const pausa = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// Colores de DESIGN §2.
const C = Object.freeze({
  black: "rgb(0, 0, 0)",
  surface: "rgb(18, 18, 18)",
  elevated: "rgb(31, 31, 31)",
  highlight: "rgb(42, 42, 42)",
  card: "rgb(24, 24, 24)",
  cardHover: "rgb(40, 40, 40)",
  white: "rgb(255, 255, 255)",
  secondary: "rgb(179, 179, 179)",
  accent: "rgb(30, 215, 96)",
  separator: "rgb(62, 62, 62)",
  transparent: "rgba(0, 0, 0, 0)",
  rowHover: "rgba(255, 255, 255, 0.1)",
  tile: "rgba(255, 255, 255, 0.1)",
  tileHover: "rgba(255, 255, 255, 0.2)",
});

/** Estilos calculados y caja del primer elemento visible que coincide con el selector CSS. */
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

/** Espera a que una propiedad calculada tome un valor (las transiciones duran hasta 0,3 s). */
async function waitStyle(page, selector, prop, value) {
  await page.waitForFunction(
    (sel, name, expected) => getComputedStyle(document.querySelector(sel)).getPropertyValue(name) === expected,
    { timeout: 3000, polling: 50 },
    selector,
    prop,
    value,
  ).catch(() => {});
  return (await styleOf(page, selector, [prop]))[prop];
}

const columnsOf = (page) => page.$eval('[data-testid="quick-grid"]', (el) => getComputedStyle(el).gridTemplateColumns.split(" ").length);
const noHorizontalScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

describe("Escritorio (1440 × 900)", () => {
  prueba("Barra superior de 64 px sobre #000: nombre a la izquierda, Inicio de 48 px y buscador en pastilla de 48 px", () =>
    withPage(browser, VIEWPORTS.escritorio, async (page) => {
      await openApp(page, server.url);
      assert.equal((await styleOf(page, "body", ["background-color"]))["background-color"], C.black);
      const topbar = await styleOf(page, '[data-testid="topbar"]', ["background-color"]);
      expectSize("Alto de la barra superior", topbar.height, 64);
      expectSize("La barra superior ocupa todo el ancho (con 8 px a los lados)", topbar.width, 1440 - 16);
      const brand = await styleOf(page, '[data-testid="brand"]', ["color", "font-weight"]);
      assert.equal(await page.$eval('[data-testid="brand"]', (el) => el.textContent), "Reminiscencia");
      assert.equal(await page.$('[data-testid="topbar"] img, [data-testid="brand"] svg'), null, "Sin logotipo: solo el nombre.");
      assert.ok(brand.x < 40, "El nombre va a la izquierda.");
      const home = await styleOf(page, '[data-testid="nav-inicio"]', ["background-color", "border-top-left-radius", "color"]);
      expectSize("Botón Inicio (ancho)", home.width, 48);
      expectSize("Botón Inicio (alto)", home.height, 48);
      assert.equal(home["background-color"], C.elevated);
      assert.equal(home["border-top-left-radius"], "50%");
      assert.equal(await page.$eval('[data-testid="nav-inicio"]', (el) => el.getAttribute("aria-current")), "page");
      const pill = await styleOf(page, '[data-testid="top-search"]', ["background-color", "border-top-width", "border-top-color", "border-top-left-radius"]);
      expectSize("Alto del buscador", pill.height, 48);
      expectSize("Ancho del buscador (hasta 480 px)", pill.width, 480);
      assert.equal(pill["background-color"], C.elevated);
      assert.equal(pill["border-top-width"], "1px");
      assert.equal(pill["border-top-color"], C.transparent);
      assert.ok(parseFloat(pill["border-top-left-radius"]) >= 24, "El buscador es una pastilla.");
      expectSize("Inicio va justo antes del buscador", pill.x - (home.x + home.width), 8);
      const centro = home.x + (pill.x + pill.width - home.x) / 2;
      expectInRange("Inicio y el buscador van centrados", centro, 1440 / 2 - 24, 1440 / 2 + 24);
      // Lupa a la izquierda y «Explorar» a la derecha.
      const lupa = await styleOf(page, ".top-search-icon", []);
      const campo = await styleOf(page, '[data-testid="top-search-input"]', ["color"]);
      const explorar = await styleOf(page, '[data-testid="nav-buscar"]', []);
      assert.ok(lupa.x < campo.x && explorar.x > campo.x + campo.width - 1, "Lupa, campo y Explorar, en ese orden.");
      assert.equal(await page.$eval('[data-testid="nav-buscar"]', (el) => el.getAttribute("aria-label")), "Explorar");
      assert.equal(await page.$eval('[data-testid="top-search-input"]', (el) => el.placeholder), "¿Qué quieres reproducir?");
      await page.hover('[data-testid="top-search"]');
      assert.equal(await waitStyle(page, '[data-testid="top-search"]', "background-color", C.highlight), C.highlight, "Hover #2a2a2a");
      await page.focus('[data-testid="top-search-input"]');
      assert.equal(await waitStyle(page, '[data-testid="top-search"]', "border-top-color", C.white), C.white, "Con el foco, el borde pasa a blanco.");
    }),
  );

  prueba("Tres paneles de radio 8 sobre #000 separados 8 px; «Tu biblioteca» de 280 a 420 px; reproductor de 72 px a todo el ancho", () =>
    withPage(browser, VIEWPORTS.escritorio, async (page) => {
      await openApp(page, server.url);
      const sidebar = await styleOf(page, '[data-testid="sidebar"]', ["border-top-left-radius", "background-color"]);
      const main = await styleOf(page, '[data-testid="main"]', ["border-top-left-radius", "background-color"]);
      for (const [nombre, panel] of [["Tu biblioteca", sidebar], ["contenido", main]]) {
        assert.equal(panel["border-top-left-radius"], "8px", `Radio del panel ${nombre}`);
        assert.equal(panel["background-color"], C.surface, `Fondo del panel ${nombre}`);
      }
      expectInRange("Ancho de Tu biblioteca", sidebar.width, 280, 420);
      expectSize("Margen izquierdo", sidebar.x, 8);
      expectSize("Los paneles empiezan bajo la barra superior", sidebar.y, 64);
      expectSize("Separación entre Tu biblioteca y el contenido", main.x - sidebar.right, 8);
      expectSize("Margen derecho", 1440 - main.right, 8);
      const player = await styleOf(page, '[data-testid="player-bar"]', ["background-color"]);
      expectSize("Alto del reproductor", player.height, 72);
      expectSize("El reproductor ocupa todo el ancho", player.width, 1440);
      assert.equal(player["background-color"], C.black);
      expectSize("Separación entre los paneles y el reproductor", player.y - main.bottom, 8);
      expectSize("El reproductor llega al borde inferior", player.bottom, 900);
      // El separador cambia el ancho con el teclado, entre 280 y 420 px.
      await page.focus('[data-testid="library-resize"]');
      await page.keyboard.press("End");
      expectSize("Ancho máximo de Tu biblioteca", (await measure(page, "sidebar")).width, 420);
      await page.keyboard.press("Home");
      expectSize("Ancho mínimo de Tu biblioteca", (await measure(page, "sidebar")).width, 280);
      assert.equal(await page.$eval('[data-testid="library-resize"]', (el) => el.getAttribute("aria-valuenow")), "280");
      await capture(page, "escritorio-1440-inicio");
    }),
  );

  prueba("«Tu biblioteca»: «+ Crear» (Lista, Álbum, Subir canciones), chips, buscador, «Recientes» y elementos de 64 px", () =>
    withPage(browser, VIEWPORTS.escritorio, async (page) => {
      await openApp(page, server.url);
      assert.equal(await page.$eval("#titulo-biblioteca", (el) => el.textContent), "Tu biblioteca");
      const crear = await styleOf(page, '[data-testid="sidebar-create"]', ["background-color", "border-top-left-radius", "font-weight"]);
      assert.equal(await page.$eval('[data-testid="sidebar-create"]', (el) => el.textContent.trim()), "Crear");
      assert.equal(crear["background-color"], C.elevated);
      expectSize("Alto de «Crear»", crear.height, 32);
      await clickTestid(page, "sidebar-create", "Crear");
      const opciones = await page.$$eval('[role="menu"] .menu-label', (items) => items.map((item) => item.textContent));
      assert.deepEqual(opciones, ["Lista", "Álbum", "Subir canciones", "Homeostasia"]);
      await page.keyboard.press("Escape");
      assert.deepEqual(await page.$$eval('[data-testid^="sidebar-chip-"]', (chips) => chips.map((chip) => chip.textContent)), ["Listas", "Álbumes"]);
      await waitVisible(page, "sidebar-search-toggle");
      assert.equal(await page.$eval('[data-testid="sidebar-sort"] .sort-label', (el) => el.textContent), "Recientes");
      const item = await styleOf(page, '[data-testid="sidebar-item"]', []);
      expectSize("Alto del elemento", item.height, 64);
      const cover = await styleOf(page, '[data-testid="sidebar-item"] .library-cover', ["border-top-left-radius"]);
      expectSize("Portada del elemento (ancho)", cover.width, 48);
      expectSize("Portada del elemento (alto)", cover.height, 48);
      assert.equal(cover["border-top-left-radius"], "4px", "Radio 4 (circular solo para artistas, que no hay).");
      const subtitle = await styleOf(page, '[data-testid="sidebar-item"] .library-subtitle', ["color", "font-size"]);
      assert.deepEqual([subtitle.color, subtitle["font-size"]], [C.secondary, "14px"]);
      await createPlaylist(page, VIEWPORTS.escritorio);
      const subtitulos = await page.$$eval('[data-testid="sidebar-item"] .library-subtitle', (items) => items.map((el) => el.textContent));
      assert.ok(subtitulos.includes("Lista • Reminiscencia"), subtitulos.join(" | "));
      assert.ok(subtitulos.includes("Álbum • Artista de prueba A"), subtitulos.join(" | "));
      const activo = await styleOf(page, '[data-testid="sidebar-item"][aria-current="page"]', ["background-color"]);
      assert.equal(activo["background-color"], C.highlight, "El elemento abierto va en #2a2a2a.");
    }),
  );

  prueba("Inicio: chips, accesos rápidos de 48 px en 4 columnas y tarjetas sin fondo con botón verde de 48 px que sube", () =>
    withPage(browser, VIEWPORTS.escritorio, async (page) => {
      await openApp(page, server.url);
      assert.deepEqual(await page.$$eval('[data-testid^="home-chip-"]', (chips) => chips.map((chip) => chip.textContent)), ["Todo", "Música"]);
      const chip = await styleOf(page, '[data-testid="home-chip-todo"]', ["background-color", "color"]);
      assert.deepEqual([chip["background-color"], chip.color], [C.white, C.black], "El chip elegido va en blanco con texto negro.");
      assert.equal(await columnsOf(page), 4);
      const tile = await styleOf(page, '[data-testid="quick-tile"]', ["background-color"]);
      expectSize("Alto del acceso rápido", tile.height, 48);
      assert.equal(tile["background-color"], C.tile);
      const tileCover = await styleOf(page, '[data-testid="quick-tile"] .tile-cover', []);
      expectSize("Portada del acceso rápido", tileCover.width, 48);
      expectSize("La portada va a la izquierda", tileCover.x, tile.x);
      await page.hover('[data-testid="quick-tile"]');
      assert.equal(await waitStyle(page, '[data-testid="quick-tile"]', "background-color", C.tileHover), C.tileHover);
      const card = '[data-testid="shelf-albums"] .card';
      assert.equal((await styleOf(page, card, ["background-color"]))["background-color"], C.transparent, "La tarjeta no tiene fondo sin hover.");
      const title = await styleOf(page, `${card} .card-title`, ["font-size", "font-weight"]);
      assert.deepEqual([title["font-size"], title["font-weight"]], ["16px", "700"]);
      const subtitle = await styleOf(page, `${card} .card-subtitle`, ["font-size", "color"]);
      assert.deepEqual([subtitle["font-size"], subtitle.color], ["14px", C.secondary]);
      const cover = await styleOf(page, `${card} .card-cover`, ["box-shadow", "border-top-left-radius"]);
      assert.notEqual(cover["box-shadow"], "none", "La portada lleva sombra.");
      assert.equal(cover["border-top-left-radius"], "6px");
      const play = `${card} [data-testid="card-play"]`;
      const antes = await styleOf(page, play, ["opacity"]);
      assert.equal(antes.opacity, "0", "El botón verde no se ve sin hover ni foco.");
      await page.hover(card);
      await waitStyle(page, play, "opacity", "1");
      await pausa(350);
      const visible = await styleOf(page, play, ["opacity", "background-color", "color"]);
      assert.equal(visible["background-color"], C.accent);
      assert.equal(visible.color, C.black, "Texto (icono) negro sobre el verde.");
      expectSize("Botón verde de la tarjeta", visible.width, 48);
      expectSize("Botón verde de la tarjeta (alto)", visible.height, 48);
      expectSize("El botón sube 8 px al hacer hover", antes.y - visible.y, 8);
      assert.equal(await waitStyle(page, card, "background-color", C.elevated), C.elevated, "Hover #1f1f1f");
      for (const testid of ["shelf-albums-more", "shelf-recent-more"]) await waitVisible(page, testid);
    }),
  );

  prueba("Álbum: degradado del color de la portada, portada de 232 px, título hasta 96 px y peso 800, acciones y tabla fija", () =>
    withPage(browser, VIEWPORTS.escritorio, async (page) => {
      await openApp(page, server.url);
      await openCollection(page, "#/me-gusta");
      const corto = await styleOf(page, '[data-testid="collection-title"]', ["font-size", "font-weight"]);
      assert.deepEqual([corto["font-size"], corto["font-weight"]], ["96px", "800"]);
      await openCollection(page, ALBUM_A);
      const header = await styleOf(page, '[data-testid="collection-header"]', ["background-image"]);
      assert.match(header["background-image"], /linear-gradient/);
      const body = await styleOf(page, ".collection-body", ["background-image"]);
      assert.match(body["background-image"], /rgb\(18, 18, 18\)/, "El degradado termina en #121212.");
      const cover = await styleOf(page, ".collection-cover", ["box-shadow"]);
      expectSize("Portada del álbum", cover.width, 232);
      expectSize("Portada del álbum (alto)", cover.height, 232);
      assert.notEqual(cover["box-shadow"], "none");
      assert.equal(await page.$eval(".collection-type", (el) => el.textContent), "Álbum");
      const title = await styleOf(page, '[data-testid="collection-title"]', ["font-size", "font-weight"]);
      assert.ok(parseFloat(title["font-size"]) < 96, "Un título largo se reduce.");
      assert.equal(title["font-weight"], "800");
      const play = await styleOf(page, '[data-testid="collection-play"]', ["background-color"]);
      expectSize("Botón verde del álbum", play.width, 56);
      assert.equal(play["background-color"], C.accent);
      // Orden de la barra de acciones: reproducir, aleatorio, Me gusta, (descargar) y «···».
      const xs = [];
      for (const testid of ["collection-play", "collection-shuffle", "collection-like", "collection-download", "collection-more"]) xs.push((await measure(page, testid)).x);
      assert.deepEqual([...xs].sort((a, b) => a - b), xs);
      const headers = await page.$$eval(".track-table thead th", (cells) => cells.map((cell) => cell.textContent.trim()));
      assert.deepEqual(headers, ["#", "Título", "Duración"], "En un álbum no hay columna Álbum.");
      assert.ok(await page.$(".track-table thead .col-dur-icon svg"), "La duración se indica con un reloj.");
      assert.equal((await styleOf(page, ".track-table thead th", ["position"])).position, "sticky");
      const row = await styleOf(page, '[data-testid="track-row"]', []);
      expectSize("Alto de la fila", row.height, 56);
      await page.hover('[data-testid="track-row"]:nth-child(2)');
      assert.equal(await waitStyle(page, '[data-testid="track-row"]:nth-child(2) td', "background-color", C.rowHover), C.rowHover);
      await playRow(page, 0);
      const sonando = await styleOf(page, '[data-testid="track-row"]:nth-child(1) .track-title', ["color"]);
      assert.equal(sonando.color, C.accent, "La fila que suena va en verde #1ed760.");
      await capture(page, "escritorio-1440-album");
      // Al desplazar una tabla larga (todas las canciones), la cabecera se queda fija arriba.
      await openCollection(page, "#/canciones");
      await page.$eval('[data-testid="main"]', (main) => { main.scrollTop = 600; });
      await page.waitForFunction(() => document.querySelector(".track-table thead")?.classList.contains("is-stuck"), { timeout: 3000 });
      const fija = await styleOf(page, ".track-table thead th", ["border-bottom-color"]);
      const panel = await measure(page, "main");
      expectSize("La cabecera fija va arriba del panel", fija.y, panel.y);
      assert.equal(fija["border-bottom-color"], C.separator, "Separador #3e3e3e.");
    }),
  );

  prueba("Lista: columnas #, Título, Álbum y reloj; filas con portada de 40 px", () =>
    withPage(browser, VIEWPORTS.escritorio, async (page) => {
      await openApp(page, server.url);
      await createPlaylist(page, VIEWPORTS.escritorio);
      await assert.equal(await page.$eval(".collection-type", (el) => el.textContent), "Lista");
      await clickTestid(page, "playlist-add-button", "Añadir");
      await page.waitForSelector('[data-testid="track-row"]');
      const headers = await page.$$eval(".track-table thead th", (cells) => cells.map((cell) => cell.textContent.trim()));
      assert.deepEqual(headers, ["#", "Título", "Álbum", "Duración"]);
      expectSize("Portada de la fila", (await styleOf(page, '[data-testid="track-row"] .track-cover', [])).width, 40);
    }),
  );

  prueba("Buscar: resultado principal sobre #181818 (hover #282828) y «Explorar todo»", () =>
    withPage(browser, VIEWPORTS.escritorio, async (page) => {
      await openApp(page, server.url);
      await goSection(page, "buscar", VIEWPORTS.escritorio);
      await waitVisible(page, "browse-grid");
      await search(page, "prueba 1");
      const top = await styleOf(page, '[data-testid="top-result"]', ["background-color"]);
      assert.equal(top["background-color"], C.card);
      await page.hover('[data-testid="top-result"]');
      assert.equal(await waitStyle(page, '[data-testid="top-result"]', "background-color", C.cardHover), C.cardHover);
    }),
  );

  prueba("Reproductor: portada de 56 px, botón blanco de 32 px, progreso de 4 px (verde con hover y punto blanco) y controles en orden", () =>
    withPage(browser, VIEWPORTS.escritorio, async (page) => {
      await openApp(page, server.url);
      await openCollection(page, ALBUM_A);
      await playRow(page, 0);
      const cover = await styleOf(page, '[data-testid="player-cover"] .player-cover', []);
      expectSize("Portada del reproductor", cover.width, 56);
      const play = await styleOf(page, '[data-testid="player-play"]', ["background-color", "border-top-left-radius"]);
      expectSize("Botón reproducir", play.width, 32);
      expectSize("Botón reproducir (alto)", play.height, 32);
      assert.equal(play["background-color"], C.white);
      assert.equal(play["border-top-left-radius"], "50%");
      const track = await styleOf(page, '[data-testid="player-progress-track"]', []);
      expectSize("Alto de la barra de progreso", track.height, 4);
      const fill = ".player-progress .slider-fill";
      assert.equal((await styleOf(page, fill, ["background-color"]))["background-color"], C.white);
      assert.equal((await styleOf(page, ".player-progress .slider-thumb", ["opacity"])).opacity, "0");
      await page.hover('[data-testid="player-progress"]');
      assert.equal(await waitStyle(page, fill, "background-color", C.accent), C.accent);
      const thumb = await styleOf(page, ".player-progress .slider-thumb", ["opacity", "background-color"]);
      assert.deepEqual([thumb.opacity, thumb["background-color"]], ["1", C.white]);
      // Izquierda: portada, título, artista y «Me gusta».
      for (const testid of ["player-title", "player-artist", "player-like", "player-time", "player-duration"]) await waitVisible(page, testid);
      // Centro: aleatorio, anterior, reproducir, siguiente y repetir, en ese orden.
      const centro = [];
      for (const testid of ["player-shuffle", "player-prev", "player-play", "player-next", "player-repeat"]) centro.push((await measure(page, testid)).x);
      assert.deepEqual([...centro].sort((a, b) => a - b), centro);
      // Derecha: Reproduciendo, letra (desactivada), cola, (dispositivo oculto), volumen y pantalla completa.
      const derecha = [];
      for (const testid of ["player-now", "player-lyrics", "player-queue", "player-volume", "player-fullscreen"]) derecha.push((await measure(page, testid)).x);
      assert.deepEqual([...derecha].sort((a, b) => a - b), derecha);
      assert.equal(await page.$eval('[data-testid="player-device"]', (el) => el.getClientRects().length), 0, "El dispositivo no se ve.");
    }),
  );

  prueba("Panel «Reproduciendo» de 300 px a la derecha, separado 8 px, con la portada a todo el ancho", () =>
    withPage(browser, VIEWPORTS.escritorio, async (page) => {
      await openApp(page, server.url);
      await openCollection(page, ALBUM_A);
      await playRow(page, 0);
      await clickTestid(page, "player-now", "Reproduciendo");
      const panel = await styleOf(page, '[data-testid="now-panel"]', ["background-color", "border-top-left-radius"]);
      const main = await measure(page, "main");
      expectSize("Ancho del panel Reproduciendo", panel.width, 300);
      expectSize("Separación entre el contenido y el panel", panel.x - main.right, 8);
      expectSize("Margen derecho", 1440 - panel.right, 8);
      assert.deepEqual([panel["background-color"], panel["border-top-left-radius"]], [C.surface, "8px"]);
      const cover = await styleOf(page, ".now-cover", []);
      expectSize("Portada grande (todo el ancho menos 16 px a cada lado)", cover.width, 300 - 32);
      expectSize("Portada cuadrada", cover.height, cover.width);
      const titulo = await styleOf(page, '[data-testid="now-track"]', ["font-size", "font-weight"]);
      assert.deepEqual([titulo["font-size"], titulo["font-weight"]], ["24px", "700"]);
      await capture(page, "escritorio-1440-reproduciendo");
    }),
  );
});

describe("Escritorio estrecho y tableta", () => {
  prueba("A 1024 px: Tu biblioteca entre 280 y 420 px, accesos rápidos en 4 columnas y panel Reproduciendo de 300 px", () =>
    withPage(browser, VIEWPORTS.tabletaHorizontal, async (page) => {
      await openApp(page, server.url);
      expectInRange("Ancho de Tu biblioteca", (await measure(page, "sidebar")).width, 280, 420);
      assert.equal(await columnsOf(page), 4);
      await openCollection(page, ALBUM_A);
      await playRow(page, 0);
      await clickTestid(page, "player-now", "Reproduciendo");
      expectSize("Ancho del panel Reproduciendo", (await measure(page, "now-panel")).width, 300);
      assert.equal(await noHorizontalScroll(page), 0);
    }),
  );

  prueba("A 820 px: barra superior, Tu biblioteca y reproductor de 72 px; «Reproduciendo» abre la pantalla completa; sin desplazamiento horizontal", () =>
    withPage(browser, VIEWPORTS.tabletaVertical, async (page) => {
      await openApp(page, server.url);
      await waitVisible(page, "sidebar");
      expectSize("Alto de la barra superior", (await measure(page, "topbar")).height, 64);
      expectSize("Alto del reproductor", (await measure(page, "player-bar")).height, 72);
      assert.equal(await columnsOf(page), 2);
      assert.equal(await noHorizontalScroll(page), 0);
      await openCollection(page, ALBUM_A);
      await playRow(page, 0);
      assert.equal(await noHorizontalScroll(page), 0);
      await clickTestid(page, "player-now", "Reproduciendo");
      await waitVisible(page, "full-player", { context: "pantalla completa en tableta" });
    }),
  );
});

describe("Teléfono (390 × 844)", () => {
  prueba("Sin barra superior ni lateral; barra inferior de 64 px con degradado desde negro y tres destinos", () =>
    withPage(browser, VIEWPORTS.telefono, async (page) => {
      await openApp(page, server.url);
      for (const testid of ["topbar", "sidebar", "player-bar"]) {
        assert.equal(await page.$eval(`[data-testid="${testid}"]`, (el) => el.getClientRects().length), 0, `${testid} no se ve.`);
      }
      const tabbar = await styleOf(page, '[data-testid="tabbar"]', ["background-image"]);
      expectSize("Alto de la barra inferior", tabbar.height, 64);
      expectSize("La barra inferior llega al borde", tabbar.bottom, 844);
      assert.match(tabbar["background-image"], /linear-gradient\(0deg, rgb\(0, 0, 0\)/);
      const labels = await page.$$eval('[data-testid="tabbar"] a', (links) => links.map((link) => link.textContent.trim()));
      assert.deepEqual(labels, ["Inicio", "Buscar", "Tu biblioteca"]);
      assert.equal(await columnsOf(page), 2);
      assert.equal(await noHorizontalScroll(page), 0, "Sin desplazamiento horizontal.");
      await capture(page, "telefono-390-inicio");
    }),
  );

  prueba("Minirreproductor de 56 px con el color dominante de la portada, justo encima de la barra inferior", () =>
    withPage(browser, VIEWPORTS.telefono, async (page) => {
      await openApp(page, server.url);
      await openCollection(page, ALBUM_A);
      await playRow(page, 0);
      const mini = await styleOf(page, '[data-testid="mini-player"]', ["border-top-left-radius", "background-color"]);
      const tabbar = await measure(page, "tabbar");
      expectSize("Alto del minirreproductor", mini.height, 56);
      assert.ok(parseFloat(mini["border-top-left-radius"]) > 0, "El minirreproductor es redondeado.");
      expectSize("El minirreproductor va justo encima de la barra inferior", mini.bottom, tabbar.y);
      await page.waitForFunction(() => {
        const mini = document.querySelector('[data-testid="mini-player"]');
        return mini.style.getPropertyValue("--cover-color") && getComputedStyle(mini).backgroundColor !== "rgb(40, 40, 40)";
      }, { timeout: 5000 });
      const progress = await styleOf(page, ".mini-progress", []);
      expectInRange("Alto del progreso del minirreproductor", progress.height, 1, 3);
      await capture(page, "telefono-390-album");
      await clickTestid(page, "mini-open", "minirreproductor");
      await waitVisible(page, "full-player");
      await pausa(300);
      await capture(page, "telefono-390-pantalla-completa");
    }),
  );

  prueba("Objetivos táctiles de 44 px o más en Inicio, un álbum, Buscar, Tu biblioteca, el menú Crear, una hoja de edición y la pantalla completa", () =>
    withPage(browser, VIEWPORTS.telefono, async (page) => {
      const pequenos = async (donde) => page.evaluate((zona) => {
        const root = document.querySelector("dialog[open]") ?? document;
        return [...root.querySelectorAll("a[href], button, input, textarea, [role='button'], [role^='menuitem']")]
          .filter((el) => window.__e2eIsShown(el) && getComputedStyle(el).opacity !== "0" && el.type !== "file" && el.type !== "radio")
          .filter((el) => !el.closest("[hidden]") && !el.classList.contains("skip-link"))
          // Un enlace estirado (.card-link, con ::after sobre toda la tarjeta) se mide por su tarjeta.
          .map((el) => ({ el, rect: (el.classList.contains("card-link") ? el.closest(".tile, .card, .top-card") ?? el : el).getBoundingClientRect() }))
          .filter(({ rect }) => rect.bottom > 0 && rect.top < window.innerHeight)
          .filter(({ rect }) => rect.width < 43.5 || rect.height < 43.5)
          .map(({ el, rect }) => `${zona}: ${el.dataset.testid || el.className || el.tagName} ${Math.round(rect.width)}×${Math.round(rect.height)}`);
      }, donde);
      await openApp(page, server.url);
      const fallos = [...(await pequenos("Inicio"))];
      await openCollection(page, ALBUM_A);
      await playRow(page, 0);
      fallos.push(...(await pequenos("Álbum")));
      await goSection(page, "buscar", VIEWPORTS.telefono);
      fallos.push(...(await pequenos("Buscar")));
      await goSection(page, "biblioteca", VIEWPORTS.telefono);
      fallos.push(...(await pequenos("Tu biblioteca")));
      await clickTestid(page, "library-page-create", "Crear");
      fallos.push(...(await pequenos("Menú Crear")));
      await page.keyboard.press("Escape");
      await createMenu(page, VIEWPORTS.telefono, "album");
      await waitVisible(page, "create-album");
      fallos.push(...(await pequenos("Crear álbum")));
      await page.keyboard.press("Escape");
      await clickTestid(page, "mini-open", "minirreproductor");
      await waitVisible(page, "full-player");
      fallos.push(...(await pequenos("Pantalla completa")));
      assert.deepEqual(fallos, []);
    }),
  );
});
