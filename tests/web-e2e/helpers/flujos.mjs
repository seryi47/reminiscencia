// Recorridos reutilizables por las pruebas: primer perfil, modo paciente y navegación entre pantallas.
// Cada paso usa data-testid del contrato. Solo donde el contrato no asigna identificador se busca
// un control por el texto que DESIGN fija, y el comentario lo indica.
import { clickTestid, clickText, isVisible, waitShownSelector, waitVisible } from "./elementos.mjs";

/** Perfil ficticio de las pruebas. Nunca datos reales. */
export const TEST_PROFILE = Object.freeze({ alias: "Participante de prueba", pin: "1234" });

const PATIENT_ROOTS = Object.freeze({ escuchar: "p1-root", listas: "p2-root", carpetas: "p3-root", buscar: "p4-root" });
const CAREGIVER_ROOTS = Object.freeze({ inicio: "c-inicio", biblioteca: "c-biblioteca", perfiles: "c-perfiles", ajustes: "c-settings" });

// Campos de texto del asistente y de búsqueda (no son casillas ni botones de opción).
const TEXT_FIELD_SELECTOR = "input:not([type='checkbox']):not([type='radio']):not([type='hidden'])";

export async function openApp(page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
}

/** Escribe en los campos visibles dentro de un contenedor con data-testid. */
export async function typeInto(page, containerTestid, text, { selector = TEXT_FIELD_SELECTOR, all = false, context = "" } = {}) {
  await waitVisible(page, containerTestid, { context });
  const fields = await page.$$(`[data-testid="${containerTestid}"] ${selector}`);
  const visibleFields = [];
  for (const field of fields) {
    if (await field.evaluate((el) => window.__e2eIsShown(el))) visibleFields.push(field);
  }
  if (visibleFields.length === 0) {
    throw new Error(`No hay campos visibles dentro de data-testid="${containerTestid}"${context ? ` (${context})` : ""}.`);
  }
  for (const field of all ? visibleFields : visibleFields.slice(0, 1)) {
    await field.click();
    await field.type(text);
  }
}

/** Primer uso: lleva al asistente de primer perfil (C3e). */
export async function startFirstRun(page) {
  if (!(await isVisible(page, "c-wizard", 2500))) {
    // La elección de arranque no tiene data-testid en el contrato; DESIGN 3.3 fija el texto «Modo cuidador».
    await clickText(page, "Modo cuidador", { context: "elección de arranque (DESIGN 3.3)" });
  }
  await waitVisible(page, "c-wizard", { context: "asistente de primer perfil (C3e)", ms: 10000 });
}

/** Crea el primer perfil con el asistente. Con `pin`, define el PIN de prueba; sin él, pulsa «Ahora no». */
export async function createFirstProfile(page, { pin = false } = {}) {
  await startFirstRun(page);
  await typeInto(page, "c-wizard", TEST_PROFILE.alias, { context: "paso 1 del asistente: alias" });
  await clickTestid(page, "c-wizard-next", "paso 1 del asistente");
  await clickTestid(page, "c-wizard-next", "paso 2 del asistente: canciones iniciales (opcional)");
  if (pin) {
    await typeInto(page, "c-wizard", TEST_PROFILE.pin, {
      selector: "input[type='password'], input[inputmode='numeric'], input[type='tel'], input[type='number']",
      all: true,
      context: "paso 3 del asistente: PIN",
    });
    await clickTestid(page, "c-wizard-next", "paso 3 del asistente (PIN)");
  } else {
    await clickTestid(page, "c-wizard-skip-pin", "paso 3 del asistente («Ahora no»)");
  }
  await waitVisible(page, "c-inicio", { context: "Inicio del cuidador tras crear el perfil", ms: 10000 });
}

/** Abre la app, crea el perfil de prueba y deja el Inicio del cuidador (C1). */
export async function openCaregiverHome(page, url, { pin = false } = {}) {
  await openApp(page, url);
  await createFirstProfile(page, { pin });
}

/**
 * Abre la app, crea el perfil y entra en el modo paciente (C1 → C4 → P1) sin reproducir nada.
 * `sleepLabels` fija el apagado automático en C4 (P6). `pin` define el PIN de prueba.
 */
export async function openPatientMode(page, url, { pin = false, sleepLabels = null } = {}) {
  await openCaregiverHome(page, url, { pin });
  await clickTestid(page, "c-open-patient", "botón Abrir modo paciente (C1)");
  await waitVisible(page, "c-session-sheet", { context: "hoja Empezar sesión (C4)" });
  if (sleepLabels) {
    await clickText(page, sleepLabels, { within: "c-session-sheet", context: "apagado automático (C4)" });
  }
  await clickTestid(page, "c-session-start", "botón Empezar de la hoja C4");
  await waitVisible(page, "p1-root", { context: "pantalla Escuchar del paciente (P1)", ms: 10000 });
}

/** Pulsa un destino de la navegación del paciente y espera su pantalla. */
export async function goPatientSection(page, section) {
  await clickTestid(page, `p-nav-${section}`, `destino ${section} de la navegación del paciente`);
  await waitVisible(page, PATIENT_ROOTS[section], { context: `pantalla ${section} del paciente` });
}

/** Pulsa un destino de la navegación del cuidador y espera su pantalla. */
export async function goCaregiverSection(page, section) {
  await clickTestid(page, `c-nav-${section}`, `destino ${section} de la navegación del cuidador`);
  await waitVisible(page, CAREGIVER_ROOTS[section], { context: `pantalla ${section} del cuidador` });
}

/** Desde el paciente, vuelve al cuidador sin PIN (P5, «Volver al modo cuidador»). */
export async function leavePatientWithoutPin(page) {
  await clickTestid(page, "p-caregiver", "botón Cuidador de la cabecera del paciente");
  await waitVisible(page, "p5-dialog", { context: "diálogo de salida (P5)" });
  await clickTestid(page, "p5-caregiver", "«Volver al modo cuidador» (P5)");
  await waitVisible(page, "c-inicio", { context: "Inicio del cuidador tras salir del paciente" });
}

/** Abre la ficha de perfil (C3a) del primer perfil. */
export async function openFirstProfile(page) {
  await goCaregiverSection(page, "perfiles");
  await clickTestid(page, "c-profile-card", "primera tarjeta de perfil (C3)");
  await waitVisible(page, "c-profile-alias", { context: "ficha del perfil (C3a)" });
}

/** Abre el editor de recuerdo nuevo (C3c) desde la pestaña Recuerdos del perfil. */
export async function openNewMemoryEditor(page) {
  await openFirstProfile(page);
  await clickTestid(page, "c-tab-recuerdos", "pestaña Recuerdos del perfil");
  // «Nuevo recuerdo» está fijado por DESIGN 3.2 (C3a) y no tiene data-testid en el contrato.
  await clickText(page, "Nuevo recuerdo", { context: "botón Nuevo recuerdo (C3a)" });
  await waitVisible(page, "c-memory-title", { context: "editor de recuerdo (C3c)" });
}

/** Abre la hoja de nueva observación (C3d) desde la pestaña Observaciones del perfil. */
export async function openNewObservationSheet(page) {
  await openFirstProfile(page);
  await clickTestid(page, "c-tab-observaciones", "pestaña Observaciones del perfil");
  // «Nueva observación» está fijado por DESIGN 3.2 (C3a) y no tiene data-testid en el contrato.
  await clickText(page, "Nueva observación", { context: "botón Nueva observación (C3a)" });
  await waitVisible(page, "c-observation-sheet", { context: "hoja Nueva observación (C3d)" });
}

/** Abre la hoja de opciones del paciente (C3f). La hoja no tiene data-testid en el contrato: se busca por rol dialog. */
export async function openProfileOptionsSheet(page) {
  await openFirstProfile(page);
  await clickTestid(page, "c-profile-options", "botón Opciones del paciente (C3a)");
  await waitShownSelector(page, `[role="dialog"], dialog[open]`, { context: "hoja Opciones del paciente (C3f)" });
}

/** Desde el Inicio del cuidador, abre la hoja Empezar sesión (C4) sin empezar. */
export async function openSessionSheet(page) {
  await clickTestid(page, "c-open-patient", "botón Abrir modo paciente (C1)");
  await waitVisible(page, "c-session-sheet", { context: "hoja Empezar sesión (C4)" });
}

/** Pulsa la carpeta número `index` (0 es la primera visible) de la cuadrícula de carpetas (P3). No espera a nada. */
export async function clickPatientFolderTile(page, index) {
  await waitVisible(page, "p3-folders", { context: "cuadrícula de carpetas (P3)" });
  const tiles = await page.$$(
    `[data-testid="p3-folders"] a, [data-testid="p3-folders"] button, [data-testid="p3-folders"] [role="button"]`,
  );
  const shown = [];
  for (const tile of tiles) {
    if (await tile.evaluate((el) => window.__e2eIsShown(el))) shown.push(tile);
  }
  if (shown.length <= index) {
    throw new Error(`En data-testid="p3-folders" hay ${shown.length} carpetas visibles y se pedía la número ${index + 1}.`);
  }
  await shown[index].click();
}

/** Abre la primera carpeta con canciones (P3b). */
export async function openPatientFolder(page) {
  await goPatientSection(page, "carpetas");
  await clickPatientFolderTile(page, 0);
  await waitVisible(page, "p3b-root", { context: "pantalla Carpeta (P3b)" });
}

/** Fija la escala de texto en Ajustes (C5). `labels` son los textos de DESIGN 5.3 para esa escala. */
export async function setTextScale(page, labels) {
  await goCaregiverSection(page, "ajustes");
  await clickText(page, labels, { within: "c-settings-text-scale", context: "opción de escala de texto (C5)" });
}

/** Enfoca el campo de búsqueda del paciente (P4), esté el data-testid en el propio campo o en su contenedor. */
export async function focusSearchField(page, testid) {
  const element = await waitVisible(page, testid, { context: "campo de búsqueda (P4)" });
  await element.evaluate((el) => {
    const field = el.matches("input, textarea") ? el : el.querySelector("input, textarea");
    if (!field) throw new Error("El contenedor del campo de búsqueda no tiene ningún input ni textarea.");
    field.focus();
  });
}
