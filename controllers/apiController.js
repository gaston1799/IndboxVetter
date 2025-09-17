const {
  getSettings: getSettingsFromStore,
  updateSettings: updateSettingsInStore,
  getUser,
  listReports: listReportsFromStore,
  getReport: getReportFromStore,
  getVetterState,
  startVetterRun,
} = require("../config/db");

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

exports.startVetter = (req, res) => {
  const email = req.session?.user?.email;
  if (!email) return res.status(401).json({ ok: false, error: "Not authenticated" });
  const result = startVetterRun(email);
  if (!result) {
    return res.status(404).json({ ok: false, error: "User not found" });
  }
  if (result.alreadyActive) {
    return res
      .status(409)
      .json({ ok: false, error: "InboxVetter is already running", vetter: result.vetter });
  }
  res.json({
    ok: true,
    vetter: result.vetter,
    events: result.events,
    report: result.report,
  });
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
