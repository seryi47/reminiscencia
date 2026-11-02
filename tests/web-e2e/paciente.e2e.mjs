// Modo paciente (P1 a P6): comportamiento de cada pantalla y medidas básicas de DESIGN 15 a 390 × 844 px.
// Las pantallas se localizan solo por data-testid del contrato (sección 5). Si falta un elemento, la prueba
// falla con un mensaje claro: no se salta.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createTestCatalogOverrides } from "./helpers/catalogo-prueba.mjs";
import {
  clickTestid,
  countChildren,
  countInteractive,
  expectSize,
  findVisibleTestid,
  focusRingWidth,
  focusWithKeyboardMode,
  isVisible,
  measure,
  measureFirstChild,
  horizontalScrollState,
  TEST_TIMEOUT_MS,
  textOf,
  waitHidden,
  waitVisible,
} from "./helpers/elementos.mjs";
import {
  clickPatientFolderTile,
  focusSearchField,
  goPatientSection,
  leavePatientWithoutPin,
  openPatientFolder,
  openPatientMode,
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
const pausa = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const redondear = (valor) => Math.round(valor * 10) / 10;

// Controles táctiles principales del paciente (DESIGN 6.1, P-7, P-8, P-1 y P-2): objetivo de 48 px o más.
const CONTROLES_TACTILES = [
  "p1-prev",
  "p1-toggle",
  "p1-next",
  "p1-vol-down",
  "p1-vol-up",
  "p-caregiver",
  "p-nav-escuchar",
  "p-nav-listas",
  "p-nav-carpetas",
  "p-nav-buscar",
];

async function countVisibleFolderTiles(page) {
  await waitVisible(page, "p3-folders", { context: "cuadrícula de carpetas (P3)" });
  return page.evaluate(() =>
    [
      ...document.querySelectorAll(
        '[data-testid="p3-folders"] a, [data-testid="p3-folders"] button, [data-testid="p3-folders"] [role="button"]',
      ),
    ].filter((el) => window.__e2eIsShown(el)).length,
  );
}

// ---------------------------------------------------------------------------
describe("P1 · Escuchar: estado al abrir", () => {
  prueba("P1 al abrir no suena nada: ningún elemento multimedia se ha reproducido", () =>
    withPage(browser, VIEWPORTS.telefono, async (page) => {
      await openPatientMode(page, server.url);
      const plays = await page.evaluate(() => window.__e2ePlayCalls ?? 0);
      const reproduciendo = await page.evaluate(() =>
        [...document.querySelectorAll("audio, video")].some((media) => !media.paused),
      );
      assert.equal(plays, 0, "Se ha llamado a play() al abrir Escuchar. Al abrir la app no debe sonar nada.");
      assert.equal(reproduciendo, false, "Hay un elemento multimedia reproduciéndose al abrir Escuchar.");
    }),
  );

  prueba("P1 sin pista muestra la zona «No suena nada» (p1-empty)", () =>
    withPage(browser, VIEWPORTS.telefono, async (page) => {
      await openPatientMode(page, server.url);
      await waitVisible(page, "p1-empty", { context: "zona sin reproducción de P1" });
    }),
  );

  prueba("P1 sin pista deja los controles de transporte con aria-disabled=true", () =>
    withPage(browser, VIEWPORTS.telefono, async (page) => {
      await openPatientMode(page, server.url);
      const estados = [];
      for (const id of ["p1-prev", "p1-toggle", "p1-next"]) {
        const element = await waitVisible(page, id, { context: "transporte de P1" });
        estados.push(await element.evaluate((el) => el.getAttribute("aria-disabled")));
      }
      assert.deepEqual(estados, ["true", "true", "true"], "Sin pista, Anterior, Reproducir y Siguiente deben tener aria-disabled=\"true\".");
    }),
  );

  prueba("P1 muestra diez segmentos de volumen", () =>
    withPage(browser, VIEWPORTS.telefono, async (page) => {
      await openPatientMode(page, server.url);
      const segmentos = await countChildren(page, "p1-vol-steps", "segmentos de volumen de P1");
      assert.equal(segmentos, 10, `El volumen debe tener 10 segmentos y tiene ${segmentos}.`);
    }),
  );

  prueba("P1 sin recuerdo muestra «Sin recuerdo guardado»", () =>
    withPage(browser, VIEWPORTS.telefono, async (page) => {
      await openPatientMode(page, server.url);
      const texto = await textOf(page, "p1-memory", "tarjeta de recuerdo de P1");
      assert.ok(texto.includes("Sin recuerdo guardado"), `La tarjeta de recuerdo muestra «${texto.slice(0, 80)}».`);
    }),
  );
});

// ---------------------------------------------------------------------------
describe("P1 · Escuchar a 390 × 844 px (teléfono)", () => {
  prueba("P1 a 390 px: la portada mide 232 × 232 px", () =>
    withPage(browser, VIEWPORTS.telefono, async (page) => {
      await openPatientMode(page, server.url);
      const caja = await measure(page, "p1-cover", "portada de P1");
      expectSize("Portada (ancho)", caja.width, 232);
      expectSize("Portada (alto)", caja.height, 232);
    }),
  );

  prueba("P1 a 390 px: el botón Anterior mide 72 px", () =>
    withPage(browser, VIEWPORTS.telefono, async (page) => {
      await openPatientMode(page, server.url);
      const caja = await measure(page, "p1-prev", "botón Anterior de P1");
      expectSize("Anterior (ancho)", caja.width, 72);
      expectSize("Anterior (alto)", caja.height, 72);
    }),
  );

  prueba("P1 a 390 px: el botón Reproducir mide 96 px", () =>
    withPage(browser, VIEWPORTS.telefono, async (page) => {
      await openPatientMode(page, server.url);
      const caja = await measure(page, "p1-toggle", "botón Reproducir de P1");
      expectSize("Reproducir (ancho)", caja.width, 96);
      expectSize("Reproducir (alto)", caja.height, 96);
    }),
  );

  prueba("P1 a 390 px: el botón Siguiente mide 72 px", () =>
    withPage(browser, VIEWPORTS.telefono, async (page) => {
      await openPatientMode(page, server.url);
      const caja = await measure(page, "p1-next", "botón Siguiente de P1");
      expectSize("Siguiente (ancho)", caja.width, 72);
      expectSize("Siguiente (alto)", caja.height, 72);
    }),
  );

  prueba("P1 a 390 px: la zona de progreso mide 56 px de alto", () =>
    withPage(browser, VIEWPORTS.telefono, async (page) => {
      await openPatientMode(page, server.url);
      const caja = await measure(page, "p1-progress", "zona de progreso de P1");
      expectSize("Zona de progreso (alto)", caja.height, 56);
    }),
  );

  prueba("P1 a 390 px: el botón Bajar volumen mide 56 px", () =>
    withPage(browser, VIEWPORTS.telefono, async (page) => {
      await openPatientMode(page, server.url);
      const caja = await measure(page, "p1-vol-down", "botón Bajar volumen de P1");
      expectSize("Bajar volumen (ancho)", caja.width, 56);
      expectSize("Bajar volumen (alto)", caja.height, 56);
    }),
  );

  prueba("P1 a 390 px: el botón Subir volumen mide 56 px", () =>
    withPage(browser, VIEWPORTS.telefono, async (page) => {
      await openPatientMode(page, server.url);
      const caja = await measure(page, "p1-vol-up", "botón Subir volumen de P1");
      expectSize("Subir volumen (ancho)", caja.width, 56);
      expectSize("Subir volumen (alto)", caja.height, 56);
    }),
  );

  // El rediseño fija la barra inferior en 64 px de contenido (paciente-shell.css, min-height) más 1 px del borde
  // superior: 65 px medidos en el navegador. Ya no son los 72 px de la versión anterior del diseño.
  prueba("P1 a 390 px: la barra inferior mide 65 px de alto (64 px del marco más el borde de 1 px)", () =>
    withPage(browser, VIEWPORTS.telefono, async (page) => {
      await openPatientMode(page, server.url);
      const caja = await measure(page, "p-nav", "barra inferior del paciente");
      expectSize("Barra inferior (alto)", caja.height, 65);
    }),
  );

  prueba("P1 a 390 px: la barra inferior contiene los cuatro destinos", () =>
    withPage(browser, VIEWPORTS.telefono, async (page) => {
      await openPatientMode(page, server.url);
      await waitVisible(page, "p-nav", { context: "barra inferior del paciente" });
      const faltan = await page.evaluate(() => {
        const nav = document.querySelector('[data-testid="p-nav"]');
        return ["p-nav-escuchar", "p-nav-listas", "p-nav-carpetas", "p-nav-buscar"].filter(
          (id) =>
            ![...document.querySelectorAll(`[data-testid="${id}"]`)].some(
              (el) => nav && nav.contains(el) && window.__e2eIsShown(el),
            ),
        );
      });
      assert.deepEqual(faltan, [], "Estos destinos no están visibles dentro de la barra inferior (p-nav).");
    }),
  );

  prueba("P1 a 390 px: la página no tiene desplazamiento horizontal", () =>
    withPage(browser, VIEWPORTS.telefono, async (page) => {
      await openPatientMode(page, server.url);
      const { scrollWidth, clientWidth } = await horizontalScrollState(page);
      assert.ok(scrollWidth <= clientWidth, `scrollWidth (${scrollWidth}) es mayor que clientWidth (${clientWidth}).`);
    }),
  );

  prueba("P1 a 390 px: los controles táctiles del paciente miden 48 px o más", () =>
    withPage(browser, VIEWPORTS.telefono, async (page) => {
      await openPatientMode(page, server.url);
      const pequeños = [];
      for (const id of CONTROLES_TACTILES) {
        const caja = await measure(page, id, "control táctil del paciente");
        // Mínimo de 48 px con 0,5 px de margen por redondeo de coma flotante.
        if (caja.width < 47.5 || caja.height < 47.5) {
          pequeños.push(`${id}: ${redondear(caja.width)} × ${redondear(caja.height)} px`);
        }
      }
      assert.deepEqual(pequeños, [], "Estos controles del paciente miden menos de 48 px (getBoundingClientRect):");
    }),
  );

  prueba("P1 a 390 px: el anillo de foco del paciente mide 4 px", () =>
    withPage(browser, VIEWPORTS.telefono, async (page) => {
      await openPatientMode(page, server.url);
      const info = await focusWithKeyboardMode(page, "p1-next", "botón Siguiente de P1");
      expectSize("Anillo de foco del paciente", focusRingWidth(info), 4, { tolerance: 0.5 });
    }),
  );

  prueba("P1 a 390 px: Anterior, Reproducir y Siguiente tienen etiqueta visible", () =>
    withPage(browser, VIEWPORTS.telefono, async (page) => {
      await openPatientMode(page, server.url);
      const sinEtiqueta = [];
      for (const id of ["p1-prev", "p1-toggle", "p1-next"]) {
        const texto = await textOf(page, id, "transporte de P1");
        if (texto === "") sinEtiqueta.push(id);
      }
      assert.deepEqual(sinEtiqueta, [], "Estos controles de transporte no muestran etiqueta visible (DESIGN P-7).");
    }),
  );
});

// ---------------------------------------------------------------------------
describe("Navegación del paciente: P2, P3, P3b y P4", () => {
  prueba("P2 se abre al pulsar Listas (p2-root)", () =>
    withPage(browser, VIEWPORTS.telefono, async (page) => {
      await openPatientMode(page, server.url);
      await goPatientSection(page, "listas");
    }),
  );

  prueba("P2 oculta «Para [alias]» cuando no hay canciones con preferencia «Le gusta»", () =>
    withPage(browser, VIEWPORTS.telefono, async (page) => {
      await openPatientMode(page, server.url);
      await goPatientSection(page, "listas");
      const oculta = await waitHidden(page, "p2-for-alias", 3000);
      assert.ok(oculta, "La sección «Para [alias]» (p2-for-alias) debe ocultarse si no tiene canciones.");
    }),
  );

  prueba("P3 muestra las tres carpetas de la biblioteca", () =>
    withPage(browser, VIEWPORTS.telefono, async (page) => {
      await openPatientMode(page, server.url);
      await goPatientSection(page, "carpetas");
      const total = await countVisibleFolderTiles(page);
      assert.equal(total, 3, `La cuadrícula de carpetas muestra ${total} carpetas y el catálogo de prueba tiene 3.`);
    }),
  );

  prueba("P3 no abre una carpeta vacía: sigue en Carpetas", () =>
    withPage(browser, VIEWPORTS.telefono, async (page) => {
      await openPatientMode(page, server.url);
      await goPatientSection(page, "carpetas");
      // La tercera carpeta del catálogo de prueba está vacía (DESIGN P-11: «Vacía» y no se abre).
      await clickPatientFolderTile(page, 2);
      await pausa(800);
      const sigueEnCarpetas = await isVisible(page, "p3-root", 1000);
      const seAbrio = await isVisible(page, "p3b-root", 1000);
      assert.ok(sigueEnCarpetas, "Tras pulsar una carpeta vacía, la pantalla Carpetas (p3-root) debe seguir visible.");
      assert.equal(seAbrio, false, "La carpeta vacía no debe abrirse (p3b-root no debe aparecer).");
    }),
  );

  prueba("P3b muestra «Reproducir carpeta» de 64 px de alto", () =>
    withPage(browser, VIEWPORTS.telefono, async (page) => {
      await openPatientMode(page, server.url);
      await openPatientFolder(page);
      const caja = await measure(page, "p3b-play", "botón Reproducir carpeta (P3b)");
      expectSize("Reproducir carpeta (alto)", caja.height, 64);
    }),
  );

  prueba("P3b muestra las filas de canciones de 88 px", () =>
    withPage(browser, VIEWPORTS.telefono, async (page) => {
      await openPatientMode(page, server.url);
      await openPatientFolder(page);
      const fila = await measureFirstChild(page, "p3b-rows", "filas de canciones de P3b");
      assert.ok(fila, "p3b-rows no tiene ninguna fila visible para medir.");
      expectSize("Fila de canción de P3b (alto)", fila.height, 88);
    }),
  );

  prueba("P4 no muestra resultados mientras se escribe", () =>
    withPage(browser, VIEWPORTS.telefono, async (page) => {
      await openPatientMode(page, server.url);
      await goPatientSection(page, "buscar");
      await focusSearchField(page, "p4-input");
      await page.keyboard.type("canción", { delay: 30 });
      await pausa(500);
      const resultados = await page.evaluate(() => {
        const el = document.querySelector('[data-testid="p4-results"]');
        return el && window.__e2eIsShown(el) ? el.children.length : 0;
      });
      assert.equal(resultados, 0, "Se muestran resultados mientras se escribe. Deben aparecer solo al pulsar Buscar o Intro.");
    }),
  );

  prueba("P4 muestra resultados al pulsar Intro", () =>
    withPage(browser, VIEWPORTS.telefono, async (page) => {
      await openPatientMode(page, server.url);
      await goPatientSection(page, "buscar");
      await focusSearchField(page, "p4-input");
      await page.keyboard.type("canción", { delay: 30 });
      await page.keyboard.press("Enter");
      const aparecen = await page
        .waitForFunction(
          () => {
            const el = document.querySelector('[data-testid="p4-results"]');
            return Boolean(el && window.__e2eIsShown(el) && el.children.length > 0);
          },
          { timeout: 5000 },
        )
        .then(
          () => true,
          () => false,
        );
      assert.ok(aparecen, "Tras pulsar Intro no aparecen resultados en p4-results.");
    }),
  );

  prueba("P4 sin coincidencias muestra la zona vacía (p4-empty)", () =>
    withPage(browser, VIEWPORTS.telefono, async (page) => {
      await openPatientMode(page, server.url);
      await goPatientSection(page, "buscar");
      await focusSearchField(page, "p4-input");
      await page.keyboard.type("zqxw", { delay: 30 });
      await page.keyboard.press("Enter");
      await waitVisible(page, "p4-empty", { context: "zona sin resultados de P4" });
    }),
  );

  prueba("P4 muestra las cuatro categorías de búsqueda", () =>
    withPage(browser, VIEWPORTS.telefono, async (page) => {
      await openPatientMode(page, server.url);
      await goPatientSection(page, "buscar");
      const total = await countInteractive(page, "p4-categories", "categorías de búsqueda (P4)");
      assert.equal(total, 4, `P4 muestra ${total} categorías y DESIGN 3.1 fija cuatro: Por artista, Por década, Por carpeta y Por lista.`);
    }),
  );
});

// ---------------------------------------------------------------------------
describe("Salida al modo cuidador (P5) y aviso de apagado (P6)", () => {
  prueba("P5 sin PIN: el foco inicial está en «Seguir escuchando» (p5-continue)", () =>
    withPage(browser, VIEWPORTS.telefono, async (page) => {
      await openPatientMode(page, server.url);
      await clickTestid(page, "p-caregiver", "botón Cuidador de la cabecera del paciente");
      await waitVisible(page, "p5-dialog", { context: "diálogo de salida (P5)" });
      const enFoco = await page
        .waitForFunction(
          () => {
            const el = document.activeElement;
            return Boolean(el && (el.dataset.testid === "p5-continue" || el.closest('[data-testid="p5-continue"]')));
          },
          { timeout: 3000 },
        )
        .then(
          () => true,
          () => false,
        );
      assert.ok(enFoco, "El foco inicial del diálogo de salida no está en «Seguir escuchando» (p5-continue). DESIGN P-17 lo exige.");
    }),
  );

  prueba("P5 con PIN muestra el teclado de PIN (p5-keypad)", () =>
    withPage(browser, VIEWPORTS.telefono, async (page) => {
      await openPatientMode(page, server.url, { pin: true });
      await clickTestid(page, "p-caregiver", "botón Cuidador de la cabecera del paciente");
      await waitVisible(page, "p5-keypad", { context: "teclado de PIN (P5)" });
    }),
  );

  prueba("P5: Escape equivale a «Seguir escuchando» y deja el paciente en Escuchar", () =>
    withPage(browser, VIEWPORTS.telefono, async (page) => {
      await openPatientMode(page, server.url);
      await clickTestid(page, "p-caregiver", "botón Cuidador de la cabecera del paciente");
      await waitVisible(page, "p5-dialog", { context: "diálogo de salida (P5)" });
      await page.keyboard.press("Escape");
      const cerrado = await waitHidden(page, "p5-dialog", 3000);
      assert.ok(cerrado, "Escape no cierra el diálogo de salida (p5-dialog).");
      await waitVisible(page, "p1-root", { context: "Escuchar tras cerrar P5 con Escape" });
    }),
  );

  prueba("P5 sin PIN: «Volver al modo cuidador» lleva al Inicio del cuidador", () =>
    withPage(browser, VIEWPORTS.telefono, async (page) => {
      await openPatientMode(page, server.url);
      await leavePatientWithoutPin(page);
    }),
  );

  // El aviso sale a los 14 min 30 s de reproducción. Puppeteer corta cualquier llamada al navegador a los 180 s
  // (protocolTimeout por defecto), así que la espera se reparte en tramos de 60 s. Si la pantalla Escuchar deja de
  // verse mientras tanto, falla con ese motivo.
  async function esperarAvisoP6(page, ms) {
    const limite = Date.now() + ms;
    while (Date.now() < limite) {
      const inicio = Date.now();
      const aviso = await findVisibleTestid(page, "p6-dialog", Math.min(60_000, limite - inicio));
      if (aviso) return aviso;
      if (!(await isVisible(page, "p1-root", 1000))) {
        throw new Error("La pantalla Escuchar (P1) dejó de verse mientras se esperaba el aviso de apagado (P6).");
      }
      if (Date.now() - inicio < 1000) await pausa(1000);
    }
    throw new Error(
      `Falta data-testid="p6-dialog" (aviso de apagado, 30 s antes de los 15 minutos de reproducción): no aparece en ${ms} ms.`,
    );
  }

  // P6 con el temporizador real, sin gancho de prueba. El apagado más corto de C4 son 15 minutos (DESIGN 3.2 y D33)
  // y el temporizador solo cuenta mientras suena: la prueba inicia una carpeta y espera el aviso, que sale 30 s
  // antes del apagado, es decir, a los 14 min 30 s de reproducción. Por eso esta prueba tarda unos 15 minutos.
  it(
    "P6: el aviso de apagado tiene «Seguir 15 minutos más» y «Parar ahora» de 64 px",
    { timeout: 17 * 60 * 1000 },
    () =>
      withPage(browser, VIEWPORTS.telefono, async (page) => {
        await openPatientMode(page, server.url, { sleepLabels: ["15 minutos"] });
        await openPatientFolder(page);
        await clickTestid(page, "p3b-play", "botón Reproducir carpeta (P3b), que inicia la reproducción");
        await goPatientSection(page, "escuchar");
        await esperarAvisoP6(page, 16 * 60 * 1000);
        const extender = await measure(page, "p6-extend", "botón Seguir 15 minutos más (P6)");
        const parar = await measure(page, "p6-stop", "botón Parar ahora (P6)");
        expectSize("Seguir 15 minutos más (alto)", extender.height, 64);
        expectSize("Parar ahora (alto)", parar.height, 64);
      }),
  );
});
