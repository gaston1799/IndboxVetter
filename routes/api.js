const express = require("express");
const router = express.Router();

const { requireAuth } = require("../middleware/authMiddleware");
const { getSettings, updateSettings } = require("../controllers/apiController");

// Get user's settings (stored in session for now)
router.get("/settings", requireAuth, getSettings);

// Update user's settings
router.post("/settings", requireAuth, updateSettings);

module.exports = router;
