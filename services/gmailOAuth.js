"use strict";

const { google } = require("googleapis");
const scheduler = require("./inboxScheduler");
const { loadTokens, saveTokens, clearTokens } = require("./gmailTokenStore");
const { updateGmailIntegration, getGmailIntegration } = require("../config/db");

// Avoid circular requires: keep Gmail scopes defined locally.
const GMAIL_SCOPES = ["https://www.googleapis.com/auth/gmail.modify"];

function ensureGoogleConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID || process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || process.env.GMAIL_CLIENT_SECRET;
  const redirectRaw =
    process.env.GMAIL_REDIRECT_URI || process.env.GOOGLE_REDIRECT_URI || process.env.GOOGLE_REDIRECT_URL || "";
  const redirectUris = redirectRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (!clientId || !clientSecret || !redirectUris.length) {
    throw new Error(
      "Google OAuth client not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GMAIL_REDIRECT_URI."
    );
  }

  return { clientId, clientSecret, redirectUris };
}

function selectRedirectUri(preferredOrigin) {
  const { redirectUris } = ensureGoogleConfig();
  if (!redirectUris.length) return null;
  if (preferredOrigin) {
    const normalized = preferredOrigin.toLowerCase();
    const found = redirectUris.find((uri) => {
      try {
        return new URL(uri).origin.toLowerCase() === normalized;
      } catch (err) {
        return false;
      }
    });
    if (found) return found;
  }
  return redirectUris[0];
}

function createOAuthClient(redirectUri) {
  const { clientId, clientSecret } = ensureGoogleConfig();
  const effectiveRedirect = redirectUri || selectRedirectUri(null);
  return new google.auth.OAuth2(clientId, clientSecret, effectiveRedirect);
}

function generateAuthUrl({ state, loginHint, redirectUri } = {}) {
  const client = createOAuthClient(redirectUri);
  const scopeList = Array.isArray(GMAIL_SCOPES) ? GMAIL_SCOPES : [GMAIL_SCOPES].filter(Boolean);
  if (!scopeList.length) {
    throw new Error("No Gmail OAuth scopes configured.");
  }
  return client.generateAuthUrl({
    access_type: "offline",
    scope: scopeList.join(" "),
    prompt: "consent",
    state,
    include_granted_scopes: true,
    login_hint: loginHint,
  });
}

async function exchangeCode(code, redirectUri) {
  if (!code) throw new Error("Missing authorization code");
  const client = createOAuthClient(redirectUri);
  const { tokens } = await client.getToken({ code, redirect_uri: redirectUri || undefined });
  return tokens;
}

async function getGmailAddress(tokens, redirectUri) {
  if (!tokens) return null;
  const client = createOAuthClient(redirectUri);
  client.setCredentials(tokens);
  const gmail = google.gmail({ version: "v1", auth: client });
  const { data } = await gmail.users.getProfile({ userId: "me" });
  return data?.emailAddress || null;
}

function mergeTokens(email, nextTokens) {
  const current = loadTokens(email) || {};
  const merged = { ...current, ...nextTokens };
  if (!merged.refresh_token && current.refresh_token) {
    merged.refresh_token = current.refresh_token;
  }
  return merged;
}

function markIntegration(email, connected) {
  updateGmailIntegration(email, {
    connected,
    updatedAt: new Date().toISOString(),
  });
}

function storeTokens(email, tokens) {
  const merged = mergeTokens(email, tokens);
  saveTokens(email, merged);
  markIntegration(email, true);
  if (typeof scheduler.startForUser === "function") {
    scheduler.startForUser(email);
  }
  return merged;
}

function getStatus(email) {
  const meta = getGmailIntegration(email);
  const tokens = loadTokens(email);
  return {
    ...meta,
    connected: !!tokens && (meta?.connected ?? false),
    hasTokens: !!tokens,
    expiryDate: tokens?.expiry_date || tokens?.expiryDate || null,
  };
}

function disconnect(email) {
  clearTokens(email);
  markIntegration(email, false);
  scheduler.stopForUser(email);
  return getStatus(email);
}

module.exports = {
  ensureGoogleConfig,
  createOAuthClient,
  generateAuthUrl,
  exchangeCode,
  getGmailAddress,
  storeTokens,
  getStatus,
  disconnect,
  selectRedirectUri,
};


