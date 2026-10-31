// Reproductor de la biblioteca. Sin dependencias: lee data/songs.json y reproduce audio/<id>.opus.

const audio = document.getElementById("player");
const statusEl = document.getElementById("status");
const listEl = document.getElementById("list");
const titleEl = document.getElementById("now-title");
const metaEl = document.getElementById("now-meta");
const countEl = document.getElementById("now-count");
const toggleBtn = document.getElementById("toggle");
const toggleIcon = document.getElementById("toggle-icon");
const toggleLabel = document.getElementById("toggle-label");
const prevBtn = document.getElementById("prev");
const nextBtn = document.getElementById("next");
const volumeEl = document.getElementById("volume");

let songs = [];
let current = -1;

function formatDuration(seconds) {
  const total = Math.round(seconds);
  const minutes = Math.floor(total / 60);
  const rest = String(total % 60).padStart(2, "0");
  return `${minutes}:${rest}`;
}

function renderList() {
  listEl.innerHTML = "";
  songs.forEach((song, index) => {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.index = String(index);
    button.setAttribute("aria-current", index === current ? "true" : "false");
    button.innerHTML = `${song.title} <span class="duration">${formatDuration(song.duration_s)}</span>`;
    button.addEventListener("click", () => select(index, true));
    item.appendChild(button);
    listEl.appendChild(item);
  });
}

function updateNowPlaying() {
  const song = songs[current];
  if (!song) {
    titleEl.textContent = "Elige una canción";
    metaEl.textContent = " ";
    countEl.textContent = " ";
    return;
  }
  titleEl.textContent = song.title;
  metaEl.textContent = `Duración ${formatDuration(song.duration_s)}`;
  countEl.textContent = `Canción ${current + 1} de ${songs.length}`;
  listEl.querySelectorAll("button").forEach((button) => {
    button.setAttribute("aria-current", button.dataset.index === String(current) ? "true" : "false");
  });
}

function updateToggle() {
  const playing = !audio.paused && !audio.ended;
  toggleIcon.textContent = playing ? "⏸" : "▶";
  toggleLabel.textContent = playing ? "Pausar" : "Reproducir";
  toggleBtn.setAttribute("aria-label", playing ? "Pausar" : "Reproducir");
  toggleBtn.setAttribute("aria-pressed", String(playing));
}

function select(index, autoplay) {
  if (index < 0 || index >= songs.length) return;
  current = index;
  audio.src = songs[index].audio;
  updateNowPlaying();
  if (autoplay) {
    audio.play().catch(() => {
      statusEl.textContent = "No se pudo reproducir. Pulsa Reproducir de nuevo.";
    });
  }
}

toggleBtn.addEventListener("click", () => {
  if (current === -1) {
    select(0, true);
    return;
  }
  if (audio.paused) {
    audio.play().catch(() => {
      statusEl.textContent = "No se pudo reproducir. Pulsa Reproducir de nuevo.";
    });
  } else {
    audio.pause();
  }
});

prevBtn.addEventListener("click", () => select(Math.max(current - 1, 0), true));
nextBtn.addEventListener("click", () => select(Math.min(current + 1, songs.length - 1), true));

audio.addEventListener("play", updateToggle);
audio.addEventListener("pause", updateToggle);
audio.addEventListener("ended", () => {
  if (current < songs.length - 1) {
    select(current + 1, true);
  } else {
    updateToggle();
  }
});

volumeEl.addEventListener("input", () => {
  audio.volume = Number(volumeEl.value);
});
audio.volume = Number(volumeEl.value);

async function load() {
  try {
    const response = await fetch("data/songs.json", { cache: "no-cache" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    songs = await response.json();
    if (songs.length === 0) {
      statusEl.textContent = "La biblioteca está vacía.";
      return;
    }
    statusEl.textContent = `${songs.length} canciones disponibles.`;
    renderList();
    updateNowPlaying();
    updateToggle();
  } catch (error) {
    statusEl.textContent = "No se pudo cargar la biblioteca. Recarga la página.";
  }
}

load();
