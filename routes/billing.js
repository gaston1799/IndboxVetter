const express = require("express");
const router = express.Router();

const { requireAuth } = require("../middleware/authMiddleware");
const {
  getSubscription,
  updateSubscription,
  startCheckout,
} = require("../controllers/billingController");

router.get("/subscription", requireAuth, getSubscription);
router.post("/subscription", requireAuth, updateSubscription);
router.post("/checkout", requireAuth, startCheckout);

module.exports = router;
