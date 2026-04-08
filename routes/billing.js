const express = require("express");
const router = express.Router();

const { requireAuth } = require("../middleware/authMiddleware");
const { billingWriteLimiter } = require("../middleware/rateLimiters");
const {
  getSubscription,
  updateSubscription,
  startCheckout,
  createPortal,
  cancelAtPeriodEnd,
  startSupportCheckout,
} = require("../controllers/billingController");

router.get("/subscription", requireAuth, getSubscription);
router.post("/subscription", requireAuth, billingWriteLimiter, updateSubscription);
router.post("/checkout", requireAuth, billingWriteLimiter, startCheckout);
router.post("/portal", requireAuth, billingWriteLimiter, createPortal);
router.post("/cancel", requireAuth, billingWriteLimiter, cancelAtPeriodEnd);
router.post("/support", requireAuth, billingWriteLimiter, startSupportCheckout);

module.exports = router;
