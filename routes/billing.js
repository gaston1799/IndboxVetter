const express = require("express");
const router = express.Router();

const { requireAuth } = require("../middleware/authMiddleware");
const {
  getSubscription,
  updateSubscription,
} = require("../controllers/billingController");

router.get("/subscription", requireAuth, getSubscription);
router.post("/subscription", requireAuth, updateSubscription);

module.exports = router;
