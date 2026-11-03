// Pruebas funcionales de la interfaz sin usuarios (ADR-0015) con la distribución de Spotify: abre en Inicio sin pedir
// nada, reproduce, busca desde la barra superior, abre álbumes (con portadas publicadas), panel «Reproduciendo», crea y
// edita listas locales (nombre, descripción y foto), «Me gusta», cola, hojas de edición de canciones y álbumes
// (incidencias de GitHub), subida local (conversión real a Opus) y borrado, «Para todos», «Desde Internet Archive» y
// escucha sin conexión. Catálogo de prueba ficticio (helpers/catalogo-prueba.mjs).
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { crc32, deflateSync } from "node:zlib";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { createTestCatalogOverrides } from "./helpers/catalogo-prueba.mjs";
import { clickTestid, isVisible, TEST_TIMEOUT_MS, textOf, waitHidden, waitVisible } from "./helpers/elementos.mjs";
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
      await pickMenu(page, "menu-delete-local");
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
