const express = require("express");
const router = express.Router();

const { requireAuth } = require("../middleware/authMiddleware");
const {
  getMe,
  getSettings,
  updateSettings,
  listReports,
  getReport,
} = require("../controllers/apiController");

router.get("/me", requireAuth, getMe);
router.get("/reports", requireAuth, listReports);
router.get("/reports/:id", requireAuth, getReport);
router.get("/settings", requireAuth, getSettings);
router.post("/settings", requireAuth, updateSettings);

module.exports = router;
