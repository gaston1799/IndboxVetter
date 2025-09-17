"use strict";

const fs = require("fs");
const { encryptJSON, decryptJSON, hasEncryptionKey } = require("../utils/crypto");
const { getUserWorkspace, readJSON, writeJSON } = require("./userStorage");

let warnedAboutPlaintext = false;

function ensureKeyWarning() {
  if (!hasEncryptionKey() && !warnedAboutPlaintext) {
    console.warn("[gmailTokenStore] DATA_ENCRYPTION_KEY not set. Gmail tokens will be stored in base64 plaintext.");
    warnedAboutPlaintext = true;
  }
}

function loadTokens(email) {
  const { tokenPath } = getUserWorkspace(email);
  const record = readJSON(tokenPath, null);
  if (!record) return null;

  if (record && typeof record === "object" && "payload" in record) {
    const data = decryptJSON(record.payload);
    if (data) return data;
  }
  // backwards compatibility with legacy plain JSON
  return record;
}

function saveTokens(email, tokens) {
  const { tokenPath } = getUserWorkspace(email);
  if (!tokens) {
    clearTokens(email);
    return null;
  }
  ensureKeyWarning();
  const payload = encryptJSON(tokens);
  writeJSON(tokenPath, { payload });
  return tokens;
}

function clearTokens(email) {
  const { tokenPath } = getUserWorkspace(email);
  try {
    fs.unlinkSync(tokenPath);
    return true;
  } catch (err) {
    if (err.code === "ENOENT") return false;
    throw err;
  }
}

module.exports = {
  loadTokens,
  saveTokens,
  clearTokens,
};
