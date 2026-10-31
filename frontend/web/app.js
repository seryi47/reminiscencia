// Reminiscencia · interfaz de escucha. Sin dependencias.
// Lee data/songs.json y data/folders.json, y reproduce audio/<id>.opus.

const $ = (id) => document.getElementById(id);
const app = document.querySelector(".app");
const audio = $("audio");

let songs = [];
let folders = [];
let view = [];              // canciones visibles (carpeta + búsqueda), ordenadas
let folder = "all";         // "all" | "none" | id de carpeta
let currentId = null;      // canción en reproducción
let tab = "library";

// ---------- utilidades ----------

const fmt = (seconds) => {
  const total = Math.max(0, Math.round(seconds || 0));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

// Color estable por canción o carpeta, para que el arte sea siempre el mismo.
function hueOf(text) {
  let hash = 0;
  for (const char of text) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash % 360;
}

function artStyle(seed) {
  const hue = hueOf(seed);
  const next = (hue + 46) % 360;
  return `background: linear-gradient(135deg, hsl(${hue} 78% 58%), hsl(${next} 62% 34%));`;
}

const PLAY_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg>';
const PAUSE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3.6v14H7zM13.4 5H17v14h-3.6z"/></svg>';

function folderName(id) {
  if (id === "all") return "Todas las canciones";
  if (id === "none") return "Sin carpeta";
  const found = folders.find((item) => item.id === id);
  return found ? found.name : "Carpeta";
}

function inFolder(song) {
  if (folder === "all") return true;
  if (folder === "none") return !song.folder_id;
  return song.folder_id === folder;
}

// Búsqueda por título, artista, año y etiquetas; sin distinguir mayúsculas ni tildes.
const normalize = (text) => String(text || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

function matches(song, query) {
  if (!query) return true;
  const haystack = normalize([song.title, song.artist, song.year, (song.tags || []).join(" ")].join(" "));
  return query.split(/\s+/).every((word) => haystack.includes(word));
}

// ---------- vista ----------

function applyView() {
  const query = normalize($("search").value.trim());
  view = songs
    .filter((song) => inFolder(song) && matches(song, query))
    .sort((a, b) => a.title.localeCompare(b.title, "es"));

  renderHero();
  renderGrid();
  renderNow();
  $("empty").hidden = view.length > 0;
}

function renderHero() {
  const isFolder = folder !== "all" && folder !== "none";
  $("hero-kind").textContent = isFolder ? "Carpeta" : "Biblioteca";
  $("hero-title").textContent = folderName(folder);
  $("hero-meta").textContent = `${view.length} ${view.length === 1 ? "canción" : "canciones"}`;
  const art = $("hero-art");
  art.setAttribute("style", artStyle(folder === "all" ? "biblioteca" : folder));
}

function renderGrid() {
  const grid = $("grid");
  grid.innerHTML = "";
  view.forEach((song) => {
    const li = document.createElement("li");
    const card = document.createElement("button");
    card.type = "button";
    card.className = "card";
    card.setAttribute("aria-current", String(song.id === currentId));
    card.setAttribute("aria-label", `Reproducir ${song.title}`);
    if (song.id === currentId) card.classList.add("is-playing");

    const art = document.createElement("span");
    art.className = "card-art";
    art.setAttribute("style", artStyle(song.id));
    art.setAttribute("aria-hidden", "true");
    const play = document.createElement("span");
    play.className = "card-play";
    play.innerHTML = PLAY_ICON;
    art.appendChild(play);

    const title = document.createElement("span");
    title.className = "card-title";
    title.textContent = song.title;
    const meta = document.createElement("span");
    meta.className = "card-meta";
    meta.textContent = [song.artist, song.year].filter(Boolean).join(" · ") || fmt(song.duration_s);

    card.append(art, title, meta);
    card.addEventListener("click", () => playById(song.id));
    li.appendChild(card);
    grid.appendChild(li);
  });
}

// ---------- carpetas (barra lateral y chips) ----------

const children = (parentId) =>
  folders
    .filter((item) => (item.parent_id || null) === parentId)
    .sort((a, b) => a.name.localeCompare(b.name, "es"));

const countIn = (id) => songs.filter((song) => song.folder_id === id).length;

function folderRow(id, label, count, depth) {
  const row = document.createElement("div");
  row.className = "folder-row";
  row.style.paddingLeft = `${depth * 14}px`;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "nav-item";
  button.dataset.folder = id;
  button.setAttribute("aria-current", String(id === folder));
  button.innerHTML = '<span class="nav-icon" aria-hidden="true">&#9645;</span><span class="nav-text"></span><span class="badge"></span>';
  button.querySelector(".nav-text").textContent = label;
  button.querySelector(".badge").textContent = String(count);
  button.addEventListener("click", () => selectFolder(id));
  row.appendChild(button);
  return row;
}

function renderFolders() {
  const tree = $("folder-tree");
  tree.innerHTML = "";
  const walk = (parentId, depth) => {
    children(parentId).forEach((item) => {
      tree.appendChild(folderRow(item.id, item.name, countIn(item.id), depth));
      walk(item.id, depth + 1);
    });
  };
  walk(null, 0);
  $("folders-empty").hidden = folders.length > 0;

  document.querySelectorAll("[data-count]").forEach((badge) => {
    const key = badge.dataset.count;
    badge.textContent = String(key === "all" ? songs.length : songs.filter((s) => !s.folder_id).length);
  });
  document.querySelectorAll(".nav > .nav-item[data-folder]").forEach((button) => {
    button.setAttribute("aria-current", String(button.dataset.folder === folder));
  });

  const chips = $("chips");
  chips.innerHTML = "";
  const addChip = (id, label) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    chip.setAttribute("role", "listitem");
    chip.setAttribute("aria-current", String(id === folder));
    chip.textContent = label;
    chip.addEventListener("click", () => selectFolder(id));
    chips.appendChild(chip);
  };
  addChip("all", "Todas");
  addChip("none", "Sin carpeta");
  children(null).forEach((item) => addChip(item.id, item.name));
}

function selectFolder(id) {
  folder = id;
  renderFolders();
  applyView();
  if (tab === "folders") setTab("library");
}

document.querySelectorAll(".nav > .nav-item[data-folder]").forEach((button) => {
  button.addEventListener("click", () => selectFolder(button.dataset.folder));
});

// ---------- pestañas (móvil) ----------

function setTab(name) {
  tab = name;
  app.dataset.tab = name;
  document.querySelectorAll(".tab").forEach((button) => {
    button.setAttribute("aria-current", String(button.dataset.tab === name));
  });
  if (name === "search") $("search").focus();
}

document.querySelectorAll(".tab").forEach((button) => {
  button.addEventListener("click", () => setTab(button.dataset.tab));
});

// ---------- reproducción ----------

const indexOfCurrent = () => view.findIndex((song) => song.id === currentId);

function currentSong() {
  return songs.find((song) => song.id === currentId) || null;
}

function playById(id) {
  const song = songs.find((item) => item.id === id);
  if (!song) return;
  currentId = id;
  audio.src = song.audio;
  audio.play().catch(() => {
    $("mini-meta").textContent = "Pulsa play para empezar";
  });
  paintNowPlaying();
  renderGrid();
}

function step(delta) {
  if (!view.length) return;
  const index = indexOfCurrent();
  const next = index === -1 ? 0 : Math.min(Math.max(index + delta, 0), view.length - 1);
  playById(view[next].id);
}

function paintNowPlaying() {
  const song = currentSong();
  const title = song ? song.title : "Elige una canción";
  const meta = song ? [song.artist, song.year].filter(Boolean).join(" · ") || " " : " ";
  const position = song ? `${indexOfCurrent() + 1} de ${view.length}` : " ";

  $("mini-title").textContent = title;
  $("mini-meta").textContent = meta;
  $("mini-art").setAttribute("style", song ? artStyle(song.id) : "");
  $("now-title").textContent = title;
  $("now-meta").textContent = meta;
  $("now-count").textContent = position;
  $("now-art").setAttribute("style", song ? artStyle(song.id) : "");
  $("time-total").textContent = song ? fmt(song.duration_s) : "0:00";
  paintToggle();
}

function renderNow() {
  paintNowPlaying();
}

function isPlaying() {
  return !audio.paused && !audio.ended;
}

function paintToggle() {
  const playing = isPlaying();
  const label = playing ? "Pausar" : "Reproducir";
  const icon = playing ? PAUSE_ICON : PLAY_ICON;
  ["toggle", "now-toggle"].forEach((id) => {
    const button = $(id);
    button.setAttribute("aria-label", label);
    button.setAttribute("aria-pressed", String(playing));
  });
  $("toggle-icon").outerHTML = icon.replace("<svg", '<svg id="toggle-icon"');
  $("now-toggle-icon").outerHTML = icon.replace("<svg", '<svg id="now-toggle-icon"');
  renderGrid();
}

function togglePlayback() {
  if (!currentId) {
    if (view.length) playById(view[0].id);
    return;
  }
  if (audio.paused) audio.play().catch(() => {});
  else audio.pause();
}

["toggle", "now-toggle"].forEach((id) => $(id).addEventListener("click", togglePlayback));
["prev", "now-prev"].forEach((id) => $(id).addEventListener("click", () => step(-1)));
["next", "now-next"].forEach((id) => $(id).addEventListener("click", () => step(1)));

audio.addEventListener("play", paintToggle);
audio.addEventListener("pause", paintToggle);
audio.addEventListener("ended", () => {
  const index = indexOfCurrent();
  if (index >= 0 && index < view.length - 1) step(1);
  else paintToggle();
});
audio.addEventListener("loadedmetadata", () => {
  $("seek").max = String(Math.floor(audio.duration || 0));
  paintFill($("seek"));
});
audio.addEventListener("timeupdate", () => {
  $("seek").value = String(Math.floor(audio.currentTime));
  $("time-now").textContent = fmt(audio.currentTime);
  paintFill($("seek"));
});
$("seek").addEventListener("input", () => {
  audio.currentTime = Number($("seek").value);
});

// Relleno visual de las barras de rango (progreso y volumen).
function paintFill(input) {
  const max = Number(input.max) || 1;
  const percent = (Number(input.value) / max) * 100;
  input.style.setProperty("--fill", `${Math.min(100, Math.max(0, percent))}%`);
}

$("volume").addEventListener("input", () => {
  audio.volume = Number($("volume").value);
  paintFill($("volume"));
});
audio.volume = Number($("volume").value);
paintFill($("volume"));

// Vista de pantalla completa (móvil).
function openNow() {
  $("now").hidden = false;
  $("now").dataset.open = "true";
  $("now-close").focus();
}
function closeNow() {
  $("now").dataset.open = "false";
  $("now").hidden = true;
  $("track").focus();
}
$("track").addEventListener("click", () => {
  if (window.matchMedia("(max-width: 900px)").matches) openNow();
  else togglePlayback();
});
$("now-close").addEventListener("click", closeNow);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && $("now").dataset.open === "true") closeNow();
  if (event.target.matches("input, textarea, select")) return;
  if (event.code === "Space") {
    event.preventDefault();
    togglePlayback();
  } else if (event.code === "ArrowRight") {
    step(1);
  } else if (event.code === "ArrowLeft") {
    step(-1);
  } else if (event.key === "/") {
    event.preventDefault();
    $("search").focus();
  }
});

$("search").addEventListener("input", applyView);

// ---------- carga ----------

async function load() {
  try {
    const [songsResponse, foldersResponse] = await Promise.all([
      fetch("data/songs.json", { cache: "no-cache" }),
      fetch("data/folders.json", { cache: "no-cache" }).catch(() => null),
    ]);
    if (!songsResponse.ok) throw new Error(`HTTP ${songsResponse.status}`);
    songs = await songsResponse.json();
    folders = foldersResponse && foldersResponse.ok ? await foldersResponse.json() : [];
    $("status").textContent = `${songs.length} canciones · ${folders.length} carpetas`;
    setTab("library");
    renderFolders();
    applyView();
  } catch (error) {
    $("status").textContent = "No se pudo cargar la biblioteca. Recarga la página.";
  }
}

load();
