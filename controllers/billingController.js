const {
  getSubscription: getSubscriptionFromStore,
  updateSubscription: updateSubscriptionInStore,
  usesHouseOpenAIPlan,
} = require("../config/db");
const { stripe, WEBHOOK_SECRET } = require("../config/stripe");

function ensureEmail(req, res) {
  const email = req.session?.user?.email;
  if (!email) {
    res.status(401).json({ ok: false, error: "Not authenticated" });
    return null;
  }
  return email;
}

function formatSubscription(subscription) {
  if (!subscription) return subscription;
  return {
    ...subscription,
    usesHouseOpenAIKey: usesHouseOpenAIPlan(subscription.plan),
  };
}

exports.getSubscription = (req, res) => {
  const email = ensureEmail(req, res);
  if (!email) return;

  const subscription = getSubscriptionFromStore(email);
  res.json({ ok: true, subscription: formatSubscription(subscription) });
};

exports.updateSubscription = (req, res) => {
  const email = ensureEmail(req, res);
  if (!email) return;

  const updates = req.body || {};
  const subscription = updateSubscriptionInStore(email, updates);

  if (!subscription) {
    res.status(404).json({ ok: false, error: "User not found" });
    return;
  }

  res.json({ ok: true, subscription: formatSubscription(subscription) });
};

exports.handleStripeWebhook = (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, WEBHOOK_SECRET);
  } catch (err) {
    console.error("⚠️ Webhook signature verification failed.", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      const email = session.customer_email;
      const planFromMetadata =
        session.metadata?.plan || session.metadata?.planSlug || session.metadata?.tier;
      const plan = planFromMetadata || "basic";

      if (email) {
        const subscription = updateSubscriptionInStore(email, {
          plan,
          status: "active",
          stripeSubscriptionId: session.subscription,
        });
        console.log("✅ Subscription started for:", email, subscription);
      }
      break;
    }

    case "customer.subscription.deleted": {
      const subscription = event.data.object;
      const email = subscription.customer_email;

      if (email) {
        updateSubscriptionInStore(email, {
          plan: "basic",
          status: "canceled",
        });
        console.log("❌ Subscription canceled for:", email);
      }
      break;
    }

    case "invoice.payment_failed": {
      const subscription = event.data.object;
      console.log("⚠️ Payment failed for sub:", subscription.id);
      break;
    }

    default:
      console.log("ℹ️ Unhandled Stripe event:", event.type);
  }

  res.json({ received: true });
};
