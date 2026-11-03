// Accesibilidad WCAG 2.2 AA (axe-core) de cada pantalla y hoja a 390, 820, 1024 y 1440 px. Criterio de error:
// ningún fallo de gravedad «serious» ni «critical». Además: html lang="es", un único H1 visible por pantalla,
// enlace de salto como primer foco, foco visible, foco en el H1 al cambiar de pantalla y movimiento reducido.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createTestCatalogOverrides } from "./helpers/catalogo-prueba.mjs";
import { clickTestid, focusRingWidth, focusWithKeyboardMode, TEST_TIMEOUT_MS, waitVisible, wcagViolations } from "./helpers/elementos.mjs";
import {
  createMenu,
  createPlaylist,
  fillField,
  goSection,
  isPhone,
  openApp,
  openCollection,
  openCollectionMenu,
  openRowMenu,
  openUpload,
  pickMenu,
  playRow,
  search,
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

// Cada pantalla: cómo prepararla (page, viewport) y, si solo aplica a algunos anchos, en cuáles.
const PANTALLAS = [
  { nombre: "Inicio", preparar: async () => {} },
  { nombre: "Buscar sin texto", preparar: (page, vp) => goSection(page, "buscar", vp) },
  {
    nombre: "Buscar con resultados",
    preparar: async (page, vp) => {
      await goSection(page, "buscar", vp);
      await search(page, "prueba 1");
      await waitVisible(page, "top-result");
    },
  },
  {
    nombre: "Álbum sonando",
    preparar: async (page) => {
      await openCollection(page, FOLDER_A);
      await playRow(page, 1);
    },
  },
  {
    nombre: "Lista propia con canciones",
    preparar: async (page, vp) => {
      await createPlaylist(page, vp);
      await clickTestid(page, "playlist-add-button", "Añadir");
      await page.waitForFunction(() => document.querySelectorAll('[data-testid="track-row"]').length === 1);
    },
  },
  { nombre: "Me gusta vacía", preparar: (page) => openCollection(page, "#/me-gusta") },
  { nombre: "Tu biblioteca", preparar: (page, vp) => goSection(page, "biblioteca", vp) },
  {
    nombre: "Mostrar todo: Álbumes",
    preparar: async (page) => {
      await page.evaluate(() => { location.hash = "#/seccion/albumes"; });
      await waitVisible(page, "section-grid");
    },
  },
  {
    nombre: "Tu biblioteca con el buscador abierto y el menú de orden",
    soloAncho: true,
    preparar: async (page) => {
      await clickTestid(page, "sidebar-search-toggle", "buscar en Tu biblioteca");
      await waitVisible(page, "sidebar-filter");
      await clickTestid(page, "sidebar-sort", "Ordenar");
      await page.waitForSelector('[role="menu"]');
    },
  },
  {
    nombre: "Menú Crear",
    preparar: async (page, vp) => {
      if (isPhone(vp)) await goSection(page, "biblioteca", vp);
      await clickTestid(page, isPhone(vp) ? "library-page-create" : "sidebar-create", "Crear");
      await page.waitForSelector('[role="menu"]');
    },
  },
  {
    nombre: "Hoja Editar detalles de una canción, con error",
    preparar: async (page) => {
      await openCollection(page, FOLDER_A);
      await openRowMenu(page, "S0000000000000002");
      await pickMenu(page, "menu-edit-song");
      await fillField(await waitVisible(page, "edit-song-title"), " ");
      await page.waitForSelector('[data-testid="edit-song"] .field-error:not([hidden])');
    },
  },
  {
    nombre: "Hoja Añadir a un álbum",
    preparar: async (page) => {
      await openCollection(page, FOLDER_A);
      await openRowMenu(page, "S0000000000000002");
      await pickMenu(page, "menu-move-album");
      await waitVisible(page, "move-album");
    },
  },
  {
    nombre: "Hoja Editar detalles de un álbum",
    preparar: async (page) => {
      await openCollection(page, FOLDER_A);
      await clickTestid(page, "collection-edit", "Editar detalles");
      await waitVisible(page, "edit-album");
    },
  },
  {
    nombre: "Hoja Cambiar portada",
    preparar: async (page) => {
      await openCollection(page, FOLDER_A);
      await openCollectionMenu(page);
      await pickMenu(page, "menu-album-cover");
      await waitVisible(page, "cover-sheet");
    },
  },
  {
    nombre: "Hoja Crear álbum",
    preparar: async (page, vp) => {
      await createMenu(page, vp, "album");
      await waitVisible(page, "create-album");
    },
  },
  {
    nombre: "Editar detalles de una lista propia",
    preparar: async (page, vp) => {
      await createPlaylist(page, vp);
      await clickTestid(page, "collection-edit", "Editar detalles");
      await waitVisible(page, "playlist-edit");
    },
  },
  { nombre: "Hoja Subir canciones", preparar: (page, vp) => openUpload(page, vp) },
  { nombre: "Subir: solo en este navegador", preparar: (page, vp) => openUpload(page, vp, "local") },
  { nombre: "Subir: para todos", preparar: (page, vp) => openUpload(page, vp, "todos") },
  {
    nombre: "Subir: desde Internet Archive, con error",
    preparar: async (page, vp) => {
      await openUpload(page, vp, "archive");
      await fillField(await page.$('[data-testid="archive-url"]'), "https://youtu.be/abc");
      await page.waitForSelector('[data-testid="upload-panel-archive"] .field-error:not([hidden])');
    },
  },
  {
    nombre: "Menú de una canción",
    preparar: async (page) => {
      await openCollection(page, FOLDER_A);
      await openRowMenu(page, "S0000000000000002");
    },
  },
  {
    nombre: "Cola",
    preparar: async (page) => {
      await openCollection(page, FOLDER_A);
      await playRow(page, 0);
      if (await page.$eval('[data-testid="player-bar"]', (el) => el.getClientRects().length > 0)) {
        await clickTestid(page, "player-queue", "Cola");
      } else {
        await clickTestid(page, "mini-open", "minirreproductor");
        await clickTestid(page, "full-queue", "Cola");
      }
      await page.waitForFunction(() => document.querySelector('[data-testid="queue-next"], [data-testid="queue-dialog"]'));
    },
  },
  {
    nombre: "Panel Reproduciendo",
    soloEscritorio: true,
    preparar: async (page) => {
      await openCollection(page, FOLDER_A);
      await playRow(page, 0);
      await clickTestid(page, "player-now", "Reproduciendo");
      await waitVisible(page, "now-panel");
    },
  },
  {
    nombre: "Reproducción a pantalla completa",
    soloTelefono: true,
    preparar: async (page) => {
      await openCollection(page, FOLDER_A);
      await playRow(page, 0);
      await clickTestid(page, "mini-open", "minirreproductor");
      await waitVisible(page, "full-player");
    },
  },
];

const ANCHOS = [
  ["390", VIEWPORTS.telefono],
  ["820", VIEWPORTS.tabletaVertical],
  ["1024", VIEWPORTS.tabletaHorizontal],
  ["1440", VIEWPORTS.escritorio],
];

for (const [ancho, viewport] of ANCHOS) {
  describe(`axe a ${ancho} px`, () => {
    for (const pantalla of PANTALLAS) {
      if (pantalla.soloTelefono && !isPhone(viewport)) continue;
      if (pantalla.soloAncho && isPhone(viewport)) continue;
      if (pantalla.soloEscritorio && viewport.width < 1024) continue;
      prueba(`${pantalla.nombre}: sin fallos serios ni críticos y un único H1`, () =>
        withPage(browser, viewport, async (page) => {
          await openApp(page, server.url);
          await pantalla.preparar(page, viewport);
          await new Promise((resolve) => setTimeout(resolve, 300));
          const fallos = (await wcagViolations(page)).filter((v) => v.impacto === "serious" || v.impacto === "critical");
          assert.deepEqual(fallos, [], `${pantalla.nombre} a ${ancho} px: ${JSON.stringify(fallos)}`);
          const h1 = await page.$$eval("h1", (list) => list.filter((el) => el.getClientRects().length > 0).length);
          assert.equal(h1, 1, `${pantalla.nombre} a ${ancho} px tiene ${h1} H1 visibles.`);
          assert.equal(await page.$eval("html", (el) => el.lang), "es");
        }),
      );
    }
  });
}

describe("Teclado y foco", () => {
  for (const [ancho, viewport] of [["390", VIEWPORTS.telefono], ["1440", VIEWPORTS.escritorio]]) {
    prueba(`El primer Tab llega al enlace de salto, que lleva al contenido (${ancho} px)`, () =>
      withPage(browser, viewport, async (page) => {
        await openApp(page, server.url);
        await page.keyboard.press("Tab");
        assert.equal(await page.evaluate(() => document.activeElement?.dataset.testid), "skip-link");
        await page.keyboard.press("Enter");
        assert.equal(await page.evaluate(() => document.activeElement?.id), "main");
      }),
    );

    prueba(`Al cambiar de pantalla, el foco va al H1 (${ancho} px)`, () =>
      withPage(browser, viewport, async (page) => {
        await openApp(page, server.url);
        await goSection(page, "buscar", viewport);
        assert.equal(await page.evaluate(() => document.activeElement?.tagName), "H1");
        await goSection(page, "biblioteca", viewport);
        assert.equal(await page.evaluate(() => document.activeElement?.textContent), "Tu biblioteca");
      }),
    );
  }

  prueba("El foco se ve: contorno de 2 px en botones, enlaces y campos", () =>
    withPage(browser, VIEWPORTS.escritorio, async (page) => {
      await openApp(page, server.url);
      for (const testid of ["nav-inicio", "nav-buscar", "brand", "sidebar-create", "sidebar-chip-listas", "sidebar-sort", "library-resize", "player-shuffle", "player-now", "player-queue", "skip-link"]) {
        const info = await focusWithKeyboardMode(page, testid, "foco visible");
        assert.ok(focusRingWidth(info) >= 2, `${testid}: el anillo de foco mide ${focusRingWidth(info)} px.`);
      }
      await openCollection(page, FOLDER_A);
      const info = await focusWithKeyboardMode(page, "collection-play", "botón verde");
      assert.ok(focusRingWidth(info) >= 2);
    }),
  );

  prueba("El menú de una canción se recorre con flechas y Escape devuelve el foco", () =>
    withPage(browser, VIEWPORTS.escritorio, async (page) => {
      await openApp(page, server.url);
      await openCollection(page, FOLDER_A);
      await openRowMenu(page, "S0000000000000003");
      assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("role")), "menuitem");
      const primero = await page.evaluate(() => document.activeElement.textContent);
      await page.keyboard.press("ArrowDown");
      assert.notEqual(await page.evaluate(() => document.activeElement.textContent), primero);
      await page.keyboard.press("Escape");
      assert.equal(await page.evaluate(() => document.activeElement?.dataset.testid), "row-more");
    }),
  );

  prueba("Los diálogos atrapan el foco y Escape lo devuelve al botón que los abrió", () =>
    withPage(browser, VIEWPORTS.escritorio, async (page) => {
      await openApp(page, server.url);
      await openUpload(page, VIEWPORTS.escritorio);
      assert.ok(await page.evaluate(() => document.activeElement?.closest("dialog") !== null));
      await page.keyboard.press("Escape");
      assert.equal(await page.evaluate(() => document.activeElement?.dataset.testid), "sidebar-create");
    }),
  );

  prueba("El buscador de la barra superior marca el foco con un borde blanco", () =>
    withPage(browser, VIEWPORTS.escritorio, async (page) => {
      await openApp(page, server.url);
      await focusWithKeyboardMode(page, "top-search-input", "buscador");
      await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-testid="top-search"]')).borderTopColor === "rgb(255, 255, 255)", { timeout: 3000 });
    }),
  );

  prueba("El separador de Tu biblioteca es un control con su valor (aria-valuenow) y se mueve con las flechas", () =>
    withPage(browser, VIEWPORTS.escritorio, async (page) => {
      await openApp(page, server.url);
      const info = await focusWithKeyboardMode(page, "library-resize", "separador");
      assert.ok(info.active);
      const antes = Number(await page.$eval('[data-testid="library-resize"]', (el) => el.getAttribute("aria-valuenow")));
      await page.keyboard.press("ArrowRight");
      const despues = Number(await page.$eval('[data-testid="library-resize"]', (el) => el.getAttribute("aria-valuenow")));
      assert.ok(despues > antes, `${antes} → ${despues}`);
    }),
  );
});

describe("Movimiento reducido", () => {
  prueba("Con prefers-reduced-motion no hay transiciones ni animaciones", () =>
    withPage(browser, VIEWPORTS.escritorio, async (page) => {
      await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
      await openApp(page, server.url);
      await openCollection(page, FOLDER_A);
      await playRow(page, 0);
      const estilos = await page.evaluate(() => {
        const bar = document.querySelector('.track-row.is-playing .num-playing i');
        const card = document.querySelector('.play-button');
        return {
          animacion: parseFloat(getComputedStyle(bar).animationDuration) * 1000,
          iteraciones: getComputedStyle(bar).animationIterationCount,
          transicion: parseFloat(getComputedStyle(card).transitionDuration) * 1000,
        };
      });
      assert.ok(estilos.animacion <= 0.01, JSON.stringify(estilos));
      assert.equal(estilos.iteraciones, "1");
      assert.ok(estilos.transicion <= 0.01, JSON.stringify(estilos));
    }),
  );
});
