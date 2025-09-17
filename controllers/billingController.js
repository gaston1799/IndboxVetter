const {
  getSubscription: getSubscriptionFromStore,
  updateSubscription: updateSubscriptionInStore,
} = require("../config/db");
const { stripe, WEBHOOK_SECRET, PAYMENT_METHOD_CONFIGURATION_ID } = require("../config/stripe");
const PRICE_BASIC = process.env.STRIPE_PRICE_ID;
const PRICE_PRO = process.env.STRIPE_PRICE_ID_PREMIUM;
const DONATION_PRODUCT_NAME = "Support InboxVetter";

function ensureEmail(req, res) {
  const email = req.session?.user?.email;
  if (!email) {
    res.status(401).json({ ok: false, error: "Not authenticated" });
    return null;
  }
  return email;
}

exports.getSubscription = (req, res) => {
  const email = ensureEmail(req, res);
  if (!email) return;

  const subscription = getSubscriptionFromStore(email);
  res.json({ ok: true, subscription });
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

  res.json({ ok: true, subscription });
};

exports.startCheckout = async (req, res) => {
  const email = ensureEmail(req, res);
  if (!email) return;

  try {
    const plan = (req.body?.plan || '').toLowerCase();
    const price = plan === 'pro' ? PRICE_PRO : PRICE_BASIC;
    if (!price) return res.status(400).json({ ok: false, error: 'Price not configured' });

    const params = {
      mode: 'subscription',
      customer_email: email,
      line_items: [{ price, quantity: 1 }],
      success_url: `${req.protocol}://${req.get('host')}/settings.html?success=1`,
      cancel_url: `${req.protocol}://${req.get('host')}/settings.html?canceled=1`,
    };
    // Prefer explicit Payment Method Configuration if provided; else fall back to 'card'
    if (PAYMENT_METHOD_CONFIGURATION_ID) {
      params.payment_method_configuration = PAYMENT_METHOD_CONFIGURATION_ID;
    } else {
      params.payment_method_types = ['card'];
    }

    const session = await stripe.checkout.sessions.create(params);

    res.json({ ok: true, url: session.url, id: session.id });
  } catch (err) {
    console.error('Checkout error:', err.code, err.message);
    res.status(500).json({ ok: false, error: err.message, code: err.code });
  }
};

exports.startSupportCheckout = async (req, res) => {
  const email = ensureEmail(req, res);
  if (!email) return;

  const rawAmount = req.body?.amount;
  const amountNumber = typeof rawAmount === "string" ? parseFloat(rawAmount) : Number(rawAmount);
  const amountInCents = Math.round((amountNumber || 0) * 100);

  if (!Number.isFinite(amountNumber) || amountInCents < 100) {
    return res.status(400).json({
      ok: false,
      error: "Donation amount must be at least $1",
    });
  }

  if (amountInCents > 1000000) {
    return res.status(400).json({
      ok: false,
      error: "Donation amount is too large",
    });
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      customer_email: email,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: amountInCents,
            product_data: {
              name: DONATION_PRODUCT_NAME,
            },
          },
        },
      ],
      metadata: {
        email,
        type: "donation",
        amount_cents: amountInCents.toString(),
      },
      success_url: `${req.protocol}://${req.get("host")}/supportme.html?success=1`,
      cancel_url: `${req.protocol}://${req.get("host")}/supportme.html?canceled=1`,
    });

    res.json({ ok: true, url: session.url, id: session.id });
  } catch (err) {
    console.error("Support checkout error:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
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
      const email = subscription.customer_email;

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
      break;
    }

    default:
      console.log("ℹ️ Unhandled Stripe event:", event.type);
  }

  res.json({ received: true });
};
