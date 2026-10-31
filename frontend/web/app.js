// Reproductor y explorador de carpetas. Sin dependencias: lee data/songs.json y data/folders.json.

const $ = (id) => document.getElementById(id);
const audio = $("audio");

let songs = [];
let folders = [];
let visible = [];          // canciones de la vista actual (carpeta + búsqueda)
let currentFolder = "all"; // "all" | "none" | id de carpeta
let current = -1;          // índice dentro de `visible`
let currentId = null;      // id de la canción sonando (se mantiene aunque cambie la vista)

const SORT_KEY = "reminiscencia.orden";

function formatDuration(seconds) {
  const total = Math.round(seconds || 0);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

// ---- carpetas -----------------------------------------------------------

function childrenOf(parentId) {
  return folders
    .filter((folder) => (folder.parent_id || null) === parentId)
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
}

function countIn(folderId) {
  return songs.filter((song) => song.folder_id === folderId).length;
}

function renderFolders() {
  const list = $("folder-list");
  list.innerHTML = "";
  list.appendChild(folderItem("all", "Todas las canciones", songs.length, 0));
  list.appendChild(folderItem("none", "Sin carpeta", songs.filter((s) => !s.folder_id).length, 0));

  const walk = (parentId, depth) => {
    childrenOf(parentId).forEach((folder) => {
      list.appendChild(folderItem(folder.id, folder.name, countIn(folder.id), depth));
      walk(folder.id, depth + 1);
    });
  };
  walk(null, 0);
}

function folderItem(key, label, count, depth) {
  const li = document.createElement("li");
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.folder = key;
  button.style.paddingLeft = `${0.75 + depth * 1}rem`;
  button.setAttribute("aria-current", key === currentFolder ? "true" : "false");
  button.innerHTML = `<span class="folder-name"></span><span class="count"></span>`;
  button.querySelector(".folder-name").textContent = label;
  button.querySelector(".count").textContent = String(count);
  button.addEventListener("click", () => selectFolder(key));
  li.appendChild(button);
  return li;
}

function selectFolder(key) {
  currentFolder = key;
  renderFolders();
  applyView();
}

// ---- vista (carpeta + búsqueda) ----------------------------------------

function inCurrentFolder(song) {
  if (currentFolder === "all") return true;
  if (currentFolder === "none") return !song.folder_id;
  return song.folder_id === currentFolder;
}

function matchesQuery(song, query) {
  if (!query) return true;
  const haystack = [song.title, song.artist || "", (song.tags || []).join(" "), String(song.year || "")]
    .join(" ")
    .toLowerCase();
  return haystack.includes(query);
}

function applyView() {
  const query = $("search").value.trim().toLowerCase();
  visible = songs.filter((song) => inCurrentFolder(song) && matchesQuery(song, query));
  visible.sort((a, b) => a.title.localeCompare(b.title, "es"));
  current = visible.findIndex((song) => song.id === currentId);
  renderList();
  updateNowPlaying();
  const folderName =
    currentFolder === "all"
      ? "Todas las canciones"
      : currentFolder === "none"
        ? "Sin carpeta"
        : (folders.find((f) => f.id === currentFolder) || {}).name || "Carpeta";
  $("list-title").textContent = folderName;
  $("list-help").textContent = `${visible.length} ${visible.length === 1 ? "canción" : "canciones"}`;
  $("empty").hidden = visible.length > 0;
}

function renderList() {
  const list = $("song-list");
  list.innerHTML = "";
  visible.forEach((song, index) => {
    const li = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "song";
    button.setAttribute("aria-current", song.id === currentId ? "true" : "false");
    button.setAttribute("aria-label", `Reproducir ${song.title}`);

    const title = document.createElement("span");
    title.className = "song-title";
    title.textContent = song.title;

    const meta = document.createElement("span");
    meta.className = "song-meta";
    const parts = [song.artist, song.year, formatDuration(song.duration_s)].filter(Boolean);
    meta.textContent = parts.join(" · ");

    button.append(title, meta);
    button.addEventListener("click", () => play(index));
    li.appendChild(button);
    list.appendChild(li);
  });
}

// ---- reproducción -------------------------------------------------------

function updateNowPlaying() {
  const song = visible[current];
  if (!song) {
    $("now-title").textContent = "Elige una canción";
    $("now-meta").textContent = " ";
    $("now-count").textContent = " ";
    return;
  }
  $("now-title").textContent = song.title;
  const details = [song.artist, song.year].filter(Boolean).join(" · ");
  $("now-meta").textContent = details || " ";
  $("now-count").textContent = `Canción ${current + 1} de ${visible.length}`;
  $("time-total").textContent = formatDuration(song.duration_s);
  document.querySelectorAll("#song-list button").forEach((button, index) => {
    button.setAttribute("aria-current", index === current ? "true" : "false");
  });
}

function play(index) {
  if (index < 0 || index >= visible.length) return;
  current = index;
  currentId = visible[index].id;
  audio.src = visible[index].audio;
  updateNowPlaying();
  audio.play().catch(() => {
    $("status").textContent = "No se pudo reproducir. Pulsa Reproducir de nuevo.";
  });
}

function updateToggle() {
  const playing = !audio.paused && !audio.ended;
  $("toggle-icon").textContent = playing ? "⏸" : "▶";
  $("toggle-label").textContent = playing ? "Pausar" : "Reproducir";
  $("toggle").setAttribute("aria-label", playing ? "Pausar" : "Reproducir");
  $("toggle").setAttribute("aria-pressed", String(playing));
}

function togglePlayback() {
  if (current === -1) {
    play(0);
    return;
  }
  if (audio.paused) {
    audio.play().catch(() => {});
  } else {
    audio.pause();
  }
}

$("toggle").addEventListener("click", togglePlayback);
$("prev").addEventListener("click", () => play(Math.max(current - 1, 0)));
$("next").addEventListener("click", () => play(Math.min(current + 1, visible.length - 1)));

audio.addEventListener("play", updateToggle);
audio.addEventListener("pause", updateToggle);
audio.addEventListener("ended", () => {
  if (current < visible.length - 1) play(current + 1);
  else updateToggle();
});
audio.addEventListener("loadedmetadata", () => {
  $("seek").max = String(Math.floor(audio.duration || 0));
});
audio.addEventListener("timeupdate", () => {
  $("seek").value = String(Math.floor(audio.currentTime));
  $("time-now").textContent = formatDuration(audio.currentTime);
});
$("seek").addEventListener("input", () => {
  audio.currentTime = Number($("seek").value);
});

$("volume").addEventListener("input", () => {
  audio.volume = Number($("volume").value);
});
audio.volume = Number($("volume").value);

// Atajos: espacio para reproducir o pausar, flechas para cambiar de canción.
document.addEventListener("keydown", (event) => {
  if (event.target.matches("input, textarea, select")) return;
  if (event.code === "Space") {
    event.preventDefault();
    togglePlayback();
  } else if (event.code === "ArrowRight") {
    play(Math.min(current + 1, visible.length - 1));
  } else if (event.code === "ArrowLeft") {
    play(Math.max(current - 1, 0));
  }
});

$("search").addEventListener("input", applyView);

// ---- carga --------------------------------------------------------------

async function load() {
  try {
    const [songsResponse, foldersResponse] = await Promise.all([
      fetch("data/songs.json", { cache: "no-cache" }),
      fetch("data/folders.json", { cache: "no-cache" }).catch(() => null),
    ]);
    if (!songsResponse.ok) throw new Error(`HTTP ${songsResponse.status}`);
    songs = await songsResponse.json();
    folders = foldersResponse && foldersResponse.ok ? await foldersResponse.json() : [];

    if (songs.length === 0) {
      $("status").textContent = "La biblioteca está vacía.";
    } else {
      $("status").textContent = `${songs.length} canciones en ${folders.length} carpetas.`;
    }
    renderFolders();
    applyView();
  } catch (error) {
    $("status").textContent = "No se pudo cargar la biblioteca. Recarga la página.";
  }
}

load();
