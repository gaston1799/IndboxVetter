const express = require("express");
const router = express.Router();

const { requireAuth } = require("../middleware/authMiddleware");
const { getCredits, addCredits } = require("../controllers/billingController");

// Get current credits
router.get("/credits", requireAuth, getCredits);

// Add credits manually (in production this is handled by the Stripe webhook)
router.post("/credits/add", requireAuth, addCredits);

module.exports = router;
