const express = require("express");
const crypto = require("crypto");

const { requireAuth } = require("../middleware/authMiddleware");
const {
  ensureGoogleConfig,
  generateAuthUrl,
  exchangeCode,
  storeTokens,
  getStatus,
  disconnect,
} = require("../services/gmailOAuth");

const router = express.Router();

router.get("/status", requireAuth, (req, res) => {
  const email = req.session?.user?.email;
  if (!email) return res.status(401).json({ ok: false, error: "Not authenticated" });
  try {
    const status = getStatus(email);
    res.json({ ok: true, status });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post("/start", requireAuth, (req, res) => {
  const email = req.session?.user?.email;
  if (!email) return res.status(401).json({ ok: false, error: "Not authenticated" });
  try {
    ensureGoogleConfig();
    const state = crypto.randomBytes(16).toString("hex");
    req.session.gmailOAuthState = state;
    req.session.gmailOAuthStateCreatedAt = Date.now();
    const url = generateAuthUrl({ state, loginHint: email });
    res.json({ ok: true, url, state });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.post("/disconnect", requireAuth, (req, res) => {
  const email = req.session?.user?.email;
  if (!email) return res.status(401).json({ ok: false, error: "Not authenticated" });
  try {
    const status = disconnect(email);
    res.json({ ok: true, status });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get("/callback", async (req, res) => {
  try {
    const email = req.session?.user?.email;
    if (!email) {
      return res.status(401).send(renderer("Authentication required. Please sign in and retry."));
    }
    const expectedState = req.session?.gmailOAuthState;
    const issuedAt = req.session?.gmailOAuthStateCreatedAt || 0;
    const state = req.query?.state;
    const code = req.query?.code;
    const error = req.query?.error;

    if (error) {
      return res.status(400).send(renderer(`Authorization error: ${error}`));
    }

    if (!code) {
      return res.status(400).send(renderer("Missing authorization code."));
    }

    if (!expectedState || state !== expectedState) {
      return res.status(400).send(renderer("OAuth state mismatch. Please retry the connection."));
    }

    if (Date.now() - Number(issuedAt) > 10 * 60 * 1000) {
      return res.status(400).send(renderer("OAuth state expired. Please restart the connection."));
    }

    const tokens = await exchangeCode(code);
    storeTokens(email, tokens);

    delete req.session.gmailOAuthState;
    delete req.session.gmailOAuthStateCreatedAt;

    const target = req.query?.redirect || "/settings.html?gmail=connected";
    res.redirect(target);
  } catch (err) {
    res.status(500).send(renderer(`Failed to complete Gmail connection: ${err?.message || err}`));
  }
});

function renderer(message) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>InboxVetter</title></head><body style="font-family:system-ui;margin:3rem"><h2>${escapeHtml(message)}</h2><p>You can close this window and return to InboxVetter.</p></body></html>`;
}

function escapeHtml(s = "") {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

module.exports = router;
