// Navegador de pruebas: Chrome con puppeteer-core, un contexto aislado por prueba y los anchos de DESIGN §4.
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

/** Anchos de referencia de DESIGN §4: teléfono, tableta vertical, escritorio estrecho y escritorio. */
export const VIEWPORTS = Object.freeze({
  telefono: Object.freeze({ width: 390, height: 844 }),
  tabletaVertical: Object.freeze({ width: 820, height: 1180 }),
  tabletaHorizontal: Object.freeze({ width: 1024, height: 768 }),
  escritorio: Object.freeze({ width: 1440, height: 900 }),
});

/** Carpeta de capturas (fuera de git: ver tests/web-e2e/.gitignore). */
export const SCREENSHOT_DIR = fileURLToPath(new URL("../capturas/", import.meta.url));

// Rutas típicas de macOS y Linux, por orden de preferencia, después de CHROME_PATH.
const CHROME_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/snap/bin/chromium",
];

export function findChromePath() {
  const candidates = [process.env.CHROME_PATH, ...CHROME_CANDIDATES].filter(Boolean);
  const found = candidates.find((path) => existsSync(path));
  if (!found) {
    throw new Error(
      `No se encuentra Chrome. Define CHROME_PATH con la ruta del ejecutable. Rutas probadas: ${candidates.join(", ")}`,
    );
  }
  return found;
}

// Script que se inyecta antes de cada documento:
// - cuenta las llamadas a play() para comprobar que no suena nada al abrir la app;
// - define __e2eIsShown, que decide si un elemento se ve (puppeteer solo mira el primer coincidente).
const PAGE_PROBE = `
  window.__e2ePlayCalls = 0;
  const originalPlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (...args) {
    window.__e2ePlayCalls += 1;
    return originalPlay.apply(this, args);
  };
  window.__e2eIsShown = function (element) {
    if (element.getClientRects().length === 0) return false;
    const style = getComputedStyle(element);
    if (style.visibility === "hidden" || style.display === "none") return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
`;

/** Lanza Chrome en modo sin cabeza. Se llama una vez por fichero de pruebas. */
export async function launchBrowser() {
  return puppeteer.launch({
    executablePath: findChromePath(),
    headless: true,
    defaultViewport: null,
    args: [
      "--hide-scrollbars",
      "--mute-audio",
      "--font-render-hinting=none",
      // Chrome en Linux dentro de contenedores de CI necesita desactivar el sandbox.
      ...(process.platform === "linux" ? ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"] : []),
    ],
  });
}

/**
 * Ejecuta una tarea con una página nueva en un contexto aislado (IndexedDB y localStorage propios).
 * El contexto se cierra al terminar, con éxito o con error.
 */
export async function withPage(browser, viewport, task) {
  const context = await browser.createBrowserContext();
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    await page.setViewport({ width: viewport.width, height: viewport.height, deviceScaleFactor: 1 });
    await page.evaluateOnNewDocument(PAGE_PROBE);
    return await task(page);
  } finally {
    await context.close();
  }
}

/** Guarda una captura de la ventana visible en SCREENSHOT_DIR. */
export async function capture(page, name) {
  await mkdir(SCREENSHOT_DIR, { recursive: true });
  const safeName = name.replace(/[^\w.-]+/g, "-");
  await page.screenshot({ path: join(SCREENSHOT_DIR, `${safeName}.png`) });
}
