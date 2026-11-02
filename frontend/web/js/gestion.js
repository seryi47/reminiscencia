// Reminiscencia · gestión de la biblioteca en la página pública.
// Cada formulario valida la petición con js/intake.js y abre una incidencia de GitHub con el texto ya escrito.
// El sistema la procesa en 1 a 3 minutos y la web se actualiza sola.
// La escucha (app.js) no cambia: esta sección solo lee data/catalog.json y data/folders.json al abrirse.
import {
  buildImportBody,
  buildIssueUrl,
  buildOrganizeBody,
  isFolderId,
  isSongId,
  needsLicense,
  normalizeTags,
  selectableSongs,
  validateImport,
} from "./intake.js";

const SOURCES = { songs: "data/catalog.json", folders: "data/folders.json" };
const DONE = "Petición preparada: GitHub se ha abierto en una pestaña nueva. Pulsa «Submit new issue» para enviarla.";

const $ = (id) => document.getElementById(id);
const store = { songs: null, folders: null }; // null: sin cargar o con error
let pending = null;

const details = $("gestion");
const summary = details.querySelector("summary");
const statusLine = $("g-status");

const addForm = $("g-add-form");
const addUrl = $("g-add-url");
const addLicenseWrap = $("g-add-license-wrap");
const addLicense = $("g-add-license");
const addTitle = $("g-add-title");
const addMsg = $("g-add-msg");

const createForm = $("g-create-form");
const createName = $("g-create-name");
const createParent = $("g-create-parent");
const createMsg = $("g-create-msg");

const renameForm = $("g-rename-form");
const renameFolder = $("g-rename-folder");
const renameName = $("g-rename-name");
const renameMsg = $("g-rename-msg");

const deleteForm = $("g-delete-form");
const deleteFolder = $("g-delete-folder");
const deleteConfirm = $("g-delete-confirm");
const deleteMsg = $("g-delete-msg");

const songForm = $("g-song-form");
const songSelect = $("g-song-select");
const songFields = $("g-song-fields");
const songTitle = $("g-song-title");
const songArtist = $("g-song-artist");
const songYear = $("g-song-year");
const songTags = $("g-song-tags");
const songFolder = $("g-song-folder");
const songPublic = $("g-song-public");
const songMsg = $("g-song-msg");

// ---------- mensajes (siempre con textContent) ----------

function say(region, text, kind = "") {
  region.className = kind ? `g-msg g-msg-${kind}` : "g-msg";
  region.textContent = text;
}

// Muestra el problema y lleva el foco al campo que hay que corregir.
function fail(region, text, field) {
  say(region, text, "bad");
  if (field) {
    field.setAttribute("aria-invalid", "true");
    field.focus();
  }
  return false;
}

function clearInvalid(form) {
  form.querySelectorAll("[aria-invalid]").forEach((node) => node.removeAttribute("aria-invalid"));
}

// Abre la incidencia en una pestaña nueva. Si el navegador bloquea la ventana, el enlace del mensaje sirve igual.
function openIssue(region, href) {
  const link = document.createElement("a");
  link.href = href;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = "Abrir la petición en GitHub";
  region.className = "g-msg g-msg-ok";
  region.replaceChildren(document.createTextNode(`${DONE} `), link);
  link.click();
  return true;
}

// Valida una operación sobre carpetas o canciones, prepara la incidencia y la abre.
function prepareOrganize(region, payload, title, fieldFor) {
  let body;
  try {
    body = buildOrganizeBody(payload);
  } catch (error) {
    return fail(region, error.message, typeof fieldFor === "function" ? fieldFor(error.message) : fieldFor);
  }
  return openIssue(region, buildIssueUrl(body, title));
}

// ---------- listas (catálogo y carpetas) ----------

const titleOf = (song) => String(song.title ?? "").trim() || song.id;
const artistOf = (song) => String(song.artist ?? "").trim();
const songLabel = (song) => {
  const artist = artistOf(song);
  return `${titleOf(song)}${artist ? ` (${artist})` : ""}`;
};
const yearOf = (song) => (song.year === null || song.year === undefined || song.year === "" ? null : Number(song.year));
const sameList = (a, b) => a.length === b.length && a.every((value, index) => value === b[index]);

// El catálogo puede ser una lista de canciones o un objeto { songs: [...] }, como audio-library/indexes/catalog.json.
function listOf(value) {
  if (Array.isArray(value)) return value;
  return value && Array.isArray(value.songs) ? value.songs : null;
}

function folderById(id) {
  return (store.folders || []).find((folder) => folder && folder.id === id) || null;
}

function folderName(id) {
  const folder = folderById(id);
  return folder ? String(folder.name ?? "").trim() || id : id;
}

// Ruta completa de una carpeta, por ejemplo "Jazz › Años 20".
function folderPath(folder, folders) {
  const names = [];
  const seen = new Set();
  let current = folder;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    names.unshift(String(current.name ?? "").trim() || current.id);
    const parentId = current.parent_id;
    current = parentId ? folders.find((item) => item && item.id === parentId) : null;
  }
  return names.join(" › ");
}

function folderChoices() {
  const folders = (store.folders || []).filter((folder) => folder && isFolderId(folder.id));
  return folders
    .map((folder) => [folder.id, folderPath(folder, folders)])
    .sort((a, b) => a[1].localeCompare(b[1], "es"));
}

// Sustituye las opciones de un select: primero las de cabecera y luego las de datos.
function fillSelect(select, leading, items) {
  select.replaceChildren(
    ...leading.map(([value, text]) => new Option(text, value)),
    ...items.map(([value, text]) => new Option(text, value)),
  );
}

function fillSelects() {
  const folders = folderChoices();
  fillSelect(createParent, [["", "Raíz (sin carpeta padre)"]], folders);
  fillSelect(renameFolder, [["", "Elige una carpeta"]], folders);
  fillSelect(deleteFolder, [["", "Elige una carpeta"]], folders);
  const songs = (store.songs || [])
    .filter((song) => song && isSongId(song.id))
    .sort((a, b) => titleOf(a).localeCompare(titleOf(b), "es"));
  fillSelect(songSelect, [["", store.songs ? "Elige una canción" : "No disponible"]], songs.map((song) => [song.id, songLabel(song)]));
  fillSongFields(null);
}

function reportStatus() {
  const failed = [!store.songs && "la lista de canciones", !store.folders && "la lista de carpetas"].filter(Boolean);
  if (failed.length) {
    say(statusLine, `No se pudo leer ${failed.join(" ni ")}. Cierra y vuelve a abrir esta sección para reintentarlo.`, "bad");
    return;
  }
  say(statusLine, `${store.songs.length} canciones publicadas · ${store.folders.length} carpetas`);
}

// ---------- datos (se leen al abrir la sección) ----------

async function getJson(url) {
  const response = await fetch(url, { cache: "no-cache" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function loadData() {
  say(statusLine, "Cargando la biblioteca…");
  const [songs, folders] = await Promise.allSettled([getJson(SOURCES.songs), getJson(SOURCES.folders)]);
  // La página solo lista las canciones publicadas con un identificador válido (ADR-0008). La cabecera cuenta lo mismo que el selector.
  const list = songs.status === "fulfilled" ? listOf(songs.value) : null;
  store.songs = list ? selectableSongs(list) : null;
  store.folders = folders.status === "fulfilled" && Array.isArray(folders.value) ? folders.value : null;
  fillSelects();
  reportStatus();
}

function ensureData() {
  if (store.songs && store.folders) return Promise.resolve();
  if (!pending) pending = loadData().finally(() => { pending = null; });
  return pending;
}

// ---------- añadir audio ----------

function syncLicenseField() {
  addLicenseWrap.hidden = !needsLicense(addUrl.value.trim());
}

function addFieldFor(problem, direct) {
  if (/título/.test(problem)) return addTitle;
  if (direct && /licencia/.test(problem)) return addLicense;
  return addUrl;
}

addUrl.addEventListener("input", syncLicenseField);
addUrl.addEventListener("change", syncLicenseField);

addForm.addEventListener("submit", (event) => {
  event.preventDefault();
  clearInvalid(addForm);
  const url = addUrl.value.trim();
  const direct = needsLicense(url);
  const license = direct ? addLicense.value.trim() : "";
  const title = addTitle.value.trim();
  const problem = validateImport({ url, license, title });
  if (problem) {
    fail(addMsg, problem, addFieldFor(problem, direct));
    return;
  }
  openIssue(addMsg, buildIssueUrl(buildImportBody({ url, license, title }), `Añadir audio: ${title || url}`));
});

// ---------- carpetas ----------

createForm.addEventListener("submit", (event) => {
  event.preventDefault();
  clearInvalid(createForm);
  const name = createName.value.trim();
  const parentId = createParent.value || null;
  prepareOrganize(createMsg, { op: "create_folder", name, parent_id: parentId }, `Crear carpeta: ${name}`, createName);
});

renameForm.addEventListener("submit", (event) => {
  event.preventDefault();
  clearInvalid(renameForm);
  const folderId = renameFolder.value;
  const name = renameName.value.trim();
  if (!folderId) {
    fail(renameMsg, "Elige la carpeta que quieres renombrar.", renameFolder);
    return;
  }
  const current = folderById(folderId);
  if (current && String(current.name ?? "").trim() === name) {
    fail(renameMsg, "El nombre nuevo es igual al actual.", renameName);
    return;
  }
  prepareOrganize(renameMsg, { op: "rename_folder", folder_id: folderId, name }, `Renombrar carpeta: ${name}`, renameName);
});

deleteForm.addEventListener("submit", (event) => {
  event.preventDefault();
  clearInvalid(deleteForm);
  const folderId = deleteFolder.value;
  if (!folderId) {
    fail(deleteMsg, "Elige la carpeta que quieres borrar.", deleteFolder);
    return;
  }
  if (!deleteConfirm.checked) {
    fail(deleteMsg, "Marca la casilla para confirmar el borrado.", deleteConfirm);
    return;
  }
  const done = prepareOrganize(deleteMsg, { op: "delete_folder", folder_id: folderId }, `Borrar carpeta: ${folderName(folderId)}`, deleteFolder);
  if (done) deleteConfirm.checked = false;
});

// ---------- canciones ----------

function currentSong() {
  const id = songSelect.value;
  return id ? (store.songs || []).find((song) => song && song.id === id) || null : null;
}

// Rellena los campos con los datos actuales de la canción. Sin canción, quedan vacíos y desactivados.
function fillSongFields(song) {
  clearInvalid(songForm);
  songFields.disabled = !song;
  songTitle.value = song ? String(song.title ?? "") : "";
  songArtist.value = song ? String(song.artist ?? "") : "";
  songYear.value = song && song.year !== null && song.year !== undefined ? String(song.year) : "";
  songTags.value = song && Array.isArray(song.tags) ? song.tags.join(", ") : "";
  songPublic.checked = Boolean(song) && song.public === true;
  const choices = folderChoices();
  // Si la carpeta de la canción no está en la lista, se muestra igualmente para no moverla sin querer.
  const unknownFolder = Boolean(song && song.folder_id) && !choices.some(([id]) => id === song.folder_id);
  fillSelect(songFolder, [["", "Sin carpeta"]], unknownFolder ? [...choices, [song.folder_id, "Carpeta no disponible"]] : choices);
  songFolder.value = song && song.folder_id ? song.folder_id : "";
}

// Campo al que llevar el foco según el motivo del error.
function songFieldFor(message) {
  if (/etiqueta/i.test(message)) return songTags;
  if (/año/i.test(message)) return songYear;
  if (/artista/i.test(message)) return songArtist;
  if (/título/i.test(message)) return songTitle;
  return songSelect;
}

songSelect.addEventListener("change", () => fillSongFields(currentSong()));

songForm.addEventListener("submit", (event) => {
  event.preventDefault();
  clearInvalid(songForm);
  const song = currentSong();
  if (!song) {
    fail(songMsg, "Elige una canción para ver y cambiar sus datos.", songSelect);
    return;
  }
  const yearText = songYear.value.trim();
  if (yearText !== "" && !/^\d{4}$/.test(yearText)) {
    fail(songMsg, "El año tiene que tener cuatro cifras, o quedar vacío.", songYear);
    return;
  }
  // Solo se envían los campos que cambian respecto al catálogo.
  const changes = {};
  const title = songTitle.value.trim();
  if (title !== String(song.title ?? "").trim()) changes.title = title;
  const artist = songArtist.value.trim();
  if (artist !== artistOf(song)) changes.artist = artist;
  const year = yearText === "" ? null : Number(yearText);
  if (year !== yearOf(song)) changes.year = year;
  const tags = normalizeTags(songTags.value);
  if (!sameList(tags, normalizeTags(song.tags))) changes.tags = tags;
  const folderId = songFolder.value || null;
  if (folderId !== (song.folder_id || null)) changes.folder_id = folderId;
  if (songPublic.checked !== (song.public === true)) changes.public = songPublic.checked;
  if (Object.keys(changes).length === 0) {
    say(songMsg, "No hay cambios que enviar: los datos de la canción son los mismos.");
    return;
  }
  prepareOrganize(songMsg, { op: "edit_song", song_id: song.id, ...changes }, `Editar canción: ${changes.title ?? titleOf(song)}`, songFieldFor);
});

// ---------- sección colapsada ----------

details.addEventListener("toggle", () => {
  if (details.open) ensureData();
});

// «Gestionar» en la barra lateral: abre la sección, cierra el cajón en el móvil y lleva el foco allí.
// Se cancela la navegación por fragmento para que nada le quite el foco al resumen.
$("open-gestion").addEventListener("click", (event) => {
  event.preventDefault();
  details.open = true;
  document.querySelector('.tab[data-tab="library"]')?.click();
  summary.focus();
});

// Dentro de la sección, las teclas no llegan a los atajos de reproducción de app.js (espacio, flechas, «/»).
details.addEventListener("keydown", (event) => event.stopPropagation());

syncLicenseField();
