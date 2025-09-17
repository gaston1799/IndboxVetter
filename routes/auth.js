const express = require("express");
const router = express.Router();

const { verifyIdToken } = require("../config/google");
const User = require("../models/User");

// Sign-in with Google Identity Services (POSTed ID token)
router.post("/google", async (req, res) => {
  try {
    const idToken = req.body?.credential;
    if (!idToken) return res.status(400).json({ ok: false, error: "Missing credential" });

    const p = await verifyIdToken(idToken); // { sub, email, name, picture, exp }
    const user = await User.findOrCreate({ id: p.sub, email: p.email, name: p.name, picture: p.picture });

    req.session.user = {
      email: user.email,
      name: user.name,
      picture: user.picture,
      role: user.role,
    };
    res.json({ ok: true, user });
  } catch (e) {
    res.status(401).json({ ok: false, error: e.message });
  }
});

// keep /auth/me returning role too
router.get("/me", (req, res) => {
  if (!req.session?.user) return res.status(401).json({ ok: false });
  res.json({ ok: true, user: req.session.user });
});

// Logout
router.post("/logout", (req, res) => {
  req.session = null;
  res.json({ ok: true });
});

module.exports = router;

