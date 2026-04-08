"use strict";

function maskSecret(value, { prefix = 6, suffix = 4, empty = "<none>" } = {}) {
  const text = String(value || "").trim();
  if (!text) return empty;
  if (text.length <= prefix + suffix) return text;
  return `${text.slice(0, prefix)}...${text.slice(-suffix)}`;
}

function summarizeOAuthTokens(tokens) {
  if (!tokens || typeof tokens !== "object") return null;
  return {
    accessToken: maskSecret(tokens.access_token),
    refreshToken: tokens.refresh_token ? maskSecret(tokens.refresh_token) : "<none>",
    hasRefreshToken: Boolean(tokens.refresh_token),
    tokenType: tokens.token_type || null,
    scope: tokens.scope || null,
    expiryDate: tokens.expiry_date || tokens.expiryDate || null,
  };
}

module.exports = {
  maskSecret,
  summarizeOAuthTokens,
};
