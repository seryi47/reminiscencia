const { requireAdmin } = require("../lib/auth");
const { recentRuns } = require("../lib/github");

module.exports = async (req, res) => {
  if (req.method !== "GET") return res.status(405).json({ error: "Método no permitido." });
  if (!requireAdmin(req, res)) return;
  try {
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json(await recentRuns());
  } catch (error) {
    return res.status(502).json({ error: error.message });
  }
};
