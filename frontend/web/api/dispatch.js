const { requireAdmin } = require("../lib/auth");
const { dispatchLibrary } = require("../lib/github");
const { validateImport, validateOrganize, SONG_ID } = require("../lib/validate");

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido." });
  if (!requireAdmin(req, res)) return;

  const body = typeof req.body === "string" ? safeJson(req.body) : req.body;
  if (!body || typeof body !== "object") return res.status(400).json({ error: "Petición no válida." });

  let inputs;
  if (body.action === "import") {
    const problem = validateImport(body);
    if (problem) return res.status(422).json({ error: problem });
    inputs = {
      action: "import",
      url: body.url.trim(),
      license: String(body.license || "").trim(),
      title: String(body.title || "").trim(),
    };
  } else if (body.action === "publish") {
    if (!SONG_ID.test(String(body.song_id || ""))) return res.status(422).json({ error: "Canción no válida." });
    inputs = { action: "publish", song_id: body.song_id, public: body.public ? "true" : "false" };
  } else if (body.action === "organize") {
    const problem = validateOrganize(body.payload);
    if (problem) return res.status(422).json({ error: problem });
    inputs = { action: "organize", payload: JSON.stringify(body.payload) };
  } else {
    return res.status(422).json({ error: "Acción desconocida." });
  }

  try {
    await dispatchLibrary(inputs);
    return res.status(202).json({ queued: true, message: "En cola. Tarda 1-2 minutos en aplicarse." });
  } catch (error) {
    return res.status(502).json({ error: error.message });
  }
};

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
