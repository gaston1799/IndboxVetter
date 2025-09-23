"use strict";

const DEFAULT_GMAIL_QUERY = process.env.GMAIL_QUERY || "label:inbox";
const DEFAULT_SAFE_MODE = /^true$/i.test(String(process.env.SAFE_MODE || "true"));
const DEFAULT_ALLOW_ATTACHMENTS = /^true$/i.test(String(process.env.ALLOW_ATTACHMENTS || "true"));
const DEFAULT_MAX_ATTACHMENT_MB = Number(process.env.MAX_ATTACHMENT_MB || 5);
const DEFAULT_MAX_IMAGES = Number(process.env.MAX_IMAGES || 3);
const DEFAULT_MAX_PDF_TEXT_CHARS = Number(process.env.MAX_PDF_TEXT_CHARS || 4000);
const DEFAULT_OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";
const DEFAULT_GMAIL_MAX_RESULTS = Number(process.env.GMAIL_MAX_RESULTS || 200);
const DEFAULT_WINDOW_DAYS = Number(process.env.GMAIL_WINDOW_DAYS || 7);

function boolFrom(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return fallback;
    if (["false", "0", "no", "off"].includes(normalized)) return false;
    if (["true", "1", "yes", "on"].includes(normalized)) return true;
    return fallback;
  }
  return Boolean(value);
}

function numberFrom(value, fallback, { min, max, round } = {}) {
  if (value === undefined || value === null || value === "") return fallback;
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  let next = round ? Math.round(num) : num;
  if (typeof min === "number") next = Math.max(min, next);
  if (typeof max === "number") next = Math.min(max, next);
  return next;
}

function normalizeQuery(query = DEFAULT_GMAIL_QUERY, windowDays = DEFAULT_WINDOW_DAYS) {
  const trimmed = String(query || "").trim() || DEFAULT_GMAIL_QUERY;
  const clause = `newer_than:${Math.max(1, Math.round(windowDays))}d`;
  if (new RegExp(`\\b${clause.replace(/[-:]/g, m => `\\${m}`)}\\b`, "i").test(trimmed)) {
    return trimmed;
  }
  return `${trimmed} ${clause}`.trim();
}

function buildRunConfig(settings = {}, overrides = {}) {
  const safeMode = boolFrom(
    overrides.safeMode !== undefined ? overrides.safeMode : settings.safeMode,
    DEFAULT_SAFE_MODE
  );
  const allowAttachments = boolFrom(
    overrides.allowAttachments !== undefined ? overrides.allowAttachments : settings.allowAttachments,
    DEFAULT_ALLOW_ATTACHMENTS
  );
  const maxAttachmentMB = numberFrom(
    overrides.maxAttachmentMB ?? settings.maxAttachmentMB,
    DEFAULT_MAX_ATTACHMENT_MB,
    { min: 1 }
  );
  const maxImages = numberFrom(
    overrides.maxImages ?? settings.maxImages,
    DEFAULT_MAX_IMAGES,
    { min: 0 }
  );
  const maxPdfTextChars = numberFrom(
    overrides.maxPdfTextChars ?? settings.maxPdfTextChars,
    DEFAULT_MAX_PDF_TEXT_CHARS,
    { min: 500, round: true }
  );
  const gmailMaxResults = numberFrom(
    overrides.gmailMaxResults ?? settings.gmailMaxResults,
    DEFAULT_GMAIL_MAX_RESULTS,
    { min: 1, max: 500, round: true }
  );
  const windowDays = numberFrom(
    overrides.windowDays ?? settings.windowDays,
    DEFAULT_WINDOW_DAYS,
    { min: 1, max: 30, round: true }
  );

  const baseQuery = overrides.gmailQuery ?? settings.gmailQuery ?? DEFAULT_GMAIL_QUERY;
  return {
    safeMode,
    allowAttachments,
    maxAttachmentMB,
    maxImages,
    maxPdfTextChars,
    gmailMaxResults,
    openaiModel: overrides.model || settings.model || DEFAULT_OPENAI_MODEL,
    gmailQuery: normalizeQuery(baseQuery, windowDays),
    gmailQueryRaw: String(baseQuery || DEFAULT_GMAIL_QUERY).trim() || DEFAULT_GMAIL_QUERY,
    windowDays,
  };
}

module.exports = {
  buildRunConfig,
  boolFrom,
  numberFrom,
  normalizeQuery,
  DEFAULT_OPENAI_MODEL,
};
