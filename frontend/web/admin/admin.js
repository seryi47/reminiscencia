// Administración de la biblioteca. Habla con /api/* (funciones de Vercel) que disparan el workflow
// library.yml en GitHub Actions: los cambios se aplican en 1-2 minutos y la web se redespliega sola.

const $ = (id) => document.getElementById(id);
const KEY = "reminiscencia.admin";
const COUNTABLE_BLOCKED = ["youtube.com", "youtu.be", "spotify.com", "soundcloud.com", "vimeo.com", "tiktok.com", "instagram.com", "facebook.com", "bandcamp.com"];

let password = sessionStorage.getItem(KEY) || "";
let catalog = { folders: [], songs: [] };
let filterFolder = "all";
let busy = false;
let pendingPoll = null;

// ---------- red ----------

async function api(path, { method = "GET", body } = {}) {
  const response = await fetch(path, {
    method,
    headers: { "x-admin-password": password, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || `Error ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

// ---------- utilidades ----------

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
const esc = (text) => String(text ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const folderName = (id) => (catalog.folders.find((f) => f.id === id) || {}).name || "";

function toast(text, kind = "") {
  const el = $("toast");
  el.textContent = text;
  el.className = `toast ${kind}`;
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (el.hidden = true), 4200);
}

function setHint(text, kind = "") {
  const el = $("add-message");
  el.textContent = text;
  el.className = `hint ${kind}`;
}

// ---------- acceso ----------

function showApp() {
  $("gate").hidden = true;
  $("admin").hidden = false;
  loadAll();
}

function showGate(message = "") {
  $("admin").hidden = true;
  $("gate").hidden = false;
  $("gate-message").textContent = message;
  $("password").focus();
}

$("gate-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const typed = $("password").value;
  if (!typed) return showGate("Escribe la contraseña.");
  password = typed;
  $("gate-submit").disabled = true;
  try {
    catalog = await api("/api/catalog");
    sessionStorage.setItem(KEY, password);
    $("password").value = "";
    showApp();
  } catch (error) {
    password = "";
    showGate(error.status === 503
      ? "La administración no está activa todavía: falta configurar ADMIN_PASSWORD en Vercel (Settings → Environment Variables)."
      : error.message);
  } finally {
    $("gate-submit").disabled = false;
  }
});

$("logout").addEventListener("click", () => {
  password = "";
  sessionStorage.removeItem(KEY);
  showGate();
});

// ---------- carga ----------

async function loadAll() {
  try {
    catalog = await api("/api/catalog");
    render();
    refreshJobs();
  } catch (error) {
    if (error.status === 401 || error.status === 503) return showGate(error.message);
    toast(error.message, "bad");
  }
}

$("reload").addEventListener("click", loadAll);

// ---------- render ----------

function render() {
  renderTree();
  renderFolderSelects();
  renderRows();
}

function renderTree() {
  const tree = $("tree");
  tree.innerHTML = "";
  const walk = (parentId, depth) => {
    catalog.folders
      .filter((f) => (f.parent_id || null) === parentId)
      .sort((a, b) => a.name.localeCompare(b.name, "es"))
      .forEach((f) => {
        const row = document.createElement("li");
        row.className = "tree-row";
        row.style.paddingLeft = `${depth * 12}px`;
        row.innerHTML = `<button class="tree-item" type="button" data-folder="${esc(f.id)}" aria-current="${filterFolder === f.id}">
            <span>${esc(f.name)}</span><span class="count" data-count="${esc(f.id)}"></span></button>
          <button class="btn btn-ghost btn-icon more" type="button" data-manage="${esc(f.id)}" aria-label="Opciones de ${esc(f.name)}">⋯</button>`;
        tree.appendChild(row);
        walk(f.id, depth + 1);
      });
  };
  walk(null, 0);

  document.querySelectorAll("[data-folder]").forEach((button) => {
    button.setAttribute("aria-current", String(button.dataset.folder === filterFolder));
  });
  document.querySelector('[data-count="all"]').textContent = catalog.songs.length;
  document.querySelector('[data-count="none"]').textContent = catalog.songs.filter((s) => !s.folder_id).length;
  tree.querySelectorAll("[data-count]").forEach((el) => {
    el.textContent = catalog.songs.filter((s) => s.folder_id === el.dataset.count).length;
  });
}

function renderFolderSelects() {
  const options = (selected, withNone) => {
    const list = withNone ? [`<option value="">Sin carpeta</option>`] : [`<option value="">Ninguna (raíz)</option>`];
    catalog.folders
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name, "es"))
      .forEach((f) => list.push(`<option value="${esc(f.id)}" ${f.id === selected ? "selected" : ""}>${esc(f.name)}</option>`));
    return list.join("");
  };
  $("folder-parent").innerHTML = options("", false);
  $("edit-folder").innerHTML = options($("edit-folder").value || "", true);
}

function renderRows() {
  const query = $("search").value.trim().toLowerCase();
  const filter = $("filter").value;
  const rows = catalog.songs
    .filter((s) => filterFolder === "all" || (filterFolder === "none" ? !s.folder_id : s.folder_id === filterFolder))
    .filter((s) => filter === "all" || (filter === "public" ? s.public : !s.public))
    .filter((s) => !query || [s.title, s.artist, (s.tags || []).join(" ")].join(" ").toLowerCase().includes(query))
    .sort((a, b) => a.title.localeCompare(b.title, "es"));

  const body = $("rows");
  body.innerHTML = rows.map((s) => `
    <tr data-id="${esc(s.id)}">
      <td><div class="title-cell">
        <span class="art" style="width:30px;height:30px;${artStyle(s.id)}" aria-hidden="true"></span>
        <div class="meta"><div class="name">${esc(s.title)}</div>
          <div class="sub">${esc([s.artist, s.year].filter(Boolean).join(" · ") || s.source)}</div></div>
      </div></td>
      <td class="muted">${esc(folderName(s.folder_id) || "—")}</td>
      <td class="num">${fmt(s.duration_s)}</td>
      <td><span class="lic" title="${esc(s.license)}">${esc(s.license)}</span></td>
      <td>
        <label class="switch" title="${s.public ? "Publicada" : "Privada"}">
          <input type="checkbox" data-public="${esc(s.id)}" ${s.public ? "checked" : ""} aria-label="Publicar ${esc(s.title)}">
          <span></span>
        </label>
      </td>
      <td><button class="btn" type="button" data-edit="${esc(s.id)}">Editar</button></td>
    </tr>`).join("");

  $("empty").hidden = rows.length > 0;
  const total = catalog.songs.length;
  const pub = catalog.songs.filter((s) => s.public).length;
  $("lib-count").textContent = `${total} canciones · ${pub} públicas · ${total - pub} privadas`;
}

$("search").addEventListener("input", renderRows);
$("filter").addEventListener("change", renderRows);

document.addEventListener("click", (event) => {
  const folderBtn = event.target.closest("[data-folder]");
  if (folderBtn) {
    filterFolder = folderBtn.dataset.folder;
    render();
    return;
  }
  const manage = event.target.closest("[data-manage]");
  if (manage) {
    manageFolder(manage.dataset.manage);
    return;
  }
  const edit = event.target.closest("[data-edit]");
  if (edit) openEditor(edit.dataset.edit);
});

// ---------- publicar / despublicar ----------

$("rows").addEventListener("change", (event) => {
  const box = event.target.closest("[data-public]");
  if (!box) return;
  const song = catalog.songs.find((s) => s.id === box.dataset.public);
  const wanted = box.checked;
  if (!song) return;
  if (wanted && !confirm(`¿Publicar «${song.title}» en la web pública?`)) {
    box.checked = !wanted;
    return;
  }
  write({ action: "publish", song_id: song.id, public: wanted }, wanted ? "Publicando…" : "Quitando de la web…");
});

// ---------- importar ----------

$("url").addEventListener("input", () => {
  const value = $("url").value.trim().toLowerCase();
  const direct = /\.(mp3|flac|ogg|opus|m4a|wav)(\?|$)/.test(value) && !value.includes("archive.org");
  $("license-field").hidden = !direct;
});

$("add-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const url = $("url").value.trim();
  const problem = clientProblem(url);
  if (problem) return setHint(problem, "bad");
  const body = { action: "import", url, license: $("license").value.trim(), title: $("title").value.trim() };
  $("add-submit").disabled = true;
  setHint("Enviando…");
  try {
    await api("/api/dispatch", { method: "POST", body });
    setHint("En cola. Se descarga y convierte en GitHub (1-3 minutos). Aparecerá en la biblioteca cuando termine.", "ok");
    $("url").value = "";
    $("title").value = "";
    $("license").value = "";
    $("license-field").hidden = true;
    followWork("Importando…");
  } catch (error) {
    setHint(error.message, "bad");
  } finally {
    $("add-submit").disabled = false;
  }
});

function clientProblem(url) {
  if (!url) return "Pega una dirección.";
  let parsed;
  try { parsed = new URL(url); } catch { return "La dirección no es válida."; }
  if (!["http:", "https:"].includes(parsed.protocol)) return "La dirección debe empezar por https://";
  const host = parsed.hostname.replace(/^www\./, "");
  if (COUNTABLE_BLOCKED.some((b) => host === b || host.endsWith("." + b))) {
    return "Esa plataforma no se puede importar: sus condiciones no permiten descargar el contenido.";
  }
  return null;
}

// ---------- escrituras al catálogo (vía GitHub Actions) ----------

async function write(body, label) {
  if (busy) return toast("Espera a que termine la operación anterior.", "bad");
  try {
    await api("/api/dispatch", { method: "POST", body });
    toast(`${label} Tarda 1-2 minutos.`, "ok");
    followWork(label);
  } catch (error) {
    toast(error.message, "bad");
    await loadAll();
  }
}

// Espera a que el último trabajo termine y recarga el catálogo.
function followWork(label) {
  busy = true;
  clearInterval(pendingPoll);
  let ticks = 0;
  pendingPoll = setInterval(async () => {
    ticks += 1;
    try {
      const runs = await api("/api/runs");
      const latest = runs[0];
      renderJobs(runs);
      if (latest && latest.status === "completed") {
        clearInterval(pendingPoll);
        busy = false;
        if (latest.conclusion === "success") {
          await loadAll();
          toast(`Listo: ${label.replace("…", "")}`, "ok");
        } else {
          toast("El trabajo falló. Revisa «Trabajos recientes».", "bad");
          await loadAll();
        }
      }
    } catch (error) {
      clearInterval(pendingPoll);
      busy = false;
      toast(error.message, "bad");
    }
    if (ticks > 60) {
      clearInterval(pendingPoll);
      busy = false;
      toast("Sigue en curso. Pulsa «Recargar» más tarde.");
    }
  }, 6000);
}

// ---------- trabajos recientes ----------

function renderJobs(runs) {
  const list = $("jobs");
  if (!runs.length) {
    list.innerHTML = `<li><span class="muted">Todavía no hay trabajos.</span></li>`;
    $("job-pill").textContent = "Sin trabajos recientes";
    return;
  }
  list.innerHTML = runs.map((r) => {
    const state = r.status !== "completed" ? ["En curso", "badge-warn"]
      : r.conclusion === "success" ? ["Aplicado", "badge-ok"] : ["Fallido", "badge-bad"];
    return `<li>
      <span class="badge ${state[1]}">${state[0]}</span>
      <a class="msg" href="${esc(r.html_url)}" target="_blank" rel="noopener">${esc(r.message || "Trabajo")}</a>
      <time datetime="${esc(r.created_at)}">${new Date(r.created_at).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" })}</time>
    </li>`;
  }).join("");
  const last = runs[0];
  $("job-pill").textContent = last.status !== "completed" ? "Trabajo en curso…"
    : last.conclusion === "success" ? "Último trabajo aplicado" : "Último trabajo fallido";
}

async function refreshJobs() {
  try { renderJobs(await api("/api/runs")); } catch (error) { /* se muestra en la siguiente recarga */ }
}
$("refresh-jobs").addEventListener("click", refreshJobs);

// ---------- editor ----------

function openEditor(id) {
  const s = catalog.songs.find((x) => x.id === id);
  if (!s) return;
  $("edit-id").value = s.id;
  $("edit-title").value = s.title;
  $("edit-artist").value = s.artist || "";
  $("edit-year").value = s.year || "";
  $("edit-tags").value = (s.tags || []).join(", ");
  $("edit-folder").value = s.folder_id || "";
  $("edit-public").checked = !!s.public;
  $("drawer-title").textContent = s.title;
  $("edit-facts").innerHTML = `
    <dt>Identificador</dt><dd>${esc(s.id)}</dd>
    <dt>Origen</dt><dd>${esc(s.source)}</dd>
    <dt>Licencia</dt><dd>${esc(s.license)}</dd>
    <dt>Añadida</dt><dd>${esc(new Date(s.added_at).toLocaleString("es-ES"))}</dd>`;
  $("drawer").hidden = false;
  $("scrim").hidden = false;
  $("edit-title").focus();
}

function closeEditor() {
  $("drawer").hidden = true;
  $("scrim").hidden = true;
}
$("drawer-close").addEventListener("click", closeEditor);
$("edit-cancel").addEventListener("click", closeEditor);
$("scrim").addEventListener("click", closeEditor);
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("drawer").hidden) closeEditor(); });

$("edit-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const id = $("edit-id").value;
  const s = catalog.songs.find((x) => x.id === id);
  if (!s) return;
  const payload = { op: "edit_song", song_id: id };
  const title = $("edit-title").value.trim();
  if (!title) return toast("El título no puede estar vacío.", "bad");
  if (title !== s.title) payload.title = title;
  const artist = $("edit-artist").value.trim();
  if (artist !== (s.artist || "")) payload.artist = artist;
  const year = $("edit-year").value.trim();
  if (year !== String(s.year || "")) payload.year = year ? Number(year) : null;
  const tags = $("edit-tags").value.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
  if (tags.join(",") !== (s.tags || []).join(",")) payload.tags = tags;
  const folder = $("edit-folder").value;
  if (folder !== (s.folder_id || "")) payload.folder_id = folder || null;
  if ($("edit-public").checked !== !!s.public) payload.public = $("edit-public").checked;
  if (Object.keys(payload).length === 2) return closeEditor();
  closeEditor();
  write({ action: "organize", payload }, "Guardando cambios…");
});

// ---------- carpetas ----------

$("new-folder-btn").addEventListener("click", () => {
  const form = $("new-folder");
  form.hidden = !form.hidden;
  if (!form.hidden) $("folder-name").focus();
});
$("folder-cancel").addEventListener("click", () => { $("new-folder").hidden = true; });
$("new-folder").addEventListener("submit", (event) => {
  event.preventDefault();
  const name = $("folder-name").value.trim();
  if (!name) return toast("Escribe un nombre para la carpeta.", "bad");
  const parent = $("folder-parent").value || null;
  $("new-folder").hidden = true;
  $("folder-name").value = "";
  write({ action: "organize", payload: { op: "create_folder", name, parent_id: parent } }, "Creando carpeta…");
});

function manageFolder(id) {
  const f = catalog.folders.find((x) => x.id === id);
  if (!f) return;
  const choice = prompt(`«${f.name}»\n\nEscribe:\n  r  para renombrar\n  b  para borrar (sus canciones pasan a la carpeta superior)`, "");
  if (choice === "r") {
    const name = prompt("Nuevo nombre", f.name);
    if (name && name.trim() && name.trim() !== f.name) write({ action: "organize", payload: { op: "rename_folder", folder_id: id, name: name.trim() } }, "Renombrando…");
  } else if (choice === "b" && confirm(`¿Borrar la carpeta «${f.name}»? Sus canciones no se borran.`)) {
    if (filterFolder === id) filterFolder = "all";
    write({ action: "organize", payload: { op: "delete_folder", folder_id: id } }, "Borrando carpeta…");
  }
}

// ---------- arranque ----------

if (password) {
  api("/api/catalog").then((c) => { catalog = c; showApp(); }).catch(() => showGate());
} else {
  showGate();
}
