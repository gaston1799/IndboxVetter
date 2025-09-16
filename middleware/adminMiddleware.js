// middleware/adminMiddleware.js
function requireAdmin(req, res, next) {
  const role = req.session?.user?.role;
  if (role !== "admin") {
    return res.status(403).json({ ok: false, error: "Admin only" });
  }
  next();
}

module.exports = { requireAdmin };
