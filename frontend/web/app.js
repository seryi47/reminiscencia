// Reminiscencia · escucha. Sin dependencias: lee data/songs.json y data/folders.json.

const $ = (id) => document.getElementById(id);
const app = document.querySelector(".app");
const audio = $("audio");

let songs = [];
let folders = [];
let view = [];          // canciones visibles, en orden
let folder = "all";     // "all" | "none" | id
let currentId = null;
let query = "";

const fmt = (s) => {
  const t = Math.max(0, Math.round(s || 0));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
};
const hue = (text) => {
  let h = 0x811c9dc5;
  for (const c of text) { h ^= c.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return h % 360;
};
const artStyle = (seed) => {
  const h = hue(seed);
  return `background: linear-gradient(135deg, hsl(${h} 46% 52%), hsl(${(h + 40) % 360} 40% 30%));`;
};
const norm = (text) => String(text || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg>';
const PAUSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5.5h3.5v13H7zM13.5 5.5H17v13h-3.5z"/></svg>';

const inFolder = (s) => folder === "all" || (folder === "none" ? !s.folder_id : s.folder_id === folder);
const folderLabel = () => (folder === "all" ? "Todas las canciones" : folder === "none" ? "Sin carpeta" : (folders.find((f) => f.id === folder) || {}).name || "Carpeta");

function matches(s) {
  if (!query) return true;
  const text = norm([s.title, s.artist, s.year, (s.tags || []).join(" ")].join(" "));
  return query.split(/\s+/).every((w) => text.includes(w));
}

// ---------- carpetas ----------

const children = (parent) => folders.filter((f) => (f.parent_id || null) === parent).sort((a, b) => a.name.localeCompare(b.name, "es"));

function renderTree() {
  const tree = $("tree");
  tree.innerHTML = "";
  const walk = (parent, depth) => children(parent).forEach((f) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "tree-item";
    b.dataset.folder = f.id;
    b.style.paddingLeft = `${8 + depth * 12}px`;
    b.innerHTML = '<span class="nav-text"></span><span class="count"></span>';
    b.querySelector(".nav-text").textContent = f.name;
    b.querySelector(".count").textContent = String(songs.filter((s) => s.folder_id === f.id).length);
    tree.appendChild(b);
    walk(f.id, depth + 1);
  });
  walk(null, 0);
  $("tree-empty").hidden = folders.length > 0;
  document.querySelectorAll("[data-count]").forEach((el) => {
    el.textContent = String(el.dataset.count === "all" ? songs.length : songs.filter((s) => !s.folder_id).length);
  });
  document.querySelectorAll("[data-folder]").forEach((b) => b.setAttribute("aria-current", String(b.dataset.folder === folder)));
}

function renderChips() {
  const chips = $("chips");
  chips.innerHTML = "";
  const add = (id, label) => {
    const c = document.createElement("button");
    c.type = "button";
    c.className = "chip";
    c.dataset.folder = id;
    c.setAttribute("aria-current", String(id === folder));
    c.textContent = label;
    chips.appendChild(c);
  };
  add("all", "Todas");
  add("none", "Sin carpeta");
  children(null).forEach((f) => add(f.id, f.name));
}

function selectFolder(id) {
  folder = id;
  setTab("library");
  $("scrim").hidden = true;
  renderTree();
  renderChips();
  renderList();
}

document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-folder]");
  if (b) selectFolder(b.dataset.folder);
});

// ---------- lista ----------

function renderList() {
  view = songs.filter((s) => inFolder(s) && matches(s)).sort((a, b) => a.title.localeCompare(b.title, "es"));
  $("title").textContent = folderLabel();
  $("subtitle").textContent = `${view.length} ${view.length === 1 ? "canción" : "canciones"}`;
  $("empty").hidden = view.length > 0;
  const list = $("list");
  list.innerHTML = "";
  view.forEach((s, index) => {
    const li = document.createElement("li");
    const row = document.createElement("button");
    row.type = "button";
    row.className = "row";
    row.dataset.id = s.id;
    row.setAttribute("aria-current", String(s.id === currentId));
    row.setAttribute("aria-label", `Reproducir ${s.title}`);
    row.innerHTML = `
      <span class="row-num"><span>${index + 1}</span>${PLAY}</span>
      <span class="row-title"><b></b><small></small></span>
      <span class="row-dur"></span>`;
    row.querySelector("b").textContent = s.title;
    row.querySelector("small").textContent = [s.artist, s.year].filter(Boolean).join(" · ");
    row.querySelector(".row-dur").textContent = fmt(s.duration_s);
    row.addEventListener("click", () => play(s.id));
    li.appendChild(row);
    list.appendChild(li);
  });
}

// ---------- reproducción ----------

const index = () => view.findIndex((s) => s.id === currentId);
const current = () => songs.find((s) => s.id === currentId) || null;

function play(id) {
  const s = songs.find((x) => x.id === id);
  if (!s) return;
  currentId = id;
  audio.src = s.audio;
  audio.play().catch(() => {});
  paint();
  renderList();
}

function step(delta) {
  if (!view.length) return;
  const i = index();
  const next = i === -1 ? 0 : Math.min(Math.max(i + delta, 0), view.length - 1);
  play(view[next].id);
}

function togglePlayback() {
  if (!currentId) { if (view.length) play(view[0].id); return; }
  if (audio.paused) audio.play().catch(() => {}); else audio.pause();
}

function paint() {
  const s = current();
  const title = s ? s.title : "Elige una canción";
  const sub = s ? [s.artist, s.year].filter(Boolean).join(" · ") || " " : " ";
  const pos = s ? `${index() + 1} de ${view.length}` : " ";
  $("mini-title").textContent = title;
  $("mini-sub").textContent = sub;
  $("mini-art").setAttribute("style", s ? artStyle(s.id) : "");
  $("now-title").textContent = title;
  $("now-sub").textContent = sub;
  $("now-count").textContent = pos;
  $("now-art").setAttribute("style", s ? artStyle(s.id) : "");
  $("time-total").textContent = s ? fmt(s.duration_s) : "0:00";
  const playing = !audio.paused && !audio.ended;
  for (const [btn, icon] of [["toggle", "toggle-icon"], ["now-toggle", "now-toggle-icon"]]) {
    $(btn).setAttribute("aria-label", playing ? "Pausar" : "Reproducir");
    $(btn).setAttribute("aria-pressed", String(playing));
    $(icon).outerHTML = (playing ? PAUSE : PLAY).replace("<svg", `<svg id="${icon}"`);
  }
}

["toggle", "now-toggle"].forEach((id) => $(id).addEventListener("click", togglePlayback));
["prev", "now-prev"].forEach((id) => $(id).addEventListener("click", () => step(-1)));
["next", "now-next"].forEach((id) => $(id).addEventListener("click", () => step(1)));

audio.addEventListener("play", paint);
audio.addEventListener("pause", paint);
audio.addEventListener("ended", () => (index() < view.length - 1 ? step(1) : paint()));
audio.addEventListener("loadedmetadata", () => { $("seek").max = String(Math.floor(audio.duration || 0)); fill($("seek")); });
audio.addEventListener("timeupdate", () => {
  $("seek").value = String(Math.floor(audio.currentTime));
  $("time-now").textContent = fmt(audio.currentTime);
  fill($("seek"));
});
$("seek").addEventListener("input", () => { audio.currentTime = Number($("seek").value); });

function fill(input) {
  const max = Number(input.max) || 1;
  input.style.setProperty("--fill", `${Math.min(100, (Number(input.value) / max) * 100)}%`);
}
$("volume").addEventListener("input", () => { audio.volume = Number($("volume").value); fill($("volume")); });
audio.volume = Number($("volume").value);
fill($("volume"));

// ---------- pestañas y vista completa (móvil) ----------

function setTab(name) {
  app.dataset.tab = name;
  document.querySelectorAll(".tab").forEach((t) => t.setAttribute("aria-current", String(t.dataset.tab === name)));
  if (name === "folders") $("scrim").hidden = false;
  else $("scrim").hidden = true;
  if (name === "search") $("search").focus();
}
document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => setTab(t.dataset.tab)));
$("scrim").addEventListener("click", () => setTab("library"));

const isPhone = () => window.matchMedia("(max-width: 860px)").matches;
$("open-now").addEventListener("click", () => {
  if (!isPhone()) return togglePlayback();
  $("now").hidden = false;
  $("now-close").focus();
});
$("now-close").addEventListener("click", () => { $("now").hidden = true; $("open-now").focus(); });

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") { if (!$("now").hidden) $("now").hidden = true; if (app.dataset.tab === "folders") setTab("library"); }
  if (e.target.matches("input, textarea, select")) return;
  if (e.code === "Space") { e.preventDefault(); togglePlayback(); }
  else if (e.code === "ArrowRight") step(1);
  else if (e.code === "ArrowLeft") step(-1);
  else if (e.key === "/") { e.preventDefault(); $("search").focus(); }
});

$("search").addEventListener("input", () => { query = norm($("search").value.trim()); renderList(); });

// ---------- carga ----------

async function load() {
  try {
    const [s, f] = await Promise.all([
      fetch("data/songs.json", { cache: "no-cache" }),
      fetch("data/folders.json", { cache: "no-cache" }).catch(() => null),
    ]);
    if (!s.ok) throw new Error(String(s.status));
    songs = await s.json();
    folders = f && f.ok ? await f.json() : [];
    $("status").textContent = `${songs.length} canciones · ${folders.length} carpetas`;
    renderTree();
    renderChips();
    renderList();
    paint();
  } catch (e) {
    $("status").textContent = "No se pudo cargar la biblioteca. Recarga la página.";
  }
}
load();
