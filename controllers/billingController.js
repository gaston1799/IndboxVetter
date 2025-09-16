const { addCredits, getCredits } = require("../config/db");

exports.getCredits = (req, res) => {
  const credits = getCredits(req.session.user.email);
  res.json({ ok: true, credits });
};

exports.addCredits = (req, res) => {
  const { amount } = req.body;
  if (!amount || amount <= 0) {
    return res.status(400).json({ ok: false, error: "Invalid amount" });
  }

  const credits = addCredits(req.session.user.email, amount);
  res.json({ ok: true, credits });
};
