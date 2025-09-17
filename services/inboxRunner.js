"use strict";

const fs = require("fs");
const path = require("path");
const { google } = require("googleapis");
const OpenAI = require("openai").default;

const { getSettings } = require("../config/db");
const {
  getUserWorkspace,
  readJSON,
  writeJSON,
  appendJSONL,
  ensureDir,
} = require("./userStorage");
const { loadTokens, saveTokens } = require("./gmailTokenStore");

const DEFAULT_MAX_RESULTS = parseNumber(process.env.GMAIL_MAX_RESULTS, 200);
const SAFE_MODE_DEFAULT = parseBoolean(process.env.SAFE_MODE, true);
const DEFAULT_GMAIL_QUERY = process.env.GMAIL_QUERY || "label:inbox";
const GLOBAL_OMITTED = parseCsv(process.env.OMITTED_SENDERS || "");
const DEFAULT_ALLOW_ATTACHMENTS = parseBoolean(process.env.ALLOW_ATTACHMENTS, true);
const DEFAULT_MAX_ATTACHMENT_MB = parseNumber(process.env.MAX_ATTACHMENT_MB, 5);
const DEFAULT_MAX_IMAGES = parseNumber(process.env.MAX_IMAGES, 3);
const DEFAULT_MAX_PDF_TEXT_CHARS = parseNumber(process.env.MAX_PDF_TEXT_CHARS, 4000);
const OPENAI_ORG = process.env.OPENAI_ORG || undefined;
const OPENAI_PROJECT = process.env.OPENAI_PROJECT || undefined;

const SCOPES = ["https://www.googleapis.com/auth/gmail.modify"];

const pdfParse = tryRequire("pdf-parse");

class MissingGmailTokensError extends Error {
  constructor(email) {
    super(`No Gmail tokens stored for ${email}`);
    this.name = "MissingGmailTokensError";
  }
}

class InboxRunner {
  constructor(email, options = {}) {
    this.email = email;
    this.options = options;
    this.workspace = getUserWorkspace(email);
    this.settings = getSettings(email);
    this.config = buildConfig(this.settings, options);
    this.logger = createLogger(email);
    this.tokens = loadTokens(email);
    this.googleClient = null;
    this.gmail = null;
    this.openai = createOpenAIClient(this.config.openaiKey);
  }

  ensureGoogleEnv() {
    const clientId = process.env.GOOGLE_CLIENT_ID || process.env.GMAIL_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET || process.env.GMAIL_CLIENT_SECRET;
    const redirectUri =
      process.env.GMAIL_REDIRECT_URI || process.env.GOOGLE_REDIRECT_URI || process.env.GOOGLE_REDIRECT_URL;

    if (!clientId || !clientSecret || !redirectUri) {
      throw new Error("Google OAuth client not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI.");
    }

    return { clientId, clientSecret, redirectUri };
  }

  ensureTokens() {
    if (!this.tokens) throw new MissingGmailTokensError(this.email);
    return this.tokens;
  }

  createOAuthClient() {
    const { clientId, clientSecret, redirectUri } = this.ensureGoogleEnv();
    const tokens = this.ensureTokens();
    const client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
    let current = { ...tokens };
    client.setCredentials(current);
    client.on("tokens", (next) => {
      current = { ...current, ...next };
      saveTokens(this.email, current);
    });
    return client;
  }

  async getGmail() {
    if (this.gmail) return this.gmail;
    this.googleClient = this.createOAuthClient();
    this.gmail = google.gmail({ version: "v1", auth: this.googleClient });
    return this.gmail;
  }

  getCache() {
    return readJSON(this.workspace.cachePath, { ids: [] });
  }

  saveCache(cache) {
    writeJSON(this.workspace.cachePath, cache);
  }

  markImportant(entry) {
    appendJSONL(this.workspace.importantLogPath, entry);
  }

  async fetchAttachments(message) {
    if (!this.config.allowAttachments) return [];

    const gmail = await this.getGmail();
    const parts = flattenParts(message.payload, []).filter(
      (p) => p?.filename && p.body && (p.body.attachmentId || p.body.data)
    );

    const attachments = [];
    for (const part of parts) {
      const filename = part.filename || "file";
      const mimeType = part.mimeType || "application/octet-stream";
      let dataBuf = null;

      try {
        if (part.body?.attachmentId) {
          const { data } = await gmail.users.messages.attachments.get({
            userId: "me",
            messageId: message.id,
            id: part.body.attachmentId,
          });
          dataBuf = b64urlToBuffer(data.data);
        } else if (part.body?.data) {
          dataBuf = b64urlToBuffer(part.body.data);
        }
      } catch (err) {
        this.logger.warn(`Attachment fetch failed for ${filename}: ${err?.message || err}`);
        continue;
      }

      if (!dataBuf) continue;

      const sizeMB = bytesToMB(dataBuf.length);
      if (sizeMB > this.config.maxAttachmentMB) {
        attachments.push({
          kind: "skipped",
          filename,
          mimeType,
          reason: `Too large (${sizeMB.toFixed(1)} MB)`
        });
        continue;
      }

      if (mimeType.startsWith("image/")) {
        const dataUrl = `data:${mimeType};base64,${dataBuf.toString("base64")}`;
        attachments.push({ kind: "image", filename, mimeType, sizeMB, dataUrl });
      } else if (mimeType === "application/pdf") {
        let text = "";
        if (pdfParse) {
          try {
            const parsed = await pdfParse(dataBuf);
            text = String(parsed.text || "").slice(0, this.config.maxPdfTextChars);
          } catch (err) {
            text = `[PDF ${filename} present, ${sizeMB.toFixed(2)} MB. Could not extract text: ${err?.message || err}]`;
          }
        } else {
          text = `[PDF ${filename} present, ${sizeMB.toFixed(2)} MB. Install pdf-parse to extract text.]`;
        }
        attachments.push({ kind: "pdf", filename, mimeType, sizeMB, text });
      } else if (mimeType.startsWith("text/")) {
        const text = dataBuf.toString("utf8").slice(0, this.config.maxPdfTextChars);
        attachments.push({ kind: "text", filename, mimeType, sizeMB, text });
      } else {
        attachments.push({ kind: "other", filename, mimeType, sizeMB });
      }
    }

    const images = attachments.filter((a) => a.kind === "image").slice(0, this.config.maxImages);
    const nonImages = attachments.filter((a) => a.kind !== "image");
    return [...images, ...nonImages];
  }

  async classifyEmail(payload) {
    const { subject, from, body, attachments = [] } = payload;
    const model = this.config.openaiModel;

    if (!this.openai) {
      return {
        action: "KEEP",
        is_scam: false,
        is_important: false,
        confidence: 0,
        reason: "OpenAI key missing",
      };
    }

    const system =
      "You are an email screener for a streamer named Gaston.\n" +
      "Decide if the email is:\n" +
      "- \"TRASH\" (obvious scam/phish/junk/unsolicited sales),\n" +
      "- \"KEEP\" (legit but not critical),\n" +
      "- \"IMPORTANT\" (sponsorships/brand deals/payments/account security/school/admin).\n\n" +
      "Consider email text, and if present, attachment content (images/PDF text).\n" +
      "Prefer IMPORTANT for sponsorship/payment/security even if tentative.\n" +
      "Return the result ONLY via the provided function schema.";

    const compactBody = String(body || "").slice(0, 4000);
    const contentParts = [
      {
        type: "text",
        text: `Subject: ${subject}\nFrom: ${from}\nBody (truncated):\n${compactBody}`,
      },
    ];

    if (supportsVision(model)) {
      for (const a of attachments) {
        if (a.kind === "image" && a.dataUrl) {
          contentParts.push({ type: "image_url", image_url: { url: a.dataUrl } });
        }
      }
    }

    const textSnippets = attachments
      .filter((a) => (a.kind === "pdf" || a.kind === "text") && a.text)
      .map(
        (a) =>
          `---\nAttachment: ${a.filename} (${a.mimeType}, ${a.sizeMB?.toFixed?.(2) ?? "?"} MB)\n${a.text}`
      );
    if (textSnippets.length) {
      contentParts.push({ type: "text", text: `Attachment text excerpts:\n${textSnippets.join("\n")}` });
    }

    const tools = [
      {
        type: "function",
        function: {
          name: "set_classification",
          description: "Return the email classification in strict schema.",
          parameters: {
            type: "object",
            properties: {
              action: { type: "string", enum: ["TRASH", "KEEP", "IMPORTANT"] },
              is_scam: { type: "boolean" },
              is_important: { type: "boolean" },
              confidence: { type: "number", minimum: 0, maximum: 1 },
              reason: { type: "string" },
            },
            required: ["action", "is_scam", "is_important", "confidence", "reason"],
            additionalProperties: false,
          },
        },
      },
    ];

    try {
      const resp = await this.openai.chat.completions.create({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: contentParts },
        ],
        tools,
        tool_choice: { type: "function", function: { name: "set_classification" } },
        ...tokenParam(model, 200),
        ...tempParam(model, 0.1),
      });

      const choice = resp.choices?.[0];
      const call = choice?.message?.tool_calls?.[0];
      let out;
      if (call?.function?.name === "set_classification" && call.function.arguments) {
        out = JSON.parse(call.function.arguments);
      } else {
        const text = choice?.message?.content || "";
        const m = text.match(/\{[\s\S]*\}/);
        out = m ? JSON.parse(m[0]) : null;
      }
      if (!out) throw new Error("No JSON from OpenAI response");

      const action = ["TRASH", "KEEP", "IMPORTANT"].includes(out.action) ? out.action : "KEEP";
      return {
        action,
        is_scam: !!out.is_scam,
        is_important: !!out.is_important,
        confidence: clamp01(out.confidence),
        reason: String(out.reason || "").slice(0, 300),
      };
    } catch (err) {
      this.logger.error(`OpenAI classification failed: ${err?.message || err}`);
      return {
        action: "KEEP",
        is_scam: false,
        is_important: false,
        confidence: 0.2,
        reason: `OpenAI parse/error: ${err?.message || err}`,
      };
    }
  }

  async ensureLabels() {
    const gmail = await this.getGmail();
    const { data } = await gmail.users.labels.list({ userId: "me" });
    const want = ["REVIEW_SPAM", "IMPORTANT_TO_ME", "SCAM"];
    const map = Object.fromEntries((data.labels || []).map((l) => [l.name, l.id]));
    for (const name of want) {
      if (!map[name]) {
        const { data: created } = await gmail.users.labels.create({
          userId: "me",
          requestBody: { name, labelListVisibility: "labelShow", messageListVisibility: "show" },
        });
        map[name] = created.id;
      }
    }
    return map;
  }

  senderIsOmitted(email) {
    if (!email) return false;
    const domain = email.split("@")[1]?.toLowerCase();
    const normalized = email.toLowerCase();
    const entries = [...GLOBAL_OMITTED, ...this.config.omittedSenders];
    return entries.some((entry) => {
      if (!entry) return false;
      if (entry === normalized) return true;
      if (entry.startsWith("@")) return normalized.endsWith(entry);
      if (!entry.includes("@")) return domain === entry;
      return normalized === entry;
    });
  }

  async listNewMessageIds() {
    const gmail = await this.getGmail();
    const cache = this.getCache();
    const seen = new Set(cache.ids || []);
    const listResp = await gmail.users.messages.list({
      userId: "me",
      q: this.config.gmailQuery,
      maxResults: DEFAULT_MAX_RESULTS,
    });
    const ids = (listResp.data.messages || [])
      .map((m) => m.id)
      .filter((id) => id && !seen.has(id));
    return { ids, cache, seen };
  }

  buildRunResult() {
    return {
      email: this.email,
      runAt: new Date().toISOString(),
      total: 0,
      processedIds: [],
      results: [],
      reportPath: null,
    };
  }

  async process() {
    if (!this.openai) {
      throw new Error("OpenAI client not configured. Provide OPENAI_API_KEY or per-user key.");
    }

    const gmail = await this.getGmail();
    const labels = await this.ensureLabels();
    const run = this.buildRunResult();

    const { ids, cache, seen } = await this.listNewMessageIds();
    if (!ids.length) {
      this.logger.info("No new messages to review.");
      return run;
    }

    this.logger.info(`Reviewing ${ids.length} message(s).`);
    const results = [];

    for (const id of ids) {
      try {
        const { data: msg } = await gmail.users.messages.get({
          userId: "me",
          id,
          format: "full",
        });
        const attachments = await this.fetchAttachments(msg);
        const headers = msg.payload?.headers || [];
        const fromRaw = getHeader(headers, "From");
        const { email: fromEmail } = parseAddress(fromRaw);
        const subject = getHeader(headers, "Subject") || "(no subject)";
        const snippet = msg.snippet || "";
        const plain = extractPlainText(msg.payload);
        const body = plain || snippet;
        const receivedAt = msg.internalDate ? new Date(Number(msg.internalDate)).toISOString() : "";
        const labelsApplied = [];
        const attachmentsMeta = (attachments || []).map((a) => ({
          kind: a.kind,
          filename: a.filename || "",
          mimeType: a.mimeType || "",
          sizeMB: typeof a.sizeMB === "number" ? a.sizeMB : 0,
        }));

        if (this.senderIsOmitted(fromEmail)) {
          this.logger.info(`OMITTED: ${fromEmail} | ${subject}`);
          results.push({
            id,
            from: fromRaw,
            subject,
            receivedAt,
            action: "KEEP",
            is_scam: false,
            is_important: false,
            confidence: 1,
            reason: "Omitted sender domain",
            labelsApplied: ["(omitted)"],
            attachments: attachmentsMeta,
          });
          seen.add(id);
          continue;
        }

        const verdict = await this.classifyEmail({ subject, from: fromRaw, body, attachments });
        const info = `${verdict.action} (conf ${verdict.confidence}) - ${verdict.reason}`;

        const applyLabels = async (addLabelIds) => {
          if (!addLabelIds?.length) return;
          await gmail.users.messages.modify({
            userId: "me",
            id,
            requestBody: { addLabelIds: addLabelIds },
          });
        };

        if (verdict.action === "TRASH" || verdict.is_scam) {
          await applyLabels([labels.SCAM]);
          labelsApplied.push("SCAM");
          if (this.config.safeMode) {
            await applyLabels([labels.REVIEW_SPAM]);
            labelsApplied.push("REVIEW_SPAM");
            this.logger.warn(`FLAGGED (SAFE_MODE): ${fromEmail} | ${subject} -> [${labelsApplied.join(", ")}] | ${info}`);
          } else {
            await gmail.users.messages.trash({ userId: "me", id });
            this.logger.warn(`TRASHED: ${fromEmail} | ${subject} -> [${labelsApplied.join(", ")}] | ${info}`);
          }
        } else if (verdict.action === "IMPORTANT" || verdict.is_important) {
          await applyLabels([labels.IMPORTANT_TO_ME]);
          labelsApplied.push("IMPORTANT_TO_ME");
          const entry = {
            id,
            dateISO: new Date().toISOString(),
            from: fromRaw,
            subject,
            reason: verdict.reason,
            confidence: verdict.confidence,
          };
          this.markImportant(entry);
          this.logger.info(`IMPORTANT: ${fromEmail} | ${subject} -> [${labelsApplied.join(", ")}] (logged)`);
        } else {
          this.logger.info(`KEEP: ${fromEmail} | ${subject} | ${info}`);
        }

        results.push({
          id,
          from: fromRaw,
          subject,
          receivedAt,
          action: verdict.action,
          is_scam: verdict.is_scam,
          is_important: verdict.is_important,
          confidence: verdict.confidence,
          reason: verdict.reason,
          labelsApplied,
          attachments: attachmentsMeta,
        });

        seen.add(id);
      } catch (err) {
        this.logger.error(`Processing failed for message ${id}: ${err?.message || err}`);
      }
    }

    const nextCache = { ids: Array.from(seen) };
    this.saveCache(nextCache);

    const reportPath = this.writeReport(results);
    run.total = results.length;
    run.processedIds = results.map((r) => r.id);
    run.results = results;
    run.reportPath = reportPath;
    return run;
  }

  writeReport(items) {
    if (!items?.length) return null;
    const html = renderReportHTML(items);
    const fileName = `inbox_report-${new Date().toISOString().replace(/[:.]/g, "-")}.html`;
    const outPath = path.join(this.workspace.reportDir, fileName);
    writeFile(outPath, html);
    return outPath;
  }
}

function buildConfig(settings, overrides) {
  const safeMode = overrides.safeMode ?? SAFE_MODE_DEFAULT;
  const omittedFromSettings = parseCsv(settings?.omittedSenders || "");
  return {
    safeMode,
    openaiKey: overrides.openaiKey || settings?.openaiKey || process.env.OPENAI_API_KEY || "",
    openaiModel: overrides.model || settings?.model || process.env.OPENAI_MODEL || "gpt-4.1-mini",
    allowAttachments:
      overrides.allowAttachments ??
      (settings?.allowAttachments !== undefined ? settings.allowAttachments : DEFAULT_ALLOW_ATTACHMENTS),
    maxAttachmentMB: parseNumber(
      overrides.maxAttachmentMB ?? settings?.maxAttachmentMB,
      DEFAULT_MAX_ATTACHMENT_MB
    ),
    maxImages: parseNumber(overrides.maxImages ?? settings?.maxImages, DEFAULT_MAX_IMAGES),
    maxPdfTextChars: parseNumber(
      overrides.maxPdfTextChars ?? settings?.maxPdfTextChars,
      DEFAULT_MAX_PDF_TEXT_CHARS
    ),
    gmailQuery: overrides.gmailQuery || DEFAULT_GMAIL_QUERY,
    omittedSenders: omittedFromSettings,
  };
}

function createOpenAIClient(apiKey) {
  const key = (apiKey || "").trim();
  if (!key) {
    return null;
  }
  const options = { apiKey: key };
  if (OPENAI_ORG) options.organization = OPENAI_ORG;
  if (OPENAI_PROJECT) options.project = OPENAI_PROJECT;
  return new OpenAI(options);
}

function createLogger(email) {
  const prefix = `[InboxVetter][${email}]`;
  return {
    info: (...args) => console.log(prefix, ...args),
    warn: (...args) => console.warn(prefix, ...args),
    error: (...args) => console.error(prefix, ...args),
  };
}

function parseBoolean(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "y"].includes(normalized)) return true;
  if (["0", "false", "no", "n"].includes(normalized)) return false;
  return fallback;
}

function parseNumber(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function parseCsv(value) {
  return String(value || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function tryRequire(name) {
  try {
    return require(name);
  } catch {
    return null;
  }
}

function flattenParts(payload, out = []) {
  if (!payload) return out;
  out.push(payload);
  if (payload.parts) payload.parts.forEach((p) => flattenParts(p, out));
  return out;
}

function summarizeAttachments(list = []) {
  const c = { image: 0, pdf: 0, text: 0, other: 0, skipped: 0 };
  list.forEach((a) => {
    c[a.kind] = (c[a.kind] || 0) + 1;
  });
  const parts = [];
  if (c.image) parts.push(`${c.image} img`);
  if (c.pdf) parts.push(`${c.pdf} pdf`);
  if (c.text) parts.push(`${c.text} txt`);
  if (c.other) parts.push(`${c.other} other`);
  if (c.skipped) parts.push(`${c.skipped} skipped`);
  return parts.join(", ");
}

function b64urlToBuffer(data) {
  const b64 = String(data || "").replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(b64, "base64");
}

function bytesToMB(n) {
  return n / (1024 * 1024);
}

function supportsVision(model) {
  return /^(gpt-5|gpt-4o|gpt-4\.1|gpt-4o-mini|gpt-4\.1-mini)/i.test(model);
}

function tokenParam(model, n) {
  return /^(gpt-5|o[0-9]|o1|o3|o4)/i.test(model)
    ? { max_completion_tokens: n }
    : { max_tokens: n };
}

function tempParam(model, t) {
  return /^(gpt-5|o[0-9]|o1|o3|o4)/i.test(model) ? {} : { temperature: t };
}

function extractPlainText(payload) {
  if (!payload) return "";
  const stack = [payload];
  while (stack.length) {
    const p = stack.pop();
    if (!p) continue;
    if (p.mimeType === "text/plain" && p.body?.data) return decodeB64Url(p.body.data);
    if (p.parts) stack.push(...p.parts);
  }
  return "";
}

function decodeB64Url(str = "") {
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(b64, "base64").toString("utf8");
}

function getHeader(headers = [], name) {
  const h = headers.find((h) => h.name?.toLowerCase() === name.toLowerCase());
  return h?.value || "";
}

function parseAddress(raw) {
  const m = raw?.match(/<?([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})>?/i);
  return {
    name: raw?.replace(/<.*?>/g, "").trim() || "",
    email: m ? m[1].toLowerCase() : "",
  };
}

function renderReportHTML(items) {
  const rows = items
    .map((r, i) => {
      const link = gmailMsgLink(r.id);
      return `<tr>
        <td class="idx">${i + 1}</td>
        <td class="date">${escapeHtml(r.receivedAt || "")}</td>
        <td class="from">${escapeHtml(r.from || "")}</td>
        <td class="subject">${link ? `<a href="${link}" target="_blank" rel="noopener">${escapeHtml(r.subject || "(no subject)")}</a>` : escapeHtml(r.subject || "(no subject)")}</td>
        <td class="action">${actionBadge(r.action)}</td>
        <td class="scam">${scamBadge(r.is_scam)}</td>
        <td class="conf">${(r.confidence ?? 0).toFixed(2)}</td>
        <td class="labels">${escapeHtml((r.labelsApplied || []).join(", "))}</td>
        <td class="reason">${escapeHtml(r.reason || "")}</td>
        <td class="atts">${attachmentListHTML(r.attachments)}</td>
      </tr>`;
    })
    .join("");

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
<title>InboxVetter Report</title>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>
  :root {
  color-scheme: dark;
  --bg: #0b0f17;
  --panel: #0f172a;
  --thead: #0b1222;
  --hover: #0c1426;
  --row-alt: #0d162a;
  --text: #e5e7eb;
  --muted: #93a4bc;
  --border: #1f2937;

  --badge-keep: #3b82f6;
  --badge-trash: #ef4444;
  --badge-important: #10b981;

  --pill-scam-bg: #1b0f12;
  --pill-scam-text: #fca5a5;
  --pill-scam-border: #7f1d1d;

  --pill-ok-bg: #0f1a14;
  --pill-ok-text: #bbf7d0;
  --pill-ok-border: #065f46;

  --shadow: 0 12px 28px rgba(0,0,0,.45);
}

html, body {
  background: var(--bg);
}
body {
  color: var(--text);
  font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial;
  margin: 24px;
}

table {
  width: 100%;
  border-collapse: collapse;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 14px;
  box-shadow: var(--shadow);
  overflow: hidden;
}
th, td {
  padding: 12px 14px;
  border-bottom: 1px solid var(--border);
  vertical-align: top;
}
th {
  text-align: left;
  background: var(--thead);
  position: sticky;
  top: 0;
  z-index: 1;
}
tbody tr:nth-child(odd) { background: #0d162a; }
tbody tr:hover { background: #0c1426; }

.badge {
  color: white;
  padding: 6px 10px;
  border-radius: 999px;
  font-size: 12px;
  letter-spacing: .2px;
  display: inline-flex;
  align-items: center;
  white-space: nowrap;
  line-height: 1;
}
.badge[data-kind="KEEP"] { background: var(--badge-keep); }
.badge[data-kind="TRASH"] { background: var(--badge-trash); }
.badge[data-kind="IMPORTANT"] { background: var(--badge-important); }

.pill {
  display: inline-flex;
  align-items: center;
  white-space: nowrap;
  padding: 6px 10px;
  border-radius: 999px;
  font-size: 12px;
  border: 1px solid transparent;
}
.pill-scam {
  background: var(--pill-scam-bg);
  color: var(--pill-scam-text);
  border-color: var(--pill-scam-border);
}
.pill-ok {
  background: var(--pill-ok-bg);
  color: var(--pill-ok-text);
  border-color: var(--pill-ok-border);
}

.idx { width: 40px; color: var(--muted); }
.date { white-space: nowrap; color: var(--muted); }
.subject a { color: #93c5fd; text-decoration: underline; }
.subject a:hover { color: #bfdbfe; }
.conf { text-align: right; font-variant-numeric: tabular-nums; }
.footer { margin-top: 16px; color: var(--muted); font-size: 12px; }
</style>
</head>
<body>
  <h1>InboxVetter - Run Report</h1>
  <div class="meta">Generated at ${escapeHtml(new Date().toLocaleString())} • ${items.length} item(s)</div>
  <table>
    <thead>
      <tr><th>#</th><th>Date</th><th>From</th><th>Subject</th><th>Action</th><th>SCAM</th><th>Conf</th><th>Labels</th><th>Reason</th><th>Attachments</th></tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="footer">“Action” = model decision; “SCAM” = explicit scam flag.</div>
</body>
</html>`;
}

function attachmentListHTML(list = []) {
  if (!list.length) return `<span class="att none">—</span>`;
  const items = list
    .map((a) => {
      const label = `${kindEmoji(a.kind)} ${a.filename || "(file)"}`;
      const hint = `${a.mimeType || ""}${a.sizeMB ? ` • ${humanMB(a.sizeMB)}` : ""}`;
      return `<li class="att" title="${escapeHtml(hint)}">${escapeHtml(label)}</li>`;
    })
    .join("");
  return `<ul class="att-list">${items}</ul>`;
}

function escapeHtml(s = "") {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function gmailMsgLink(messageId) {
  return messageId ? `https://mail.google.com/mail/u/0/#all/${messageId}` : null;
}

function actionBadge(action) {
  const colorAttr = action ? ` data-kind="${action}"` : "";
  const color = action === "IMPORTANT" ? "#10b981" : action === "TRASH" ? "#ef4444" : "#3b82f6";
  return `<span class="badge"${colorAttr} style="background:${color}">${action}</span>`;
}

function scamBadge(isScam) {
  return `<span class="pill ${isScam ? "pill-scam" : "pill-ok"}">${isScam ? "SCAM" : "Not Scam"}</span>`;
}

function kindEmoji(kind) {
  return kind === "image"
    ? "??"
    : kind === "pdf"
    ? "??"
    : kind === "text"
    ? "??"
    : kind === "skipped"
    ? "?"
    : "??";
}

function humanMB(n) {
  const v = Number(n || 0);
  if (!Number.isFinite(v) || v <= 0) return "";
  return `${v.toFixed(v < 1 ? 2 : 1)} MB`;
}

function writeFile(filePath, contents) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, contents, "utf8");
}

function clamp01(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.min(1, num));
}

async function runInboxOnce(email, options = {}) {
  const runner = new InboxRunner(email, options);
  return runner.process();
}

module.exports = {
  InboxRunner,
  runInboxOnce,
  MissingGmailTokensError,
  summarizeAttachments,
  SCOPES,
};




