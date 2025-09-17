const Stripe = require("stripe");
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const PAYMENT_METHOD_CONFIGURATION_ID =
  process.env.STRIPE_PMC_ID || process.env.STRIPE_PAYMENT_METHOD_CONFIGURATION_ID || null;

module.exports = { stripe, WEBHOOK_SECRET, PAYMENT_METHOD_CONFIGURATION_ID };
