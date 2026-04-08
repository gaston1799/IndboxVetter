const express = require("express");
const crypto = require("crypto");

const { requireAuth } = require("../middleware/authMiddleware");
const { gmailConnectLimiter } = require("../middleware/rateLimiters");
const {
  ensureGoogleConfig,
  generateAuthUrl,
  exchangeCode,
  getGmailAddress,
  storeTokens,
  getStatus,
  disconnect,
  selectRedirectUri,
} = require("../services/gmailOAuth");

const router = express.Router();

const DEFAULT_GMAIL_REDIRECT = "/settings.html?gmail=connected";
const REDIRECT_BASE = new URL("https://inboxvetter.local");

function sanitizeRedirect(target) {
  if (!target) return DEFAULT_GMAIL_REDIRECT;
  try {
    const url = new URL(target, REDIRECT_BASE);
    if (url.origin !== REDIRECT_BASE.origin) {
      return DEFAULT_GMAIL_REDIRECT;
    }
    // Prevent protocol-relative URLs (e.g. //evil.com) and only allow absolute paths.
    if (!url.pathname.startsWith("/")) {
      return DEFAULT_GMAIL_REDIRECT;
    }
    return `${url.pathname}${url.search}${url.hash}`;
  } catch (err) {
    return DEFAULT_GMAIL_REDIRECT;
  }
}

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

router.post("/start", requireAuth, gmailConnectLimiter, (req, res) => {
  const email = req.session?.user?.email;
  if (!email) return res.status(401).json({ ok: false, error: "Not authenticated" });
  try {
    ensureGoogleConfig();
    const state = crypto.randomBytes(16).toString("hex");
    req.session.gmailOAuthState = state;
    req.session.gmailOAuthStateCreatedAt = Date.now();
    const origin = `${req.protocol}://${req.get("host")}`;
    const redirectUri = selectRedirectUri(origin);
    if (!redirectUri) throw new Error("No matching GMAIL_REDIRECT_URI configured for this host.");
    req.session.gmailRedirectUri = redirectUri;
    const url = generateAuthUrl({ state, loginHint: email, redirectUri });
    res.json({ ok: true, url, state });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.post("/disconnect", requireAuth, gmailConnectLimiter, (req, res) => {
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

    const preferredOrigin = `${req.protocol}://${req.get("host")}`;
    const savedRedirect = req.session?.gmailRedirectUri;
    const redirectUri = savedRedirect || selectRedirectUri(preferredOrigin);

    const tokens = await exchangeCode(code, redirectUri);

    // Verify the connected Gmail account matches the signed-in user
    try {
      const gmailEmail = await getGmailAddress(tokens, redirectUri);
      if (gmailEmail && gmailEmail.toLowerCase() !== (email || "").toLowerCase()) {
        delete req.session.gmailOAuthState;
        delete req.session.gmailOAuthStateCreatedAt;
        delete req.session.gmailRedirectUri;
        return res
          .status(400)
          .send(
            renderer(
              `Gmail account mismatch. You signed in as ${email} but tried to connect ${gmailEmail}. Please connect the same Gmail account.`
            )
          );
      }
    } catch (verifyErr) {
      // Non-fatal: we still let the user connect, but log for debugging
      console.warn("[gmail] Failed to verify Gmail account email", verifyErr?.message || verifyErr);
    }

    storeTokens(email, tokens);

    delete req.session.gmailOAuthState;
    delete req.session.gmailOAuthStateCreatedAt;
    delete req.session.gmailRedirectUri;

    const target = sanitizeRedirect(req.query?.redirect);
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
