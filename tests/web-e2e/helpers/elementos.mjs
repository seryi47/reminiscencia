// Localización y medida de elementos para las pruebas de extremo a extremo.
// Todo se localiza por data-testid del contrato (DESIGN §13). Si un elemento falta, se lanza un error con mensaje claro.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/** Tolerancia de medida de DESIGN §14 («±2 px»). */
export const TOLERANCE_PX = 2;

/** Tiempo máximo de cada prueba, en milisegundos. */
export const TEST_TIMEOUT_MS = 120_000;

const AXE_SOURCE = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

const round1 = (value) => Math.round(value * 10) / 10;

// ---------------------------------------------------------------------------
// Visibilidad y espera
// ---------------------------------------------------------------------------

/** Devuelve el primer elemento visible con ese data-testid, o null si no aparece en `timeout` ms. */
export async function findVisibleTestid(page, testid, timeout = 8000) {
  const handle = await page
    .waitForFunction(
      (id) => [...document.querySelectorAll(`[data-testid="${id}"]`)].find((el) => window.__e2eIsShown(el)) ?? null,
      { timeout, polling: 100 },
      testid,
    )
    .catch(() => null);
  return handle ? handle.asElement() : null;
}

/** Igual que findVisibleTestid, pero lanza un error con el contexto si no aparece. */
export async function waitVisible(page, testid, { context = "", ms = 8000 } = {}) {
  const element = await findVisibleTestid(page, testid, ms);
  if (!element) {
    const where = context ? ` (${context})` : "";
    throw new Error(
      `Falta data-testid="${testid}"${where}: no aparece visible en ${ms} ms. La interfaz todavía no lo muestra o está oculto.`,
    );
  }
  return element;
}

export async function isVisible(page, testid, ms = 2000) {
  return (await findVisibleTestid(page, testid, ms)) !== null;
}

/** true cuando el elemento deja de verse (o no existe). */
export async function waitHidden(page, testid, ms = 5000) {
  return page
    .waitForFunction(
      (id) => ![...document.querySelectorAll(`[data-testid="${id}"]`)].some((el) => window.__e2eIsShown(el)),
      { timeout: ms, polling: 100 },
      testid,
    )
    .then(
      () => true,
      () => false,
    );
}

/** Espera un elemento visible que coincida con un selector CSS libre (por ejemplo, un diálogo sin data-testid). */
export async function waitShownSelector(page, selector, { ms = 8000, context = "" } = {}) {
  const handle = await page
    .waitForFunction(
      (sel) => [...document.querySelectorAll(sel)].find((el) => window.__e2eIsShown(el)) ?? null,
      { timeout: ms, polling: 100 },
      selector,
    )
    .catch(() => null);
  if (!handle) {
    throw new Error(`No aparece ningún elemento visible que coincida con ${selector}${context ? ` (${context})` : ""}.`);
  }
  return handle.asElement();
}

// ---------------------------------------------------------------------------
// Interacción
// ---------------------------------------------------------------------------

export async function clickTestid(page, testid, context = "") {
  const element = await waitVisible(page, testid, { context });
  try {
    await element.click();
  } catch (error) {
    throw new Error(`No se puede pulsar data-testid="${testid}"${context ? ` (${context})` : ""}: ${error.message}`);
  }
}

/**
 * Enfoca con el teclado: primero se pulsa Tab para que el navegador use modo teclado
 * (así :focus-visible aplica) y después se enfoca el elemento. Devuelve su estilo de foco.
 */
export async function focusWithKeyboardMode(page, testid, context = "") {
  const element = await waitVisible(page, testid, { context });
  await page.keyboard.press("Tab");
  const info = await element.evaluate((el) => {
    el.focus();
    const style = getComputedStyle(el);
    return {
      active: document.activeElement === el,
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
      boxShadow: style.boxShadow,
    };
  });
  assert.ok(info.active, `No se puede enfocar data-testid="${testid}" con el teclado${context ? ` (${context})` : ""}.`);
  return info;
}

/**
 * Grosor del anillo de foco. Con contorno (outline), su anchura. Con sombras, el grosor del anillo:
 * una sombra de expansión e (0 0 0 e) da e; dos o más (separación y anillo) dan la diferencia entre la mayor y la menor.
 */
export function focusRingWidth(info) {
  if (info.outlineStyle !== "none" && parseFloat(info.outlineWidth) > 0) {
    return parseFloat(info.outlineWidth);
  }
  const spreads = [...info.boxShadow.matchAll(/(-?[\d.]+)px\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s+(-?[\d.]+)px/g)].map(
    (match) => parseFloat(match[4]),
  );
  if (spreads.length === 0) return 0;
  if (spreads.length === 1) return spreads[0];
  return Math.max(...spreads) - Math.min(...spreads);
}

// ---------------------------------------------------------------------------
// Medidas
// ---------------------------------------------------------------------------

/** Caja del primer elemento visible con ese data-testid (getBoundingClientRect). */
export async function measure(page, testid, context = "") {
  const element = await waitVisible(page, testid, { context });
  return element.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom };
  });
}

/** Texto visible del elemento, con espacios normalizados. */
export async function textOf(page, testid, context = "") {
  const element = await waitVisible(page, testid, { context });
  return element.evaluate((el) => el.innerText.replace(/\s+/g, " ").trim());
}

// ---------------------------------------------------------------------------
// Aserciones de medida
// ---------------------------------------------------------------------------

/**
 * Compara una medida con su valor de DESIGN.
 * Exacta: |medida − esperado| ≤ tolerancia. Mínima («o más»): medida ≥ esperado − tolerancia.
 */
export function expectSize(name, actual, expected, { tolerance = TOLERANCE_PX, minimum = false } = {}) {
  const ok = minimum ? actual >= expected - tolerance : Math.abs(actual - expected) <= tolerance;
  assert.ok(
    ok,
    `${name}: se esperaba ${minimum ? "al menos " : ""}${expected} px (tolerancia ±${tolerance} px) y se mide ${round1(actual)} px.`,
  );
}

/** Comprueba que la medida cae dentro de [min, max], con la tolerancia en cada extremo. */
export function expectInRange(name, actual, min, max, { tolerance = TOLERANCE_PX } = {}) {
  const ok = actual >= min - tolerance && actual <= max + tolerance;
  assert.ok(
    ok,
    `${name}: se esperaba entre ${min} y ${max} px (tolerancia ±${tolerance} px) y se mide ${round1(actual)} px.`,
  );
}

// ---------------------------------------------------------------------------
// Accesibilidad (axe-core)
// ---------------------------------------------------------------------------

/**
 * Ejecuta axe-core con las etiquetas WCAG 2.0 A y AA y WCAG 2.2 AA.
 * Devuelve la lista de incidencias, con su gravedad (impacto).
 */
export async function wcagViolations(page) {
  // La página lleva la CSP de vercel.json (script-src 'self'): una etiqueta <script> inyectada no se ejecutaría.
  // El código de axe se evalúa por el protocolo de depuración, que la CSP no limita.
  if (!(await page.evaluate(() => typeof window.axe === "object"))) await page.evaluate(AXE_SOURCE);
  return page.evaluate(async () => {
    const result = await window.axe.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag22aa"] },
    });
    // DESIGN §12: el texto de los controles deshabilitados está exento de contraste (WCAG 1.4.3).
    // Se descartan solo los nodos de color-contrast cuyo elemento tiene aria-disabled="true" o disabled.
    const exentoDeContraste = (node) => {
      if (node.target.length !== 1) return false;
      const el = document.querySelector(node.target[0]);
      return Boolean(el && el.closest("[aria-disabled='true'], :disabled"));
    };
    return result.violations
      .map((violation) => {
        const nodes =
          violation.id === "color-contrast" ? violation.nodes.filter((node) => !exentoDeContraste(node)) : violation.nodes;
        return { id: violation.id, impact: violation.impact, nodes };
      })
      .filter((violation) => violation.nodes.length > 0)
      .map((violation) => ({
        regla: violation.id,
        impacto: violation.impact,
        nodos: violation.nodes.length,
        ejemplo: violation.nodes[0]?.target?.join(" ") ?? "",
      }));
  });
}
