const express = require("express");
const router = express.Router();

const { requireAuth } = require("../middleware/authMiddleware");
const {
  getSubscription,
  updateSubscription,
  startCheckout,
  startSupportCheckout,
} = require("../controllers/billingController");

router.get("/subscription", requireAuth, getSubscription);
router.post("/subscription", requireAuth, updateSubscription);
router.post("/checkout", requireAuth, startCheckout);
router.post("/support", requireAuth, startSupportCheckout);

module.exports = router;
