const {
  getSubscription: getSubscriptionFromStore,
  updateSubscription: updateSubscriptionInStore,
} = require("../config/db");

exports.getSubscription = (req, res) => {
  const email = req.session?.user?.email;
  if (!email) return res.status(401).json({ ok: false, error: "Not authenticated" });
  const subscription = getSubscriptionFromStore(email);
  res.json({ ok: true, subscription });
};

exports.updateSubscription = (req, res) => {
  const email = req.session?.user?.email;
  if (!email) return res.status(401).json({ ok: false, error: "Not authenticated" });

  const subscription = updateSubscriptionInStore(email, req.body || {});
  if (!subscription) {
    return res.status(404).json({ ok: false, error: "User not found" });
  }

  if (req.session.user) {
    req.session.user.plan = subscription.plan;
    req.session.user.subscription = subscription;
  }

  res.json({ ok: true, subscription });
};
