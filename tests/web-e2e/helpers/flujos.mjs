// Recorridos reutilizables: abrir la app (sin perfiles ni modos: abre en Inicio), ir a cada pantalla, reproducir,
// buscar (en la barra superior o, en el teléfono, en la página), crear una lista, abrir el menú «Crear» y sembrar
// canciones locales. Cada paso usa data-testid del contrato (DESIGN §13).
import { clickTestid, findVisibleTestid, waitShownSelector, waitVisible } from "./elementos.mjs";

/** Abre la app y espera a que haya cargado la biblioteca (html[data-ready]). */
export async function openApp(page, url, hash = "") {
  await page.goto(`${url}${hash}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('html[data-ready="true"]', { timeout: 15000 });
}

/** ¿Es un ancho de teléfono? (< 768 px: barra inferior en lugar de barra lateral). */
export function isPhone(viewport) {
  return viewport.width < 768;
}

/** Va a Inicio, Buscar o Tu biblioteca con la navegación que se ve en ese ancho (barra superior o barra inferior). */
export async function goSection(page, section, viewport) {
  if (section === "biblioteca") {
    await clickTestid(page, isPhone(viewport) ? "tab-biblioteca" : "sidebar-library-link", "Tu biblioteca");
    await waitVisible(page, "view-library", { context: "página Tu biblioteca" });
    return;
  }
  // En la barra superior, «Inicio» es el botón redondo y «Buscar» es «Explorar», dentro del buscador.
  await clickTestid(page, `${isPhone(viewport) ? "tab" : "nav"}-${section}`, `destino ${section}`);
  await waitVisible(page, section === "inicio" ? "view-home" : "view-search", { context: `pantalla ${section}` });
}

/** Prefijo de «Tu biblioteca» en ese ancho: el panel izquierdo o, en el teléfono, la página. */
export async function libraryPrefix(page, viewport) {
  if (isPhone(viewport)) {
    if (!(await findVisibleTestid(page, "view-library", 300))) await goSection(page, "biblioteca", viewport);
    return "library-page";
  }
  return "sidebar";
}

/** Abre «+ Crear» de «Tu biblioteca» y elige una opción (playlist, album o upload). */
export async function createMenu(page, viewport, option) {
  const prefix = await libraryPrefix(page, viewport);
  await clickTestid(page, `${prefix}-create`, "botón Crear");
  await waitShownSelector(page, '[role="menu"]', { context: "menú Crear" });
  const testid = { playlist: "menu-create-playlist", album: "menu-create-album", upload: "menu-upload" }[option];
  await page.$eval(`[data-testid="${testid}"]`, (item) => item.click());
}

/** Abre una colección por su hash (carpeta, lista, «Me gusta»…) y espera su cabecera. */
export async function openCollection(page, hash) {
  await page.evaluate((target) => { location.hash = target; }, hash);
  await waitVisible(page, "collection-title", { context: `colección ${hash}` });
}

/** Pulsa el título de la canción número `index` de la tabla visible. */
export async function playRow(page, index = 0) {
  await waitVisible(page, "track-title", { context: "tabla de canciones" });
  const titles = await page.$$('[data-testid="track-title"]');
  await titles[index].click();
  await page.waitForFunction(() => !document.getElementById("audio").paused, { timeout: 10000 });
}

/** Vacía un campo (como si se borrara a mano) y escribe el texto tecla a tecla. */
export async function fillField(field, text) {
  await field.evaluate((el) => {
    el.focus();
    el.value = "";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await field.type(text);
}

/** Escribe en el buscador que se ve: el de la barra superior (escritorio y tableta) o el de la página (teléfono). */
export async function search(page, text) {
  const input = (await findVisibleTestid(page, "top-search-input", 300)) ?? (await waitVisible(page, "search-input", { context: "campo de búsqueda" }));
  await fillField(input, text);
  await waitVisible(page, "view-search", { context: "pantalla Buscar" });
}

/** Crea una lista con «+ Crear» › «Lista» y espera su página. Devuelve su id. */
export async function createPlaylist(page, viewport) {
  await createMenu(page, viewport, "playlist");
  await page.waitForFunction(() => location.hash.startsWith("#/lista/"), { timeout: 8000 });
  await waitVisible(page, "collection-title", { context: "página de la lista nueva" });
  return page.evaluate(() => decodeURIComponent(location.hash.split("/")[2] ?? ""));
}

/** Abre la hoja «Subir canciones» (ADR-0017) y, con option "archive", la importación desde Internet Archive. */
export async function openUpload(page, viewport, option = null) {
  await createMenu(page, viewport, "upload");
  await waitVisible(page, "upload-sheet", { context: "hoja Subir canciones" });
  await waitVisible(page, "upload-panel", { context: "panel de subida" });
  if (option === "archive") {
    await clickTestid(page, "upload-open-archive", "Importar desde Internet Archive");
    await waitVisible(page, "upload-panel-archive", { context: "panel de Internet Archive" });
  }
}

/** Abre el menú «···» de la colección abierta y devuelve los textos de sus opciones. */
export async function openCollectionMenu(page) {
  await clickTestid(page, "collection-more", "«···» de la colección");
  await waitShownSelector(page, '[role="menu"]', { context: "menú de la colección" });
  return page.$$eval('[role="menu"] [role="menuitem"]', (items) => items.map((item) => item.querySelector(".menu-label").textContent.trim()));
}

/** Pulsa una opción del menú abierto por su data-testid. */
export async function pickMenu(page, testid) {
  await page.waitForSelector(`[role="menu"] [data-testid="${testid}"]`, { timeout: 5000 });
  await page.$eval(`[role="menu"] [data-testid="${testid}"]`, (item) => item.click());
}

/** Abre el menú «Más opciones» de la fila de una canción y devuelve los textos de sus opciones. */
export async function openRowMenu(page, songId) {
  const selector = `[data-testid="track-row"][data-song-id="${songId}"] [data-testid="row-more"]`;
  await page.waitForSelector(selector, { timeout: 8000 });
  await page.$eval(selector, (button) => button.click());
  await waitShownSelector(page, '[role="menu"]', { context: "menú de la canción" });
  return page.$$eval('[role="menu"] [role="menuitem"]', (items) => items.map((item) => item.querySelector(".menu-label").textContent.trim()));
}

/** Payload JSON de la incidencia de un enlace de GitHub (línea «payload:» del cuerpo). */
export async function issuePayload(page, testid) {
  await page.waitForFunction((id) => document.querySelector(`[data-testid="${id}"]`)?.getAttribute("aria-disabled") === "false", { timeout: 5000 }, testid);
  const href = await page.$eval(`[data-testid="${testid}"]`, (a) => a.href);
  const url = new URL(href);
  const body = url.searchParams.get("body");
  const line = body.split("\n").find((item) => item.startsWith("payload: "));
  return {
    origin: url.origin + url.pathname,
    labels: url.searchParams.get("labels"),
    title: url.searchParams.get("title"),
    body,
    payload: JSON.parse(line.slice("payload: ".length)),
  };
}

/** Siembra una canción en la base de audio local (la misma que usa subida-local.js). */
export async function seedLocalSong(page, { id, title, blob = null }) {
  await page.evaluate(
    async ({ songId, songTitle, bytes }) => {
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open("reminiscencia-audio-local", 1);
        request.onupgradeneeded = () => request.result.createObjectStore("pistas", { keyPath: "id" });
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      await new Promise((resolve, reject) => {
        const tx = db.transaction("pistas", "readwrite");
        tx.objectStore("pistas").put({
          id: songId,
          title: songTitle,
          durationS: 60,
          channels: 1,
          bitrate: 32000,
          bytes: 8,
          createdAt: Date.now(),
          blob: new Blob([new Uint8Array(bytes ?? [0, 0, 0, 0, 0, 0, 0, 0])], { type: "audio/ogg" }),
        });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    },
    { songId: id, songTitle: title, bytes: blob },
  );
}

/** Número de canciones guardadas en la base de audio local. */
export async function countLocalSongs(page) {
  return page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("reminiscencia-audio-local");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    if (!db.objectStoreNames.contains("pistas")) {
      db.close();
      return 0;
    }
    const total = await new Promise((resolve, reject) => {
      const request = db.transaction("pistas", "readonly").objectStore("pistas").count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return total;
  });
}

/** Espera a que el service worker controle la página (para el audio local y el modo sin conexión). */
export async function waitServiceWorker(page) {
  await page.waitForFunction(() => Boolean(navigator.serviceWorker?.controller), { timeout: 15000 });
}
