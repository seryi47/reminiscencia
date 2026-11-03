// Recorridos reutilizables: abrir la app (sin perfiles ni modos: abre en Inicio), ir a cada pantalla, reproducir,
// crear una lista y sembrar canciones locales. Cada paso usa data-testid del contrato (DESIGN §13).
import { clickTestid, waitShownSelector, waitVisible } from "./elementos.mjs";

/** Abre la app y espera a que haya cargado la biblioteca (html[data-ready]). */
export async function openApp(page, url, hash = "") {
  await page.goto(`${url}${hash}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('html[data-ready="true"]', { timeout: 15000 });
}

/** ¿Es un ancho de teléfono? (< 768 px: barra inferior en lugar de barra lateral). */
export function isPhone(viewport) {
  return viewport.width < 768;
}

/** Va a Inicio, Buscar o Tu biblioteca con la navegación que se ve en ese ancho. */
export async function goSection(page, section, viewport) {
  if (section === "biblioteca") {
    await clickTestid(page, isPhone(viewport) ? "tab-biblioteca" : "sidebar-library-link", "Tu biblioteca");
    await waitVisible(page, "view-library", { context: "página Tu biblioteca" });
    return;
  }
  await clickTestid(page, `${isPhone(viewport) ? "tab" : "nav"}-${section}`, `destino ${section}`);
  await waitVisible(page, section === "inicio" ? "view-home" : "view-search", { context: `pantalla ${section}` });
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

/** Escribe en el campo de búsqueda grande. */
export async function search(page, text) {
  const input = await waitVisible(page, "search-input", { context: "campo de búsqueda" });
  await fillField(input, text);
}

/** Crea una lista desde la biblioteca de ese ancho y espera su página. Devuelve su id. */
export async function createPlaylist(page, viewport) {
  if (isPhone(viewport)) {
    await goSection(page, "biblioteca", viewport);
    await clickTestid(page, "library-page-create-playlist", "Crear lista");
  } else {
    await clickTestid(page, "sidebar-create-playlist", "Crear lista de la barra lateral");
  }
  await waitVisible(page, "collection-title", { context: "página de la lista nueva" });
  return page.evaluate(() => decodeURIComponent(location.hash.split("/")[2] ?? ""));
}

/** Abre la hoja «Subir canciones» y, si se indica, una de sus opciones (local, todos o archive). */
export async function openUpload(page, viewport, option = null) {
  if (isPhone(viewport)) {
    await goSection(page, "biblioteca", viewport);
    await clickTestid(page, "library-page-upload", "Subir canciones");
  } else {
    await clickTestid(page, "sidebar-upload", "Subir canciones de la barra lateral");
  }
  await waitVisible(page, "upload-sheet", { context: "hoja Subir canciones" });
  if (option) {
    await clickTestid(page, `upload-option-${option}`, `opción ${option}`);
    await waitVisible(page, `upload-panel-${option}`, { context: `panel ${option}` });
  }
}

/** Abre el menú «Más opciones» de la fila de una canción y devuelve los textos de sus opciones. */
export async function openRowMenu(page, songId) {
  const selector = `[data-testid="track-row"][data-song-id="${songId}"] [data-testid="row-more"]`;
  await page.waitForSelector(selector, { timeout: 8000 });
  await page.$eval(selector, (button) => button.click());
  await waitShownSelector(page, '[role="menu"]', { context: "menú de la canción" });
  return page.$$eval('[role="menu"] [role="menuitem"]', (items) => items.map((item) => item.textContent.trim()));
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
