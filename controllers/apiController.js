const {
  getSettings: getSettingsFromStore,
  updateSettings: updateSettingsInStore,
  getUser,
  listReports: listReportsFromStore,
  getReport: getReportFromStore,
  getVetterState,
} = require("../config/db");
const { runManualInbox } = require("../modules/inbox/orchestrator");

exports.getMe = (req, res) => {
  const email = req.session?.user?.email;
  if (!email) return res.status(401).json({ ok: false, error: "Not authenticated" });
  const user = getUser(email);
  if (!user) return res.status(404).json({ ok: false, error: "User not found" });
  res.json({ ok: true, user });
};

exports.listReports = (req, res) => {
  const email = req.session?.user?.email;
  if (!email) return res.status(401).json({ ok: false, error: "Not authenticated" });
  const reports = listReportsFromStore(email);
  res.json({ ok: true, reports });
};

exports.getReport = (req, res) => {
  const email = req.session?.user?.email;
  if (!email) return res.status(401).json({ ok: false, error: "Not authenticated" });
  const report = getReportFromStore(email, req.params.id);
  if (!report) return res.status(404).json({ ok: false, error: "Report not found" });
  res.json({ ok: true, report });
};

exports.getVetter = (req, res) => {
  const email = req.session?.user?.email;
  if (!email) return res.status(401).json({ ok: false, error: "Not authenticated" });
  const vetter = getVetterState(email);
  res.json({ ok: true, vetter });
};

exports.startVetter = async (req, res) => {
  const email = req.session?.user?.email;
  if (!email) return res.status(401).json({ ok: false, error: "Not authenticated" });

  try {
    const result = await runManualInbox(email);
    if (!result) {
      return res.status(500).json({ ok: false, error: "Failed to start InboxVetter" });
    }

    if (result.alreadyActive) {
      return res
        .status(409)
        .json({ ok: false, error: "InboxVetter is already running", vetter: result.vetter });
    }

    if (!result.ok) {
      const message =
        typeof result.error === "string"
          ? result.error
          : result.error?.message || "Failed to start InboxVetter";
      const status = message === "User not found" ? 404 : 500;
      return res.status(status).json({
        ok: false,
        error: message,
        vetter: result.vetter || null,
        events: result.events || [],
      });
    }

    return res.json({
      ok: true,
      vetter: result.vetter || null,
      events: result.events || [],
      report: result.report || null,
      stats: result.stats || null,
      descriptor: result.descriptor || null,
    });
  } catch (err) {
    const message = err?.message || "Failed to start InboxVetter";
    return res.status(500).json({ ok: false, error: message });
  }
};

exports.getSettings = (req, res) => {
  const email = req.session?.user?.email;
  if (!email) return res.status(401).json({ ok: false, error: "Not authenticated" });
  const settings = getSettingsFromStore(email);
  res.json({ ok: true, settings });
};

exports.updateSettings = (req, res) => {
  const email = req.session?.user?.email;
  if (!email) return res.status(401).json({ ok: false, error: "Not authenticated" });
  const settings = updateSettingsInStore(email, req.body || {});
  res.json({ ok: true, settings });
};


