// Llamadas a la API de GitHub con GITHUB_TOKEN (permiso mínimo: Actions y Contents de este repositorio).
const REPO = "seryi47/reminiscencia";
const WORKFLOW = "library.yml";
const API = `https://api.github.com/repos/${REPO}`;

function headers(extra = {}) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("Falta GITHUB_TOKEN en Vercel.");
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "reminiscencia-vercel",
    ...extra,
  };
}

async function readCatalog() {
  const response = await fetch(`${API}/contents/audio-library/indexes/catalog.json?ref=main`, {
    headers: headers({ Accept: "application/vnd.github.raw" }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`No se pudo leer el catálogo (GitHub ${response.status}).`);
  return JSON.parse(await response.text());
}

async function dispatchLibrary(inputs) {
  const response = await fetch(`${API}/actions/workflows/${WORKFLOW}/dispatches`, {
    method: "POST",
    headers: headers({ "Content-Type": "application/json" }),
    body: JSON.stringify({ ref: "main", inputs }),
  });
  if (response.status !== 204) {
    const detail = await response.text();
    throw new Error(`GitHub no aceptó el trabajo (${response.status}): ${detail.slice(0, 200)}`);
  }
}

async function recentRuns() {
  const response = await fetch(`${API}/actions/workflows/${WORKFLOW}/runs?per_page=6`, {
    headers: headers(),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`No se pudieron leer los trabajos (GitHub ${response.status}).`);
  const body = await response.json();
  return body.workflow_runs.map((run) => ({
    id: run.id,
    status: run.status,
    conclusion: run.conclusion,
    created_at: run.created_at,
    updated_at: run.updated_at,
    html_url: run.html_url,
    message: (run.head_commit && run.head_commit.message) || run.display_title || "",
  }));
}

module.exports = { readCatalog, dispatchLibrary, recentRuns, REPO };
