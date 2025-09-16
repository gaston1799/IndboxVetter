const { upsertUser } = require("../config/db");

exports.loginSuccess = (req, res) => {
  if (!req.user) {
    return res.status(401).json({ ok: false, error: "Not authenticated" });
  }

  // Save/update user in our JSON DB
  upsertUser({
    email: req.user.email,
    name: req.user.name,
    credits: 0, // keep credits unchanged if user already exists
  });

  res.json({ ok: true, user: req.user });
};

exports.logout = (req, res) => {
  req.logout(() => {
    req.session = null;
    res.json({ ok: true, message: "Logged out" });
  });
};
