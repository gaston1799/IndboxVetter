const express = require("express");
const router = express.Router();

const { requireAuth } = require("../middleware/authMiddleware");
const { settingsWriteLimiter, inboxRunLimiter } = require("../middleware/rateLimiters");
const {
  getMe,
  getSettings,
  updateSettings,
  updateTimezone,
  listReports,
  getReport,
  getVetter,
  startVetter,
  getDevInfo,
} = require("../controllers/apiController");

router.get("/me", requireAuth, getMe);
router.get("/reports", requireAuth, listReports);
router.get("/reports/:id", requireAuth, getReport);
router.get("/vetter", requireAuth, getVetter);
router.post("/vetter/start", requireAuth, inboxRunLimiter, startVetter);
router.get("/settings", requireAuth, getSettings);
router.post("/settings", requireAuth, settingsWriteLimiter, updateSettings);
router.post("/timezone", requireAuth, settingsWriteLimiter, updateTimezone);
router.get("/devinfo", requireAuth, getDevInfo);

module.exports = router;
