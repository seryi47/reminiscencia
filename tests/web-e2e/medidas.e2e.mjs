// Medidas del rediseño (estructura visual de Apple Music web) en los cinco anchos de referencia: 390, 600, 820, 1024 y 1440 px.
// Valores de la especificación del rediseño:
//   Escritorio (≥1024 px): barra lateral de 240 px; título de página de 40 px con peso 700; reproductor fijo de 76 px.
//   Tableta (600–1023 px): riel lateral de 72 px; reproductor de 76 px.
//   Teléfono (<600 px): barra de pestañas inferior con cinco destinos; minirreproductor de 64 px; objetivos táctiles de 44 px.
// Tolerancia de medida: ±2 px («±2 px es la tolerancia de medición»). Los mínimos («o más») se miden con la misma tolerancia.
// Las medidas que la especificación no fija no se comprueban aquí. Además, cada ancho guarda capturas de las pantallas
// de ambos modos en tests/web-e2e/capturas.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createTestCatalogOverrides } from "./helpers/catalogo-prueba.mjs";
import {
  caregiverNavBox,
  clickTestid,
  collectTabStops,
  countInteractive,
  elementsWithMotion,
  expectSize,
  horizontalScrollState,
  measure,
  overlappingPairs,
  smallTextElements,
  TEST_TIMEOUT_MS,
  TOLERANCE_PX,
  verticalScrollState,
  waitHidden,
  waitVisible,
} from "./helpers/elementos.mjs";
import {
  goCaregiverSection,
  goPatientSection,
  openCaregiverHome,
  openFirstProfile,
  openNewMemoryEditor,
  openPatientMode,
  openSessionSheet,
  setTextScale,
} from "./helpers/flujos.mjs";
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

/** Tamaño y peso de la letra del título de página del paciente (h1 de su cabecera). */
async function tituloDePagina(page) {
  const titulo = await waitVisible(page, "p-title", { context: "título de página del paciente" });
  return titulo.evaluate((el) => {
    const estilo = getComputedStyle(el);
    return { fontSize: parseFloat(estilo.fontSize), fontWeight: estilo.fontWeight };
  });
}

/**
 * Controles táctiles visibles (enlaces, botones y elementos con role="button") dentro de un contenedor con data-testid
 * que miden menos que el mínimo. Usa la misma tolerancia que el resto de las medidas mínimas.
 */
async function objetivosPorDebajoDe(page, testid, minimo) {
  return page.evaluate(
    (id, minimum, tolerancia) =>
      [
        ...document.querySelectorAll(
          `[data-testid="${id}"] a, [data-testid="${id}"] button, [data-testid="${id}"] [role="button"]`,
        ),
      ]
        .filter((el) => window.__e2eIsShown(el))
        .map((el) => {
          const rect = el.getBoundingClientRect();
          const nombre =
            el.textContent.replace(/\s+/g, " ").trim() || el.getAttribute("aria-label") || el.tagName.toLowerCase();
          return { nombre, ancho: rect.width, alto: rect.height };
        })
        .filter((caja) => caja.ancho < minimum - tolerancia || caja.alto < minimum - tolerancia),
    testid,
    minimo,
    TOLERANCE_PX,
  );
}

async function assertNoHorizontalScroll(page, nombre) {
  const { scrollWidth, clientWidth } = await horizontalScrollState(page);
  assert.ok(
    scrollWidth <= clientWidth,
    `${nombre}: scrollWidth (${scrollWidth}) supera clientWidth (${clientWidth}): hay desplazamiento horizontal.`,
  );
}

async function assertNoVerticalScroll(page, nombre) {
  const { scrollHeight, viewportHeight } = await verticalScrollState(page);
  assert.ok(
    scrollHeight <= viewportHeight + 1,
    `${nombre}: la página mide ${scrollHeight} px de alto en una ventana de ${viewportHeight} px.`,
  );
}

/** Capturas de las pantallas principales del paciente. Cada captura confirma que la pantalla se renderiza. */
async function captureAllPatientScreens(page, ancho) {
  await openPatientMode(page, server.url);
  await capture(page, `${ancho}-paciente-escuchar`);
  for (const seccion of ["listas", "carpetas", "buscar"]) {
    await goPatientSection(page, seccion);
    await capture(page, `${ancho}-paciente-${seccion}`);
  }
}

/**
 * Capturas de las pantallas principales del cuidador (Inicio, Sesión, Biblioteca, Perfiles, Ajustes, Ficha y Editor).
 * El editor de recuerdo va el último: a 390 px es pantalla completa y puede tapar la barra de navegación.
 */
async function captureAllCaregiverScreens(page, ancho) {
  await openCaregiverHome(page, server.url);
  await capture(page, `${ancho}-cuidador-inicio`);
  await openSessionSheet(page);
  await capture(page, `${ancho}-cuidador-sesion`);
  await page.keyboard.press("Escape");
  await waitHidden(page, "c-session-sheet", 3000);
  await goCaregiverSection(page, "biblioteca");
  await capture(page, `${ancho}-cuidador-biblioteca`);
  await goCaregiverSection(page, "perfiles");
  await capture(page, `${ancho}-cuidador-perfiles`);
  await goCaregiverSection(page, "ajustes");
  await capture(page, `${ancho}-cuidador-ajustes`);
  await openFirstProfile(page);
  await capture(page, `${ancho}-cuidador-ficha-perfil`);
  await openNewMemoryEditor(page);
  await capture(page, `${ancho}-cuidador-editor-recuerdo`);
}

// ---------------------------------------------------------------------------
describe("Rediseño · 390 × 844 px (teléfono)", () => {
  const telefono = VIEWPORTS.telefono;

  prueba("390 px · Escuchar: el botón Cuidador mide 44 px o más de alto (objetivo táctil)", () =>
    withPage(browser, telefono, async (page) => {
      await openPatientMode(page, server.url);
      const caja = await measure(page, "p-caregiver", "botón Cuidador de la cabecera");
      expectSize("Botón Cuidador (alto)", caja.height, 44, { minimum: true });
    }),
  );

  prueba("390 px · Escuchar: Anterior, Reproducir y Siguiente miden 44 px o más (objetivos táctiles)", () =>
    withPage(browser, telefono, async (page) => {
      await openPatientMode(page, server.url);
      const anterior = await measure(page, "p1-prev", "botón Anterior de P1");
      const reproducir = await measure(page, "p1-toggle", "botón Reproducir de P1");
      const siguiente = await measure(page, "p1-next", "botón Siguiente de P1");
      expectSize("Anterior", anterior.width, 44, { minimum: true });
      expectSize("Anterior (alto)", anterior.height, 44, { minimum: true });
      expectSize("Reproducir", reproducir.width, 44, { minimum: true });
      expectSize("Reproducir (alto)", reproducir.height, 44, { minimum: true });
      expectSize("Siguiente", siguiente.width, 44, { minimum: true });
      expectSize("Siguiente (alto)", siguiente.height, 44, { minimum: true });
    }),
  );

  prueba("390 px · Escuchar: la zona de progreso mide 44 px o más de alto (objetivo táctil)", () =>
    withPage(browser, telefono, async (page) => {
      await openPatientMode(page, server.url);
      const progreso = await measure(page, "p1-progress", "zona de progreso de P1");
      expectSize("Zona de progreso (alto)", progreso.height, 44, { minimum: true });
    }),
  );

  prueba("390 px · Escuchar: los botones de volumen miden 44 px o más (objetivos táctiles)", () =>
    withPage(browser, telefono, async (page) => {
      await openPatientMode(page, server.url);
      const bajar = await measure(page, "p1-vol-down", "botón Bajar volumen de P1");
      const subir = await measure(page, "p1-vol-up", "botón Subir volumen de P1");
      expectSize("Bajar volumen", bajar.width, 44, { minimum: true });
      expectSize("Bajar volumen (alto)", bajar.height, 44, { minimum: true });
      expectSize("Subir volumen", subir.width, 44, { minimum: true });
      expectSize("Subir volumen (alto)", subir.height, 44, { minimum: true });
    }),
  );

  prueba("390 px · Escuchar: la barra inferior muestra sus cinco destinos", () =>
    withPage(browser, telefono, async (page) => {
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
      assert.deepEqual(faltan, [], "Destinos ausentes de la barra inferior:");
      const destinos = await countInteractive(page, "p-nav", "barra inferior del paciente");
      assert.equal(destinos, 5, `La barra inferior muestra ${destinos} destinos y la especificación fija cinco.`);
    }),
  );

  prueba("390 px · paciente: los destinos de la barra inferior miden 44 px o más (objetivos táctiles)", () =>
    withPage(browser, telefono, async (page) => {
      await openPatientMode(page, server.url);
      await waitVisible(page, "p-nav", { context: "barra inferior del paciente" });
      const pequeños = await objetivosPorDebajoDe(page, "p-nav", 44);
      assert.deepEqual(pequeños, [], "Destinos de la barra inferior del paciente con menos de 44 px:");
    }),
  );

  prueba("390 px · Escuchar: el texto del paciente tiene 18 px o más", () =>
    withPage(browser, telefono, async (page) => {
      await openPatientMode(page, server.url);
      const pequeños = await smallTextElements(page, 18);
      assert.deepEqual(pequeños, [], "Texto del paciente con menos de 18 px:");
    }),
  );

  prueba("390 px · Escuchar: ningún elemento enfocado queda tapado por la barra inferior", () =>
    withPage(browser, telefono, async (page) => {
      await openPatientMode(page, server.url);
      const paradas = await collectTabStops(page, { maximo: 30 });
      const tapados = paradas.filter((parada) => parada.covered).map((parada) => `${parada.name} (tapado por ${parada.coveredBy})`);
      assert.deepEqual(tapados, [], "Elementos enfocados que quedan tapados al recorrer con Tab:");
    }),
  );

  prueba("390 px · Escuchar con reducir movimiento: ninguna transición ni animación dura más de 0 ms", () =>
    withPage(browser, telefono, async (page) => {
      await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
      await openPatientMode(page, server.url);
      const conMovimiento = await elementsWithMotion(page);
      assert.deepEqual(conMovimiento, [], "Elementos con duración mayor que 0 ms con reducir movimiento activo:");
    }),
  );

  prueba("390 px · Escala de texto 1,75: sin desplazamiento horizontal ni solapes en Escuchar", () =>
    withPage(browser, telefono, async (page) => {
      await openCaregiverHome(page, server.url);
      // Las etiquetas de la escala están fijadas por DESIGN 5.3 («Máximo» y 1,75). Sin data-testid por opción.
      await setTextScale(page, ["Máximo", "1,75"]);
      await goCaregiverSection(page, "inicio");
      await openSessionSheet(page);
      await clickTestid(page, "c-session-start", "botón Empezar de la hoja C4");
      await waitVisible(page, "p1-root", { context: "Escuchar con escala 1,75", ms: 10000 });
      const escala = await page.evaluate(() => document.documentElement.dataset.escala ?? null);
      assert.equal(escala, "1.75", `html[data-escala] debe ser "1.75" y es «${escala}» (contrato §4).`);
      await assertNoHorizontalScroll(page, "Escuchar con escala 1,75");
      const solapes = await overlappingPairs(page, [
        "p1-title",
        "p1-artist",
        "p1-progress",
        "p1-prev",
        "p1-toggle",
        "p1-next",
        "p1-vol-down",
        "p1-vol-up",
        "p1-photo",
        "p1-memory",
      ]);
      assert.deepEqual(solapes, [], "Elementos de Escuchar que se solapan con escala 1,75:");
    }),
  );

  prueba("390 px · Escuchar: sin desplazamiento horizontal", () =>
    withPage(browser, telefono, async (page) => {
      await openPatientMode(page, server.url);
      await assertNoHorizontalScroll(page, "Escuchar del paciente a 390 px");
    }),
  );

  prueba("390 px · cuidador: la biblioteca no tiene desplazamiento horizontal", () =>
    withPage(browser, telefono, async (page) => {
      await openCaregiverHome(page, server.url);
      await goCaregiverSection(page, "biblioteca");
      await assertNoHorizontalScroll(page, "Biblioteca del cuidador a 390 px");
    }),
  );

  prueba("390 px · cuidador: los destinos de la barra inferior miden 44 px o más (objetivos táctiles)", () =>
    withPage(browser, telefono, async (page) => {
      await openCaregiverHome(page, server.url);
      await goCaregiverSection(page, "biblioteca");
      const pequeños = await objetivosPorDebajoDe(page, "c-sidebar", 44);
      assert.deepEqual(pequeños, [], "Destinos de la barra inferior del cuidador con menos de 44 px:");
    }),
  );

  prueba("390 px · cuidador: el mini reproductor mide 64 px y queda encima de la barra inferior", () =>
    withPage(browser, telefono, async (page) => {
      await openCaregiverHome(page, server.url);
      await goCaregiverSection(page, "biblioteca");
      const mini = await measure(page, "c-now", "mini reproductor del cuidador");
      const barra = await caregiverNavBox(page);
      expectSize("Mini reproductor (alto)", mini.height, 64);
      expectSize("Separación entre el mini reproductor y la barra inferior", barra.top - mini.bottom, 0);
    }),
  );

  prueba("390 px · cuidador: el texto de la biblioteca tiene 13 px o más (cabeceras de tabla, 12 px)", () =>
    withPage(browser, telefono, async (page) => {
      await openCaregiverHome(page, server.url);
      await goCaregiverSection(page, "biblioteca");
      const pequeños = await smallTextElements(page, 13, { tableHeadersAllowed: true });
      assert.deepEqual(pequeños, [], "Texto del cuidador con menos de 13 px:");
    }),
  );

  prueba("Capturas a 390 px · pantallas del paciente (Escuchar, Listas, Carpetas y Buscar)", () =>
    withPage(browser, telefono, (page) => captureAllPatientScreens(page, "390x844")),
  );

  prueba("Capturas a 390 px · pantallas del cuidador (Inicio a Ajustes)", () =>
    withPage(browser, telefono, (page) => captureAllCaregiverScreens(page, "390x844")),
  );
});

// ---------------------------------------------------------------------------
describe("Rediseño · 600 × 960 px (tableta estrecha)", () => {
  // Ancho de inicio de la tableta. VIEWPORTS (helpers/navegador.mjs) no lo incluye, así que se define aquí.
  const tabletaEstrecha = Object.freeze({ width: 600, height: 960 });

  prueba("600 px · paciente: el riel lateral mide 72 px de ancho", () =>
    withPage(browser, tabletaEstrecha, async (page) => {
      await openPatientMode(page, server.url);
      expectSize("Riel lateral del paciente (ancho)", (await measure(page, "p-nav", "riel lateral del paciente")).width, 72);
    }),
  );

  prueba("600 px · cuidador: el riel lateral mide 72 px de ancho", () =>
    withPage(browser, tabletaEstrecha, async (page) => {
      await openCaregiverHome(page, server.url);
      await goCaregiverSection(page, "biblioteca");
      expectSize("Riel lateral del cuidador (ancho)", (await caregiverNavBox(page)).width, 72);
    }),
  );

  prueba("600 px · cuidador: la barra de reproducción mide 76 px", () =>
    withPage(browser, tabletaEstrecha, async (page) => {
      await openCaregiverHome(page, server.url);
      await goCaregiverSection(page, "biblioteca");
      expectSize("Barra de reproducción (alto)", (await measure(page, "c-now", "barra de reproducción")).height, 76);
    }),
  );

  prueba("600 px · Escuchar: sin desplazamiento horizontal", () =>
    withPage(browser, tabletaEstrecha, async (page) => {
      await openPatientMode(page, server.url);
      await assertNoHorizontalScroll(page, "Escuchar del paciente a 600 px");
    }),
  );

  prueba("600 px · Biblioteca: sin desplazamiento horizontal", () =>
    withPage(browser, tabletaEstrecha, async (page) => {
      await openCaregiverHome(page, server.url);
      await goCaregiverSection(page, "biblioteca");
      await assertNoHorizontalScroll(page, "Biblioteca del cuidador a 600 px");
    }),
  );

  prueba("Capturas a 600 px · pantallas del paciente", () =>
    withPage(browser, tabletaEstrecha, (page) => captureAllPatientScreens(page, "600x960")),
  );

  prueba("Capturas a 600 px · pantallas del cuidador", () =>
    withPage(browser, tabletaEstrecha, (page) => captureAllCaregiverScreens(page, "600x960")),
  );
});

// ---------------------------------------------------------------------------
describe("Rediseño · 820 × 1180 px (tableta vertical)", () => {
  const tableta = VIEWPORTS.tabletaVertical;

  prueba("820 px · paciente: el riel lateral mide 72 px de ancho", () =>
    withPage(browser, tableta, async (page) => {
      await openPatientMode(page, server.url);
      expectSize("Riel lateral del paciente (ancho)", (await measure(page, "p-nav", "riel lateral del paciente")).width, 72);
    }),
  );

  prueba("820 px · Escuchar se ve completo sin desplazamiento de página", () =>
    withPage(browser, tableta, async (page) => {
      await openPatientMode(page, server.url);
      await assertNoVerticalScroll(page, "Escuchar a 820 px");
    }),
  );

  prueba("820 px · cuidador: el riel lateral mide 72 px de ancho", () =>
    withPage(browser, tableta, async (page) => {
      await openCaregiverHome(page, server.url);
      await goCaregiverSection(page, "biblioteca");
      expectSize("Riel lateral del cuidador (ancho)", (await caregiverNavBox(page)).width, 72);
    }),
  );

  prueba("820 px · cuidador: al abrir el panel, la tabla no se mueve", () =>
    withPage(browser, tableta, async (page) => {
      await openCaregiverHome(page, server.url);
      await goCaregiverSection(page, "biblioteca");
      const antes = await measure(page, "c-biblioteca-row", "fila de la tabla (C2)");
      await clickTestid(page, "c-biblioteca-row", "fila de la tabla (C2)");
      await waitVisible(page, "c-panel", { context: "panel de canción (C2b)" });
      const despues = await measure(page, "c-biblioteca-row", "fila de la tabla (C2)");
      expectSize("Posición horizontal de la primera fila", despues.x, antes.x);
      expectSize("Posición vertical de la primera fila", despues.y, antes.y);
    }),
  );

  prueba("820 px · cuidador: la barra de reproducción mide 76 px", () =>
    withPage(browser, tableta, async (page) => {
      await openCaregiverHome(page, server.url);
      await goCaregiverSection(page, "biblioteca");
      expectSize("Barra de reproducción (alto)", (await measure(page, "c-now", "barra de reproducción")).height, 76);
    }),
  );

  prueba("820 px · Escuchar: sin desplazamiento horizontal", () =>
    withPage(browser, tableta, async (page) => {
      await openPatientMode(page, server.url);
      await assertNoHorizontalScroll(page, "Escuchar del paciente a 820 px");
    }),
  );

  prueba("820 px · Biblioteca: sin desplazamiento horizontal", () =>
    withPage(browser, tableta, async (page) => {
      await openCaregiverHome(page, server.url);
      await goCaregiverSection(page, "biblioteca");
      await assertNoHorizontalScroll(page, "Biblioteca del cuidador a 820 px");
    }),
  );

  prueba("Capturas a 820 px · pantallas del paciente", () =>
    withPage(browser, tableta, (page) => captureAllPatientScreens(page, "820x1180")),
  );

  prueba("Capturas a 820 px · pantallas del cuidador", () =>
    withPage(browser, tableta, (page) => captureAllCaregiverScreens(page, "820x1180")),
  );
});

// ---------------------------------------------------------------------------
describe("Rediseño · 1024 × 768 px (escritorio mínimo)", () => {
  const horizontal = VIEWPORTS.tabletaHorizontal;

  prueba("1024 px · paciente: la barra lateral mide 240 px de ancho", () =>
    withPage(browser, horizontal, async (page) => {
      await openPatientMode(page, server.url);
      expectSize("Barra lateral del paciente (ancho)", (await measure(page, "p-nav", "barra lateral del paciente")).width, 240);
    }),
  );

  prueba("1024 px · paciente: el título de página mide 40 px y pesa 700", () =>
    withPage(browser, horizontal, async (page) => {
      await openPatientMode(page, server.url);
      const titulo = await tituloDePagina(page);
      expectSize("Título de página (tamaño de letra)", titulo.fontSize, 40);
      assert.equal(titulo.fontWeight, "700", `El título de página pesa ${titulo.fontWeight} y la especificación fija 700.`);
    }),
  );

  prueba("1024 px · Escuchar se ve completo sin desplazamiento de página", () =>
    withPage(browser, horizontal, async (page) => {
      await openPatientMode(page, server.url);
      await assertNoVerticalScroll(page, "Escuchar a 1024 px");
    }),
  );

  prueba("1024 px · cuidador: la barra lateral mide 240 px de ancho", () =>
    withPage(browser, horizontal, async (page) => {
      await openCaregiverHome(page, server.url);
      await goCaregiverSection(page, "biblioteca");
      expectSize("Barra lateral del cuidador (ancho)", (await caregiverNavBox(page)).width, 240);
    }),
  );

  prueba("1024 px · cuidador: la barra de reproducción mide 76 px", () =>
    withPage(browser, horizontal, async (page) => {
      await openCaregiverHome(page, server.url);
      await goCaregiverSection(page, "biblioteca");
      expectSize("Barra de reproducción (alto)", (await measure(page, "c-now", "barra de reproducción")).height, 76);
    }),
  );

  prueba("1024 px · cuidador: la biblioteca no tiene desplazamiento de página", () =>
    withPage(browser, horizontal, async (page) => {
      await openCaregiverHome(page, server.url);
      await goCaregiverSection(page, "biblioteca");
      await assertNoVerticalScroll(page, "Biblioteca a 1024 px");
    }),
  );

  prueba("1024 px · cuidador: al abrir el panel, la tabla no se mueve", () =>
    withPage(browser, horizontal, async (page) => {
      await openCaregiverHome(page, server.url);
      await goCaregiverSection(page, "biblioteca");
      const antes = await measure(page, "c-biblioteca-row", "fila de la tabla (C2)");
      await clickTestid(page, "c-biblioteca-row", "fila de la tabla (C2)");
      await waitVisible(page, "c-panel", { context: "panel de canción (C2b)" });
      const despues = await measure(page, "c-biblioteca-row", "fila de la tabla (C2)");
      expectSize("Posición horizontal de la primera fila", despues.x, antes.x);
      expectSize("Posición vertical de la primera fila", despues.y, antes.y);
    }),
  );

  prueba("1024 px · Escuchar: sin desplazamiento horizontal", () =>
    withPage(browser, horizontal, async (page) => {
      await openPatientMode(page, server.url);
      await assertNoHorizontalScroll(page, "Escuchar del paciente a 1024 px");
    }),
  );

  prueba("1024 px · Biblioteca: sin desplazamiento horizontal", () =>
    withPage(browser, horizontal, async (page) => {
      await openCaregiverHome(page, server.url);
      await goCaregiverSection(page, "biblioteca");
      await assertNoHorizontalScroll(page, "Biblioteca del cuidador a 1024 px");
    }),
  );

  prueba("Capturas a 1024 px · pantallas del paciente", () =>
    withPage(browser, horizontal, (page) => captureAllPatientScreens(page, "1024x768")),
  );

  prueba("Capturas a 1024 px · pantallas del cuidador", () =>
    withPage(browser, horizontal, (page) => captureAllCaregiverScreens(page, "1024x768")),
  );
});

// ---------------------------------------------------------------------------
describe("Rediseño · 1440 × 900 px (escritorio)", () => {
  const escritorio = VIEWPORTS.escritorio;

  prueba("1440 px · paciente: la barra lateral mide 240 px de ancho", () =>
    withPage(browser, escritorio, async (page) => {
      await openPatientMode(page, server.url);
      expectSize("Barra lateral del paciente (ancho)", (await measure(page, "p-nav", "barra lateral del paciente")).width, 240);
    }),
  );

  prueba("1440 px · paciente: el título de página mide 40 px y pesa 700", () =>
    withPage(browser, escritorio, async (page) => {
      await openPatientMode(page, server.url);
      const titulo = await tituloDePagina(page);
      expectSize("Título de página (tamaño de letra)", titulo.fontSize, 40);
      assert.equal(titulo.fontWeight, "700", `El título de página pesa ${titulo.fontWeight} y la especificación fija 700.`);
    }),
  );

  prueba("1440 px · Escuchar se ve completo sin desplazamiento de página", () =>
    withPage(browser, escritorio, async (page) => {
      await openPatientMode(page, server.url);
      await assertNoVerticalScroll(page, "Escuchar a 1440 px");
    }),
  );

  prueba("1440 px · cuidador: la barra lateral mide 240 px de ancho", () =>
    withPage(browser, escritorio, async (page) => {
      await openCaregiverHome(page, server.url);
      await goCaregiverSection(page, "biblioteca");
      expectSize("Barra lateral del cuidador (ancho)", (await measure(page, "c-sidebar", "barra lateral del cuidador")).width, 240);
    }),
  );

  prueba("1440 px · cuidador: la barra de reproducción mide 76 px", () =>
    withPage(browser, escritorio, async (page) => {
      await openCaregiverHome(page, server.url);
      await goCaregiverSection(page, "biblioteca");
      expectSize("Barra de reproducción (alto)", (await measure(page, "c-now", "barra de reproducción")).height, 76);
    }),
  );

  prueba("1440 px · cuidador: la biblioteca no tiene desplazamiento de página", () =>
    withPage(browser, escritorio, async (page) => {
      await openCaregiverHome(page, server.url);
      await goCaregiverSection(page, "biblioteca");
      await assertNoVerticalScroll(page, "Biblioteca a 1440 px");
    }),
  );

  prueba("1440 px · cuidador: el texto de la biblioteca tiene 13 px o más (cabeceras de tabla, 12 px)", () =>
    withPage(browser, escritorio, async (page) => {
      await openCaregiverHome(page, server.url);
      await goCaregiverSection(page, "biblioteca");
      const pequeños = await smallTextElements(page, 13, { tableHeadersAllowed: true });
      assert.deepEqual(pequeños, [], "Texto del cuidador con menos de 13 px:");
    }),
  );

  prueba("1440 px · Escuchar: sin desplazamiento horizontal", () =>
    withPage(browser, escritorio, async (page) => {
      await openPatientMode(page, server.url);
      await assertNoHorizontalScroll(page, "Escuchar del paciente a 1440 px");
    }),
  );

  prueba("1440 px · Biblioteca: sin desplazamiento horizontal", () =>
    withPage(browser, escritorio, async (page) => {
      await openCaregiverHome(page, server.url);
      await goCaregiverSection(page, "biblioteca");
      await assertNoHorizontalScroll(page, "Biblioteca del cuidador a 1440 px");
    }),
  );

  prueba("Capturas a 1440 px · pantallas del paciente", () =>
    withPage(browser, escritorio, (page) => captureAllPatientScreens(page, "1440x900")),
  );

  prueba("Capturas a 1440 px · pantallas del cuidador", () =>
    withPage(browser, escritorio, (page) => captureAllCaregiverScreens(page, "1440x900")),
  );
});
