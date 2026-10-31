// Panel local de administración. Habla con la API de backend/sonidos/api.py.

const $ = (id) => document.getElementById(id);

let allSongs = [];

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

function formatDuration(seconds) {
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function setMessage(el, text, kind) {
  el.textContent = text;
  el.className = `message ${kind || ""}`;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = typeof body.detail === "string" ? body.detail : `Error ${response.status}`;
    throw new Error(detail);
  }
  return body;
}

async function loadStats() {
  const stats = await api("/api/stats");
  $("stat-songs").textContent = String(stats.songs);
  $("stat-original").textContent = formatBytes(stats.original_bytes);
  $("stat-variants").textContent = formatBytes(stats.variant_bytes);
}

function renderSongs() {
  const query = $("search").value.trim().toLowerCase();
  const rows = allSongs.filter((song) =>
    [song.title, song.source, song.license].join(" ").toLowerCase().includes(query)
  );
  const body = $("songs");
  body.innerHTML = "";
  rows.forEach((song) => {
    const tr = document.createElement("tr");
    const cells = [
      song.title,
      song.source,
      formatDuration(song.duration_s),
      song.variants.length ? song.variants.join(", ") : "sin versión de reproducción",
      song.license,
    ];
    cells.forEach((value, index) => {
      const td = document.createElement("td");
      td.textContent = value;
      if (index === 2) td.className = "num-cell";
      if (index === 4) td.className = "license";
      tr.appendChild(td);
    });
    body.appendChild(tr);
  });
  $("empty").hidden = rows.length > 0;
}

async function loadSongs() {
  allSongs = await api("/api/songs");
  renderSongs();
}

async function refresh() {
  await Promise.all([loadStats(), loadSongs()]);
}

$("intake-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = $("intake-message");
  const submit = $("intake-submit");
  const url = $("url").value.trim();
  if (!url) {
    setMessage(message, "Escribe una dirección.", "error");
    return;
  }
  const payload = { url };
  const license = $("license").value.trim();
  const title = $("title").value.trim();
  if (license) payload.license = license;
  if (title) payload.title = title;

  submit.disabled = true;
  setMessage(message, "Descargando e importando… puede tardar unos segundos.", "");
  try {
    const result = await api("/api/intake", { method: "POST", body: JSON.stringify(payload) });
    const state = result.created ? "importada" : "ya estaba en la biblioteca";
    setMessage(message, `Canción ${state} (${result.song_id}). Licencia: ${result.license}`, "ok");
    $("url").value = "";
    await refresh();
  } catch (error) {
    setMessage(message, error.message, "error");
  } finally {
    submit.disabled = false;
  }
});

$("publish").addEventListener("click", async () => {
  const message = $("publish-message");
  const button = $("publish");
  button.disabled = true;
  setMessage(message, "Preparando la web…", "");
  try {
    const result = await api("/api/publish-web", { method: "POST" });
    setMessage(
      message,
      `Preparadas ${result.published} pistas en frontend/web. Para publicarlas, despliega la web en Vercel.`,
      "ok"
    );
  } catch (error) {
    setMessage(message, error.message, "error");
  } finally {
    button.disabled = false;
  }
});

$("search").addEventListener("input", renderSongs);

refresh().catch((error) => {
  setMessage($("intake-message"), `No se pudo cargar la biblioteca: ${error.message}`, "error");
});
