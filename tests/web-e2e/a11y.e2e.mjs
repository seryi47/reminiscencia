// Accesibilidad de cada pantalla principal de ambos modos y de sus diálogos (WCAG 2.2 AA con axe-core).
// Criterio de error: ningún fallo de gravedad «serious» ni «critical». Además: html lang="es", un único H1
// visible, enlace de salto como primer foco y foco en el H1 al cambiar de pantalla.
// Las pantallas se localizan por data-testid del contrato. Si falta un elemento, la prueba falla con un mensaje claro.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createTestCatalogOverrides } from "./helpers/catalogo-prueba.mjs";
import { clickTestid, findVisibleTestid, isVisible, TEST_TIMEOUT_MS, waitVisible, wcagViolations } from "./helpers/elementos.mjs";
import {
  goCaregiverSection,
  goPatientSection,
  openCaregiverHome,
  openFirstProfile,
  openNewMemoryEditor,
  openNewObservationSheet,
  openPatientFolder,
  openPatientMode,
  openProfileOptionsSheet,
  openApp,
  openSessionSheet,
  startFirstRun,
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

// Pantallas del modo paciente. Cada `preparar` deja la pantalla lista para auditarla.
// P6 (aviso de apagado) no está aquí: necesita el temporizador real y se prueba aparte, más abajo.
const PANTALLAS_PACIENTE = [
  { nombre: "P1 Escuchar", preparar: (page, url) => openPatientMode(page, url) },
  { nombre: "P2 Listas", preparar: async (page, url) => { await openPatientMode(page, url); await goPatientSection(page, "listas"); } },
  { nombre: "P3 Carpetas", preparar: async (page, url) => { await openPatientMode(page, url); await goPatientSection(page, "carpetas"); } },
  { nombre: "P3b Carpeta", preparar: async (page, url) => { await openPatientMode(page, url); await openPatientFolder(page); } },
  { nombre: "P4 Buscar", preparar: async (page, url) => { await openPatientMode(page, url); await goPatientSection(page, "buscar"); } },
  {
    nombre: "P5 Salida sin PIN (diálogo)",
    preparar: async (page, url) => {
      await openPatientMode(page, url);
      await clickTestid(page, "p-caregiver", "botón Cuidador de la cabecera del paciente");
      await waitVisible(page, "p5-dialog", { context: "diálogo de salida (P5)" });
    },
  },
  {
    nombre: "P5 Salida con PIN (teclado)",
    preparar: async (page, url) => {
      await openPatientMode(page, url, { pin: true });
      await clickTestid(page, "p-caregiver", "botón Cuidador de la cabecera del paciente");
      await waitVisible(page, "p5-keypad", { context: "teclado de PIN (P5)" });
    },
  },
];

// Pantallas del modo cuidador.
const PANTALLAS_CUIDADOR = [
  { nombre: "C1 Inicio", preparar: (page, url) => openCaregiverHome(page, url) },
  { nombre: "C2 Biblioteca", preparar: async (page, url) => { await openCaregiverHome(page, url); await goCaregiverSection(page, "biblioteca"); } },
  { nombre: "C3 Perfiles", preparar: async (page, url) => { await openCaregiverHome(page, url); await goCaregiverSection(page, "perfiles"); } },
  { nombre: "C3a Ficha del perfil", preparar: async (page, url) => { await openCaregiverHome(page, url); await openFirstProfile(page); } },
  { nombre: "C3c Editor de recuerdo", preparar: async (page, url) => { await openCaregiverHome(page, url); await openNewMemoryEditor(page); } },
  { nombre: "C3d Nueva observación (hoja)", preparar: async (page, url) => { await openCaregiverHome(page, url); await openNewObservationSheet(page); } },
  { nombre: "C3e Asistente de primer perfil", preparar: async (page, url) => { await openApp(page, url); await startFirstRun(page); } },
  { nombre: "C3f Opciones del paciente (hoja)", preparar: async (page, url) => { await openCaregiverHome(page, url); await openProfileOptionsSheet(page); } },
  { nombre: "C4 Empezar sesión (hoja)", preparar: async (page, url) => { await openCaregiverHome(page, url); await openSessionSheet(page); } },
  { nombre: "C5 Ajustes", preparar: async (page, url) => { await openCaregiverHome(page, url); await goCaregiverSection(page, "ajustes"); } },
];

function describeScreens(titulo, pantallas, viewport) {
  describe(titulo, () => {
    for (const pantalla of pantallas) {
      prueba(`${pantalla.nombre}: sin fallos WCAG 2.2 AA de gravedad serious ni critical`, () =>
        withPage(browser, viewport, async (page) => {
          await pantalla.preparar(page, server.url);
          const violaciones = await wcagViolations(page);
          const graves = violaciones.filter((violacion) => violacion.impacto === "serious" || violacion.impacto === "critical");
          assert.deepEqual(graves, [], `${pantalla.nombre}: fallos de axe-core de gravedad serious o critical:`);
        }),
      );

      prueba(`${pantalla.nombre}: html con lang="es" y un único H1 visible`, () =>
        withPage(browser, viewport, async (page) => {
          await pantalla.preparar(page, server.url);
          const { lang, h1 } = await page.evaluate(() => ({
            lang: document.documentElement.getAttribute("lang"),
            h1: [...document.querySelectorAll("h1")].filter((el) => window.__e2eIsShown(el)).length,
          }));
          assert.equal(lang, "es", 'El elemento html debe tener lang="es".');
          assert.equal(h1, 1, `La pantalla debe tener un único H1 visible y tiene ${h1}.`);
        }),
      );
    }
  });
}

describeScreens("Accesibilidad del modo paciente a 390 × 844 px", PANTALLAS_PACIENTE, VIEWPORTS.telefono);
describeScreens("Accesibilidad del modo cuidador a 1440 × 900 px", PANTALLAS_CUIDADOR, VIEWPORTS.escritorio);

// P6 (aviso de apagado) con el temporizador real, sin ganchos de prueba (DESIGN 8.1). El temporizador cuenta solo el
// tiempo de reproducción: la prueba reproduce la carpeta y espera el aviso, 30 s antes de los 15 minutos. Es la única
// espera lenta de este fichero (unos 14 minutos y medio); una sola espera sirve para todas las comprobaciones.
const ESPERA_P6_MS = 15 * 60 * 1000 + 60_000;

// Espera el aviso en tramos de 60 s: una sola llamada de 15 minutos superaría el protocolTimeout de Puppeteer (180 s
// por defecto) y la prueba fallaría antes de tiempo. Si la pantalla Escuchar deja de verse mientras tanto, falla con ese motivo.
async function esperarAvisoP6(page, ms) {
  const limite = Date.now() + ms;
  while (Date.now() < limite) {
    const inicio = Date.now();
    const aviso = await findVisibleTestid(page, "p6-dialog", Math.min(60_000, limite - inicio));
    if (aviso) return aviso;
    if (!(await isVisible(page, "p1-root", 1000))) {
      throw new Error("La pantalla Escuchar (P1) dejó de verse mientras se esperaba el aviso de apagado (P6).");
    }
    // Si la espera ha fallado antes de tiempo, no se repite sin pausa.
    if (Date.now() - inicio < 1000) await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(
    `Falta data-testid="p6-dialog" (aviso de apagado, 30 s antes de los 15 minutos de reproducción): no aparece en ${ms} ms.`,
  );
}

describe("Accesibilidad del aviso de apagado (P6) con el temporizador real", () => {
  it(
    'P6 Aviso de apagado (diálogo): sin fallos WCAG 2.2 AA graves, con lang="es" y un único H1 visible',
    { timeout: ESPERA_P6_MS + TEST_TIMEOUT_MS },
    () =>
      withPage(browser, VIEWPORTS.telefono, async (page) => {
        await openPatientMode(page, server.url, { sleepLabels: ["15 minutos", "15 min", "15"] });
        await openPatientFolder(page);
        await clickTestid(page, "p3b-play", "Reproducir carpeta (P3b): arranca la reproducción que cuenta el temporizador");
        await goPatientSection(page, "escuchar");
        await esperarAvisoP6(page, ESPERA_P6_MS);
        const violaciones = await wcagViolations(page);
        const graves = violaciones.filter((violacion) => violacion.impacto === "serious" || violacion.impacto === "critical");
        const { lang, h1 } = await page.evaluate(() => ({
          lang: document.documentElement.getAttribute("lang"),
          h1: [...document.querySelectorAll("h1")].filter((el) => window.__e2eIsShown(el)).length,
        }));
        assert.deepEqual(graves, [], "P6: fallos de axe-core de gravedad serious o critical:");
        assert.equal(lang, "es", 'El elemento html debe tener lang="es".');
        assert.equal(h1, 1, `La pantalla debe tener un único H1 visible y tiene ${h1}.`);
      }),
  );
});

// El H1 de cada pantalla es el título de la cabecera (DESIGN 3.1, P-1 y C-1), no un elemento dentro de la zona de la
// pantalla. Al cambiar de pantalla, el foco pasa a ese H1 (tabindex=-1, DESIGN 7.1) y su texto es el de la nueva pantalla.
function esperarFocoEnTitulo(page, cabeceraTestid, titulo) {
  return page
    .waitForFunction(
      (cabecera, texto) => {
        const el = document.activeElement;
        const zona = document.querySelector(`[data-testid="${cabecera}"]`);
        return Boolean(
          el &&
            el.tagName === "H1" &&
            el.getAttribute("tabindex") === "-1" &&
            zona &&
            zona.contains(el) &&
            el.textContent.trim() === texto,
        );
      },
      { timeout: 3000 },
      cabeceraTestid,
      titulo,
    )
    .then(
      () => true,
      () => false,
    );
}

describe("Enlace de salto y foco", () => {
  prueba("Paciente: el primer Tab enfoca el enlace de salto (skip-link)", () =>
    withPage(browser, VIEWPORTS.telefono, async (page) => {
      await openPatientMode(page, server.url);
      // Recargar devuelve el foco al inicio del documento. La app abre en el último modo.
      await page.reload({ waitUntil: "domcontentloaded" });
      await waitVisible(page, "p1-root", { context: "Escuchar tras recargar (último modo: paciente)", ms: 10000 });
      await page.keyboard.press("Tab");
      const testid = await page.evaluate(() => document.activeElement?.dataset.testid ?? null);
      assert.equal(testid, "skip-link", `El primer foco es «${testid}» y debe ser el enlace de salto (skip-link).`);
    }),
  );

  prueba("Cuidador: el primer Tab enfoca el enlace de salto (skip-link)", () =>
    withPage(browser, VIEWPORTS.escritorio, async (page) => {
      await openCaregiverHome(page, server.url);
      await page.reload({ waitUntil: "domcontentloaded" });
      await waitVisible(page, "c-inicio", { context: "Inicio del cuidador tras recargar", ms: 10000 });
      await page.keyboard.press("Tab");
      const testid = await page.evaluate(() => document.activeElement?.dataset.testid ?? null);
      assert.equal(testid, "skip-link", `El primer foco es «${testid}» y debe ser el enlace de salto (skip-link).`);
    }),
  );

  prueba("Paciente: al cambiar a Listas, el foco pasa al H1 de la pantalla", () =>
    withPage(browser, VIEWPORTS.telefono, async (page) => {
      await openPatientMode(page, server.url);
      await goPatientSection(page, "listas");
      const enH1 = await esperarFocoEnTitulo(page, "p-header", "Listas");
      assert.ok(enH1, "Al cambiar de pantalla, el foco debe pasar al H1 de cabecera con el título «Listas» (tabindex=-1, DESIGN 3.1, P-1 y 7.1).");
    }),
  );

  prueba("Cuidador: al cambiar a Biblioteca, el foco pasa al H1 de la pantalla", () =>
    withPage(browser, VIEWPORTS.escritorio, async (page) => {
      await openCaregiverHome(page, server.url);
      await goCaregiverSection(page, "biblioteca");
      const enH1 = await esperarFocoEnTitulo(page, "c-header", "Biblioteca");
      assert.ok(enH1, "Al cambiar de pantalla, el foco debe pasar al H1 de cabecera con el título «Biblioteca» (tabindex=-1, DESIGN C-1 y 7.1).");
    }),
  );
});
