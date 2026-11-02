// Criterios de aceptación visual de DESIGN 15 en los cuatro anchos (390, 820, 1024 y 1440 px).
// Tolerancia de medida: ±2 px («±2 px es la tolerancia de medición»). Los mínimos («o más») se miden con la misma
// tolerancia; las áreas táctiles de 48 px del paciente tienen su propia prueba en paciente.e2e.mjs.
// Además, cada ancho guarda capturas de las pantallas de ambos modos en tests/web-e2e/capturas.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createTestCatalogOverrides } from "./helpers/catalogo-prueba.mjs";
import {
  caregiverNavBox,
  clickTestid,
  collectTabStops,
  computedStyleOf,
  countFullyVisibleRows,
  elementsWithMotion,
  expectInRange,
  expectSize,
  fixedOrFooterBox,
  horizontalScrollState,
  measure,
  overlappingPairs,
  scrollTestidIntoView,
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

/** Cajas de los mosaicos de carpetas visibles (P-11: el mismo componente que las listas). */
async function folderTileBoxes(page) {
  await waitVisible(page, "p3-folders", { context: "cuadrícula de carpetas (P3)" });
  return page.evaluate(() =>
    [
      ...document.querySelectorAll(
        '[data-testid="p3-folders"] a, [data-testid="p3-folders"] button, [data-testid="p3-folders"] [role="button"]',
      ),
    ]
      .filter((el) => window.__e2eIsShown(el))
      .map((el) => {
        const rect = el.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      }),
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
describe("DESIGN 15 · 390 × 844 px (teléfono)", () => {
  const telefono = VIEWPORTS.telefono;

  prueba("390 px · Escuchar: la cabecera mide 64 px de alto", () =>
    withPage(browser, telefono, async (page) => {
      await openPatientMode(page, server.url);
      expectSize("Cabecera del paciente (alto)", (await measure(page, "p-header", "cabecera del paciente")).height, 64);
    }),
  );

  prueba("390 px · Escuchar: el botón Cuidador mide 56 px o más de alto", () =>
    withPage(browser, telefono, async (page) => {
      await openPatientMode(page, server.url);
      const caja = await measure(page, "p-caregiver", "botón Cuidador de la cabecera");
      expectSize("Botón Cuidador (alto)", caja.height, 56, { minimum: true });
    }),
  );

  prueba("390 px · Escuchar: la portada mide 232 × 232 px", () =>
    withPage(browser, telefono, async (page) => {
      await openPatientMode(page, server.url);
      const caja = await measure(page, "p1-cover", "portada de P1");
      expectSize("Portada (ancho)", caja.width, 232);
      expectSize("Portada (alto)", caja.height, 232);
    }),
  );

  prueba("390 px · Escuchar: Anterior 72, Reproducir 96 y Siguiente 72 px", () =>
    withPage(browser, telefono, async (page) => {
      await openPatientMode(page, server.url);
      const anterior = await measure(page, "p1-prev", "botón Anterior de P1");
      const reproducir = await measure(page, "p1-toggle", "botón Reproducir de P1");
      const siguiente = await measure(page, "p1-next", "botón Siguiente de P1");
      expectSize("Anterior", anterior.width, 72);
      expectSize("Anterior (alto)", anterior.height, 72);
      expectSize("Reproducir", reproducir.width, 96);
      expectSize("Reproducir (alto)", reproducir.height, 96);
      expectSize("Siguiente", siguiente.width, 72);
      expectSize("Siguiente (alto)", siguiente.height, 72);
    }),
  );

  prueba("390 px · Escuchar: la zona de progreso mide 56 px de alto", () =>
    withPage(browser, telefono, async (page) => {
      await openPatientMode(page, server.url);
      expectSize("Zona de progreso (alto)", (await measure(page, "p1-progress", "zona de progreso de P1")).height, 56);
    }),
  );

  prueba("390 px · Escuchar: los botones de volumen miden 56 px", () =>
    withPage(browser, telefono, async (page) => {
      await openPatientMode(page, server.url);
      const bajar = await measure(page, "p1-vol-down", "botón Bajar volumen de P1");
      const subir = await measure(page, "p1-vol-up", "botón Subir volumen de P1");
      expectSize("Bajar volumen", bajar.width, 56);
      expectSize("Bajar volumen (alto)", bajar.height, 56);
      expectSize("Subir volumen", subir.width, 56);
      expectSize("Subir volumen (alto)", subir.height, 56);
    }),
  );

  prueba("390 px · Escuchar: la barra inferior mide 72 px de alto", () =>
    withPage(browser, telefono, async (page) => {
      await openPatientMode(page, server.url);
      expectSize("Barra inferior del paciente (alto)", (await measure(page, "p-nav", "barra inferior del paciente")).height, 72);
    }),
  );

  prueba("390 px · Escuchar: la barra inferior muestra sus cuatro destinos", () =>
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
    }),
  );

  prueba("390 px · Escuchar: la zona de fotografía empieza entre 728 y 736 px y se ve 40 px sobre la barra", () =>
    withPage(browser, telefono, async (page) => {
      await openPatientMode(page, server.url);
      const foto = await measure(page, "p1-photo", "zona de fotografía de P1");
      const barra = await measure(page, "p-nav", "barra inferior del paciente");
      expectInRange("Inicio de la zona de fotografía (y)", foto.y, 728, 736);
      const visibleSobreBarra = barra.y - foto.y;
      assert.ok(
        visibleSobreBarra >= 40 - TOLERANCE_PX,
        `Se ven ${Math.round(visibleSobreBarra)} px de la fotografía sobre la barra y DESIGN 15 pide al menos 40 px.`,
      );
    }),
  );

  prueba("390 px · Escuchar tras desplazar: la fotografía mide 358 × 268 px", () =>
    withPage(browser, telefono, async (page) => {
      await openPatientMode(page, server.url);
      await scrollTestidIntoView(page, "p1-photo", "zona de fotografía de P1");
      const caja = await measure(page, "p1-photo", "zona de fotografía de P1");
      expectSize("Fotografía (ancho)", caja.width, 358);
      expectSize("Fotografía (alto)", caja.height, 268);
    }),
  );

  prueba("390 px · Escuchar tras desplazar: el texto del recuerdo no pasa de cuatro líneas", () =>
    withPage(browser, telefono, async (page) => {
      await openPatientMode(page, server.url);
      await scrollTestidIntoView(page, "p1-memory-text", "texto del recuerdo de P1");
      const caja = await measure(page, "p1-memory-text", "texto del recuerdo de P1");
      const estilo = await computedStyleOf(page, "p1-memory-text", "texto del recuerdo de P1");
      // Con un recuerdo de texto largo, la zona debe medir 4 líneas (4 × 36 px). Sin recuerdo largo, solo se
      // comprueba que no crece más de cuatro líneas de su interlínea actual. La comprobación completa necesita
      // un recuerdo de prueba con texto largo (pendiente de datos de prueba).
      assert.ok(
        caja.height <= 4 * estilo.lineHeight + TOLERANCE_PX,
        `El texto del recuerdo mide ${Math.round(caja.height)} px y no debe pasar de 4 líneas (${4 * estilo.lineHeight} px).`,
      );
    }),
  );

  prueba("390 px · Carpetas: los mosaicos miden 171 px en dos columnas", () =>
    withPage(browser, telefono, async (page) => {
      await openPatientMode(page, server.url);
      await goPatientSection(page, "carpetas");
      const tiles = await folderTileBoxes(page);
      assert.ok(tiles.length >= 2, `Hacen falta al menos dos mosaicos para medir las columnas y hay ${tiles.length}.`);
      expectSize("Mosaico de carpeta (ancho)", tiles[0].width, 171);
      assert.ok(
        Math.abs(tiles[1].y - tiles[0].y) <= TOLERANCE_PX && tiles[1].x > tiles[0].x,
        "Los dos primeros mosaicos deben estar en la misma fila (dos columnas).",
      );
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

  prueba("390 px · cuidador: las tarjetas de la tabla miden 72 px", () =>
    withPage(browser, telefono, async (page) => {
      await openCaregiverHome(page, server.url);
      await goCaregiverSection(page, "biblioteca");
      expectSize("Tarjeta de canción (alto)", (await measure(page, "c-biblioteca-row", "tarjeta de canción (C2)")).height, 72);
    }),
  );

  prueba("390 px · cuidador: la barra inferior mide 64 px", () =>
    withPage(browser, telefono, async (page) => {
      await openCaregiverHome(page, server.url);
      await goCaregiverSection(page, "biblioteca");
      expectSize("Barra inferior del cuidador (alto)", (await caregiverNavBox(page)).height, 64);
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

  prueba("390 px · cuidador: el pie fijo del editor de recuerdo mide 72 px", () =>
    withPage(browser, telefono, async (page) => {
      await openCaregiverHome(page, server.url);
      await openNewMemoryEditor(page);
      const pie = await fixedOrFooterBox(page, "c-memory-save", "botón Guardar recuerdo (C3c)");
      assert.ok(pie, "El botón Guardar recuerdo no está dentro de un pie fijo ni de un footer.");
      expectSize("Pie fijo del editor de recuerdo (alto)", pie.height, 72);
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
describe("DESIGN 15 · 820 × 1180 px (tableta vertical)", () => {
  const tableta = VIEWPORTS.tabletaVertical;

  prueba("820 px · paciente: el raíl mide 112 px de ancho", () =>
    withPage(browser, tableta, async (page) => {
      await openPatientMode(page, server.url);
      expectSize("Raíl del paciente (ancho)", (await measure(page, "p-nav", "raíl del paciente")).width, 112);
    }),
  );

  prueba("820 px · Escuchar en dos columnas: la portada mide 300 × 300 px", () =>
    withPage(browser, tableta, async (page) => {
      await openPatientMode(page, server.url);
      const caja = await measure(page, "p1-cover", "portada de P1");
      expectSize("Portada (ancho)", caja.width, 300);
      expectSize("Portada (alto)", caja.height, 300);
    }),
  );

  prueba("820 px · Escuchar en dos columnas: la fotografía mide 328 × 246 px", () =>
    withPage(browser, tableta, async (page) => {
      await openPatientMode(page, server.url);
      const caja = await measure(page, "p1-photo", "zona de fotografía de P1");
      expectSize("Fotografía (ancho)", caja.width, 328);
      expectSize("Fotografía (alto)", caja.height, 246);
    }),
  );

  prueba("820 px · Escuchar se ve completo sin desplazamiento de página", () =>
    withPage(browser, tableta, async (page) => {
      await openPatientMode(page, server.url);
      await assertNoVerticalScroll(page, "Escuchar a 820 px");
    }),
  );

  prueba("820 px · Carpetas: los mosaicos miden 204 px en tres columnas", () =>
    withPage(browser, tableta, async (page) => {
      await openPatientMode(page, server.url);
      await goPatientSection(page, "carpetas");
      const tiles = await folderTileBoxes(page);
      assert.ok(tiles.length >= 3, `Hacen falta tres mosaicos para comprobar tres columnas y hay ${tiles.length}.`);
      expectSize("Mosaico de carpeta (ancho)", tiles[0].width, 204);
      assert.ok(
        Math.abs(tiles[2].y - tiles[0].y) <= TOLERANCE_PX && tiles[2].x > tiles[0].x,
        "Los tres primeros mosaicos deben estar en la misma fila (tres columnas).",
      );
    }),
  );

  prueba("820 px · cuidador: el raíl mide 88 px de ancho", () =>
    withPage(browser, tableta, async (page) => {
      await openCaregiverHome(page, server.url);
      await goCaregiverSection(page, "biblioteca");
      expectSize("Raíl del cuidador (ancho)", (await caregiverNavBox(page)).width, 88);
    }),
  );

  prueba("820 px · cuidador: las filas de la tabla miden 48 px", () =>
    withPage(browser, tableta, async (page) => {
      await openCaregiverHome(page, server.url);
      await goCaregiverSection(page, "biblioteca");
      expectSize("Fila de la tabla (alto)", (await measure(page, "c-biblioteca-row", "fila de la tabla (C2)")).height, 48);
    }),
  );

  prueba("820 px · cuidador: el panel de canción mide 320 px de ancho al abrirse", () =>
    withPage(browser, tableta, async (page) => {
      await openCaregiverHome(page, server.url);
      await goCaregiverSection(page, "biblioteca");
      await clickTestid(page, "c-biblioteca-row", "fila de la tabla (C2)");
      expectSize("Panel de canción (ancho)", (await measure(page, "c-panel", "panel de canción (C2b)")).width, 320);
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

  prueba("820 px · cuidador: la barra de reproducción mide 72 px", () =>
    withPage(browser, tableta, async (page) => {
      await openCaregiverHome(page, server.url);
      await goCaregiverSection(page, "biblioteca");
      expectSize("Barra de reproducción (alto)", (await measure(page, "c-now", "barra de reproducción")).height, 72);
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
describe("DESIGN 15 · 1024 × 768 px (tableta horizontal)", () => {
  const horizontal = VIEWPORTS.tabletaHorizontal;

  prueba("1024 px · paciente: el raíl mide 112 px de ancho", () =>
    withPage(browser, horizontal, async (page) => {
      await openPatientMode(page, server.url);
      expectSize("Raíl del paciente (ancho)", (await measure(page, "p-nav", "raíl del paciente")).width, 112);
    }),
  );

  prueba("1024 px · paciente: la cabecera mide 64 px de alto", () =>
    withPage(browser, horizontal, async (page) => {
      await openPatientMode(page, server.url);
      expectSize("Cabecera del paciente (alto)", (await measure(page, "p-header", "cabecera del paciente")).height, 64);
    }),
  );

  prueba("1024 px · Escuchar: la portada mide 280 × 280 px", () =>
    withPage(browser, horizontal, async (page) => {
      await openPatientMode(page, server.url);
      const caja = await measure(page, "p1-cover", "portada de P1");
      expectSize("Portada (ancho)", caja.width, 280);
      expectSize("Portada (alto)", caja.height, 280);
    }),
  );

  prueba("1024 px · Escuchar: la fotografía mide 395 × 296 px", () =>
    withPage(browser, horizontal, async (page) => {
      await openPatientMode(page, server.url);
      const caja = await measure(page, "p1-photo", "zona de fotografía de P1");
      expectSize("Fotografía (ancho)", caja.width, 395);
      expectSize("Fotografía (alto)", caja.height, 296);
    }),
  );

  prueba("1024 px · Escuchar se ve completo sin desplazamiento de página", () =>
    withPage(browser, horizontal, async (page) => {
      await openPatientMode(page, server.url);
      await assertNoVerticalScroll(page, "Escuchar a 1024 px");
    }),
  );

  prueba("1024 px · cuidador: el raíl mide 88 px de ancho", () =>
    withPage(browser, horizontal, async (page) => {
      await openCaregiverHome(page, server.url);
      await goCaregiverSection(page, "biblioteca");
      expectSize("Raíl del cuidador (ancho)", (await caregiverNavBox(page)).width, 88);
    }),
  );

  prueba("1024 px · cuidador: la tabla muestra 14 filas completas con desplazamiento interno", () =>
    withPage(browser, horizontal, async (page) => {
      await openCaregiverHome(page, server.url);
      await goCaregiverSection(page, "biblioteca");
      const visibles = await countFullyVisibleRows(page, "c-biblioteca-row", "filas de la tabla (C2)");
      assert.equal(visibles, 14, `Se ven ${visibles} filas completas y DESIGN 15 fija 14 a 1024 × 768.`);
    }),
  );

  prueba("1024 px · cuidador: las filas de la tabla miden 40 px", () =>
    withPage(browser, horizontal, async (page) => {
      await openCaregiverHome(page, server.url);
      await goCaregiverSection(page, "biblioteca");
      expectSize("Fila de la tabla (alto)", (await measure(page, "c-biblioteca-row", "fila de la tabla (C2)")).height, 40);
    }),
  );

  prueba("1024 px · cuidador: la barra de reproducción mide 72 px", () =>
    withPage(browser, horizontal, async (page) => {
      await openCaregiverHome(page, server.url);
      await goCaregiverSection(page, "biblioteca");
      expectSize("Barra de reproducción (alto)", (await measure(page, "c-now", "barra de reproducción")).height, 72);
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
describe("DESIGN 15 · 1440 × 900 px (escritorio)", () => {
  const escritorio = VIEWPORTS.escritorio;

  prueba("1440 px · paciente: el raíl mide 112 px de ancho", () =>
    withPage(browser, escritorio, async (page) => {
      await openPatientMode(page, server.url);
      expectSize("Raíl del paciente (ancho)", (await measure(page, "p-nav", "raíl del paciente")).width, 112);
    }),
  );

  prueba("1440 px · Escuchar: el contenedor mide 1120 px de ancho, centrado", () =>
    withPage(browser, escritorio, async (page) => {
      await openPatientMode(page, server.url);
      expectSize("Contenedor de Escuchar (ancho)", (await measure(page, "p1-root", "pantalla Escuchar (P1)")).width, 1120);
    }),
  );

  prueba("1440 px · Escuchar: la portada mide 360 × 360 px", () =>
    withPage(browser, escritorio, async (page) => {
      await openPatientMode(page, server.url);
      const caja = await measure(page, "p1-cover", "portada de P1");
      expectSize("Portada (ancho)", caja.width, 360);
      expectSize("Portada (alto)", caja.height, 360);
    }),
  );

  prueba("1440 px · Escuchar: la fotografía mide 480 × 360 px", () =>
    withPage(browser, escritorio, async (page) => {
      await openPatientMode(page, server.url);
      const caja = await measure(page, "p1-photo", "zona de fotografía de P1");
      expectSize("Fotografía (ancho)", caja.width, 480);
      expectSize("Fotografía (alto)", caja.height, 360);
    }),
  );

  prueba("1440 px · Escuchar se ve completo sin desplazamiento de página", () =>
    withPage(browser, escritorio, async (page) => {
      await openPatientMode(page, server.url);
      await assertNoVerticalScroll(page, "Escuchar a 1440 px");
    }),
  );

  prueba("1440 px · cuidador: la barra lateral mide 232 px de ancho", () =>
    withPage(browser, escritorio, async (page) => {
      await openCaregiverHome(page, server.url);
      await goCaregiverSection(page, "biblioteca");
      expectSize("Barra lateral del cuidador (ancho)", (await measure(page, "c-sidebar", "barra lateral del cuidador")).width, 232);
    }),
  );

  prueba("1440 px · cuidador: el panel persistente mide 320 × 772 px", () =>
    withPage(browser, escritorio, async (page) => {
      await openCaregiverHome(page, server.url);
      await goCaregiverSection(page, "biblioteca");
      const caja = await measure(page, "c-panel", "panel de canción (C2b)");
      expectSize("Panel (ancho)", caja.width, 320);
      // 772 px = 900 (ventana) − 56 (cabecera del cuidador) − 72 (barra de reproducción).
      expectSize("Panel (alto)", caja.height, 772);
    }),
  );

  prueba("1440 px · cuidador: la tabla muestra 17 filas completas", () =>
    withPage(browser, escritorio, async (page) => {
      await openCaregiverHome(page, server.url);
      await goCaregiverSection(page, "biblioteca");
      const visibles = await countFullyVisibleRows(page, "c-biblioteca-row", "filas de la tabla (C2)");
      assert.equal(visibles, 17, `Se ven ${visibles} filas completas y DESIGN 15 fija 17 a 1440 × 900.`);
    }),
  );

  prueba("1440 px · cuidador: las filas de la tabla miden 40 px", () =>
    withPage(browser, escritorio, async (page) => {
      await openCaregiverHome(page, server.url);
      await goCaregiverSection(page, "biblioteca");
      expectSize("Fila de la tabla (alto)", (await measure(page, "c-biblioteca-row", "fila de la tabla (C2)")).height, 40);
    }),
  );

  prueba("1440 px · cuidador: la barra de reproducción mide 72 px", () =>
    withPage(browser, escritorio, async (page) => {
      await openCaregiverHome(page, server.url);
      await goCaregiverSection(page, "biblioteca");
      expectSize("Barra de reproducción (alto)", (await measure(page, "c-now", "barra de reproducción")).height, 72);
    }),
  );

  prueba("1440 px · cuidador: la cabecera mide 56 px de alto", () =>
    withPage(browser, escritorio, async (page) => {
      await openCaregiverHome(page, server.url);
      expectSize("Cabecera del cuidador (alto)", (await measure(page, "c-header", "cabecera del cuidador")).height, 56);
    }),
  );

  prueba("1440 px · cuidador: la biblioteca no tiene desplazamiento de página", () =>
    withPage(browser, escritorio, async (page) => {
      await openCaregiverHome(page, server.url);
      await goCaregiverSection(page, "biblioteca");
      await assertNoVerticalScroll(page, "Biblioteca a 1440 px");
    }),
  );

  prueba("1440 px · cuidador: las tarjetas de perfil miden 264 × 132 px", () =>
    withPage(browser, escritorio, async (page) => {
      await openCaregiverHome(page, server.url);
      await goCaregiverSection(page, "perfiles");
      const caja = await measure(page, "c-profile-card", "tarjeta de perfil (C3)");
      expectSize("Tarjeta de perfil (ancho)", caja.width, 264);
      expectSize("Tarjeta de perfil (alto)", caja.height, 132);
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
