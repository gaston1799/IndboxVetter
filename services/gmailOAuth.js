"use strict";

const { google } = require("googleapis");
const { SCOPES } = require("./inboxRunner");
const scheduler = require("./inboxScheduler");
const { loadTokens, saveTokens, clearTokens } = require("./gmailTokenStore");
const { updateGmailIntegration, getGmailIntegration } = require("../config/db");

function ensureGoogleConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID || process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || process.env.GMAIL_CLIENT_SECRET;
  const redirectUri =
    process.env.GMAIL_REDIRECT_URI || process.env.GOOGLE_REDIRECT_URI || process.env.GOOGLE_REDIRECT_URL;

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error("Google OAuth client not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI.");
  }

  return { clientId, clientSecret, redirectUri };
}

function createOAuthClient() {
  const { clientId, clientSecret, redirectUri } = ensureGoogleConfig();
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

function generateAuthUrl({ state, loginHint } = {}) {
  const client = createOAuthClient();
  return client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
    state,
    include_granted_scopes: true,
    login_hint: loginHint,
  });
}

async function exchangeCode(code) {
  if (!code) throw new Error("Missing authorization code");
  const client = createOAuthClient();
  const { redirectUri } = ensureGoogleConfig();
  const { tokens } = await client.getToken({ code, redirect_uri: redirectUri });
  return tokens;
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
  scheduler.startForUser(email);
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
  storeTokens,
  getStatus,
  disconnect,
};


