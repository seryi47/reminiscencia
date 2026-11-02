// Modo cuidador: medidas de DESIGN 15 a 1440 × 900 y 390 × 844 px, asistente, sesión y atajos de teclado.
// Las pantallas se localizan solo por data-testid del contrato (sección 5). Si falta un elemento, la prueba
// falla con un mensaje claro: no se salta.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createTestCatalogOverrides } from "./helpers/catalogo-prueba.mjs";
import {
  caregiverNavBox,
  clickTestid,
  countFullyVisibleRows,
  expectSize,
  focusRingWidth,
  focusWithKeyboardMode,
  measure,
  pressCommandKey,
  TEST_TIMEOUT_MS,
  textOf,
  verticalScrollState,
  waitVisible,
} from "./helpers/elementos.mjs";
import {
  goCaregiverSection,
  openApp,
  openCaregiverHome,
  openFirstProfile,
  openSessionSheet,
  startFirstRun,
  TEST_PROFILE,
  typeInto,
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

// ---------------------------------------------------------------------------
describe("Biblioteca a 1440 × 900 px (escritorio)", () => {
  prueba("Biblioteca a 1440 px: la barra lateral mide 240 px", () =>
    withPage(browser, VIEWPORTS.escritorio, async (page) => {
      await openCaregiverHome(page, server.url);
      await goCaregiverSection(page, "biblioteca");
      const caja = await measure(page, "c-sidebar", "barra lateral del cuidador");
      expectSize("Barra lateral (ancho)", caja.width, 240);
    }),
  );

  prueba("Biblioteca a 1440 px: el panel de canción es persistente y mide 320 px sin pulsar nada", () =>
    withPage(browser, VIEWPORTS.escritorio, async (page) => {
      await openCaregiverHome(page, server.url);
      await goCaregiverSection(page, "biblioteca");
      const caja = await measure(page, "c-panel", "panel de canción (C2b) sin selección");
      expectSize("Panel de canción (ancho)", caja.width, 320);
    }),
  );

  // Rediseño (lista de estilo Apple Music): la fila pasa de 40 a 56 px para que quepa el menú de 44 px y la portada de 40 px.
  prueba("Biblioteca a 1440 px: las filas de la lista miden 56 px", () =>
    withPage(browser, VIEWPORTS.escritorio, async (page) => {
      await openCaregiverHome(page, server.url);
      await goCaregiverSection(page, "biblioteca");
      const caja = await measure(page, "c-biblioteca-row", "primera fila de la lista (C2)");
      expectSize("Fila de la lista (alto)", caja.height, 56);
    }),
  );

  // Con filas de 56 px, a 1440 × 900 caben 11 filas completas (antes 17, con filas de 40 px).
  prueba("Biblioteca a 1440 px: se ven 11 filas completas de la lista", () =>
    withPage(browser, VIEWPORTS.escritorio, async (page) => {
      await openCaregiverHome(page, server.url);
      await goCaregiverSection(page, "biblioteca");
      const visibles = await countFullyVisibleRows(page, "c-biblioteca-row", "filas de la lista (C2)");
      assert.equal(visibles, 11, `Se ven ${visibles} filas completas y el rediseño mide 11 a 1440 × 900 con filas de 56 px.`);
    }),
  );

  prueba("Biblioteca a 1440 px: la barra de reproducción mide 76 px", () =>
    withPage(browser, VIEWPORTS.escritorio, async (page) => {
      await openCaregiverHome(page, server.url);
      await goCaregiverSection(page, "biblioteca");
      const caja = await measure(page, "c-now", "barra de reproducción del cuidador");
      expectSize("Barra de reproducción (alto)", caja.height, 76);
    }),
  );

  prueba("Biblioteca a 1440 px: la página no tiene desplazamiento vertical", () =>
    withPage(browser, VIEWPORTS.escritorio, async (page) => {
      await openCaregiverHome(page, server.url);
      await goCaregiverSection(page, "biblioteca");
      const { scrollHeight, viewportHeight } = await verticalScrollState(page);
      assert.ok(
        scrollHeight <= viewportHeight + 1,
        `La página mide ${scrollHeight} px de alto en una ventana de ${viewportHeight} px. La tabla debe desplazarse por dentro.`,
      );
    }),
  );

  prueba("Biblioteca a 1440 px: el anillo de foco del cuidador mide 2 px", () =>
    withPage(browser, VIEWPORTS.escritorio, async (page) => {
      await openCaregiverHome(page, server.url);
      await goCaregiverSection(page, "biblioteca");
      const info = await focusWithKeyboardMode(page, "c-nav-biblioteca", "destino Biblioteca de la navegación");
      expectSize("Anillo de foco del cuidador", focusRingWidth(info), 2, { tolerance: 0.5 });
    }),
  );

  prueba("Cabecera del cuidador a 1440 px mide 88 px de alto", () =>
    withPage(browser, VIEWPORTS.escritorio, async (page) => {
      await openCaregiverHome(page, server.url);
      const caja = await measure(page, "c-header", "cabecera del cuidador");
      expectSize("Cabecera del cuidador (alto)", caja.height, 88);
    }),
  );
});

// ---------------------------------------------------------------------------
describe("Biblioteca a 390 × 844 px (teléfono)", () => {
  prueba("Biblioteca a 390 px: la barra inferior mide 64 px", () =>
    withPage(browser, VIEWPORTS.telefono, async (page) => {
      await openCaregiverHome(page, server.url);
      await goCaregiverSection(page, "biblioteca");
      const barra = await caregiverNavBox(page);
      expectSize("Barra inferior del cuidador (alto)", barra.height, 64);
    }),
  );

  prueba("Biblioteca a 390 px: las filas de la tabla son tarjetas de 72 px", () =>
    withPage(browser, VIEWPORTS.telefono, async (page) => {
      await openCaregiverHome(page, server.url);
      await goCaregiverSection(page, "biblioteca");
      const caja = await measure(page, "c-biblioteca-row", "tarjeta de canción (C2) a 390 px");
      expectSize("Tarjeta de canción (alto)", caja.height, 72);
    }),
  );
});

// ---------------------------------------------------------------------------
describe("Inicio, perfiles y asistente de primer perfil", () => {
  prueba("Inicio muestra el botón Abrir modo paciente (c-open-patient)", () =>
    withPage(browser, VIEWPORTS.escritorio, async (page) => {
      await openCaregiverHome(page, server.url);
      await waitVisible(page, "c-open-patient", { context: "botón Abrir modo paciente (C1)" });
    }),
  );

  prueba("Inicio muestra la zona de pendientes (c-inicio-pending)", () =>
    withPage(browser, VIEWPORTS.escritorio, async (page) => {
      await openCaregiverHome(page, server.url);
      await waitVisible(page, "c-inicio-pending", { context: "zona de pendientes (C1)" });
    }),
  );

  prueba("Perfiles: «Nuevo perfil» abre el asistente de primer perfil (C3e)", () =>
    withPage(browser, VIEWPORTS.escritorio, async (page) => {
      await openCaregiverHome(page, server.url);
      await goCaregiverSection(page, "perfiles");
      await clickTestid(page, "c-profile-new", "botón Nuevo perfil (C3)");
      await waitVisible(page, "c-wizard", { context: "asistente de primer perfil (C3e)" });
    }),
  );

  prueba("La ficha del perfil muestra sus cinco pestañas", () =>
    withPage(browser, VIEWPORTS.escritorio, async (page) => {
      await openCaregiverHome(page, server.url);
      await openFirstProfile(page);
      const faltan = [];
      for (const pestana of ["canciones", "recuerdos", "listas", "observaciones", "historial"]) {
        if (!(await waitVisible(page, `c-tab-${pestana}`, { context: "pestañas del perfil (C3a)" }).then(
          () => true,
          () => false,
        ))) {
          faltan.push(pestana);
        }
      }
      assert.deepEqual(faltan, [], "Estas pestañas del perfil (DESIGN C3a) no aparecen:");
    }),
  );

  prueba("El asistente muestra «Ahora no» en el paso del PIN (c-wizard-skip-pin)", () =>
    withPage(browser, VIEWPORTS.escritorio, async (page) => {
      await openApp(page, server.url);
      await startFirstRun(page);
      await typeInto(page, "c-wizard", TEST_PROFILE.alias, { context: "paso 1 del asistente: alias" });
      await clickTestid(page, "c-wizard-next", "paso 1 del asistente");
      await clickTestid(page, "c-wizard-next", "paso 2 del asistente");
      await waitVisible(page, "c-wizard-skip-pin", { context: "paso 3 del asistente: «Ahora no» (C3e)" });
    }),
  );

  prueba("El asistente no repite «Nuevo perfil» a la vista: su H2 existe pero está oculto y el H1 del marco se ve", () =>
    withPage(browser, VIEWPORTS.escritorio, async (page) => {
      await openApp(page, server.url);
      await startFirstRun(page);
      await waitVisible(page, "c-wizard", { context: "asistente de primer perfil (C3e)" });
      const estado = await page.evaluate(() => {
        const titulo = document.getElementById("cp-titulo-asistente");
        const cabecera = [...document.querySelectorAll("h1")].filter((el) => window.__e2eIsShown(el));
        return {
          existe: Boolean(titulo),
          etiqueta: titulo?.tagName ?? null,
          // visually-hidden mide 1 px y va recortado: no se ve, aunque tenga rectángulo.
          visible: titulo ? titulo.getBoundingClientRect().width > 1 && titulo.getBoundingClientRect().height > 1 : null,
          nombraSeccion: document.querySelector('[data-testid="c-wizard"]')?.getAttribute("aria-labelledby"),
          h1Visibles: cabecera.length,
          textoH1: cabecera[0]?.textContent.trim() ?? "",
        };
      });
      assert.equal(estado.existe, true, "El H2 del asistente (cp-titulo-asistente) debe seguir en el DOM para los lectores de pantalla.");
      assert.equal(estado.etiqueta, "H2", "El título del asistente sigue siendo un H2 (DESIGN 3.1).");
      assert.equal(estado.visible, false, "El título del asistente no debe verse: el marco ya muestra «Nuevo perfil».");
      assert.equal(estado.nombraSeccion, "cp-titulo-asistente", "La sección del asistente sigue nombrada por su H2 oculto.");
      assert.equal(estado.h1Visibles, 1, "Debe quedar un único H1 visible (cabecera del marco).");
      assert.equal(estado.textoH1, "Nuevo perfil", "El H1 del marco muestra «Nuevo perfil».");
    }),
  );
});

// ---------------------------------------------------------------------------
describe("Sesión: Empezar sesión desde el cuidador", () => {
  prueba("Empezar sesión lleva a Escuchar sin iniciar el audio", () =>
    withPage(browser, VIEWPORTS.escritorio, async (page) => {
      await openCaregiverHome(page, server.url);
      await openSessionSheet(page);
      await clickTestid(page, "c-session-start", "botón Empezar de la hoja C4");
      await waitVisible(page, "p1-root", { context: "pantalla Escuchar del paciente (P1)", ms: 10000 });
      const plays = await page.evaluate(() => window.__e2ePlayCalls ?? 0);
      assert.equal(plays, 0, "Empezar sesión no debe iniciar el audio: el paciente pulsa Reproducir (DESIGN 8.1).");
    }),
  );
});

// ---------------------------------------------------------------------------
describe("Ajustes y atajos de teclado", () => {
  prueba("Ajustes muestra escala de texto, contraste, apariencia y movimiento", () =>
    withPage(browser, VIEWPORTS.escritorio, async (page) => {
      await openCaregiverHome(page, server.url);
      await goCaregiverSection(page, "ajustes");
      const faltan = [];
      for (const id of ["c-settings-text-scale", "c-settings-contrast", "c-settings-theme", "c-settings-reduce-motion"]) {
        const visible = await waitVisible(page, id, { context: "ajustes de apariencia y accesibilidad (C5)" }).then(
          () => true,
          () => false,
        );
        if (!visible) faltan.push(id);
      }
      assert.deepEqual(faltan, [], "Estos ajustes de C5 no aparecen:");
    }),
  );

  prueba("Ctrl/Cmd+K enfoca la búsqueda de la biblioteca", () =>
    withPage(browser, VIEWPORTS.escritorio, async (page) => {
      await openCaregiverHome(page, server.url);
      await goCaregiverSection(page, "biblioteca");
      await pressCommandKey(page, "KeyK");
      const enfocada = await page
        .waitForFunction(
          () => {
            const search = document.querySelector('[data-testid="c-biblioteca-search"]');
            const active = document.activeElement;
            return Boolean(search && active && (search === active || search.contains(active)));
          },
          { timeout: 3000 },
        )
        .then(
          () => true,
          () => false,
        );
      assert.ok(enfocada, "Ctrl/Cmd+K no enfoca el campo de búsqueda de la biblioteca (c-biblioteca-search).");
    }),
  );

  prueba("Ctrl/Cmd+A selecciona las filas visibles de la biblioteca", () =>
    withPage(browser, VIEWPORTS.escritorio, async (page) => {
      await openCaregiverHome(page, server.url);
      await goCaregiverSection(page, "biblioteca");
      await clickTestid(page, "c-biblioteca-row", "primera fila de la tabla (C2)");
      await pressCommandKey(page, "KeyA");
      await waitVisible(page, "c-biblioteca-bulk", { context: "barra de selección múltiple (C18)" });
    }),
  );

  prueba("El panel sin selección muestra «No suena nada» (C-20)", () =>
    withPage(browser, VIEWPORTS.escritorio, async (page) => {
      await openCaregiverHome(page, server.url);
      await goCaregiverSection(page, "biblioteca");
      const texto = await textOf(page, "c-panel", "panel de canción (C2b)");
      assert.ok(texto.includes("No suena nada"), `El panel muestra «${texto.slice(0, 80)}» y DESIGN C-20 fija «No suena nada».`);
    }),
  );

  prueba("«Vista previa» abre Escuchar del paciente sin reproducir nada", () =>
    withPage(browser, VIEWPORTS.escritorio, async (page) => {
      await openCaregiverHome(page, server.url);
      await goCaregiverSection(page, "biblioteca");
      await clickTestid(page, "c-biblioteca-preview", "botón Vista previa (C2)");
      await waitVisible(page, "p1-root", { context: "vista previa del paciente (P1)" });
      await pausa(300);
      const plays = await page.evaluate(() => window.__e2ePlayCalls ?? 0);
      assert.equal(plays, 0, "La vista previa no debe reproducir nada (DESIGN 3.2: no crea sesión ni registra eventos).");
    }),
  );
});

// ---------------------------------------------------------------------------
// Biblioteca: borrar una canción subida desde este navegador (ADR-0012). Las públicas no ofrecen la opción.
const ID_CANCION_LOCAL = "L0011223344556677";
const TITULO_CANCION_LOCAL = "Canción local de prueba";
const TEXTO_CONFIRMACION_BORRAR = "¿Borrar esta canción de este navegador? No se puede deshacer.";

// Siembra un registro en la base de audio local del navegador (la misma que usa subida-local.js).
async function sembrarCancionLocal(page) {
  await page.evaluate(
    async ({ id, title }) => {
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open("reminiscencia-audio-local", 1);
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains("pistas")) {
            request.result.createObjectStore("pistas", { keyPath: "id" });
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      await new Promise((resolve, reject) => {
        const tx = db.transaction("pistas", "readwrite");
        tx.objectStore("pistas").put({
          id,
          title,
          durationS: 60,
          channels: 1,
          bitrate: 32000,
          bytes: 8,
          createdAt: Date.now(),
          blob: new Blob([new Uint8Array(8)], { type: "audio/ogg" }),
        });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    },
    { id: ID_CANCION_LOCAL, title: TITULO_CANCION_LOCAL },
  );
}

// Cuántos registros hay en la base de audio local del navegador.
async function contarCancionesLocales(page) {
  return page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("reminiscencia-audio-local");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const total = await new Promise((resolve, reject) => {
      const request = db.transaction("pistas", "readonly").objectStore("pistas").count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return total;
  });
}

// Abre el menú «Más opciones» de una fila y devuelve el texto de sus opciones.
async function abrirMenuDeFila(page, songId) {
  const boton = `[data-testid="c-biblioteca-row"][data-song-id="${songId}"] [data-control="menu"]`;
  await page.waitForSelector(boton, { timeout: 5000 });
  await page.click(boton);
  await page.waitForSelector(".c-biblioteca-menu [role='menuitem']", { timeout: 5000 });
  return page.$$eval(".c-biblioteca-menu [role='menuitem']", (items) => items.map((item) => item.textContent.trim()));
}

describe("Biblioteca: borrar canciones subidas desde este navegador", () => {
  prueba("El menú de una canción pública no ofrece «Borrar de este navegador»", () =>
    withPage(browser, VIEWPORTS.escritorio, async (page) => {
      await openCaregiverHome(page, server.url);
      await goCaregiverSection(page, "biblioteca");
      const idPublica = await page.$$eval('[data-testid="c-biblioteca-row"]', (filas) => filas.map((fila) => fila.dataset.songId).find((id) => id && id.startsWith("S")));
      assert.ok(idPublica, "La biblioteca de prueba debe tener al menos una canción pública.");
      const opciones = await abrirMenuDeFila(page, idPublica);
      await page.keyboard.press("Escape");
      assert.equal(opciones.includes("Borrar de este navegador"), false, `El menú de una canción pública muestra: ${opciones.join(", ")}`);
    }),
  );

  prueba("Borrar una canción local pide confirmación y la quita de la lista y de este navegador", () =>
    withPage(browser, VIEWPORTS.escritorio, async (page) => {
      await openCaregiverHome(page, server.url);
      await sembrarCancionLocal(page);
      await page.reload({ waitUntil: "domcontentloaded" });
      await goCaregiverSection(page, "biblioteca");
      const opciones = await abrirMenuDeFila(page, ID_CANCION_LOCAL);
      assert.ok(opciones.includes("Borrar de este navegador"), `El menú de la canción local no ofrece borrar: ${opciones.join(", ")}`);
      // Por teclado: el foco inicial está en la primera opción; ArrowDown avanza hasta «Borrar de este navegador».
      let enfocada = "";
      for (let intento = 0; intento < 5 && enfocada !== "Borrar de este navegador"; intento += 1) {
        await page.keyboard.press("ArrowDown");
        enfocada = await page.evaluate(() => document.activeElement?.textContent.trim() ?? "");
      }
      assert.equal(enfocada, "Borrar de este navegador", "Con el teclado no se llega a la opción de borrar del menú.");
      await page.keyboard.press("Enter");
      await page.waitForFunction((texto) => document.body.innerText.includes(texto), { timeout: 5000 }, TEXTO_CONFIRMACION_BORRAR);
      await clickTestid(page, "app-confirm-ok", "confirmación «Borrar» de la canción local");
      await page.waitForFunction((id) => !document.querySelector(`[data-song-id="${id}"]`), { timeout: 5000 }, ID_CANCION_LOCAL);
      assert.equal(await contarCancionesLocales(page), 0, "La canción borrada sigue en IndexedDB de este navegador.");
    }),
  );
});
