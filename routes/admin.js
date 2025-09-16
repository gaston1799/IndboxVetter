// routes/admin.js
const express = require("express");
const router = express.Router();
const { requireAuth } = require("../middleware/authMiddleware");
const { requireAdmin } = require("../middleware/adminMiddleware");
const { User } = require("../models");

// View subscriptions for all users
router.get("/subscriptions", requireAuth, requireAdmin, async (req, res) => {
  const users = await User.list();
  res.json({ ok: true, users });
});

// Update a user's subscription (admin override)
router.post("/subscriptions", requireAuth, requireAdmin, async (req, res) => {
  const { email, plan, status, seats, renewsAt } = req.body || {};
  if (!email) {
    return res.status(400).json({ ok: false, error: "email required" });
  }
  const subscription = await User.updateSubscription(email, {
    plan,
    status,
    seats,
    renewsAt,
  });
  if (!subscription) {
    return res.status(404).json({ ok: false, error: "User not found" });
  }
  res.json({ ok: true, subscription });
});

module.exports = router;
