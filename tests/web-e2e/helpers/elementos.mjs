// Localización y medida de elementos para las pruebas de extremo a extremo.
// Todo se localiza por data-testid del contrato (sección 5). Si un elemento falta, se lanza un error con mensaje claro.
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/** Tolerancia de medida de DESIGN 15 («±2 px es la tolerancia de medición»). */
export const TOLERANCE_PX = 2;

/** Tiempo máximo de cada prueba, en milisegundos. */
export const TEST_TIMEOUT_MS = 120_000;

const AXE_SCRIPT_PATH = require.resolve("axe-core/axe.min.js");

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
 * Pulsa el primer control visible cuyo texto contenga alguna de las etiquetas dadas.
 * Solo se usa donde DESIGN fija el texto y el contrato no asigna data-testid.
 */
export async function clickText(page, labels, { within = null, context = "" } = {}) {
  const wanted = [labels].flat();
  const handle = await page
    .waitForFunction(
      (texts, scope) => {
        const root = scope ? document.querySelector(`[data-testid="${scope}"]`) : document;
        if (!root) return null;
        const candidates = root.querySelectorAll(
          "button, a, label, [role='button'], [role='radio'], [role='tab'], [role='option']",
        );
        return (
          [...candidates].find((el) => {
            const text = el.textContent.replace(/\s+/g, " ").trim();
            return el.getClientRects().length > 0 && texts.some((label) => text.includes(label));
          }) ?? null
        );
      },
      { timeout: 8000, polling: 150 },
      wanted,
      within,
    )
    .catch(() => null);
  if (!handle) {
    const labelsText = wanted.map((label) => `«${label}»`).join(" o ");
    const scope = within ? ` dentro de data-testid="${within}"` : "";
    throw new Error(`No aparece un control con el texto ${labelsText}${scope}${context ? ` (${context})` : ""}.`);
  }
  await handle.asElement().click();
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

/**
 * Recorre el orden de tabulación y devuelve los elementos enfocados.
 * Para cada uno indica si lo tapa otro elemento (por ejemplo, la barra inferior fija).
 */
export async function collectTabStops(page, { maximo = 30 } = {}) {
  const stops = [];
  const seen = new Set();
  for (let i = 0; i < maximo; i += 1) {
    await page.keyboard.press("Tab");
    const stop = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const key = [...document.querySelectorAll("*")].indexOf(el);
      const name = el.dataset.testid || el.tagName.toLowerCase();
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return { key, name, covered: false, coveredBy: null };
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const top = y >= 0 && y <= window.innerHeight && x >= 0 && x <= window.innerWidth ? document.elementFromPoint(x, y) : null;
      const covered = top !== null && !(top === el || el.contains(top));
      const coveredBy = covered ? top.closest("[data-testid]")?.dataset.testid || top.tagName.toLowerCase() : null;
      return { key, name, covered, coveredBy };
    });
    if (!stop) continue;
    if (seen.has(stop.key)) break;
    seen.add(stop.key);
    stops.push(stop);
  }
  return stops;
}

/** Tecla con modificador de Ctrl (Linux) o Cmd (macOS): Ctrl/Cmd+K, Ctrl/Cmd+A, etc. */
export async function pressCommandKey(page, key) {
  const modifier = process.platform === "darwin" ? "Meta" : "Control";
  await page.keyboard.down(modifier);
  await page.keyboard.press(key);
  await page.keyboard.up(modifier);
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

/** Caja del primer hijo visible del elemento indicado (por ejemplo, la primera fila de una lista). */
export async function measureFirstChild(page, testid, context = "") {
  const element = await waitVisible(page, testid, { context });
  return element.evaluate((el) => {
    const child = [...el.children].find((node) => node.getClientRects().length > 0);
    if (!child) return null;
    const rect = child.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  });
}

/** Número de hijos directos del elemento (por ejemplo, los diez segmentos del volumen). */
export async function countChildren(page, testid, context = "") {
  const element = await waitVisible(page, testid, { context });
  return element.evaluate((el) => el.children.length);
}

/** Número de controles interactivos visibles dentro del elemento. */
export async function countInteractive(page, testid, context = "") {
  const element = await waitVisible(page, testid, { context });
  return element.evaluate(
    (el) => [...el.querySelectorAll("button, a, [role='button']")].filter((node) => window.__e2eIsShown(node)).length,
  );
}

/** Texto visible del elemento, con espacios normalizados. */
export async function textOf(page, testid, context = "") {
  const element = await waitVisible(page, testid, { context });
  return element.evaluate((el) => el.innerText.replace(/\s+/g, " ").trim());
}

/** Desplaza el elemento al centro de la ventana (para medir lo que queda más abajo). */
export async function scrollTestidIntoView(page, testid, context = "") {
  const element = await waitVisible(page, testid, { context });
  await element.evaluate((el) => el.scrollIntoView({ block: "center", inline: "nearest" }));
}

/** Estilos calculados útiles para medidas tipográficas y de desbordamiento. */
export async function computedStyleOf(page, testid, context = "") {
  const element = await waitVisible(page, testid, { context });
  return element.evaluate((el) => {
    const style = getComputedStyle(el);
    return {
      lineHeight: parseFloat(style.lineHeight),
      fontSize: parseFloat(style.fontSize),
      overflowY: style.overflowY,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    };
  });
}

/** Desplazamiento horizontal de la página: scrollWidth frente a clientWidth. */
export async function horizontalScrollState(page) {
  return page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
}

/** Desplazamiento vertical de la página: altura del contenido frente a la ventana. */
export async function verticalScrollState(page) {
  return page.evaluate(() => ({
    scrollHeight: document.documentElement.scrollHeight,
    viewportHeight: window.innerHeight,
  }));
}

/**
 * Barra de navegación del cuidador: el elemento nav que contiene c-nav-inicio.
 * Si no es un nav, se usa su contenedor directo.
 */
export async function caregiverNavBox(page) {
  const element = await waitVisible(page, "c-nav-inicio", { context: "barra de navegación del cuidador" });
  return element.evaluate((el) => {
    const nav = el.closest("nav") ?? el.parentElement;
    const rect = nav.getBoundingClientRect();
    return {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      top: rect.top,
      bottom: rect.bottom,
      isNavElement: el.closest("nav") !== null,
    };
  });
}

/**
 * Caja del contenedor fijo (position fixed o sticky) que contiene el elemento.
 * Si no hay ninguno, usa el footer ancestro. Devuelve null si no encuentra nada.
 */
export async function fixedOrFooterBox(page, testid, context = "") {
  const element = await waitVisible(page, testid, { context });
  return element.evaluate((el) => {
    let node = el;
    while (node && node !== document.body) {
      const position = getComputedStyle(node).position;
      if (position === "fixed" || position === "sticky") break;
      node = node.parentElement;
    }
    const container = node && node !== document.body ? node : el.closest("footer");
    if (!container) return null;
    const rect = container.getBoundingClientRect();
    return { y: rect.y, width: rect.width, height: rect.height, bottom: rect.bottom, tag: container.tagName.toLowerCase() };
  });
}

/**
 * Filas completamente visibles dentro de su contenedor con desplazamiento (o de la ventana).
 * Una fila parcialmente visible no cuenta.
 */
export async function countFullyVisibleRows(page, rowTestid, context = "") {
  await waitVisible(page, rowTestid, { context });
  return page.evaluate((id) => {
    const rows = [...document.querySelectorAll(`[data-testid="${id}"]`)].filter((el) => window.__e2eIsShown(el));
    if (rows.length === 0) return 0;
    let scroller = rows[0].parentElement;
    while (scroller && scroller !== document.body) {
      const overflow = getComputedStyle(scroller).overflowY;
      if ((overflow === "auto" || overflow === "scroll") && scroller.clientHeight > 0) break;
      scroller = scroller.parentElement;
    }
    const area =
      scroller && scroller !== document.body ? scroller.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };
    const top = Math.max(area.top, 0);
    const bottom = Math.min(area.bottom, window.innerHeight);
    return rows.filter((row) => {
      const rect = row.getBoundingClientRect();
      return rect.top >= top - 0.5 && rect.bottom <= bottom + 0.5;
    }).length;
  }, rowTestid);
}

/** Elementos con texto más pequeño que el mínimo (ignora ocultos, sr-only y el enlace de salto). */
export async function smallTextElements(page, minimumPx, { tableHeadersAllowed = false } = {}) {
  return page.evaluate(
    (minimum, headersAllowed) => {
      const offenders = [];
      for (const el of document.querySelectorAll("body *")) {
        const hasText = [...el.childNodes].some(
          (node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim() !== "",
        );
        if (!hasText) continue;
        if (el.closest("[aria-hidden='true'], .visually-hidden, .skip-link, [data-testid='skip-link']")) continue;
        const style = getComputedStyle(el);
        if (style.display === "none" || style.visibility === "hidden") continue;
        const rect = el.getBoundingClientRect();
        if (rect.width <= 1 || rect.height <= 1) continue;
        if (headersAllowed && el.closest("th, [role='columnheader']")) continue;
        const size = parseFloat(style.fontSize);
        if (size < minimum) {
          const name = el.closest("[data-testid]")?.dataset.testid || el.tagName.toLowerCase();
          offenders.push(`${name}: «${el.textContent.trim().slice(0, 30)}» con ${size} px`);
        }
      }
      return offenders;
    },
    minimumPx,
    tableHeadersAllowed,
  );
}

/** Elementos con transición o animación de duración mayor que 0 (en reducir movimiento deben ser 0). */
export async function elementsWithMotion(page) {
  return page.evaluate(() => {
    const toSeconds = (value) => (value.trim().endsWith("ms") ? parseFloat(value) / 1000 : parseFloat(value));
    const offenders = [];
    for (const el of document.querySelectorAll("*")) {
      const style = getComputedStyle(el);
      const durations = [...style.transitionDuration.split(","), ...style.animationDuration.split(",")].map(toSeconds);
      if (durations.some((seconds) => seconds > 0)) {
        offenders.push(el.dataset.testid || el.tagName.toLowerCase());
      }
    }
    return offenders;
  });
}

/** Pares de elementos (por data-testid visibles) cuyas cajas se solapan más de 1 px. */
export async function overlappingPairs(page, testids) {
  return page.evaluate((ids) => {
    const boxes = [];
    for (const id of ids) {
      const el = [...document.querySelectorAll(`[data-testid="${id}"]`)].find((node) => window.__e2eIsShown(node));
      if (el) {
        const rect = el.getBoundingClientRect();
        boxes.push({ id, left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom });
      }
    }
    const pairs = [];
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        const a = boxes[i];
        const b = boxes[j];
        const overlap = a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
        if (overlap) pairs.push(`${a.id} y ${b.id}`);
      }
    }
    return pairs;
  }, testids);
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
  await page.addScriptTag({ path: AXE_SCRIPT_PATH });
  return page.evaluate(async () => {
    const result = await window.axe.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag22aa"] },
    });
    // DESIGN 5.2 y 10: el texto de los controles deshabilitados está exento de contraste (1.4.3).
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
