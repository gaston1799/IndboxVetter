"use strict";
require("dotenv").config();

const os = require("os");
const path = require("path");
const express = require("express");
const cookieSession = require("cookie-session");
const sessionMiddleware = require("./middleware/authMiddleware");
const errorHandler = require("./middleware/errorHandler");
const { handleStripeWebhook } = require("./controllers/billingController");

const app = express();
const PORT = process.env.PORT || 5173;
const HOST = process.env.HOST || "0.0.0.0";
const SESSION_SECRET = process.env.SESSION_SECRET || "dev-secret";

// ───────────────────────────────────────────────────────────────────────────────
// core middleware
// ───────────────────────────────────────────────────────────────────────────────
app.post(
  "/billing/webhook",
  express.raw({ type: "application/json" }),
  handleStripeWebhook
);

app.use(express.json({ limit: "1mb" }));
app.use(
  cookieSession({
    name: "iv.session",
    keys: [SESSION_SECRET],
    maxAge: 24 * 60 * 60 * 1000, // 1 day
    sameSite: "lax",
    // secure: process.env.NODE_ENV === "production", // uncomment for HTTPS-only cookies in prod
  })
);

// NOTE: DO NOT gate everything globally. We will attach requireAuth per-route.
// app.use(sessionMiddleware.requireAuth);

// Expose safe public config
app.get("/config.js", (_, res) => {
  res
    .type("js")
    .send(
      `window.INBOXVETTER_CONFIG = { GOOGLE_CLIENT_ID: ${JSON.stringify(
        process.env.GOOGLE_CLIENT_ID || ""
      )} };`
    );
});

// ───────────────────────────────────────────────────────────────────────────────
// static files (public assets and HTML)
// ───────────────────────────────────────────────────────────────────────────────
const PUB = path.join(__dirname, "public");
app.use(express.static(PUB));

// Public pages (no auth)
app.get(["/", "/login", "/login.html"], (_, res) =>
  res.sendFile(path.join(PUB, "login.html"))
);
app.get(["/policy", "/policy.html"], (_, res) =>
  res.sendFile(path.join(PUB, "policy.html"))
);
app.get(["/tos", "/terms", "/tos.html"], (_, res) =>
  res.sendFile(path.join(PUB, "tos.html"))
);
app.get(["/setup", "/setup.html"], (_, res) =>
  res.redirect(301, "/settings.html")
);
app.get(["/checkout", "/checkout.html"], (_, res) =>
  res.sendFile(path.join(PUB, "checkout.html"))
);
app.get(["/devtest", "/devtest.html"], (_, res) =>
  res.sendFile(path.join(PUB, "devtest.html"))
);

// Protected pages (must be logged in)
app.get(["/dashboard", "/dashboard.html"], sessionMiddleware.requireAuth, (_, res) =>
  res.sendFile(path.join(PUB, "dashboard.html"))
);
app.get(["/settings", "/settings.html"], sessionMiddleware.requireAuth, (_, res) =>
  res.sendFile(path.join(PUB, "settings.html"))
);
app.get(["/supportme", "/supportme.html"], sessionMiddleware.requireAuth, (_, res) =>
  res.sendFile(path.join(PUB, "supportme.html"))
);

// ───────────────────────────────────────────────────────────────────────────────
// routes
// ───────────────────────────────────────────────────────────────────────────────
app.use("/auth", require("./routes/auth")); // login/logout/google callbacks should be public

// Protect these route trees
app.use("/api", sessionMiddleware.requireAuth, require("./routes/api"));
app.use("/billing", sessionMiddleware.requireAuth, require("./routes/billing"));
app.use("/admin", sessionMiddleware.requireAuth, require("./routes/admin"));

// SPA fallback: anything not matched above (and not an asset) → login (public)
app.get(/^(?!\/api|\/auth|\/billing|\/admin|\/config\.js).*/, (_, res) =>
  res.sendFile(path.join(PUB, "login.html"))
);

// ───────────────────────────────────────────────────────────────────────────────
// errors
// ───────────────────────────────────────────────────────────────────────────────
app.use(errorHandler);

// ───────────────────────────────────────────────────────────────────────────────
// start
// ───────────────────────────────────────────────────────────────────────────────
app.listen(PORT, HOST, () => {
  const nets = os.networkInterfaces();
  const addrs = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === "IPv4" && !net.internal) addrs.push(net.address);
    }
  }
  console.log("InboxVetter server up:");
  console.log(`  Local → http://localhost:${PORT}`);
  addrs.forEach((ip) => console.log(`  LAN   → http://${ip}:${PORT}`));
});

module.exports = app;
