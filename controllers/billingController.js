const express = require("express");
const router = express.Router();
const { stripe, WEBHOOK_SECRET } = require("../config/stripe");
const { updateSubscription: updateSubscriptionInStore } = require("../config/db");

// Stripe webhook route
router.post("/webhook", express.raw({ type: "application/json" }), (req, res) => {
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

      // Mark the user as PRO in DB
      if (email) {
        const subscription = updateSubscriptionInStore(email, {
          plan: "pro",
          status: "active",
          stripeSubscriptionId: session.subscription,
        });
        console.log("✅ Subscription started for:", email, subscription);
      }
      break;
    }

    case "customer.subscription.deleted": {
      const subscription = event.data.object;
      const email = subscription.customer_email; // may need lookup by customer ID
      if (email) {
        updateSubscriptionInStore(email, {
          plan: "free",
          status: "canceled",
        });
        console.log("❌ Subscription canceled for:", email);
      }
      break;
    }

    case "invoice.payment_failed": {
      const subscription = event.data.object;
      console.log("⚠️ Payment failed for sub:", subscription.id);
      // (Optional: downgrade or warn user if payment fails)
      break;
    }
  }

  res.json({ received: true });
});

module.exports = router;
