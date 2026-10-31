const { requireAdmin } = require("../lib/auth");
const { readCatalog } = require("../lib/github");

module.exports = async (req, res) => {
  if (req.method !== "GET") return res.status(405).json({ error: "Método no permitido." });
  if (!requireAdmin(req, res)) return;
  try {
    const catalog = await readCatalog();
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json(catalog);
  } catch (error) {
    return res.status(502).json({ error: error.message });
  }
};
