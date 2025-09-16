const { upsertUser } = require("../config/db");

exports.loginSuccess = (req, res) => {
  if (!req.user) {
    return res.status(401).json({ ok: false, error: "Not authenticated" });
  }

  // Save/update user in our JSON DB
  const user = upsertUser({
    email: req.user.email,
    name: req.user.name,
    picture: req.user.picture,
  });

  res.json({ ok: true, user });
};

exports.logout = (req, res) => {
  req.logout(() => {
    req.session = null;
    res.json({ ok: true, message: "Logged out" });
  });
};
