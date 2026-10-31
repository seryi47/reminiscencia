// Acceso a la administración. Falla cerrada: sin ADMIN_PASSWORD en Vercel, nada se ejecuta.
const crypto = require("crypto");

function requireAdmin(req, res) {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) {
    res.status(503).json({
      error: "La administración está desactivada: falta la variable ADMIN_PASSWORD en Vercel.",
    });
    return false;
  }
  const given = Buffer.from(String(req.headers["x-admin-password"] || ""));
  const wanted = Buffer.from(expected);
  const ok = given.length === wanted.length && crypto.timingSafeEqual(given, wanted);
  if (!ok) {
    res.status(401).json({ error: "Contraseña incorrecta." });
    return false;
  }
  return true;
}

module.exports = { requireAdmin };
