// routes/admin.js
const express = require("express");
const router = express.Router();
const { requireAuth } = require("../middleware/authMiddleware");
const { requireAdmin } = require("../middleware/adminMiddleware");
const { getTransactions } = require("../config/db");
const { User, Transaction } = require("../models");

// Example: view recent transactions for any email
router.get("/transactions", requireAuth, requireAdmin, async (req, res) => {
  const email = req.query.email || req.session.user.email;
  const items = await Transaction.list(email, 200);
  res.json({ ok: true, items });
});

// Example: manual credit adjust
router.post("/credits/adjust", requireAuth, requireAdmin, async (req, res) => {
  const { email, delta } = req.body || {};
  if (!email || typeof delta !== "number") {
    return res.status(400).json({ ok:false, error: "email and numeric delta required" });
  }
  const newBal = await User.addCredits(email, delta);
  await Transaction.create({ email, amount: delta, type: "adjustment", meta: { by: req.session.user.email } });
  res.json({ ok:true, balance: newBal });
});

module.exports = router;
