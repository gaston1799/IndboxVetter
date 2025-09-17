const express = require("express");
const router = express.Router();

const { requireAuth } = require("../middleware/authMiddleware");
const {
  getSubscription,
  updateSubscription,
  startCheckout,
  createPortal,
  cancelAtPeriodEnd,
  startSupportCheckout,
} = require("../controllers/billingController");

router.get("/subscription", requireAuth, getSubscription);
router.post("/subscription", requireAuth, updateSubscription);
router.post("/checkout", requireAuth, startCheckout);
router.post("/portal", requireAuth, createPortal);
router.post("/cancel", requireAuth, cancelAtPeriodEnd);
router.post("/support", requireAuth, startSupportCheckout);

module.exports = router;
