// Accesibilidad de cada pantalla principal de ambos modos y de sus diálogos (WCAG 2.2 AA con axe-core).
// Criterio de error: ningún fallo de gravedad «serious» ni «critical». Además: html lang="es", un único H1
// visible, enlace de salto como primer foco y foco en el H1 al cambiar de pantalla.
// Las pantallas se localizan por data-testid del contrato. Si falta un elemento, la prueba falla con un mensaje claro.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createTestCatalogOverrides } from "./helpers/catalogo-prueba.mjs";
import { clickTestid, TEST_TIMEOUT_MS, waitVisible, wcagViolations } from "./helpers/elementos.mjs";
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
  {
    // Requiere el gancho ?e2e=1 pendiente en app.js (ver paciente.e2e.mjs, P6).
    nombre: "P6 Aviso de apagado (diálogo)",
    preparar: async (page, url) => {
      await openPatientMode(page, `${url}?e2e=1`, { sleepLabels: ["60 minutos", "60 min", "60"] });
      await waitVisible(page, "p6-dialog", { ms: 45000, context: "aviso de apagado (P6); requiere el gancho ?e2e=1" });
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
      const enH1 = await page
        .waitForFunction(
          () => {
            const el = document.activeElement;
            const root = document.querySelector('[data-testid="p2-root"]');
            return Boolean(el && el.tagName === "H1" && root && root.contains(el));
          },
          { timeout: 3000 },
        )
        .then(
          () => true,
          () => false,
        );
      assert.ok(enH1, "Al cambiar de pantalla, el foco debe pasar al H1 de la nueva pantalla (tabindex=-1, DESIGN 7.1).");
    }),
  );

  prueba("Cuidador: al cambiar a Biblioteca, el foco pasa al H1 de la pantalla", () =>
    withPage(browser, VIEWPORTS.escritorio, async (page) => {
      await openCaregiverHome(page, server.url);
      await goCaregiverSection(page, "biblioteca");
      const enH1 = await page
        .waitForFunction(
          () => {
            const el = document.activeElement;
            const root = document.querySelector('[data-testid="c-biblioteca"]');
            return Boolean(el && el.tagName === "H1" && root && root.contains(el));
          },
          { timeout: 3000 },
        )
        .then(
          () => true,
          () => false,
        );
      assert.ok(enH1, "Al cambiar de pantalla, el foco debe pasar al H1 de la nueva pantalla (tabindex=-1, DESIGN 7.1).");
    }),
  );
});
