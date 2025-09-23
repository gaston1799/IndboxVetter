"use strict";

const fs = require("fs");
const path = require("path");
const { google } = require("googleapis");

const { ensureGoogleConfig } = require("../../services/gmailOAuth");
const { loadTokens, saveTokens } = require("../../services/gmailTokenStore");
const { getUserWorkspace } = require("../../services/userStorage");

const pdfParse = tryRequire("pdf-parse");

class GmailTokenMissingError extends Error {
  constructor(email) {
    super(`No Gmail tokens stored for ${email}`);
    this.name = "GmailTokenMissingError";
  }
}

function tryRequire(name) {
  try {
    return require(name);
  } catch (err) {
    return null;
  }
}

function bytesToMB(n) {
  return n / (1024 * 1024);
}

function b64urlToBuffer(data) {
  const b64 = String(data || "").replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(b64, "base64");
}

function flattenParts(payload, out = []) {
  if (!payload) return out;
  out.push(payload);
  if (Array.isArray(payload.parts)) {
    payload.parts.forEach((part) => flattenParts(part, out));
  }
  return out;
}

function ensureWorkspace(email) {
  const workspace = getUserWorkspace(email);
  fs.mkdirSync(workspace.baseDir, { recursive: true });
  return workspace;
}

async function getAuthorizedGmail(email) {
  const tokens = loadTokens(email);
  if (!tokens || !tokens.refresh_token) {
    throw new GmailTokenMissingError(email);
  }
  const { clientId, clientSecret, redirectUri } = ensureGoogleConfig();
  const auth = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  let currentTokens = { ...tokens };
  auth.setCredentials(currentTokens);
  auth.on("tokens", (next) => {
    currentTokens = { ...currentTokens, ...next };
    saveTokens(email, currentTokens);
  });
  const gmail = google.gmail({ version: "v1", auth });
  return { gmail, auth };
}

async function listMessages(gmail, { query, maxResults }) {
  const response = await gmail.users.messages.list({
    userId: "me",
    q: query,
    maxResults,
  });
  return Array.isArray(response.data.messages)
    ? response.data.messages.map((msg) => msg.id)
    : [];
}

async function getMessage(gmail, id) {
  const { data } = await gmail.users.messages.get({
    userId: "me",
    id,
    format: "full",
  });
  return data;
}

function getHeader(headers = [], name) {
  const lower = name.toLowerCase();
  const entry = headers.find((header) => header.name?.toLowerCase() === lower);
  return entry?.value || "";
}

function decodeB64Url(str = "") {
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(b64, "base64").toString("utf8");
}

function extractPlainText(payload) {
  if (!payload) return "";
  const stack = [payload];
  while (stack.length) {
    const part = stack.pop();
    if (!part) continue;
    if (part.mimeType === "text/plain" && part.body?.data) {
      return decodeB64Url(part.body.data);
    }
    if (part.parts) stack.push(...part.parts);
  }
  return "";
}

function summarizeAttachments(list = []) {
  const counts = { image: 0, pdf: 0, text: 0, other: 0, skipped: 0 };
  list.forEach((item) => {
    counts[item.kind] = (counts[item.kind] || 0) + 1;
  });
  const parts = [];
  if (counts.image) parts.push(`${counts.image} img`);
  if (counts.pdf) parts.push(`${counts.pdf} pdf`);
  if (counts.text) parts.push(`${counts.text} txt`);
  if (counts.other) parts.push(`${counts.other} other`);
  if (counts.skipped) parts.push(`${counts.skipped} skipped`);
  return parts.join(", ");
}

async function fetchAttachments(gmail, email, message, config) {
  if (!config.allowAttachments) return [];
  const parts = flattenParts(message.payload, []).filter(
    (p) => p?.filename && p.body && (p.body.attachmentId || p.body.data)
  );
  const attachments = [];
  for (const part of parts) {
    const filename = part.filename || "file";
    const mimeType = part.mimeType || "application/octet-stream";
    let dataBuffer = null;
    try {
      if (part.body?.attachmentId) {
        const { data } = await gmail.users.messages.attachments.get({
          userId: "me",
          messageId: message.id,
          id: part.body.attachmentId,
        });
        dataBuffer = b64urlToBuffer(data.data);
      } else if (part.body?.data) {
        dataBuffer = b64urlToBuffer(part.body.data);
      }
    } catch (err) {
      attachments.push({ kind: "skipped", filename, mimeType, reason: `Fetch failed: ${err.message || err}` });
      continue;
    }
    if (!dataBuffer) continue;
    const sizeMB = bytesToMB(dataBuffer.length);
    if (sizeMB > config.maxAttachmentMB) {
      attachments.push({
        kind: "skipped",
        filename,
        mimeType,
        reason: `Too large (${sizeMB.toFixed(1)} MB)`
      });
      continue;
    }
    if (mimeType.startsWith("image/")) {
      if (attachments.filter((a) => a.kind === "image").length >= config.maxImages) continue;
      const dataUrl = `data:${mimeType};base64,${dataBuffer.toString("base64")}`;
      attachments.push({ kind: "image", filename, mimeType, sizeMB, dataUrl });
    } else if (mimeType === "application/pdf") {
      let text = "";
      if (pdfParse) {
        try {
          const parsed = await pdfParse(dataBuffer);
          text = String(parsed.text || "").slice(0, config.maxPdfTextChars);
        } catch (err) {
          text = `[PDF ${filename} present, ${sizeMB.toFixed(2)} MB. Could not extract text: ${err.message || err}]`;
        }
      } else {
        text = `[PDF ${filename} present, ${sizeMB.toFixed(2)} MB. Install pdf-parse to extract text.]`;
      }
      attachments.push({ kind: "pdf", filename, mimeType, sizeMB, text });
    } else if (mimeType.startsWith("text/")) {
      const text = dataBuffer.toString("utf8").slice(0, config.maxPdfTextChars);
      attachments.push({ kind: "text", filename, mimeType, sizeMB, text });
    } else {
      attachments.push({ kind: "other", filename, mimeType, sizeMB });
    }
  }
  const images = attachments.filter((a) => a.kind === "image").slice(0, config.maxImages);
  const others = attachments.filter((a) => a.kind !== "image");
  return [...images, ...others];
}

async function ensureLabels(gmail) {
  const { data } = await gmail.users.labels.list({ userId: "me" });
  const want = ["REVIEW_SPAM", "IMPORTANT_TO_ME", "SCAM"];
  const map = Object.fromEntries((data.labels || []).map((label) => [label.name, label.id]));
  for (const name of want) {
    if (!map[name]) {
      const { data: created } = await gmail.users.labels.create({
        userId: "me",
        requestBody: {
          name,
          labelListVisibility: "labelShow",
          messageListVisibility: "show",
        },
      });
      map[name] = created.id;
    }
  }
  return map;
}

function senderIsOmitted(emailAddress, omittedList = []) {
  if (!emailAddress) return false;
  const normalized = emailAddress.toLowerCase();
  const domain = normalized.split("@")[1];
  return omittedList.some((entry) => {
    if (!entry) return false;
    if (entry === normalized) return true;
    if (entry.startsWith("@")) return normalized.endsWith(entry);
    if (!entry.includes("@")) return domain === entry;
    return normalized === entry;
  });
}

module.exports = {
  getAuthorizedGmail,
  listMessages,
  getMessage,
  fetchAttachments,
  getHeader,
  extractPlainText,
  summarizeAttachments,
  ensureLabels,
  senderIsOmitted,
  GmailTokenMissingError,
  ensureWorkspace,
};
